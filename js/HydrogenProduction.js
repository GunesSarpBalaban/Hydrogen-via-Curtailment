// ======================================================
// Hydrogen Production Potential (from Curtailed Wind)
// ======================================================
//
// Implements the electrolysis production model from the user's
// dissertation (Final Year Project, Section 3.5), applied to this
// site's real NESO wind curtailment data. Two scenarios:
//
//   THEORETICAL MAXIMUM: every kWh of curtailed energy converted at a
//   flat maximum efficiency, no electrolyser capacity limit. Upper
//   bound / sanity check.
//
//   CONSTRAINED: a real electrolyser capacity limit (P_rated) caps how
//   much curtailed power can actually be used in any one settlement
//   period — anything above that is still wasted, exactly like a real
//   installation — combined with a non-linear efficiency curve that
//   peaks at 70% load and falls off either side (PEM electrolyser
//   behaviour).
//
// EQUATIONS (dissertation Section 3.5, kept verbatim):
//   Eq.2  mass_H2_kg = (curtailed_energy_kWh * eta) / LHV_H2_kWh_per_kg
//   Eq.3  eta(P) = eta_max - k * (P/P_cap - 0.7)^2
//
// CONSTANTS: eta_max = 0.80, k = 0.15, LHV = 33.3 kWh/kg — all as
// specified in the dissertation, not tuned or approximated.
//
// GRANULARITY: this deliberately queries NESO at SETTLEMENT-PERIOD
// level (30-minute resolution), not the daily/monthly aggregates the
// existing Curtailment tab uses. The capacity constraint only makes
// physical sense applied per-period — a daily total would hide the
// exact spikes-vs-capacity behaviour the constraint exists to model.
// This was an explicit choice to stay faithful to the dissertation
// methodology rather than approximate it for convenience.
//
// CLUSTERING: generators are grouped by (a) identical/near-identical
// coordinates — catches multi-phase farms like Seagreen 1-6, Hornsea
// A1-B3, Beatrice 1-4 automatically, since they're already recorded at
// the same physical location — then (b) a distance-threshold merge, so
// separately-named-but-geographically-close farms (e.g. anything else
// near where the Seagreen cluster's power comes ashore) get folded
// into the same cluster too. This is a real approximation of shared
// grid connection using geography, not verified substation-level
// topology for all 178 generators — flagged honestly in the UI.
//
// Wrapped in an IIFE with a load-guard, matching this codebase's other
// scripts.

