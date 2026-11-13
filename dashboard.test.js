const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createDashboard(entries) {
    const handlers = {};
    const elements = new Map();
    const createNode = () => ({
        children: [],
        style: {},
        classList: { add() {}, remove() {} },
        append(...children) { this.children.push(...children); },
        replaceChildren(fragment) { this.children = fragment ? fragment.children : []; },
        addEventListener() {},
        querySelector() { return createNode(); }
    });
    const context = {
        navigator: {},
        SESSION_APIS_SUPPORTED: true,
        getSessionToken: () => 'valid',
        parseSessionToken: () => ({ nombre: 'Prueba', cargo: 'Mecánico' }),
        getEntries: () => entries,
        fetch: () => new Promise(() => {}),
        window: {
            location: {},
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
    return { handlers, container: elements.get('historialContainer') };
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

test('shows all reports when fewer than six exist and an empty message otherwise', () => {
    const { container } = createDashboard([entry(1, 'confirmed'), entry(2, 'sending')]);
    assert.deepEqual(displayedAreas(container), ['Reporte 2', 'Reporte 1']);
    const empty = createDashboard([]);
    assert.equal(empty.container.textContent, 'No hay novedades registradas en este dispositivo todavía.');
});
