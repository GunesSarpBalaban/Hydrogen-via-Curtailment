// ======================================================
// Wind Capacity (Installed & Projected)
// ======================================================
//
// Sidebar data module — NOT a map layer. Per discussion, plotting
// ~2,400 individual REPD projects as markers alongside the existing
// hydrogen/turbine layers would clutter the map without adding much;
// a per-region sidebar chart (matching the Generation/Curtailment/H2
// Demand pattern already in dataManager.js) is the better fit here.
//
// Data source: DESNZ's Renewable Energy Planning Database (REPD),
// Q2 2026 extract — a cumulative, point-in-time database where every
// project ever tracked stays listed with its dated milestones, so a
// single snapshot already contains genuine multi-year history (this
// file's operational dates go back to 1992) without needing to merge
// multiple quarterly extracts.
//
// Pre-processed from the raw ~14,700-row, 53-column REPD CSV (all
// renewable technologies) down to data/wind_capacity_projects.json:
// ~2,460 wind-only records (onshore + offshore, Northern Ireland
// excluded — NI has its own separate grid, SONI, not part of this
// app's GB region model), with OSGB36 easting/northing converted to
// WGS84 lat/lon.
//
// Region assignment happens HERE, client-side, at render time —
// reusing window.resolveRegionForCoords (exposed by windCurtailment.js:
// point-in-polygon first, falling back to nearest-region-within-400km
// for offshore projects) — consistent with how every other layer in
// this app assigns points to regions, rather than pre-baking region
// labels into the static JSON.
//
// METHODOLOGY NOTE (important — read before changing the projection
// logic): REPD's non-operational (pipeline) projects almost never have
// a real future commissioning date — the "Operational" field is only
// populated once a project is actually built. Of ~990 wind projects
// genuinely in the pipeline nationally, only ~100 even have a CfD
// Allocation Round noted (a rough auction-year signal, not a delivery
// date), and essentially none have a populated Operational date. So a
// genuine year-by-year FORECAST isn't something this data can support
// honestly. What IS built here instead, per explicit discussion: an
// ESTIMATE that combines each region's own real historical average
// annual capacity growth with the REAL known pipeline capacity as a
// hard ceiling (a region's projection can never assume more capacity
// gets built than is actually known to be under construction,
// consented, or in planning right now). This is clearly labelled as
// an estimate in the UI, with the actual MW/year figure and pipeline
// total disclosed — not presented as an official forecast.
//
// Wrapped in an IIFE with a load-guard, matching this codebase's other
// scripts.

