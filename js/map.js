// ======================================================
// Map Settings
// ======================================================
//
// Bounds narrowed on the west side now that Northern Ireland is no
// longer a region on the map — the old -8.8 western edge existed to
// fit NI/the Irish Sea; -7.0 still comfortably covers Scotland's
// Outer Hebrides (its westernmost real content) without reserving
// space for content that's no longer drawn. This shifts GB's shapes
// rightward within the still-full-width map div, opening genuine
// blank space on the left for whatever's planned there next — kept
// deliberately modest (not pushed further right) so that space stays
// free rather than the map creeping back into it.

const ukBounds = [

    [49.5,-7.0],
    [60.9,2.0]

];

const ukCentre = [54.5,-2.5];

const ukZoom = 6;


// ======================================================
// Create Map
// ======================================================

const map = L.map("map",{

    maxBounds: ukBounds,

    maxBoundsViscosity:1,

    minZoom:6,

    maxZoom:6,

    scrollWheelZoom:false,

    zoomControl:false

}).setView(ukCentre,ukZoom);


// ======================================================
// Point Features Pane
// ======================================================
//
// Regions (loadRegions) and cities (loadCities) both fetch their
// GeoJSON asynchronously — regions.geojson is much larger, so it
// often finishes loading AFTER cities and gets appended on top of
// them in the DOM, silently blocking hover regardless of any
// bringToFront() call made earlier. That's a race condition, not a
// simple ordering bug, so it can't be fixed reliably by controlling
// call order in app.js.
//
// The real fix: a dedicated pane with a fixed z-index above the
// default overlay pane (where region polygons render). Anything
// added to this pane is GUARANTEED to sit above regions, permanently,
// regardless of load timing — no bringToFront() needed. Use this same
// pane for any future point-feature layer (wind clusters, etc.) so
// they inherit the same guarantee automatically.
map.createPane("pointFeaturesPane");
map.getPane("pointFeaturesPane").style.zIndex = 625;