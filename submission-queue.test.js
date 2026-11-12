const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createStorage() {
    const data = new Map();
    return {
        get length() { return data.size; },
        key: index => [...data.keys()][index] || null,
        getItem: key => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key)
    };
}

function createPage({ storage = createStorage(), online = true, status = () => false, post = async () => ({ type: 'opaque' }) } = {}) {
    const handlers = {};
    const timers = new Map();
    let timerId = 0;
    const requests = [];
    const messages = [];
    const context = {
        TextEncoder, TextDecoder, URL, AbortController,
        Event: class { constructor(type) { this.type = type; } },
        navigator: { onLine: online },
        localStorage: storage,
        console: { error: (...args) => messages.push(args), warn: (...args) => messages.push(args) },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return post(url, options); }
    };
    context.window = {
        addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
        dispatchEvent(event) { for (const handler of handlers[event.type] || []) handler(event); }
    };
    context.document = {
        visibilityState: 'visible',
        addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
        getElementById: () => null,
        createElement: () => ({ remove() {} }),
        head: {
            append(script) {
                const url = new URL(script.src);
                const callback = url.searchParams.get('callback');
                const value = status(url.searchParams.get('submissionId'));
                if (value instanceof Error) script.onerror();
                else context.window[callback](value);
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('session.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('submission-queue.js', 'utf8'), context);
    return { context, storage, requests, messages, timers, handlers };
}

const entry = {
    submissionId: 'report-1', usuario: 'Prueba', cargo: 'Mecánico',
    imagenes: ['data:image/jpeg;base64,AAAA'], sendStatus: 'sending'
};

test('persists full images and retries repeatedly until status confirms the ID', async () => {
    let confirmed = false;
    const page = createPage({ status: () => ({ success: true, processed: confirmed }) });
    assert.ok(page.context.saveEntry(entry));
    for (let attempt = 0; attempt < 6; attempt++) {
        await page.context.window.BitacoraQueue.run();
    }
    assert.equal(page.requests.length, 6);
    assert.equal(page.requests[0].imagenes[0], entry.imagenes[0]);
    assert.equal(page.context.getEntries()[0].sendStatus, 'sending');
    assert.ok([...page.timers.values()].some(timer => timer.delay === 15000));
    confirmed = true;
    await page.context.window.BitacoraQueue.run();
    assert.equal(page.context.getEntries()[0].sendStatus, 'confirmed');
    assert.equal(page.requests.length, 6);
});

test('pauses offline and resumes after navigation without a session', async () => {
    const storage = createStorage();
    const first = createPage({ storage, online: false });
    first.context.saveEntry(entry);
    await first.context.window.BitacoraQueue.run();
    assert.equal(first.requests.length, 0);
    let processed = false;
    const afterLogout = createPage({
        storage,
        status: () => ({ success: true, processed }),
        post: async () => { processed = true; return { type: 'opaque' }; }
    });
    await afterLogout.context.window.BitacoraQueue.run();
    assert.equal(afterLogout.requests.length, 1);
    assert.equal(afterLogout.context.getEntries()[0].sendStatus, 'confirmed');
});

test('online event resumes an offline queue without logging in', async () => {
    let processed = false;
    const page = createPage({
        online: false,
        status: () => ({ success: true, processed }),
        post: async () => { processed = true; return { type: 'opaque' }; }
    });
    page.context.saveEntry(entry);
    await page.context.window.BitacoraQueue.run();
    assert.equal(page.requests.length, 0);
    page.context.navigator.onLine = true;
    await page.handlers.online[0]();
    assert.equal(page.requests.length, 1);
    assert.equal(page.context.getEntries()[0].sendStatus, 'confirmed');
});

test('opaque response or unavailable status never counts as confirmation', async () => {
    const page = createPage({ status: () => new Error('unavailable') });
    page.context.saveEntry(entry);
    await page.context.window.BitacoraQueue.run();
    assert.equal(page.requests.length, 1);
    assert.equal(page.context.getEntries()[0].sendStatus, 'sending');
    assert.ok(page.messages.length > 0);
});

test('legacy entries are retained and cannot overwrite a newer per-ID entry', () => {
    const storage = createStorage();
    storage.setItem('bitacora_entries', JSON.stringify([entry]));
    const page = createPage({ storage });
    page.context.saveEntry({ ...entry, sendStatus: 'confirmed' });
    assert.equal(page.context.getEntries().length, 1);
    assert.equal(page.context.getEntries()[0].sendStatus, 'confirmed');
});

test('corrupt legacy storage prevents overwriting stored reports', () => {
    const storage = createStorage();
    storage.setItem('bitacora_entries', 'invalid');
    const page = createPage({ storage });
    assert.equal(page.context.saveEntry(entry), false);
    assert.equal(storage.getItem('bitacora_entry:report-1'), null);
    assert.equal(storage.getItem('bitacora_entries'), 'invalid');
    assert.ok(page.messages.length > 0);
});

test('the pages start the shared queue independently of the session', () => {
    for (const name of ['login.html', 'dashboard.html', 'historial.html']) {
        const html = fs.readFileSync(name, 'utf8');
        assert.match(html, /src="submission-queue\.js"/);
        assert.match(html, /id="queue-status"/);
    }
    for (const name of ['dashboard.js', 'historial.js']) {
        assert.doesNotMatch(fs.readFileSync(name, 'utf8'), /deleteAllEntries\(\)/);
    }
});