(function () {

    if (window.__windCapacityLoaded) {
        console.log("windCapacity.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__windCapacityLoaded = true;


    const DATA_URL = "data/wind_capacity_projects.json";

    // Statuses representing capacity that could still realistically be
    // built — the "active" pipeline. Deliberately excludes dead-end
    // outcomes (refused, withdrawn, abandoned, expired) and
    // decommissioned/retired capacity, none of which represent real
    // future capacity.
    // NOTE: data/wind_capacity_projects.json is pre-filtered at the
    // data-prep stage to only include records with status "Operational"
    // or one of the statuses listed here — dead-end statuses (Refused,
    // Withdrawn, Abandoned, Expired, Decommissioned, etc.) are never
    // counted by this file's logic anyway, so they were stripped from
    // the source data entirely (2,458 -> 1,514 records, ~39% smaller)
    // rather than being downloaded and discarded on every load. If this
    // list changes, the data file needs regenerating to match.
    const PIPELINE_STATUSES = new Set([
        "Under Construction",
        "Planning Permission Granted",
        "Planning Application Submitted",
        "Appeal Granted",
        "Revised",
        "Secretary of State - Granted"
    ]);

    const TREND_WINDOW_YEARS = 10; // per explicit discussion — "5-10 years", using the longer end to smooth year-to-year lumpiness (national data ranges from 337 MW to 3,248 MW added in a single year)
    const PROJECTION_YEARS = 5;
    const HISTORY_YEARS_SHOWN = 10; // years of real installed history shown in the "Historical" tab — extending this from 6 to 10 costs nothing extra: the full operational-projects array is already loaded and processed in memory regardless, this just changes how many cheap filter+reduce passes run over data that's already there


    // ==========================================
    // Load + compute (cached)
    // ==========================================
    let cache = null;
    let cachePromise = null;

    async function loadProjects() {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`Failed to load wind capacity data: ${response.status}`);
        return response.json();
    }

    function resolveRegion(project) {
        if (typeof window.resolveRegionForCoords !== "function") return null;
        return window.resolveRegionForCoords(project.lat, project.lon);
    }

    const WIND_CAPACITY_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — REPD-derived data updates quarterly at most, effectively static day-to-day

    async function computeRegionalWindCapacity(forceRefresh = false) {
        if (cache && !forceRefresh) return cache;
        if (cachePromise && !forceRefresh) return cachePromise;

        if (!forceRefresh && window.PersistentCache) {
            const persisted = window.PersistentCache.load("wind_capacity", WIND_CAPACITY_PERSIST_MAX_AGE_MS);
            if (persisted) {
                cache = persisted;
                return cache;
            }
        }

        cachePromise = (async () => {
            const projects = await loadProjects();
            const currentYear = new Date().getFullYear();

            const regionData = {}; // { regionName: { operational: [{year, cap}], pipelineMW, pipelineByStage } }

            function ensure(region) {
                if (!regionData[region]) {
                    regionData[region] = { operational: [], pipelineMW: 0, pipelineByStage: {} };
                }
                return regionData[region];
            }

            let skippedNoRegion = 0;
            let skippedNoData = 0;

            // Chunked rather than one long forEach: ~2,460 points each
            // checked against up to 14 region polygons is enough
            // synchronous work to visibly stutter the page (including
            // the loading overlay's own spinner animation) if done in
            // a single blocking pass. Yielding briefly between chunks
            // doesn't make the total computation any faster, but keeps
            // the browser's main thread free to paint/animate between
            // batches instead of appearing frozen.
            const CHUNK_SIZE = 200;
            for (let i = 0; i < projects.length; i += CHUNK_SIZE) {
                const chunk = projects.slice(i, i + CHUNK_SIZE);

                chunk.forEach((p) => {
                    if (p.lat == null || p.lon == null) { skippedNoData++; return; }

                    const region = resolveRegion(p);
                    if (!region) { skippedNoRegion++; return; }

                    const entry = ensure(region);

                    if (p.status === "Operational" && p.operationalDate && p.capacityMW) {
                        const year = new Date(p.operationalDate).getFullYear();
                        if (Number.isFinite(year)) entry.operational.push({ year, cap: p.capacityMW });
                    } else if (PIPELINE_STATUSES.has(p.status) && p.capacityMW) {
                        entry.pipelineMW += p.capacityMW;
                        entry.pipelineByStage[p.status] = (entry.pipelineByStage[p.status] || 0) + p.capacityMW;
                    }
                });

                if (i + CHUNK_SIZE < projects.length) {
                    await new Promise(resolve => setTimeout(resolve, 0)); // yield to the browser between chunks
                }
            }

            console.log(`Wind capacity: ${projects.length} project(s) loaded, ${skippedNoRegion} could not be matched to any region, ${skippedNoData} had no coordinates.`);

            const result = {};

            Object.entries(regionData).forEach(([region, data]) => {
                // Real installed history — cumulative MW as of each of
                // the last HISTORY_YEARS_SHOWN years.
                const historical = {};
                for (let y = currentYear - HISTORY_YEARS_SHOWN + 1; y <= currentYear; y++) {
                    historical[y] = Math.round(
                        data.operational.filter(o => o.year <= y).reduce((sum, o) => sum + o.cap, 0)
                    );
                }

                // Historical trend: average MW actually added per year
                // over the trend window — the real, region-specific
                // growth rate this region's projection is based on.
                const trendCutoff = currentYear - TREND_WINDOW_YEARS;
                const addedInWindow = data.operational
                    .filter(o => o.year > trendCutoff && o.year <= currentYear)
                    .reduce((sum, o) => sum + o.cap, 0);
                const avgAnnualMW = addedInWindow / TREND_WINDOW_YEARS;

                // Projection: apply the trend forward, but never let
                // cumulative MW added exceed this region's REAL known
                // pipeline total — the pipeline depletes as it's
                // "used up" by the projection, so growth naturally
                // tapers off once known projects run out rather than
                // extrapolating the trend indefinitely.
                let remainingPipeline = data.pipelineMW;
                let cumulative = historical[currentYear] || 0;
                const projection = {};
                for (let i = 1; i <= PROJECTION_YEARS; i++) {
                    const year = currentYear + i;
                    const addition = Math.min(avgAnnualMW, remainingPipeline);
                    remainingPipeline = Math.max(0, remainingPipeline - addition);
                    cumulative += addition;
                    projection[year] = Math.round(cumulative);
                }

                result[region] = {
                    historical,
                    pipelineMW: Math.round(data.pipelineMW),
                    pipelineByStage: Object.fromEntries(
                        Object.entries(data.pipelineByStage).map(([k, v]) => [k, Math.round(v)])
                    ),
                    avgAnnualMW: Math.round(avgAnnualMW),
                    projection
                };
            });

            cache = result;
            if (window.PersistentCache) window.PersistentCache.save("wind_capacity", result);
            return result;
        })();

        return cachePromise;
    }


    // ==========================================
    // Expose
    // ==========================================
    window.getRegionalWindCapacity = computeRegionalWindCapacity;

})();