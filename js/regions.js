// ======================================================
// Region Layer Controller
// ======================================================
//
// NOTE: no longer keeps its own separate lock flag. regionAnimation.js
// already tracks whether a region animation is in progress
// (isRegionAnimationLocked()) — keeping a second, independently-timed
// lock here risked the two drifting out of sync (the old local lock
// unlocked on a fixed setTimeout that didn't match the real exit
// animation duration). Using the same source of truth everywhere
// means "is it safe to select a new region" is answered consistently.

// ======================================================
// Load Regions
// ======================================================

function loadRegions() {

    return fetch("data/neso_regions.geojson")
        .then(response => response.json())
        .then(data => {

            appState.nationalRegionsLayer = L.geoJSON(data, {

                style: {
                    color: "#388e3c",
                    weight: 1,
                    fillColor: "#66bb6a",
                    fillOpacity: 0.35
                },

                onEachFeature: function (feature, layer) {

                    layer.on({

                        mouseover: function () {
                            if (appState.mode === "national") {
                                layer.setStyle({
                                    weight: 3,
                                    fillOpacity: 0.5
                                });
                            }
                        },

                        mouseout: function () {
                            if (appState.mode === "national") {
                                appState.nationalRegionsLayer.resetStyle(layer);
                            }
                        },

                        click: function () {
                            enterRegionFocus(feature);
                        }

                    });

                }

            }).addTo(map);

        });

}


// ======================================================
// Enter Focus Mode
// ======================================================

function enterRegionFocus(feature) {

    if (isRegionAnimationLocked()) {
        return;
    }

    appState.mode = "regional";
    appState.selectedRegion = feature;

    // Dims filter panel / legend text to match the map itself getting
    // greyer/more see-through on region focus — see style.css's
    // body.region-focused rules.
    document.body.classList.add("region-focused");

    if (typeof fadeNationalCities === "function") {
        fadeNationalCities();
    }

    if (typeof hideNationalFacilities === "function") {
        hideNationalFacilities();
    }

    if (typeof hideNationalTurbines === "function") {
        hideNationalTurbines();
    }

    if (typeof hideNationalProductionMarkers === "function") {
        hideNationalProductionMarkers();
    }

    // Fade UK background but highlight selected region
    appState.nationalRegionsLayer.eachLayer(function (layer) {

        if (layer.feature === feature) {

            // Selected region original position
            layer.setStyle({
                color: "#1a591d",
                fillColor: "#377c3b",
                fillOpacity: 0.45,
                weight: 2
            });

        } else {

            // All other regions
            layer.setStyle({
                color: "#388e3c",
                fillColor: "#66bb6a",
                fillOpacity: 0.12,
                weight: 1
            });

        }

    });

    // Create duplicate region
    appState.selectedRegionLayer = L.geoJSON(feature, {
        style: {
            color: "#388e3c",
            weight: 4,
            fillColor: "#66bb6a",
            fillOpacity: 0.9
        }
    }).addTo(map);

    // Animate duplicate — sidebar opens only once it has fully landed
    // (see onComplete below), not immediately on click.
    animateRegionIntoFocus(
        appState.selectedRegionLayer,
        feature.properties.DisplayName,
        null,
        () => {
            openSidebar(feature.properties.DisplayName, "");

            if (typeof DataManager !== "undefined" && DataManager.setActiveRegion) {
                DataManager.setActiveRegion(feature.properties.DisplayName);
            } else {
                console.log("DataManager not available — sidebar will stay empty.");
            }
        }
    );

    // Show cities after duplicate exists
    setTimeout(() => {
        showRegionalCities(feature);
    }, 800);

}


// ======================================================
// Exit Focus Mode
// ======================================================
//
// Called whenever the user clicks the close button — regardless of
// what phase the region's animation is currently in (still pending,
// flying in, sitting in focus, or already flying back out). Uses
// cancelRegionFocus, which always wins immediately rather than being
// subject to the interaction lock, since closing the region that's
// currently open is never a conflicting action.

function exitRegionFocus() {

    closeSidebar();

    document.body.classList.remove("region-focused");

    if (typeof restoreNationalCities === "function") {
        restoreNationalCities();
    }

    if (typeof restoreNationalFacilities === "function") {
        restoreNationalFacilities();
    }

    if (typeof restoreNationalTurbines === "function") {
        restoreNationalTurbines();
    }

    if (typeof restoreNationalProductionMarkers === "function") {
        restoreNationalProductionMarkers();
    }

    if (appState.selectedRegionLayer) {
        cancelRegionFocus(appState.selectedRegionLayer, () => {
            map.removeLayer(appState.selectedRegionLayer);
            appState.selectedRegionLayer = null;
        });
    }

    // Restore UK map
    appState.nationalRegionsLayer.eachLayer(function (layer) {
        layer.setStyle({
            color: "#388e3c",
            fillColor: "#66bb6a",
            fillOpacity: 0.35,
            weight: 1
        });
    });

    appState.mode = "national";
    appState.selectedRegion = null;

    // No setTimeout needed here — cancelRegionFocus resolves the lock
    // synchronously, so the site is immediately ready for a new
    // region selection the moment this function returns.

}