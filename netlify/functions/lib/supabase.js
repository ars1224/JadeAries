  class SupabaseRequestError extends Error {
    constructor(status, code) {
      super("Supabase request failed.");
      this.name = "SupabaseRequestError";
      this.status = status;
      this.code = code || "";
    }
  }

  function configuration() {
    const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!url || !serviceRoleKey) {
      throw new Error("Supabase server environment variables are not configured.");
    }

    return { url, serviceRoleKey };
  }

  async function request(path, options = {}) {
  const { url, serviceRoleKey } = configuration();

  const method = options.method || "GET";

  const headers = {
    Accept: "application/json",
    apikey: serviceRoleKey,
    ...options.headers,
  };

  // Legacy service_role keys are JWTs and can be sent as Bearer tokens.
  // New sb_secret_* keys are NOT JWTs and should use only the apikey header.
  if (serviceRoleKey.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new SupabaseRequestError(
      response.status,
      payload?.code
    );
  }

  return payload;
}

  module.exports = { request, SupabaseRequestError };
