// ======================================================
// Hydrogen Demand (Real Data)
// ======================================================
//
// Replaces the previous entirely-fabricated hydrogenDatabase in
// dataManager.js. Real data source: European Hydrogen Observatory
// (EHO) "Hydrogen demand" datasets — Eurostat-derived, published as
// separate yearly Excel files (2022/2023/2024, "Update 2025" edition),
// downloaded from https://observatory.clean-hydrogen.europa.eu/tools-reports/datasets
// and pre-compiled into data/hydrogen_demand_national.json.
//
// TWO REAL CONSTRAINTS, both confirmed directly from the source data
// (not assumed):
//
// 1. UK data is COUNTRY-LEVEL ONLY. EHO's plant-by-plant geolocation
//    sheet covers just 6 countries (France, Italy, Netherlands,
//    Norway, Poland, Spain) — the UK is not among them. So there is
//    no real per-region hydrogen demand data anywhere in this source.
//
// 2. "Other" and "Mobility" sectors have NO regional apportionment.
//    Our own hydrogen_facilities.geojson (the facility list this app
//    already built and verified) has no entries for these two EHO
//    sectors at all, so there's no location data to apportion them
//    by. They're shown as national-only context, not faked into a
//    regional split.
//
// 3. Trade data (data/hydrogen_trade_national.json, compiled from
//    EHO's "Hydrogen trade" datasets, 2022-2025) has NO regional
//    dimension at all — it's bilateral country-to-country flows
//    (national centroids, not ports or facilities), so it's shown as
//    a national reference figure regardless of which region is
//    selected, same as the live grid widget's GB-wide figures.
//
// REGIONAL APPORTIONMENT METHOD (for the sectors that DO have
// facility locations — Refining, Ammonia, Industrial heat, Other
// chemicals, Blending, Power generation): the real national sector
// total is split across regions based on which known facilities
// (from hydrogen_facilities.geojson) fall in each region, resolved
// via the same window.resolveRegionForCoords already used everywhere
// else in this app.
//
//   - Refining: CAPACITY-WEIGHTED. Hydrogen use for hydrotreating/
//     hydrocracking scales consistently with a refinery's throughput
//     across the industry, so barrel-per-day capacity (converted to
//     tonnes/year) is a well-justified weighting proxy here. Weights
//     below are compiled from public capacity figures (Wikipedia,
//     company sites, UK government downstream oil sector review) —
//     see the comment on REFINERY_CAPACITY_WEIGHTS.
//   - All other sectors: EQUAL SPLIT across facilities in that
//     sector. These sectors mix genuinely different process types
//     (an ethylene cracker vs. a chlor-alkali plant vs. an acetic
//     acid plant) with no consistent, comparable capacity metric
//     across them — capacity-weighting here would manufacture false
//     precision rather than real accuracy, so equal split is the
//     more honest default given what's actually known.
//
// This is a REAL apportionment of REAL national totals — not
// fabricated demand — but it is still an estimate, and the UI must
// say so clearly, the same standard applied to the wind capacity
// projection.
//
// Wrapped in an IIFE with a load-guard, matching this codebase's other
// scripts.

