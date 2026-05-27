(function () {
  function normalizeDashboardDataset(payload, fallbackData) {
    const body = payload && typeof payload === "object" && payload.data ? payload.data : payload;
    const records = Array.isArray(body?.records) ? body.records : Array.isArray(body?.items) ? body.items : null;

    if (!records) {
      return fallbackData;
    }

    const meta = {
      ...(fallbackData?.meta || {}),
      ...(body.meta || {}),
      totalRawRows: body.meta?.totalRawRows ?? records.length,
      validRows: body.meta?.validRows ?? records.length,
      generatedAt: body.meta?.generatedAt || new Date().toISOString().slice(0, 19).replace("T", " "),
      timeRange: normalizeTimeRange(body.meta?.timeRange, records, fallbackData?.meta?.timeRange),
    };

    return { meta, records: records.map(normalizeDashboardRecord) };
  }

  function normalizeDashboardRecord(record) {
    return {
      ...record,
      "任务创建时间": record["任务创建时间"] || record.createdAt || record.created || record.taskCreatedAt || "",
      "数据名": record["数据名"] || record.taskName || record.name || "",
      "数据量": record["数据量"] ?? record.volume ?? record.dataVolume ?? record.objectCount ?? 0,
      "供应商名称": record["供应商名称"] || record.supplierName || record.vendorName || "未归属",
      "任务类别": record["任务类别"] || record.category || record.taskCategory || "未分类",
      "任务类别分组": record["任务类别分组"] || record.categoryGroup || record.taskCategoryGroup || record.category || "未分类",
      "费用承担部门": record["费用承担部门"] || record.department || record.costDepartment || record.businessLine || "未填写",
      "使用模版": record["使用模版"] || record.template || record.settlementTemplate || "未填写",
      "任务类型": record["任务类型"] || record.taskType || record.typeName || "",
      "流程状态": record["流程状态"] || record.statusName || record.taskStatus || "",
      "要求交付日期": record["要求交付日期"] || record.dueAt || record.expectedDeliveryAt || "",
      "实际完成时间": record["实际完成时间"] || record.completedAt || record.actualCompletedAt || "",
      "是否完成": record["是否完成"] || record.completedText || "",
      "预估金额_元": record["预估金额_元"] ?? record.amount ?? record.settlementAmount ?? record.costAmount ?? 0,
      "按期状态": record["按期状态"] || record.deliveryStatus || "",
      "提需人": record["提需人"] || record.requester || record.demander || "",
    };
  }

  function normalizeTimeRange(timeRange, records, fallbackRange) {
    if (timeRange?.start && timeRange?.end) return timeRange;
    const dates = records
      .map((record) => record["任务创建时间"] || record.createdAt || record.created || record.taskCreatedAt)
      .filter(Boolean)
      .sort();
    return {
      start: dates[0] || fallbackRange?.start || "",
      end: dates[dates.length - 1] || fallbackRange?.end || "",
    };
  }

  window.DashboardAdapter = {
    normalizeDashboardDataset,
    normalizeDashboardRecord,
  };
})();
