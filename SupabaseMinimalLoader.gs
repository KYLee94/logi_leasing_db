function getSupabaseMinimalConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = safeString_(props.getProperty('SUPABASE_URL') || 'https://qvegpozwrcmspdvjokiz.supabase.co').replace(/\/+$/, '');
  const serviceRoleKey = safeString_(props.getProperty('SUPABASE_SERVICE_ROLE_KEY') || props.getProperty('SUPABASE_SERVICE_KEY'));
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Supabase URL is not configured.');
  }
  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is not configured.');
  }
  return {
    url: url,
    serviceRoleKey: serviceRoleKey,
  };
}

function getSupabaseMinimalTableSpecs_() {
  return {
    ll_import_runs: { conflict: 'import_id' },
    ll_sheet_rows: { conflict: 'sheet_row_id' },
    ll_assets: { conflict: 'asset_id' },
    ll_tenants: { conflict: 'tenant_id' },
    ll_leases: { conflict: 'lease_id' },
    ll_lease_spaces: { conflict: 'lease_space_id' },
    ll_rent_history: { conflict: 'rent_history_id' },
    ll_asset_managers: { conflict: 'asset_manager_id' },
    ll_issues: { conflict: 'issue_id' },
    ll_payload_snapshots: { conflict: 'snapshot_key' },
  };
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, safeString_(value), Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function isEqualToken_(left, right) {
  const a = safeString_(left);
  const b = safeString_(right);
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function decodeBase64Json_(value) {
  const bytes = Utilities.base64Decode(safeString_(value));
  const text = Utilities.newBlob(bytes).getDataAsString();
  return JSON.parse(text);
}

function verifySupabaseMinimalLoaderProof_(body) {
  const config = getConfig_();
  const secret = safeString_(config.adminRouteKeyHash);
  const timestamp = Number(body && body.timestamp);
  const nonce = safeString_(body && body.nonce);
  const payloadB64 = safeString_(body && body.payloadB64);
  const proof = safeString_(body && body.proof);
  if (!secret || !timestamp || !nonce || !payloadB64 || !proof) return false;
  if (Math.abs(Date.now() - timestamp) > 10 * 60 * 1000) return false;
  const cache = CacheService.getScriptCache();
  const nonceKey = 'll-minimal-loader-nonce:' + nonce;
  if (cache.get(nonceKey)) return false;
  const expected = sha256Hex_(secret + '\n' + String(timestamp) + '\n' + nonce + '\n' + payloadB64);
  const ok = isEqualToken_(expected, proof);
  if (ok) cache.put(nonceKey, '1', 600);
  return ok;
}

function cleanSupabaseMinimalValue_(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  if (Array.isArray(value)) return value.map(cleanSupabaseMinimalValue_);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (key) {
      const cleaned = cleanSupabaseMinimalValue_(value[key]);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return out;
  }
  return value;
}

function cleanSupabaseMinimalRow_(row) {
  const out = {};
  Object.keys(row || {}).forEach(function (key) {
    const cleaned = cleanSupabaseMinimalValue_(row[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  });
  return out;
}

function requestSupabaseMinimal_(path, options) {
  const config = getSupabaseMinimalConfig_();
  const headers = Object.assign({
    apikey: config.serviceRoleKey,
    Authorization: 'Bearer ' + config.serviceRoleKey,
  }, options.headers || {});
  const response = UrlFetchApp.fetch(config.url + path, {
    method: options.method || 'get',
    contentType: options.contentType || 'application/json',
    headers: headers,
    payload: options.payload || undefined,
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const text = response.getContentText() || '';
  if (status < 200 || status >= 300) {
    throw new Error('Supabase request failed: status=' + status + ', body=' + text.slice(0, 500));
  }
  return {
    status: status,
    text: text,
    headers: response.getAllHeaders(),
  };
}

function upsertSupabaseMinimalRows_(tableName, rows) {
  const specs = getSupabaseMinimalTableSpecs_();
  const spec = specs[tableName];
  if (!spec) throw new Error('Unsupported ll table: ' + tableName);
  if (!Array.isArray(rows) || !rows.length) {
    return { status: 'skipped', tableName: tableName, rowCount: 0 };
  }
  if (rows.length > 100) throw new Error('Too many rows in one request.');
  const cleanedRows = rows.map(cleanSupabaseMinimalRow_);
  const path = '/rest/v1/' + encodeURIComponent(tableName) + '?on_conflict=' + encodeURIComponent(spec.conflict);
  requestSupabaseMinimal_(path, {
    method: 'post',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    payload: JSON.stringify(cleanedRows),
  });
  return {
    status: 'ok',
    tableName: tableName,
    rowCount: cleanedRows.length,
  };
}

function countSupabaseMinimalTables_() {
  const specs = getSupabaseMinimalTableSpecs_();
  const result = {};
  Object.keys(specs).forEach(function (tableName) {
    const response = requestSupabaseMinimal_('/rest/v1/' + encodeURIComponent(tableName) + '?select=' + encodeURIComponent(specs[tableName].conflict) + '&limit=0', {
      method: 'get',
      headers: {
        Prefer: 'count=exact',
      },
    });
    const contentRange = safeString_(response.headers['Content-Range'] || response.headers['content-range']);
    const match = contentRange.match(/\/(\d+)$/);
    result[tableName] = match ? Number(match[1]) : null;
  });
  return {
    status: 'ok',
    counts: result,
  };
}

function adminSupabaseMinimalUpsert(request) {
  assertAdmin_(request);
  return upsertSupabaseMinimalRows_(safeString_(request && request.tableName), (request && request.rows) || []);
}

function adminSupabaseMinimalCount(request) {
  assertAdmin_(request);
  return countSupabaseMinimalTables_();
}
