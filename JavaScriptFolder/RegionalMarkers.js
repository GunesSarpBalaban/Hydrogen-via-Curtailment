// ======================================================
// Regional Point Marker Helper
// ======================================================
//
// Shared by cities.js, hydrogenFacilities.js, and windTurbines.js for
// drawing point markers inside a focused region's animated SVG group.
//
// PREVIOUS APPROACH (removed): each of those three files cloned its
// national circleMarker's <path> element, then tried to counter-scale
// it back down with a CSS transform (transform-box:fill-box). That
// was fragile in practice — bounding-box computation for an arc-drawn
// <path> isn't fully consistent across browsers, and composing two
// independently-applied CSS transforms (the group's scale × the
// clone's own counter-scale) was hard to reason about and produced
// inconsistent, sometimes wildly-off results (cities: no correction
// at all → too big; hydrogen/wind: miscalculated correction → too
// small).
//
// THIS APPROACH: draw a brand new plain SVG <circle> instead, with
// its radius computed directly as `targetRadius / groupScale`, so
// that once the GROUP's own CSS scale is applied on top, the final
// on-screen radius works out to exactly targetRadius — regardless of
// how much that particular region happened to be magnified. A
// <circle>'s radius scales by simple multiplication under any
// ancestor transform, so this composes predictably with no
// bounding-box ambiguity.
//
// vector-effect="non-scaling-stroke" keeps stroke width (and dash
// pattern, per spec) constant on screen for the same reason.

(function () {

    if (window.__regionalMarkersLoaded) {
        console.log("regionalMarkers.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__regionalMarkersLoaded = true;

    const SVG_NS = "http://www.w3.org/2000/svg";

    // options:
    //   group        the animated <g> element to append into
    //   groupScale   the region's current CSS scale factor (animated.scale from regionAnimation.js)
    //   latlng       L.LatLng of the point
    //   targetRadius desired FIXED on-screen radius in px, regardless of groupScale
    //   style        { fill, stroke, strokeWidth, fillOpacity, dashArray }
    //   onMouseEnter, onMouseMove, onMouseLeave   optional, called with the created <circle> element
    function createRegionalPointMarker(options) {
        const {
            group,
            groupScale,
            latlng,
            targetRadius,
            style = {},
            onMouseEnter,
            onMouseMove,
            onMouseLeave
        } = options;

        const p = map.latLngToLayerPoint(latlng);
        const radius = targetRadius / groupScale;

        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", p.x);
        circle.setAttribute("cy", p.y);
        circle.setAttribute("r", radius);
        circle.setAttribute("fill", style.fill || "#333333");
        circle.setAttribute("fill-opacity", style.fillOpacity != null ? style.fillOpacity : 1);
        circle.setAttribute("stroke", style.stroke || "#ffffff");
        circle.setAttribute("stroke-width", style.strokeWidth != null ? style.strokeWidth : 1.5);
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        if (style.dashArray) {
            circle.setAttribute("stroke-dasharray", style.dashArray);
        }
        circle.style.pointerEvents = "auto";
        circle.style.cursor = "pointer";

        if (onMouseEnter) circle.addEventListener("mouseenter", () => {
            // SVG stacking is pure DOM order (no z-index support the
            // way regular HTML has) — appendChild on an element already
            // in the DOM moves it to the end of its parent's children,
            // which is what makes it render on top of its siblings.
            // Without this, a marker sitting close to others stayed
            // visually buried under them for the whole hover, making it
            // hard to tell exactly which one the tooltip belonged to.
            circle.parentNode.appendChild(circle);
            onMouseEnter(circle);
        });
        if (onMouseMove) circle.addEventListener("mousemove", () => onMouseMove(circle));
        if (onMouseLeave) circle.addEventListener("mouseleave", () => onMouseLeave(circle));

        group.appendChild(circle);
        return circle;
    }

    window.createRegionalPointMarker = createRegionalPointMarker;

    // ==========================================
    // Shared hover-popup registry
    // ==========================================
    // Each marker type (turbines, hydrogen facilities, cities, etc.)
    // has its own independent popup/tooltip with no awareness of the
    // others. When two markers of DIFFERENT types sit close together —
    // common in a region view — the cursor can enter the second
    // marker's hit area slightly before leaving the first's, and since
    // neither system knew the other existed, both stayed visible at
    // once. Each type registers its own "hide me" function here once
    // at load time, and calls window.hideAllHoverPopups() at the start
    // of its own onMouseEnter — clearing every other type's leftover
    // popup before showing its own, so only one is ever visible
    // regardless of which type triggered it.
    const hoverHideCallbacks = [];
    function registerHoverHideCallback(fn) {
        hoverHideCallbacks.push(fn);
    }
    function hideAllHoverPopups() {
        hoverHideCallbacks.forEach(fn => fn());
    }
    window.registerHoverHideCallback = registerHoverHideCallback;
    window.hideAllHoverPopups = hideAllHoverPopups;

})();