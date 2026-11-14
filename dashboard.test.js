const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createDashboard(entries) {
    const handlers = {};
    const elements = new Map();
    const timers = [];
    const createNode = () => ({
        children: [],
        style: {},
        listeners: {},
        value: '',
        selectedOptions: [],
        classList: {
            values: new Set(),
            add(value) { this.values.add(value); },
            remove(value) { this.values.delete(value); },
            contains(value) { return this.values.has(value); }
        },
        append(...children) { this.children.push(...children); },
        replaceChildren(fragment) { this.children = fragment ? fragment.children : []; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        dispatchEvent(event) { if (this.listeners[event.type]) this.listeners[event.type](event); },
        reset() {},
        querySelector() { return createNode(); }
    });
    const context = {
        navigator: {},
        SESSION_APIS_SUPPORTED: true,
        getSessionToken: () => 'valid',
        parseSessionToken: () => ({ nombre: 'Prueba', cargo: 'Mecánico' }),
        getEntries: () => entries,
        saveEntry: entry => {
            const result = [...entries, entry];
            entries.unshift(entry);
            return result;
        },
        fetch: () => new Promise(() => {}),
        crypto: { randomUUID: () => 'new-report' },
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {},
        window: {
            location: {},
            BitacoraQueue: { run() {} },
            addEventListener(type, handler) { handlers[type] = handler; }
        },
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createNode());
                return elements.get(id);
            },
            createElement: createNode,
            createDocumentFragment: createNode,
            createTextNode: text => ({ textContent: text })
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('dashboard.js', 'utf8'), context);
    handlers.DOMContentLoaded();
    return { handlers, elements, timers, document: context.document, container: elements.get('historialContainer') };
}

function displayedAreas(container) {
    return container.children.map(report => report.children[1].textContent);
}

function entry(id, sendStatus) {
    return { area: `Reporte ${id}`, sendStatus };
}

test('shows at most six recent confirmed reports without modifying stored entries', () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry(i + 1, 'confirmed'));
    const snapshot = JSON.stringify(entries);
    const { container } = createDashboard(entries);
    assert.deepEqual(displayedAreas(container), [
        'Reporte 9', 'Reporte 8', 'Reporte 7', 'Reporte 6', 'Reporte 5', 'Reporte 4'
    ]);
    assert.equal(JSON.stringify(entries), snapshot);
});

test('keeps older unconfirmed reports visible and updates after confirmation', () => {
    const entries = [
        entry(1, 'sending'), entry(2, 'confirmed'), entry(3, 'unknown'),
        entry(4, 'failed'), entry(5), ...Array.from({ length: 6 }, (_, i) => entry(i + 6, 'confirmed'))
    ];
    const { container, handlers } = createDashboard(entries);
    assert.deepEqual(displayedAreas(container), [
        'Reporte 11', 'Reporte 10', 'Reporte 9', 'Reporte 8', 'Reporte 7', 'Reporte 6',
        'Reporte 5', 'Reporte 4', 'Reporte 3', 'Reporte 1'
    ]);
    entries[0].sendStatus = 'confirmed';
    handlers['bitacora-queue-change']();
    assert.deepEqual(displayedAreas(container), [
        'Reporte 11', 'Reporte 10', 'Reporte 9', 'Reporte 8', 'Reporte 7', 'Reporte 6',
        'Reporte 5', 'Reporte 4', 'Reporte 3'
    ]);
    assert.equal(entries.length, 11);
});

test('keeps the newest report visible after confirmation when storage keys are unordered', () => {
    const entries = [
        { ...entry('nuevo', 'sending'), localCreatedAt: 2000 },
        ...Array.from({ length: 6 }, (_, i) => ({
            ...entry(i + 1, 'confirmed'), localCreatedAt: 1000 + i
        }))
    ];
    const { container, handlers } = createDashboard(entries);
    assert.deepEqual(displayedAreas(container), [
        'Reporte nuevo', 'Reporte 6', 'Reporte 5', 'Reporte 4', 'Reporte 3', 'Reporte 2'
    ]);
    entries[0].sendStatus = 'confirmed';
    handlers['bitacora-queue-change']();
    assert.deepEqual(displayedAreas(container), [
        'Reporte nuevo', 'Reporte 6', 'Reporte 5', 'Reporte 4', 'Reporte 3', 'Reporte 2'
    ]);
    assert.equal(entries.length, 7);
    assert.deepEqual(displayedAreas(createDashboard(entries).container), displayedAreas(container));
});

