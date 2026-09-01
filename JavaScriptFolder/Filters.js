// ======================================================
// Map Filter Panel
// ======================================================
//
// A left-side panel of on/off filters for map symbol layers. Right
// now only "City Labels" actually controls anything (wired to
// cities.js's setNationalCitiesVisible). Hydrogen/Wind are
// placeholders — they track on/off state and update their dot, but
// have no real map layer to control yet.
//
// TO ADD A REAL LAYER LATER: call registerFilter(key, label, {
//     defaultOn: false,
//     onToggle: (isOn) => { ...show/hide your Leaflet layer... }
// }) — no changes needed here. See initDefaultFilters() below for
// the exact pattern used for City Labels.

(function () {

    if (window.__filtersLoaded) return;
    window.__filtersLoaded = true;


    const filters = {}; // key -> { label, on, onToggle }


    // ==========================================
    // Render
    // ==========================================
    function renderFilterPanel() {
        const list = document.getElementById("filterPanelList");
        if (!list) return;

        list.innerHTML = "";
        Object.entries(filters).forEach(([key, filter]) => {
            const row = document.createElement("div");
            row.className = "filter-row";
            row.setAttribute("data-filter-key", key);
            row.innerHTML = `
                <span class="filter-label">${filter.label}</span>
                <span class="filter-dot ${filter.on ? "on" : "off"}"></span>
            `;
            row.addEventListener("click", () => toggleFilter(key));
            list.appendChild(row);
        });
    }


    // ==========================================
    // Toggle
    // ==========================================
    function toggleFilter(key) {
        const filter = filters[key];
        if (!filter) return;

        filter.on = !filter.on;

        if (typeof filter.onToggle === "function") {
            filter.onToggle(filter.on);
        }

        renderFilterPanel();
    }


    // ==========================================
    // Query filter state
    // ==========================================
    // Lets layer scripts (cities.js, hydrogenFacilities.js,
    // windTurbines.js) check a filter's current state directly rather
    // than remembering their own snapshot of it — important once a
    // filter can be toggled while a region is open, since a
    // remembered snapshot goes stale the moment that happens.
    function isFilterOn(key) {
        return !!(filters[key] && filters[key].on);
    }


    // ==========================================
    // Register a new filter (used for future symbol layers)
    // ==========================================
    function registerFilter(key, label, options = {}) {
        filters[key] = {
            label,
            on: !!options.defaultOn,
            onToggle: typeof options.onToggle === "function" ? options.onToggle : null
        };

        // Fire once at registration so the layer's initial visibility
        // matches its starting dot state.
        if (filters[key].onToggle) {
            filters[key].onToggle(filters[key].on);
        }

        renderFilterPanel();
    }


    // ==========================================
    // Default filters
    // ==========================================
    function initDefaultFilters() {
        registerFilter("cities", "City Labels", {
            defaultOn: false,
            onToggle: (isOn) => {
                if (typeof setNationalCitiesVisible === "function") {
                    setNationalCitiesVisible(isOn);
                }
            }
        });

        // Placeholders — no real map layer yet. Replace the onToggle
        // (or just add one) once a wind turbine / hydrogen facility
        // symbol layer exists.
        registerFilter("hydrogen", "Hydrogen Facilities", { defaultOn: false });
        registerFilter("wind", "Wind Turbines", { defaultOn: false });
    }


    window.registerFilter = registerFilter;
    window.toggleFilter = toggleFilter;
    window.isFilterOn = isFilterOn;

    // Script loads at the bottom of the page, after the DOM has
    // already been parsed — no need to wait for DOMContentLoaded.
    initDefaultFilters();

})();