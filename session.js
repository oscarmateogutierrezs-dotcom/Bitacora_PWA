const SESSION_APIS_SUPPORTED = typeof TextEncoder !== 'undefined' &&
	typeof TextDecoder !== 'undefined';

function showCompatibilityMessage() {
	if (SESSION_APIS_SUPPORTED || typeof document === 'undefined') {
		return;
	}

	document.addEventListener('DOMContentLoaded', () => {
		const message = document.getElementById('compatibility-error');
		if (message) {
			message.hidden = false;
		}
	});
}

showCompatibilityMessage();

const SESSION_MARKER = 'session_active_2026';
const ENTRIES_STORAGE_KEY = 'bitacora_entries';

function deleteAllEntries() {
	try {
		localStorage.removeItem(ENTRIES_STORAGE_KEY);
	} catch {
		return false;
	}
	return true;
}

function encodeToken(value) {
	if (!SESSION_APIS_SUPPORTED) {
		throw new Error('Este navegador no admite la codificación UTF-8 requerida.');
	}

	const bytes = new TextEncoder().encode(value);
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary);
}

function decodeToken(value) {
	if (!SESSION_APIS_SUPPORTED) {
		throw new Error('Este navegador no admite la decodificación UTF-8 requerida.');
	}

	const binary = atob(value);
	const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseSessionToken(token) {
	const session = JSON.parse(decodeToken(token));

	if (session.marker !== SESSION_MARKER ||
		typeof session.nombre !== 'string' ||
		typeof session.cargo !== 'string' ||
		session.nombre.trim() === '' ||
		session.cargo.trim() === '') {
		throw new Error('Token manipulado o inválido');
	}

	return session;
}

function getSessionToken() {
	try {
		return localStorage.getItem('sessionToken');
	} catch {
		return null;
	}
}

function saveSessionToken(token) {
	try {
		localStorage.setItem('sessionToken', token);
		return true;
	} catch {
		return false;
	}
}

function clearSessionToken() {
	try {
		localStorage.removeItem('sessionToken');
	} catch {
		return false;
	}

	return true;
}

function getEntries() {
	try {
		const entries = JSON.parse(localStorage.getItem(ENTRIES_STORAGE_KEY) || '[]');
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

function saveEntry(entry) {
	try {
		const entries = getEntries();
		entries.push(entry);
		localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries));
		return true;
	} catch {
		return false;
	}
}

function requestPrecacheStatus(serviceWorker, timeout = 3000) {
	return Promise.race([
		serviceWorker.ready,
		new Promise(resolve => setTimeout(() => resolve(null), timeout))
	]).then(registration => registration?.active?.postMessage({
		type: 'GET_PRECACHE_STATUS'
	}));
}

function showServiceWorkerError(documentObject = document) {
	const message = documentObject.getElementById('service-worker-error');
	if (message) {
		message.hidden = false;
	}
}

function handlePrecacheStatus(event, documentObject = document) {
	if (event.data?.type === 'PRECACHE_STATUS' && !event.data.ok) {
		showServiceWorkerError(documentObject);
	}
}

function disableUnsupportedControls(documentObject = document) {
	if (SESSION_APIS_SUPPORTED) {
		return;
	}

	documentObject.querySelectorAll('input, button').forEach((control) => {
		control.disabled = true;
	});
}
