type JsonRecord = Record<string, unknown>;

const BUILDING_REGISTER_TITLE_ENDPOINT =
  "https://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = (Deno.env.get("LL_ALLOWED_ORIGINS") || "https://kylee94.github.io,http://127.0.0.1:4173,http://localhost:4173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "https://kylee94.github.io";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "origin",
  };
}

function json(request: Request, status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function readSecret(name: string): string {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (name === "SUPABASE_SERVICE_ROLE_KEY" && secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      const firstKey = Object.keys(parsed)[0];
      return parsed.default || parsed.service_role || (firstKey ? parsed[firstKey] : "");
    } catch {
      return "";
    }
  }
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (name === "SUPABASE_ANON_KEY" && publishableKeys) {
    try {
      const parsed = JSON.parse(publishableKeys) as Record<string, string>;
      const firstKey = Object.keys(parsed)[0];
      return parsed.default || parsed.anon || (firstKey ? parsed[firstKey] : "");
    } catch {
      return "";
    }
  }
  return "";
}

function requiredSecret(name: string): string {
  const value = readSecret(name);
  if (!value) throw new Error(`missing_secret:${name}`);
  return value;
}

async function readJsonBody(request: Request): Promise<JsonRecord> {
  if (request.method === "GET") return {};
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json_body");
  }
  return parsed as JsonRecord;
}

async function assertAdmin(request: Request): Promise<JsonRecord> {
  const supabaseUrl = requiredSecret("SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = requiredSecret("SUPABASE_ANON_KEY");
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("missing_authorization");

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error("invalid_authorization");
  const user = await response.json() as JsonRecord;
  const email = String(user.email || "").toLowerCase();
  const allowedEmails = (Deno.env.get("LL_ADMIN_EMAILS") || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const appMeta = (user.app_metadata || {}) as JsonRecord;
  const role = String(appMeta.role || appMeta.ll_role || "").toLowerCase();
  if (!allowedEmails.includes(email) && role !== "logistics_admin" && role !== "admin") {
    throw new Error("admin_forbidden");
  }
  return { id: user.id, email, role };
}

async function supabaseServiceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabaseUrl = requiredSecret("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("authorization", `Bearer ${serviceRoleKey}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers,
  });
}

async function readLoginHistory(body: JsonRecord): Promise<JsonRecord> {
  const limit = Math.min(Math.max(Number(body.limit || 80), 1), 200);
  const params = new URLSearchParams({
    select: "id,logged_at,staff_name,email,status,source,client_timezone",
    order: "logged_at.desc",
    limit: String(limit),
  });
  const response = await supabaseServiceFetch(`/rest/v1/ll_login_history?${params.toString()}`);
  const rows = await response.json().catch(() => []) as unknown;
  return {
    ok: response.ok,
    status: response.status,
    rows: Array.isArray(rows) ? rows.map(normalizeLoginHistoryRow) : [],
  };
}

function normalizeLoginHistoryRow(row: JsonRecord): JsonRecord {
  const eventPayload = row.event_payload && typeof row.event_payload === "object" && !Array.isArray(row.event_payload)
    ? row.event_payload as JsonRecord
    : {};
  const requestPayload = row.request_payload && typeof row.request_payload === "object" && !Array.isArray(row.request_payload)
    ? row.request_payload as JsonRecord
    : {};
  const email = String(row.email || eventPayload.email || requestPayload.email || "").toLowerCase();
  return {
    login_event_id: String(row.login_event_id || row.id || crypto.randomUUID()),
    event_at: String(row.event_at || row.logged_at || row.created_at || new Date().toISOString()),
    staff_name: String(row.staff_name || eventPayload.staff_name || requestPayload.staff_name || ""),
    email,
    event_type: String(row.event_type || eventPayload.event_type || requestPayload.eventType || "auth_login"),
    status: String(row.status || row.event_status || eventPayload.status || requestPayload.status || ""),
    source: String(row.source || eventPayload.source || requestPayload.source || "supabase_edge"),
  };
}

