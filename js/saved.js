const STORAGE_KEY = 'reviewerFinder.savedSearches';

const CSV_COLUMNS = [
  'search_title',
  'reviewer_name',
  'reviewer_total',
  'email',
  'contacted',
  'response',
];

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persist(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function csvField(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(savedList) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of savedList) {
    for (const r of entry.reviewers) {
      lines.push([
        entry.title,
        r.name,
        Number.isFinite(r.total) ? r.total.toFixed(4) : '',
        '', // email
        '', // contacted
        '', // response
      ].map(csvField).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function triggerDownload(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
