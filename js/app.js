// ======================================================
// Initial data loads
// ======================================================
// Each loadX()/initX() function returns its own fetch promise (see
// cities.js/hydrogenFacilities.js/windTurbines.js/liveGridWidget.js/
// regions.js), which nothing here actually blocks on anymore — see
// note below on why the full-page loading overlay that used to sit
// here was removed. The map and filter panel become interactive as
// soon as Leaflet itself is ready, without waiting on any of this.

const regionsPromise = loadRegions();
loadCities();
loadHydrogenFacilities();
loadWindTurbines();
initLiveGridWidget();

// Hydrogen production cluster markers — fast, only needs generator
// coordinates (already available from windCurtailment.js) to compute
// cluster locations, not the heavy settlement-period Constrained data.
// Loads alongside the other quick layers, not the heavy prefetch group
// below.
regionsPromise.then(() => {
    if (typeof loadHydrogenProductionMarkers === "function") {
        loadHydrogenProductionMarkers();
    }
});

// NOTE: turbine region resolution is NOT precomputed here anymore. An
// earlier version eagerly resolved all ~178 turbines' regions right
// at page load to fix region-click lag — but that meant every visitor
// paid that cost upfront regardless of whether they ever clicked a
// region, making initial load slower instead of faster. It's now
// handled lazily inside showRegionalTurbines (windTurbines.js):
// resolved once on the first click that actually needs it, cached
// from then on for every click afterward. First click pays the real
// cost if turbines haven't been resolved yet; every click after that
// (for any region) is fast.

// Curtailment prefetch — kicks off once regions are ready, entirely in
// the background. Only daily + monthly (2 requests total) — yearly is
// deliberately NOT prefetched here anymore. It involves up to 9
// separate NESO requests (one per financial year, each a genuinely
// separate database table with no way to combine them into one call),
// and eagerly fetching all of them on every single page load —
// regardless of whether anyone ever looks at the Yearly/Total view —
// was exactly the kind of unnecessary network traffic worth cutting.
// It's now fetched lazily, only when a user actually switches to
// Yearly or Total mode (see ensureYearlyLoaded in dataManager.js),
// and cached from then on.
//
// Not awaited by anything: if a user opens the Curtailment tab before
// this finishes, dataManager.js's existing loadActiveData()/
// renderLoadingState() already handles that (a small loading
// indicator inside that one section, not a page-wide block).
//
// Region resolution (resolveRegionForCoords/resolveRegionForGenerator
// in windCurtailment.js) depends on appState.nationalRegionsLayer
// already being populated — starting this prefetch any earlier would
// resolve every generator to "no region found" and cache that WRONG
// (empty) result for the full cache TTL. Chaining off regionsPromise
// guarantees the region layer is ready first.
//
// getDailyRegionalCurtailment/getMonthlyRegionalCurtailment now
// deduplicate in-flight requests (see windCurtailment.js) — if a user
// opens the Curtailment tab while this background prefetch is still
// running, dataManager.js's own call to these same functions reuses
// this SAME in-flight promise rather than firing a second, fully
// redundant set of requests.
const curtailmentPrefetchPromise = regionsPromise.then(() => {
    const tasks = [];
    if (typeof getDailyRegionalCurtailment === "function") {
        tasks.push(getDailyRegionalCurtailment().catch(err => console.log("Curtailment daily prefetch failed:", err)));
    }
    if (typeof getMonthlyRegionalCurtailment === "function") {
        tasks.push(getMonthlyRegionalCurtailment().catch(err => console.log("Curtailment monthly prefetch failed:", err)));
    }
    return Promise.all(tasks);
});

// Wind capacity prefetch — same reasoning, also entirely in the
// background. getRegionalWindCapacity() already deduplicates in-flight
// calls too (see windCapacity.js's cachePromise), so the same
// no-double-fetch guarantee applies here.
const windCapacityPrefetchPromise = regionsPromise.then(() => {
    if (typeof getRegionalWindCapacity === "function") {
        return getRegionalWindCapacity().catch(err => console.log("Wind capacity prefetch failed:", err));
    }
});

