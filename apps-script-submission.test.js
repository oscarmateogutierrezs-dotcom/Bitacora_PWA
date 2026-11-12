const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createBackend() {
    const rows = [];
    const properties = new Map();
    const sheet = {
        getLastRow: () => rows.length,
        getRange: (start, column, count) => ({
            getValues: () => rows.slice(start - 1, start - 1 + count).map(row => [row[column - 1] || ''])
        }),
        appendRow: row => rows.push([...row])
    };
    const backend = {
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null }) },
        SpreadsheetApp: {
            openById: () => ({ getSheetById: () => sheet }),
            flush() {}
        },
        ContentService: {
            MimeType: { JAVASCRIPT: 'javascript', JSON: 'json' },
            createTextOutput: text => ({ text, setMimeType() { return this; } })
        }
    };
    vm.createContext(backend);
    vm.runInContext(fs.readFileSync('..\\apps-script\\Code.gs', 'utf8'), backend);
    return { backend, rows, properties };
}

test('duplicate submissions are identified by their ID in column J', () => {
    const { backend, rows } = createBackend();
    const event = { postData: { contents: JSON.stringify({ submissionId: 'id-1', area: 'Taller', imagenes: [] }) } };
    assert.equal(JSON.parse(backend.doPost(event).text).success, true);
    assert.equal(rows[0][9], 'id-1');
    assert.equal(JSON.parse(backend.doPost(event).text).duplicate, true);
    assert.equal(rows.length, 1);
    const status = backend.doGet({ parameter: { action: 'status', callback: 'cb', submissionId: 'id-1' } }).text;
    assert.equal(JSON.parse(status.slice(3, -2)).processed, true);
});

test('legacy processed IDs remain confirmed without an ID column', () => {
    const { backend, rows, properties } = createBackend();
    properties.set('processed_old-id', '2026-01-01T00:00:00.000Z');
    const event = { postData: { contents: JSON.stringify({ submissionId: 'old-id', imagenes: [] }) } };
    assert.equal(JSON.parse(backend.doPost(event).text).duplicate, true);
    assert.equal(rows.length, 0);
    const status = backend.doGet({ parameter: { action: 'status', callback: 'cb', submissionId: 'old-id' } }).text;
    assert.equal(JSON.parse(status.slice(3, -2)).processed, true);
});

test('a failure after appending the row does not duplicate it on retry', () => {
    const { backend, rows } = createBackend();
    const event = { postData: { contents: JSON.stringify({ submissionId: 'id-2', imagenes: [] }) } };
    backend.SpreadsheetApp.flush = () => { throw new Error('Temporary failure after append'); };
    assert.equal(JSON.parse(backend.doPost(event).text).success, false);
    assert.equal(rows.length, 1);
    backend.SpreadsheetApp.flush = () => {};
    assert.equal(JSON.parse(backend.doPost(event).text).duplicate, true);
    assert.equal(rows.length, 1);
});

test('invalid submission IDs are rejected before writing to the sheet', () => {
    const { backend, rows } = createBackend();
    const event = { postData: { contents: JSON.stringify({ submissionId: 'not valid!' }) } };
    assert.equal(JSON.parse(backend.doPost(event).text).success, false);
    assert.equal(rows.length, 0);
});
