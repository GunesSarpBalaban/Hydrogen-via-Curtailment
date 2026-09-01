// ======================================================
// Live UK Grid Widget
// ======================================================
//
// Compact left-column panel showing GB-wide live generation mix (in
// GW, by fuel type) and a total generation figure used as a demand
// proxy. Sourced directly from NESO's own CKAN Data Portal — NOT
// NESO's Carbon Intensity API (that one is confirmed percentage-only,
// no MW/GW anywhere, verified via a direct live fetch) and NOT a
// third party (per explicit request).
//
// Data source: "Historic GB Generation Mix" dataset —
// https://www.neso.energy/data-portal/historic-generation-mix/historic_gb_generation_mix
// Despite the "historic" name, NESO's own page states it covers
// "the 1st of Jan 2009 through to today," so the latest record
// (sorted by DATETIME desc) is used as the live snapshot.
//
// ⚠️ TWO THINGS THIS FILE CANNOT FULLY VERIFY FROM DEV TOOLING ⚠️
// 1. CORS: NESO's own docs show jQuery AJAX/JSONP examples for
//    browser consumption, which is a good sign, but this has not
//    been confirmed with a real live browser call. If the fetch
//    below fails with a CORS/network error in the browser console,
//    that confirms it's blocked and a small server-side proxy would
//    be needed instead of calling api.neso.energy directly from the
//    client.
// 2. Units: NESO's field docs state "Data points are either MW or %"
//    for this dataset — the code below trusts that and divides by
//    1000 for GW display. If the live numbers look off by 1000x
//    once this actually runs, flip UNIT_IS_MW below to false.
//
// Wrapped in an IIFE with a load-guard, matching this codebase's
// other scripts.