(function () {

    if (window.__hydrogenProductionLoaded) {
        console.log("hydrogenProduction.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__hydrogenProductionLoaded = true;


    // ==========================================
    // Dissertation constants (Section 3.5) — do not change without
    // updating the source methodology reference.
    // ==========================================
    const ETA_MAX = 0.80;              // maximum electrolyser efficiency
    const K_COEFFICIENT = 0.15;        // efficiency curve steepness (Eq.3)
    const OPTIMAL_LOAD_FRACTION = 0.70; // efficiency peaks at 70% of rated capacity
    const LHV_H2_KWH_PER_KG = 33.3;    // lower heating value of hydrogen

    // Capacity tiers from the dissertation's comparison (15x5MW,
    // 3x25MW, 1x75MW — three ways of packaging ~75MW of total
    // electrolyser capacity). Exposed as presets; a cluster's assigned
    // tier is chosen based on its own curtailment scale (see
    // assignCapacityTier below), not fixed globally.
    const CAPACITY_TIERS_MW = [5, 25, 75];


    // ==========================================
    // Production model — Equations 2 & 3
    // ==========================================

    // eta(P): efficiency at a given power level P (MW), relative to
    // the electrolyser's rated capacity P_cap (MW). Peaks at ETA_MAX
    // when P/P_cap = OPTIMAL_LOAD_FRACTION, falls off quadratically
    // either side. Clamped to [0, ETA_MAX] — the raw quadratic can go
    // negative or above ETA_MAX outside a sensible load range, which
    // isn't physically meaningful.
    function electrolyserEfficiency(powerMW, capacityMW) {
        if (capacityMW <= 0) return 0;
        const loadFraction = powerMW / capacityMW;
        const eta = ETA_MAX - K_COEFFICIENT * Math.pow(loadFraction - OPTIMAL_LOAD_FRACTION, 2);
        return Math.max(0, Math.min(ETA_MAX, eta));
    }

    // Theoretical maximum: flat ETA_MAX efficiency, no capacity cap at
    // all — every MW of curtailment converts, regardless of scale.
    function massH2TheoreticalMax(curtailedEnergyMWh) {
        const kWh = curtailedEnergyMWh * 1000;
        return (kWh * ETA_MAX) / LHV_H2_KWH_PER_KG; // kg
    }

    // Constrained: caps usable power at the electrolyser's rated
    // capacity per settlement period (anything above P_cap is wasted,
    // exactly like a real installation cannot exceed its own rating),
    // and applies the non-linear efficiency curve at whatever power
    // level was actually used.
    //
    // curtailedPowerMW: the curtailment POWER level for one settlement
    // period (MW, i.e. BOA_Volume for that period — NOT yet converted
    // to energy, since the efficiency curve needs power, not energy).
    // periodHours: settlement period duration (0.5h) — used to convert
    // the used power into energy for the mass calculation.
    function massH2ConstrainedForPeriod(curtailedPowerMW, capacityMW, periodHours) {
        const usedPowerMW = Math.min(Math.abs(curtailedPowerMW), capacityMW);
        const eta = electrolyserEfficiency(usedPowerMW, capacityMW);
        const usedEnergyKWh = usedPowerMW * periodHours * 1000;
        return (usedEnergyKWh * eta) / LHV_H2_KWH_PER_KG; // kg
    }


    // ==========================================
    // Capacity tier assignment
    // ==========================================
    // Sizes each cluster's simulated electrolyser relative to its own
    // curtailment scale, using the dissertation's three tiers as
    // presets rather than one fixed capacity everywhere — small
    // clusters get small electrolysers, large ones (Beatrice, Moray
    // East/West, Seagreen, etc.) get larger ones. Thresholds are a
    // reasonable default, not a value from the dissertation itself —
    // flagged as such in the UI.
    function assignCapacityTier(clusterAverageCurtailmentMW) {
        if (clusterAverageCurtailmentMW >= 50) return 75;
        if (clusterAverageCurtailmentMW >= 15) return 25;
        return 5;
    }


    // ==========================================
    // Generator clustering
    // ==========================================
    function haversineDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const CLUSTER_DISTANCE_THRESHOLD_KM = 45; // generators within this distance are merged into one cluster

    // Union-Find (disjoint set) — lets three-or-more nearby clusters
    // merge transitively (A close to B, B close to C => A/B/C all one
    // cluster), which is what "other clusters close to where the
    // Seagreens deliver their power get included too" actually needs
    // — a simple pairwise check alone wouldn't chain like this.
    function buildClusters(generatorNames) {
        const parent = {};
        function find(x) {
            if (parent[x] !== x) parent[x] = find(parent[x]);
            return parent[x];
        }
        function union(x, y) {
            const rx = find(x), ry = find(y);
            if (rx !== ry) parent[rx] = ry;
        }

        generatorNames.forEach(name => { parent[name] = name; });

        for (let i = 0; i < generatorNames.length; i++) {
            for (let j = i + 1; j < generatorNames.length; j++) {
                const a = generatorNames[i], b = generatorNames[j];
                const [latA, lonA] = window.WIND_FARM_COORDS[a];
                const [latB, lonB] = window.WIND_FARM_COORDS[b];
                if (haversineDistanceKm(latA, lonA, latB, lonB) <= CLUSTER_DISTANCE_THRESHOLD_KM) {
                    union(a, b);
                }
            }
        }

        const clusters = {}; // { rootName: [generatorNames...] }
        generatorNames.forEach(name => {
            const root = find(name);
            clusters[root] = clusters[root] || [];
            clusters[root].push(name);
        });

        return Object.values(clusters);
    }

    let clusterCache = null;

    // Manual overrides for clusters whose geometric centroid lands
    // somewhere unusable — most commonly offshore clusters, where
    // averaging the coordinates of turbines sitting out at sea just
    // gives you a point further out at sea. An electrolyser needs a
    // real onshore site, ideally where the farm's cable actually comes
    // ashore. Keyed by ANY member generator's name (as it appears in
    // WIND_FARM_COORDS) — if a cluster contains a key listed here, its
    // whole location uses this override instead of the computed
    // centroid. Empty for now — filled in as real onshore hub
    // locations are researched and confirmed.
    //
    // Example format once populated:
    //   "Seagreen 1": [56.60, -2.30],  // wherever Seagreen's cable actually lands
    const CLUSTER_ONSHORE_OVERRIDE = {
        // East Anglia cluster (and other nearby turbines merged into
        // the same cluster) -> Bramford substation, Suffolk. OSGB grid
        // reference 609699,245862 converted to WGS84.
        "East Anglia One Part 1": [52.0714, 1.0583],

        // Greater Gabbard / Galloper cluster -> Sizewell onshore
        // substation (Broom Covert, near Leiston, Suffolk) — confirmed
        // connection point per the Greater Gabbard offshore wind farm's
        // Marine Management Organisation licence case summary.
        "Greater Gabbard 1": [52.2135, 1.6150],

        // London Array and Gunfleet Sands clusters -> Cleve Hill
        // substation, Kent (built specifically to connect London
        // Array; co-located with Cleve Hill Solar Park, whose precise
        // coordinate is used here since the two sites are immediately
        // adjacent).
        "London Array 1": [51.3344, 0.9429],
        "Gunfleet Sands 1": [51.3344, 0.9429],

        // Rampion cluster -> Bolney National Grid Substation, West
        // Sussex (OS grid reference TQ 240 210).
        "Rampion 1": [50.9751, -0.2352],

        // Seagreen cluster -> Tealing substation, Angus — confirmed
        // connection point per SSEN Transmission's own project pages
        // for the Seagreen offshore wind farm connection.
        "Seagreen 1": [56.5330, -2.9560],

        // Hywind (Scotland, floating, offshore Peterhead) -> Grange
        // substation, Peterhead — confirmed as a real named substation
        // in SSEN's 132kV network documentation; coordinate approximated
        // from the adjacent, well-documented Peterhead 400kV/275kV
        // substation complex at Boddam, which multiple SSEN planning
        // documents describe Grange as immediately next to.
        "Hywind": [57.4772, -1.7889],

        // Hornsea and Humber Gateway clusters -> North Killingholme
        // onshore substation, North Lincolnshire — confirmed as the
        // real connection point for the Hornsea projects across
        // multiple sources (Ørsted's own project documentation, Wikipedia).
        // Coordinate is North Killingholme village itself (the
        // substation sits within it); several independent sources
        // agree closely on this position.
        "Hornsea A1": [53.6390, -0.2710],
        "Humber Gateway 1 ": [53.6390, -0.2710], // trailing space intentional — matches WIND_FARM_COORDS key exactly

        // Burbo Bank and Gwynt y Mor cluster -> Bodelwyddan substation,
        // North Wales (Cefn Meiriadog, Denbighshire) — confirmed as the
        // real National Grid connection point for North Wales offshore
        // wind per multiple National Grid project pages.
        "Burbo Bank": [53.2300, -3.4740],
        "Burbo Bank Ext": [53.2300, -3.4740],
        "Gwynt y Mor 15": [53.2300, -3.4740],
        "Gwynt y Mor 17": [53.2300, -3.4740],
        "Gwynt y Mor 26": [53.2300, -3.4740],
        "Gwynt y Mor 28": [53.2300, -3.4740],

        // Barrow, Ormonde, and Walney cluster -> Heysham onshore
        // substation, Middleton, Lancashire — confirmed connection
        // point for all East Irish Sea wind farms per Ørsted's own
        // project pages and multiple independent sources.
        "Barrow": [54.0250, -2.9000],
        "Ormonde": [54.0250, -2.9000],
        "Walney 1": [54.0250, -2.9000],
        "Walney 2": [54.0250, -2.9000],
        "Walney 3": [54.0250, -2.9000],
        "Walney 4": [54.0250, -2.9000]
    };

    // Friendly hub names for popups — reuses the same researched
    // substations as the override table above, so a cluster's display
    // name matches its real onshore connection point wherever that's
    // known. Clusters without a known substation fall back to naming
    // themselves after their first member (see getGeneratorClusters).
    const CLUSTER_HUB_NAMES = {
        "East Anglia One Part 1": "Bramford",
        "Greater Gabbard 1": "Sizewell",
        "London Array 1": "Cleve Hill",
        "Gunfleet Sands 1": "Cleve Hill",
        "Rampion 1": "Bolney",
        "Seagreen 1": "Tealing",
        "Hywind": "Grange (Peterhead)",
        "Hornsea A1": "North Killingholme",
        "Humber Gateway 1 ": "North Killingholme",
        "Burbo Bank": "Bodelwyddan",
        "Burbo Bank Ext": "Bodelwyddan",
        "Gwynt y Mor 15": "Bodelwyddan",
        "Gwynt y Mor 17": "Bodelwyddan",
        "Gwynt y Mor 26": "Bodelwyddan",
        "Gwynt y Mor 28": "Bodelwyddan",
        "Barrow": "Heysham",
        "Ormonde": "Heysham",
        "Walney 1": "Heysham",
        "Walney 2": "Heysham",
        "Walney 3": "Heysham",
        "Walney 4": "Heysham"
    };

    // Returns [{ id, members: [names], centerLat, centerLon, region }]
    function getGeneratorClusters() {
        if (clusterCache) return clusterCache;

        if (typeof window.WIND_FARM_COORDS !== "object" || typeof window.resolveRegionForGenerator !== "function") {
            console.log("hydrogenProduction: WIND_FARM_COORDS/resolveRegionForGenerator not available — is windCurtailment.js loaded?");
            return [];
        }

        const names = Object.keys(window.WIND_FARM_COORDS);
        const groups = buildClusters(names);

        clusterCache = groups.map((members, i) => {
            const overrideMember = members.find(m => CLUSTER_ONSHORE_OVERRIDE[m]);
            let centerLat, centerLon, region;

            if (overrideMember) {
                // Real, researched onshore coordinate — safe to resolve
                // by pure coordinate (resolveRegionForCoords), since a
                // real onshore point should land cleanly inside the
                // correct region via plain point-in-polygon. This is
                // the actual fix for the original bug: "Burbo Bank"
                // (-> North West England) and "Gwynt y Mor 15" (->
                // North Midlands and North Wales) are the same merged
                // cluster per the user's own substation research, but
                // used to resolve via whichever name happened to be
                // members[0] — now resolved by the cluster's real
                // location instead.
                [centerLat, centerLon] = CLUSTER_ONSHORE_OVERRIDE[overrideMember];
                region = window.resolveRegionForCoords(centerLat, centerLon);
            } else {
                // No override yet for this cluster. Centroid used for
                // the marker POSITION only — for an all-offshore
                // cluster this can land in open water, so it is
                // deliberately NOT used to resolve the region (an
                // earlier version did, which regressed accuracy for
                // every cluster without an override, since it discarded
                // the well-researched name-based hub table in favour of
                // a less precise distance fallback).
                //
                // Instead: each member resolves its OWN region
                // individually (name-based hub table first, same
                // resolveRegionForGenerator used everywhere else in
                // this app), and the cluster takes whichever region
                // most members agree on. Geographically merged members
                // should mostly agree, so this is far more robust than
                // trusting a single arbitrary member's name.
                const coords = members.map(m => window.WIND_FARM_COORDS[m]);
                centerLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
                centerLon = coords.reduce((s, c) => s + c[1], 0) / coords.length;

                const votes = {};
                members.forEach((m) => {
                    const [mLat, mLon] = window.WIND_FARM_COORDS[m];
                    const r = window.resolveRegionForGenerator(m, mLat, mLon);
                    if (r) votes[r] = (votes[r] || 0) + 1;
                });
                let bestRegion = null, bestCount = 0;
                Object.entries(votes).forEach(([r, count]) => {
                    if (count > bestCount) { bestRegion = r; bestCount = count; }
                });
                region = bestRegion;
            }

            return {

                id: `cluster_${i}_${members[0].replace(/\s+/g, "_")}`,
                members,
                centerLat,
                centerLon,
                region,
                hubName: CLUSTER_HUB_NAMES[overrideMember] || `${members[0]} area`
            };
        });

        console.log(`Hydrogen production: ${names.length} generators grouped into ${clusterCache.length} clusters.`);
        return clusterCache;
    }

    function findClusterForGenerator(generatorName, clusters) {
        return clusters.find(c => c.members.includes(generatorName));
    }


    // ==========================================
    // Settlement-period curtailment data (all years, paginated)
    // ==========================================
    // This is a genuinely large pull — settlement-period granularity
    // across all financial years, not the daily/monthly aggregates
    // the existing Curtailment tab uses (see file header for why).
    // Paginated defensively (LIMIT/OFFSET) rather than trusting NESO's
    // SQL endpoint to return everything in one response — if there's
    // an undocumented row cap, an unpaginated query would silently
    // truncate results and undercount production without any error,
    // which would be a real accuracy problem given the whole point of
    // this feature is staying faithful to real curtailment volumes.
    const PAGE_SIZE = 5000;

    // A flat worker pool rather than "fetch years concurrently, pages
    // within a year sequentially" (an earlier version of this file did
    // that, and it was still too slow — a year with many pages had to
    // finish entirely before its later pages could even start). Here,
    // every (year, page) combination is one task in a SINGLE queue:
    // it starts with page 0 for all 9 years queued at once, and the
    // moment any page comes back full, that year's next page gets
    // pushed onto the same queue immediately — so a year with lots of
    // curtailment doesn't get stuck waiting behind unrelated years,
    // and everything progresses at the same time up to the connection
    // cap. CONCURRENCY is set close to a realistic browser per-origin
    // connection ceiling (~6 over HTTP/1.1) — higher wouldn't help,
    // since the browser itself would just queue the excess anyway.
    const CONCURRENCY = 6;

    async function fetchAllSettlementPeriodData(fyLabels, onProgress) {
        const buildSql = (resourceId, offset) => `
            SELECT "Date", "Settlement_Period", "Generator_Full_Name", SUM("BOA_Volume") as total_volume
            FROM "${resourceId}"
            WHERE "BOA_Volume" < 0
            GROUP BY "Date", "Settlement_Period", "Generator_Full_Name"
            ORDER BY "Date", "Settlement_Period"
            LIMIT ${PAGE_SIZE} OFFSET ${offset}
        `;

        const rowsByYear = {};
        const pageCountByYear = {};
        const doneByYear = {};
        fyLabels.forEach(fy => { rowsByYear[fy] = []; pageCountByYear[fy] = 0; doneByYear[fy] = false; });

        // Task queue — starts with "page 0 for every year" all at once.
        const queue = fyLabels.map(fyLabel => ({ fyLabel, offset: 0 }));
        let totalRows = 0;

        const reportProgress = () => {
            if (typeof onProgress !== "function") return;
            const completed = fyLabels.filter(fy => doneByYear[fy]).length;
            onProgress(completed, fyLabels.length, totalRows);
        };

        async function worker() {
            while (queue.length > 0) {
                const task = queue.shift(); // safe without locking — JS is single-threaded, this synchronous mutation can't race even with concurrent async workers
                if (!task) return;

                let pageRows;
                try {
                    const result = await window.runSqlForFY(task.fyLabel, (id) => buildSql(id, task.offset));
                    pageRows = result.rows;
                } catch (err) {
                    console.log(`Hydrogen production: settlement-period fetch failed for FY ${task.fyLabel} at offset ${task.offset} — stopping this year here, using ${rowsByYear[task.fyLabel].length} row(s) collected so far.`, err);
                    doneByYear[task.fyLabel] = true;
                    reportProgress();
                    continue;
                }

                rowsByYear[task.fyLabel] = rowsByYear[task.fyLabel].concat(pageRows);
                pageCountByYear[task.fyLabel]++;
                totalRows += pageRows.length;

                if (pageRows.length === PAGE_SIZE) {
                    // Full page — more data likely exists for this
                    // year, queue the next page immediately rather than
                    // waiting for anything else.
                    if (pageCountByYear[task.fyLabel] > 200) { // safety valve — ~1M rows, should never legitimately be reached
                        console.log(`Hydrogen production: FY ${task.fyLabel} hit the 200-page safety cap — data may be incomplete. Investigate before trusting totals for this year.`);
                        doneByYear[task.fyLabel] = true;
                    } else {
                        queue.push({ fyLabel: task.fyLabel, offset: task.offset + PAGE_SIZE });
                    }
                } else {
                    doneByYear[task.fyLabel] = true; // fewer than a full page = reached the end for this year
                }

                reportProgress();
            }
        }

        const workers = Array.from({ length: CONCURRENCY }, () => worker());
        await Promise.all(workers);

        fyLabels.forEach(fy => {
            console.log(`Hydrogen production: FY ${fy} — ${rowsByYear[fy].length} settlement-period row(s) across ${pageCountByYear[fy]} page(s).`);
        });

        return rowsByYear;
    }


    // ==========================================
    // Theoretical Max — FAST path, reuses curtailment's own data
    // ==========================================
    // Theoretical Max only needs total curtailed energy per region per
    // period — no per-generator/per-cluster breakdown, no settlement-
    // period granularity, since there's no capacity limit to apply.
    // That's exactly what the Curtailment tab's own
    // getDailyRegionalCurtailment/getMonthlyRegionalCurtailment/
    // getYearlyRegionalCurtailment already compute and cache — reusing
    // them here means this scenario doesn't need the heavy
    // settlement-period pull at all, and resolves almost immediately
    // if curtailment's own daily/monthly prefetch has already run
    // (which it does on page load — see app.js). Yearly curtailment is
    // fetched lazily elsewhere in the app, so calling it here may
    // trigger that fetch if nobody's opened Curtailment's Yearly view
    // yet — still far faster than the settlement-period pull below.
    let theoreticalCache = null;
    let theoreticalCachePromise = null;

    async function computeTheoreticalProduction(forceRefresh = false) {
        if (theoreticalCache && !forceRefresh) return theoreticalCache;
        if (theoreticalCachePromise && !forceRefresh) return theoreticalCachePromise;

        theoreticalCachePromise = (async () => {
            if (typeof window.getDailyRegionalCurtailment !== "function") {
                throw new Error("Curtailment module not loaded.");
            }

            const [dailyAll, monthlyAll, yearlyAll] = await Promise.all([
                window.getDailyRegionalCurtailment(),
                window.getMonthlyRegionalCurtailment(),
                window.getYearlyRegionalCurtailment()
            ]);

            const convert = (accum) => {
                const result = {};
                Object.entries(accum).forEach(([period, byRegion]) => {
                    result[period] = {};
                    Object.entries(byRegion).forEach(([region, mwh]) => {
                        result[period][region] = Math.round(massH2TheoreticalMax(mwh) * 10) / 10;
                    });
                });
                return result;
            };

            const daily = convert(dailyAll);
            const monthly = convert(monthlyAll);
            const yearly = convert(yearlyAll);

            const total = {};
            Object.values(yearly).forEach(byRegion => {
                Object.entries(byRegion).forEach(([region, kg]) => {
                    total[region] = Math.round(((total[region] || 0) + kg) * 10) / 10;
                });
            });

            theoreticalCache = { daily, monthly, yearly, total };
            return theoreticalCache;
        })();

        return theoreticalCachePromise;
    }


    // ==========================================
    // Constrained — SLOW path, needs real settlement-period data
    // ==========================================
    // This is the one that can't be shortcut — the capacity constraint
    // only makes physical sense applied to real 30-minute power
    // readings (see file header). Persisted to localStorage (the
    // AGGREGATED result only, not the raw settlement-period rows,
    // which would be far too large) so a returning visitor within the
    // cache window doesn't have to pay this cost again even after
    // closing the browser entirely — in-memory caching alone resets on
    // every page load.
    const LOCALSTORAGE_KEY = "h2production_constrained_cache_v3"; // bumped from v2 — the first fix was too broad (coordinate-only resolution regressed clusters without an override); v3 uses majority-vote across members for those, override-coordinate resolution only when a real override exists
    const LOCALSTORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — long enough to help a same-day or next-day return visit, short enough that it won't serve genuinely stale curtailment data indefinitely

    function loadConstrainedFromLocalStorage() {
        try {
            const raw = localStorage.getItem(LOCALSTORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed.cachedAt || (Date.now() - parsed.cachedAt) > LOCALSTORAGE_MAX_AGE_MS) return null;
            console.log(`Hydrogen production: loaded Constrained data from localStorage (cached ${Math.round((Date.now() - parsed.cachedAt) / 60000)} minute(s) ago) — skipping the settlement-period fetch entirely.`);
            return parsed.data;
        } catch (err) {
            console.log("Hydrogen production: failed to read localStorage cache — will fetch fresh.", err);
            return null;
        }
    }

    function saveConstrainedToLocalStorage(data) {
        const payload = JSON.stringify({ cachedAt: Date.now(), data });
        const sizeKB = Math.round(payload.length / 1024);
        try {
            localStorage.setItem(LOCALSTORAGE_KEY, payload);
            console.log(`Hydrogen production: saved Constrained data to localStorage (${sizeKB} KB) — future page loads within 24h will skip the settlement-period fetch entirely.`);
        } catch (err) {
            // Quota exceeded or storage disabled (private browsing,
            // browser settings) — this WAS being logged quietly before,
            // which made a real quota failure indistinguishable from
            // "nothing to worry about". Logged as a warning now, with
            // the actual payload size, since a large payload silently
            // failing to save is exactly what would make every reload
            // look like it's re-fetching from scratch.
            console.warn(`Hydrogen production: FAILED to save Constrained data to localStorage (payload was ${sizeKB} KB) — this session's data will NOT persist across a page reload. Likely cause: quota exceeded, or storage disabled (private browsing).`, err);
        }
    }

    let constrainedCache = null;
    let constrainedCachePromise = null;

    async function computeConstrainedProduction(forceRefresh = false, onProgress = null) {
        if (constrainedCache && !forceRefresh) return constrainedCache;
        if (constrainedCachePromise && !forceRefresh) return constrainedCachePromise;

        if (!forceRefresh) {
            const fromStorage = loadConstrainedFromLocalStorage();
            if (fromStorage) {
                constrainedCache = fromStorage;
                return constrainedCache;
            }
        }

        constrainedCachePromise = (async () => {
            const clusters = getGeneratorClusters();
            if (!clusters.length) {
                constrainedCache = { daily: {}, monthly: {}, yearly: {}, total: {} };
                return constrainedCache;
            }

            const fyLabels = Object.keys(window.WIND_BOA_RESOURCE_IDS);

            const dailyAccum = {};
            const monthlyAccum = {};
            const yearlyAccum = {};

            const rowsByYear = await fetchAllSettlementPeriodData(fyLabels, onProgress);

            fyLabels.forEach(fyLabel => {
                const rows = rowsByYear[fyLabel];

                const clusterVolumesThisYear = {};
                rows.forEach(row => {
                    if (window.KNOWN_NON_WIND_GENERATORS[row.Generator_Full_Name]) return;
                    const cluster = findClusterForGenerator(row.Generator_Full_Name, clusters);
                    if (!cluster) return;
                    const powerMW = Math.abs(Number(row.total_volume));
                    if (!Number.isFinite(powerMW)) return;
                    clusterVolumesThisYear[cluster.id] = clusterVolumesThisYear[cluster.id] || { sum: 0, count: 0 };
                    clusterVolumesThisYear[cluster.id].sum += powerMW;
                    clusterVolumesThisYear[cluster.id].count += 1;
                });

                const clusterCapacity = {};
                Object.entries(clusterVolumesThisYear).forEach(([clusterId, v]) => {
                    clusterCapacity[clusterId] = assignCapacityTier(v.sum / v.count);
                });

                rows.forEach(row => {
                    if (window.KNOWN_NON_WIND_GENERATORS[row.Generator_Full_Name]) return;
                    const cluster = findClusterForGenerator(row.Generator_Full_Name, clusters);
                    if (!cluster || !cluster.region) return;

                    const powerMW = Math.abs(Number(row.total_volume));
                    if (!Number.isFinite(powerMW) || powerMW <= 0) return;

                    const capacityMW = clusterCapacity[cluster.id] || 5;
                    const constrainedKg = massH2ConstrainedForPeriod(powerMW, capacityMW, window.SETTLEMENT_PERIOD_HOURS);

                    const date = row.Date;
                    const month = String(date).slice(0, 7);

                    const addTo = (accum, key, region) => {
                        accum[key] = accum[key] || {};
                        accum[key][region] = (accum[key][region] || 0) + constrainedKg;
                    };

                    addTo(dailyAccum, date, cluster.region);
                    addTo(monthlyAccum, month, cluster.region);
                    addTo(yearlyAccum, fyLabel, cluster.region);
                });
            });

            const round = (accum) => {
                Object.values(accum).forEach(byRegion => {
                    Object.keys(byRegion).forEach(region => {
                        byRegion[region] = Math.round(byRegion[region] * 10) / 10;
                    });
                });
                return accum;
            };

            round(dailyAccum);
            round(monthlyAccum);
            round(yearlyAccum);

            // Trim to what's actually ever displayed. The UI (see
            // dataManager.js's hydrogenProduction config) only ever
            // shows the last 14 days and the current financial year's
            // months — keeping every date/month across all 9 years in
            // the cached object was pure bloat, and made the
            // localStorage payload large enough to risk silently
            // exceeding quota (a failed write there was the likely
            // real cause of the cache not surviving a reload).
            // Generous buffers (30 days, 13 months) rather than exact
            // cutoffs, so this stays correct near date/FY boundaries.
            const trimToRecent = (accum, keepCount) => {
                const sortedKeys = Object.keys(accum).sort();
                const trimmed = {};
                sortedKeys.slice(-keepCount).forEach(k => { trimmed[k] = accum[k]; });
                return trimmed;
            };
            const trimmedDaily = trimToRecent(dailyAccum, 30);
            const trimmedMonthly = trimToRecent(monthlyAccum, 13);

            const total = {};
            Object.values(yearlyAccum).forEach(byRegion => {
                Object.entries(byRegion).forEach(([region, kg]) => {
                    total[region] = Math.round(((total[region] || 0) + kg) * 10) / 10;
                });
            });

            constrainedCache = { daily: trimmedDaily, monthly: trimmedMonthly, yearly: yearlyAccum, total };
            saveConstrainedToLocalStorage(constrainedCache);
            return constrainedCache;
        })();

        return constrainedCachePromise;
    }


    // ==========================================
    // Expose
    // ==========================================
    // ==========================================
    // Map markers — electrolyser cluster locations
    // ==========================================
    // Fast: only needs getGeneratorClusters() (coordinates only, no
    // settlement-period fetch), so this loads immediately regardless
    // of whether the heavy Constrained data has been fetched yet.
    // Follows the same national-layer + region-focus-reveal pattern as
    // hydrogenFacilities.js/windTurbines.js.

    // ==========================================
    // Regional hover card
    // ==========================================
    // Same viewport-aware positioning already proven for hydrogen
    // facilities' card (positionFacilityCard in hydrogenFacilities.js)
    // — flips below the marker if there's not enough room above,
    // clamps horizontally so it never renders off-screen near an edge.
    let productionCardEl = null;

    function getProductionCard() {
        if (productionCardEl) return productionCardEl;

        productionCardEl = document.createElement("div");
        productionCardEl.className = "production-info-card";
        document.body.appendChild(productionCardEl);

        const style = document.createElement("style");
        style.textContent = `
            .production-info-card {
                position: fixed;
                transform: translate(-50%, calc(-100% - 12px));
                background: #ffffff;
                color: #222;
                font: 13px/1.4 Arial, Helvetica, sans-serif;
                padding: 10px 14px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.18);
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
                z-index: 1000;
                max-width: 230px;
            }
            .production-info-card.visible {
                opacity: 1;
            }
            .production-info-card__name {
                font-weight: 700;
                margin: 0 0 4px 0;
                color: #722ed1;
            }
            .production-info-card__meta {
                margin: 0 0 4px 0;
                color: #555;
            }
            .production-info-card__note {
                margin: 4px 0 0 0;
                font-size: 11px;
                color: #888;
                font-style: italic;
            }
        `;
        document.head.appendChild(style);

        return productionCardEl;
    }

    function showProductionCard(targetEl, cluster) {
        if (window.hideAllHoverPopups) window.hideAllHoverPopups();

        const card = getProductionCard();
        card.innerHTML = `
            <p class="production-info-card__name">Simulated electrolyser hub — ${cluster.hubName}</p>
            <p class="production-info-card__meta">${cluster.members.length} nearby turbine${cluster.members.length === 1 ? "" : "s"}: ${cluster.members.slice(0, 4).join(", ")}${cluster.members.length > 4 ? `, +${cluster.members.length - 4} more` : ""}</p>
            <p class="production-info-card__note">A what-if location, not a real facility. See the H\u2082 Production tab for numbers.</p>
        `;
        positionProductionCard(targetEl);
        card.classList.add("visible");
    }

    function positionProductionCard(targetEl) {
        const card = getProductionCard();
        const rect = targetEl.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect(); // measurable even at opacity:0 since it's not display:none
        const margin = 12;

        const spaceAbove = rect.top;
        if (spaceAbove < cardRect.height + margin) {
            card.style.top = `${rect.bottom + margin}px`;
            card.style.transform = "translate(-50%, 0)";
        } else {
            card.style.top = `${rect.top}px`;
            card.style.transform = "translate(-50%, calc(-100% - 12px))";
        }

        const halfWidth = (cardRect.width || 230) / 2;
        const idealLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.min(
            Math.max(idealLeft, halfWidth + margin),
            window.innerWidth - halfWidth - margin
        );
        card.style.left = `${clampedLeft}px`;
    }

    function hideProductionCard() {
        if (productionCardEl) productionCardEl.classList.remove("visible");
    }

    function buildClusterPopup(cluster) {
        return `
            <div class="hf-popup">
                <p class="hf-popup__name">Simulated electrolyser hub — ${cluster.hubName}</p>
                <p class="hf-popup__meta">${cluster.members.length} nearby turbine${cluster.members.length === 1 ? "" : "s"}: ${cluster.members.slice(0, 4).join(", ")}${cluster.members.length > 4 ? `, +${cluster.members.length - 4} more` : ""}</p>
            </div>
        `;
    }

    function loadHydrogenProductionMarkers() {
        const clusters = getGeneratorClusters();
        if (!clusters.length) {
            console.log("Hydrogen production markers: no clusters available yet — is windCurtailment.js loaded?");
            return;
        }

        const points = clusters.map(c => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.centerLon, c.centerLat] },
            properties: { clusterId: c.id, memberCount: c.members.length }
        }));

        appState.hydrogenProductionLayer = L.geoJSON(
            { type: "FeatureCollection", features: points },
            {
                pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
                    radius: 6,
                    color: "#722ed1",
                    weight: 2,
                    fillColor: "#722ed1",
                    fillOpacity: 0.5,
                    pane: "pointFeaturesPane"
                }),
                onEachFeature: (feature, layer) => {
                    const cluster = clusters.find(c => c.id === feature.properties.clusterId);
                    if (cluster) layer.bindPopup(buildClusterPopup(cluster));
                }
            }
        );
        // Not added to the map here — starts hidden, matching the
        // "H2 Production Sites" filter's defaultOn:false.

        if (typeof registerFilter === "function") {
            registerFilter("hydrogenProductionSites", "H\u2082 Production Sites (simulated)", {
                defaultOn: false,
                onToggle: (isOn) => {
                    if (!appState.hydrogenProductionLayer) return;
                    const regionOpen = appState.mode === "regional" && appState.selectedRegionLayer && appState.selectedRegion;
                    if (regionOpen) {
                        if (isOn) {
                            showRegionalProductionMarkers(appState.selectedRegionLayer, appState.selectedRegion);
                        } else {
                            hideRegionalProductionMarkers(appState.selectedRegionLayer);
                        }
                    } else if (isOn) {
                        appState.hydrogenProductionLayer.addTo(map);
                    } else {
                        map.removeLayer(appState.hydrogenProductionLayer);
                    }
                }
            });
        }
    }

    function hideNationalProductionMarkers() {
        if (!appState.hydrogenProductionLayer) return;
        if (map.hasLayer(appState.hydrogenProductionLayer)) map.removeLayer(appState.hydrogenProductionLayer);
    }

    function restoreNationalProductionMarkers() {
        if (!appState.hydrogenProductionLayer) return;
        if (typeof isFilterOn === "function" && isFilterOn("hydrogenProductionSites")) {
            appState.hydrogenProductionLayer.addTo(map);
        }
    }

    function showRegionalProductionMarkers(layer, regionFeature) {
        if (!appState.hydrogenProductionLayer) return;
        if (typeof isFilterOn === "function" && !isFilterOn("hydrogenProductionSites")) return;

        const animated = window.activeRegionAnimations.get(layer);
        if (!animated) return;
        if (typeof window.createRegionalPointMarker !== "function") return;

        if (animated.productionClones && animated.productionClones.length) {
            animated.productionClones.forEach(el => el.remove());
        }
        animated.productionClones = [];

        const { group, scale } = animated;
        const clusters = getGeneratorClusters();

        appState.hydrogenProductionLayer.eachLayer((markerLayer) => {
            const clusterId = markerLayer.feature.properties.clusterId;
            const cluster = clusters.find(c => c.id === clusterId);
            if (!cluster || !cluster.region) return;
            if (cluster.region !== (regionFeature.properties && regionFeature.properties.DisplayName)) return;

            const marker = window.createRegionalPointMarker({
                group,
                groupScale: scale,
                latlng: markerLayer.getLatLng(),
                targetRadius: 10,
                style: { fill: "#722ed1", stroke: "#ffffff", strokeWidth: 2, fillOpacity: 0.55 },
                onMouseEnter: (el) => showProductionCard(el, cluster),
                onMouseMove: (el) => positionProductionCard(el),
                onMouseLeave: () => hideProductionCard()
            });
            animated.productionClones.push(marker);
        });
    }

    function hideRegionalProductionMarkers(layer) {
        const animated = window.activeRegionAnimations.get(layer);
        if (!animated || !animated.productionClones) return;
        animated.productionClones.forEach(el => el.remove());
        animated.productionClones = [];
    }


    // ==========================================
    // Expose
    // ==========================================
    window.loadHydrogenProductionMarkers = loadHydrogenProductionMarkers;
    window.hideNationalProductionMarkers = hideNationalProductionMarkers;
    window.restoreNationalProductionMarkers = restoreNationalProductionMarkers;
    window.showRegionalProductionMarkers = showRegionalProductionMarkers;
    if (window.registerHoverHideCallback) {
        window.registerHoverHideCallback(hideProductionCard);
    }
    window.hideRegionalProductionMarkers = hideRegionalProductionMarkers;
    window.getHydrogenProductionTheoretical = computeTheoreticalProduction;
    window.getHydrogenProductionConstrained = computeConstrainedProduction;
    window.getGeneratorClusters = getGeneratorClusters;

})();