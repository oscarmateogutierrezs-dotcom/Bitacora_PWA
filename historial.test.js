const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createHistoryPage({ token = null, offline = false, response = 'entries', returnedEntries = null, sheetRows = null } = {}) {
  const handlers = {};
  const redirects = [];
  const requests = [];
  const status = { classList: { toggle: () => {} }, textContent: '' };
  const list = {
    children: [],
    replaceChildren(fragment) { this.children = fragment ? fragment.children : []; }
  };
  const createNode = (tag) => ({
    tag,
    children: [],
    append(...children) { this.children.push(...children); },
    hasChildNodes() { return this.children.length > 0; },
    remove() {}
  });
  sheetRows = sheetRows || [
    ['Área', 'Máquina', 'Novedad', 'Duración', 'Fecha', 'Hora', 'Usuario', 'Cargo', 'Imágenes'],
    ['Taller', 'Equipo 1', 'Reparación', '30 min', '01/01/2026', '08:00', 'Prueba', 'Mecánico', 'https://example.test/imagen']
  ];
  const backend = {
    SpreadsheetApp: {
      openById: () => ({
        getSheetById: () => ({
          getLastRow: () => sheetRows.length,
          getRange: () => ({ getDisplayValues: () => sheetRows })
        })
      })
    },
    ContentService: {
      MimeType: { JAVASCRIPT: 'javascript', JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    }
  };
  vm.createContext(backend);
  vm.runInContext(fs.readFileSync('..\\apps-script\\Code.gs', 'utf8'), backend);

  const page = {
    navigator: {},
    SESSION_APIS_SUPPORTED: true,
    URL,
    setTimeout,
    clearTimeout,
    getSessionToken: () => token,
    parseSessionToken: () => ({}),
    isOffline: () => offline,
    console: { error: () => {} },
    window: {
      addEventListener: (event, handler) => { handlers[event] = handler; },
      location: { replace: (url) => redirects.push(url) }
    },
    document: {
      getElementById: (id) => ({ 'history-status': status, 'history-list': list })[id] || null,
      createElement: createNode,
      createDocumentFragment: () => createNode('fragment'),
      createTextNode: (text) => ({ textContent: text }),
      head: {
        append(script) {
          const url = new URL(script.src);
          requests.push(url);
          if (response === 'entries') {
            const callback = url.searchParams.get('callback');
            if (returnedEntries) {
              page.window[callback]({ success: true, entries: returnedEntries });
            } else {
              const output = backend.doGet({ parameter: {
                action: url.searchParams.get('action'),
                callback
              } });
              vm.runInContext(`window.${output.text}`, page);
            }
          }
          script.onload();
        }
      }
    }
  };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync('historial.js', 'utf8'), page);
  handlers.DOMContentLoaded();
  return { page, backend, status, list, redirects, requests };
}

for (const token of [null, 'valid-session']) {
  test(`history renders Sheets rows without a logout button (${token ? 'session' : 'no session'})`, async () => {
    const result = createHistoryPage({ token });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].searchParams.get('action'), 'entries');
    assert.deepEqual(result.redirects, []);
    assert.equal(result.status.textContent, '1 entrada cargada (del mes).');
    assert.equal(result.list.children.length, 1);
    const card = result.list.children[0];
    assert.deepEqual(card.children.map(node => node.className || ''), [
      'history-entry-area',
      'history-entry-machine',
      'history-entry-description',
      'history-entry-duration',
      'history-entry-time',
      'history-entry-user',
      'history-entry-role',
      'history-entry-date',
      'history-entry-images'
    ]);
    assert.equal(card.children[0].textContent, 'Taller');
    assert.equal(card.children[1].children[1].textContent, 'Equipo 1');
    assert.equal(card.children[2].textContent, 'Reparación');
    assert.equal(card.children[2].children.length, 0);
    assert.equal(card.children[7].children[1].textContent, '01/01/2026');
    assert.equal(card.children[8].children[0].href, 'https://example.test/imagen');
  });
}

