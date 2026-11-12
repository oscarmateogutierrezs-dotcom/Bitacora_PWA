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
    const imagenInput = document.getElementById('imagen');
    const camaraInput = document.getElementById('camara');
    const imagenAyuda = document.getElementById('imagenAyuda');
    const imagenVistaPrevia = document.getElementById('imagenVistaPrevia');
    const submitButton = form.querySelector('button[type="submit"]');
    let isSubmitting = false;
    let activeSubmissionId = null;
    const selectedImages = [];
    let imageCompressionQueue = Promise.resolve();
    let submitErrorTimeout = null;

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
        submitButton.classList.remove('is-saving');
        imagenInput.disabled = false;
        camaraInput.disabled = false;
        renderImagePreviews();
    }

    // Helper: Show error notification
    function showError(message) {
        errorDesc.innerText = message;
        errorAlert.style.display = 'block';
        clearTimeout(submitErrorTimeout);
        submitButton.classList.remove('input-error');
        void submitButton.offsetWidth;
        submitButton.classList.add('input-error');
        submitErrorTimeout = setTimeout(() => {
            submitButton.classList.remove('input-error');
        }, 1000);
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

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const imageUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(imageUrl);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(imageUrl);
                reject(new Error('El formato de la imagen no es compatible. Pruebe con una foto JPEG o PNG.'));
            };
            image.src = imageUrl;
        });
    }

    async function compressImage(image, {
        maxDataLength = 85000,
        maxDimension = 1280,
        minDimension = 200,
        qualities = [0.75, 0.6, 0.45, 0.3]
    } = {}) {
        function canvasToBlob(canvas, quality) {
            return new Promise((resolve, reject) => {
                canvas.toBlob(blob => {
                    if (!blob) {
                        reject(new Error('No se pudo procesar la imagen. Pruebe con otra foto.'));
                        return;
                    }

                    resolve(blob);
                }, 'image/jpeg', quality);
            });
        }

        function blobToDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('No se pudo procesar la imagen. Pruebe con otra foto.'));
                reader.readAsDataURL(blob);
            });
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('El navegador no pudo preparar la imagen.');
        }

        try {
            for (let dimension = maxDimension; dimension >= minDimension; dimension = Math.floor(dimension * 0.8)) {
                const scale = Math.min(1, dimension / Math.max(image.width, image.height));
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                context.drawImage(image, 0, 0, canvas.width, canvas.height);

                for (const quality of qualities) {
                    const blob = await canvasToBlob(canvas, quality);
                    const dataUrlLength = 'data:image/jpeg;base64,'.length + 4 * Math.ceil(blob.size / 3);
                    if (dataUrlLength <= maxDataLength) {
                        return await blobToDataUrl(blob);
                    }
                }
            }
        } catch {
            throw new Error('No se pudo procesar la imagen. Pruebe con otra foto.');
        }

        throw new Error('La imagen no se pudo reducir lo suficiente. Pruebe con otra foto.');
    }

    function handleImageSelection(event) {
        const files = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = '';
        if (files.length === 0) {
            return;
        }

        const validFiles = files.filter(file => file.type.startsWith('image/'));
        if (validFiles.length !== files.length) {
            showError('Solo se pueden adjuntar archivos de imagen.');
        }

        validFiles.forEach(file => {
            const selectedImage = {
                previewUrl: URL.createObjectURL(file),
                compression: null
            };
            selectedImage.compression = imageCompressionQueue
                .then(() => loadImage(file))
                .then(image => compressImage(image))
                .then(reportImage => ({ reportImage }), error => ({ error }));
            imageCompressionQueue = selectedImage.compression.then(() => undefined, () => undefined);
            selectedImages.push(selectedImage);
        });

        renderImagePreviews();
    }

    function renderImagePreviews() {
        const fragment = document.createDocumentFragment();
        selectedImages.forEach((selectedImage, index) => {
            const item = document.createElement('div');
            item.className = 'image-preview-item';

            const image = document.createElement('img');
            image.src = selectedImage.previewUrl;
            image.alt = `Vista previa de la imagen ${index + 1}`;
            image.className = 'image-preview';

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'image-remove';
            removeButton.textContent = '×';
            removeButton.setAttribute('aria-label', `Quitar imagen ${index + 1}`);
            removeButton.title = `Quitar imagen ${index + 1}`;
            removeButton.disabled = isSubmitting;
            removeButton.addEventListener('click', () => {
                URL.revokeObjectURL(selectedImage.previewUrl);
                selectedImages.splice(selectedImages.indexOf(selectedImage), 1);
                renderImagePreviews();
            });

            item.append(image, removeButton);
            fragment.append(item);
        });

        imagenVistaPrevia.replaceChildren(fragment);
        imagenVistaPrevia.hidden = selectedImages.length === 0;
        imagenAyuda.textContent = selectedImages.length
            ? `${selectedImages.length} ${selectedImages.length === 1 ? 'imagen seleccionada' : 'imágenes seleccionadas'}. Puede agregar más antes de guardar.`
            : 'Puede adjuntar varias imágenes como evidencia del reporte.';
    }

    function clearSelectedImages() {
        selectedImages.forEach(selectedImage => URL.revokeObjectURL(selectedImage.previewUrl));
        selectedImages.length = 0;
        renderImagePreviews();
    }

    imagenInput.addEventListener('change', handleImageSelection);
    camaraInput.addEventListener('change', handleImageSelection);

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
                const isAreaOnly = selectedArea?.nombreA === 'Taller' || selectedArea?.nombreA === 'Otro' || selectedArea?.nombreA === 'Despacho' || selectedArea?.nombreA === 'Torno';
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

        const fragment = document.createDocumentFragment();
        entries.slice().reverse().forEach(entry => {
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
            if (entry.sendStatus) {
                const statusLabels = {
                    sending: 'Pendiente de envío y confirmación',
                    unknown: 'Sin confirmación; se seguirá intentando',
                    confirmed: 'El reporte fue listado con éxito',
                    failed: 'Pendiente; se seguirá intentando'
                };
                appendField('Estado', statusLabels[entry.sendStatus] || 'Pendiente de verificación');
            }
            const reportImages = Array.isArray(entry.imagenes)
                ? entry.imagenes
                : (entry.imagen ? [entry.imagen] : []);
            reportImages.forEach((imageUrl, index) => {
                const image = document.createElement('img');
                image.src = imageUrl;
                image.alt = `Imagen ${index + 1} adjunta al reporte`;
                image.className = 'image-preview';
                image.loading = 'lazy';
                image.decoding = 'async';
                report.append(image);
            });
            fragment.append(report);
        });
        container.replaceChildren(fragment);
    }

    updateHistorialDisplay(historialContainer, getEntries());
    window.addEventListener('bitacora-queue-change', () => {
        updateHistorialDisplay(historialContainer, getEntries());
    });

    // Log Out button logic
    document.getElementById('logoutBtn').addEventListener('click', () => {
        // CORREGIDO: Eliminamos los datos reales de sesión actuales
        if (!clearSessionToken()) {
            window.alert('No se pudo cerrar la sesión en este navegador.');
            return;
        }

        window.location.href ="login.html";

    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (isSubmitting) {
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

        isSubmitting = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';
        submitButton.classList.add('is-saving');
        imagenInput.disabled = true;
        camaraInput.disabled = true;
        renderImagePreviews();

        const imageCompressionResults = await Promise.all(
            selectedImages.map(selectedImage => selectedImage.compression)
        );
        const failedImage = imageCompressionResults.find(result => result.error);
        if (failedImage) {
            showError(failedImage.error.message);
            resetSubmitButton();
            return;
        }
        const reportImages = imageCompressionResults.map(result => result.reportImage);

        activeSubmissionId = activeSubmissionId || createSubmissionId();
        const newEntry = {
            submissionId: activeSubmissionId,
            area: linea ? `${area} - ${linea}` : area,
            maquina,
            novedad,
            duracion,
            duracionHoras,
            duracionMinutos,
            imagenes: reportImages,
            fecha,
            hora,
            usuario: user,
            cargo
        };

        const localEntry = { ...newEntry, sendStatus: 'sending' };
        const savedEntries = saveEntry(localEntry);
        if (!savedEntries) {
            showError('No se pudo guardar una copia local del reporte; no se inició el envío. Libera espacio e inténtalo de nuevo.');
            resetSubmitButton();
            return;
        }

        form.reset();
        clearSelectedImages();
        lubricacionCheck.dispatchEvent(new Event('change'));
        areaSelect.dispatchEvent(new Event('change'));
        activeSubmissionId = null;
        resetSubmitButton();
        showStatus('Reporte guardado en este dispositivo. Se enviará hasta obtener confirmación.');
        window.BitacoraQueue.run();
        updateHistorialDisplay(historialContainer, savedEntries);
    })
});