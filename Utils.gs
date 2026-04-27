function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function safeString_(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeWhitespace_(value) {
  return safeString_(value).replace(/\s+/g, ' ').trim();
}

function normalizeKoreanLookup_(value) {
  return normalizeWhitespace_(value)
    .replace(/[()]/g, '')
    .replace(/주식회사|유한책임회사|유한회사|합자회사|합명회사|㈜|\(주\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeAssetLookup_(value) {
  return normalizeWhitespace_(value)
    .replace(/\s+/g, '')
    .replace(/물류센터|로지스틱스|로지스|센터/g, '')
    .toLowerCase();
}

function toNumber_(value) {
  if (value === '' || value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).replace(/[,\s원%㎡mktpy억원백만]/g, '');
  if (!text || text === '-' || text.toLowerCase() === 'n/a') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPercentNumber_(value) {
  if (value === '' || value == null) {
    return null;
  }
  const parsed = toNumber_(value);
  if (parsed == null) {
    return null;
  }
  return String(value).indexOf('%') > -1 ? parsed / 100 : parsed;
}

function toBooleanFlag_(value) {
  const text = normalizeWhitespace_(value).toUpperCase();
  if (!text) {
    return null;
  }
  if (['Y', 'YES', 'TRUE', '1', 'O'].includes(text)) {
    return true;
  }
  if (['N', 'NO', 'FALSE', '0', 'X'].includes(text)) {
    return false;
  }
  return null;
}

function toIsoDate_(value) {
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = normalizeWhitespace_(value);
  if (!text) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) {
    return text.replace(/\./g, '-');
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isoToDate_(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeDivide_(numerator, denominator) {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function sanitizeIdPart_(value) {
  return normalizeWhitespace_(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'na';
}

function hashText_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, safeString_(value));
  return bytes
    .map(function (byte) {
      const normalized = (byte + 256) % 256;
      return (normalized < 16 ? '0' : '') + normalized.toString(16);
    })
    .join('');
}

function makeDeterministicId_(prefix, parts) {
  return `${prefix}_${sanitizeIdPart_(parts.filter(Boolean).join('_'))}`;
}

function uniqueValues_(values) {
  const seen = {};
  const output = [];
  values.forEach(function (value) {
    const key = JSON.stringify(value);
    if (!seen[key]) {
      seen[key] = true;
      output.push(value);
    }
  });
  return output;
}

function monthKeyFromIso_(value) {
  return value ? value.slice(0, 7) : '';
}

function monthsBetweenIso_(startIso, endIso) {
  const start = isoToDate_(startIso);
  const end = isoToDate_(endIso);
  if (!start || !end) {
    return null;
  }
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function roundNumber_(value, digits) {
  if (value == null) {
    return null;
  }
  const factor = Math.pow(10, digits || 0);
  return Math.round(value * factor) / factor;
}

function defaultValue_(value, fallback) {
  return value == null || value === '' ? fallback : value;
}

function rowsToObjects_(rows) {
  if (!rows || rows.length < 2) {
    return [];
  }
  const headers = rows[0].map(function (header) {
    return safeString_(header);
  });
  return rows.slice(1).map(function (row, index) {
    const object = { _rowNumber: index + 2 };
    headers.forEach(function (header, headerIndex) {
      object[header] = row[headerIndex] == null ? '' : row[headerIndex];
    });
    return object;
  });
}

function loadObjectsFromSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }
  return rowsToObjects_(sheet.getDataRange().getDisplayValues());
}

function pickField_(row, candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    const key = candidates[index];
    if (row[key] !== undefined && row[key] !== '') {
      return row[key];
    }
  }
  return '';
}

function groupBy_(items, keySelector) {
  return items.reduce(function (accumulator, item) {
    const key = typeof keySelector === 'function' ? keySelector(item) : item[keySelector];
    const normalized = key == null ? '__null__' : String(key);
    accumulator[normalized] = accumulator[normalized] || [];
    accumulator[normalized].push(item);
    return accumulator;
  }, {});
}

function indexBy_(items, keySelector) {
  return items.reduce(function (accumulator, item) {
    const key = typeof keySelector === 'function' ? keySelector(item) : item[keySelector];
    if (key) {
      accumulator[String(key)] = item;
    }
    return accumulator;
  }, {});
}

function sumBy_(items, selector) {
  return items.reduce(function (sum, item) {
    const value = typeof selector === 'function' ? selector(item) : item[selector];
    return sum + (value == null ? 0 : Number(value));
  }, 0);
}

function averageBy_(items, selector) {
  const values = items
    .map(function (item) {
      return typeof selector === 'function' ? selector(item) : item[selector];
    })
    .filter(function (value) {
      return value != null;
    });
  if (!values.length) {
    return null;
  }
  return sumBy_(values, function (value) {
    return value;
  }) / values.length;
}

function sortBy_(items, selector, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  return items.slice().sort(function (left, right) {
    const leftValue = typeof selector === 'function' ? selector(left) : left[selector];
    const rightValue = typeof selector === 'function' ? selector(right) : right[selector];
    if (leftValue == null && rightValue == null) {
      return 0;
    }
    if (leftValue == null) {
      return 1;
    }
    if (rightValue == null) {
      return -1;
    }
    if (leftValue < rightValue) {
      return -1 * sign;
    }
    if (leftValue > rightValue) {
      return 1 * sign;
    }
    return 0;
  });
}
