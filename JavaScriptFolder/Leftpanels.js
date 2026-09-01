// ======================================================
// Left Panel Collapse/Expand
// ======================================================
//
// Wires up the "«" collapse button on each of the three left-side
// panels (Filter Panel, Hydrogen Legend, Live Grid Widget). Clicking
// slides the panel left via CSS (.collapsed class, see style.css) —
// but not fully off-screen: the collapse button's own width stays
// visible at the edge, so there's always a way to reopen the panel by
// clicking it again. A one-way "vanish with no way back short of
// reloading the page" felt like a real usability trap, so this is a
// toggle rather than a pure one-time dismiss — the arrow itself flips
// direction (« when open, » when collapsed) to make the current state
// and the next click's effect obvious.
//
// Wrapped in an IIFE with a load-guard, matching this codebase's other
// scripts.

(function () {

    if (window.__leftPanelsLoaded) {
        console.log("leftPanels.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }
    window.__leftPanelsLoaded = true;

    function initPanelCollapse() {
        const buttons = document.querySelectorAll(".panel-collapse-btn");
        buttons.forEach((btn) => {
            const panelId = btn.getAttribute("data-panel");
            const panel = document.getElementById(panelId);
            if (!panel) return;

            btn.addEventListener("click", (e) => {
                e.stopPropagation(); // don't let the click also register on the map/panel behind it
                const isCollapsed = panel.classList.toggle("collapsed");
                btn.innerHTML = isCollapsed ? "&raquo;" : "&laquo;";
                btn.title = isCollapsed ? "Show panel" : "Hide panel";
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initPanelCollapse);
    } else {
        initPanelCollapse();
    }

})();