(function () {

    if (window.__hydrogenDemandLoaded) {
        console.log("hydrogenDemand.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__hydrogenDemandLoaded = true;


    const NATIONAL_DATA_URL = "data/hydrogen_demand_national.json";

    // Maps EHO's sector names (as they appear in the source data) to
    // this app's existing hydrogen facility category codes (see
    // hydrogenFacilities.js). "Other" and "Mobility" deliberately
    // excluded — see file header.
    const EHO_SECTOR_TO_CATEGORY = {
        "Refining": "refining",
        "Ammonia": "ammonia",
        "Industrial heat": "industrialHeat",
        "Other chemicals": "otherChemicals",
        "Blending in natural gas pipelines": "blending",
        "Power generation": "powerGeneration"
    };

    // Capacity weights for the 6 known operating UK refineries,
    // converted to a common unit (tonnes/year) from public capacity
    // figures: Fawley 270,000 bpd, Stanlow 296,000 bpd, Pembroke
    // 220,000 bpd, Humber 221,000 bpd (UK government downstream oil
    // sector review / Wikipedia; bpd converted to t/y at ~7.33 bbl per
    // tonne of crude), Eastham 1,200,000 t/y and Harwich 500,000 t/y
    // (both direct tonnes/year figures from company sources — these
    // are specialty/smaller sites, not comparable in bpd terms).
    // Facility names must match hydrogen_facilities.geojson exactly.
    // Grangemouth/Lindsey refineries excluded — both closed, zero
    // current capacity.
    const REFINERY_CAPACITY_TONNES_PER_YEAR = {
        "Fawley Refinery": 13444748,
        "Stanlow Refinery": 14739427,
        "Pembroke Refinery": 10954980,
        "Humber Refinery": 11004775,
        "Eastham Refinery": 1200000,
        "Harwich Manufacturing Centre": 500000
    };


    // ==========================================
    // Load + compute (cached)
    // ==========================================
    let cache = null;
    let cachePromise = null;

    async function loadNationalData() {
        const response = await fetch(NATIONAL_DATA_URL);
        if (!response.ok) throw new Error(`Failed to load hydrogen demand data: ${response.status}`);
        return response.json();
    }

    function resolveRegion(lat, lon) {
        if (typeof window.resolveRegionForCoords !== "function") return null;
        return window.resolveRegionForCoords(lat, lon);
    }

    const HYDROGEN_DEMAND_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — EHO/Eurostat demand and trade data is published annually, effectively static day-to-day

    async function computeRegionalHydrogenDemand(forceRefresh = false) {
        if (cache && !forceRefresh) return cache;
        if (cachePromise && !forceRefresh) return cachePromise;

        if (!forceRefresh && window.PersistentCache) {
            const persisted = window.PersistentCache.load("hydrogen_demand", HYDROGEN_DEMAND_PERSIST_MAX_AGE_MS);
            if (persisted) {
                cache = persisted;
                return cache;
            }
        }

        cachePromise = (async () => {
            let nationalByYear, facilitiesGeojson;
            try {
                nationalByYear = await loadNationalData();
            } catch (err) {
                console.log(`Hydrogen demand: failed to fetch ${NATIONAL_DATA_URL} — check this file exists in your data/ folder.`, err);
                throw err;
            }

            try {
                const response = await fetch("data/hydrogen_facilities.geojson");
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                facilitiesGeojson = await response.json();
            } catch (err) {
                console.log("Hydrogen demand: failed to fetch data/hydrogen_facilities.geojson.", err);
                throw err;
            }

            const tradeByYear = await fetch("data/hydrogen_trade_national.json")
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .catch(err => {
                    console.log("Hydrogen demand: data/hydrogen_trade_national.json failed to load — Trade view will show \"unavailable\" but Trend/By Sector are unaffected.", err);
                    return null;
                });

            const facilities = facilitiesGeojson.features.map(f => ({
                name: f.properties.name,
                category: f.properties.category,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
            }));

            // Resolve each facility's region once (cheap — only 25
            // facilities, unlike the ~178-turbine case that needed
            // lazy caching to avoid a page-load performance hit).
            facilities.forEach(f => {
                f.region = resolveRegion(f.lat, f.lon);
            });

            const years = Object.keys(nationalByYear).sort();
            const result = {}; // { region: { year: { sector: tonnes, ... }, ... }, ... }
            const nationalResult = {}; // { year: { sector: tonnes } } — passthrough for the national reference view

            years.forEach(year => {
                nationalResult[year] = nationalByYear[year];

                Object.entries(nationalByYear[year]).forEach(([sector, nationalTonnes]) => {
                    const category = EHO_SECTOR_TO_CATEGORY[sector];
                    if (!category) return; // "Other"/"Mobility" — no facility data, national-only

                    const sectorFacilities = facilities.filter(f => f.category === category && f.region);
                    if (!sectorFacilities.length) return;

                    let weights;
                    if (category === "refining") {
                        weights = sectorFacilities.map(f => REFINERY_CAPACITY_TONNES_PER_YEAR[f.name] || 0);
                    } else {
                        weights = sectorFacilities.map(() => 1); // equal split
                    }

                    const totalWeight = weights.reduce((a, b) => a + b, 0);
                    if (!totalWeight) return;

                    sectorFacilities.forEach((f, i) => {
                        const share = (weights[i] / totalWeight) * nationalTonnes;
                        result[f.region] = result[f.region] || {};
                        result[f.region][year] = result[f.region][year] || {};
                        result[f.region][year][sector] = (result[f.region][year][sector] || 0) + share;
                    });
                });
            });

            // Round for display after all accumulation is done.
            Object.values(result).forEach(byYear => {
                Object.values(byYear).forEach(bySector => {
                    Object.keys(bySector).forEach(sector => {
                        bySector[sector] = Math.round(bySector[sector] * 10) / 10;
                    });
                });
            });

            cache = { regional: result, national: nationalResult, years, trade: tradeByYear };
            if (window.PersistentCache) window.PersistentCache.save("hydrogen_demand", cache);
            return cache;
        })();

        return cachePromise;
    }


    // ==========================================
    // Expose
    // ==========================================
    window.getRegionalHydrogenDemand = computeRegionalHydrogenDemand;

})();