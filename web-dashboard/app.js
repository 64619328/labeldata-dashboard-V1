(function () {
  let dashboardData = window.DASHBOARD_DATA;
  const dashboardApiConfig = window.DASHBOARD_API_CONFIG || {};
  const dashboardApiClient =
    typeof window.createDashboardApiClient === "function" ? window.createDashboardApiClient(dashboardApiConfig) : null;
  const dashboardAdapter = window.DashboardAdapter || {};
  const assistantConfig = window.DASHBOARD_ASSISTANT_CONFIG || {
    mode: "local",
    apiBaseUrl: "",
    apiKeyEndpoint: "/api/assistant/api-key",
    chatEndpoint: "/api/assistant/chat",
    model: "reserved",
    timeoutMs: 15000,
  };

  if (!dashboardData || !Array.isArray(dashboardData.records)) {
    throw new Error("Missing dashboard data.");
  }

  const requesterPool = ["陈琳", "周扬", "吴桐", "赵宁", "孙越", "林楠", "顾然", "邵琪"];
  const taskTypeFallbackPool = ["新增需求", "例行任务", "专项任务", "模型优化", "质量回扫"];
  const priorityPool = ["P0", "P1", "P1", "P2", "P2"];
  const ruleMaturityPool = ["成熟", "较成熟", "建设中"];
  const topVendorRankColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
  const annualBudget = 7500000;
  const publicBudget = 5200000;
  const privateBudget = 2300000;
  const supplierProfiles = [
    { name: "星云", monthlyCapacity: 52000, specialties: ["商品审核", "试衣"], onTimeRate: 0.93 },
    { name: "达牛", monthlyCapacity: 47000, specialties: ["试衣", "商品审核"], onTimeRate: 0.91 },
    { name: "圣宝", monthlyCapacity: 34000, specialties: ["场景图", "模特图"], onTimeRate: 0.88 },
    { name: "百度", monthlyCapacity: 38000, specialties: ["搜推导购图", "商品审核"], onTimeRate: 0.86 },
    { name: "倍赛", monthlyCapacity: 22000, specialties: ["卖点图", "问答"], onTimeRate: 0.81 },
  ];

  let sourceRecords = dashboardData.records.map((record, index) => decorateRecord(record, index));

  const dateFilterKeys = ["dateStart", "dateEnd"];
  const commonSelectFilterKeys = ["department", "template", "vendor", "category", "status", "requester"];
  const commonFilterKeys = [...dateFilterKeys, ...commonSelectFilterKeys];
  const commonFilterMap = {
    department: "费用承担部门",
    template: "使用模版",
    vendor: "供应商名称",
    category: "任务类别",
    status: "流程状态",
    requester: "提需人",
  };

  const assistantSuggestionPool = [
    "当前金额最高的供应商是谁？",
    "本月新增任务多吗？",
    "哪个任务类别的数据量最大？",
    "当前按时交付率怎么样？",
    "任务类别和所属任务怎么对应？",
  ];

  const state = {
    activeSection: "overview",
    overviewRange: "3m",
    taskCycleRange: 6,
    businessTrendRange: 6,
    financeRange: 6,
    financeTotalRange: 6,
    globalFilters: createFilterState(commonFilterKeys),
    taskDetailFilters: { ...createFilterState(["category", "status", "department", "vendor", "risk"]), latestTimeStart: "", latestTimeEnd: "" },
    expandedTaskTypes: new Set(),
    expandedSuppliers: new Set(),
    focusedTaskRecordId: "",
    assistantOpen: false,
    assistantBusy: false,
    assistantMessages: [],
    dataSourceMode: dashboardApiClient?.isEnabled() ? "loading" : "local",
    dataSourceMessage: dashboardApiClient?.isEnabled() ? "连接数据源中" : "本地预览数据",
  };

  // Chart.js instance cache for lazy init and cleanup
  const chartInstances = {};

  const els = {
    metaRange: document.getElementById("meta-range"),
    metaValidRows: document.getElementById("meta-valid-rows"),
    metaGeneratedAt: document.getElementById("meta-generated-at"),
    tabButtons: Array.from(document.querySelectorAll("[data-tab-target]")),
    tabPanels: Array.from(document.querySelectorAll("[data-dashboard-section]")),
    overviewCards: document.getElementById("overview-cards"),
    overviewThroughputChart: document.getElementById("overview-throughput-chart"),
    overviewDelayChart: document.getElementById("overview-delay-chart"),
    overviewDelaySummary: document.getElementById("overview-delay-summary"),
    overviewRiskTable: document.getElementById("overview-risk-table"),
    overviewRangeButtons: Array.from(document.querySelectorAll("[data-overview-range]")),
    overviewOnTimeVendors: document.getElementById("overview-on-time-vendors"),
    taskCycleChart: document.getElementById("task-cycle-chart"),
    taskCycleRangeButtons: Array.from(document.querySelectorAll("[data-task-cycle-range]")),
    taskDataStatusChart: document.getElementById("task-data-status-chart"),
    taskDataStatusSummary: document.getElementById("task-data-status-summary"),
    taskTypeChart: document.getElementById("task-type-chart"),
    taskMonitorTable: document.getElementById("task-monitor-table"),
    taskDetailReset: document.getElementById("task-detail-reset"),
    taskDetailRefresh: document.getElementById("task-detail-refresh"),
    supplierKpiCards: document.getElementById("supplier-kpi-cards"),
    supplierOnTimeChart: document.getElementById("supplier-on-time-chart"),
    supplierCostChart: document.getElementById("supplier-cost-chart"),
    supplierCapacityGrid: document.getElementById("supplier-capacity-grid"),
    supplierCapacityReset: document.getElementById("supplier-capacity-reset"),
    supplierActiveTable: document.getElementById("supplier-active-table"),
    businessKpiCards: document.getElementById("business-kpi-cards"),
    businessTrendChart: document.getElementById("business-trend-chart"),
    businessTrendRangeButtons: Array.from(document.querySelectorAll("[data-business-trend-range]")),
    businessTable: document.getElementById("business-table"),
    financeSplitCards: document.getElementById("finance-split-cards"),
    financeTable: document.getElementById("finance-table"),
    financeRangeButtons: Array.from(document.querySelectorAll("[data-finance-range]")),
    financeTotalRangeButtons: Array.from(document.querySelectorAll("[data-finance-total-range]")),
    financeTotalChart: document.getElementById("finance-total-chart"),
    globalReset: document.getElementById("global-reset"),
    refreshDataSource: document.getElementById("refresh-data-source"),
    businessCompareChart: document.getElementById("business-compare-chart"),
    financeCompareChart: document.getElementById("finance-compare-chart"),
    assistantEntry: document.getElementById("assistant-entry"),
    assistantPanel: document.getElementById("assistant-panel"),
    assistantClose: document.getElementById("assistant-close"),
    assistantMessages: document.getElementById("assistant-messages"),
    assistantSuggestionList: document.getElementById("assistant-suggestion-list"),
    assistantForm: document.getElementById("assistant-form"),
    assistantInput: document.getElementById("assistant-input"),
    assistantSubmit: document.getElementById("assistant-submit"),
    assistantModeNote: document.getElementById("assistant-mode-note"),
    assistantApiNote: document.getElementById("assistant-api-note"),
    headerTitle: document.getElementById("header-title"),
    dataSourceStatus: document.getElementById("data-source-status"),
  };

  // Chart.js defaults
  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.color = "#64748b";

  async function loadDashboardData() {
    if (!dashboardApiClient?.isEnabled()) {
      applyDashboardDataset(dashboardData, "local", "本地预览数据");
      return;
    }

    setDataSourceState("loading", "连接数据源中");
    try {
      const payload = await dashboardApiClient.getOverview(buildApiParams());
      const normalized = normalizeDashboardDataset(payload);
      applyDashboardDataset(normalized, "live", "后端数据已连接");
    } catch (error) {
      if (dashboardApiClient.config.useLocalFallback) {
        applyDashboardDataset(window.DASHBOARD_DATA, "error", "后端不可用，已使用本地兜底数据");
        console.warn("[dashboard] backend data unavailable, fallback to local data:", error);
        return;
      }
      setDataSourceState("error", "数据源加载失败");
      throw error;
    }
  }

  async function refreshDashboardData() {
    if (!dashboardApiClient?.isEnabled()) {
      destroyAllCharts();
      render();
      setDataSourceState("local", "本地预览数据已刷新");
      return;
    }

    setRefreshButtonLoading(true);
    setDataSourceState("loading", "刷新数据源中");
    try {
      await dashboardApiClient.refresh(buildApiParams());
      await loadDashboardData();
      destroyAllCharts();
      renderMeta();
      render();
    } catch (error) {
      if (dashboardApiClient.config.useLocalFallback) {
        applyDashboardDataset(window.DASHBOARD_DATA, "error", "刷新失败，已使用本地兜底数据");
        destroyAllCharts();
        renderMeta();
        render();
        console.warn("[dashboard] refresh failed, fallback to local data:", error);
      } else {
        setDataSourceState("error", "刷新失败");
      }
    } finally {
      setRefreshButtonLoading(false);
    }
  }

  function applyDashboardDataset(dataset, mode, message) {
    dashboardData = dataset;
    sourceRecords = (dashboardData.records || []).map((record, index) => decorateRecord(record, index));
    setDataSourceState(mode, message);
  }

  function normalizeDashboardDataset(payload) {
    if (typeof dashboardAdapter.normalizeDashboardDataset === "function") {
      return dashboardAdapter.normalizeDashboardDataset(payload, window.DASHBOARD_DATA);
    }
    return payload && Array.isArray(payload.records) ? payload : window.DASHBOARD_DATA;
  }

  function buildApiParams() {
    return {
      range: state.overviewRange,
      startDate: state.globalFilters.dateStart,
      endDate: state.globalFilters.dateEnd,
      department: state.globalFilters.department,
      template: state.globalFilters.template,
      supplierName: state.globalFilters.vendor,
      taskCategory: state.globalFilters.category,
      taskStatus: state.globalFilters.status,
      requester: state.globalFilters.requester,
    };
  }

  function setDataSourceState(mode, message) {
    state.dataSourceMode = mode;
    state.dataSourceMessage = message;
    renderDataSourceStatus();
  }

  function renderDataSourceStatus() {
    if (!els.dataSourceStatus) return;
    const modeClassMap = {
      loading: "is-loading",
      live: "is-live",
      error: "is-error",
      local: "",
    };
    els.dataSourceStatus.className = `data-source-status ${modeClassMap[state.dataSourceMode] || ""}`.trim();
    els.dataSourceStatus.textContent = state.dataSourceMessage || "";
  }

  function setRefreshButtonLoading(isLoading) {
    if (!els.refreshDataSource) return;
    els.refreshDataSource.disabled = isLoading;
    els.refreshDataSource.classList.toggle("opacity-60", isLoading);
    els.refreshDataSource.classList.toggle("cursor-wait", isLoading);
  }

  async function init() {
    renderDataSourceStatus();
    await loadDashboardData();
    initAssistant();
    renderMeta();
    initSectionNav();
    initRangeControls();

    const options = collectFilterOptions(sourceRecords, commonFilterMap);
    buildDateRangeFilter("global", state.globalFilters);
    buildFilterGroup("global", commonSelectFilterKeys, state.globalFilters, options, handleGlobalFilterChange);
    buildTaskDetailFilters(sourceRecords);

    els.globalReset.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetFilters(state.globalFilters, "global", commonFilterKeys);
      state.overviewRange = "3m";
      state.expandedSuppliers.clear();
      state.focusedTaskRecordId = "";
      destroyAllCharts();
      renderRangeButtons();
      render();
    });

    els.supplierCapacityReset.addEventListener("click", (event) => {
      event.preventDefault();
      resetSupplierFilter();
    });

    render();
  }

  function destroyChart(id) {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  }

  function destroyAllCharts() {
    Object.keys(chartInstances).forEach((id) => destroyChart(id));
  }

  function initSectionNav() {
    els.tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.getAttribute("data-tab-target") || "overview";
        switchTab(targetId);
      });
    });
    renderSectionNav();
  }

  function initRangeControls() {
    els.overviewRangeButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        state.overviewRange = button.getAttribute("data-overview-range") || "7d";
        renderRangeButtons();
        if (dashboardApiClient?.isEnabled()) {
          await loadDashboardData();
          destroyAllCharts();
          renderMeta();
          render();
        } else {
          renderSectionCharts("overview");
        }
      });
    });
    els.taskCycleRangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.taskCycleRange = Number(button.getAttribute("data-task-cycle-range")) || 6;
        renderRangeButtons();
        renderSectionCharts("tasks");
      });
    });
    els.businessTrendRangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.businessTrendRange = Number(button.getAttribute("data-business-trend-range")) || 6;
        renderRangeButtons();
        renderSectionCharts("business");
      });
    });
    els.financeRangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.financeRange = Number(button.getAttribute("data-finance-range")) || 6;
        renderRangeButtons();
        renderSectionCharts("finance");
      });
    });
    els.financeTotalRangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.financeTotalRange = Number(button.getAttribute("data-finance-total-range")) || 6;
        renderRangeButtons();
        renderSectionCharts("finance");
      });
    });
    els.refreshDataSource?.addEventListener("click", async () => {
      await refreshDashboardData();
    });
    els.taskDetailReset?.addEventListener("click", () => {
      resetTaskDetailFilters();
      renderTaskMonitoring(getTaskDetailRecords(getGlobalRecords()));
    });
    els.taskDetailRefresh?.addEventListener("click", () => {
      renderTaskMonitoring(getTaskDetailRecords(getGlobalRecords()));
    });
    renderRangeButtons();
  }

  function renderRangeButtons() {
    els.overviewRangeButtons.forEach((button) => {
      const active = button.getAttribute("data-overview-range") === state.overviewRange;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("text-slate-900", active);
      button.classList.toggle("text-gray-600", !active);
      button.classList.toggle("shadow-sm", active);
    });
    els.financeRangeButtons.forEach((button) => {
      const active = Number(button.getAttribute("data-finance-range")) === state.financeRange;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("text-primary", active);
      button.classList.toggle("shadow-sm", active);
    });
    els.taskCycleRangeButtons.forEach((button) => {
      const active = Number(button.getAttribute("data-task-cycle-range")) === state.taskCycleRange;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("text-primary", active);
      button.classList.toggle("shadow-sm", active);
    });
    els.businessTrendRangeButtons.forEach((button) => {
      const active = Number(button.getAttribute("data-business-trend-range")) === state.businessTrendRange;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("text-primary", active);
      button.classList.toggle("shadow-sm", active);
    });
    els.financeTotalRangeButtons.forEach((button) => {
      const active = Number(button.getAttribute("data-finance-total-range")) === state.financeTotalRange;
      button.classList.toggle("bg-white", active);
      button.classList.toggle("text-primary", active);
      button.classList.toggle("shadow-sm", active);
    });
  }

  function switchTab(targetId) {
    state.activeSection = targetId;
    renderSectionNav();

    els.tabPanels.forEach((panel) => {
      const section = panel.getAttribute("data-dashboard-section");
      panel.classList.toggle("block", section === targetId);
      panel.classList.toggle("hidden", section !== targetId);
    });

    if (els.headerTitle) {
      els.headerTitle.textContent = "标注平台管理端数据看板系统";
    }

    // Re-render charts for the active section (handles resize properly)
    renderSectionCharts(targetId);
  }

  function renderSectionNav() {
    els.tabButtons.forEach((button) => {
      const isActive = button.getAttribute("data-tab-target") === state.activeSection;
      button.classList.toggle("active", isActive);
      if (isActive) {
        button.classList.remove("text-slate-300", "hover:bg-slate-800", "hover:text-white");
      } else {
        button.classList.add("text-slate-300", "hover:bg-slate-800", "hover:text-white");
        button.classList.remove("bg-primary/10", "text-primary");
      }
    });
  }

  function renderSectionCharts(sectionId) {
    const globalRecords = getGlobalRecords();
    if (sectionId === "overview") {
      const overviewRecords = getOverviewRecords();
      renderChartThroughput(overviewRecords, state.overviewRange);
      renderChartOverviewDelayRate(overviewRecords);
      renderChartOverviewStatusDistribution(overviewRecords);
      renderChartOverviewTaskTypeDistribution(overviewRecords);
      renderChartOverviewBusinessDistribution(overviewRecords);
    } else if (sectionId === "tasks") {
      renderChartTaskDataStatusDistribution(globalRecords);
    } else if (sectionId === "suppliers") {
      renderChartSupplierOnTimeRank(globalRecords);
      renderChartSupplierCostDistribution(globalRecords);
    } else if (sectionId === "business") {
      renderChartBusinessCompare(globalRecords);
      renderChartBusinessTrend(filterRecentMonths(globalRecords, state.businessTrendRange));
    } else if (sectionId === "finance") {
      renderChartFinanceCompare(filterRecentMonths(globalRecords, state.financeRange));
      renderChartFinanceTotalTrend(filterRecentMonths(globalRecords, state.financeTotalRange));
    }
  }

  function renderMeta() {
    const meta = dashboardData.meta || {};
    const timeRange = meta.timeRange || {};
    if (els.metaRange) els.metaRange.textContent = `${timeRange.start || "-"} 至 ${timeRange.end || "-"}`;
    if (els.metaValidRows) els.metaValidRows.textContent = `${formatInteger(sourceRecords.length)} 条`;
    if (els.metaGeneratedAt) els.metaGeneratedAt.textContent = meta.generatedAt || "-";
  }

  function render() {
    destroyAllCharts();
    const globalRecords = getGlobalRecords();
    const overviewRecords = getOverviewRecords();
    const supplierRows = getSupplierRows(globalRecords);

    renderOverviewCards(overviewRecords);
    renderOverviewDiagnostics(overviewRecords);
    renderTaskMonitoring(getTaskDetailRecords(globalRecords));
    renderSupplierManagement(supplierRows);
    updateSupplierCapacityResetBtnVisibility();
    renderBusinessAnalysis(globalRecords);
    renderFinanceBudget(globalRecords);
    renderAssistant(globalRecords);

    // Render charts for the currently active section
    renderSectionCharts(state.activeSection);
  }

  // ===================== FILTER FUNCTIONS =====================

  function createFilterState(keys) {
    return Object.fromEntries(keys.map((key) => [key, isDateFilterKey(key) ? "" : "全部"]));
  }

  function buildFilterGroup(prefix, keys, stateObject, options, onChange = render) {
    keys.forEach((key) => {
      buildSingleFilter(`${prefix}-filter-${key}`, ["全部", ...(options[key] || [])], stateObject, key, onChange);
    });
  }

  function buildSingleFilter(selectId, values, stateObject, key, onChange) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      select.value = stateObject[key];
    select.addEventListener("change", async (event) => {
      stateObject[key] = event.target.value;
      await onChange();
    });
  }

  async function handleGlobalFilterChange() {
    if (dashboardApiClient?.isEnabled()) {
      await loadDashboardData();
      destroyAllCharts();
      renderMeta();
    }
    render();
  }

  function buildTaskDetailFilters(records) {
    const options = buildTaskDetailFilterOptions(records);
    Object.entries(options).forEach(([key, values]) => {
      buildSingleFilter(`task-detail-filter-${key}`, ["全部", ...values], state.taskDetailFilters, key, () => {
        renderTaskMonitoring(getTaskDetailRecords(getGlobalRecords()));
      });
    });

    // Handle date range inputs for latestTime
    ["latestTimeStart", "latestTimeEnd"].forEach((key) => {
      const input = document.getElementById(`task-detail-filter-${key}`);
      if (!input) return;
      input.value = state.taskDetailFilters[key];
      input.addEventListener("change", (event) => {
        state.taskDetailFilters[key] = event.target.value;
        renderTaskMonitoring(getTaskDetailRecords(getGlobalRecords()));
      });
    });
  }

  function buildTaskDetailFilterOptions(records) {
    const groups = buildTaskTypeGroups(records);
    return {
      category: uniqueValues(groups.map((group) => group.name)).sort(),
      status: uniqueValues(records.map((item) => item["流程状态"])).filter((item) => item !== "待审核").sort(),
      department: uniqueValues(groups.flatMap((group) => group.businessNames)).sort(),
      vendor: uniqueValues(groups.flatMap((group) => group.vendorNameList)).sort(),
      risk: ["正常", "延期"],
    };
  }

  function resetTaskDetailFilters() {
    Object.keys(state.taskDetailFilters).forEach((key) => {
      if (key === "latestTimeStart" || key === "latestTimeEnd") {
        state.taskDetailFilters[key] = "";
      } else {
        state.taskDetailFilters[key] = "全部";
      }
      const field = document.getElementById(`task-detail-filter-${key}`);
      if (field) field.value = state.taskDetailFilters[key];
    });
  }

  function resetFilters(stateObject, prefix, keys) {
    keys.forEach((key) => {
      stateObject[key] = isDateFilterKey(key) ? "" : "全部";
      const field = document.getElementById(`${prefix}-filter-${key}`);
      if (field) field.value = stateObject[key];
    });
  }

  function buildDateRangeFilter(prefix, stateObject) {
    dateFilterKeys.forEach((key) => {
      const input = document.getElementById(`${prefix}-filter-${key}`);
      if (!input) return;
      input.min = dashboardData.meta?.timeRange?.start || "";
      input.max = dashboardData.meta?.timeRange?.end || "";
      input.value = stateObject[key];
      input.addEventListener("change", async (event) => {
        stateObject[key] = event.target.value;
        await handleGlobalFilterChange();
      });
    });
  }

  function collectFilterOptions(records, filterMap) {
    return Object.fromEntries(
      Object.entries(filterMap).map(([key, field]) => [
        key,
        uniqueValues(records.map((item) => item[field]))
          .map((value) => String(value))
          .sort(),
      ])
    );
  }

  function filterRecords(records, filters, filterMap) {
    return records.filter(
      (record) =>
        Object.entries(filterMap).every(
          ([key, field]) => filters[key] === "全部" || String(record[field] || "") === filters[key]
        ) && matchesDateRange(record, filters)
    );
  }

  function getGlobalRecords() {
    return filterRecords(sourceRecords, state.globalFilters, commonFilterMap);
  }

  function getOverviewRecords() {
    return filterRecentPeriod(sourceRecords, state.overviewRange);
  }

  function getTaskDetailRecords(records) {
    const filters = state.taskDetailFilters;
    const selectedGroups = buildTaskTypeGroups(records).filter((group) => {
      if (filters.category !== "全部" && group.name !== filters.category) return false;
      if (filters.latestTimeStart && group.latestTaskCreatedAt < filters.latestTimeStart) return false;
      if (filters.latestTimeEnd && group.latestTaskCreatedAt > filters.latestTimeEnd) return false;
      if (filters.status !== "全部" && !group.statusList.includes(filters.status)) return false;
      if (filters.department !== "全部" && !group.businessNames.includes(filters.department)) return false;
      if (filters.vendor !== "全部" && !group.vendorNameList.includes(filters.vendor)) return false;
      if (filters.risk !== "全部") {
        const hasRisk = group.riskTaskCount > 0;
        if (filters.risk === "延期" && !hasRisk) return false;
        if (filters.risk === "正常" && hasRisk) return false;
      }
      return true;
    });
    const selectedCategories = new Set(selectedGroups.map((group) => group.name));
    return records.filter((item) => selectedCategories.has(item["任务类别"] || "缺失"));
  }

  function getSupplierRows(records) {
    const selectedVendor = state.globalFilters.vendor;
    return supplierProfiles
      .map((profile, index) => buildSupplierRow(profile, records, index))
      .filter((row) => selectedVendor === "全部" || row.name === selectedVendor)
      .sort((a, b) => b.utilization - a.utilization || b.currentTaskCount - a.currentTaskCount);
  }

  // ===================== RENDER FUNCTIONS =====================

  function renderOverviewCards(records) {
    const summary = buildOverviewSummary(records);
    const deliveredVolume = sum(
      records.filter((item) => item["流程状态"] === "审核通过"),
      (item) => numberValue(item["数据量"])
    );
    const cards = [
      ["下发数据总量", formatCompact(summary.volume), "当前统计周期"],
      ["交付数据总量", formatCompact(deliveredVolume), "已审核通过任务"],
      ["累计消耗金额", formatCurrency(summary.amount), "当前统计周期"],
    ];
    const statusRows = buildOverviewStatusRows(records);
    const statusTotal = sum(statusRows, (row) => row.value);
    const leadingStatus = statusRows[0]?.label || "暂无";
    const activeTasks = records.filter((item) => item["流程状态"] !== "审核通过" && item["流程状态"] !== "待审核").length;
    const typeRows = buildOverviewTaskTypeRows(records);
    const leadingType = typeRows[0]?.label || "暂无";
    const topTypeVolume = typeRows[0]?.value || 0;
    const businessRows = buildOverviewBusinessRows(records);
    const leadingBusiness = businessRows[0]?.label || "暂无";
    const topBusinessVolume = businessRows[0]?.value || 0;

    els.overviewCards.innerHTML = cards
      .map(
        ([metric, value, note]) => `
          <div class="overview-metric-card">
            <div class="overview-metric-card__metric">${escapeHtml(metric)}</div>
            <div class="overview-metric-card__value">${escapeHtml(value)}</div>
            <div class="overview-metric-card__note">${escapeHtml(note)}</div>
          </div>
        `
      )
      .join("") +
      `
        <article class="overview-donut-card">
          <h3>当前任务状态分布</h3>
          <div class="overview-donut-card__stats">
            <div class="overview-mini-stat is-blue"><span>当前任务</span><strong>${formatInteger(statusTotal)}</strong></div>
            <div class="overview-mini-stat"><span>主导状态</span><strong>${escapeHtml(leadingStatus)}</strong></div>
            <div class="overview-mini-stat is-green"><span>活跃任务（标注中和审核中）</span><strong>${formatInteger(activeTasks)}</strong></div>
          </div>
          <div class="overview-donut-card__chart"><canvas id="overview-status-chart"></canvas></div>
        </article>
        <article class="overview-donut-card">
          <h3>任务类型分布（按数据量统计）</h3>
          <div class="overview-donut-card__stats">
            <div class="overview-mini-stat is-blue"><span>覆盖类型</span><strong>${formatInteger(typeRows.length)}</strong></div>
            <div class="overview-mini-stat"><span>主力类型</span><strong>${escapeHtml(leadingType)}</strong></div>
            <div class="overview-mini-stat"><span>top任务数据量</span><strong>${formatCompact(topTypeVolume)}</strong></div>
          </div>
          <div class="overview-donut-card__chart"><canvas id="overview-task-type-chart"></canvas></div>
        </article>
        <article class="overview-donut-card">
          <h3>不同业务分布（按数据量统计）</h3>
          <div class="overview-donut-card__stats">
            <div class="overview-mini-stat is-blue"><span>覆盖业务</span><strong>${formatInteger(businessRows.length)}</strong></div>
            <div class="overview-mini-stat"><span>主力业务</span><strong>${escapeHtml(leadingBusiness)}</strong></div>
            <div class="overview-mini-stat is-green"><span>top业务数据量</span><strong>${formatCompact(topBusinessVolume)}</strong></div>
          </div>
          <div class="overview-donut-card__chart"><canvas id="overview-business-chart"></canvas></div>
        </article>
      `;
  }

  function renderOverviewDiagnostics(records) {
    renderOverviewDelaySummary(records);
    renderOverviewRiskTable(records);
    renderOverviewOnTimeVendors(records);
  }

  function renderOverviewDelaySummary(records) {
    if (!els.overviewDelaySummary) return;
    const dueFinished = records.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
    const delayedCount = dueFinished.filter((item) => item["按期状态"] === "超期").length;
    const onTimeCount = dueFinished.length - delayedCount;
    const delayRate = safeRatio(delayedCount, delayedCount + onTimeCount);
    const cards = [
      ["延期任务", formatInteger(delayedCount), "is-red"],
      ["延期率", formatPercent(delayRate), "is-amber"],
      ["按期/可控", formatInteger(onTimeCount), "is-blue"],
    ];
    els.overviewDelaySummary.innerHTML = cards
      .map(
        ([label, value, className]) => `
          <div class="overview-mini-stat ${className}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `
      )
      .join("");
  }

  function renderOverviewRiskTable(records) {
    if (!els.overviewRiskTable) return;
    const rows = buildRiskTasks(records);
    if (!rows.length) {
      els.overviewRiskTable.innerHTML = '<tr><td colspan="4"><div class="empty-state">当前范围内暂无风险任务。</div></td></tr>';
      return;
    }
    els.overviewRiskTable.innerHTML = rows
      .map(
        (row) => `
          <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
            <td class="py-3 px-2 text-sm">${escapeHtml(row.name)}</td>
            <td class="py-3 px-2 text-sm text-gray-500">${escapeHtml(row.supplier)}</td>
            <td class="py-3 px-2 text-sm text-gray-500">${escapeHtml(row.dueAt)}</td>
            <td class="py-3 px-2">${renderSupplierRiskBadge(row.risk)}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderOverviewOnTimeVendors(records) {
    if (!els.overviewOnTimeVendors) return;
    const rows = aggregateGroup(records, "供应商名称")
      .map(([name, items]) => {
        const dueFinished = items.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
        const delayedCount = dueFinished.filter((item) => item["按期状态"] === "超期").length;
        return { name, delayedCount, onTimeRate: safeRatio(dueFinished.length - delayedCount, dueFinished.length) };
      })
      .filter((row) => row.delayedCount > 0)
      .sort((a, b) => b.delayedCount - a.delayedCount || a.onTimeRate - b.onTimeRate)
      .slice(0, 3);
    if (!rows.length) {
      els.overviewOnTimeVendors.innerHTML = "";
      return;
    }
    els.overviewOnTimeVendors.innerHTML = `
      <div class="mini-rank-list__title">拉低按时率供应商</div>
      <div class="mini-rank-list">
      ${rows
        .map(
          (row) => `
            <button class="mini-rank-item" type="button" data-supplier="${escapeHtml(row.name)}">
              <span>${escapeHtml(row.name)}</span>
              <strong>${formatInteger(row.delayedCount)} 个延期 / 按时率 ${formatPercent(row.onTimeRate)}</strong>
            </button>
          `
        )
        .join("")}
      </div>
    `;
    els.overviewOnTimeVendors.querySelectorAll("[data-supplier]").forEach((item) => {
      item.addEventListener("click", () => drillToSupplier(item.getAttribute("data-supplier")));
    });
  }

  function renderStateSummary(container, cards) {
    if (!container) return;
    container.innerHTML = cards
      .map(
        ([label, value, className]) => `
          <div class="overview-mini-stat ${className || ""}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `
      )
      .join("");
  }

  function renderTaskKpis(records) {
    if (!els.taskKpiCards) return;
    const summary = buildOverviewSummary(records);
    const cards = [
      ["总任务数", formatInteger(summary.totalTasks), "当前任务筛选范围"],
      ["标注中任务数", formatInteger(summary.labelingTasks), "正在标注处理"],
      ["审核中任务数", formatInteger(summary.reviewingTasks), "等待审核确认"],
      ["审核通过任务数", formatInteger(summary.approvedTasks), "已完成交付"],
    ];
    els.taskKpiCards.innerHTML = cards.map(renderCompactKpiCard).join("");
  }

  function renderTaskTypeDistribution(records) {
    // Data is rendered by the chart function
  }

  function renderTaskMonitoring(records) {
    const groups = buildTaskTypeGroups(records).slice(0, 10);
    if (!groups.length) {
      els.taskMonitorTable.innerHTML = '<tr><td colspan="9"><div class="empty-state">当前筛选范围内没有任务数据。</div></td></tr>';
      return;
    }

    els.taskMonitorTable.innerHTML = groups
      .map((group) => {
        const expanded = state.expandedTaskTypes.has(group.key);
        return `
          <tr class="is-expandable ${expanded ? "is-expanded" : ""}" data-task-type-key="${escapeHtml(group.key)}">
            <td class="px-4 py-3">
              <div class="monitor-name">
                <span class="monitor-toggle">${expanded ? "\u2212" : "+"}</span>
                <div>
                  <div class="monitor-name-title">${escapeHtml(group.name)}</div>
                  <div class="monitor-name-subtitle">${escapeHtml(group.taskId)} / ${escapeHtml(group.batchCountLabel)}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(group.latestTaskCreatedAt)}</td>
            <td class="px-4 py-3">${group.statusBadges}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(group.businessName)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(group.vendorNames)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(group.taskCountLabel)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(group.volumeLabel)}</td>
            <td class="px-4 py-3"><span class="monitor-budget">${escapeHtml(group.budgetAmount)}</span></td>
            <td class="px-4 py-3">${group.riskTaskCount ? renderSupplierRiskBadge("延期") + ` ${formatInteger(group.riskTaskCount)} 个` : renderSupplierRiskBadge("正常")}</td>
          </tr>
          ${
            expanded
              ? `
            <tr class="monitor-child-row">
              <td colspan="9">
                <div class="monitor-child-panel">
                  <div class="monitor-child-header">
                    <div class="monitor-child-title">任务运营</div>
                    <div class="monitor-child-meta">${escapeHtml(group.batchCountLabel)}，按创建时间倒序</div>
                  </div>
                  <table class="monitor-child-table">
                    <thead>
                      <tr>
                        <th>任务ID</th><th>所属任务</th><th>创建时间</th><th>供应商</th>
                        <th>提需人</th><th>任务类型</th><th>任务状态</th><th>进度</th>
                        <th>要求交付</th><th>剩余天数</th><th>风险</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${group.batches.map((batch) => renderBatchRow(batch)).join("")}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          `
              : ""
          }
        `;
      })
      .join("");

    els.taskMonitorTable.querySelectorAll("tr.is-expandable").forEach((row) => {
      row.addEventListener("click", () => {
        const key = row.getAttribute("data-task-type-key");
        toggleTaskTypeExpansion(key);
      });
    });
  }

  function renderSupplierManagement(rows) {
    renderSupplierKpis(rows);
    renderSupplierCapacityCards(rows);
    renderSupplierActiveTasks(rows);
  }

  function renderSupplierKpis(rows) {
    const availableCapacity = sum(rows, (row) => Math.max(row.availableCapacity, 0));
    const highLoadCount = rows.filter((row) => row.status === "紧张" || row.status === "超载").length;
    const riskCount = rows.filter((row) => row.risk === "临期" || row.risk === "延期").length;
    const cards = [
      ["供应商总数", formatInteger(rows.length), "当前筛选范围内可调度供应商"],
      ["总剩余可用产能", formatCompact(availableCapacity), "按月额定产能扣减当前占用"],
      ["高负载供应商数", formatInteger(highLoadCount), "产能利用率达到紧张或超载"],
      ["延期风险供应商数", formatInteger(riskCount), "包含临期或延期任务的供应商"],
    ];

    els.supplierKpiCards.innerHTML = cards
      .map(
        ([label, value, note]) => `
          <article class="supplier-kpi-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <p>${escapeHtml(note)}</p>
          </article>
        `
      )
      .join("");
  }

  function renderSupplierCapacityCards(rows) {
    if (!rows.length) {
      els.supplierCapacityGrid.innerHTML = '<div class="empty-state">当前筛选范围内没有匹配的供应商产能数据。</div>';
      return;
    }

    els.supplierCapacityGrid.innerHTML = rows
      .map(
        (row) => `
          <article class="supplier-capacity-card supplier-capacity-card--${row.statusClass}${state.globalFilters.vendor === row.name ? ' supplier-capacity-card--active' : ''}" data-supplier="${escapeHtml(row.name)}">
            <div class="supplier-capacity-card__head">
              <div>
                <strong>${escapeHtml(row.name)}</strong>
                <span>${escapeHtml(row.specialties.join(" / "))}</span>
              </div>
              ${renderSupplierStatusBadge(row.status)}
            </div>
            <div class="supplier-energy">
              <div class="supplier-energy__meta">
                <span>产能利用率</span>
                <strong>${formatPercent(row.utilization)}</strong>
              </div>
              <div class="supplier-energy__track">
                <span style="width:${Math.min(row.utilization * 100, 100)}%"></span>
              </div>
            </div>
            <div class="supplier-capacity-card__stats">
              <span>额定 ${formatCompact(row.monthlyCapacity)}</span>
              <span>占用 ${formatCompact(row.occupiedCapacity)}</span>
              <span>剩余 ${formatCompact(row.availableCapacity)}</span>
              <span>准时 ${formatPercent(row.onTimeRate)}</span>
            </div>
            <div class="supplier-tag-section">
              <span class="supplier-tag-section__label">能力标签</span>
              <div class="supplier-tags">${renderSupplierTaskTags(row.capabilityTags)}</div>
            </div>
            <div class="supplier-capacity-card__foot">
              <span>${formatInteger(row.currentTaskCount)} 个在接任务</span>
              <span>${escapeHtml(row.earliestAvailableAt)}</span>
            </div>
          </article>
        `
      )
      .join("");

    // Click to drill into a specific supplier
    els.supplierCapacityGrid.querySelectorAll(".supplier-capacity-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("button, a, select, input")) return;
        const name = card.getAttribute("data-supplier");
        if (!name) return;
        if (state.globalFilters.vendor === name) return;
        drillToSupplier(name);
      });
    });
  }

  function renderSupplierActiveTasks(rows) {
    if (!els.supplierActiveTable) return;
    const activeRows = rows.filter((row) => row.tasks.length);
    if (!activeRows.length) {
      els.supplierActiveTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">当前范围内暂无供应商在接任务。</div></td></tr>';
      return;
    }

    els.supplierActiveTable.innerHTML = activeRows
      .map((row) => {
        const expanded = state.expandedSuppliers.has(row.name);
        return `
          <tr class="is-expandable ${expanded ? "is-expanded" : ""}" data-supplier-key="${escapeHtml(row.name)}">
            <td class="px-4 py-3">
              <div class="monitor-name">
                <span class="monitor-toggle">${expanded ? "\u2212" : "+"}</span>
                <div>
                  <div class="monitor-name-title">${escapeHtml(row.name)}</div>
                  <div class="monitor-name-subtitle">${escapeHtml(row.specialties.join(" / "))}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatPercent(row.utilization)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatInteger(row.currentTaskCount)} 个</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatCompact(row.occupiedCapacity)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(row.earliestAvailableAt)}</td>
            <td class="px-4 py-3">${renderSupplierRiskBadge(row.risk)}</td>
          </tr>
          ${
            expanded
              ? `
            <tr class="monitor-child-row">
              <td colspan="6">
                <div class="monitor-child-panel">
                  <div class="monitor-child-header">
                    <div class="monitor-child-title">在接任务详情</div>
                    <div class="monitor-child-meta">${formatInteger(row.tasks.length)} 个任务，按风险和交付时间排序</div>
                  </div>
                  <table class="monitor-child-table">
                    <thead>
                      <tr>
                        <th>任务名称</th><th>任务类别</th><th>任务类型</th><th>数据量</th>
                        <th>进度</th><th>任务状态</th><th>预期交付时间</th><th>剩余天数</th><th>风险</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${row.tasks.map((task) => renderSupplierActiveTaskRow(task)).join("")}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          `
              : ""
          }
        `;
      })
      .join("");

    els.supplierActiveTable.querySelectorAll("tr.is-expandable").forEach((row) => {
      row.addEventListener("click", () => {
        const key = row.getAttribute("data-supplier-key");
        toggleSupplierExpansion(key);
      });
    });
  }

  function renderSupplierActiveTaskRow(task) {
    return `
      <tr>
        <td>${escapeHtml(task.name)}</td>
        <td>${escapeHtml(task.category)}</td>
        <td>${escapeHtml(task.taskType)}</td>
        <td>${formatCompact(task.volume)}</td>
        <td>${escapeHtml(task.progressText)}</td>
        <td>${renderStatusBadge(task.status)}</td>
        <td>${escapeHtml(task.dueAt)}</td>
        <td>${escapeHtml(task.remainingDaysLabel)}</td>
        <td>${renderSupplierRiskBadge(task.risk)}</td>
      </tr>
    `;
  }

  function renderSupplierTaskTags(tags) {
    if (!tags || !tags.length) return '<span class="supplier-tag is-muted">暂无</span>';
    return tags.slice(0, 4).map((tag) => `<span class="supplier-tag">${escapeHtml(tag)}</span>`).join("");
  }

  // ===================== BUSINESS ANALYSIS =====================

  function renderBusinessAnalysis(records) {
    if (!els.businessKpiCards) return;
    const rows = buildBusinessRows(records);
    const totalAmount = sum(rows, (row) => row.amount);
    const topVolume = rows[0];
    const topCost = rows.slice().sort((a, b) => b.amount - a.amount)[0];
    const topTasks = rows.slice().sort((a, b) => b.tasks - a.tasks)[0];

    const cards = [
      ["业务线数量", formatInteger(rows.length), "按费用承担部门统计"],
      ["Top 数据量业务线", topVolume ? topVolume.name : "暂无", topVolume ? formatCompact(topVolume.volume) : "暂无数据"],
      ["Top 成本业务线", topCost ? topCost.name : "暂无", topCost ? formatCurrency(topCost.amount) : "暂无数据"],
      ["Top 任务数业务线", topTasks ? topTasks.name : "暂无", topTasks ? `${formatInteger(topTasks.tasks)} 个任务` : "暂无数据"],
    ];

    els.businessKpiCards.innerHTML = cards.map(renderCompactKpiCard).join("");
    els.businessTable.innerHTML = rows
      .map(
        (row) => `
          <tr class="border-b border-gray-100">
            <td class="px-4 py-3 text-sm font-medium">${escapeHtml(row.name)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatInteger(row.tasks)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatCompact(row.volume)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatCurrency(row.amount)}</td>
            <td class="px-4 py-3 text-sm">${formatPercent(row.onTimeRate)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(row.topCategory || "缺失")} / ${escapeHtml(row.topSupplier || "缺失")}</td>
          </tr>
        `
      )
      .join("");
  }

  // ===================== FINANCE =====================

  function renderFinanceBudget(records) {
    const amount = sum(records, (item) => numberValue(item["预估金额_元"]));
    const vendorRows = buildFinanceVendorRows(records);
    renderFinanceSplitCards(records, amount);
    els.financeTable.innerHTML = vendorRows
      .map(
        (row) => `
          <tr class="border-b border-gray-100">
            <td class="px-4 py-3 text-sm font-medium">${escapeHtml(row.name)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatInteger(row.tasks)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatCompact(row.volume)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatCurrency(row.amount)}</td>
            <td class="px-4 py-3 text-sm">${formatPercent(safeRatio(row.amount, amount))}</td>
            <td class="px-4 py-3">${escapeHtml(row.pendingTasks ? "部分待出账" : "已预提")}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderFinanceSplitCards(records, amount) {
    if (!els.financeSplitCards) return;
    const publicAmount = sum(
      records.filter((item) => item["费用承担部门"] !== "平台产品与研发中心"),
      (item) => numberValue(item["预估金额_元"])
    );
    const privateAmount = Math.max(amount - publicAmount, 0);
    const splitCards = [
      ["对公预算", publicBudget, publicAmount],
      ["对私预算", privateBudget, privateAmount],
    ];
    els.financeSplitCards.innerHTML = splitCards
      .map(([label, budget, used]) => {
        const rate = safeRatio(used, budget);
        return `
          <article class="budget-split-card">
            <div class="budget-split-card__head">
              <span>${escapeHtml(label)}</span>
              <strong>${formatPercent(rate)}</strong>
            </div>
            <div class="metric-progress"><span style="width:${Math.min(rate * 100, 100)}%"></span></div>
            <p>${formatCurrency(used)} / ${formatCurrency(budget)} · 剩余预算 ${formatCurrency(Math.max(budget - used, 0))}</p>
          </article>
        `;
      })
      .join("");
  }

  // ===================== CHART.JS RENDER FUNCTIONS =====================

  function renderChartThroughput(records, rangeKey = "6m") {
    if (!els.overviewThroughputChart) return;
    destroyChart("throughput");

    const rows = buildOverviewThroughputRows(records, rangeKey);
    if (!rows.length) return;

    const ctx = els.overviewThroughputChart.getContext("2d");
    chartInstances.throughput = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            type: "line",
            label: "下发数量",
            data: rows.map((r) => r.volume),
            borderColor: "#3b82f6",
            backgroundColor: "#3b82f6",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "交付数据量",
            data: rows.map((r) => r.completedVolume),
            borderColor: "#10b981",
            backgroundColor: "#10b981",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            yAxisID: "y",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { type: "linear", display: true, position: "left", title: { display: true, text: "数据量" }, grid: { borderDash: [4, 4] } },
        },
      },
    });
  }

  function renderChartOverviewDelayRate(records) {
    if (!els.overviewDelayChart) return;
    destroyChart("overviewDelay");
    const dueFinished = records.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
    const delayedCount = dueFinished.filter((item) => item["按期状态"] === "超期").length;
    const onTimeCount = dueFinished.length - delayedCount;
    const delayRate = safeRatio(delayedCount, delayedCount + onTimeCount) * 100;
    const ctx = els.overviewDelayChart.getContext("2d");
    chartInstances.overviewDelay = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["延期率"],
        datasets: [
          {
            label: "延期率",
            data: [delayRate],
            backgroundColor: "#f59e0b",
            borderRadius: 6,
            barPercentage: 0.68,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => `延期率 ${formatPercent((context.parsed.y || 0) / 100)}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(20, Math.ceil(delayRate / 3) * 3),
            grid: { borderDash: [4, 4] },
            ticks: { callback: (value) => `${value}%` },
          },
        },
      },
    });
  }

  function renderChartOverviewStatusDistribution(records) {
    const canvas = document.getElementById("overview-status-chart");
    if (!canvas) return;
    destroyChart("overviewStatus");
    const rows = buildOverviewStatusRows(records);
    if (!rows.length) return;
    const ctx = canvas.getContext("2d");
    chartInstances.overviewStatus = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            data: rows.map((row) => row.value),
            backgroundColor: ["#4f73d9", "#7acb65", "#ffc340", "#ff5967", "#55bfd8", "#06a96f"],
            borderColor: "#ffffff",
            borderWidth: 4,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (context) => `${context.label}: ${formatInteger(context.parsed)} 个任务` } },
        },
      },
    });
  }

  function renderChartOverviewTaskTypeDistribution(records) {
    const canvas = document.getElementById("overview-task-type-chart");
    if (!canvas) return;
    destroyChart("overviewTaskType");
    const rows = buildOverviewTaskTypeRows(records);
    if (!rows.length) return;
    const ctx = canvas.getContext("2d");
    chartInstances.overviewTaskType = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            data: rows.map((row) => row.value),
            backgroundColor: ["#4f73d9", "#7acb65", "#ffc340", "#ff5967", "#55bfd8"],
            borderColor: "#ffffff",
            borderWidth: 4,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCompact(context.parsed)} 数据量` } },
        },
      },
    });
  }

  function renderChartOverviewBusinessDistribution(records) {
    const canvas = document.getElementById("overview-business-chart");
    if (!canvas) return;
    destroyChart("overviewBusiness");
    const rows = buildOverviewBusinessRows(records);
    if (!rows.length) return;
    const ctx = canvas.getContext("2d");
    chartInstances.overviewBusiness = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            data: rows.map((row) => row.value),
            backgroundColor: ["#4f73d9", "#7acb65", "#ffc340", "#ff5967", "#55bfd8"],
            borderColor: "#ffffff",
            borderWidth: 4,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCompact(context.parsed)} 数据量` } },
        },
      },
    });
  }

  function renderChartMonthTaskTrend(records) {
    if (!els.monthTaskChart) return;
    destroyChart("monthTask");

    const rows = buildMonthlyRows(records);
    if (!rows.length) return;

    const ctx = els.monthTaskChart.getContext("2d");
    chartInstances.monthTask = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            label: "月度任务数",
            data: rows.map((r) => r.tasks),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { borderDash: [4, 4] } }, x: { grid: { display: false } } },
      },
    });
  }

  function renderChartMonthVolumeTrend(records) {
    if (!els.monthVolumeChart) return;
    destroyChart("monthVolume");

    const rows = buildMonthlyRows(records);
    if (!rows.length) return;

    const ctx = els.monthVolumeChart.getContext("2d");
    chartInstances.monthVolume = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            label: "月度数据量",
            data: rows.map((r) => r.volume),
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { borderDash: [4, 4] } }, x: { grid: { display: false } } },
      },
    });
  }

  function renderChartTaskCycleTrend(records) {
    if (!els.taskCycleChart) return;
    destroyChart("taskCycle");

    const rows = buildMonthlyRows(records).map((row) => {
      const monthRecords = records.filter((item) => item["创建月份"] === row.label && item["实际完成时间"]);
      const dueFinished = records.filter((item) => item["创建月份"] === row.label && (item["按期状态"] === "按期" || item["按期状态"] === "超期"));
      const onTimeCount = dueFinished.filter((item) => item["按期状态"] === "按期").length;
      const avgDays = average(
        monthRecords
          .map((item) => calculateDayDiff(item["任务创建时间"], item["实际完成时间"]))
          .filter((value) => value !== null)
      );
      return { label: row.label, value: avgDays || 0, onTimeRate: safeRatio(onTimeCount, dueFinished.length) * 100 };
    });
    if (!rows.length) return;

    const ctx = els.taskCycleChart.getContext("2d");
    chartInstances.taskCycle = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            label: "平均交付周期(天)",
            data: rows.map((r) => r.value),
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            yAxisID: "y",
          },
          {
            label: "按时交付率",
            data: rows.map((r) => r.onTimeRate),
            borderColor: "#f59e0b",
            backgroundColor: "#f59e0b",
            fill: false,
            tension: 0.4,
            pointRadius: 4,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } } },
        scales: {
          y: { beginAtZero: true, grid: { borderDash: [4, 4] }, title: { display: true, text: "天" } },
          y1: {
            beginAtZero: true,
            max: 100,
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "按时率" },
            ticks: { callback: (value) => `${value}%` },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function renderChartTaskDataStatusDistribution(records) {
    if (!els.taskDataStatusChart) return;
    destroyChart("taskDataStatus");

    const rows = buildDataStatusRows(records);
    if (!rows.length) return;
    const labelingData = rows
      .filter((row) => row.label === "标注中")
      .reduce((total, row) => total + row.value, 0);
    renderStateSummary(els.taskDataStatusSummary, [
      ["当前数据", formatCompact(sum(rows, (row) => row.value)), "is-blue"],
      ["标注中数据", formatCompact(labelingData), ""],
      [
        "活跃数据",
        formatCompact(
          rows
            .filter((row) => row.label !== "审核通过" && row.label !== "待审核")
            .reduce((total, row) => total + row.value, 0)
        ),
        "is-green",
      ],
    ]);

    const ctx = els.taskDataStatusChart.getContext("2d");
    chartInstances.taskDataStatus = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.value),
            backgroundColor: ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06a96f"],
            borderColor: "#ffffff",
            borderWidth: 4,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCompact(context.parsed)} 数据量` } },
        },
      },
    });
  }

  function renderChartTaskTypeDistribution(records) {
    if (!els.taskTypeChart) return;
    destroyChart("taskType");

    const rows = aggregate(records, "任务类型", (items) => items.length).map((item) => ({
      label: item.label,
      value: item.value,
    }));
    if (!rows.length) return;

    const ctx = els.taskTypeChart.getContext("2d");
    chartInstances.taskType = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.slice(0, 6).map((r) => r.label),
        datasets: [
          {
            label: "任务数",
            data: rows.slice(0, 6).map((r) => r.value),
            backgroundColor: "#f59e0b",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { borderDash: [4, 4] } }, y: { grid: { display: false } } },
      },
    });
  }

  function renderChartSupplierOnTimeRank(records) {
    if (!els.supplierOnTimeChart) return;
    destroyChart("supplierOnTime");

    const rows = buildSupplierPerformanceRows(records).sort((a, b) => b.onTimeRate - a.onTimeRate).slice(0, 8);
    if (!rows.length) return;

    const ctx = els.supplierOnTimeChart.getContext("2d");
    chartInstances.supplierOnTime = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.name),
        datasets: [
          {
            label: "准时交付率",
            data: rows.map((row) => row.onTimeRate * 100),
            backgroundColor: "#10b981",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const row = rows[context.dataIndex];
                return `准时交付率 ${formatPercent(row.onTimeRate)}，按时 ${formatInteger(row.onTimeCount)} / ${formatInteger(row.finishedCount)}`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { borderDash: [4, 4] }, ticks: { callback: (value) => `${value}%` } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  function renderChartSupplierCostDistribution(records) {
    if (!els.supplierCostChart) return;
    destroyChart("supplierCost");

    const rows = buildFinanceVendorRows(records).slice(0, 6);
    if (!rows.length) return;

    const ctx = els.supplierCostChart.getContext("2d");
    chartInstances.supplierCost = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.name),
        datasets: [
          {
            label: "结算金额",
            data: rows.map((row) => row.amount),
            backgroundColor: "#3b82f6",
            borderColor: "#2563eb",
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCurrency(context.parsed.y || 0)}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { borderDash: [4, 4] }, title: { display: true, text: "结算金额" } },
        },
      },
    });
  }

  function renderChartBusinessCompare(records) {
    if (!els.businessCompareChart) return;
    destroyChart("businessCompare");

    const rows = buildBusinessRows(records).slice(0, 6);
    if (!rows.length) return;

    const labels = rows.map((r) => r.name);
    const ctx = els.businessCompareChart.getContext("2d");
    chartInstances.businessCompare = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "数据量",
            data: rows.map((r) => r.volume),
            borderColor: "#3b82f6",
            backgroundColor: "#3b82f6",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 4,
            yAxisID: "y",
          },
          {
            label: "结算金额",
            data: rows.map((r) => r.amount),
            borderColor: "#f59e0b",
            backgroundColor: "#f59e0b",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 4,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { borderDash: [4, 4] }, title: { display: true, text: "数据量" } },
          y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "结算金额" } },
        },
      },
    });
  }

  function renderChartBusinessTrend(records) {
    if (!els.businessTrendChart) return;
    destroyChart("businessTrend");

    const businessRows = buildBusinessRows(records);
    const topBusinessNames = businessRows.slice(0, 5).map((row) => row.name);
    const months = uniqueValues(records.map((item) => item["创建月份"])).sort();
    if (!months.length || !topBusinessNames.length) return;

    const colors = topVendorRankColors;
    const datasets = topBusinessNames.map((name, index) => ({
      label: name,
      data: months.map((month) =>
        sum(
          records.filter((item) => item["创建月份"] === month && item["费用承担部门"] === name),
          (item) => numberValue(item["数据量"])
        )
      ),
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length],
      tension: 0.3,
      pointRadius: 3,
    }));

    const ctx = els.businessTrendChart.getContext("2d");
    chartInstances.businessTrend = new Chart(ctx, {
      type: "line",
      data: { labels: months, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } } },
        scales: { y: { beginAtZero: true, grid: { borderDash: [4, 4] } }, x: { grid: { display: false } } },
      },
    });
  }

  function renderChartFinanceCompare(records) {
    if (!els.financeCompareChart) return;
    destroyChart("financeCompare");

    const vendorRows = buildFinanceVendorRows(records);
    const months = buildMonthlyRows(records).map((row) => row.label);
    const topVendors = vendorRows.slice(0, 5);
    if (!months.length || !topVendors.length) return;

    const colors = topVendorRankColors;
    const datasets = topVendors.map((vendor, index) => ({
      label: vendor.name,
      data: months.map((month) =>
        sum(
          records.filter((item) => item["创建月份"] === month && item["供应商名称"] === vendor.name),
          (item) => numberValue(item["预估金额_元"])
        )
      ),
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length],
      tension: 0.3,
      pointRadius: 3,
    }));

    const ctx = els.financeCompareChart.getContext("2d");
    chartInstances.financeCompare = new Chart(ctx, {
      type: "line",
      data: { labels: months, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } } },
        scales: { y: { beginAtZero: true, grid: { borderDash: [4, 4] } }, x: { grid: { display: false } } },
      },
    });
  }

  function renderChartFinanceTotalTrend(records) {
    if (!els.financeTotalChart) return;
    destroyChart("financeTotal");

    const rows = buildMonthlyRows(records);
    if (!rows.length) return;

    const ctx = els.financeTotalChart.getContext("2d");
    chartInstances.financeTotal = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            label: "月结算金额",
            data: rows.map((row) => row.amount),
            backgroundColor: "rgba(59, 130, 246, 0.24)",
            borderColor: "#3b82f6",
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { borderDash: [4, 4] }, title: { display: true, text: "结算金额" } },
        },
      },
    });
  }

  // ===================== HELPER FUNCTIONS (unchanged from original) =====================

  function renderCompactKpiCard([label, value, note]) {
    return `
      <article class="supplier-kpi-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <p>${escapeHtml(note)}</p>
      </article>
    `;
  }

  function renderStatusBadge(status) {
    const cls =
      status === "审核通过"
        ? "is-done"
        : status === "延期"
          ? "is-delayed"
          : status === "审核中"
            ? "is-warning"
            : "is-running";
    return renderBadge(status || "缺失", cls);
  }

  function renderBadge(text, className) {
    return `<span class="badge ${className || ""}">${escapeHtml(text || "缺失")}</span>`;
  }

  function renderSupplierStatusBadge(status) {
    const mapping = { 空闲: "is-done", 健康: "is-running", 紧张: "is-warning", 超载: "is-delayed" };
    return renderBadge(status, mapping[status] || "is-muted");
  }

  function renderSupplierRiskBadge(risk) {
    const mapping = { 正常: "is-done", 临期: "is-warning", 延期: "is-delayed" };
    return renderBadge(risk, mapping[risk] || "is-muted");
  }

  function buildOverviewSummary(records) {
    const latestMonth = getLatestMonth(records);
    const dueFinished = records.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
    const onTimeCount = dueFinished.filter((item) => item["按期状态"] === "按期").length;
    return {
      totalTasks: records.length,
      labelingTasks: records.filter((item) => item["流程状态"] === "标注中").length,
      reviewingTasks: records.filter((item) => item["流程状态"] === "审核中").length,
      approvedTasks: records.filter((item) => item["流程状态"] === "审核通过").length,
      newTasks: latestMonth ? records.filter((item) => item["创建月份"] === latestMonth).length : 0,
      latestMonth,
      volume: sum(records, (item) => numberValue(item["数据量"])),
      amount: sum(records, (item) => numberValue(item["预估金额_元"])),
      dueFinishedCount: dueFinished.length,
      overdueCount: dueFinished.filter((item) => item["按期状态"] === "超期").length,
      onTimeRate: safeRatio(onTimeCount, dueFinished.length),
    };
  }

  function buildMonthlyRows(records) {
    const grouped = groupBy(records, "创建月份");
    return Object.keys(grouped)
      .sort()
      .map((month) => {
        const items = grouped[month];
        return { label: month, tasks: items.length, volume: sum(items, (item) => numberValue(item["数据量"])), amount: sum(items, (item) => numberValue(item["预估金额_元"])) };
      });
  }

  function buildOverviewThroughputRows(records, rangeKey) {
    const filteredRecords = filterRecentPeriod(records, rangeKey);
    if (String(rangeKey).endsWith("d")) {
      return buildDailyRows(filteredRecords);
    }
    return buildMonthlyRows(filteredRecords).map((row) => {
      const monthRecords = filteredRecords.filter((item) => item["创建月份"] === row.label);
      return {
        ...row,
        completedVolume: sum(
          monthRecords.filter((item) => item["流程状态"] === "审核通过"),
          (item) => numberValue(item["数据量"])
        ),
      };
    });
  }

  function buildDailyRows(records) {
    const grouped = records.reduce((result, item) => {
      const day = getRecordDate(item);
      if (!day) return result;
      if (!result[day]) result[day] = [];
      result[day].push(item);
      return result;
    }, {});
    return Object.keys(grouped)
      .sort()
      .map((day) => {
        const items = grouped[day];
        return {
          label: formatDayLabel(day),
          tasks: items.length,
          volume: sum(items, (item) => numberValue(item["数据量"])),
          completedVolume: sum(
            items.filter((item) => item["流程状态"] === "审核通过"),
            (item) => numberValue(item["数据量"])
          ),
        };
      });
  }

  function buildOverviewStatusRows(records) {
    const preferredOrder = ["待标注", "标注中", "审核中", "审核通过", "已驳回", "延期"];
    return aggregate(records, "流程状态", (items) => items.length)
      .filter((row) => row.label && row.label !== "待审核")
      .sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.label);
        const bIndex = preferredOrder.indexOf(b.label);
        if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        return b.value - a.value;
      });
  }

  function buildOverviewTaskTypeRows(records) {
    return aggregateGroup(records, "任务类型")
      .map(([label, items]) => ({
        label,
        value: sum(items, (item) => numberValue(item["数据量"])),
        tasks: items.length,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  function buildOverviewBusinessRows(records) {
    return aggregateGroup(records, "费用承担部门")
      .map(([label, items]) => ({
        label,
        value: sum(items, (item) => numberValue(item["数据量"])),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  function buildDataStatusRows(records) {
    const preferredOrder = ["待标注", "标注中", "审核中", "审核通过", "已驳回", "延期"];
    return aggregateGroup(records, "流程状态")
      .map(([label, items]) => ({
        label,
        value: sum(items, (item) => numberValue(item["数据量"])),
      }))
      .filter((row) => row.label && row.label !== "待审核")
      .sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.label);
        const bIndex = preferredOrder.indexOf(b.label);
        if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        return b.value - a.value;
      });
  }

  function filterRecentPeriod(records, rangeKey) {
    const key = String(rangeKey || "7d");
    if (key.endsWith("d")) {
      return filterRecentDays(records, Number(key.replace("d", "")) || 7);
    }
    if (key === "quarter") {
      return filterCurrentQuarter(records);
    }
    if (key === "year") {
      return filterCurrentYear(records);
    }
    return filterRecentMonths(records, Number(key.replace("m", "")) || 6);
  }

  function filterRecentMonths(records, monthCount) {
    const months = uniqueValues(records.map((item) => item["创建月份"])).sort();
    const keepMonths = new Set(months.slice(-monthCount));
    return records.filter((item) => keepMonths.has(item["创建月份"]));
  }

  function filterRecentDays(records, dayCount) {
    const latestDate = getLatestRecordDate(records);
    if (!latestDate) return records;
    const startDate = new Date(latestDate);
    startDate.setDate(startDate.getDate() - Math.max(dayCount - 1, 0));
    return records.filter((item) => {
      const recordDate = parseDate(getRecordDate(item));
      return recordDate && recordDate >= startDate && recordDate <= latestDate;
    });
  }

  function filterCurrentQuarter(records) {
    const latestDate = getLatestRecordDate(records);
    if (!latestDate) return records;
    const quarterStartMonth = Math.floor(latestDate.getMonth() / 3) * 3;
    const startDate = new Date(latestDate.getFullYear(), quarterStartMonth, 1);
    return filterByDateRange(records, startDate, latestDate);
  }

  function filterCurrentYear(records) {
    const latestDate = getLatestRecordDate(records);
    if (!latestDate) return records;
    const startDate = new Date(latestDate.getFullYear(), 0, 1);
    return filterByDateRange(records, startDate, latestDate);
  }

  function filterByDateRange(records, startDate, endDate) {
    return records.filter((item) => {
      const recordDate = parseDate(getRecordDate(item));
      return recordDate && recordDate >= startDate && recordDate <= endDate;
    });
  }

  function buildRiskTasks(records) {
    return records
      .map((record, index) => {
        const delay = normalizeDelay(record);
        const remainingDays = calculateRemainingDaysFrom(record["要求交付日期"], dashboardData.meta?.generatedAt);
        const risk =
          record["按期状态"] === "超期" || (delay !== null && delay > 0)
            ? "延期"
            : remainingDays !== null && remainingDays >= 0 && remainingDays <= 2
              ? "临期"
              : "正常";
        return {
          recordId: record["记录ID"] || `${record["任务类别"] || "task"}-${index}`,
          name: record["数据名"] || `任务 ${index + 1}`,
          category: record["任务类别"] || "",
          supplier: record["供应商名称"] || "缺失",
          dueAt: record["要求交付日期"] || record["交付要求类型"] || "日清滚动",
          risk,
          remainingDaysValue: remainingDays === null ? 999 : remainingDays,
          amount: numberValue(record["预估金额_元"]),
        };
      })
      .filter((row) => row.risk !== "正常")
      .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.remainingDaysValue - b.remainingDaysValue || b.amount - a.amount);
  }

  function buildBusinessRows(records) {
    return aggregateGroup(records, "费用承担部门")
      .map(([name, items]) => {
        const dueFinished = items.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
        const onTimeCount = dueFinished.filter((item) => item["按期状态"] === "按期").length;
        const topCategory = aggregate(items, "任务类别", (categoryItems) => categoryItems.length)[0];
        const topSupplier = aggregate(items, "供应商名称", (supplierItems) => supplierItems.length)[0];
        return {
          name,
          tasks: items.length,
          volume: sum(items, (item) => numberValue(item["数据量"])),
          amount: sum(items, (item) => numberValue(item["预估金额_元"])),
          onTimeRate: safeRatio(onTimeCount, dueFinished.length),
          topCategory: topCategory ? topCategory.label : "",
          topSupplier: topSupplier ? topSupplier.label : "",
        };
      })
      .sort((a, b) => b.volume - a.volume);
  }

  function buildFinanceVendorRows(records) {
    return aggregateGroup(records, "供应商名称")
      .map(([name, items]) => ({
        name,
        tasks: items.length,
        volume: sum(items, (item) => numberValue(item["数据量"])),
        amount: sum(items, (item) => numberValue(item["预估金额_元"])),
        pendingTasks: items.filter((item) => item["是否完成"] !== "是").length,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  function buildSupplierPerformanceRows(records) {
    return aggregateGroup(records, "供应商名称")
      .map(([name, items]) => {
        const finishedItems = items.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
        const onTimeCount = finishedItems.filter((item) => item["按期状态"] === "按期").length;
        return {
          name,
          finishedCount: finishedItems.length,
          onTimeCount,
          onTimeRate: safeRatio(onTimeCount, finishedItems.length),
        };
      })
      .filter((row) => row.finishedCount > 0);
  }

  function buildTaskTypeGroups(records) {
    return aggregateGroup(records, "任务类别")
      .map(([taskCategory, items], index) => {
        const sortedItems = items.slice().sort((a, b) => String(b["任务创建时间"] || "").localeCompare(String(a["任务创建时间"] || "")));
        const latestTaskCreatedAt = sortedItems[0]?.["任务创建时间"] || "缺失";
        const amount = sum(items, (item) => numberValue(item["预估金额_元"]));
        const volume = sum(items, (item) => numberValue(item["数据量"]));
        const batches = sortedItems.map((item, batchIndex) => buildBatchRow(item, batchIndex));
        const riskTaskCount = batches.filter((batch) => batch.risk !== "正常").length;
        return {
          key: taskCategory,
          taskId: `TT-${String(index + 1).padStart(3, "0")}`,
          name: taskCategory || "缺失",
          latestTaskCreatedAt,
          businessNames: uniqueValues(items.map((item) => item["费用承担部门"])),
          vendorNameList: uniqueValues(items.map((item) => item["供应商名称"])),
          statusList: uniqueValues(batches.map((batch) => batch.status)),
          businessName: uniqueValues(items.map((item) => item["费用承担部门"])).join("、") || "缺失",
          vendorNames: uniqueValues(items.map((item) => item["供应商名称"])).join("、") || "缺失",
          taskCountLabel: `${formatInteger(items.length)} 个`,
          volumeLabel: formatCompact(volume),
          budgetAmount: formatCurrency(amount),
          batchCountLabel: `${formatInteger(items.length)} 个任务`,
          riskTaskCount,
          statusBadges: buildTaskStatusBadges(batches),
          batches,
        };
      })
      .sort((a, b) => String(b.latestTaskCreatedAt).localeCompare(String(a.latestTaskCreatedAt)));
  }

  function buildBatchRow(item, index) {
    const delay = normalizeDelay(item);
    const status = deriveBatchStatus(item, delay);
    const progress = Number(item["标注进度"]) || deriveProgress(status, index);
    const totalQuantity = Math.max(numberValue(item["数据量"]), 0);
    const completedQuantity = status === "审核通过" ? totalQuantity : Math.min(totalQuantity, Math.round((totalQuantity * progress) / 100));
    return {
      recordId: item["记录ID"] || `${item["任务类别"] || "task"}-${index}`,
      batchLabel: `TK-${String(index + 1).padStart(3, "0")}`,
      taskName: item["数据名"] || "缺失",
      releaseAt: item["任务创建时间"] || "缺失",
      supplierName: item["供应商名称"] || "缺失",
      requester: item["提需人"] || "缺失",
      taskType: item["任务类型"] || "缺失",
      status,
      progressText: `${formatInteger(completedQuantity)}/${formatInteger(totalQuantity)}`,
      dueAt: item["要求交付日期"] || item["交付要求类型"] || "日清滚动",
      remainingDays: formatRemainingDays(calculateRemainingDays(item["要求交付日期"])),
      risk: deriveTaskRisk(status, calculateRemainingDays(item["要求交付日期"]), item),
    };
  }

  function renderBatchRow(batch) {
    const isFocused = state.focusedTaskRecordId && state.focusedTaskRecordId === String(batch.recordId);
    return `
      <tr class="${isFocused ? "is-focused-task" : ""}" data-task-record-id="${escapeHtml(batch.recordId)}">
        <td class="px-4 py-3 text-sm">${escapeHtml(batch.batchLabel)}</td>
        <td class="px-4 py-3 text-sm">${escapeHtml(batch.taskName)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.releaseAt)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.supplierName)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.requester)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.taskType)}</td>
        <td class="px-4 py-3">${renderStatusBadge(batch.status)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.progressText)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.dueAt)}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(batch.remainingDays)}</td>
        <td class="px-4 py-3">${renderSupplierRiskBadge(batch.risk)}</td>
      </tr>
    `;
  }

  function buildSupplierRow(profile, records, index) {
    const supplierRecords = records.filter((record) => record["供应商名称"] === profile.name);
    const currentRecords = supplierRecords.filter(isCurrentSupplierTask);
    const tasks = currentRecords
      .map((record, taskIndex) => buildSupplierTask(record, taskIndex))
      .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.remainingDaysValue - b.remainingDaysValue);
    const occupiedCapacity = sum(tasks, (task) => task.volume);
    const utilization = safeRatio(occupiedCapacity, profile.monthlyCapacity);
    const status = deriveSupplierStatus(utilization);
    const risk = deriveSupplierRisk(tasks);
    const availableCapacity = profile.monthlyCapacity - occupiedCapacity;
    const earliestAvailableAt = deriveEarliestAvailableAt(status, tasks);
    const recommendationScore = calculateSupplierRecommendationScore(profile, utilization, availableCapacity, risk);
    const capabilityTags = uniqueValues(profile.specialties.filter(Boolean));

    return {
      id: `SP-${String(index + 1).padStart(3, "0")}`,
      name: profile.name,
      monthlyCapacity: profile.monthlyCapacity,
      occupiedCapacity,
      availableCapacity,
      utilization,
      status,
      statusClass: supplierStatusClass(status),
      risk,
      currentTaskCount: tasks.length,
      earliestAvailableAt,
      specialties: profile.specialties,
      capabilityTags,
      onTimeRate: profile.onTimeRate,
      recommendationScore,
      recommendationReason: buildSupplierRecommendationReason(profile, status, risk, availableCapacity),
      tasks,
    };
  }

  function buildSupplierTask(record, index) {
    const delay = normalizeDelay(record);
    const status = deriveBatchStatus(record, delay);
    const progress = Number(record["标注进度"]) || deriveProgress(status, index);
    const volume = Math.max(numberValue(record["数据量"]), 0);
    const completedVolume = status === "审核通过" ? volume : Math.min(volume, Math.round((volume * progress) / 100));
    const remainingVolume = Math.max(volume - completedVolume, 0);
    const remainingDays = calculateRemainingDays(record["要求交付日期"]);
    const risk = deriveTaskRisk(status, remainingDays, record);

    return {
      name: record["数据名"] || "缺失",
      category: record["任务类别"] || "缺失",
      taskType: record["任务类型"] || "缺失",
      volume,
      remainingVolume,
      progressText: `${formatInteger(completedVolume)}/${formatInteger(volume)}`,
      status,
      dueAt: record["要求交付日期"] || record["交付要求类型"] || "日清滚动",
      remainingDaysValue: remainingDays === null ? 999 : remainingDays,
      remainingDaysLabel: formatRemainingDays(remainingDays),
      risk,
    };
  }

  function isCurrentSupplierTask(record) {
    return record["是否完成"] !== "是" || record["流程状态"] !== "审核通过";
  }

  function deriveSupplierStatus(utilization) {
    if (utilization < 0.6) return "空闲";
    if (utilization < 0.85) return "健康";
    if (utilization <= 1) return "紧张";
    return "超载";
  }

  function supplierStatusClass(status) {
    return { 空闲: "idle", 健康: "healthy", 紧张: "tight", 超载: "overload" }[status] || "idle";
  }

  function deriveSupplierRisk(tasks) {
    if (tasks.some((task) => task.risk === "延期")) return "延期";
    if (tasks.some((task) => task.risk === "临期")) return "临期";
    return "正常";
  }

  function deriveTaskRisk(status, remainingDays, record) {
    if (status === "延期" || record["按期状态"] === "超期" || (remainingDays !== null && remainingDays < 0)) return "延期";
    if (remainingDays !== null && remainingDays <= 2) return "临期";
    return "正常";
  }

  function calculateRemainingDays(dueAt) {
    if (!dueAt) return null;
    const dueDate = new Date(`${dueAt}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  }

  function calculateRemainingDaysFrom(dueAt, referenceAt) {
    if (!dueAt) return null;
    const dueDate = new Date(`${dueAt}T00:00:00`);
    const referenceDate = new Date(`${String(referenceAt || "").slice(0, 10)}T00:00:00`);
    if (Number.isNaN(dueDate.getTime()) || Number.isNaN(referenceDate.getTime())) return null;
    return Math.ceil((dueDate.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000));
  }

  function formatRemainingDays(days) {
    if (days === null) return "日清 / 无固定日期";
    if (days < 0) return `已超期 ${Math.abs(days)} 天`;
    if (days === 0) return "今天到期";
    return `剩余 ${days} 天`;
  }

  function deriveEarliestAvailableAt(status, tasks) {
    if (!tasks.length || status === "空闲" || status === "健康") return "即刻可接";
    const datedTasks = tasks.filter((task) => task.dueAt && task.dueAt !== "日清滚动").sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
    return datedTasks[0] ? `${datedTasks[0].dueAt} 后可释放` : "需排期确认";
  }

  function calculateSupplierRecommendationScore(profile, utilization, availableCapacity, risk) {
    const capacityScore = Math.max(availableCapacity, 0) / profile.monthlyCapacity;
    const riskScore = risk === "正常" ? 1 : risk === "临期" ? 0.55 : 0.18;
    const loadScore = Math.max(0, 1 - utilization);
    return capacityScore * 42 + profile.onTimeRate * 34 + riskScore * 16 + loadScore * 8;
  }

  function buildSupplierRecommendationReason(profile, status, risk, availableCapacity) {
    if (status === "超载") return `${profile.name} 当前已超载，建议暂停新增任务。`;
    if (risk === "延期") return `${profile.name} 存在延期任务，需先释放存量。`;
    if (availableCapacity > profile.monthlyCapacity * 0.35) return `${profile.name} 剩余产能充足，适合新增任务。`;
    return `${profile.name} 负载${status}，可承接小批量任务。`;
  }

  function buildTaskStatusBadges(batches) {
    const priority = ["延期", "标注中", "审核中", "审核通过"];
    const counts = batches.reduce((acc, batch) => {
      const status = batch.risk === "延期" ? "延期" : batch.status;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const badges = priority
      .filter((status) => counts[status])
      .map((status) => `${renderStatusBadge(status)} <span class="status-count">${formatInteger(counts[status])}</span>`);
    return `<div class="status-badge-set">${badges.length ? badges.join("") : renderStatusBadge("缺失")}</div>`;
  }

  function toggleTaskTypeExpansion(key) {
    if (!key) return;
    if (state.expandedTaskTypes.has(key)) state.expandedTaskTypes.delete(key);
    else state.expandedTaskTypes.add(key);
    render();
  }

  function toggleSupplierExpansion(key) {
    if (!key) return;
    if (state.expandedSuppliers.has(key)) state.expandedSuppliers.delete(key);
    else state.expandedSuppliers.add(key);
    render();
  }

  function drillToRiskTask(recordId, category) {
    if (!category) return;
    state.focusedTaskRecordId = recordId || "";
    state.expandedTaskTypes.add(category);
    state.activeSection = "tasks";
    render();
    renderSectionNav();
    switchTab("tasks");
  }

  function drillToSupplier(name) {
    if (!name) return;
    applyGlobalFilterValue("vendor", name);
    state.expandedSuppliers.clear();
    state.expandedSuppliers.add(name);
    state.activeSection = "suppliers";
    render();
    renderSectionNav();
    switchTab("suppliers");
  }

  function resetSupplierFilter() {
    state.globalFilters.vendor = "全部";
    state.expandedSuppliers.clear();
    render();
    renderSectionNav();
  }

  function updateSupplierCapacityResetBtnVisibility() {
    if (!els.supplierCapacityReset) return;
    const isFiltered = state.globalFilters.vendor !== "全部";
    els.supplierCapacityReset.classList.toggle("hidden", !isFiltered);
  }

  function riskRank(risk) {
    return { 正常: 0, 临期: 1, 延期: 2 }[risk] || 0;
  }

  function calculateDayDiff(startAt, endAt) {
    if (!startAt || !endAt) return null;
    const startDate = new Date(`${startAt}T00:00:00`);
    const endDate = new Date(`${endAt}T00:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  }

  function parseDate(dateText) {
    if (!dateText) return null;
    const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getRecordDate(record) {
    return String(record["任务创建时间"] || "").slice(0, 10);
  }

  function getLatestRecordDate(records) {
    const dates = records.map((item) => parseDate(getRecordDate(item))).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) return dates[dates.length - 1];
    return parseDate(dashboardData.meta?.timeRange?.end) || parseDate(dashboardData.meta?.generatedAt);
  }

  function formatDayLabel(dateText) {
    const date = parseDate(dateText);
    if (!date) return dateText;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function average(values) {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (!validValues.length) return 0;
    return validValues.reduce((total, value) => total + value, 0) / validValues.length;
  }

  function getLatestMonth(records) {
    const months = uniqueValues(records.map((item) => item["创建月份"])).sort();
    return months.length ? months[months.length - 1] : "";
  }

  function calculatePublicAmount(records) {
    return sum(
      records.filter((item) => item["费用承担部门"] !== "平台产品与研发中心"),
      (item) => numberValue(item["预估金额_元"])
    );
  }

  function applyGlobalFilterValue(key, value) {
    state.globalFilters[key] = value;
    const field = document.getElementById(`global-filter-${key}`);
    if (field) field.value = value;
  }

  function matchesDateRange(record, filters) {
    if (!filters || (!filters.dateStart && !filters.dateEnd)) return true;
    const recordDate = String(record["任务创建时间"] || "");
    if (!recordDate) return false;
    const [startDate, endDate] = normalizeDateBounds(filters.dateStart, filters.dateEnd);
    if (startDate && recordDate < startDate) return false;
    if (endDate && recordDate > endDate) return false;
    return true;
  }

  function normalizeDateBounds(dateStart, dateEnd) {
    const startDate = String(dateStart || "");
    const endDate = String(dateEnd || "");
    if (startDate && endDate && startDate > endDate) return [endDate, startDate];
    return [startDate, endDate];
  }

  function isDateFilterKey(key) {
    return dateFilterKeys.includes(key);
  }

  function displayFilterName(key) {
    const mapping = {
      dateStart: "开始日期", dateEnd: "结束日期", department: "费用承担部门",
      template: "使用模版", vendor: "供应商名称", category: "任务类别",
      status: "任务状态", requester: "提需人",
    };
    return mapping[key] || key;
  }

  // ===================== ASSISTANT =====================

  function initAssistant() {
    state.assistantMessages = [
      { role: "assistant", text: "我可以基于当前看板数据回答运营问题。\n当前支持大盘、任务、供应商和结算维度分析。" },
    ];

    els.assistantModeNote.textContent = "基于当前数据源范围生成回答。";
    els.assistantApiNote.textContent = "回答仅供运营分析参考，请以明细数据为准。";

    els.assistantEntry.addEventListener("click", () => {
      state.assistantOpen = true;
      renderAssistant(getGlobalRecords());
    });
    els.assistantClose.addEventListener("click", () => {
      state.assistantOpen = false;
      renderAssistant(getGlobalRecords());
    });
    els.assistantForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = els.assistantInput.value.trim();
      if (!question || state.assistantBusy) return;
      els.assistantInput.value = "";
      await askAssistant(question);
    });

    renderAssistantSuggestions();
  }

  function renderAssistant(records) {
    els.assistantPanel.classList.toggle("translate-x-[calc(100%+24px)]", !state.assistantOpen);
    els.assistantPanel.classList.toggle("translate-x-0", state.assistantOpen);
    els.assistantPanel.setAttribute("aria-hidden", state.assistantOpen ? "false" : "true");

    els.assistantMessages.innerHTML = state.assistantMessages
      .map(
        (message) => `
          <div class="flex gap-2.5 items-start assistant-message--${message.role}">
            <span class="w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${
              message.role === "assistant" ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-700"
            }">${message.role === "assistant" ? "AI" : "你"}</span>
            <div class="max-w-[calc(100%-36px)] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed text-gray-600 ${
              message.role === "assistant" ? "bg-white border border-gray-100" : "bg-amber-50 border border-amber-100"
            }">${escapeHtml(message.text)}</div>
          </div>
        `
      )
      .join("");

    els.assistantSubmit.disabled = state.assistantBusy;
    els.assistantInput.disabled = state.assistantBusy;
    els.assistantModeNote.textContent = `当前数据源范围 ${formatInteger(records.length)} 条任务记录。`;
  }

  function renderAssistantSuggestions() {
    els.assistantSuggestionList.innerHTML = assistantSuggestionPool
      .map((question) => `<button class="px-3 py-1.5 border border-gray-200 rounded-full text-xs text-gray-500 bg-white hover:bg-gray-50 cursor-pointer" type="button">${escapeHtml(question)}</button>`)
      .join("");

    els.assistantSuggestionList.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", async () => {
        if (state.assistantBusy) return;
        await askAssistant(button.textContent.trim());
      });
    });
  }

  async function askAssistant(question) {
    const records = getGlobalRecords();
    state.assistantMessages.push({ role: "user", text: question });
    state.assistantBusy = true;
    renderAssistant(records);

    let answer = "";
    try {
      answer = await requestAssistantAnswer(question, records);
    } catch (error) {
      answer = `当前问答暂时不可用。\n错误信息：${error instanceof Error ? error.message : "未知错误"}`;
    }

    state.assistantMessages.push({ role: "assistant", text: answer });
    state.assistantBusy = false;
    renderAssistant(records);
  }

  async function requestAssistantAnswer(question, records) {
    if (assistantConfig.mode === "remote") return requestRemoteAssistantAnswer(question, records);
    return requestLocalAssistantAnswer(question, records);
  }

  async function requestRemoteAssistantAnswer(question, records) {
    const endpoint = joinUrl(assistantConfig.apiBaseUrl, assistantConfig.chatEndpoint);
    if (!endpoint) throw new Error("未配置聊天接口地址");
    const apiKey = await fetchAssistantApiKey();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ question, filters: state.globalFilters, summary: buildAssistantSummary(records) }),
    });
    if (!response.ok) throw new Error(`接口返回 ${response.status}`);
    const data = await response.json();
    return data.answer || "接口已返回，但没有可展示的回答。";
  }

  async function fetchAssistantApiKey() {
    if (assistantConfig.mode !== "remote") return "";
    const endpoint = joinUrl(assistantConfig.apiBaseUrl, assistantConfig.apiKeyEndpoint);
    if (!endpoint) return "";
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`API Key 接口返回 ${response.status}`);
    const data = await response.json();
    return data.apiKey || "";
  }

  async function requestLocalAssistantAnswer(question, records) {
    await wait(420);
    return buildLocalAssistantAnswer(question, records);
  }

  function buildLocalAssistantAnswer(question, records) {
    const q = question.toLowerCase();
    const summary = buildAssistantSummary(records);
    const topVendor = aggregate(records, "供应商名称", (items) => sum(items, (item) => numberValue(item["预估金额_元"])))[0];
    const topCategory = aggregate(records, "任务类别", (items) => sum(items, (item) => numberValue(item["数据量"])))[0];
    const topRequester = aggregate(records, "提需人", (items) => items.length)[0];
    const latestMonth = getLatestMonth(records);
    const latestMonthCount = latestMonth ? records.filter((item) => String(item["创建月份"] || "") === latestMonth).length : 0;

    if (q.includes("供应商") && (q.includes("金额") || q.includes("最高") || q.includes("最多"))) {
      if (!topVendor) return emptyAssistantAnswer();
      return `当前数据源范围内，结算金额最高的供应商是 ${topVendor.label}。\n结算金额 ${formatCurrency(topVendor.value)}，约占当前范围总金额 ${formatPercent(safeRatio(topVendor.value, summary.amount))}。`;
    }
    if (q.includes("新增") || q.includes("本月")) {
      if (!latestMonth) return emptyAssistantAnswer();
      return `当前数据源范围内，最新月份是 ${latestMonth}。\n该月新增任务 ${formatInteger(latestMonthCount)} 条。`;
    }
    if (q.includes("任务类别") || q.includes("数据量") || q.includes("top")) {
      if (!topCategory) return emptyAssistantAnswer();
      return `当前数据量最高的任务类别是 ${topCategory.label}。\n累计数据量 ${formatCompact(topCategory.value)}。`;
    }
    if (q.includes("提需人")) {
      if (!topRequester) return emptyAssistantAnswer();
      return `当前任务量最多的提需人是 ${topRequester.label}，共有 ${formatInteger(topRequester.value)} 条任务。`;
    }
    if (q.includes("按时") || q.includes("交付")) {
      return `当前可评估的已完成任务共有 ${formatInteger(summary.dueFinishedCount)} 条，按时交付率为 ${formatPercent(summary.onTimeRate)}。\n延期任务 ${formatInteger(summary.overdueCount)} 条。`;
    }
    if (q.includes("对应") || q.includes("所属任务")) {
      return "当前任务清单保留了类别展开形式：父行展示任务类别汇总，展开后查看该类别下的具体任务。";
    }

    return `基于当前数据源范围，我先给你一个总览：\n总任务数 ${formatInteger(summary.taskCount)} 条，结算金额 ${formatCurrency(summary.amount)}，总数据量 ${formatCompact(summary.volume)}，按时交付率 ${formatPercent(summary.onTimeRate)}。\n当前金额最高的供应商是 ${topVendor ? topVendor.label : "缺失"}，数据量最高的任务类别是 ${topCategory ? topCategory.label : "缺失"}。`;
  }

  function buildAssistantSummary(records) {
    const dueFinished = records.filter((item) => item["按期状态"] === "按期" || item["按期状态"] === "超期");
    const onTimeCount = dueFinished.filter((item) => item["按期状态"] === "按期").length;
    return {
      taskCount: records.length,
      volume: sum(records, (item) => numberValue(item["数据量"])),
      amount: sum(records, (item) => numberValue(item["预估金额_元"])),
      dueFinishedCount: dueFinished.length,
      overdueCount: dueFinished.filter((item) => item["按期状态"] === "超期").length,
      onTimeRate: safeRatio(onTimeCount, dueFinished.length),
    };
  }

  function emptyAssistantAnswer() {
    return "当前筛选范围内没有足够的数据来回答这个问题。";
  }

  // ===================== DATA DECORATION =====================

  function decorateRecord(record, index) {
    const taskType = record["任务类别分组"] || taskTypeFallbackPool[hashString(`${record["任务类别"] || ""}-${index}`) % taskTypeFallbackPool.length];
    const requester = requesterPool[hashString(`${record["费用承担部门"] || ""}-${record["任务类别"] || ""}-${index}`) % requesterPool.length];
    const workflowStatus = deriveWorkflowStatus(record, index);
    return {
      ...record,
      任务类型: taskType,
      提需人: requester,
      流程状态: workflowStatus,
      标注进度: deriveProgress(workflowStatus, index),
    };
  }

  function deriveWorkflowStatus(record, index) {
    const seed = hashString(`${record["数据名"] || ""}-${index}`);
    if (record["是否完成"] === "是") return seed % 5 === 0 ? "审核中" : "审核通过";
    return seed % 3 === 0 ? "审核中" : "标注中";
  }

  function deriveProgress(status, index) {
    const seed = hashString(`${status}-${index}`);
    if (status === "审核通过") return 100;
    if (status === "审核中") return 78 + (seed % 18);
    if (status === "延期") return 66 + (seed % 14);
    return 28 + (seed % 48);
  }

  function normalizeDelay(item) {
    if (item["交付要求类型"] !== "指定日期") return null;
    const delay = numberOrNull(item["交付偏差_天"]);
    if (delay !== null) return Math.max(0, delay);
    const due = item["要求交付日期"];
    if (!due) return null;
    const dueDate = new Date(due);
    if (Number.isNaN(dueDate.getTime())) return null;
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
  }

  function deriveBatchStatus(item, delay) {
    if (delay && delay > 0) return "延期";
    return item["流程状态"] || "标注中";
  }

  // ===================== UTILITY FUNCTIONS =====================

  function joinUrl(base, path) {
    if (!path) return "";
    if (/^https?:\/\//.test(path)) return path;
    if (!base) return path;
    return `${String(base).replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
  }

  function aggregate(records, field, reducer) {
    return aggregateGroup(records, field)
      .map(([label, items]) => ({ label, value: reducer(items) }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  function aggregateGroup(records, field) {
    return Object.entries(groupBy(records, field));
  }

  function groupBy(records, field) {
    return records.reduce((acc, item) => {
      const key = String(item[field] || "未填写");
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }

  function sum(items, accessor) {
    return items.reduce((total, item) => total + accessor(item), 0);
  }

  function safeRatio(numerator, denominator) {
    return denominator ? numerator / denominator : 0;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function numberOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function numberValue(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function formatInteger(value) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function formatDecimal(value, digits) {
    if (!Number.isFinite(value)) return "-";
    return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }

  function formatCompact(value) {
    if (!Number.isFinite(value)) return "-";
    if (Math.abs(value) >= 100000000) return `${formatDecimal(value / 100000000, 2)} 亿`;
    if (Math.abs(value) >= 10000) return `${formatDecimal(value / 10000, 2)} 万`;
    return formatInteger(value);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value) || value === 0) return "0 元";
    if (Math.abs(value) >= 10000) return `${formatDecimal(value / 10000, 2)} 万元`;
    return `${formatDecimal(value, 2)} 元`;
  }

  function formatPercent(value) {
    return `${formatDecimal((Number(value) || 0) * 100, 1)}%`;
  }

  function uniqueValues(values) {
    return [...new Set(values.filter((value) => value && String(value).trim() !== ""))];
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) % 2147483647;
    }
    return Math.abs(hash);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  init().catch((error) => {
    console.error("[dashboard] init failed:", error);
    setDataSourceState("error", "页面初始化失败");
  });
})();
