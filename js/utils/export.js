/*
  export.js - Small browser download/CSV/SVG helpers.

  Used by the interaction network page. Exports always carry the active filter
  and source provenance passed by the caller.
*/

export function timestampSlug(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join('; ') : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns, rows) {
    const header = columns.map((column) => csvCell(column.label ?? column.key)).join(',');
    const body = rows.map((row) =>
        columns.map((column) => csvCell(row[column.key])).join(',')
    );
    return `${header}\n${body.join('\n')}\n`;
}

export function escapeXml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
