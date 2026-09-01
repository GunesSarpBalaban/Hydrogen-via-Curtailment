// ======================================================
// Wind Turbine Layer Management
// ======================================================
//
// Same approach as hydrogenFacilities.js: SVG circleMarkers (so they
// can clone into the region-focus animation's <g> group, same as
// cities), coincident-coordinate jitter, and wiring into the
// existing "Wind Turbines" filter placeholder.
//
// Markers are smaller than the hydrogen facility ones (radius 4 vs
// 7) since there are many more of them and no status/category
// dimension to show — just identifies significant-curtailment
// turbine sites by their NESO code name.
//
// DATA NOTE: several entries here are actually one coordinate shared
// across multiple numbered phases of the same wind farm (e.g.
// Beatrice 1-4, Hornsea A1-B3, Moray West 1-4, London Array 1-4) —
// NESO's source data appears to give one representative location per
// farm rather than per generating unit. jitterCoincidentPoints below
// spreads these into a small ring so all remain clickable, same// technique used for the hydrogen layer's coincident sites.
//
// OFFSHORE ASSOCIATION: showRegionalTurbines falls back to
// window.resolveRegionForGenerator (exposed by windCurtailment.js) to
// assign offshore turbines to a region when they're selected — checks
// an explicit table of each known cluster's real grid connection hub
// first, then falls back to nearest-boundary distance. windCurtailment.js
// must be loaded for this to work, though a missing/failed lookup
// just means offshore turbines are skipped rather than the page
// breaking.
//
// Wrapped in an IIFE with a load-guard, matching cities.js/
// hydrogenFacilities.js, so a live-reload re-inject is a harmless
// no-op.

