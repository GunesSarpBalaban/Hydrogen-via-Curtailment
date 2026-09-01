// ======================================================
// Persistent Cache (localStorage)
// ======================================================
//
// Shared save/load helpers so data survives a page reload within a
// reasonable time window, not just the current in-memory session.
// Every other cache in this codebase (dailyCache, yearlyCache,
// windCapacity's cache, etc.) is a plain JS variable — and JS
// variables reset completely on every reload, by definition. That
// means closing and reopening the tab, even seconds later, was
// re-fetching and re-computing everything from scratch every time.
// This is what actually fixes that.
//
// localStorage's quota (typically 5-10MB per origin, shared across
// ALL keys together, not per-key) means not everything necessarily
// fits. Rather than a global budget/eviction scheme, each dataset
// just attempts to save independently — whichever ones fit, persist;
// whichever don't (quota exceeded), fail gracefully and simply
// re-fetch next load, exactly like before this existed. Nothing
// breaks either way, per explicit instruction: fit what fits, leave
// the rest to reload as before.
//
// Used by windCurtailment.js, windCapacity.js, hydrogenDemand.js,
// hydrogenProduction.js, and windTurbines.js — each passes its own
// max-age matched to how quickly ITS data actually goes stale (a
// rolling "last 14 days" window needs a short one; REPD-derived
// capacity data or turbine region assignments barely change and can
// safely persist much longer).

(function () {
    if (window.PersistentCache) {
        console.log("persistentCache.js already loaded — skipping re-init (likely a live-reload re-inject).");
        return;
    }

    const PREFIX = "site_cache_"; // namespaced so this doesn't collide with anything else on the same origin

    function save(key, data) {
        const payload = JSON.stringify({ cachedAt: Date.now(), data });
        const sizeKB = Math.round(payload.length / 1024);
        try {
            localStorage.setItem(PREFIX + key, payload);
            console.log(`PersistentCache: saved "${key}" (${sizeKB} KB).`);
            return true;
        } catch (err) {
            // Quota exceeded (shared across ALL keys on this origin) or
            // storage disabled (private browsing) — not fatal.
            // Whatever tries to save next still gets its own
            // independent attempt; THIS dataset just won't persist and
            // re-fetches next load, same as before this layer existed.
            console.warn(`PersistentCache: FAILED to save "${key}" (${sizeKB} KB) — will re-fetch next load instead of persisting. Likely quota exceeded (shared across everything cached this way) or storage disabled.`, err);
            return false;
        }
    }

    function load(key, maxAgeMs) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const ageMs = Date.now() - (parsed.cachedAt || 0);
            if (!parsed.cachedAt || ageMs > maxAgeMs) {
                console.log(`PersistentCache: "${key}" found but expired (${Math.round(ageMs / 60000)} min old, max age ${Math.round(maxAgeMs / 60000)} min) — re-fetching.`);
                return null;
            }
            console.log(`PersistentCache: loaded "${key}" from cache (${Math.round(ageMs / 60000)} min old) — skipping fetch entirely.`);
            return parsed.data;
        } catch (err) {
            console.log(`PersistentCache: failed to read "${key}" — will re-fetch.`, err);
            return null;
        }
    }

    function remove(key) {
        try { localStorage.removeItem(PREFIX + key); } catch (err) { /* ignore — nothing to clean up if storage is unavailable */ }
    }

    window.PersistentCache = { save, load, remove };
})();