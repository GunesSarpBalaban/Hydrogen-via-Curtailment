// ======================================================
// Hydrogen Facilities Legend
// ======================================================
//
// A small static panel explaining what each colored hydrogen
// facility marker represents. Built from HYDROGEN_CATEGORIES, which
// hydrogenFacilities.js exposes on window — kept as the single source
// of truth for category labels/colors rather than duplicating that
// list here, so the legend can't silently drift out of sync with the
// actual markers.
//
// Wrapped in an IIFE with a load-guard, matching the rest of this
// codebase's scripts.

(function () {

    if (window.__hydrogenLegendLoaded) {
        console.log("hydrogenLegend.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__hydrogenLegendLoaded = true;


    function renderHydrogenLegend() {
        const container = document.getElementById("hydrogenLegendContent");
        if (!container) return;

        if (!window.HYDROGEN_CATEGORIES) {
            console.log("HYDROGEN_CATEGORIES not available yet — is hydrogenFacilities.js loaded before this script?");
            return;
        }

        let html = `<h4>Hydrogen Facilities</h4>`;

        Object.values(window.HYDROGEN_CATEGORIES).forEach((cat) => {
            html += `
                <div class="legend-row">
                    <span class="legend-swatch" style="background:${cat.color};"></span>
                    <span class="legend-label">${cat.label}</span>
                </div>
            `;
        });

        container.innerHTML = html;
    }


    window.renderHydrogenLegend = renderHydrogenLegend;

    // Script loads at the bottom of the page, after the DOM has
    // already been parsed, and after hydrogenFacilities.js (which
    // sets HYDROGEN_CATEGORIES) — no need to wait for anything.
    renderHydrogenLegend();

})();