(function () {

    if (window.__windTurbinesLoaded) {
        console.log("windTurbines.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__windTurbinesLoaded = true;


    // ==========================================
    // Settings
    // ==========================================
    const TURBINE_COLOR = "#13c2c2"; // matches WIND's color in dataManager.js's FUEL_COLORS, for visual consistency across the app
    const MARKER_RADIUS = 4;


    // ==========================================
    // Jitter coincident points
    // ==========================================
    // Identical technique to hydrogenFacilities.js's version. Kept as
    // a separate copy (rather than a shared module) since this
    // codebase loads plain scripts with no bundler/import system —
    // duplicating this ~15 line function is simpler than introducing
    // a shared-utils script just for it.
    const JITTER_RADIUS_DEG = 0.20; // doubled from 0.10 — regional marker radius was later doubled (4px->8px) without revisiting this

    function jitterCoincidentPoints(features) {
        const groups = {};

        features.forEach((f) => {
            const key = f.geometry.coordinates.join(",");
            groups[key] = groups[key] || [];
            groups[key].push(f);
        });

        Object.values(groups).forEach((group) => {
            if (group.length < 2) return;

            group.forEach((f, i) => {
                const angle = (i / group.length) * 2 * Math.PI;
                const [lng, lat] = f.geometry.coordinates;
                f.geometry.coordinates = [
                    lng + JITTER_RADIUS_DEG * Math.cos(angle),
                    lat + JITTER_RADIUS_DEG * Math.sin(angle) * 0.6
                ];
            });
        });
    }


    // ==========================================
    // Marker style
    // ==========================================
    const MARKER_STYLE = {
        radius: MARKER_RADIUS,
        color: "#0e7c7c",
        weight: 1,
        fillColor: TURBINE_COLOR,
        fillOpacity: 0.85,
        pane: "pointFeaturesPane"
    };

    // Fixed on-screen size for regional markers — see
    // regionalMarkers.js for why this replaced the earlier CSS
    // counter-scale approach.
    const REGIONAL_TURBINE_RADIUS = 8; // 2x the national marker's own radius (4)

    // Display-only position override for the REGIONAL (zoomed-in)
    // marker view specifically. Some offshore clusters sit genuinely
    // far out to sea (Hornsea is ~100km+ off the Yorkshire coast) —
    // real, accurate coordinates for curtailment/hydrogen production
    // calculations, but visually they pull the marker composition far
    // out to one side when a region zooms in, making the region's own
    // landmass look off-centre in the frame. This ONLY affects where
    // the dot is drawn in that zoomed regional view; WIND_FARM_COORDS
    // (used everywhere else — national markers, curtailment, region
    // resolution, hydrogen production) is completely untouched, so no
    // data or region-attribution logic is affected, only this one
    // visual.
    const REGIONAL_DISPLAY_POSITION_OVERRIDE = {
        // Hornsea cluster (Yorkshire) — just offshore from North
        // Killingholme, the cluster's real onshore connection point
        // (same reference point used for the hydrogen production
        // cluster override — see hydrogenProduction.js). Pulled much
        // closer to land than the first attempt, which may have still
        // been far enough offshore to fall outside the region-focus
        // animation's visible rendering bounds.
        "Hornsea A1": [53.66, -0.05], "Hornsea A2": [53.66, -0.05], "Hornsea A3": [53.66, -0.05],
        "Hornsea B1": [53.66, -0.05], "Hornsea B2": [53.66, -0.05], "Hornsea B3": [53.66, -0.05],

        // East Anglia / Galloper / Greater Gabbard cluster (East of
        // England) — just offshore from Bramford/Sizewell, the real
        // onshore connection points for this cluster.
        "East Anglia One Part 1": [52.15, 1.35], "East Anglia One Part 2": [52.15, 1.35],
        "Galloper 1": [52.15, 1.5], "Galloper 2": [52.15, 1.5], "Galloper 3": [52.15, 1.5], "Galloper 4": [52.15, 1.5],
        "Greater Gabbard 1": [52.18, 1.45], "Greater Gabbard 2": [52.18, 1.45], "Greater Gabbard 3": [52.18, 1.45],

        // London Array / Gunfleet Sands cluster (South East England) —
        // just offshore from Cleve Hill, the real onshore connection
        // point for London Array.
        "London Array 1": [51.4, 1.0], "London Array 2": [51.4, 1.0], "London Array 3": [51.4, 1.0], "London Array 4": [51.4, 1.0],
        "Gunfleet Sands 1": [51.55, 1.1], "Gunfleet Sands 2": [51.55, 1.1]
    };


    // ==========================================
    // National background visibility (region-focus hide/show)
    // ==========================================
    // See hydrogenFacilities.js's identical pair of functions for the
    // full reasoning — checks the filter's live state via
    // isFilterOn("wind") rather than a remembered snapshot, since the
    // toggle can now be flipped while a region is open too.
    function hideNationalTurbines() {
        if (!appState.windTurbineLayer) return;
        if (map.hasLayer(appState.windTurbineLayer)) {
            map.removeLayer(appState.windTurbineLayer);
        }
    }

    function restoreNationalTurbines() {
        if (!appState.windTurbineLayer) return;
        const isOn = typeof isFilterOn === "function" && isFilterOn("wind");
        if (isOn) {
            appState.windTurbineLayer.addTo(map);
        }
    }


    // ==========================================
    // Load Wind Turbines
    // ==========================================
    function loadWindTurbines() {

        return fetch("data/wind_turbines.geojson")

            .then(response => response.json())

            .then(data => {

                jitterCoincidentPoints(data.features);

                appState.windTurbineLayer = L.geoJSON(data, {

                    pointToLayer: function (feature, latlng) {
                        return L.circleMarker(latlng, MARKER_STYLE);
                    },

                    onEachFeature: function (feature, layer) {
                        layer.bindTooltip(feature.properties.name, { direction: "top" });
                        // Leaflet's own equivalent of the SVG "move to
                        // end of siblings" trick — without this, a
                        // marker hovered while sitting close to others
                        // could stay visually buried under its
                        // neighbours for the whole hover.
                        layer.on("mouseover", () => layer.bringToFront());
                    }

                });
                // Not added to the map here — starts hidden nationally,
                // matching the "Wind Turbines" filter's defaultOn:false.

                if (typeof registerFilter === "function") {
                    registerFilter("wind", "Wind Turbines", {
                        defaultOn: false,
                        onToggle: (isOn) => {
                            if (!appState.windTurbineLayer) return;

                            const regionOpen = appState.mode === "regional"
                                && appState.selectedRegionLayer
                                && appState.selectedRegion;

                            if (regionOpen) {
                                if (isOn) {
                                    showRegionalTurbines(appState.selectedRegionLayer, appState.selectedRegion);
                                } else {
                                    hideRegionalTurbines(appState.selectedRegionLayer);
                                }
                            } else if (isOn) {
                                appState.windTurbineLayer.addTo(map);
                            } else {
                                map.removeLayer(appState.windTurbineLayer);
                            }
                        }
                    });
                } else {
                    console.log("registerFilter not available — wind turbine layer loaded but not wired to filter panel.");
                }

            });

    }


    // ==========================================
    // Show Turbines Inside Selected Region
    // ==========================================
    const TURBINE_REGIONS_PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week — a turbine's region is a fixed geometric fact, doesn't change day to day; long window is safe

    let triedLoadingPersistedTurbineRegions = false;

    // Applies a previously-saved {generatorName: region} map to every
    // turbine BEFORE the per-turbine lazy-resolve loop runs, so a
    // cache hit here means the very first click after a reload is as
    // fast as every click after it — not just the first click within
    // the current session.
    function applyPersistedTurbineRegions() {
        if (triedLoadingPersistedTurbineRegions) return;
        triedLoadingPersistedTurbineRegions = true;

        if (!window.PersistentCache || !appState.windTurbineLayer) return;
        const persisted = window.PersistentCache.load("turbine_regions", TURBINE_REGIONS_PERSIST_MAX_AGE_MS);
        if (!persisted) return;

        let applied = 0;
        appState.windTurbineLayer.eachLayer((turbine) => {
            const props = turbine.feature && turbine.feature.properties;
            const name = props ? props.name : "";
            if (props && props.__resolvedRegion === undefined && Object.prototype.hasOwnProperty.call(persisted, name)) {
                props.__resolvedRegion = persisted[name];
                applied++;
            }
        });
        console.log(`Wind turbines: applied ${applied} persisted region assignment(s) from localStorage — skipping live computation for those.`);
    }

    function showRegionalTurbines(layer, regionFeature) {
        if (!appState.windTurbineLayer) return;

        if (typeof isFilterOn === "function" && !isFilterOn("wind")) return;

        applyPersistedTurbineRegions();

        const animated = window.activeRegionAnimations.get(layer);
        if (!animated) {
            console.log("No active region animation for this layer — call showRegionalTurbines after animateRegionIntoFocus completes.");
            return;
        }

        if (typeof window.createRegionalPointMarker !== "function") {
            console.log("createRegionalPointMarker not available — is regionalMarkers.js loaded?");
            return;
        }

        if (animated.turbineClones && animated.turbineClones.length) {
            animated.turbineClones.forEach(el => el.remove());
        }
        animated.turbineClones = [];

        const { group, scale } = animated;

        let computedSomethingNew = false;

        appState.windTurbineLayer.eachLayer(function (turbine) {
            const props = turbine.feature && turbine.feature.properties;
            const name = props ? props.name : "";

            // Lazy compute-once-and-cache: resolves each turbine's
            // region the first time it's actually needed (i.e. the
            // first region click after page load), then reuses that
            // cached result for every click afterward — for ANY
            // region, not just this one. This deliberately does NOT
            // precompute eagerly at page load (an earlier version did,
            // via a dedicated precomputeTurbineRegions step run from
            // app.js) — that made initial page load noticeably slower
            // for every visitor, whether they ever clicked a region or
            // not. This way the cost is only paid if/when it's
            // actually useful, and only once.
            if (props && props.__resolvedRegion === undefined) {
                props.__resolvedRegion = typeof window.resolveRegionForGenerator === "function"
                    ? window.resolveRegionForGenerator(name, turbine.getLatLng().lat, turbine.getLatLng().lng)
                    : null;
                computedSomethingNew = true;
            }

            const matches = props
                ? props.__resolvedRegion === (regionFeature.properties && regionFeature.properties.DisplayName)
                : false;

            if (!matches) return;

            const displayOverride = REGIONAL_DISPLAY_POSITION_OVERRIDE[name];
            if (displayOverride) {
                console.log(`Wind turbines: "${name}" matched region "${regionFeature.properties && regionFeature.properties.DisplayName}", using display override [${displayOverride[0]}, ${displayOverride[1]}] instead of its real coordinate.`);
            }
            const displayLatLng = displayOverride
                ? L.latLng(displayOverride[0], displayOverride[1])
                : turbine.getLatLng();

            const marker = window.createRegionalPointMarker({
                group,
                groupScale: scale,
                latlng: displayLatLng,
                targetRadius: REGIONAL_TURBINE_RADIUS,
                style: {
                    fill: TURBINE_COLOR,
                    stroke: "#0e7c7c",
                    strokeWidth: 1,
                    fillOpacity: 0.85
                },
                onMouseEnter: (el) => {
                    if (!name) return;
                    if (window.hideAllHoverPopups) window.hideAllHoverPopups();
                    const tooltip = window.getSharedTurbineTooltip ? window.getSharedTurbineTooltip() : null;
                    if (!tooltip) return;
                    tooltip.textContent = name;
                    const rect = el.getBoundingClientRect();
                    tooltip.style.left = `${rect.left + rect.width / 2}px`;
                    tooltip.style.top = `${rect.top - 8}px`;
                    tooltip.classList.add("visible");
                },
                onMouseMove: (el) => {
                    if (!name) return;
                    const tooltip = window.getSharedTurbineTooltip ? window.getSharedTurbineTooltip() : null;
                    if (!tooltip) return;
                    const rect = el.getBoundingClientRect();
                    tooltip.style.left = `${rect.left + rect.width / 2}px`;
                    tooltip.style.top = `${rect.top - 8}px`;
                },
                onMouseLeave: () => {
                    if (window.getSharedTurbineTooltip) {
                        window.getSharedTurbineTooltip().classList.remove("visible");
                    }
                }
            });

            animated.turbineClones.push(marker);
        });

        if (computedSomethingNew && window.PersistentCache) {
            const fullMap = {};
            appState.windTurbineLayer.eachLayer((turbine) => {
                const props = turbine.feature && turbine.feature.properties;
                if (props && props.name && props.__resolvedRegion !== undefined) {
                    fullMap[props.name] = props.__resolvedRegion;
                }
            });
            window.PersistentCache.save("turbine_regions", fullMap);
        }
    }


    // ==========================================
    // Hide Regional Turbines
    // ==========================================
    function hideRegionalTurbines(layer) {
        const animated = window.activeRegionAnimations.get(layer);
        if (!animated || !animated.turbineClones) return;
        animated.turbineClones.forEach(el => el.remove());
        animated.turbineClones = [];
        if (window.getSharedTurbineTooltip) {
            window.getSharedTurbineTooltip().classList.remove("visible");
        }
    }


    // ==========================================
    // Shared tooltip
    // ==========================================
    // Same small floating-label pattern cities.js uses for its hover
    // tooltip, with its own style injection (rather than assuming
    // cities.js's .city-hover-tooltip style block already exists —
    // that block is only injected the first time a city is actually
    // hovered, so relying on it here would break if a turbine is
    // hovered first).
    let turbineTooltipEl = null;

    function getSharedTurbineTooltip() {
        if (turbineTooltipEl) return turbineTooltipEl;

        turbineTooltipEl = document.createElement("div");
        turbineTooltipEl.className = "turbine-hover-tooltip";
        document.body.appendChild(turbineTooltipEl);

        const style = document.createElement("style");
        style.textContent = `
            .turbine-hover-tooltip {
                position: fixed;
                transform: translate(-50%, -100%);
                background: #ffffff;
                color: #222;
                font: 13px/1.4 Arial, Helvetica, sans-serif;
                font-weight: 600;
                padding: 5px 10px;
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.18);
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
                white-space: nowrap;
                z-index: 1000;
            }
            .turbine-hover-tooltip.visible {
                opacity: 1;
            }
            .turbine-hover-tooltip::after {
                content: "";
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 6px solid transparent;
                border-top-color: #ffffff;
            }
        `;
        document.head.appendChild(style);

        return turbineTooltipEl;
    }
    window.getSharedTurbineTooltip = getSharedTurbineTooltip;
    if (window.registerHoverHideCallback) {
        window.registerHoverHideCallback(() => getSharedTurbineTooltip().classList.remove("visible"));
    }


    // ==========================================
    // Expose to other script tags
    // ==========================================
    window.loadWindTurbines = loadWindTurbines;
    window.showRegionalTurbines = showRegionalTurbines;
    window.hideRegionalTurbines = hideRegionalTurbines;
    window.hideNationalTurbines = hideNationalTurbines;
    window.restoreNationalTurbines = restoreNationalTurbines;

})();