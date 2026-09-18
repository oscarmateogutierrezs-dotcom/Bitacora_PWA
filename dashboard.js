if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered!', reg))
            .then(() => requestPrecacheStatus(navigator.serviceWorker))
            .catch(err => {
                console.log('Service Worker registration failed: ', err);
                showServiceWorkerError(err);
            });
        navigator.serviceWorker.addEventListener('message', (event) => {
            handlePrecacheStatus(event);
        });
    });
}
// Validar la sesión de forma más estricta
const token = getSessionToken();
let sessionData = null;

if (!token) {
    // Si no hay token, fuera de aquí
    window.location.href = 'login.html';    
} else {
    try {
        sessionData = parseSessionToken(token);
        if (isOffline()) {
            window.location.href = 'login.html';
        }
    } catch (e) {
        // Si el usuario inventó el token en la consola, el atob() fallará o no tendrá la firma
        clearSessionToken();
            window.location.href = 'login.html';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (!SESSION_APIS_SUPPORTED) {
        document.querySelector('.container').hidden = true;
        disableUnsupportedControls(document);
        return;
    }

    if (isOffline()) {
        showError('Sin conexión', 'No hay conexión a internet. Cierre la aplicación, conéctese a la red e inténtelo nuevamente.');
        disableUnsupportedControls(document);
        return;
    }

    const GOOGLE_SHEETS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyQY8718j74saEvYXbQ0DEMcxGX6s8It__NYVh5viXQZ8Qx_EWKrTvXXlH1lSsnFH211g/exec';

    if (!sessionData) {
        return;
    }

    const form = document.getElementById('bitacoraForm')
    // save user data to
    const user = sessionData.nombre;
    const cargo = sessionData.cargo;
    const errorAlert = document.getElementById('form-error');
    const errorDesc = document.getElementById('form-error-desc');
    const statusMessage = document.getElementById('form-status');
    const historialContainer = document.getElementById('historialContainer');
    const areaSelect = document.getElementById('area');
    const lineaGroup = document.getElementById('lineaGroup');
    const lineaSelect = document.getElementById('linea');
    const maquinaGroup = document.getElementById('maquinaGroup');
    const maquinaSelect = document.getElementById('maquina');
    const machineOptions = document.getElementById('machineOptions');
    const lubricacionCheck = document.getElementById('lubricacion');
    const duracionGroup = document.getElementById('duracionGroup');
    const duracionHorasInput = document.getElementById('duracionHoras');
    const duracionMinutosInput = document.getElementById('duracionMinutos');
    const submitButton = form.querySelector('button[type="submit"]');
    let isSubmitting = false;
    let activeSubmissionId = null;

    function createSubmissionId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function resetSubmitButton() {
        isSubmitting = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Guardar Reporte';
    }

    // Helper: Show error notification
    function showError(message) {
        errorDesc.innerText = message;
        errorAlert.style.display = 'block';
    }

    // Helper: Hide error notification
    function hideError() {
        errorAlert.style.display = 'none';
        errorDesc.innerText = '';
    }

    function showStatus(message) {
        statusMessage.innerText = message;
        statusMessage.hidden = false;
    }

    function fillSelect(select, options, placeholder) {
        select.innerHTML = '';
        select.append(new Option(placeholder, ''));
        options.forEach(option => select.append(new Option(option, option)));
    }

    function getSelectedMachines() {
        if (lubricacionCheck.checked) {
            return Array.from(machineOptions.querySelectorAll('input:checked'))
                .map(input => input.value);
        }

        return Array.from(maquinaSelect.selectedOptions)
            .map(option => option.value)
            .filter(Boolean);
    }

    function renderMachineOptions(machines) {
        machineOptions.replaceChildren();
        machines.forEach(machine => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = machine.nombreM;
            label.append(input, document.createTextNode(machine.nombreM));
            machineOptions.append(label);
        });
    }

    async function loadAreasAndMachines() {
        try {
            const response = await fetch('areasMaquinas.json');
            if (!response.ok) {
                throw new Error('No se pudo cargar la lista de áreas.');
            }

            const data = await response.json();
            const areas = Array.isArray(data.area) ? data.area : [];
            fillSelect(areaSelect, areas.map(area => area.nombreA), 'Seleccione un área');
            fillSelect(lineaSelect, [], 'Seleccione una línea');
            fillSelect(maquinaSelect, [], 'Seleccione primero un área');
            lineaGroup.hidden = true;
            lineaSelect.required = false;
            maquinaSelect.disabled = true;
            maquinaGroup.hidden = true;
            maquinaSelect.required = false;
            duracionGroup.hidden = true;

            areaSelect.addEventListener('change', () => {
                const selectedArea = areas.find(area => area.nombreA === areaSelect.value);
                const isAreaOnly = selectedArea?.nombreA === 'Taller' || selectedArea?.nombreA === 'Otro' || selectedArea?.nombreA === 'Despacho';
                const lines = selectedArea?.lineas || [];
                const hasLines = lines.length > 0;
                lineaGroup.hidden = !hasLines;
                lineaSelect.required = hasLines;
                fillSelect(lineaSelect, lines.map(linea => linea.nombreL), 'Seleccione una línea');
                const machines = hasLines ? [] : (selectedArea?.maquinas || []);
                fillSelect(maquinaSelect, machines.map(machine => machine.nombreM), 'Seleccione una máquina');
                renderMachineOptions(machines);
                maquinaGroup.hidden = isAreaOnly;
                maquinaSelect.required = !isAreaOnly;
                maquinaSelect.disabled = isAreaOnly || hasLines || machines.length === 0;
                duracionGroup.hidden = isAreaOnly;
                if (isAreaOnly) {
                    maquinaSelect.value = '';
                    duracionHorasInput.value = '';
                    duracionMinutosInput.value = '';
                }
            });

            lineaSelect.addEventListener('change', () => {
                const selectedArea = areas.find(area => area.nombreA === areaSelect.value);
                const selectedLine = selectedArea?.lineas?.find(linea => linea.nombreL === lineaSelect.value);
                const machines = selectedLine?.maquinas || [];
                fillSelect(maquinaSelect, machines.map(machine => machine.nombreM), 'Seleccione una máquina');
                renderMachineOptions(machines);
                maquinaSelect.disabled = machines.length === 0;
                maquinaSelect.required = true;
            });

            lubricacionCheck.addEventListener('change', () => {
                machineOptions.hidden = !lubricacionCheck.checked;
                maquinaSelect.hidden = lubricacionCheck.checked;
                maquinaSelect.required = !lubricacionCheck.checked && !maquinaGroup.hidden;
            });
        } catch (error) {
            showError('No se pudo cargar la lista de áreas y máquinas.');
            areaSelect.disabled = true;
            maquinaSelect.disabled = true;
        }
    }
                
    document.getElementById('welcome-msg').innerText = `Bienvenido, ${user}!`;
    document.getElementById('cargo-display').innerText = `Oficio registrado: ${cargo}`;
    loadAreasAndMachines();

    function updateHistorialDisplay(container, entries) {
        if (!entries || entries.length === 0) {
            container.textContent = 'No hay novedades registradas en este dispositivo todavía.';
            return;
        }

        // Show the most recently stored report first.
        entries.reverse();

        container.replaceChildren();
        entries.forEach(entry => {
            const report = document.createElement('div');
            report.style.borderBottom = '1px solid #e2e8f0';
            report.style.padding = '8px 0';

            const appendField = (label, value) => {
                const labelElement = document.createElement('strong');
                labelElement.textContent = `${label}: `;
                report.append(labelElement, document.createTextNode(value || 'No especificada'));
                report.append(document.createElement('br'));
            };

            const areaDisplay = entry.linea ? `${entry.area} - ${entry.linea}` : entry.area;
            appendField('Área', areaDisplay);
            appendField('Máquina', entry.maquina);
            appendField('Novedad', entry.novedad);
            appendField('Duración', entry.duracion);
            appendField('Fecha', entry.fecha);
            appendField('Hora', entry.hora);
            appendField('Usuario', entry.usuario);
            appendField('Cargo', entry.cargo);
            container.append(report);
        });
    }

    async function sendEntryToGoogleSheets(entry) {
        const payload = JSON.stringify(entry);

        if (navigator.sendBeacon) {
            const queued = navigator.sendBeacon(
                GOOGLE_SHEETS_WEB_APP_URL,
                new Blob([payload], { type: 'text/plain;charset=utf-8' })
            );

            if (queued) {
                return {
                    transportComplete: true,
                    confirmed: false,
                    background: true
                };
            }
        }

        const request = fetch(GOOGLE_SHEETS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: payload,
            mode: 'no-cors',
            keepalive: true
        }).then(response => ({
            confirmed: response.type !== 'opaque' && response.ok,
            transportComplete: response.type === 'opaque' || response.ok
        }));
        const timeout = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Tiempo de espera agotado')), 10000);
        });

        return Promise.race([request, timeout]);
    }

    updateHistorialDisplay(historialContainer, getEntries());

    // Log Out button logic
    document.getElementById('logoutBtn').addEventListener('click', () => {
        // CORREGIDO: Eliminamos los datos reales de sesión actuales
        if (!clearSessionToken()) {
            window.alert('No se pudo cerrar la sesión en este navegador.');
            return;
        }

        deleteAllEntries(); // Clear local entries on logout

        window.location.href ="login.html";

    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (isSubmitting) {
            return;
        }

        if (isOffline()) {
            showError('Sin conexión, No se puede enviar la novedad porque no hay conexión a internet.');
            return;
        }

        hideError()
        statusMessage.hidden = true;
        const area = document.getElementById('area').value.trim(); //extract machine from the task
        const linea = document.getElementById('linea').value.trim();
        const selectedMachines = getSelectedMachines();
        const maquina = selectedMachines.join(', ');
        const novedad =  document.getElementById('novedad').value.trim(); //extract the description
        const duracionHoras = document.getElementById('duracionHoras').value.trim();
        const duracionMinutos = document.getElementById('duracionMinutos').value.trim();
        const formatDurationPart = (value, unit) => {
            if (!value) {
                return '';
            }

            return `${value} ${unit}${value === '1' ? '' : 's'}`;
        };
        const duracion = [
            formatDurationPart(duracionHoras, 'hora'),
            formatDurationPart(duracionMinutos, 'minuto')
        ].filter(Boolean).join(' y ');
        const fecha = new Date().toLocaleDateString(); //extract the current date and time
        const hora = new Date().toLocaleTimeString(); //extract the current time

        if (![duracionHoras, duracionMinutos].every(value => value === '' || /^\d+$/.test(value))) {
            showError("La duración solo puede contener números");
            const inputs = [
                document.getElementById('duracionHoras'),
                document.getElementById('duracionMinutos')
            ];
            inputs.forEach(input => input.classList.add('input-error'));
            setTimeout(() => {
                inputs.forEach(input => input.classList.remove('input-error'));
            }, 1000);
            return;
        }
                
        if (area === ""){
            showError("Especifique el nombre del área afectada")
            const input = document.getElementById('area')
            input.classList.add('input-error');
            setTimeout(() => {
                input.classList.remove('input-error');
            }, 1000);
            return;
        }

        if (lineaSelect.required && linea === ""){
            showError("Seleccione la línea de Extrusion");
            lineaSelect.classList.add('input-error');
            setTimeout(() => {
                lineaSelect.classList.remove('input-error');
            }, 1000);
            return;
        }

        if (!maquinaGroup.hidden && selectedMachines.length === 0){
            showError("Especifique la máquina afectada");
            maquinaSelect.classList.add('input-error');
            setTimeout(() => {
                maquinaSelect.classList.remove('input-error');
            }, 1000);
            return;
        }

        if (novedad === ""){
            showError("Especifique la novedad realizada")
            const input = document.getElementById('novedad')
            input.classList.add('input-error');
            setTimeout(() => {
                input.classList.remove('input-error');
            }, 1000);
            return;
        }

        if (!duracionGroup.hidden && duracionHoras === "" && duracionMinutos === ""){
            showError("Ingrese las horas, los minutos o ambos para la duración")
            const inputs = [
                document.getElementById('duracionHoras'),
                document.getElementById('duracionMinutos')
            ];
            inputs.forEach(input => input.classList.add('input-error'));
            setTimeout(() => {
                inputs.forEach(input => input.classList.remove('input-error'));
            }, 1000);
            return;
        }

        if (!duracionGroup.hidden && (parseInt(duracionHoras || '0') === 0 && parseInt(duracionMinutos || '0') === 0)) {
            showError("La duración no puede ser cero horas y cero minutos");
            const inputs = [
                document.getElementById('duracionHoras'),
                document.getElementById('duracionMinutos')
            ];
            inputs.forEach(input => input.classList.add('input-error'));
            setTimeout(() => {
                inputs.forEach(input => input.classList.remove('input-error'));
            }, 1000);
            return;
        }

        activeSubmissionId = activeSubmissionId || createSubmissionId();
        const newEntry = {
            submissionId: activeSubmissionId,
            area: linea ? `${area} - ${linea}` : area,
            maquina,
            novedad,
            duracion,
            duracionHoras,
            duracionMinutos,
            fecha,
            hora,
            usuario: user,
            cargo
        };

        isSubmitting = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';

        let result;
        try {
            result = await sendEntryToGoogleSheets(newEntry);
            if (!result.transportComplete) {
                throw new Error('Google Sheets rechazó el reporte.');
            }
        } catch {
            showError('No se pudo completar el envío. El reporte no se marcó como guardado; puedes reintentarlo.');
            resetSubmitButton();
            return;
        }

        if (!saveEntry(newEntry)) {
            showError("Google Sheets recibió la solicitud, pero no se pudo guardar el historial local.");
            resetSubmitButton();
            return;
        }

        // Update the historial display
        updateHistorialDisplay(historialContainer, getEntries());

        // Clear form fields after successful submission
        form.reset();
        lubricacionCheck.dispatchEvent(new Event('change'));
        areaSelect.dispatchEvent(new Event('change'));
        showStatus(result.background
            ? 'Solicitud enviada en segundo plano. Confirma la fila en Google Sheets.'
            : (result.confirmed
                ? 'Google Sheets confirmó el reporte.'
                : 'Solicitud enviada. Google Sheets no permite leer la confirmación desde este navegador.'));
        activeSubmissionId = null;
        resetSubmitButton();
    })
});