(function () {

    if (window.__liveGridWidgetLoaded) {
        console.log("liveGridWidget.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__liveGridWidgetLoaded = true;


    // ==========================================
    // Settings
    // ==========================================
    const RESOURCE_ID = "f93d1835-75bc-43e5-84ad-12472b180a98";
    const API_URL = `https://api.neso.energy/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&sort=DATETIME desc&limit=1`;
    const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — safe default until real update cadence is confirmed live

    const UNIT_IS_MW = true; // per NESO's field docs; divides by 1000 for GW display — flip if live numbers look 1000x off

    // Fixed colors, consistent with the app's existing FUEL_COLORS
    // palette in dataManager.js (kept as a local copy here rather
    // than shared, matching this codebase's existing pattern of
    // small local duplications — see hydrogenFacilities.js's own note
    // on this).
    const FUEL_GROUP_COLORS = {
        Gas: "#8c8c8c",
        Coal: "#262626",
        Nuclear: "#722ed1",
        Wind: "#13c2c2",
        Hydro: "#1890ff",
        Solar: "#fadb14",
        Biomass: "#52c41a",
        Imports: "#fa8c16",
        Storage: "#eb2f96",
        Other: "#d9d9d9"
    };


    // ==========================================
    // Fetch latest snapshot
    // ==========================================
    async function fetchLatestSnapshot() {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`NESO Data Portal request failed: ${response.status}`);

        const json = await response.json();
        if (!json.success || !json.result || !json.result.records || !json.result.records.length) {
            throw new Error("Unexpected response shape from NESO Data Portal (no records).");
        }

        return json.result.records[0];
    }


    // ==========================================
    // Build display data from a raw record
    // ==========================================
    function buildDisplayData(record) {
        const toDisplayUnit = (v) => {
            const n = Number(v) || 0;
            return UNIT_IS_MW ? n / 1000 : n;
        };

        const fuels = {
            Gas: toDisplayUnit(record.GAS),
            Coal: toDisplayUnit(record.COAL),
            Nuclear: toDisplayUnit(record.NUCLEAR),
            Wind: toDisplayUnit(record.WIND) + toDisplayUnit(record.WIND_EMB), // transmission + embedded wind combined
            Hydro: toDisplayUnit(record.HYDRO),
            Solar: toDisplayUnit(record.SOLAR),
            Biomass: toDisplayUnit(record.BIOMASS),
            Imports: toDisplayUnit(record.IMPORTS),
            Storage: toDisplayUnit(record.STORAGE),
            Other: toDisplayUnit(record.OTHER)
        };

        // GENERATION is NESO's own pre-summed total across all the
        // fields above — used here as a real, data-derived stand-in
        // for "demand" (supply = demand at each instant, modulo
        // transmission losses), NOT an officially-named demand metric.
        // Labelled accordingly in the UI rather than claiming it's
        // literally "Demand."
        const generationTotal = record.GENERATION != null
            ? toDisplayUnit(record.GENERATION)
            : Object.values(fuels).reduce((sum, v) => sum + v, 0);

        return {
            datetime: record.DATETIME,
            fuels,
            generationTotal
        };
    }


    // ==========================================
    // Render
    // ==========================================
    let chartInstance = null;

    function renderWidget(display) {
        const container = document.getElementById("liveGridWidgetContent");
        if (!container) return;

        const time = display.datetime ? new Date(display.datetime) : null;
        const timeStr = time && !isNaN(time.getTime())
            ? time.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : "Time unavailable";

        const labels = [];
        const values = [];
        const colors = [];
        Object.entries(display.fuels).forEach(([name, value]) => {
            if (value <= 0) return;
            labels.push(name);
            values.push(Number(value.toFixed(2)));
            colors.push(FUEL_GROUP_COLORS[name] || FUEL_GROUP_COLORS.Other);
        });

        container.innerHTML = `
            <h4>Live GB Grid</h4>
            <div class="grid-widget-top-row">
                <span class="grid-widget-figure">
                    <strong>${display.generationTotal.toFixed(1)}</strong> GW
                    <span class="grid-widget-figure-label">Generation (≈ demand)</span>
                </span>
            </div>
            <p class="grid-widget-timestamp">Data as of ${timeStr}</p>
            <div class="grid-widget-body">
                <div class="grid-widget-chart-wrap">
                    <canvas id="liveGridWidgetChart"></canvas>
                </div>
                <div class="grid-widget-legend">
                    ${labels.map((name, i) => `
                        <div class="grid-widget-legend-row">
                            <span class="grid-widget-legend-swatch" style="background:${colors[i]};"></span>
                            <span class="grid-widget-legend-name">${name}</span>
                            <span class="grid-widget-legend-value">${values[i].toFixed(1)} GW</span>
                        </div>
                    `).join("")}
                </div>
            </div>
            <p class="grid-widget-caveat">Excludes most embedded solar/wind not metered nationally; figures are the latest available NESO snapshot, not guaranteed second-by-second live.</p>
        `;

        if (typeof Chart === "undefined") return;

        const ctx = document.getElementById("liveGridWidgetChart");
        if (!ctx) return;

        if (chartInstance) chartInstance.destroy();

        chartInstance = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: "#fff",
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "60%",
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.raw} GW`
                        }
                    }
                }
            }
        });
    }

    function renderError(message) {
        const container = document.getElementById("liveGridWidgetContent");
        if (!container) return;
        container.innerHTML = `
            <h4>Live GB Grid</h4>
            <p class="grid-widget-error">${message}</p>
        `;
    }


    // ==========================================
    // Load + poll
    // ==========================================
    async function refreshWidget() {
        try {
            const record = await fetchLatestSnapshot();
            const display = buildDisplayData(record);
            renderWidget(display);
        } catch (error) {
            console.error("Live grid widget error:", error);
            renderError("Live grid data temporarily unavailable.");
        }
    }

    function initLiveGridWidget() {
        const initial = refreshWidget();
        setInterval(refreshWidget, POLL_INTERVAL_MS);
        return initial;
    }


    // ==========================================
    // Expose
    // ==========================================
    window.initLiveGridWidget = initLiveGridWidget;

})();