test('places new timestamped reports ahead of older reports without timestamps', () => {
    const entries = [
        { ...entry('nuevo', 'confirmed'), localCreatedAt: 2000 },
        ...Array.from({ length: 6 }, (_, i) => entry(i + 1, 'confirmed'))
    ];
    const { container } = createDashboard(entries);
    assert.deepEqual(displayedAreas(container), [
        'Reporte nuevo', 'Reporte 6', 'Reporte 5', 'Reporte 4', 'Reporte 3', 'Reporte 2'
    ]);
});

test('orders previously saved reports by their local date and time', () => {
    const older = new Date(2026, 0, 10, 11, 0, 0);
    const newer = new Date(2026, 0, 11, 13, 30, 0);
    const datedEntry = (id, date) => ({
        ...entry(id, 'confirmed'), fecha: date.toLocaleDateString(), hora: date.toLocaleTimeString()
    });
    const entries = [
        datedEntry('nuevo', newer),
        ...Array.from({ length: 6 }, (_, i) => datedEntry(i + 1, older))
    ];
    const { container } = createDashboard(entries);
    assert.equal(displayedAreas(container).length, 6);
    assert.equal(displayedAreas(container)[0], 'Reporte nuevo');
    assert.equal(entries.length, 7);
});

test('a submitted report remains visible after a queue refresh and confirmation', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => entry(i + 1, 'confirmed'));
    const { elements, document, handlers, container } = createDashboard(entries);
    elements.get('area').value = 'Nuevo';
    document.getElementById('novedad').value = 'Reparación';
    elements.get('maquinaGroup').hidden = true;
    elements.get('duracionGroup').hidden = true;

    await elements.get('bitacoraForm').listeners.submit({ preventDefault() {} });
    assert.equal(entries.length, 7);
    assert.equal(entries[0].sendStatus, 'sending');
    assert.equal(typeof entries[0].localCreatedAt, 'number');
    assert.equal(displayedAreas(container)[0], 'Nuevo');

    entries[0].sendStatus = 'confirmed';
    handlers['bitacora-queue-change']();
    assert.deepEqual(displayedAreas(container), [
        'Nuevo', 'Reporte 6', 'Reporte 5', 'Reporte 4', 'Reporte 3', 'Reporte 2'
    ]);
});

test('validation preserves error messages and highlights the relevant inputs', async () => {
    const cases = [
        { field: 'duracionHoras', value: 'a', message: 'La duración solo puede contener números', inputs: ['duracionHoras', 'duracionMinutos'] },
        { field: 'area', value: '', message: 'Especifique el nombre del área afectada', inputs: ['area'] },
        { field: 'linea', value: '', lineRequired: true, message: 'Seleccione la línea de Extrusion', inputs: ['linea'] },
        { machineRequired: true, message: 'Especifique la máquina afectada', inputs: ['maquina'] },
        { field: 'novedad', value: '', message: 'Especifique la novedad realizada', inputs: ['novedad'] },
        { field: 'duracionHoras', value: '', durationRequired: true, message: 'Ingrese las horas, los minutos o ambos para la duración', inputs: ['duracionHoras', 'duracionMinutos'] },
        { field: 'duracionHoras', value: '0', durationRequired: true, message: 'La duración no puede ser cero horas y cero minutos', inputs: ['duracionHoras', 'duracionMinutos'] }
    ];

    for (const scenario of cases) {
        const entries = [];
        const { elements, document, timers } = createDashboard(entries);
        document.getElementById('area').value = 'Taller';
        document.getElementById('linea').value = 'Línea 1';
        document.getElementById('novedad').value = 'Reparación';
        document.getElementById('duracionHoras').value = '1';
        elements.get('maquinaGroup').hidden = !scenario.machineRequired;
        elements.get('duracionGroup').hidden = !scenario.durationRequired;
        elements.get('linea').required = !!scenario.lineRequired;
        if (scenario.field) document.getElementById(scenario.field).value = scenario.value;

        await elements.get('bitacoraForm').listeners.submit({ preventDefault() {} });
        assert.equal(elements.get('form-error-desc').innerText, scenario.message);
        assert.equal(entries.length, 0);
        for (const id of scenario.inputs) assert.equal(document.getElementById(id).classList.contains('input-error'), true);
        assert.equal(timers[timers.length - 1].delay, 1000);
        timers[timers.length - 1].callback();
        for (const id of scenario.inputs) assert.equal(document.getElementById(id).classList.contains('input-error'), false);
    }
});

test('shows all reports when fewer than six exist and an empty message otherwise', () => {
    const { container } = createDashboard([entry(1, 'confirmed'), entry(2, 'sending')]);
    assert.deepEqual(displayedAreas(container), ['Reporte 2', 'Reporte 1']);
    const empty = createDashboard([]);
    assert.equal(empty.container.textContent, 'No hay novedades registradas en este dispositivo todavía.');
});
