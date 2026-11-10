const token = getSessionToken();
let hasValidSession = false;

if (!token) {
    window.location.replace('login.html');
} else {
    try {
        parseSessionToken(token);
        hasValidSession = true;
        if (isOffline()) {
            window.location.replace('login.html');
        }
    } catch {
        clearSessionToken();
        window.location.replace('login.html');
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => requestPrecacheStatus(navigator.serviceWorker))
            .catch(error => {
                console.error('Service Worker registration failed:', error);
                showServiceWorkerError(error);
            });
        navigator.serviceWorker.addEventListener('message', handlePrecacheStatus);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const historyList = document.getElementById('history-list');
    const status = document.getElementById('history-status');

    function showHistoryMessage(message, isError = false) {
        status.textContent = message;
        status.classList.toggle('history-error', isError);
    }

    if (!hasValidSession) {
        return;
    }

    if (!SESSION_APIS_SUPPORTED) {
        disableUnsupportedControls(document);
        return;
    }

    if (isOffline()) {
        showHistoryMessage('Se necesita conexión a internet para consultar el historial.');
        return;
    }

    const GOOGLE_SHEETS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyQY8718j74saEvYXbQ0DEMcxGX6s8It__NYVh5viXQZ8Qx_EWKrTvXXlH1lSsnFH211g/exec';

    function appendField(container, label, value) {
        if (!value) {
            return;
        }

        const field = document.createElement('p');
        const name = document.createElement('strong');
        name.textContent = `${label}: `;
        field.append(name, document.createTextNode(value));
        container.append(field);
    }

    function renderEntries(entries) {
        if (entries.length === 0) {
            historyList.replaceChildren();
            showHistoryMessage('No hay entradas registradas en la hoja.');
            return;
        }

        const fragment = document.createDocumentFragment();
        entries.slice().reverse().forEach(entry => {
            const card = document.createElement('article');
            card.className = 'history-entry';
            const heading = document.createElement('h3');
            heading.textContent = entry.area || 'Novedad sin área';
            card.append(heading);
            appendField(card, 'Máquina', entry.maquina);
            appendField(card, 'Novedad', entry.novedad);
            appendField(card, 'Duración', entry.duracion);
            appendField(card, 'Fecha', entry.fecha);
            appendField(card, 'Hora', entry.hora);
            appendField(card, 'Usuario', entry.usuario);
            appendField(card, 'Cargo', entry.cargo);

            (Array.isArray(entry.imagenes) ? entry.imagenes : []).forEach((url, index) => {
                let imageUrl;
                try {
                    imageUrl = new URL(url);
                } catch {
                    return;
                }

                if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') {
                    return;
                }

                const link = document.createElement('a');
                link.href = imageUrl.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = `Ver imagen ${index + 1}`;
                link.className = 'history-image-link';
                card.append(link);
            });

            fragment.append(card);
        });

        historyList.replaceChildren(fragment);
        showHistoryMessage(`${entries.length} ${entries.length === 1 ? 'entrada cargada' : 'entradas cargadas'}.`);
    }

    function requestEntries(timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            const callbackName = `__bitacoraEntries_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const script = document.createElement('script');
            const endpoint = new URL(GOOGLE_SHEETS_WEB_APP_URL);
            let timeoutId;

            const cleanup = () => {
                clearTimeout(timeoutId);
                script.remove();
                delete window[callbackName];
            };

            window[callbackName] = result => {
                cleanup();
                if (!result || !result.success || !Array.isArray(result.entries)) {
                    reject(new Error(result?.error || 'La respuesta del historial no es válida.'));
                    return;
                }
                resolve(result.entries);
            };
            script.onerror = () => {
                cleanup();
                reject(new Error('No se pudo conectar con la hoja de cálculo.'));
            };
            endpoint.searchParams.set('action', 'entries');
            endpoint.searchParams.set('callback', callbackName);
            endpoint.searchParams.set('_', Date.now().toString());
            script.src = endpoint.toString();
            timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('La consulta del historial agotó el tiempo de espera.'));
            }, timeoutMs);
            document.head.append(script);
        });
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (!clearSessionToken()) {
            window.alert('No se pudo cerrar la sesión en este navegador.');
            return;
        }
        deleteAllEntries();
        window.location.replace('login.html');
    });

    requestEntries()
        .then(renderEntries)
        .catch(error => {
            console.error('No se pudo cargar el historial:', error);
            showHistoryMessage(error.message, true);
        });
});