async function recordLoginHistory(admin: JsonRecord, request: Request, body: JsonRecord): Promise<JsonRecord> {
  const email = String(body.email || admin.email || "").toLowerCase();
  const staffName = String(body.staffName || body.staff_name || "");
  const eventType = String(body.eventType || body.event_type || "login");
  const status = String(body.status || "ok");
  const statusCode = /fail|error|denied|forbidden/i.test(status) ? 500 : 200;
  const eventPayload = {
    email,
    auth_email: email,
    staff_name: staffName || email,
    event_type: eventType,
    status,
    source: "logistics-admin-api",
  };
  const row = {
    event_type: "auth_login",
    action: eventType,
    status_code: statusCode,
    requested_by: admin.id || null,
    event_status: status,
    event_payload: eventPayload,
    request_payload: {
      source: "logistics-admin-api",
      requestedBy: admin.email || "",
      eventType,
      status,
    },
    metadata: {
      route: "/login-history/record",
      userAgent: request.headers.get("user-agent") || "",
    },
  };
  const response = await supabaseServiceFetch("/rest/v1/ll_audit_events", {
    method: "POST",
    headers: {
      prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  const payload = await response.json().catch(() => null) as unknown;
  return {
    ok: response.ok,
    status: response.status,
    row: normalizeLoginHistoryRow((Array.isArray(payload) ? payload[0] : payload || {}) as JsonRecord),
  };
}

async function fetchOpenDart(body: JsonRecord): Promise<JsonRecord> {
  const apiKey = requiredSecret("OPENDART_API_KEY");
  const corpCode = String(body.corpCode || "").trim();
  if (!corpCode) throw new Error("missing_corpCode");
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(body.bsnsYear || new Date().getFullYear() - 1),
    reprt_code: String(body.reprtCode || "11011"),
  });
  const response = await fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${params.toString()}`);
  const payload = await response.json() as JsonRecord;
  return {
    provider: "opendart",
    ok: response.ok && String(payload.status || "") === "000",
    status: payload.status || response.status,
    message: payload.message || "",
    list: Array.isArray(payload.list) ? payload.list : [],
  };
}

async function fetchBuildingRegister(body: JsonRecord): Promise<JsonRecord> {
  const apiKey = readSecret("BUILDING_REGISTER_API_KEY_ENCODED") || readSecret("BUILDING_REGISTER_API_KEY");
  if (!apiKey) throw new Error("missing_secret:BUILDING_REGISTER_API_KEY");
  const endpoint = BUILDING_REGISTER_TITLE_ENDPOINT;
  const params = new URLSearchParams();
  const inputParams = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? body.params as JsonRecord
    : {};
  Object.entries(inputParams).forEach(([key, value]) => {
    if (value != null && value !== "") params.set(key, String(value));
  });
  params.set("serviceKey", apiKey);
  params.set("_type", "json");
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  const responseBody = payload.response && typeof payload.response === "object" ? payload.response as JsonRecord : {};
  const header = responseBody.header && typeof responseBody.header === "object" ? responseBody.header as JsonRecord : {};
  const resultCode = String(header.resultCode || payload.resultCode || "");
  const resultMsg = String(header.resultMsg || payload.resultMsg || "");
  const apiOk = !resultCode || resultCode === "00" || resultCode === "000";
  return {
    provider: "building-register",
    ok: response.ok && apiOk,
    status: resultCode || response.status,
    message: resultMsg,
    endpoint,
    payload,
  };
}

async function refreshSnapshot(): Promise<JsonRecord> {
  return {
    ok: false,
    status: "not_connected",
    message: "Snapshot refresh job is intentionally not wired until the final write contract is approved.",
  };
}

function requireLlTableName(value: unknown): string {
  const table = String(value || "").trim();
  if (!/^ll_[a-z0-9_]+$/.test(table)) throw new Error("table_not_allowed");
  return table;
}

function buildPendingWriteResponse(kind: string, body: JsonRecord): JsonRecord {
  const table = body.table ? requireLlTableName(body.table) : "";
  return {
    ok: false,
    status: "schema_pending",
    kind,
    table: table || null,
    message: "Write route is reserved for ll_* only. It will persist after the edit/audit schema is finalized.",
  };
}

function clearServerCache(): JsonRecord {
  return {
    ok: true,
    status: "accepted",
    message: "No mutable edge cache is configured. Browser/session cache is cleared from the frontend only.",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const url = new URL(request.url);
  try {
    const admin = url.pathname.endsWith("/health") ? null : await assertAdmin(request);
    const body = await readJsonBody(request);
    if (url.pathname.endsWith("/health")) {
      return json(request, 200, {
        ok: true,
        service: "logistics-admin-api",
        secrets: {
          opendart: Boolean(readSecret("OPENDART_API_KEY")),
          buildingRegister: Boolean(readSecret("BUILDING_REGISTER_API_KEY_ENCODED") || readSecret("BUILDING_REGISTER_API_KEY")),
          supabase: Boolean(readSecret("SUPABASE_URL") && readSecret("SUPABASE_SERVICE_ROLE_KEY")),
        },
      });
    }
    if (url.pathname.endsWith("/opendart/company")) {
      return json(request, 200, { ok: true, admin, result: await fetchOpenDart(body) });
    }
    if (url.pathname.endsWith("/building-register/summary")) {
      return json(request, 200, { ok: true, admin, result: await fetchBuildingRegister(body) });
    }
    if (url.pathname.endsWith("/login-history/list")) {
      return json(request, 200, { ok: true, admin, result: await readLoginHistory(body) });
    }
    if (url.pathname.endsWith("/login-history/record")) {
      return json(request, 200, { ok: true, admin, result: await recordLoginHistory(admin || {}, request, body) });
    }
    if (url.pathname.endsWith("/snapshot-refresh")) {
      return json(request, 202, { ok: true, admin, result: await refreshSnapshot() });
    }
    if (url.pathname.endsWith("/cache-clear")) {
      return json(request, 202, { ok: true, admin, result: clearServerCache() });
    }
    if (url.pathname.endsWith("/edits/submit")) {
      return json(request, 202, { ok: true, admin, result: buildPendingWriteResponse("edits.submit", body) });
    }
    if (url.pathname.endsWith("/edits/approve")) {
      return json(request, 202, { ok: true, admin, result: buildPendingWriteResponse("edits.approve", body) });
    }
    if (url.pathname.endsWith("/worklogs")) {
      return json(request, 202, { ok: true, admin, result: buildPendingWriteResponse("worklogs", body) });
    }
    return json(request, 404, { ok: false, error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("forbidden") ? 403 : message.includes("authorization") ? 401 : 400;
    return json(request, status, { ok: false, error: message });
  }
});
