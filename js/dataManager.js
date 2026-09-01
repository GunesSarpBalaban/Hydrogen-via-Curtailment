// ======================================================
// Centralized Data Manager & Registry (Region-Specific)
// ======================================================

(function () {
    if (window.__dataManagerLoaded) return;
    window.__dataManagerLoaded = true;

    if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
        Chart.register(ChartDataLabels);
    }

    // Runtime state tracking
    const state = {
        activeRegion: null,
        activeDatasetKey: "greenProduction", // Default tab/view
        curtailmentViewMode: "daily", // 'daily' | 'monthly' | 'yearly' | 'total'
        windCapacityViewMode: "historical", // 'historical' | 'projected'
        hydrogenDemandViewMode: "trend", // 'trend' | 'bySector' | 'trade'
        hydrogenProductionViewMode: "daily", // 'daily' | 'monthly' | 'yearly' | 'total'
        cache: {} // Cache structure: { "Region Name": { greenProduction: data, ... } }
    };

    // ==========================================
    // String Normalizer / Name Mapping Engine
    // ==========================================
    // IMPORTANT: keyed against the site's REAL region DisplayName
    // values (from data/neso_regions.geojson / regionAnimation.js's
    // regionScales table), not a guessed naming scheme. An earlier
    // version of this map used assumed names that didn't match the
    // site's actual regions, so almost every lookup fell through to
    // the "|| 1" fallback below — silently showing North Scotland's
    // data for nearly every region. This is why simply falling back
    // to a default ID is dangerous: prefer surfacing "no data" over
    // silently substituting a different region's data.
    function getNormalizedRegionKey(regionName) {
        if (!regionName) return "";
        return regionName.toLowerCase().trim().replace(/\s+/g, " ");
    }

    // Maps the site's actual 15 region DisplayNames to NESO's Carbon
    // Intensity API region IDs. Two mappings are best-guesses pending
    // confirmation (marked below) since the site's region names don't
    // exactly match NESO's official region naming:
    //   - "North Midlands and North Wales" -> assumed to be NESO's
    //     "North Wales & Merseyside" (id 6)
    //   - "Midlands" -> assumed to be "West Midlands" (id 8), since
    //     "East Midlands" is already separately named on this map
    // Northern Ireland has NO entry — NESO's Carbon Intensity API only
    // covers Great Britain (England/Scotland/Wales), not NI, which has
    // a separate grid operator (SONI). Handled explicitly in fetchData
    // below rather than silently defaulting to another region.
    const nesoRegionIds = {
        "north east england": 4,
        "yorkshire": 5,
        "north west england": 3,
        "east midlands": 9,
        "north midlands and north wales": 6, // best guess — please confirm
        "east of england": 10,
        "greater london area": 13,
        "south east england": 14,
        "south west england": 11,
        "south central england": 12,
        "north of scotland": 1,
        "central and southern scotland": 2,
        "south wales": 7,
        "midlands": 8 // best guess — please confirm
    };

    // Fixed color per fuel type so the pie chart stays visually
    // consistent across regions/refreshes rather than reassigning
    // colors based on whatever order the API happens to return.
    const FUEL_COLORS = {
        GAS: "#8c8c8c",
        COAL: "#262626",
        NUCLEAR: "#722ed1",
        WIND: "#13c2c2",
        HYDRO: "#1890ff",
        IMPORTS: "#fa8c16",
        BIOMASS: "#52c41a",
        SOLAR: "#fadb14",
        OTHER: "#d9d9d9",
        STORAGE: "#eb2f96",
        RENEWABLE: "#52c41a"
    };
    const GREEN_FUELS = ["WIND", "SOLAR", "HYDRO", "NUCLEAR", "BIOMASS"];

    // Formats NESO's "from"/"to" UTC timestamps into a readable local
    // date + time range, e.g. "27 Jul 2026, 14:00–14:30". Falls back
    // gracefully if either field is missing or unparseable.
    function formatDataPeriod(fromISO, toISO) {
        if (!fromISO) return null;
        const from = new Date(fromISO);
        if (isNaN(from.getTime())) return null;

        const dateStr = from.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
        const fromTime = from.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

        let toTime = "";
        if (toISO) {
            const to = new Date(toISO);
            if (!isNaN(to.getTime())) {
                toTime = "–" + to.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            }
        }

        return `${dateStr}, ${fromTime}${toTime}`;
    }

    // ==========================================
    // The Dataset Registry
    // ==========================================
    const DATASET_REGISTRY = {
        greenProduction: {
            title: "Live Energy Generation Mix",
            description: "What's actually generating this region's electricity right now — gas, wind, solar, nuclear and more. Updated live from National Energy System Operator data.",
            fetchData: async (regionName) => {
                const key = getNormalizedRegionKey(regionName);
                const id = nesoRegionIds[key];

                if (!id) {
                    // No silent fallback — surfaces genuinely unmapped
                    // names rather than masking them with wrong data.
                    return { unavailable: true, reason: `No region mapping found for "${regionName}".` };
                }

                const response = await fetch(`https://api.carbonintensity.org.uk/regional/regionid/${id}`);
                if (!response.ok) throw new Error("Failed to load production data.");
                return await response.json();
            },
            transform: (rawData) => {
                if (rawData.unavailable) {
                    return {
                        chartType: "doughnut",
                        labels: ["NO DATA"],
                        values: [100],
                        colors: [FUEL_COLORS.OTHER],
                        yAxisLabel: "",
                        summaryValue: rawData.reason
                    };
                }

                const regionWrapper = rawData.data && rawData.data[0] ? rawData.data[0] : {};
                const dataBlock = regionWrapper.data && regionWrapper.data[0] ? regionWrapper.data[0] : {};
                const mix = dataBlock.generationmix || [];

                // The half-hour settlement period this snapshot covers —
                // NESO returns these as UTC ISO strings (e.g.
                // "2026-07-27T14:00Z"). Formatted in the viewer's local
                // time since that's more immediately meaningful than UTC.
                const dataAsOf = formatDataPeriod(dataBlock.from, dataBlock.to);

                const labels = [];
                const rawValues = [];
                const colors = [];
                const isGreen = [];

                mix.forEach(item => {
                    if (item.perc <= 0) return;
                    const fuelLabel = item.fuel.toUpperCase();
                    labels.push(fuelLabel);
                    rawValues.push(item.perc);
                    colors.push(FUEL_COLORS[fuelLabel] || FUEL_COLORS.OTHER);
                    isGreen.push(GREEN_FUELS.includes(fuelLabel));
                });

                // NESO's API returns each fuel's perc pre-rounded to 1
                // decimal, so summing them commonly lands a bit off 100
                // (e.g. 100.1%) — a rounding artifact of the source data,
                // not a real difference. Rescale proportionally so the
                // displayed slices always sum to exactly 100%.
                const rawSum = rawValues.reduce((a, b) => a + b, 0);
                const values = rawSum > 0
                    ? rawValues.map(v => Number(((v / rawSum) * 100).toFixed(1)))
                    : rawValues;

                // Derived from the same normalized values, so the badge
                // stays consistent with what the chart actually shows.
                const greenTotal = values.reduce((sum, v, i) => isGreen[i] ? sum + v : sum, 0);

                return {
                    chartType: "doughnut",
                    labels: labels.length ? labels : ["NO LIVE DATA"],
                    values: values.length ? values : [100],
                    colors: colors.length ? colors : [FUEL_COLORS.OTHER],
                    yAxisLabel: "Generation Share (%)",
                    dataAsOf: dataAsOf,
                    summaryValue: `${greenTotal.toFixed(1)}% Zero-Carbon Live`
                };
            }
        },

        curtailments: {
            title: "Wind Curtailment",
            description: "How much wind power gets switched off in this region because the grid can't use it all right now. Only wind is covered here for now — solar and other types aren't tracked yet.",
            fetchData: async (regionName) => {
                if (typeof getDailyRegionalCurtailment !== "function" || typeof getMonthlyRegionalCurtailment !== "function") {
                    throw new Error("Wind curtailment module not loaded.");
                }

                // Yearly deliberately NOT fetched here — it involves up
                // to 9 separate NESO requests (one per financial year,
                // each a genuinely separate database table with no way
                // to combine them into one call), and eagerly fetching
                // all of them for someone who only wanted to see Daily
                // curtailment was wasteful. Now lazy-loaded only when
                // the user actually switches to Yearly/Total mode — see
                // ensureYearlyLoaded, called from renderCurtailmentChart.
                const [dailyAll, monthlyAll] = await Promise.all([
                    getDailyRegionalCurtailment(),
                    getMonthlyRegionalCurtailment()
                ]);

                const daily = Object.entries(dailyAll)
                    .map(([date, regions]) => ({ label: date, value: Number((regions[regionName] || 0).toFixed(1)) }))
                    .sort((a, b) => a.label.localeCompare(b.label));

                const monthly = Object.entries(monthlyAll)
                    .map(([month, regions]) => ({ label: month, value: Number((regions[regionName] || 0).toFixed(1)) }))
                    .sort((a, b) => a.label.localeCompare(b.label));

                // GB-wide context for the last-14-days window: total
                // MWh curtailed across ALL regions, and which regions
                // had any. UK wind curtailment is heavily concentrated
                // — geographically (overwhelmingly Scottish regions,
                // due to transmission constraints out of Scotland) and
                // temporally (specific windy days, not spread evenly
                // every day) — so "no curtailment for Region X in the
                // last 14 days" is very often genuinely correct, not a
                // broken pipeline. This context makes that immediately
                // distinguishable in the UI itself: if the GB-wide
                // total is also zero, something's actually broken; if
                // it's not, this specific region simply had none.
                let gbWideDailyTotal = 0;
                const regionsWithDailyData = new Set();
                for (const regions of Object.values(dailyAll)) {
                    for (const [rName, mwh] of Object.entries(regions)) {
                        if (mwh > 0) {
                            gbWideDailyTotal += mwh;
                            regionsWithDailyData.add(rName);
                        }
                    }
                }

                console.log(`Curtailment (last 14 days): GB-wide total ${gbWideDailyTotal.toFixed(1)} MWh across ${regionsWithDailyData.size} region(s):`, Array.from(regionsWithDailyData).sort());
                console.log(`Curtailment: "${regionName}" specifically —`, daily.filter(d => d.value > 0).length, "day(s) with data out of", daily.length, "day(s) total.");

                return {
                    daily,
                    monthly,
                    yearly: null, // not fetched yet — see ensureYearlyLoaded
                    regionName, // needed by ensureYearlyLoaded, since it's called later without regionName in scope
                    gbWideDailyTotal: Number(gbWideDailyTotal.toFixed(1)),
                    regionsWithDailyDataCount: regionsWithDailyData.size,
                    hasAnyData: daily.length > 0 || monthly.length > 0
                };
            },
            transform: (rawData) => {
                // Curtailment gets a dedicated multi-view renderer
                // (see renderCurtailmentChart) instead of a single
                // static chart config, so the person can flip between
                // Daily / Yearly / Total without a full re-fetch.
                return {
                    isCurtailmentView: true,
                    bundle: rawData,
                    summaryValue: rawData.hasAnyData
                        ? "Select a time period below"
                        : "No curtailment data available for this region"
                };
            }
        },

        windCapacity: {
            title: "Wind Capacity",
            description: "How much wind power has been built in this region over time, and our estimate of what's coming next based on projects already in the pipeline. The chart shows the running total each year, not just what got added that year.",
            fetchData: async (regionName) => {
                if (typeof getRegionalWindCapacity !== "function") {
                    throw new Error("Wind capacity module not loaded.");
                }
                const all = await getRegionalWindCapacity();
                return all[regionName] || {
                    historical: {},
                    pipelineMW: 0,
                    pipelineByStage: {},
                    avgAnnualMW: 0,
                    projection: {}
                };
            },
            transform: (rawData) => {
                const hasHistory = Object.values(rawData.historical).some(v => v > 0);
                return {
                    isWindCapacityView: true,
                    bundle: rawData,
                    summaryValue: hasHistory
                        ? "Select a view below"
                        : "No wind capacity data available for this region"
                };
            }
        },

        hydrogenDemand: {
            title: "Hydrogen Demand",
            description: "How much hydrogen this region uses each year, broken down by industry. The UK-wide numbers are real (from EU/government data), but the UK doesn't publish a regional breakdown — so we've estimated this region's share based on where hydrogen-using facilities are actually located. More on how in the notes below the chart.",
            fetchData: async (regionName) => {
                if (typeof getRegionalHydrogenDemand !== "function") {
                    throw new Error("Hydrogen demand module not loaded.");
                }
                const all = await getRegionalHydrogenDemand();
                return {
                    regionData: all.regional[regionName] || {},
                    national: all.national,
                    years: all.years,
                    trade: all.trade,
                    regionName
                };
            },
            transform: (rawData) => {
                const hasData = Object.keys(rawData.regionData).length > 0;
                return {
                    isHydrogenDemandView: true,
                    bundle: rawData,
                    summaryValue: hasData
                        ? "Select a view below"
                        : "No hydrogen facilities identified in this region — see the national total in the Trend view for context"
                };
            }
        },

        hydrogenProduction: {
            title: "H₂ Production Potential",
            description: "A what-if simulation: how much hydrogen could electrolysers make from wind power that's currently being switched off (curtailed) in this region? Two numbers: a best-case upper bound, and a more realistic one based on smaller, real-sized equipment. Not a real installed system — just showing what's possible.",
            fetchData: async (regionName) => {
                // Only Theoretical Max is fetched here — it reuses
                // curtailment's own already-cached data, so this
                // resolves quickly. Constrained needs the much heavier
                // settlement-period pull, and is deliberately handled
                // separately (see renderHydrogenProductionChart /
                // ensureConstrainedLoaded below) so opening this tab
                // doesn't block on it — you can look at Theoretical
                // Max, switch to other tabs, and come back, while
                // Constrained keeps loading in the background.
                if (typeof getHydrogenProductionTheoretical !== "function") {
                    throw new Error("Hydrogen production module not loaded.");
                }

                const theoretical = await getHydrogenProductionTheoretical();

                const extract = (accum) => Object.entries(accum)
                    .map(([label, byRegion]) => ({ label, kg: byRegion[regionName] || 0 }))
                    .sort((a, b) => a.label.localeCompare(b.label));

                const dailyAll = extract(theoretical.daily);
                const monthlyAll = extract(theoretical.monthly);
                const yearlyAll = extract(theoretical.yearly);

                const daily = dailyAll.slice(-14);
                const currentFYMonths = monthlyAll.filter(m => m.label >= "2026-04");
                const monthly = currentFYMonths.length ? currentFYMonths : monthlyAll.slice(-12);
                const totalKg = theoretical.total[regionName] || 0;

                return {
                    daily, monthly, yearly: yearlyAll, totalKg,
                    regionName,
                    constrained: null // populated later, in the background — see ensureConstrainedLoaded
                };
            },
            transform: (rawData) => {
                const hasAnyData = rawData.daily.some(d => d.kg > 0)
                    || rawData.monthly.some(m => m.kg > 0)
                    || rawData.yearly.some(y => y.kg > 0);
                return {
                    isHydrogenProductionView: true,
                    bundle: rawData,
                    summaryValue: hasAnyData
                        ? "Select a time period below"
                        : "No wind curtailment recorded near this region — nothing to simulate here"
                };
            }
        }
    };

    // ==========================================
    // Pipeline Orchestrator
    // ==========================================
    async function loadActiveData() {
        const { activeRegion, activeDatasetKey } = state;
        if (!activeRegion) return;

        const contentBox = document.getElementById("regionContent");
        if (!contentBox) return;

        if (state.cache[activeRegion]?.[activeDatasetKey]) {
            renderUI(state.cache[activeRegion][activeDatasetKey]);
            return;
        }

        renderLoadingState();

        try {
            const config = DATASET_REGISTRY[activeDatasetKey];
            const rawData = await config.fetchData(activeRegion);

            // Staleness guard: if the user has since switched to a
            // different region or tab while this fetch was in flight
            // (a real possibility now that some fetches — hydrogen
            // production's Constrained data especially — can take a
            // while), state.activeRegion/activeDatasetKey will have
            // changed by the time we get here. Rendering this result
            // anyway would silently overwrite whatever the user is
            // actually looking at right now with stale content from a
            // tab they've already left. Cache it (still useful for
            // when they come back) but don't render it.
            if (state.activeRegion !== activeRegion || state.activeDatasetKey !== activeDatasetKey) {
                console.log(`Data Pipeline: fetch for ${activeDatasetKey}/${activeRegion} finished after the user navigated away — caching but not rendering.`);
                const standardizedDataStale = config.transform(rawData);
                standardizedDataStale.title = standardizedDataStale.title || config.title;
                standardizedDataStale.description = standardizedDataStale.description || config.description;
                state.cache[activeRegion] = state.cache[activeRegion] || {};
                state.cache[activeRegion][activeDatasetKey] = standardizedDataStale;
                return;
            }

            const standardizedData = config.transform(rawData);

            standardizedData.title = standardizedData.title || config.title;
            standardizedData.description = standardizedData.description || config.description;

            state.cache[activeRegion] = state.cache[activeRegion] || {};
            state.cache[activeRegion][activeDatasetKey] = standardizedData;

            renderUI(standardizedData);
        } catch (error) {
            console.error("Data Pipeline Error:", error);
            if (state.activeRegion === activeRegion && state.activeDatasetKey === activeDatasetKey) {
                renderErrorState();
            }
        }
    }

    // ==========================================
    // UI Render Logic
    // ==========================================
    function renderUI(data) {
        const titleEl = document.getElementById("regionTitle");
        const contentBox = document.getElementById("regionContent");

        if (!contentBox) return;
        if (titleEl) titleEl.textContent = state.activeRegion;

        const isPieChart = data.chartType === 'doughnut';

        contentBox.innerHTML = `
            <div class="sidebar-tabs" style="display: flex; gap: 5px; margin: 15px 0;">
                <button class="tab-btn ${state.activeDatasetKey === 'greenProduction' ? 'active' : ''}" data-task="greenProduction">Production</button>
                <button class="tab-btn ${state.activeDatasetKey === 'curtailments' ? 'active' : ''}" data-task="curtailments">Curtailment</button>
                <button class="tab-btn ${state.activeDatasetKey === 'windCapacity' ? 'active' : ''}" data-task="windCapacity">Wind Capacity</button>
                <button class="tab-btn ${state.activeDatasetKey === 'hydrogenDemand' ? 'active' : ''}" data-task="hydrogenDemand">H₂ Demand</button>
                <button class="tab-btn ${state.activeDatasetKey === 'hydrogenProduction' ? 'active' : ''}" data-task="hydrogenProduction">H₂ Production</button>
            </div>

            <hr />

            <div class="dataset-meta" style="margin-bottom: 15px;">
                <h3 style="margin: 5px 0 0 0; font-size: 17px;">${data.title}</h3>
                <p style="font-size: 13px; color: #666; margin: 4px 0;">${data.description}</p>
                ${data.dataAsOf ? `
                <p style="font-size: 11px; color: #999; margin: 2px 0 0;">Data period: ${data.dataAsOf}</p>
                ` : ""}
                ${!isPieChart ? `
                <div class="summary-badge" style="display:inline-block; background:#e6f7ff; color:#1890ff; padding: 4px 10px; border-radius:4px; font-weight:bold; margin-top:5px; font-size:12px;">
                    ${data.summaryValue}
                </div>
                ` : ""}
            </div>

            ${data.isCurtailmentView ? `
            <div class="mode-toggle" style="margin-bottom: 10px;">
                <button class="mode-btn" data-mode="daily">Daily</button>
                <button class="mode-btn" data-mode="monthly">Monthly</button>
                <button class="mode-btn" data-mode="yearly">Yearly</button>
                <button class="mode-btn" data-mode="total">Total</button>
            </div>
            ` : ""}

            ${data.isWindCapacityView ? `
            <div class="mode-toggle" style="margin-bottom: 10px;">
                <button class="mode-btn" data-mode="historical">Historical</button>
                <button class="mode-btn" data-mode="projected">Projected</button>
            </div>
            ` : ""}

            ${data.isHydrogenDemandView ? `
            <div class="mode-toggle" style="margin-bottom: 10px;">
                <button class="mode-btn" data-mode="trend">Trend</button>
                <button class="mode-btn" data-mode="bySector">By Sector</button>
                <button class="mode-btn" data-mode="trade">Trade</button>
            </div>
            ` : ""}

            ${data.isHydrogenProductionView ? `
            <div class="mode-toggle" style="margin-bottom: 10px;">
                <button class="mode-btn" data-mode="daily">Daily</button>
                <button class="mode-btn" data-mode="monthly">Monthly</button>
                <button class="mode-btn" data-mode="yearly">Yearly</button>
                <button class="mode-btn" data-mode="total">Total</button>
            </div>
            ` : ""}

            <div class="chart-wrapper" style="position: relative; width: 100%; height: 340px; margin-top: 15px;">
                <canvas id="sidebarDynamicChart"></canvas>
            </div>

            ${isPieChart ? `
            <div class="summary-badge" style="display:block; text-align:center; background:#e6f7ff; color:#1890ff; padding: 6px 10px; border-radius:4px; font-weight:bold; margin-top:12px; font-size:13px;">
                ${data.summaryValue}
            </div>
            ` : ""}

            ${data.footnote ? `
            <p style="font-size:11px; color:#888; line-height:1.5; margin-top:10px;">
                ${data.footnote}
            </p>
            ` : ""}

            <div id="dynamicChartFootnote"></div>
        `;

        contentBox.querySelectorAll(".tab-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                state.activeDatasetKey = e.target.getAttribute("data-task");
                loadActiveData();
            });
        });

        if (data.isCurtailmentView) {
            const modeButtons = contentBox.querySelectorAll(".mode-btn");
            const renderFn = renderCurtailmentChart;

            modeButtons.forEach(btn => {
                if (btn.getAttribute("data-mode") === state.curtailmentViewMode) {
                    btn.classList.add("active");
                }
                btn.addEventListener("click", (e) => {
                    state.curtailmentViewMode = e.target.getAttribute("data-mode");
                    modeButtons.forEach(b => b.classList.toggle("active", b === e.target));
                    renderFn(data.bundle, state.curtailmentViewMode);
                });
            });
            renderFn(data.bundle, state.curtailmentViewMode);
        } else if (data.isWindCapacityView) {
            const modeButtons = contentBox.querySelectorAll(".mode-btn");
            const renderFn = renderWindCapacityChart;

            modeButtons.forEach(btn => {
                if (btn.getAttribute("data-mode") === state.windCapacityViewMode) {
                    btn.classList.add("active");
                }
                btn.addEventListener("click", (e) => {
                    state.windCapacityViewMode = e.target.getAttribute("data-mode");
                    modeButtons.forEach(b => b.classList.toggle("active", b === e.target));
                    renderFn(data.bundle, state.windCapacityViewMode);
                });
            });
            renderFn(data.bundle, state.windCapacityViewMode);
        } else if (data.isHydrogenDemandView) {
            const modeButtons = contentBox.querySelectorAll(".mode-btn");
            const renderFn = renderHydrogenDemandChart;

            modeButtons.forEach(btn => {
                if (btn.getAttribute("data-mode") === state.hydrogenDemandViewMode) {
                    btn.classList.add("active");
                }
                btn.addEventListener("click", (e) => {
                    state.hydrogenDemandViewMode = e.target.getAttribute("data-mode");
                    modeButtons.forEach(b => b.classList.toggle("active", b === e.target));
                    renderFn(data.bundle, state.hydrogenDemandViewMode);
                });
            });
            renderFn(data.bundle, state.hydrogenDemandViewMode);
        } else if (data.isHydrogenProductionView) {
            const modeButtons = contentBox.querySelectorAll(".mode-btn");
            const renderFn = renderHydrogenProductionChart;

            modeButtons.forEach(btn => {
                if (btn.getAttribute("data-mode") === state.hydrogenProductionViewMode) {
                    btn.classList.add("active");
                }
                btn.addEventListener("click", (e) => {
                    state.hydrogenProductionViewMode = e.target.getAttribute("data-mode");
                    modeButtons.forEach(b => b.classList.toggle("active", b === e.target));
                    renderFn(data.bundle, state.hydrogenProductionViewMode);
                });
            });
            renderFn(data.bundle, state.hydrogenProductionViewMode);
        } else {
            triggerChartRender(data, "sidebarDynamicChart");
        }
    }

    const activeChartInstances = {}; // keyed by canvas id, since dual view keeps 2 charts alive at once

    function setDynamicFootnote(html) {
        const el = document.getElementById("dynamicChartFootnote");
        if (!el) return;
        el.innerHTML = html
            ? `<p style="font-size:11px; color:#888; line-height:1.5; margin-top:10px;">${html}</p>`
            : "";
    }

    function renderEmptyChartMessage(canvasId, message) {
        if (activeChartInstances[canvasId]) {
            activeChartInstances[canvasId].destroy();
            delete activeChartInstances[canvasId];
        }
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        ctx.parentNode.innerHTML = `
            <div class="empty-chart-message" style="display:flex; align-items:center; justify-content:center; height:100%; color:#999; font-size:13px; font-style:italic; text-align:center; padding: 0 15px;">
                ${message}
            </div>
            <canvas id="${canvasId}" style="display:none;"></canvas>
        `;
    }

    function hasNonZeroValues(values) {
        return Array.isArray(values) && values.some(v => Number(v) > 0);
    }

    function triggerChartRender(data, canvasId) {
        let ctx = document.getElementById(canvasId);
        if (!ctx) return;

        // Undo whatever renderEmptyChartMessage may have left behind
        // (a message div + a hidden fallback canvas) before drawing a
        // real chart. Without this, switching from an empty sub-view
        // (e.g. Daily with no data in the last 14 days) to a
        // non-empty one (Yearly/Total) drew the new chart onto the
        // leftover *hidden* canvas while the stale "no data" message
        // stayed visible on top of it — the actual bug being fixed
        // here. A full tab switch masked this because renderUI()
        // rebuilds the whole container from scratch each time.
        if (ctx.style.display === "none" || ctx.parentNode.querySelector(".empty-chart-message")) {
            ctx.parentNode.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            ctx = document.getElementById(canvasId);
        }

        if (activeChartInstances[canvasId]) {
            activeChartInstances[canvasId].destroy();
        }

        if (typeof Chart === "undefined") {
            ctx.parentNode.innerHTML = `<p style="color:#e67e22; font-size:12px;">Include Chart.js CDN script tag in HTML to generate graphs automatically.</p>`;
            return;
        }

        let colors = data.colors || ['#1890ff', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96'];
        if (data.chartType === 'bar' && !data.colors) colors = '#52c41a';
        if (data.chartType === 'radar') colors = 'rgba(24, 144, 255, 0.2)';

        const isCartesian = data.chartType === 'bar' || data.chartType === 'line';
        const unit = data.valueUnit || '';

        const scales = {};
        if (isCartesian) {
            scales.x = {
                title: { display: !!data.xAxisLabel, text: data.xAxisLabel || '', font: { size: 11 } }
            };
            scales.y = {
                beginAtZero: true,
                title: { display: !!data.yAxisLabel, text: data.yAxisLabel || '', font: { size: 11 } }
            };
        }

        activeChartInstances[canvasId] = new Chart(ctx, {
            type: data.chartType,
            data: {
                labels: data.labels,
                // data.series (optional): an array of {label, values,
                // color} for a real multi-dataset chart (e.g. grouped
                // bars — import vs export side by side per year).
                // Falls back to the original single-dataset shape when
                // not provided, so every other chart using this shared
                // renderer (curtailment, wind capacity, generation mix)
                // is unaffected.
                datasets: data.series
                    ? data.series.map(s => ({
                        label: s.label,
                        data: s.values,
                        backgroundColor: s.color,
                        borderColor: data.chartType === 'line' ? s.color : '#fff',
                        borderWidth: data.chartType === 'line' ? 2 : 1,
                        fill: data.chartType === 'line' ? false : undefined,
                        tension: data.chartType === 'line' ? 0.25 : undefined
                    }))
                    : [{
                        label: data.yAxisLabel || '',
                        data: data.values,
                        backgroundColor: colors,
                        borderColor: data.chartType === 'radar' ? '#1890ff' : (data.chartType === 'line' ? '#1890ff' : '#fff'),
                        borderWidth: data.chartType === 'radar' ? 2 : (data.chartType === 'line' ? 2 : 1),
                        fill: data.chartType === 'line' ? false : undefined,
                        tension: data.chartType === 'line' ? 0.25 : undefined
                    }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales,
                plugins: {
                    legend: { display: !isCartesian || !!data.series }, // show the legend when there are multiple series, so "Imports" vs "Exports" is distinguishable — single-series cartesian charts stay legend-free as before
                    datalabels: data.chartType === 'doughnut' ? {
                        color: '#fff',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => value >= 3 ? `${value}%` : '' // hide labels on slivers too small to read
                    } : (data.showValueLabels ? {
                        color: '#333',
                        anchor: 'end',
                        align: 'end',
                        font: { weight: 'bold', size: 11 },
                        formatter: (value) => `${value}${unit}`
                    } : { display: false }),
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                if (data.chartType === 'doughnut') {
                                    return `${context.label}: ${context.raw}%`;
                                }
                                if (data.series) {
                                    // Multiple series on the same
                                    // x-label (e.g. Imports vs Exports
                                    // for the same year) — the dataset
                                    // name is needed here, unlike the
                                    // single-series case below where
                                    // the x-axis category is already
                                    // an unambiguous title.
                                    return `${context.dataset.label}: ${context.raw}${unit}`;
                                }
                                // Cartesian charts (bar/line) already
                                // show the x-axis category/date as a
                                // bold title automatically — repeating
                                // it here was redundant ("07-15" title,
                                // then "07-15: 4.2 MWh" body). Just the
                                // value now.
                                return `${context.raw}${unit}`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ==========================================
    // Curtailment multi-view renderer (single chart — GB regions)
    // ==========================================
    // Lazy-loads yearly curtailment data (up to 9 separate NESO
    // requests, one per financial year — see the comment on
    // curtailments.fetchData for why this isn't fetched eagerly).
    // Mutates bundle.yearly in place and caches it there, so this only
    // actually fetches once per region per session — switching between
    // Yearly/Total for the same region afterward, or coming back to
    // this region later, reuses the already-populated bundle.yearly
    // without a further network call. getYearlyRegionalCurtailment()
    // itself is also cached/deduplicated (see windCurtailment.js), so
    // even a DIFFERENT region's first "Yearly" click after this one
    // hits that cache and resolves instantly rather than re-fetching.
    async function ensureYearlyLoaded(bundle) {
        if (bundle.yearly) return bundle.yearly;

        if (typeof getYearlyRegionalCurtailment !== "function") {
            bundle.yearly = [];
            return bundle.yearly;
        }

        const yearlyAll = await getYearlyRegionalCurtailment();
        bundle.yearly = Object.entries(yearlyAll)
            .map(([fy, regions]) => ({ label: fy, value: Number((regions[bundle.regionName] || 0).toFixed(1)) }))
            .sort((a, b) => a.label.localeCompare(b.label));

        return bundle.yearly;
    }

    function renderCurtailmentChart(bundle, mode) {
        if (!bundle) return;

        if (mode === "yearly" || mode === "total") {
            if (!bundle.yearly) {
                renderEmptyChartMessage("sidebarDynamicChart", "Loading yearly data…");
                ensureYearlyLoaded(bundle).then(() => {
                    // Only re-render if the user is still on this mode —
                    // they may have switched to Daily/Monthly while this
                    // was in flight.
                    if (state.curtailmentViewMode === mode) {
                        renderCurtailmentChart(bundle, mode);
                    }
                });
                return;
            }
        }

        if (mode === "daily") {
            if (!hasNonZeroValues(bundle.daily.map(d => d.value))) {
                const gbTotal = bundle.gbWideDailyTotal || 0;
                const gbRegions = bundle.regionsWithDailyDataCount || 0;
                const message = gbTotal > 0
                    ? `No curtailment recorded for this region in the last 14 days. (GB-wide: ${gbTotal.toFixed(0)} MWh curtailed across ${gbRegions} other region${gbRegions === 1 ? "" : "s"} in this period — curtailment is concentrated in specific regions and days, so this can be normal.)`
                    : "No curtailment recorded in the last 14 days.";
                renderEmptyChartMessage("sidebarDynamicChart", message);
                return;
            }
            triggerChartRender({
                chartType: "bar",
                labels: bundle.daily.map(d => d.label.slice(5)), // MM-DD
                values: bundle.daily.map(d => d.value),
                xAxisLabel: "Date (last 14 days)",
                yAxisLabel: "Curtailed Energy (MWh)",
                valueUnit: " MWh"
            }, "sidebarDynamicChart");
            return;
        }

        if (mode === "monthly") {
            if (!hasNonZeroValues(bundle.monthly.map(m => m.value))) {
                renderEmptyChartMessage("sidebarDynamicChart", "No curtailment recorded this financial year.");
                return;
            }
            const monthFormatter = (ym) => {
                const [year, month] = ym.split("-");
                const date = new Date(Number(year), Number(month) - 1, 1);
                return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
            };
            triggerChartRender({
                chartType: "bar",
                labels: bundle.monthly.map(m => monthFormatter(m.label)),
                // MWh -> GWh (1 GWh = 1,000 MWh)
                values: bundle.monthly.map(m => Number((m.value / 1000).toFixed(2))),
                xAxisLabel: "Month (current financial year)",
                yAxisLabel: "Curtailed Energy (GWh)",
                valueUnit: " GWh"
            }, "sidebarDynamicChart");
            return;
        }

        if (mode === "yearly") {
            if (!hasNonZeroValues(bundle.yearly.map(y => y.value))) {
                renderEmptyChartMessage("sidebarDynamicChart", "No curtailment recorded.");
                return;
            }
            triggerChartRender({
                chartType: "line",
                labels: bundle.yearly.map(y => y.label),
                // MWh -> TWh (1 TWh = 1,000,000 MWh) for visual clarity —
                // regional annual totals in raw MWh are long, hard-to-read
                // numbers; TWh keeps them to a small, comparable scale.
                values: bundle.yearly.map(y => Number((y.value / 1e6).toFixed(4))),
                xAxisLabel: "Financial Year",
                yAxisLabel: "Curtailed Energy (TWh)",
                valueUnit: " TWh"
            }, "sidebarDynamicChart");
            return;
        }

        // mode === "total": cumulative running sum across financial years
        if (!hasNonZeroValues(bundle.yearly.map(y => y.value))) {
            renderEmptyChartMessage("sidebarDynamicChart", "No curtailment recorded.");
            return;
        }
        let running = 0;
        const cumulative = bundle.yearly.map(y => {
            running += y.value; // accumulate in MWh for precision, convert to TWh once at the end
            return Number((running / 1e6).toFixed(4));
        });
        triggerChartRender({
            chartType: "line",
            labels: bundle.yearly.map(y => y.label),
            values: cumulative,
            xAxisLabel: "Financial Year",
            yAxisLabel: "Cumulative Curtailed Energy (TWh)",
            valueUnit: " TWh"
        }, "sidebarDynamicChart");
    }

    // ==========================================
    // Wind capacity multi-view renderer
    // ==========================================
    function renderWindCapacityChart(bundle, mode) {
        if (!bundle) return;

        if (mode === "historical") {
            setDynamicFootnote(""); // clear any "Projected" methodology footnote left over from switching modes
            const years = Object.keys(bundle.historical).sort();
            const values = years.map(y => bundle.historical[y]);

            if (!hasNonZeroValues(values)) {
                renderEmptyChartMessage("sidebarDynamicChart", "No installed wind capacity recorded for this region.");
                return;
            }

            triggerChartRender({
                chartType: "line",
                labels: years,
                values,
                xAxisLabel: "Year",
                yAxisLabel: "Cumulative Installed Capacity (MW)",
                valueUnit: " MW"
            }, "sidebarDynamicChart");
            return;
        }

        // mode === "projected"
        const years = Object.keys(bundle.projection).sort();
        const values = years.map(y => bundle.projection[y]);

        if (!hasNonZeroValues(values)) {
            setDynamicFootnote("");
            renderEmptyChartMessage("sidebarDynamicChart", "No projection available — this region has no recent installed capacity growth or known pipeline projects to base an estimate on.");
            return;
        }

        // Full transparency on methodology, shown directly under the
        // chart — see the long comment at the top of windCapacity.js
        // for the reasoning behind this approach. This is what makes
        // "estimate, not an official forecast" actually visible in the
        // UI, rather than sitting unused in a chart-config object.
        setDynamicFootnote(`This is our estimate, not an official forecast. We looked at how fast this region has actually grown over the last 10 years (about ${bundle.avgAnnualMW.toLocaleString()} MW a year), and made sure we never predict more than the ${bundle.pipelineMW.toLocaleString()} MW that's genuinely known to be under construction, approved, or in planning here right now.`);

        triggerChartRender({
            chartType: "line",
            labels: years,
            values,
            xAxisLabel: "Year (estimated)",
            yAxisLabel: "Estimated Cumulative Capacity (MW)",
            valueUnit: " MW"
        }, "sidebarDynamicChart");
    }

    // ==========================================
    // Hydrogen demand multi-view renderer
    // ==========================================
    // Hydrogen's lower heating value (33.33 MWh/tonne, the standard
    // figure used industry-wide) converts the real tonnes/year data
    // into TWh/yr for a readable chart scale — this is a straight
    // physical unit conversion, not an estimate layered on top of one.
    const HYDROGEN_LHV_MWH_PER_TONNE = 33.33;
    const TONNES_TO_TWH = (tonnes) => (tonnes * HYDROGEN_LHV_MWH_PER_TONNE) / 1e6;

    function renderHydrogenDemandChart(bundle, mode) {
        if (!bundle) return;

        const nationalTotalForYear = (year) => {
            const sectors = bundle.national[year] || {};
            return Object.values(sectors).reduce((sum, v) => sum + v, 0);
        };

        if (mode === "trend") {
            const years = bundle.years;
            const values = years.map(y => {
                const sectors = bundle.regionData[y] || {};
                const totalTonnes = Object.values(sectors).reduce((sum, v) => sum + v, 0);
                return Number(TONNES_TO_TWH(totalTonnes).toFixed(3));
            });

            if (!hasNonZeroValues(values)) {
                setDynamicFootnote("");
                renderEmptyChartMessage("sidebarDynamicChart", "No hydrogen facilities identified in this region to attribute demand to.");
                return;
            }

            const latestYear = years[years.length - 1];
            const nationalLatest = TONNES_TO_TWH(nationalTotalForYear(latestYear)).toFixed(2);

            setDynamicFootnote(`The UK-wide total here is real, measured data. But we don't know the exact split by region, so we've estimated it: refineries get a bigger or smaller share based on their actual size, other types of site split the total evenly between them. For scale, the whole UK used about ${nationalLatest} TWh of hydrogen in ${latestYear}.`);

            triggerChartRender({
                chartType: "line",
                labels: years,
                values,
                xAxisLabel: "Year",
                yAxisLabel: "Estimated Regional Demand (TWh/yr)",
                valueUnit: " TWh/yr"
            }, "sidebarDynamicChart");
            return;
        }

        if (mode === "bySector") {
            const latestYear = bundle.years[bundle.years.length - 1];
            const sectors = bundle.regionData[latestYear] || {};
            const labels = Object.keys(sectors);
            const values = labels.map(s => Number(TONNES_TO_TWH(sectors[s]).toFixed(3)));

            if (!hasNonZeroValues(values)) {
                setDynamicFootnote("");
                renderEmptyChartMessage("sidebarDynamicChart", "No hydrogen facilities identified in this region to attribute demand to.");
                return;
            }

            setDynamicFootnote(`Showing ${latestYear}, the latest year we have. If a sector isn't shown here, it's because there's no known hydrogen facility for it in this region — not necessarily because the UK-wide number is zero. Two sectors, "Other" and "Mobility", never show up in any region — we just don't know where those facilities are.`);

            triggerChartRender({
                chartType: "bar",
                labels,
                values,
                colors: ["#1890ff", "#fa8c16", "#eb2f96", "#52c41a", "#722ed1", "#13c2c2"],
                xAxisLabel: "Sector",
                yAxisLabel: `Estimated Demand, ${latestYear} (TWh/yr)`,
                valueUnit: " TWh/yr",
                showValueLabels: true
            }, "sidebarDynamicChart");
            return;
        }

        // mode === "trade"
        if (!bundle.trade) {
            setDynamicFootnote("");
            renderEmptyChartMessage("sidebarDynamicChart", "Trade data unavailable.");
            return;
        }

        const tradeYears = Object.keys(bundle.trade).sort();
        const exportValues = tradeYears.map(y => bundle.trade[y].exportsTotal);
        const importValues = tradeYears.map(y => bundle.trade[y].importsTotal);

        if (!hasNonZeroValues(exportValues) && !hasNonZeroValues(importValues)) {
            setDynamicFootnote("");
            renderEmptyChartMessage("sidebarDynamicChart", "No UK hydrogen trade recorded.");
            return;
        }

        setDynamicFootnote(`This number's the same no matter which region you pick — we only know import/export totals for the whole UK, not by region. And for scale: it's tiny. The UK traded a few hundred tonnes of hydrogen at most in any of these years, compared to over 300,000 tonnes used just for refining. Hydrogen trading barely exists in the UK yet.`);

        triggerChartRender({
            chartType: "bar",
            labels: tradeYears,
            series: [
                { label: "Imports", values: importValues, color: "#1890ff" },
                { label: "Exports", values: exportValues, color: "#52c41a" }
            ],
            xAxisLabel: "Year",
            yAxisLabel: "Tonnes/yr",
            valueUnit: " t/yr"
        }, "sidebarDynamicChart");
    }

    // ==========================================
    // Hydrogen production potential multi-view renderer
    // ==========================================
    // Theoretical Max is always available immediately (reuses
    // curtailment's own cached data — see the fetchData config above).
    // Constrained needs a much heavier fetch and loads in the
    // background: ensureConstrainedLoaded kicks it off once per
    // bundle, and re-renders this same chart with both series once it
    // arrives — but only if the user is still looking at this exact
    // tab/region, so a slow background fetch can never overwrite
    // whatever they've since navigated to.
    async function ensureConstrainedLoaded(bundle) {
        if (bundle.constrained || bundle._constrainedFetchStarted) return;
        bundle._constrainedFetchStarted = true;

        const stillRelevant = () => state.activeDatasetKey === "hydrogenProduction" && state.activeRegion === bundle.regionName;

        const onProgress = (yearsDone, yearsTotal, totalRows) => {
            if (!stillRelevant()) return;
            setDynamicFootnote(`<strong>Loading the more realistic comparison in the background…</strong> ${yearsDone} of ${yearsTotal} years of detailed data fetched so far (${totalRows.toLocaleString()} rows). Feel free to look at other tabs while this finishes — it only happens once, then it's saved for next time.`);
        };

        try {
            const constrainedRaw = await getHydrogenProductionConstrained(false, onProgress);

            const extract = (accum) => {
                const result = {};
                Object.entries(accum).forEach(([label, byRegion]) => {
                    result[label] = byRegion[bundle.regionName] || 0;
                });
                return result;
            };

            bundle.constrained = {
                daily: extract(constrainedRaw.daily),
                monthly: extract(constrainedRaw.monthly),
                yearly: extract(constrainedRaw.yearly),
                totalKg: constrainedRaw.total[bundle.regionName] || 0
            };

            if (stillRelevant()) {
                renderHydrogenProductionChart(bundle, state.hydrogenProductionViewMode);
            }
        } catch (err) {
            console.log("Hydrogen production: Constrained fetch failed.", err);
            if (stillRelevant()) {
                setDynamicFootnote(`<strong>Couldn't load the more realistic comparison right now</strong> — showing the best-case upper bound only. Try reopening this tab later.`);
            }
        }
    }

    function renderHydrogenProductionChart(bundle, mode) {
        if (!bundle) return;

        ensureConstrainedLoaded(bundle); // idempotent — no-ops if already loaded or already in flight

        const hasConstrained = !!bundle.constrained;
        const METHOD_NOTE = hasConstrained
            ? `<strong>Theoretical Max</strong> is a best-case upper bound; <strong>Constrained</strong> is a more realistic estimate using smaller, real-sized equipment. This is a simulation, not a real installation. For more on the methodology and results, <a href="data/dissertation_presentation.pptx" download>click here to download the presentation</a>.`
            : `This is a best-case upper bound. A more realistic comparison (smaller, real-sized equipment) is loading in the background and will appear here once ready. Not a real installation — this is a simulation. For more on the methodology and results, <a href="data/dissertation_presentation.pptx" download>click here to download the presentation</a>.`;

        function buildSeries(theoreticalValues, constrainedValues) {
            if (hasConstrained) {
                return [
                    { label: "Theoretical Max", values: theoreticalValues, color: "#1890ff" },
                    { label: "Constrained", values: constrainedValues, color: "#fa8c16" }
                ];
            }
            return [{ label: "Theoretical Max", values: theoreticalValues, color: "#1890ff" }];
        }

        if (mode === "daily" || mode === "monthly") {
            const rows = mode === "daily" ? bundle.daily : bundle.monthly;
            const labels = rows.map(r => r.label);
            const theoreticalValues = rows.map(r => Number(r.kg.toFixed(1)));
            const constrainedValues = hasConstrained
                ? labels.map(l => Number((bundle.constrained[mode][l] || 0).toFixed(1)))
                : [];

            if (!hasNonZeroValues(theoreticalValues) && !hasNonZeroValues(constrainedValues)) {
                setDynamicFootnote("");
                renderEmptyChartMessage("sidebarDynamicChart", mode === "daily" ? "No curtailment recorded in the last 14 days." : "No curtailment recorded this financial year.");
                return;
            }

            setDynamicFootnote(METHOD_NOTE);

            triggerChartRender({
                chartType: "bar",
                labels: mode === "monthly" ? labels.map(m => {
                    const [y, mo] = m.split("-");
                    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
                }) : labels,
                series: buildSeries(theoreticalValues, constrainedValues),
                xAxisLabel: mode === "daily" ? "Date (last 14 days)" : "Month (current financial year)",
                yAxisLabel: "Hydrogen produced (kg)",
                valueUnit: " kg"
            }, "sidebarDynamicChart");
            return;
        }

        if (mode === "yearly") {
            const rows = bundle.yearly;
            const labels = rows.map(r => r.label);
            const theoreticalValues = rows.map(r => Number((r.kg / 1000).toFixed(2)));
            const constrainedValues = hasConstrained
                ? labels.map(l => Number(((bundle.constrained.yearly[l] || 0) / 1000).toFixed(2)))
                : [];

            if (!hasNonZeroValues(theoreticalValues) && !hasNonZeroValues(constrainedValues)) {
                setDynamicFootnote("");
                renderEmptyChartMessage("sidebarDynamicChart", "No curtailment recorded for this region.");
                return;
            }

            setDynamicFootnote(METHOD_NOTE);

            triggerChartRender({
                chartType: "line",
                labels,
                series: buildSeries(theoreticalValues, constrainedValues),
                xAxisLabel: "Financial Year",
                yAxisLabel: "Hydrogen produced (tonnes)",
                valueUnit: " t"
            }, "sidebarDynamicChart");
            return;
        }

        // mode === "total"
        const theoreticalTotal = Number((bundle.totalKg / 1000).toFixed(2));
        const constrainedTotal = hasConstrained ? Number((bundle.constrained.totalKg / 1000).toFixed(2)) : 0;

        if (!theoreticalTotal && !constrainedTotal) {
            setDynamicFootnote("");
            renderEmptyChartMessage("sidebarDynamicChart", "No curtailment recorded for this region across the years we have data for.");
            return;
        }

        setDynamicFootnote(`${METHOD_NOTE} Totals here are summed across every financial year we have curtailment data for.`);

        triggerChartRender({
            chartType: "bar",
            labels: ["All years combined"],
            series: buildSeries([theoreticalTotal], [constrainedTotal]),
            xAxisLabel: "",
            yAxisLabel: "Hydrogen produced (tonnes)",
            valueUnit: " t",
            showValueLabels: true
        }, "sidebarDynamicChart");
    }

    // ==========================================
    // Curtailment multi-view renderer (dual — NI wind + solar)
    // ==========================================
    function renderLoadingState() {
        const titleEl = document.getElementById("regionTitle");
        const contentBox = document.getElementById("regionContent");

        if (titleEl) titleEl.textContent = state.activeRegion;
        if (contentBox) contentBox.innerHTML = `<p class="loading" style="color:#666; font-size:13px; font-style:italic;">Querying regional indicators...</p>`;
    }

    function renderErrorState() {
        const titleEl = document.getElementById("regionTitle");
        const contentBox = document.getElementById("regionContent");

        if (titleEl) titleEl.textContent = state.activeRegion;
        if (contentBox) contentBox.innerHTML = `<p class="error" style="color:#f5222d; font-size:13px;">Data format matching or API query error.</p>`;
    }

    function clearDashboard() {
        const titleEl = document.getElementById("regionTitle");
        const contentBox = document.getElementById("regionContent");

        if (titleEl) titleEl.textContent = "Region";
        if (contentBox) contentBox.innerHTML = `<p class="placeholder" style="color:#999; font-size:13px;">Select an active region area target on the map geometry layout.</p>`;
    }

    window.DataManager = {
        setActiveRegion: (regionName) => {
            state.activeRegion = regionName;
            loadActiveData();
        },
        clearDashboard: clearDashboard,
        // Exposed for pdfExport.js — reuses this exact mapping rather
        // than duplicating it, so the PDF's national/per-region
        // generation mix data is attributed to regions the same way
        // the live sidebar already does.
        nesoRegionIds: nesoRegionIds,
        getNormalizedRegionKey: getNormalizedRegionKey
    };
})();