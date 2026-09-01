// ======================================================
// UK Map Settings
// ======================================================

// Approximate UK bounding box
const ukBounds = [
    [49.5, -8.8],
    [60.9, 2.0]
];

const ukCentre = [54.5, -3];
const ukZoom = 6;

// ======================================================
// Global Variables
// ======================================================

let selectedLayer = null;
let regions;

// ======================================================
// Create Map
// ======================================================

const map = L.map("map", {
    maxBounds: ukBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 6,
    maxZoom: 11
}).setView(ukCentre, ukZoom);

// ======================================================
// Load NESO Regions
// ======================================================

fetch("data/neso_regions.geojson")
.then(response => response.json())
.then(data => {

    //--------------------------------------------------
    // Highlight Region
    //--------------------------------------------------

    function highlightFeature(e) {

        const layer = e.target;

        if (layer !== selectedLayer) {

            layer.setStyle({
                weight: 3,
                fillOpacity: 0.6
            });

        }

    }

    //--------------------------------------------------
    // Reset Highlight
    //--------------------------------------------------

    function resetHighlight(e) {

        const layer = e.target;

        if (layer !== selectedLayer) {

            regions.resetStyle(layer);

        }

    }

    //--------------------------------------------------
    // Region Selected
    //--------------------------------------------------

    function selectRegion(feature, layer) {

        layer.on({

            mouseover: highlightFeature,

            mouseout: resetHighlight,

            click: function () {

                // Reset previous selection
                if (selectedLayer) {

                    regions.resetStyle(selectedLayer);

                }

                selectedLayer = layer;

                // Highlight selected region
                layer.setStyle({

                    weight: 4,
                    fillOpacity: 0.8

                });

                // Smooth zoom
                map.flyToBounds(layer.getBounds(), {

                    padding: [50, 50],
                    duration: 1.2

                });

                // Open sidebar
                document
                    .getElementById("sidebar")
                    .classList
                    .remove("hidden");

                // Sidebar title
                document
                    .getElementById("regionTitle")
                    .innerHTML =
                    feature.properties.Name;

                // Sidebar content
                document
                    .getElementById("regionContent")
                    .innerHTML = `

                    <h3>Overview</h3>

                    <p>
                    Region selected successfully.
                    </p>

                    <hr>

                    <h3>Hydrogen Demand</h3>

                    <p>
                    Data coming soon.
                    </p>

                    <hr>

                    <h3>Industrial Sites</h3>

                    <p>
                    Data coming soon.
                    </p>

                `;

            }

        });

    }

    //--------------------------------------------------
    // Create Region Layer
    //--------------------------------------------------

    regions = L.geoJSON(data, {

        style: {

            color: "#333333",
            weight: 1,
            fillColor: "#4CAF50",
            fillOpacity: 0.3

        },

        onEachFeature: selectRegion

    }).addTo(map);

});

// ======================================================
// Load Cities
// ======================================================

fetch("data/uk_cities.geojson")
.then(response => response.json())
.then(data => {

    const cities = L.geoJSON(data, {

        pointToLayer: function (feature, latlng) {

            return L.circleMarker(latlng, {

                radius: 5

            });

        },

        onEachFeature: function (feature, layer) {

            layer.bindTooltip(feature.properties.City, {

                permanent: true,
                direction: "top"

            });

        }

    });

    cities.addTo(map);

});

// ======================================================
// Close Sidebar
// ======================================================

document
.getElementById("closeBtn")
.addEventListener("click", function () {

    document
        .getElementById("sidebar")
        .classList
        .add("hidden");

    if (selectedLayer) {

        regions.resetStyle(selectedLayer);

        selectedLayer = null;

    }

    map.flyTo(ukCentre, ukZoom, {

        duration: 1.2

    });

});