// Hydrogen demand prefetch — lightweight (a small local JSON file plus
// reuse of the already-fetched hydrogen_facilities.geojson data, no
// external network calls at all), so this is cheap enough to prefetch
// eagerly without the same "is this worth it" tradeoff the curtailment
// yearly fetch had. Deduplicates in-flight calls too (see
// hydrogenDemand.js's cachePromise).
const hydrogenDemandPrefetchPromise = regionsPromise.then(() => {
    if (typeof getRegionalHydrogenDemand === "function") {
        return getRegionalHydrogenDemand().catch(err => console.log("Hydrogen demand prefetch failed:", err));
    }
});

// Hydrogen production Theoretical Max prefetch — fast, reuses
// curtailment's own already-cached data rather than needing any new
// fetch (see hydrogenProduction.js's computeTheoreticalProduction).
const hydrogenProductionTheoreticalPromise = regionsPromise.then(() => {
    if (typeof getHydrogenProductionTheoretical === "function") {
        return getHydrogenProductionTheoretical().catch(err => console.log("Hydrogen production (theoretical) prefetch failed:", err));
    }
});

// Hydrogen production Constrained prefetch — the genuinely heavy one
// (settlement-period data across all 9 financial years). By request,
// this now runs automatically rather than waiting for someone to open
// the H2 Production tab — but deliberately sequenced to start only
// AFTER every other background prefetch above has actually finished,
// not alongside them, so it doesn't compete for connections with the
// faster fetches while they're still working. Reasonable to do now
// that Constrained persists to localStorage (see hydrogenProduction.js)
// — a returning visitor within 24 hours skips this fetch entirely,
// so this cost is only paid roughly once a day per browser, not on
// every single page load.
// Exposed for pdfExport.js — the "Print Summary PDF" button stays
// disabled/spinning from page load until this resolves, rather than
// letting someone click it immediately and then wait through a
// generation-time fetch of everything. Covers every background
// prefetch, including the heavy Constrained one.
window.__allDataReadyPromise = Promise.all([
    curtailmentPrefetchPromise,
    windCapacityPrefetchPromise,
    hydrogenDemandPrefetchPromise,
    hydrogenProductionTheoreticalPromise
]).then(() => {
    if (typeof getHydrogenProductionConstrained === "function") {
        return getHydrogenProductionConstrained().catch(err => console.log("Hydrogen production (constrained) prefetch failed:", err));
    }
});


// ======================================================
// (Removed) Initial loading overlay
// ======================================================
// A full-page overlay used to sit here, blocking all interaction
// (including the filter panel) until every background fetch above —
// including up to 11 concurrent external NESO requests — had fully
// completed, which took up to ~18 seconds in practice. Removed by
// request in favour of getting the map and filters interactive
// immediately instead. The site already has a proper per-section
// loading mechanism for the two data-heavy sidebar tabs specifically
// (renderLoadingState() in dataManager.js, shown only inside the
// Curtailment/Wind Capacity panel itself if someone opens it before
// its background prefetch has finished) — that's the same pattern
// most data-heavy dashboards use instead of a page-wide block, and it
// was already built and working before the overlay was ever added.
//
// This relies on the underlying performance work already done this
// session actually keeping things responsive without the overlay's
// help: the curtailment concurrency limiter, the chunked wind-capacity
// region-matching loop, the in-flight request deduplication above,
// and `defer` on every script tag. If the site still feels laggy in
// the first few seconds after this change, that's a signal one of
// those fixes needs to go further, not that the overlay should come
// back.


document
.getElementById("closeBtn")
.addEventListener("click",()=>{

    exitRegionFocus();

});

// Escape closes the region sidebar too, matching the About modal's own
// Escape handling. Guarded so it only fires when the sidebar is
// actually open, and steps aside if the About modal is open on top of
// it (that modal handles its own Escape independently) — avoids the
// two fighting over a single keypress.
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const sidebar = document.getElementById("sidebar");
    const aboutOverlay = document.getElementById("aboutSiteOverlay");
    if (aboutOverlay && !aboutOverlay.classList.contains("hidden")) return;
    if (sidebar && !sidebar.classList.contains("hidden")) {
        exitRegionFocus();
    }
});