test('image links share the images area when machine and duration are absent', async () => {
  const result = createHistoryPage({ returnedEntries: [{
    area: 'Otro',
    novedad: 'Mantenimiento',
    hora: '08:00',
    usuario: 'Prueba',
    cargo: 'Mecánico',
    fecha: '01/01/2026',
    imagenes: ['https://example.test/1', 'https://example.test/2', 'javascript:alert(1)']
  }] });
  await new Promise(resolve => setImmediate(resolve));

  const card = result.list.children[0];
  assert.equal(card.children[0].className, 'history-entry-area');
  assert.equal(card.children.some(node => node.className === 'history-entry-machine'), false);
  const images = card.children[card.children.length - 1];
  assert.equal(images.className, 'history-entry-images');
  assert.deepEqual(images.children.map(link => link.href), ['https://example.test/1', 'https://example.test/2']);
  assert.deepEqual(images.children.map(link => link.textContent), ['Ver imagen 1', 'Ver imagen 2']);
});

test('entries without valid images do not contain an empty images area', async () => {
  const result = createHistoryPage({ returnedEntries: [{
    area: 'Otro',
    imagenes: ['javascript:alert(1)', 'not a url']
  }] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.list.children[0].children.some(node => node.className === 'history-entry-images'), false);
});

test('history excludes a header returned by an older Apps Script deployment', async () => {
  const result = createHistoryPage({ returnedEntries: [
    { area: 'Area General', maquina: 'Máquina / Equipo', novedad: 'Novedad',
      duracion: 'Duración', fecha: 'Fecha', hora: 'Hora', usuario: 'Responsable', cargo: 'Grupo' },
    { area: 'Área de taller', maquina: 'Equipo 1', novedad: 'Reparación' }
  ] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.status.textContent, '1 entrada cargada (del mes).');
  assert.equal(result.list.children.length, 1);
  assert.equal(result.list.children[0].children[0].textContent, 'Área de taller');
});

test('a header-only response shows the empty history message', async () => {
  const result = createHistoryPage({ returnedEntries: [
    { area: 'Área', maquina: 'Máquina', novedad: 'Novedad' }
  ] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.list.children.length, 0);
  assert.equal(result.status.textContent, 'No hay entradas registradas en la hoja.');
});

test('a real first entry with an area-like title remains visible', async () => {
  const result = createHistoryPage({ returnedEntries: [
    { area: 'Área General', maquina: 'Equipo 1', novedad: 'Reparación' }
  ] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.list.children.length, 1);
  assert.equal(result.list.children[0].children[0].textContent, 'Área General');
});

test('Apps Script keeps a first data row even if its area starts with Área', async () => {
  const result = createHistoryPage({ sheetRows: [
    ['Área General', 'Equipo 1', 'Reparación', '', '', '', '', '', '']
  ] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.list.children.length, 1);
  assert.equal(result.list.children[0].children[0].textContent, 'Área General');
});

test('Apps Script excludes the actual sheet header before returning entries', async () => {
  const result = createHistoryPage({ sheetRows: [
    ['Area General', 'Máquina / Equipo', 'Novedad', 'Duración', 'Fecha', 'Hora', 'Responsable', 'Grupo', 'Imágenes'],
    ['Taller', 'Equipo 1', 'Reparación', '', '', '', '', '', '']
  ] });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result.backend.readEntries().length, 1);
  assert.equal(result.backend.readEntries()[0].area, 'Taller');
  assert.equal(result.status.textContent, '1 entrada cargada (del mes).');
  assert.equal(result.list.children[0].children[0].textContent, 'Taller');
});

test('history reports an outdated Apps Script deployment instead of waiting for a timeout', async () => {
  const result = createHistoryPage({ response: 'old-deployment' });
  await new Promise(resolve => setImmediate(resolve));

  assert.match(result.status.textContent, /Apps Script.*versión actual/);
});

test('history shows a connection message when offline', () => {
  const result = createHistoryPage({ offline: true });

  assert.equal(result.requests.length, 0);
  assert.match(result.status.textContent, /conexión a internet/);
});
