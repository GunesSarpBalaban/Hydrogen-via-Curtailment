// ======================================================
// City Layer Management
// ======================================================
//
// Relies on `window.activeRegionAnimations`, exposed by
// regionAnimation.js, so make sure that script tag loads first.
//
// Wrapped in an IIFE with a load-guard so a live-reload tool
// re-injecting this <script> tag on save (instead of doing a full
// page refresh) is a harmless no-op rather than a SyntaxError from
// redeclaring top-level `let`/`const` in the shared global scope.

(function () {

    if (window.__citiesLoaded) {
        console.log("cities.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__citiesLoaded = true;


    // ==========================================
    // Settings
    // ==========================================

    const excludedCityNames = ["London"]; // see showRegionalCities notes below

    // Fixed on-screen radius for regional clones — see
    // regionalMarkers.js for why this replaced the old
    // CITY_MARKER_SCALE_MULTIPLIER approach (it never actually
    // corrected for the region group's zoom scale, which is why
    // regional city dots were reported as too big).
    const REGIONAL_CITY_RADIUS = 12; // 2x the national marker's own radius (6)


    // ==========================================
    // National visibility toggle
    // ==========================================
    // Controls the ORIGINAL city markers on the base national map —
    // separate from the per-region clones created by
    // showRegionalCities, which are unaffected by this toggle and
    // keep working the same way regardless of its state.
    let nationalCitiesVisible = false;

    // Separate dimming applied while a region is focused, layered on
    // top of the toggle above — see fadeNationalCities/
    // restoreNationalCities below.
    const FADE_OPACITY = 0.12;

    function setNationalCitiesVisible(visible) {
        nationalCitiesVisible = visible;
        if (!appState.cityLayer) return;

        const regionOpen = appState.mode === "regional"
            && appState.selectedRegionLayer
            && appState.selectedRegion;

        if (regionOpen) {
            // A region is currently focused — update its own city
            // markers directly (the national layer stays faded
            // throughout focus regardless of this toggle, per
            // fadeNationalCities).
            if (visible) {
                showRegionalCities(appState.selectedRegionLayer, appState.selectedRegion);
            } else {
                hideRegionalCities(appState.selectedRegionLayer);
            }
            return;
        }

        const targetOpacity = visible ? 1 : 0;
        appState.cityLayer.eachLayer(function (layer) {
            layer.setStyle({
                opacity: targetOpacity,
                fillOpacity: targetOpacity
            });
        });
    }

    function toggleNationalCities() {
        setNationalCitiesVisible(!nationalCitiesVisible);
    }

    // Called when a region enters focus — dims (rather than fully
    // hides) the national markers so attention shifts to the zoomed-in
    // region's own city clones. Only does anything if the national
    // layer is actually currently visible; no-ops otherwise.
    function fadeNationalCities() {
        if (!nationalCitiesVisible || !appState.cityLayer) return;
        appState.cityLayer.eachLayer(function (layer) {
            layer.setStyle({ opacity: FADE_OPACITY, fillOpacity: FADE_OPACITY });
        });
    }

    // Called when a region exits focus — restores the national layer
    // to whatever the toggle's current state actually is (handles the
    // edge case where the toggle was flipped while a region was open).
    function restoreNationalCities() {
        if (!appState.cityLayer) return;
        const targetOpacity = nationalCitiesVisible ? 1 : 0;
        appState.cityLayer.eachLayer(function (layer) {
            layer.setStyle({ opacity: targetOpacity, fillOpacity: targetOpacity });
        });
    }


    // ==========================================
    // Load Cities
    // ==========================================
    function loadCities() {

        return fetch("data/uk_cities.geojson")

            .then(response => response.json())

            .then(data => {

                appState.cityLayer = L.geoJSON(data, {

                    pointToLayer: function (feature, latlng) {

                        return L.circleMarker(latlng, {
                            radius: 6,
                            color: "#4a4a4a",
                            weight: 1.5,
                            fillColor: "#ffffff",
                            pane: "pointFeaturesPane",
                            // Start invisible — matches the pre-existing
                            // per-region behavior. setNationalCitiesVisible
                            // controls this independently once toggled on.
                            opacity: nationalCitiesVisible ? 1 : 0,
                            fillOpacity: nationalCitiesVisible ? 1 : 0
                        });

                    },

                    onEachFeature: function (feature, layer) {

                        layer.bindTooltip(feature.properties.City, {
                            direction: "top"
                        });

                    }

                }).addTo(map); // Added to map here to generate SVG paths (_path)

                // Regions and cities share one SVG stacking order —
                // whichever layer was added to the map more recently
                // sits on top and intercepts pointer events first. This
                // guarantees city markers stay on top and receive hover
                // events, regardless of when loadRegions() runs relative
                // to this.
                appState.cityLayer.bringToFront();

                // Smooth fade transition for opacity changes (toggle,
                // region-focus dim/restore) — Leaflet's setStyle()
                // changes the SVG opacity attributes directly, which
                // only animates if the element's own CSS declares a
                // transition for it.
                appState.cityLayer.eachLayer(function (layer) {
                    if (layer._path) {
                        layer._path.style.transition = "opacity 0.3s ease, fill-opacity 0.3s ease";
                    }
                });

            });

    }


    // ==========================================
    // Shared tooltip element (created once, reused)
    // ==========================================
    let cityTooltipEl = null;
    let currentlyHighlightedCity = null; // tracks which element to reset when hiding via the shared hover registry — cities apply their highlight directly to the element (fill/stroke-width), unlike the shared-tooltip-only types

    function getCityTooltip() {
        if (cityTooltipEl) return cityTooltipEl;

        cityTooltipEl = document.createElement("div");
        cityTooltipEl.className = "city-hover-tooltip";
        document.body.appendChild(cityTooltipEl);

        const style = document.createElement("style");
        style.textContent = `
            .city-hover-tooltip {
                position: fixed;
                transform: translate(-50%, -100%);
                background: #ffffff;
                color: #222;
                font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
            .city-hover-tooltip.visible {
                opacity: 1;
            }
            .city-hover-tooltip::after {
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

        return cityTooltipEl;
    }

    function positionCityTooltip(targetEl) {
        const tooltip = getCityTooltip();
        const rect = targetEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 8}px`;
    }


    // ==========================================
    // Show Cities Inside Selected Region
    // ==========================================
    function showRegionalCities(layer, regionFeature) {
        if (!appState.cityLayer) {
            return;
        }

        // Respect the current toggle even when called unconditionally
        // at region-open time (see regionAnimation.js) — if "City
        // Labels" is off, this is a no-op.
        if (!nationalCitiesVisible) {
            return;
        }

        const animated = window.activeRegionAnimations.get(layer);
        if (!animated) {
            console.log("No active region animation for this layer — call showRegionalCities after animateRegionIntoFocus completes.");
            return;
        }

        if (typeof window.createRegionalPointMarker !== "function") {
            console.log("createRegionalPointMarker not available — is regionalMarkers.js loaded?");
            return;
        }

        // Idempotent: clear any existing clones first so re-calling
        // this (e.g. toggling off then on again while the same region
        // is open) never duplicates markers.
        if (animated.cityClones && animated.cityClones.length) {
            animated.cityClones.forEach(el => el.remove());
        }
        animated.cityClones = [];

        const { group, scale } = animated;

        appState.cityLayer.eachLayer(function (city) {
            const cityName = city.feature && city.feature.properties
                ? city.feature.properties.City
                : "";

            if (cityName && excludedCityNames.some(n => n.toLowerCase() === cityName.toLowerCase())) {
                return;
            }

            const point = turf.point([
                city.getLatLng().lng,
                city.getLatLng().lat
            ]);
            const inside = turf.booleanPointInPolygon(point, regionFeature);
            if (!inside) {
                return;
            }

            const marker = window.createRegionalPointMarker({
                group,
                groupScale: scale,
                latlng: city.getLatLng(),
                targetRadius: REGIONAL_CITY_RADIUS,
                style: {
                    fill: "#ffffff",
                    stroke: "#4a4a4a",
                    strokeWidth: 1.5,
                    fillOpacity: 1
                },
                onMouseEnter: (el) => {
                    if (window.hideAllHoverPopups) window.hideAllHoverPopups();
                    el.setAttribute("fill", "#ff5a36");
                    el.setAttribute("stroke-width", "2");
                    currentlyHighlightedCity = el;

                    if (cityName) {
                        const tooltip = getCityTooltip();
                        tooltip.textContent = cityName;
                        positionCityTooltip(el);
                        tooltip.classList.add("visible");
                    }
                },
                onMouseMove: (el) => {
                    positionCityTooltip(el);
                },
                onMouseLeave: (el) => {
                    el.setAttribute("fill", "#ffffff");
                    el.setAttribute("stroke-width", "1.5");
                    if (currentlyHighlightedCity === el) currentlyHighlightedCity = null;
                    getCityTooltip().classList.remove("visible");
                }
            });

            animated.cityClones.push(marker);
        });
    }


    // ==========================================
    // Hide Cities
    // ==========================================
    function hideRegionalCities(layer) {
        const animated = window.activeRegionAnimations.get(layer);
        if (!animated || !animated.cityClones) {
            return;
        }
        animated.cityClones.forEach(el => el.remove());
        animated.cityClones = [];
        getCityTooltip().classList.remove("visible");
    }


    // ==========================================
    // Expose to other script tags
    // ==========================================
    window.loadCities = loadCities;
    window.showRegionalCities = showRegionalCities;
    window.hideRegionalCities = hideRegionalCities;
    window.toggleNationalCities = toggleNationalCities;
    window.setNationalCitiesVisible = setNationalCitiesVisible;
    window.fadeNationalCities = fadeNationalCities;
    window.restoreNationalCities = restoreNationalCities;
    window.bringCitiesToFront = function () {
        if (appState.cityLayer) appState.cityLayer.bringToFront();
    };

    if (window.registerHoverHideCallback) {
        window.registerHoverHideCallback(() => {
            if (currentlyHighlightedCity) {
                currentlyHighlightedCity.setAttribute("fill", "#ffffff");
                currentlyHighlightedCity.setAttribute("stroke-width", "1.5");
                currentlyHighlightedCity = null;
            }
            getCityTooltip().classList.remove("visible");
        });
    }

})();