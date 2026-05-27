(function () {
  const defaultConfig = {
    enabled: false,
    baseUrl: "",
    timeoutMs: 12000,
    useLocalFallback: true,
    endpoints: {},
  };

  function createDashboardApiClient(config) {
    const finalConfig = {
      ...defaultConfig,
      ...(config || {}),
      endpoints: { ...defaultConfig.endpoints, ...((config && config.endpoints) || {}) },
    };

    async function request(endpointKey, params = {}, options = {}) {
      if (!finalConfig.enabled) {
        throw new Error("Dashboard API is disabled.");
      }
      const endpoint = finalConfig.endpoints[endpointKey];
      if (!endpoint) {
        throw new Error(`Missing dashboard endpoint: ${endpointKey}`);
      }

      const method = options.method || "GET";
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), finalConfig.timeoutMs);
      const url = buildUrl(finalConfig.baseUrl, endpoint, method === "GET" ? params : {});

      try {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
          body: method === "GET" ? undefined : JSON.stringify(params || {}),
          credentials: options.credentials || "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Dashboard API ${endpointKey} failed with ${response.status}`);
        }
        return response.status === 204 ? null : response.json();
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    return {
      config: finalConfig,
      isEnabled: () => Boolean(finalConfig.enabled),
      getFilters: (params) => request("filters", params),
      getOverview: (params) => request("overview", params),
      getTasks: (params) => request("tasks", params),
      getSuppliers: (params) => request("suppliers", params),
      getBusiness: (params) => request("business", params),
      getFinance: (params) => request("finance", params),
      refresh: (params) => request("refresh", params, { method: "POST" }),
    };
  }

  function buildUrl(baseUrl, endpoint, params) {
    const prefix = String(baseUrl || "").replace(/\/$/, "");
    const path = String(endpoint || "").replace(/^\//, "");
    const url = new URL(`${prefix ? `${prefix}/` : ""}${path}`, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "" && value !== "全部") {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  window.createDashboardApiClient = createDashboardApiClient;
})();
