// ======================================================
// Hydrogen Facility Layer Management
// ======================================================
//
// Renders UK hydrogen-consuming facilities as SVG circleMarkers
// (same primitive cities.js uses) in the shared pointFeaturesPane,
// rather than HTML divIcon markers. This is deliberate: only SVG
// elements can be cloned into the region-focus animation's <g> group
// (see regionAnimation.js), so circleMarkers are what let these
// facility markers travel with a region when it animates into focus,
// exactly like city dots already do.
//
// Category is shown via fill/stroke color; operating status via
// marker treatment (solid = operating, faded grey = closed, dashed
// stroke = planned/trial).
//
// COINCIDENT COORDINATES: several real facilities share literally
// the same site (e.g. Saltend Chemicals Park / INEOS Acetyls /
// Mitsubishi Chemical / Saltend Power Station are all ~53.730,-0.260)
// which stacked markers exactly on top of each other and made the
// underlying ones unclickable. jitterCoincidentPoints() nudges each
// member of a coincident group into a small ring around the true
// point, in-memory only — the source geojson keeps accurate
// coordinates.
//
// Wired into the existing filter panel: replaces the "Hydrogen
// Facilities" placeholder registered in Filters.js's
// initDefaultFilters() with a real onToggle, once the layer exists
// (registerFilter is designed to be called again — see its own
// comments). No changes needed in Filters.js.
//
// Wrapped in an IIFE with a load-guard, matching cities.js/filters.js,
// so a live-reload re-inject is a harmless no-op.

