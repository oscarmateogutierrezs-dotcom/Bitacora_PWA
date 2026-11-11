const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('login.html', 'utf8');
const loginCode = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const sessionCode = fs.readFileSync('session.js', 'utf8');

test('configured people have names and cargos available in the original form', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync('personas.js', 'utf8'), context);
    const personas = vm.runInContext('PERSONAS_CAPACITOR', context);
    const cargoHtml = html.match(/<select name="cargo"[\s\S]*?<\/select>/)[0];
    const cargos = new Set([...cargoHtml.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]));
    for (const persona of personas) {
        assert.ok(typeof persona.nombre === 'string' && persona.nombre.trim(), 'Cada persona debe tener un nombre');
        assert.ok(cargos.has(persona.cargo), `Cargo no disponible en el formulario: ${persona.cargo}`);
    }
});

function createLogin({ native = false, personas = [], offline = false, storageFails = false } = {}) {
    const storage = new Map();
    const redirects = [];
    const listeners = {};
    const elements = {};
    for (const id of [
        'loginForm', 'error-alert', 'error-title', 'error-desc', 'nombre', 'cargo',
        'persona', 'nombre-group', 'cargo-group', 'persona-group', 'login-submit',
        'login-subtitle'
    ]) {
        elements[id] = {
            value: '',
            hidden: id === 'persona-group',
            style: {},
            listeners: {},
            classList: { add() {}, remove() {} },
            addEventListener(type, handler) { this.listeners[type] = handler; }
        };
    }
    elements.cargo.options = [...html.matchAll(/<option value="([^"]+)">/g)]
        .map(match => ({ value: match[1] }));
    elements.persona.options = [];
    elements.persona.add = function (option) { this.options.push(option); };

    const context = {
        TextEncoder, TextDecoder, btoa, atob, setTimeout, console,
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => {
                if (storageFails) throw new Error('Storage unavailable');
                storage.set(key, value);
            },
            removeItem: key => storage.delete(key)
        }
    };
    vm.createContext(context);
    vm.runInContext(sessionCode, context);
    context.document = {
        getElementById: id => elements[id],
        querySelectorAll: () => []
    };
    context.navigator = { onLine: !offline };
    context.Option = function (text, value) { this.text = text; this.value = value; };
    context.window = {
        location: { replace: url => redirects.push(url) },
        addEventListener: (type, handler) => { listeners[type] = handler; }
    };
    if (native) context.window.Capacitor = { isNativePlatform: () => true };
    if (personas !== null) {
        vm.runInContext(`const PERSONAS_CAPACITOR = ${JSON.stringify(personas)};`, context);
    }
    vm.runInContext(loginCode, context);
    listeners.DOMContentLoaded();
    return { elements, redirects, storage, context };
}

test('Capacitor shows names only and saves name and cargo before redirecting', () => {
    const app = createLogin({
        native: true,
        personas: [{ nombre: '  Ana Pérez  ', cargo: 'Mecánico' }, { nombre: 'Luis', cargo: 'Soldador' }]
    });
    assert.equal(app.elements['nombre-group'].hidden, true);
    assert.equal(app.elements['cargo-group'].hidden, true);
    assert.equal(app.elements['login-submit'].hidden, true);
    assert.equal(app.elements['persona-group'].hidden, false);
    assert.deepEqual(app.elements.persona.options.map(option => option.text), ['Ana Pérez', 'Luis']);

    app.elements.persona.value = '0';
    app.elements.persona.listeners.change();
    assert.deepEqual(JSON.parse(app.context.decodeToken(app.storage.get('sessionToken'))), {
        nombre: 'Ana Pérez', cargo: 'Mecánico', marker: 'session_active_2026'
    });
    assert.deepEqual(app.redirects, ['dashboard.html']);
});

test('PWA retains the original form and session flow', () => {
    const app = createLogin();
    assert.equal(app.elements['persona-group'].hidden, true);
    assert.equal(app.elements['nombre-group'].hidden, false);
    assert.equal(app.elements['cargo-group'].hidden, false);
    app.elements.nombre.value = 'María';
    app.elements.cargo.value = 'Soldador';
    let prevented = false;
    app.elements.loginForm.listeners.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(JSON.parse(app.context.decodeToken(app.storage.get('sessionToken'))), {
        nombre: 'María', cargo: 'Soldador', marker: 'session_active_2026'
    });
    assert.deepEqual(app.redirects, ['dashboard.html']);
});

test('invalid, empty or missing configuration cannot create a session', () => {
    for (const personas of [[], null, [{ nombre: 'Ana', cargo: 'Inválido' }], [{ nombre: ' ', cargo: 'Mecánico' }]]) {
        const app = createLogin({ native: true, personas });
        assert.equal(app.elements.persona.disabled, true);
        assert.equal(app.elements['error-title'].innerText, 'Error de configuración');
        assert.equal(app.storage.has('sessionToken'), false);
        assert.deepEqual(app.redirects, []);
    }
});

test('storage failure remains visible and the selection can be retried', () => {
    const app = createLogin({ native: true, personas: [{ nombre: 'Ana', cargo: 'Mecánico' }], storageFails: true });
    app.elements.persona.value = '0';
    app.elements.persona.listeners.change();
    assert.equal(app.elements['error-title'].innerText, 'Error de almacenamiento');
    assert.equal(app.elements.persona.value, '');
    assert.deepEqual(app.redirects, []);
});

test('offline Capacitor login is disabled', () => {
    const app = createLogin({ native: true, personas: [{ nombre: 'Ana', cargo: 'Mecánico' }], offline: true });
    assert.equal(app.elements.persona.disabled, true);
    assert.equal(app.elements['error-title'].innerText, 'Sin conexión');
    assert.deepEqual(app.redirects, []);
});
