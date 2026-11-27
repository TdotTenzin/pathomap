/*
  csv.js - Minimal delimiter-aware parser for pasted/uploaded experiment tables.

  Supports comma, tab, and semicolon separated text with quoted fields,
  escaped quotes ("") and quoted newlines. No external dependencies.
*/

export function detectDelimiter(text) {
  const firstLine = String(text ?? '')
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) ?? '';

  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
  };

  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
}

function normalizeHeader(value, index) {
  const base = String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return base || `column_${index + 1}`;
}

export function parseRecords(text) {
  const matrix = parseDelimited(text);
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const seen = new Map();
  const headers = matrix[0].map((value, index) => {
    const name = normalizeHeader(value, index);
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });

  const rows = matrix.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(cells[index] ?? '').trim();
    });
    return record;
  });

  return { headers, rows };
}
