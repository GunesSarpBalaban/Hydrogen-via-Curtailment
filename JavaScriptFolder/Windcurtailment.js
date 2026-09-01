// ======================================================
// Wind Curtailment — Regional Aggregation
// ======================================================
//
// Pipeline for each time-period query:
//   1. Ask NESO's CKAN SQL endpoint to aggregate server-side
//      (SUM(BOA_Volume) GROUP BY Generator_Full_Name[, Date]),
//      filtered to BOA_Volume < 0 (curtailment / turn-down actions
//      only — positive volumes are turn-up instructions, not
//      curtailment). This avoids ever pulling raw settlement-period
//      rows, which for a full financial year comfortably exceeds
//      any single-page row limit and was silently truncating
//      earlier results (a likely cause of regions falsely showing
//      zero — whatever data existed later in the truncated window
//      never got counted).
//   2. Join each generator's summed volume against WIND_FARM_COORDS.
//   3. Resolve each coordinate to one of the site's 14 regions via
//      point-in-polygon (falling back to nearest coastline for
//      offshore sites) against appState.nationalRegionsLayer.
//   4. Sum per region.
//
// Generators that can't be matched to a coordinate, or whose
// coordinate can't be resolved to a region, are logged and excluded
// from the regional totals rather than guessed at.

(function () {

    if (window.__windCurtailmentLoaded) return;
    window.__windCurtailmentLoaded = true;


    // ==========================================
    // Coordinate lookup
    // ==========================================
    // Keyed by Generator_Full_Name exactly as it appears in NESO's
    // Wind BOA Volumes dataset (e.g. "Black Law", "Burbo Bank").
    const WIND_FARM_COORDS = {
        "A-Chruach": [56.167, -5.083], "AG-REC05L": [54.0, -2.0], "Afton": [55.393, -4.162],
        "Aikengall 2": [55.907, -2.466], "Aikengall 3": [55.907, -2.466], "Andershaw": [55.613, -3.744],
        "Arecleoch": [55.354, -4.602], "Assel Valley": [55.3, -4.483], "Auchrobert": [55.63, -3.95],
        "Bad A Cheo": [57.933, -4.683], "Baillie": [57.6, -3.283], "Barrow": [53.983, -3.083],
        "Beatrice 1": [58.109, -2.889], "Beatrice 2": [58.109, -2.889], "Beatrice 3": [58.109, -2.889],
        "Beatrice 4": [58.109, -2.889], "Beinn Tharsuinn": [57.7, -4.433], "Beinn an Tuirc Ext": [55.833, -5.5],
        "Beinn an Tuirc Phase 3": [55.833, -5.5], "Beinneun": [56.883, -4.933], "Benbrack": [55.25, -4.283],
        "Berry Burn": [57.483, -3.2], "Bhlaraidh": [57.25, -4.85], "Black Law": [55.77, -3.693],
        "Black Law Ext 1": [55.77, -3.693], "Blackcraig": [55.25, -4.15], "Blary Hill": [55.067, -3.783],
        "Braes of Doune": [56.19, -3.96], "Brockloch Rig": [55.2, -4.1], "Broken Cross": [53.2, -2.2],
        "Burbo Bank": [53.49, -3.19], "Burn of Whilk": [58.55, -3.3], "Cairn Uish 1 (Rothes 1)": [57.533, -3.2],
        "Cairn Uish 2 (Rothes 2)": [57.533, -3.2], "Camster": [58.3, -3.4], "Carraig Gheal": [56.25, -5.25],
        "Causeymire": [58.483, -3.55], "Clachan Flats": [55.917, -5.417], "Clashindarroch": [57.333, -2.917],
        "Clyde Central": [55.55, -3.75], "Clyde North": [55.55, -3.75], "Clyde South": [55.55, -3.75],
        "Corriegarth": [57.2, -4.333], "Corriemoillie": [57.55, -4.583], "Cour": [57.35, -2.75],
        "Craig II": [55.5, -3.5], "Creag Riabhach": [57.783, -4.583], "Crossdykes": [55.083, -3.433],
        "Crossdykes 2": [55.083, -3.433], "Crystal Rig 2": [55.9, -2.5], "Crystal Rig 3": [55.9, -2.5],
        "Cumberhead (Revised)": [55.583, -3.833], "Dalquhandy": [55.683, -3.833], "Dalswinton": [55.133, -3.65],
        "Deeping St Nicholas": [52.7, -0.3], "Dersalloch": [55.317, -4.5], "Dorenell 1": [57.333, -3.283],
        "Dorenell 2": [57.333, -3.283], "Douglas West": [55.55, -3.833], "Dun Law": [55.8, -3.5],
        "Dunmaglass": [57.167, -4.167], "East Anglia One Part 1": [52.9, 1.9], "East Anglia One Part 2": [52.9, 1.9],
        "Edinbane": [57.45, -6.35], "Ewe Hill": [55.25, -3.9], "Fallago Rig": [55.85, -2.533],
        "Farr 1": [57.333, -4.0], "Farr 2": [57.333, -4.0], "Galawhistle": [55.517, -3.75],
        "Galloper 1": [52.0, 2.1], "Glen App": [55.2, -4.833], "Glen Kyllachy": [57.25, -3.917],
        "Glens of Foudland": [57.333, -2.583], "Gordonbush": [57.967, -3.9], "Gordonstown Hill": [57.567, -2.717],
        "Greater Gabbard 1": [51.98, 1.95], "Greater Gabbard 2": [51.98, 1.95], "Greater Gabbard 3": [51.98, 1.95],
        "Greengairs East": [55.917, -3.917], "Griffin 1": [57.317, -3.417], "Griffin 2": [57.317, -3.417],
        "Gunfleet Sands 1": [51.8, 1.2], "Gunfleet Sands 2": [51.8, 1.2], "Gwynt y Mor 15": [53.433, -3.583],
        "Gwynt y Mor 17": [53.433, -3.583], "Gwynt y Mor 26": [53.433, -3.583], "Gwynt y Mor 28": [53.433, -3.583],
        "Hadyard Hill": [55.333, -4.383], "Hagshaw Hill - Repower": [55.65, -3.85], "Hagshaw Hill Repowering": [55.65, -3.85],
        "Halsary Forest": [58.417, -3.617], "Hare Hill Ext": [55.583, -3.817], "Harestanes": [55.417, -3.583],
        "Hill of Towie": [57.283, -2.817], "Hornsea A1": [53.9, 1.8], "Hornsea A2": [53.9, 1.8],
        "Hornsea A3": [53.9, 1.8], "Hornsea B1": [53.9, 1.8], "Hornsea B2": [53.9, 1.8],
        "Hornsea B3": [53.9, 1.8], "Kennoxhead Phase 1": [55.5, -3.9], "Kilbraur": [58.033, -3.85],
        "Kilgallioch (Arecleoch Phase 2)": [55.183, -4.483], "Kype Muir": [55.7, -3.917], "Kype Muir Extension": [55.7, -3.917],
        "Limekiln": [58.533, -3.667], "Lochluichart": [57.617, -4.8], "London Array 1": [51.6, 1.5],
        "London Array 2": [51.6, 1.5], "London Array 3": [51.6, 1.5], "London Array 4": [51.6, 1.5],
        "Mark Hill": [55.267, -4.333], "Mid Hill": [57.467, -2.883], "Middle Muir": [55.733, -3.917],
        "Millennium": [55.183, -3.55], "Minnygap": [55.2, -4.183], "Minsca": [55.283, -4.25],
        "Moray Firth Eastern 1": [58.0, -2.5], "Moray Firth Eastern 2": [58.0, -2.5], "Moray Firth Eastern 3": [58.0, -2.5],
        "Moray West 1": [58.05, -2.7], "Moray West 2": [58.05, -2.7], "Moray West 3": [58.05, -2.7],
        "Moray West 4": [58.05, -2.7], "Moy": [57.3, -4.05], "Neart Na Gaoithe 1": [56.3, -2.3],
        "Neart Na Gaoithe 2": [56.3, -2.3], "North Kyle 1": [55.35, -4.083], "North Kyle 2": [55.35, -4.083],
        "Ormonde": [54.1, -3.7], "Pauls Hill": [57.567, -3.183], "Pen-y-Cymoedd": [51.683, -3.583],
        "Race Bank 1": [53.1, 1.8], "Race Bank 2": [53.1, 1.8], "Rampion 1": [50.7, -0.3],
        "Rampion 2": [50.7, -0.3], "Robin Rigg West": [54.75, -3.5], "Sandy Knowe": [55.517, -2.783],
        "Sanquhar": [55.367, -3.917], "Seagreen 1": [56.6, -1.8], "Seagreen 2": [56.6, -1.8],
        "Seagreen 3": [56.6, -1.8], "Seagreen 4": [56.6, -1.8], "Seagreen 5": [56.6, -1.8],
        "Seagreen 6": [56.6, -1.8], "Sheringham Shoal 1": [53.033, 1.15], "Sheringham Shoal 2": [53.033, 1.15],
        "South Kyle": [55.333, -4.083], "Strathy North": [58.55, -4.033], "Stronelairg 1": [57.083, -4.65],
        "Stronelairg 2": [57.083, -4.65], "Stronelairg 3": [57.083, -4.65], "Thanet 1": [51.45, 1.633],
        "Thanet 2": [51.45, 1.633], "Toddleburn": [55.767, -3.333], "Tom Nan Clach": [57.417, -3.983],
        "Tralorg": [57.217, -4.083], "Triton Knoll East": [53.5, 1.1], "Triton Knoll West": [53.5, 1.1],
        "Tullo": [57.083, -2.7], "Tullo Ext": [57.083, -2.7], "Tullymurdoch": [56.35, -3.7],
        "Twentyshilling Hill": [55.15, -3.483], "Viking 1": [60.0, -1.2], "Viking 2": [60.0, -1.2],
        "Viking 3": [60.0, -1.2], "Viking 4": [60.0, -1.2], "Walney 1": [54.05, -3.55],
        "Walney 2": [54.05, -3.55], "Walney 3": [54.05, -3.55], "Walney 4": [54.05, -3.55],
        "West of Duddon Sands 1": [54.2, -3.55], "West of Duddon Sands 2": [54.2, -3.55],
        "Westermost Rough": [53.8, 0.2], "Whitelee 1": [55.705, -4.275], "Whitelee 2": [55.705, -4.275],
        "Whiteside Hill": [55.417, -3.833], "Windy Rig": [55.533, -2.75],

        // Added after cross-checking console-logged "not in
        // WIND_FARM_COORDS" exclusions against NESO's TEC (Transmission
        // Entry Capacity) Register, which confirms each project's real
        // connection site. Coordinates are approximate (site/connection
        // point vicinity), consistent with the precision of the rest of
        // this table.
        "Aberdeen Bay": [57.20, -2.00], // aka Aberdeen Offshore Wind Farm / EOWDC — connects at Blackdog substation
        "Burbo Bank Ext": [53.47, -3.14], // Burbo Bank Extension, Liverpool Bay
        "Coire Na Cloiche": [57.65, -4.5], // onshore, connects at Alness GSP, Highland
        "Dudgeon 1": [53.27, 1.15], "Dudgeon 2": [53.27, 1.15],
        "Dudgeon 3": [53.27, 1.15], "Dudgeon 4": [53.27, 1.15], // Dudgeon Offshore, connects at Necton 400kV, Norfolk
        "Galloper 2": [52.0, 2.1], "Galloper 3": [52.0, 2.1], "Galloper 4": [52.0, 2.1], // same array as Galloper 1
        "Gordonbush Ext": [57.967, -3.9], // extension of existing Gordonbush entry above
        "Hill of Glaschyle": [57.55, -3.85], // onshore, connects at Berry Burn GSP, Moray
        "Humber Gateway 1 ": [53.65, 0.25], // NOTE: trailing space is exactly how this appears in NESO's data — key must match exactly
        "Humber Gateway 2": [53.65, 0.25],
        "Hywind": [57.5, -1.25], // Hywind Scotland floating wind farm, offshore Peterhead
        "Lincs 1": [53.15, 0.65], "Lincs 2": [53.15, 0.65], // Lincs Offshore, off Skegness/Lincolnshire coast
        "Robin Rigg East": [54.75, -3.5], // companion to Robin Rigg West above
        "AG-REC06B": [54.0, -2.0] // same uncertain placeholder as AG-REC05L above — "AG-REC" codes don't appear in the TEC Register, likely an aggregated/embedded generation code rather than a single-site project; precise location unconfirmed
    };


    // ==========================================
    // Known non-wind generators (deliberately excluded)
    // ==========================================
    // NESO's "Wind BOA Volumes" dataset isn't perfectly wind-only —
    // this app's own curtailment description promises "Wind energy
    // curtailed... solar and other generation types are not yet
    // included", so any confirmed non-wind generator found in the
    // data is excluded here rather than added to WIND_FARM_COORDS,
    // even when its location is known. This list exists so a
    // deliberate exclusion reads as intentional (with the reasoning
    // documented) rather than looking like an unresolved gap that a
    // future pass might "fix" by adding coordinates.
    const KNOWN_NON_WIND_GENERATORS = {
        "COWB-1": "Battery storage, not wind. Confirmed via Elexon's BMU lookup (bmuId=T_COWB-1): Lead party \"Pivoted Power LLP\", Fuel type \"OTHER\". Cross-checked against the TEC Register — Pivoted Power LLP has ~34 battery storage projects registered, and exactly one is marked \"Built\": \"Cowley\", Cowley 400kV, Oxfordshire (49.9MW Energy Storage System)."
    };


    // ==========================================
    // NESO Wind BOA Volumes — resource IDs by financial year
    // ==========================================
    // Confirmed against the live dataset listing on
    // https://www.neso.energy/data-portal/wind-bmu-boa-volumes
    // 2026-27 is the current (in-progress) year — used for the daily
    // view. Update frequency is daily per NESO's own listing.
    const WIND_BOA_RESOURCE_IDS = {
        "2026-27": "45598dcd-ea9c-4911-95f2-7946c5f3b034",
        "2025-26": "3b1feda2-ec94-4315-9eab-53e987391323", // most recent revision of this FY
        "2024-25": "d3fbf6c1-7688-4486-8716-b5af0c895a5a",
        "2023-24": "1edaa5fe-86fe-41b4-95b9-55e9ec45fab0",
        "2022-23": "62da8915-4b87-4d77-a8f5-89084de1830d",
        "2021-22": "094ad551-630a-4302-b259-800a27122cfb",
        "2020-21": "b8670a89-36cd-4a19-b00d-2129ab15d3b2",
        "2019-20": "6ef6f5f2-2852-4f66-931c-29f8e5b46ddf",
        "2018-19": "28183033-4464-4b3a-a0ff-0efdc5cd6c7a"
    };
    const CURRENT_FY_KEY = "2026-27";

    // Verified static overrides for specific financial years — see the
    // comment in getYearlyRegionalCurtailment for why this exists.
    // Each file is a simple {generatorName: totalVolumeMW} map, built
    // once from a manually verified, clean data export and checked
    // directly for correctness (generator count, zero contamination)
    // before being added here.
    const YEARLY_OVERRIDE_URLS = {
        "2025-26": "data/curtailment_2025-26_yearly.json"
    };

    // Runs async tasks over `items` with at most `limit` running
    // concurrently at once, rather than all of them or one at a time.
    // Used below so the yearly fetch's 9 financial-year queries don't
    // all fire simultaneously (on top of the daily + monthly queries
    // also running around the same time, that's up to 11 concurrent
    // external requests) — most browsers cap concurrent connections
    // per origin at ~6 over HTTP/1.1, so firing more than that at once
    // mostly just means some requests sit queued rather than actually
    // running in parallel, while still costing JS overhead (script tag
    // creation, callback registration) for all of them up front. A
    // moderate batch size keeps the earlier win (concurrent, not
    // sequential — see the comment on getYearlyRegionalCurtailment for
    // why sequential was the original slow-load bug) while reducing
    // that contention.
    async function runWithConcurrencyLimit(items, limit, taskFn) {
        const results = new Array(items.length);
        let nextIndex = 0;

        async function worker() {
            while (nextIndex < items.length) {
                const i = nextIndex++;
                results[i] = await taskFn(items[i], i);
            }
        }

        const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
        await Promise.all(workers);
        return results;
    }

    const YEARLY_FETCH_CONCURRENCY = 4;

    // BOA_Volume's unit is confirmed as MW by NESO's own field
    // documentation on the resource page (Table Information ->
    // BOA_Volume -> Unit: "MW") — an average power level for that
    // Settlement_Period, not an energy volume. UK settlement periods
    // are 30 minutes (0.5 hours), so MW x 0.5 = MWh. Used everywhere
    // curtailment is summed into a reported MWh figure — see
    // aggregateGeneratorSumsByRegion.
    const SETTLEMENT_PERIOD_HOURS = 0.5;

    const NESO_SQL_URL = "https://api.neso.energy/api/3/action/datastore_search_sql";


    // ==========================================
    // JSONP helper
    // ==========================================
    // api.neso.energy's own docs demonstrate calling their CKAN API
    // via JSONP (a <script> tag), not a plain fetch/XHR — a strong
    // signal their portal doesn't send CORS headers for normal
    // cross-origin requests. JSONP sidesteps CORS entirely since it's
    // just a <script> load.
    function jsonpRequest(url) {
        return new Promise((resolve, reject) => {
            const callbackName = `__neso_jsonp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            const script = document.createElement("script");
            let settled = false;

            const cleanup = () => {
                // Replaced with a no-op rather than deleted: if this
                // request already timed out (or otherwise settled) but
                // NESO's response arrives late, the <script> tag we
                // already removed can still try to invoke this global
                // function — deleting it outright left nothing there to
                // call, throwing an uncaught "X is not defined" straight
                // into the console. A no-op absorbs that harmlessly.
                window[callbackName] = () => {};
                script.remove();
            };

            window[callbackName] = (data) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(data);
            };

            script.onerror = () => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("JSONP request failed to load: " + url));
            };

            const separator = url.includes("?") ? "&" : "?";
            script.src = `${url}${separator}callback=${callbackName}`;
            document.head.appendChild(script);

            setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("JSONP request timed out: " + url));
            }, 30000); // bumped from 20000 — a historical-year query genuinely hit the old ceiling
        });
    }

    async function runSql(sql) {
        const url = `${NESO_SQL_URL}?sql=${encodeURIComponent(sql)}`;
        const payload = await jsonpRequest(url);
        if (!payload || payload.success === false) {
            throw new Error("NESO SQL query failed: " + sql);
        }
        return (payload.result && payload.result.records) || [];
    }


    // ==========================================
    // Self-healing resource ID resolution (current FY only)
    // ==========================================
    // CONFIRMED BUG SOURCE (for whenever this recurs): NESO does not
    // update a CKAN resource in place when they republish a file —
    // they create a brand-new resource_id and leave the old one
    // listed alongside it. Checked live against
    // https://www.neso.energy/data-portal/wind-bmu-boa-volumes and
    // found TWO different resource IDs both then labeled "Wind BOA
    // Volumes 2025/26" (3b1feda2... and 7bf83942...) — the newer one
    // had silently superseded the older one. The 2026-27 ID currently
    // hardcoded below was independently re-confirmed correct against
    // NESO's live resource page (same ID, same column schema) as of
    // this fix, so it's used as the primary/first attempt (see
    // runSqlForFY) rather than always paying for an extra
    // resolution round-trip — but the same silent-supersession will
    // eventually happen to THIS resource too, which is what this
    // fallback path exists for.
    //
    // Only the CURRENT (in-progress) FY suffers this — past years are
    // closed/stable (their "Last Changed" dates were months/a year
    // old with no duplicates), so they're left on the hardcoded map.
    // For the current FY, resolve the resource ID dynamically via
    // CKAN's package_show, matching by name and preferring whichever
    // matching resource was modified most recently — self-healing
    // against future NESO republishes instead of needing another
    // manual code fix. Falls back to the hardcoded map if resolution
    // itself fails (network issue, package_show shape changes, etc.)
    // rather than breaking entirely.
    const WIND_BOA_PACKAGE_ID = "wind-bmu-boa-volumes";
    const resolvedResourceIdCache = { id: null, cachedAt: 0 };
    const RESOLVED_ID_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

    async function resolveCurrentFYResourceId(fyLabel) {
        const isFresh = resolvedResourceIdCache.id
            && (Date.now() - resolvedResourceIdCache.cachedAt) < RESOLVED_ID_CACHE_TTL_MS;
        if (isFresh) return resolvedResourceIdCache.id;

        const slug = fyLabel.replace("-", "/"); // "2026-27" -> "2026/27"
        const slugUnderscore = fyLabel.replace("-", "_"); // "2026-27" -> "2026_27" — CKAN resource `name` may be the pretty label ("Wind BOA Volumes 2026/27") or the filename-derived form ("boa_data_2026_27.csv"); match either rather than assuming one.
        const url = `https://api.neso.energy/api/3/action/package_show?id=${WIND_BOA_PACKAGE_ID}`;
        const payload = await jsonpRequest(url);

        if (!payload || payload.success === false || !payload.result) {
            throw new Error("package_show failed while resolving current FY resource ID.");
        }

        const allResources = payload.result.resources || [];
        const candidates = allResources.filter(r => {
            const haystack = `${r.name || ""} ${r.url || ""}`;
            return haystack.includes(slug) || haystack.includes(slugUnderscore);
        });

        if (!candidates.length) {
            console.log(
                `Wind curtailment: no resource matched "${slug}"/"${slugUnderscore}" in ${WIND_BOA_PACKAGE_ID}. Available resource names:`,
                allResources.map(r => r.name)
            );
            throw new Error(`No resource found matching "${slug}" in ${WIND_BOA_PACKAGE_ID}.`);
        }

        // Multiple resources can share the same label when NESO
        // republishes without removing the old one — always take
        // whichever was modified most recently.
        candidates.sort((a, b) =>
            new Date(b.metadata_modified || b.last_modified || 0)
            - new Date(a.metadata_modified || a.last_modified || 0)
        );

        resolvedResourceIdCache.id = candidates[0].id;
        resolvedResourceIdCache.cachedAt = Date.now();

        if (candidates.length > 1) {
            console.log(`Wind curtailment: ${candidates.length} resources matched "${slug}" — using the most recently modified (${candidates[0].id}). NESO has duplicate/superseded entries for this period.`);
        }

        return resolvedResourceIdCache.id;
    }

    // ==========================================
    // Query with fallback (current FY only)
    // ==========================================
    // Confirmed directly against NESO's live resource page
    // (https://www.neso.energy/data-portal/wind-bmu-boa-volumes/wind_boa_volumes_202627)
    // that the hardcoded 2026-27 ID and column schema
    // (Date/Generator_Full_Name/BOA_Volume) are currently correct —
    // so that's tried FIRST now, with dynamic package_show-based
    // resolution only attempted if a query against it actually fails.
    // This avoids an unnecessary extra JSONP round-trip on every
    // request in the common/working case, and keeps the dynamic path
    // as a genuine fallback for whenever NESO next republishes this
    // resource under a new ID (confirmed to happen — see the note by
    // resolveCurrentFYResourceId below) rather than the default route
    // every single call goes through.
    //
    // `buildSql` is a function taking a resourceId and returning the
    // SQL string to run against it.
    // A query result "looks real" if either it has no
    // Generator_Full_Name field to check (e.g. the MAX(Date) lookup,
    // which is a different query shape entirely — any non-empty
    // result there is trusted as-is), or at least one row's generator
    // is one we actually recognize as wind. A resource that returns
    // SOME rows but none matching any known wind farm (e.g. only the
    // confirmed non-wind COWB-1) is the exact signature of a
    // stale/superseded resource that's still trickling unrelated data
    // while no longer receiving the real wind feed — this is the bug
    // that was previously slipping past the plain "any rows at all"
    // check, since COWB-1's presence made primaryRows.length > 0 true
    // even though zero actual wind curtailment was present.
    function rowsLookLikeRealData(rows) {
        if (!rows || rows.length === 0) return false;
        const hasGeneratorField = Object.prototype.hasOwnProperty.call(rows[0], "Generator_Full_Name");
        if (!hasGeneratorField) return true;
        return rows.some(r => !!WIND_FARM_COORDS[r.Generator_Full_Name]);
    }

    async function runSqlForFY(fyLabel, buildSql) {
        const primaryId = WIND_BOA_RESOURCE_IDS[fyLabel];

        let primaryRows = null;
        let primaryErr = null;
        try {
            primaryRows = await runSql(buildSql(primaryId));
        } catch (err) {
            primaryErr = err;
        }

        // Success with actual, recognizable data — nothing more to do.
        if (!primaryErr && rowsLookLikeRealData(primaryRows)) {
            return { rows: primaryRows, resourceId: primaryId };
        }

        if (fyLabel !== CURRENT_FY_KEY) {
            // Past years are closed/stable. A thrown error here is a
            // real problem worth surfacing; a genuinely empty result
            // is trusted as-is (e.g. before the season's first
            // curtailment of a brand-new FY) rather than retried.
            if (primaryErr) throw primaryErr;
            return { rows: primaryRows || [], resourceId: primaryId };
        }

        // Current FY: an error, an empty result, OR a non-empty result
        // that contains no recognizable wind data are ALL treated as a
        // signal to re-resolve the live resource ID. This is the
        // important part — NESO superseding a resource (confirmed
        // behavior, see the notes above) doesn't necessarily make
        // queries against the old ID throw, or even return zero rows;
        // the old resource can keep existing and simply stop receiving
        // the real wind feed while unrelated/leftover data (like the
        // non-wind COWB-1) keeps trickling in, which looks like
        // "success with data" to a naive check.
        console.log(
            primaryErr
                ? `Wind curtailment: query against hardcoded resource ${primaryId} failed for FY ${fyLabel} — attempting dynamic resolution as a fallback.`
                : `Wind curtailment: query against hardcoded resource ${primaryId} for FY ${fyLabel} returned ${(primaryRows || []).length} row(s) but none matched a known wind generator — likely a stale/superseded resource. Attempting dynamic resolution as a fallback.`,
            primaryErr || ""
        );

        let resolvedId;
        try {
            resolvedId = await resolveCurrentFYResourceId(fyLabel);
        } catch (resolveErr) {
            console.log(`Wind curtailment: dynamic resolution also failed for FY ${fyLabel}.`, resolveErr);
            if (primaryErr) throw primaryErr;
            return { rows: primaryRows || [], resourceId: primaryId }; // nothing better to fall back to
        }

        if (resolvedId === primaryId) {
            // Resolution confirms the hardcoded ID really is the
            // current one — so the lack of recognizable wind data is
            // genuine, not a stale-ID issue.
            console.log(`Wind curtailment: dynamic resolution confirms ${primaryId} is still the current resource for FY ${fyLabel} — the result is genuine, not a stale-ID issue.`);
            if (primaryErr) throw primaryErr;
            return { rows: primaryRows || [], resourceId: primaryId };
        }

        const secondaryRows = await runSql(buildSql(resolvedId));
        console.log(`Wind curtailment: dynamic resolution found a DIFFERENT current resource ID for FY ${fyLabel} (${resolvedId}, was using ${primaryId}) — retrieved ${secondaryRows.length} row(s). Update WIND_BOA_RESOURCE_IDS to ${resolvedId}.`);
        return { rows: secondaryRows, resourceId: resolvedId };
    }


    // ==========================================
    // Offshore cluster → region (grid connection hub)
    // ==========================================
    // Replaces relying on generic nearest-boundary-distance for known
    // offshore clusters. Distance-to-coastline is a poor proxy for
    // which region an offshore wind farm actually belongs to — real
    // projects export via a specific subsea cable that comes ashore
    // at one particular landfall/converter station, which is often
    // not the closest point on the map to the array itself (e.g.
    // Hornsea's turbines sit in open North Sea water, but the export
    // cables run to a converter station near Killingholme/Salt End
    // and connect into the grid in Yorkshire — that's the correct
    // region regardless of which coastline happens to be nearest in
    // straight-line terms). This table attributes each known offshore
    // cluster directly to the region its actual grid connection sits
    // in, based on each project's public landfall/connection point.
    // Region names must match appState.nationalRegionsLayer's
    // DisplayName values exactly.
    const OFFSHORE_CLUSTER_REGION = {
        // Irish Sea — Heysham / Bootle / Wallasey converter stations
        "Barrow": "North West England",
        "Burbo Bank": "North West England",
        "Ormonde": "North West England",
        "Robin Rigg West": "North West England",
        "Walney 1": "North West England",
        "Walney 2": "North West England",
        "Walney 3": "North West England",
        "Walney 4": "North West England",
        "West of Duddon Sands 1": "North West England",
        "West of Duddon Sands 2": "North West England",

        // North Wales — Bodelwyddan landfall
        "Gwynt y Mor 15": "North Midlands and North Wales",
        "Gwynt y Mor 17": "North Midlands and North Wales",
        "Gwynt y Mor 26": "North Midlands and North Wales",
        "Gwynt y Mor 28": "North Midlands and North Wales",

        // Suffolk/Norfolk landfall (Bramford, Leiston, Walpole, Necton)
        "East Anglia One Part 1": "East of England",
        "East Anglia One Part 2": "East of England",
        "Galloper 1": "East of England",
        "Greater Gabbard 1": "East of England",
        "Greater Gabbard 2": "East of England",
        "Greater Gabbard 3": "East of England",
        "Gunfleet Sands 1": "East of England",
        "Gunfleet Sands 2": "East of England",
        "Race Bank 1": "East of England",
        "Race Bank 2": "East of England",
        "Sheringham Shoal 1": "East of England",
        "Sheringham Shoal 2": "East of England",

        // Kent landfall
        "London Array 1": "South East England",
        "London Array 2": "South East England",
        "London Array 3": "South East England",
        "London Array 4": "South East England",
        "Thanet 1": "South East England",
        "Thanet 2": "South East England",

        // Lincolnshire landfall (Bicker Fen)
        "Triton Knoll East": "East Midlands",
        "Triton Knoll West": "East Midlands",

        // Yorkshire/Humber landfall (Killingholme, Salt End)
        "Hornsea A1": "Yorkshire",
        "Hornsea A2": "Yorkshire",
        "Hornsea A3": "Yorkshire",
        "Hornsea B1": "Yorkshire",
        "Hornsea B2": "Yorkshire",
        "Hornsea B3": "Yorkshire",
        "Westermost Rough": "Yorkshire",

        // Moray Firth landfall (Blackhillock, New Deer)
        "Beatrice 1": "North of Scotland",
        "Beatrice 2": "North of Scotland",
        "Beatrice 3": "North of Scotland",
        "Beatrice 4": "North of Scotland",
        "Moray Firth Eastern 1": "North of Scotland",
        "Moray Firth Eastern 2": "North of Scotland",
        "Moray Firth Eastern 3": "North of Scotland",
        "Moray West 1": "North of Scotland",
        "Moray West 2": "North of Scotland",
        "Moray West 3": "North of Scotland",
        "Moray West 4": "North of Scotland",

        // East Scotland landfall (Tealing/Angus)
        "Seagreen 1": "North of Scotland",
        "Seagreen 2": "North of Scotland",
        "Seagreen 3": "North of Scotland",
        "Seagreen 4": "North of Scotland",
        "Seagreen 5": "North of Scotland",
        "Seagreen 6": "North of Scotland",

        // East Lothian landfall
        "Neart Na Gaoithe 1": "Central and Southern Scotland",
        "Neart Na Gaoithe 2": "Central and Southern Scotland",

        // Shetland HVDC link — lands at Noss Head, Caithness
        "Viking 1": "North of Scotland",
        "Viking 2": "North of Scotland",
        "Viking 3": "North of Scotland",
        "Viking 4": "North of Scotland",

        // Newly-added generators (see WIND_FARM_COORDS additions above)
        "Aberdeen Bay": "North of Scotland", // Blackdog substation
        "Burbo Bank Ext": "North West England",
        "Dudgeon 1": "East of England", "Dudgeon 2": "East of England",
        "Dudgeon 3": "East of England", "Dudgeon 4": "East of England",
        "Galloper 2": "East of England", "Galloper 3": "East of England", "Galloper 4": "East of England",
        "Humber Gateway 1 ": "Yorkshire", // trailing space intentional — matches WIND_FARM_COORDS key exactly
        "Humber Gateway 2": "Yorkshire",
        "Hywind": "North of Scotland", // Peterhead
        "Lincs 1": "East Midlands", "Lincs 2": "East Midlands",
        "Robin Rigg East": "North West England"
    };

    // Looks up a generator's region by name first (explicit hub
    // attribution, most accurate for known offshore clusters), then
    // falls back to coordinate-based resolution (point-in-polygon,
    // then nearest-boundary distance) for anything not in the table
    // above — onshore generators and any offshore project not yet
    // added to OFFSHORE_CLUSTER_REGION.
    function resolveRegionForGenerator(name, lat, lon) {
        if (name && OFFSHORE_CLUSTER_REGION[name]) {
            return OFFSHORE_CLUSTER_REGION[name];
        }
        return resolveRegionForCoords(lat, lon);
    }


    // ==========================================
    // Region resolution
    // ==========================================
    // Point-in-polygon against the site's real 14 region boundaries
    // (appState.nationalRegionsLayer), with a nearest-coastline
    // fallback for offshore wind farms that sit outside every land
    // region polygon.
    function resolveRegionForCoords(lat, lon) {
        if (!appState.nationalRegionsLayer) {
            console.log("Wind curtailment: nationalRegionsLayer not loaded yet — cannot resolve regions.");
            return null;
        }

        const point = turf.point([lon, lat]); // GeoJSON order: [lon, lat]
        let matchedName = null;
        let nearestName = null;
        let nearestDistanceKm = Infinity;

        appState.nationalRegionsLayer.eachLayer(function (layer) {
            if (matchedName || !layer.feature) return;

            if (turf.booleanPointInPolygon(point, layer.feature)) {
                matchedName = layer.feature.properties.DisplayName;
                return;
            }

            try {
                const boundaryLine = turf.polygonToLine(layer.feature);
                // turf.polygonToLine returns a Feature<MultiLineString>
                // (or a FeatureCollection) for MultiPolygon geometries
                // — which ALL 14 of this app's GB regions are, given
                // islands and disconnected coastal areas.
                // pointToLineDistance only accepts a single LineString
                // feature and throws "Invalid input to line, Feature
                // with geometry required" for anything else — which is
                // exactly what was silently breaking this fallback for
                // every single region. turf.flatten splits any
                // Multi*/FeatureCollection into individual
                // single-geometry features so distance can be computed
                // against each disconnected part separately, then the
                // minimum across all of them is the true "distance to
                // this region's boundary" regardless of how many
                // separate landmasses it's made of.
                const flattened = turf.flatten(boundaryLine);
                let localMinKm = Infinity;
                flattened.features.forEach((lineFeature) => {
                    const d = turf.pointToLineDistance(point, lineFeature, { units: "kilometers" });
                    if (d < localMinKm) localMinKm = d;
                });

                if (localMinKm < nearestDistanceKm) {
                    nearestDistanceKm = localMinKm;
                    nearestName = layer.feature.properties.DisplayName;
                }
            } catch (err) {
                // Previously silent — now logged, since a systematic
                // failure here (e.g. turf.polygonToLine choking on a
                // MultiPolygon region boundary) would silently exclude
                // EVERY offshore point from EVERY region without any
                // visible symptom other than "nothing shows up".
                console.log(`Wind curtailment: polygonToLine/pointToLineDistance failed for region "${layer.feature.properties && layer.feature.properties.DisplayName}" — excluded from nearest-distance fallback.`, err);
            }
        });

        if (matchedName) return matchedName;
        // 150km was too tight — several real GB offshore wind farms
        // (Hornsea and similar deep North Sea sites in particular)
        // sit far enough out that their nearest-boundary distance
        // exceeded that cutoff, silently excluding them from every
        // region (both here and in the map markers that reuse this
        // function). GB's exclusive economic zone doesn't extend
        // meaningfully further than this from any coastal region, so
        // 400km comfortably covers genuine offshore sites while still
        // excluding true outliers (e.g. Shetland's Viking wind farm,
        // which isn't really part of the mainland GB transmission
        // network this app models).
        if (nearestName && nearestDistanceKm <= 400) return nearestName;
        return null;
    }


    // ==========================================
    // Shared aggregation core
    // ==========================================
    // Takes { generatorName: summedNegativeVolume } and returns
    // { regionDisplayName: curtailedMWhPositive }.
    function aggregateGeneratorSumsByRegion(generatorSums, contextLabel) {
        const byRegion = {};
        const excludedNonWind = [];
        const unmatchedGenerators = [];
        const unresolvedRegions = [];

        for (const [name, volume] of Object.entries(generatorSums)) {
            if (KNOWN_NON_WIND_GENERATORS[name]) {
                excludedNonWind.push(name);
                continue;
            }
            const coords = WIND_FARM_COORDS[name];
            if (!coords) {
                unmatchedGenerators.push(name);
                continue;
            }
            const [lat, lon] = coords;
            const region = resolveRegionForGenerator(name, lat, lon);
            if (!region) {
                unresolvedRegions.push(name);
                continue;
            }
            // BOA_Volume is confirmed (NESO's own field documentation on
            // the resource page) to be in MW — an average power level
            // for that 30-minute Settlement_Period, not an energy
            // volume. `volume` here is already a SQL-side
            // SUM("BOA_Volume") across however many settlement periods
            // are being grouped (per-day for daily, per-year for
            // yearly), so it's still in MW-equivalent-sum terms.
            // Converting to true energy requires multiplying by the
            // settlement period duration in hours (30 min = 0.5h) —
            // this distributes correctly across the sum regardless of
            // period count: SUM(MW_i) × 0.5h = SUM(MW_i × 0.5h) = MWh.
            // This conversion was previously missing entirely, meaning
            // every curtailment MWh figure shown anywhere in the app
            // (daily/yearly/total) was exactly 2x too high.
            byRegion[region] = (byRegion[region] || 0) + Math.abs(volume) * SETTLEMENT_PERIOD_HOURS;
        }

        if (excludedNonWind.length) {
            console.log(`Wind curtailment (${contextLabel}): ${excludedNonWind.length} generator(s) deliberately excluded (confirmed non-wind — see KNOWN_NON_WIND_GENERATORS).`, excludedNonWind);
        }
        if (unmatchedGenerators.length) {
            console.log(`Wind curtailment (${contextLabel}): ${unmatchedGenerators.length} generator(s) not in WIND_FARM_COORDS — excluded.`, unmatchedGenerators);
        }
        if (unresolvedRegions.length) {
            console.log(`Wind curtailment (${contextLabel}): ${unresolvedRegions.length} generator(s) had coords but no region resolved — excluded.`, unresolvedRegions);
        }

        return byRegion;
    }


    // ==========================================
    // Yearly view — one point per financial year, ~8-9 years
    // ==========================================
    const yearlyCache = { data: null, cachedAt: 0 };
    const YEARLY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — historical years never change; current year updates daily

    const YEARLY_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — historical years are stable; only the current FY updates, and slowly relative to a day

    async function getYearlyRegionalCurtailment(forceRefresh = false) {
        const isFresh = yearlyCache.data && (Date.now() - yearlyCache.cachedAt) < YEARLY_CACHE_TTL_MS;
        if (isFresh && !forceRefresh) return yearlyCache.data;

        // In-flight deduplication: if this is already being fetched
        // (e.g. by the background prefetch in app.js), reuse that SAME
        // promise instead of firing a second, fully redundant set of
        // up to 9 concurrent NESO requests. Without this, a user
        // opening the Curtailment tab while the prefetch was still
        // running would double every request.
        if (yearlyCache.inFlight && !forceRefresh) return yearlyCache.inFlight;

        // Check localStorage before touching the network at all — this
        // is what makes reopening the tab shortly after closing it skip
        // the fetch entirely instead of redoing all 9 years from
        // scratch every single time (see persistentCache.js).
        if (!forceRefresh && window.PersistentCache) {
            const persisted = window.PersistentCache.load("curtailment_yearly_v2", YEARLY_PERSIST_MAX_AGE_MS);
            if (persisted) {
                yearlyCache.data = persisted;
                yearlyCache.cachedAt = Date.now();
                return persisted;
            }
        }

        yearlyCache.inFlight = (async () => {
        // Previously queried each financial year SEQUENTIALLY (a
        // for...of loop with await inside) — with ~9 years and each
        // JSONP round-trip taking anywhere from a few hundred ms to
        // several seconds (one historical-year query was even observed
        // timing out at 20s+), that meant up to 9x the latency of a
        // single query on every first-ever load of the site. THIS was
        // the actual cause of the long "fetching data" wait reported on
        // first visit — subsequent region switches only felt instant
        // because this module-level cache (shared across ALL regions,
        // not per-region) was already warm by then.
        //
        // Running all years concurrently (rather than sequentially)
        // cuts total latency down to roughly the SLOWEST single query
        // instead of the sum of all of them — but capped via
        // runWithConcurrencyLimit rather than fully unbounded, since
        // firing all 9 at once (plus daily + monthly also running
        // around the same time) mostly just queues behind the
        // browser's per-origin connection limit anyway. See the
        // comment on runWithConcurrencyLimit above for the full
        // reasoning.
        const fyLabels = Object.keys(WIND_BOA_RESOURCE_IDS);
        const entries = await runWithConcurrencyLimit(fyLabels, YEARLY_FETCH_CONCURRENCY, async (fyLabel) => {
                // Verified static override for specific years where the
                // live NESO resource is known to be unreliable — e.g.
                // 2025-26's configured resource ID (3b1feda2) is
                // confirmed contaminated with a non-wind generator
                // (COWB-1, see KNOWN_NON_WIND_GENERATORS) and was never
                // corrected upstream. The dynamic re-resolution fallback
                // below only protects the CURRENT financial year — once
                // a year is no longer current, it's a fixed resource ID
                // with no automatic protection, so a known-bad one stays
                // bad indefinitely unless overridden here. This override
                // was built from a manually verified, clean CSV export
                // for the same financial year (178 correct generators,
                // zero contamination, checked directly).
                if (YEARLY_OVERRIDE_URLS[fyLabel]) {
                    try {
                        const response = await fetch(YEARLY_OVERRIDE_URLS[fyLabel]);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const generatorSums = await response.json();
                        console.log(`Wind curtailment: using verified static override for FY ${fyLabel} instead of the live NESO resource.`);
                        return [fyLabel, aggregateGeneratorSumsByRegion(generatorSums, `FY ${fyLabel} (override)`)];
                    } catch (err) {
                        console.log(`Wind curtailment: static override fetch failed for FY ${fyLabel}, falling back to live NESO resource.`, err);
                        // falls through to the normal live fetch below
                    }
                }

                try {
                    const queryResult = await runSqlForFY(fyLabel, (resourceId) => `
                        SELECT "Generator_Full_Name", SUM("BOA_Volume") as total_volume
                        FROM "${resourceId}"
                        WHERE "BOA_Volume" < 0
                        GROUP BY "Generator_Full_Name"
                    `);

                    const generatorSums = {};
                    for (const row of queryResult.rows) {
                        const vol = Number(row.total_volume);
                        if (Number.isFinite(vol)) generatorSums[row.Generator_Full_Name] = vol;
                    }

                    return [fyLabel, aggregateGeneratorSumsByRegion(generatorSums, `FY ${fyLabel}`)];
                } catch (err) {
                    console.log(`Wind curtailment: failed to fetch FY ${fyLabel}`, err);
                    return [fyLabel, null];
                }
            });

        const result = {};
        for (const [fyLabel, byRegion] of entries) {
            if (byRegion) result[fyLabel] = byRegion;
        }

        yearlyCache.data = result;
        yearlyCache.cachedAt = Date.now();
        if (window.PersistentCache) window.PersistentCache.save("curtailment_yearly_v2", result);
        return result;
        })().finally(() => { yearlyCache.inFlight = null; });

        return yearlyCache.inFlight;
    }


    // ==========================================
    // Daily view — last 14 available days, current FY
    // ==========================================
    const dailyCache = { data: null, cachedAt: 0 };
    const DAILY_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
    const DAILY_PERSIST_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — short deliberately: this is a rolling "last 14 days" window that shifts by a day each day, so persisting it too long would show a subtly wrong window. Long enough to help a same-session or shortly-after reopen, short enough to stay honest.

    async function getDailyRegionalCurtailment(forceRefresh = false) {
        const isFresh = dailyCache.data && (Date.now() - dailyCache.cachedAt) < DAILY_CACHE_TTL_MS;
        if (isFresh && !forceRefresh) return dailyCache.data;

        if (dailyCache.inFlight && !forceRefresh) return dailyCache.inFlight;

        if (!forceRefresh && window.PersistentCache) {
            const persisted = window.PersistentCache.load("curtailment_daily", DAILY_PERSIST_MAX_AGE_MS);
            if (persisted) {
                dailyCache.data = persisted;
                dailyCache.cachedAt = Date.now();
                return persisted;
            }
        }

        dailyCache.inFlight = (async () => {
        let resourceId, latestRows;
        try {
            const result = await runSqlForFY(CURRENT_FY_KEY, (id) => `SELECT MAX("Date") as latest_date FROM "${id}"`);
            resourceId = result.resourceId;
            latestRows = result.rows;
        } catch (err) {
            console.log(`Wind curtailment (daily): failed to resolve resource or fetch latest date for FY ${CURRENT_FY_KEY} — showing "no data" rather than an error. NOT caching this failure, so the next load will retry.`, err);
            return {};
        }

        const latestDate = latestRows[0] && latestRows[0].latest_date;
        if (!latestDate) {
            console.log(`Wind curtailment: resource ${resourceId} (FY ${CURRENT_FY_KEY}) returned no rows at all — either genuinely empty this early in the FY, or the resolved resource ID is wrong. Check https://www.neso.energy/data-portal/wind-bmu-boa-volumes for the current live resource ID if this persists. NOT caching this failure.`);
            return {};
        }

        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 13); // 14 days inclusive of latestDate
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        console.log(`Wind curtailment (daily): latest date ${latestDate}, querying from ${cutoffStr}.`);

        const buildDailySql = (id) => `SELECT "Date", "Generator_Full_Name", SUM("BOA_Volume") as total_volume
                     FROM "${id}"
                     WHERE "BOA_Volume" < 0 AND "Date" >= '${cutoffStr}'
                     GROUP BY "Date", "Generator_Full_Name"`;

        let rows;
        try {
            const mainResult = await runSqlForFY(CURRENT_FY_KEY, buildDailySql);
            rows = mainResult.rows;
            resourceId = mainResult.resourceId; // may differ from whatever the MAX(Date) lookup used, if that one also turned out stale
        } catch (err) {
            console.log(`Wind curtailment (daily): main query failed for resource ${resourceId} — showing "no data" rather than an error. NOT caching this failure.`, err);
            return {};
        }

        console.log(`Wind curtailment (daily): using resource ${resourceId}, query returned ${rows.length} row(s) for the last 14 days.`);

        // Group by date first
        const byDate = {}; // { "2026-07-14": { generatorName: volume, ... }, ... }
        for (const row of rows) {
            const date = row.Date;
            const vol = Number(row.total_volume);
            if (!date || !Number.isFinite(vol)) continue;
            byDate[date] = byDate[date] || {};
            byDate[date][row.Generator_Full_Name] = vol;
        }

        const result = {}; // { "2026-07-14": { regionName: mwh, ... }, ... }
        for (const [date, generatorSums] of Object.entries(byDate)) {
            result[date] = aggregateGeneratorSumsByRegion(generatorSums, `daily ${date}`);
        }

        dailyCache.data = result;
        dailyCache.cachedAt = Date.now();
        if (window.PersistentCache) window.PersistentCache.save("curtailment_daily", result);
        return result;
        })().finally(() => { dailyCache.inFlight = null; });

        return dailyCache.inFlight;
    }


    // ==========================================
    // Monthly view — one point per month, current FY
    // ==========================================
    const monthlyCache = { data: null, cachedAt: 0 };
    const MONTHLY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — same reasoning as yearly; a full month's total won't visibly shift within an hour even though the current month is still accumulating
    const MONTHLY_PERSIST_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — same reasoning as daily; the current month's figures keep growing through the day

    async function getMonthlyRegionalCurtailment(forceRefresh = false) {
        const isFresh = monthlyCache.data && (Date.now() - monthlyCache.cachedAt) < MONTHLY_CACHE_TTL_MS;
        if (isFresh && !forceRefresh) return monthlyCache.data;

        if (monthlyCache.inFlight && !forceRefresh) return monthlyCache.inFlight;

        if (!forceRefresh && window.PersistentCache) {
            const persisted = window.PersistentCache.load("curtailment_monthly", MONTHLY_PERSIST_MAX_AGE_MS);
            if (persisted) {
                monthlyCache.data = persisted;
                monthlyCache.cachedAt = Date.now();
                return persisted;
            }
        }

        monthlyCache.inFlight = (async () => {
        // Reuses the EXACT same query shape as the daily view (proven
        // to work) rather than grouping by month in SQL directly. An
        // earlier version used SUBSTRING("Date"::text, 1, 7) to bucket
        // into months server-side, but that silently returned zero
        // rows — most likely because NESO's CKAN datastore_search_sql
        // endpoint runs a restricted SQL dialect that doesn't support
        // that cast/function (many public CKAN SQL endpoints do this
        // for security reasons). Querying at day-level (identical to
        // the daily view, just without its 14-day cutoff) and bucketing
        // into months client-side avoids relying on any SQL feature
        // beyond what's already confirmed to work.
        const buildMonthlySql = (id) => `
            SELECT "Date", "Generator_Full_Name", SUM("BOA_Volume") as total_volume
            FROM "${id}"
            WHERE "BOA_Volume" < 0
            GROUP BY "Date", "Generator_Full_Name"
        `;

        let rows;
        try {
            const result = await runSqlForFY(CURRENT_FY_KEY, buildMonthlySql);
            rows = result.rows;
        } catch (err) {
            console.log(`Wind curtailment (monthly): query failed for FY ${CURRENT_FY_KEY} — showing "no data" rather than an error. NOT caching this failure.`, err);
            return {};
        }

        console.log(`Wind curtailment (monthly): query returned ${rows.length} row(s) for FY ${CURRENT_FY_KEY}.`);

        const byMonth = {}; // { "2026-07": { generatorName: volume, ... }, ... }
        for (const row of rows) {
            const date = row.Date;
            const vol = Number(row.total_volume);
            if (!date || !Number.isFinite(vol)) continue;
            const month = String(date).slice(0, 7); // "2026-07-15" -> "2026-07"
            byMonth[month] = byMonth[month] || {};
            // Multiple days within the same month contribute to the
            // same generator here (unlike the daily view, where each
            // row is already a unique date+generator pair) — accumulate
            // rather than overwrite.
            byMonth[month][row.Generator_Full_Name] = (byMonth[month][row.Generator_Full_Name] || 0) + vol;
        }

        const result = {}; // { "2026-07": { regionName: mwh, ... }, ... }
        for (const [month, generatorSums] of Object.entries(byMonth)) {
            result[month] = aggregateGeneratorSumsByRegion(generatorSums, `monthly ${month}`);
        }

        monthlyCache.data = result;
        monthlyCache.cachedAt = Date.now();
        if (window.PersistentCache) window.PersistentCache.save("curtailment_monthly", result);
        return result;
        })().finally(() => { monthlyCache.inFlight = null; });

        return monthlyCache.inFlight;
    }


    window.getYearlyRegionalCurtailment = getYearlyRegionalCurtailment;
    window.getDailyRegionalCurtailment = getDailyRegionalCurtailment;
    window.getMonthlyRegionalCurtailment = getMonthlyRegionalCurtailment;
    window.WIND_FARM_COORDS = WIND_FARM_COORDS;
    window.resolveRegionForCoords = resolveRegionForCoords;
    window.resolveRegionForGenerator = resolveRegionForGenerator;
    window.runSqlForFY = runSqlForFY;
    window.WIND_BOA_RESOURCE_IDS = WIND_BOA_RESOURCE_IDS;
    window.KNOWN_NON_WIND_GENERATORS = KNOWN_NON_WIND_GENERATORS;
    window.SETTLEMENT_PERIOD_HOURS = SETTLEMENT_PERIOD_HOURS;
    window.CURRENT_FY_KEY = CURRENT_FY_KEY;

})();