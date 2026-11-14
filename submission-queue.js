(function () {
    const endpointUrl = 'https://script.google.com/macros/s/AKfycbyQY8718j74saEvYXbQ0DEMcxGX6s8It__NYVh5viXQZ8Qx_EWKrTvXXlH1lSsnFH211g/exec';
    const retryDelay = 15000;
    let running = false;
    let timer;

    function pendingEntries() {
        return readEntriesStrict().filter(entry =>
            entry.submissionId && entry.sendStatus && entry.sendStatus !== 'confirmed'
        );
    }

    function publish() {
        window.dispatchEvent(new Event('bitacora-queue-change'));
    }

    function requestStatus(submissionId) {
        return new Promise((resolve, reject) => {
            const callback = `__bitacoraStatus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const script = document.createElement('script');
            const url = new URL(endpointUrl);
            let timeout;
            const cleanup = () => {
                clearTimeout(timeout);
                script.remove();
                delete window[callback];
            };
            window[callback] = result => {
                cleanup();
                if (!result || result.success !== true || typeof result.processed !== 'boolean') {
                    reject(new Error(result?.error || 'La respuesta de estado no es válida.'));
                } else {
                    resolve(result.processed);
                }
            };
            script.onerror = () => {
                cleanup();
                reject(new Error('No se pudo consultar la confirmación del reporte.'));
            };
            script.onload = () => {
                if (window[callback]) {
                    cleanup();
                    reject(new Error('Apps Script no devolvió el estado del reporte.'));
                }
            };
            url.searchParams.set('action', 'status');
            url.searchParams.set('submissionId', submissionId);
            url.searchParams.set('callback', callback);
            url.searchParams.set('_', String(Date.now()));
            script.src = url.toString();
            timeout = setTimeout(() => {
                cleanup();
                reject(new Error('La consulta de estado agotó el tiempo de espera.'));
            }, 20000);
            document.head.append(script);
        });
    }

    async function postEntry(entry) {
        const { sendStatus, localCreatedAt, ...payload } = entry;
        const images = Array.isArray(payload.imagenes)
            ? payload.imagenes
            : (payload.imagen ? [payload.imagen] : []);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ ...payload, imagenes: images, imagen: images[0] || '' }),
                mode: 'no-cors',
                signal: controller.signal
            });
            if (response.type !== 'opaque' && !response.ok) {
                throw new Error(`El servidor respondió con HTTP ${response.status}.`);
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    function confirm(submissionId) {
        const entry = readEntriesStrict().find(item => item.submissionId === submissionId);
        if (entry && entry.sendStatus !== 'confirmed' && !saveEntry({ ...entry, sendStatus: 'confirmed' })) {
            throw new Error('No se pudo guardar la confirmación en este dispositivo.');
        }
    }

    async function processEntry(entry) {
        try {
            if (await requestStatus(entry.submissionId)) {
                confirm(entry.submissionId);
                return;
            }
        } catch (error) {
            console.warn('No se pudo verificar el reporte antes del envío:', error);
        }
        if (isOffline()) return;

        try {
            await postEntry(entry);
        } catch (error) {
            console.warn('El envío no fue confirmado; se volverá a intentar:', error);
        }
        if (isOffline()) return;

        if (await requestStatus(entry.submissionId)) {
            confirm(entry.submissionId);
        }
    }

    async function run() {
        clearTimeout(timer);
        if (running) return;
        running = true;
        try {
            publish();
            if (!isOffline()) {
                for (const entry of pendingEntries()) {
                    if (isOffline()) break;
                    try {
                        await processEntry(entry);
                    } catch (error) {
                        console.error('Error al procesar el reporte pendiente:', error);
                    }
                    publish();
                }
            }
        } catch (error) {
            console.error('Error de la cola de envíos:', error);
        } finally {
            running = false;
            publish();
            timer = setTimeout(run, retryDelay);
        }
    }

    window.BitacoraQueue = { run };
    window.addEventListener('online', run);
    window.addEventListener('offline', publish);
    window.addEventListener('storage', run);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') run();
    });
    window.addEventListener('DOMContentLoaded', run);
})();