(function () {

    if (window.__hydrogenFacilitiesLoaded) {
        console.log("hydrogenFacilities.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__hydrogenFacilitiesLoaded = true;


    // ==========================================
    // Category → color mapping
    // ==========================================
    const HYDROGEN_CATEGORIES = {
        refining:        { label: "Refining",          color: "#4A5859" },
        ammonia:         { label: "Ammonia Production", color: "#7C9885" },
        industrialHeat:  { label: "Industrial Heat",     color: "#C1502E" },
        otherChemicals:  { label: "Other Chemicals",     color: "#5B7C99" },
        blending:        { label: "Pipeline Blending",   color: "#8B6F47" },
        powerGeneration: { label: "Power Generation",    color: "#D4A017" }
    };


    // ==========================================
    // Jitter coincident points
    // ==========================================
    // Groups features by exact [lng,lat] match and, for any group of
    // 2+, spreads them evenly around a small ring so markers don't
    // stack. Mutates feature.geometry.coordinates in place, in memory
    // only, before the geojson is handed to Leaflet.
    const JITTER_RADIUS_DEG = 0.28; // doubled from 0.14 — regional marker radius was later doubled (7px->14px) without revisiting this, leaving coincident clusters (e.g. Yorkshire's 4-facility Saltend group) still overlapping in the region view

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
                    lat + JITTER_RADIUS_DEG * Math.sin(angle) * 0.6 // flatten slightly — lat degrees cover more screen distance than lng at UK latitudes
                ];
            });
        });
    }


    // ==========================================
    // Marker style (national view)
    // ==========================================
    function getMarkerStyle(category, status) {
        const cat = HYDROGEN_CATEGORIES[category] || HYDROGEN_CATEGORIES.otherChemicals;

        // Fill opacity kept well below city markers' solid fillOpacity:1
        // (see cities.js) so facility markers read as a lighter,
        // secondary data overlay rather than competing visually with
        // the base city layer — stroke stays solid/full weight so
        // markers are still clearly identifiable, only the fill is
        // translucent.
        const style = {
            radius: 7,
            color: cat.color,
            weight: 2,
            fillColor: cat.color,
            fillOpacity: 0.55,
            pane: "pointFeaturesPane"
        };

        if (status === "closed") {
            style.color = "#999";
            style.weight = 1.5;
            style.fillOpacity = 0.18;
        } else if (status === "planned") {
            style.dashArray = "3,3";
            style.fillOpacity = 0.35;
        }

        return style;
    }


    // ==========================================
    // Regional clone sizing
    // ==========================================
    // Fixed on-screen radius for markers drawn inside a focused
    // region — see regionalMarkers.js for why this replaced the
    // earlier CSS counter-scale approach (it composed unpredictably
    // and rendered markers far smaller than intended).
    const REGIONAL_FACILITY_RADIUS = 14; // 2x the national marker's own radius (7) — regional view has far fewer markers competing for space, so a larger size reads better


    // ==========================================
    // National background visibility (region-focus hide/show)
    // ==========================================
    // Distinct from the filter panel's on/off toggle: while a region
    // is focused, the national layer is fully hidden regardless of
    // the toggle's state (rather than just dimmed, like cities.js
    // does), and restored based on whatever the toggle's CURRENT
    // state is once the region closes — checked live via
    // isFilterOn("hydrogen") rather than a remembered snapshot, since
    // the toggle can now also be flipped while a region is open (see
    // registerFilter's onToggle below), which would make a snapshot
    // taken at focus-open time stale.
    function hideNationalFacilities() {
        if (!appState.hydrogenLayer) return;
        if (map.hasLayer(appState.hydrogenLayer)) {
            map.removeLayer(appState.hydrogenLayer);
        }
    }

    function restoreNationalFacilities() {
        if (!appState.hydrogenLayer) return;
        const isOn = typeof isFilterOn === "function" && isFilterOn("hydrogen");
        if (isOn) {
            appState.hydrogenLayer.addTo(map);
        }
    }


    // ==========================================
    // Popup content (national view — real Leaflet popups,
    // since national markers ARE positioned correctly by Leaflet)
    // ==========================================
    function buildPopup(props) {
        const badgeClass = `hf-popup__badge--${props.status}`;
        const badgeLabel = props.status === "operating" ? "Operating"
                          : props.status === "closed" ? "Closed"
                          : "Planned";

        return `
            <div class="hf-popup">
                <p class="hf-popup__name">${props.name}</p>
                <p class="hf-popup__meta">${props.operator}</p>
                <p class="hf-popup__meta">${props.location}</p>
                <span class="hf-popup__badge ${badgeClass}">${badgeLabel}</span>
                ${props.note ? `<p class="hf-popup__note">${props.note}</p>` : ""}
            </div>
        `;
    }


    // ==========================================
    // Shared info card for REGIONAL clones
    // ==========================================
    // Regional clones are plain SVG <path> nodes living inside the
    // animated group — their on-screen position only matches the
    // group's CSS transform, not their real Leaflet lat/lng, so a
    // normal Leaflet popup would show up in the wrong place. Same
    // problem cities.js solves with its hover tooltip; this is the
    // same technique, just with richer content since facilities carry
    // more info than a city name.
    let facilityCardEl = null;

    function getFacilityCard() {
        if (facilityCardEl) return facilityCardEl;

        facilityCardEl = document.createElement("div");
        facilityCardEl.className = "facility-info-card";
        document.body.appendChild(facilityCardEl);

        const style = document.createElement("style");
        style.textContent = `
            .facility-info-card {
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
                max-width: 220px;
            }
            .facility-info-card.visible {
                opacity: 1;
            }
            .facility-info-card__name {
                font-weight: 700;
                margin: 0 0 2px;
            }
            .facility-info-card__meta {
                font-size: 11.5px;
                color: #555;
                margin: 0 0 4px;
            }
            .facility-info-card__badge {
                display: inline-block;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                padding: 2px 7px;
                border-radius: 100px;
                margin-bottom: 4px;
            }
            .facility-info-card__note {
                font-size: 11.5px;
                color: #333;
                border-top: 1px solid #eee;
                padding-top: 4px;
                margin: 4px 0 0;
            }
        `;
        document.head.appendChild(style);

        return facilityCardEl;
    }

    const BADGE_COLORS = {
        operating: ["#e3f2e6", "#1e6b34"],
        closed: ["#eee", "#666"],
        planned: ["#fdf2d9", "#8a6414"]
    };

    function showFacilityCard(targetEl, props) {
        if (window.hideAllHoverPopups) window.hideAllHoverPopups();
        const card = getFacilityCard();
        const [bg, fg] = BADGE_COLORS[props.status] || BADGE_COLORS.operating;
        const badgeLabel = props.status === "operating" ? "Operating"
                          : props.status === "closed" ? "Closed"
                          : "Planned";

        card.innerHTML = `
            <p class="facility-info-card__name">${props.name}</p>
            <p class="facility-info-card__meta">${props.operator}</p>
            <p class="facility-info-card__meta">${props.location}</p>
            <span class="facility-info-card__badge" style="background:${bg};color:${fg};">${badgeLabel}</span>
            ${props.note ? `<p class="facility-info-card__note">${props.note}</p>` : ""}
        `;

        positionFacilityCard(targetEl);
        card.classList.add("visible");
    }

    function positionFacilityCard(targetEl) {
        const card = getFacilityCard();
        const rect = targetEl.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect(); // measurable even at opacity:0 since it's not display:none
        const margin = 12;

        // Vertical: default above the marker; flip below if there's
        // not enough room above. This was the actual bug — for any
        // marker near the top of the viewport, the card (positioned
        // entirely above its target) rendered with a negative/
        // off-screen top position and was effectively invisible even
        // though the hover event fired correctly.
        const spaceAbove = rect.top;
        if (spaceAbove < cardRect.height + margin) {
            card.style.top = `${rect.bottom + margin}px`;
            card.style.transform = "translate(-50%, 0)";
        } else {
            card.style.top = `${rect.top}px`;
            card.style.transform = "translate(-50%, calc(-100% - 12px))";
        }

        // Horizontal: clamp within the viewport so the card never
        // renders partly off-screen near the left/right edges.
        const halfWidth = (cardRect.width || 220) / 2;
        const idealLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.min(
            Math.max(idealLeft, halfWidth + margin),
            window.innerWidth - halfWidth - margin
        );
        card.style.left = `${clampedLeft}px`;
    }

    function hideFacilityCard() {
        if (facilityCardEl) facilityCardEl.classList.remove("visible");
    }


    // ==========================================
    // Load Hydrogen Facilities
    // ==========================================
    function loadHydrogenFacilities() {

        return fetch("data/hydrogen_facilities.geojson")

            .then(response => response.json())

            .then(data => {

                jitterCoincidentPoints(data.features);

                appState.hydrogenLayer = L.geoJSON(data, {

                    pointToLayer: function (feature, latlng) {
                        const props = feature.properties;
                        return L.circleMarker(latlng, getMarkerStyle(props.category, props.status));
                    },

                    onEachFeature: function (feature, layer) {
                        layer.bindPopup(buildPopup(feature.properties));
                    }

                });
                // Deliberately NOT added to the map here — starts
                // hidden nationally, matching the "Hydrogen Facilities"
                // filter's defaultOn:false. registerFilter's onToggle
                // (below) adds/removes it from the map. Regional
                // reveal (showRegionalFacilities) is independent of
                // this toggle, same as cities.

                if (typeof registerFilter === "function") {
                    registerFilter("hydrogen", "Hydrogen Facilities", {
                        defaultOn: false,
                        onToggle: (isOn) => {
                            if (!appState.hydrogenLayer) return;

                            const regionOpen = appState.mode === "regional"
                                && appState.selectedRegionLayer
                                && appState.selectedRegion;

                            if (regionOpen) {
                                // A region is currently focused — its
                                // markers are a separate set drawn
                                // into the animated group, not the
                                // national layer (which stays hidden
                                // throughout focus, see
                                // hideNationalFacilities). Update that
                                // set directly instead.
                                if (isOn) {
                                    showRegionalFacilities(appState.selectedRegionLayer, appState.selectedRegion);
                                } else {
                                    hideRegionalFacilities(appState.selectedRegionLayer);
                                }
                            } else if (isOn) {
                                appState.hydrogenLayer.addTo(map);
                            } else {
                                map.removeLayer(appState.hydrogenLayer);
                            }
                        }
                    });
                } else {
                    console.log("registerFilter not available — hydrogen layer loaded but not wired to filter panel.");
                }

            });

    }


    // ==========================================
    // Show Facilities Inside Selected Region
    // ==========================================
    // Mirrors cities.js's showRegionalCities: clones each facility's
    // SVG path into the animated region's <g> group so it travels
    // with the region's fly-in/scale animation, regardless of whether
    // the national "Hydrogen Facilities" toggle is currently on.
    function showRegionalFacilities(layer, regionFeature) {
        if (!appState.hydrogenLayer) return;

        // Respect the current filter state even when called
        // unconditionally at region-open time (see regionAnimation.js)
        // — if "Hydrogen Facilities" is off, this is a no-op.
        if (typeof isFilterOn === "function" && !isFilterOn("hydrogen")) return;

        const animated = window.activeRegionAnimations.get(layer);
        if (!animated) {
            console.log("No active region animation for this layer — call showRegionalFacilities after animateRegionIntoFocus completes.");
            return;
        }

        if (typeof window.createRegionalPointMarker !== "function") {
            console.log("createRegionalPointMarker not available — is regionalMarkers.js loaded?");
            return;
        }

        // Idempotent: clear any existing clones first so re-calling
        // this (e.g. toggling the filter off then on again while the
        // same region is open) never duplicates markers.
        if (animated.facilityClones && animated.facilityClones.length) {
            animated.facilityClones.forEach(el => el.remove());
        }
        animated.facilityClones = [];

        const { group, scale } = animated;

        // Collect matches first rather than creating markers directly
        // inside eachLayer, so they can be sorted by status priority
        // before being added to the DOM. SVG paint order follows DOM
        // order, and later elements capture pointer events over
        // earlier ones even where visually transparent — so for
        // overlapping/jittered clusters (e.g. the Saltend group),
        // whichever facility happened to iterate last before was
        // capturing hover for the whole overlapping area regardless of
        // which one a user visually intended to hover. Sorting so
        // "operating" facilities are added last (drawn on top, highest
        // hover priority) matches both visual and interaction intent —
        // the most relevant/prominent marker should be the one that
        // responds.
        const STATUS_PAINT_PRIORITY = { closed: 0, planned: 1, operating: 2 };
        const matches = [];

        appState.hydrogenLayer.eachLayer(function (facility) {
            const props = facility.feature ? facility.feature.properties : {};

            const point = turf.point([
                facility.getLatLng().lng,
                facility.getLatLng().lat
            ]);
            const inside = turf.booleanPointInPolygon(point, regionFeature);
            if (!inside) return;

            matches.push({ facility, props });
        });

        matches.sort((a, b) =>
            (STATUS_PAINT_PRIORITY[a.props.status] || 0) - (STATUS_PAINT_PRIORITY[b.props.status] || 0)
        );

        matches.forEach(({ facility, props }) => {
            const cat = HYDROGEN_CATEGORIES[props.category] || HYDROGEN_CATEGORIES.otherChemicals;
            const isClosed = props.status === "closed";
            const isPlanned = props.status === "planned";

            const marker = window.createRegionalPointMarker({
                group,
                groupScale: scale,
                latlng: facility.getLatLng(),
                targetRadius: REGIONAL_FACILITY_RADIUS,
                style: {
                    fill: cat.color,
                    stroke: isClosed ? "#999999" : "#ffffff",
                    strokeWidth: isClosed ? 1.2 : 2,
                    fillOpacity: isClosed ? 0.2 : (isPlanned ? 0.4 : 0.6),
                    dashArray: isPlanned ? "3,3" : null
                },
                onMouseEnter: (el) => showFacilityCard(el, props),
                onMouseMove: (el) => positionFacilityCard(el),
                onMouseLeave: () => hideFacilityCard()
            });

            animated.facilityClones.push(marker);
        });
    }


    // ==========================================
    // Hide Regional Facilities
    // ==========================================
    function hideRegionalFacilities(layer) {
        const animated = window.activeRegionAnimations.get(layer);
        if (!animated || !animated.facilityClones) return;
        animated.facilityClones.forEach(el => el.remove());
        animated.facilityClones = [];
        hideFacilityCard();
    }


    // ==========================================
    // Expose to other script tags
    // ==========================================
    window.loadHydrogenFacilities = loadHydrogenFacilities;
    window.showRegionalFacilities = showRegionalFacilities;
    window.hideRegionalFacilities = hideRegionalFacilities;
    window.hideNationalFacilities = hideNationalFacilities;
    window.restoreNationalFacilities = restoreNationalFacilities;
    window.HYDROGEN_CATEGORIES = HYDROGEN_CATEGORIES;
    if (window.registerHoverHideCallback) {
        window.registerHoverHideCallback(hideFacilityCard);
    }

})();