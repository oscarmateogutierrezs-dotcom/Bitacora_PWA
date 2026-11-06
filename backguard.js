// Evita que "atrás" cierre la app (app pinning). Chrome solo respeta entradas
// de historial creadas durante un gesto del usuario, por eso se añaden en cada toque.
(function () {
    let entries = 0;
    function addEntry() {
        if (entries < 5) {
            history.pushState({ guard: true }, '', location.href);
            entries++;
        }
    }
    ['pointerup', 'touchend', 'click', 'keydown'].forEach((evt) =>
        window.addEventListener(evt, addEntry, { passive: true })
    );
    addEntry();
    window.addEventListener('popstate', () => {
        entries = Math.max(0, entries - 1);
        if (entries === 0) {
            history.pushState({ guard: true }, '', location.href);
            entries = 1;
        }
    });
})();
