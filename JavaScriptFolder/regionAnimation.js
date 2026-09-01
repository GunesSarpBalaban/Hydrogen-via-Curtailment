// ======================================================
// Region Focus Animation
// ======================================================
//
// Wrapped in an IIFE with a load-guard so that a live-reload tool
// re-injecting this <script> tag on save (instead of doing a full
// page refresh) is a harmless no-op rather than a SyntaxError from
// redeclaring top-level `const`s in the shared global scope.
//
// Exposes on window: animateRegionIntoFocus, animateRegionBack,
// cancelRegionFocus, activeRegionAnimations, isRegionAnimationLocked.

(function () {

    if (window.__regionAnimationLoaded) {
        console.log("regionAnimation.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__regionAnimationLoaded = true;


    // ==========================================
    // Settings
    // ==========================================

    const ANIMATION_DURATION = 3200; // ms, forward (into focus)
    const ANIMATION_EASING = "cubic-bezier(0.3, 0.1, 0.2, 1)";

    // Optional hand-tuning on top of the automatic FLIP scale below.
    const regionScaleOverrides = {
        // "Greater London Area": 1.1,
    };

    // Tracks state per layer. Shape:
    // {
    //   status: 'pending' | 'animating-in' | 'in-focus' | 'animating-out',
    //   timeoutId, regionName, group, clone, scale, animation, cityClones
    // }
    const activeRegionAnimations = new WeakMap();

    // ==========================================
    // Global interaction lock
    // ==========================================
    // While true, no new region may be opened or closed via the
    // normal animateRegionIntoFocus/animateRegionBack path. Enforced
    // INSIDE those two functions, so it holds regardless of how or
    // how fast regions.js calls them.
    //
    // forceCancelRegionAnimation (exposed as cancelRegionFocus) is the
    // one deliberate exception: it always wins immediately, since
    // closing the region that's currently open is never a conflicting
    // action the way selecting a *different* region mid-flight is.
    let animationLocked = false;

    function isRegionAnimationLocked() {
        return animationLocked;
    }


    // ==========================================
    // Teardown — safe to call at any point in any phase
    // ==========================================
    function teardownRegionAnimation(layer) {
        const entry = activeRegionAnimations.get(layer);
        if (!entry) return;

        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        if (entry.animation) entry.animation.cancel();
        if (entry.cityClones) entry.cityClones.forEach(el => el.remove());
        if (entry.facilityClones) entry.facilityClones.forEach(el => el.remove());
        if (entry.turbineClones) entry.turbineClones.forEach(el => el.remove());
        if (entry.group) entry.group.remove();

        activeRegionAnimations.delete(layer);
    }


    // ==========================================
    // Animate Region Into Focus
    // ==========================================
    function animateRegionIntoFocus(layer, regionName, regionFeature, onComplete) {

        if (animationLocked) {
            console.log("Region animation in progress — ignoring selection until it settles.");
            return;
        }
        animationLocked = true;

        teardownRegionAnimation(layer);

        const pendingEntry = { status: "pending", timeoutId: null, regionName };
        activeRegionAnimations.set(layer, pendingEntry);

        pendingEntry.timeoutId = setTimeout(() => {

            const polygon = layer.getLayers()[0];
            const svgPath = polygon._path;

            if (!svgPath) {
                console.log("SVG path unavailable");
                activeRegionAnimations.delete(layer);
                animationLocked = false;
                return;
            }

            const clone = svgPath.cloneNode(true);
            clone.removeAttribute("id");
            clone.style.pointerEvents = "none";
            clone.setAttribute("vector-effect", "non-scaling-stroke");

            const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
            group.style.transformBox = "fill-box";
            group.style.transformOrigin = "center";
            group.style.willChange = "transform";
            group.appendChild(clone);
            svgPath.parentNode.appendChild(group);

            svgPath.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });

            const startBox = svgPath.getBBox();
            const regionCenter = map.latLngToLayerPoint(polygon.getBounds().getCenter());
            const targetCenter = L.point(map.getSize().x * 0.35, map.getSize().y * 0.5);

            const targetLongestSide = Math.min(map.getSize().x, map.getSize().y) * 0.7;
            const currentLongestSide = Math.max(startBox.width, startBox.height);
            const autoScale = targetLongestSide / currentLongestSide;
            const override = regionScaleOverrides[regionName] || 1;
            const scale = autoScale * override;

            const moveX = targetCenter.x - regionCenter.x;
            const moveY = targetCenter.y - regionCenter.y;

            const animation = group.animate(
                [
                    { transform: "translate(0px, 0px) scale(1)" },
                    { transform: `translate(${moveX}px, ${moveY}px) scale(${scale})` }
                ],
                { duration: ANIMATION_DURATION, easing: ANIMATION_EASING, fill: "forwards" }
            );

            const entry = { status: "animating-in", regionName, group, clone, scale, animation, cityClones: [], facilityClones: [], turbineClones: [] };
            activeRegionAnimations.set(layer, entry);

            animation.finished.then(() => {
                animation.commitStyles();
                animation.cancel();
                group.style.willChange = "auto";

                entry.status = "in-focus";
                entry.animation = null;

                animationLocked = false;

                if (typeof onComplete === "function") {
                    onComplete();
                }

                const feature = regionFeature || polygon.feature;
                if (!feature) {
                    console.error("Could not find regionFeature for spatial analysis.");
                    return;
                }
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (typeof showRegionalCities === "function") {
                            showRegionalCities(layer, feature);
                        }
                        if (typeof showRegionalFacilities === "function") {
                            showRegionalFacilities(layer, feature);
                        }
                        if (typeof showRegionalTurbines === "function") {
                            showRegionalTurbines(layer, feature);
                        }
                        if (typeof showRegionalProductionMarkers === "function") {
                            showRegionalProductionMarkers(layer, feature);
                        }
                    });
                });
            }).catch(() => {
                animationLocked = false;
            });

        }, 100);
    }


    // ==========================================
    // Return Region Animation
    // ==========================================
    function animateRegionBack(layer, callback) {

        if (animationLocked) {
            console.log("Region animation in progress — ignoring close until it settles.");
            return;
        }

        const entry = activeRegionAnimations.get(layer);
        const polygon = layer.getLayers()[0];
        const svgPath = polygon._path;

        if (!entry) {
            if (svgPath) svgPath.style.opacity = "1";
            if (callback) callback();
            return;
        }

        if (entry.status === "pending") {
            clearTimeout(entry.timeoutId);
            activeRegionAnimations.delete(layer);
            if (svgPath) svgPath.style.opacity = "1";
            if (callback) callback();
            return;
        }

        if (entry.status === "animating-out") {
            if (callback) callback();
            return;
        }

        animationLocked = true;

        if (entry.animation) entry.animation.cancel();
        if (typeof hideRegionalCities === "function") {
            hideRegionalCities(layer);
        }
        if (typeof hideRegionalFacilities === "function") {
            hideRegionalFacilities(layer);
        }
        if (typeof hideRegionalTurbines === "function") {
            hideRegionalTurbines(layer);
        }
        if (typeof hideRegionalProductionMarkers === "function") {
            hideRegionalProductionMarkers(layer);
        }

        const { group } = entry;
        entry.status = "animating-out";
        group.style.willChange = "transform";

        const anim = group.animate(
            [
                { transform: getComputedStyle(group).transform },
                { transform: "translate(0px, 0px) scale(1)" }
            ],
            { duration: ANIMATION_DURATION * 0.85, easing: ANIMATION_EASING, fill: "forwards" }
        );
        entry.animation = anim;

        anim.finished.then(() => {
            group.remove();
            activeRegionAnimations.delete(layer);
            if (svgPath) svgPath.style.opacity = "1";

            animationLocked = false;

            if (callback) callback();
        }).catch(() => {
            animationLocked = false;
        });
    }


    // ==========================================
    // Force Cancel
    // ==========================================
    // Used when the user explicitly closes the sidebar. Unlike
    // animateRegionBack, this ALWAYS wins immediately regardless of
    // what phase the animation is in (pending / animating-in /
    // animating-out / in-focus) — the interaction lock exists to stop
    // a *different* region selection from interrupting one in
    // progress, but closing the region that's currently open is never
    // a conflicting action, so it shouldn't be subject to that lock.
    function forceCancelRegionAnimation(layer, callback) {
        const polygon = layer.getLayers()[0];
        const svgPath = polygon._path;

        if (typeof hideRegionalCities === "function") {
            hideRegionalCities(layer); // also clears the shared hover tooltip's visible state
        }
        if (typeof hideRegionalFacilities === "function") {
            hideRegionalFacilities(layer); // also clears the shared facility info card's visible state
        }
        if (typeof hideRegionalTurbines === "function") {
            hideRegionalTurbines(layer); // also clears the shared turbine tooltip's visible state
        }
        if (typeof hideRegionalProductionMarkers === "function") {
            hideRegionalProductionMarkers(layer);
        }
        teardownRegionAnimation(layer); // clears timeout, cancels animation, removes group + all clones
        animationLocked = false; // always release — the close action wins outright

        if (svgPath) svgPath.style.opacity = "1";

        if (callback) callback();
    }


    // ==========================================
    // Expose to other script tags
    // ==========================================
    window.animateRegionIntoFocus = animateRegionIntoFocus;
    window.animateRegionBack = animateRegionBack;
    window.cancelRegionFocus = forceCancelRegionAnimation;
    window.activeRegionAnimations = activeRegionAnimations;
    window.teardownRegionAnimation = teardownRegionAnimation;
    window.isRegionAnimationLocked = isRegionAnimationLocked;

})();