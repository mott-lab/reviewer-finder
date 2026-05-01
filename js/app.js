import { loadAllPapers } from './data.js';
import { embed, cosine } from './embed.js';
import { listModels, chat } from './ollama.js';
import { loadSaved, persist, makeId, toCsv, triggerDownload, todayStamp } from './saved.js';
import { initHelp } from './help.js';


const state = {
  papers: [],
  embeddingModel: null,
  saved: [],
  lastReviewers: [],
  storageWarning: '',
};

const $ = (id) => document.getElementById(id);

async function init() {
  initThemeToggle();
  initHelp();

  $('testConnection').addEventListener('click', testConnection);
  $('findReviewers').addEventListener('click', findReviewers);
  $('selectAllReviewers').addEventListener('change', onSelectAllChange);
  $('saveSearch').addEventListener('click', onSaveSearch);
  $('exportSaved').addEventListener('click', onExportClick);

  for (const id of ['halfLife', 'positionDecay', 'topKPapers', 'topPapersPerReviewer', 'topNReviewers', 'yearMin', 'yearMax']) {
    $(id).addEventListener('input', updatePreviews);
  }
  $('conferenceFilters').addEventListener('change', updatePreviews);

  state.saved = loadSaved();
  renderSavedPanel();

  try {
    const { papers, model } = await loadAllPapers();
    state.papers = papers;
    state.embeddingModel = model;
    populateFilters(papers);
    updatePreviews();
    $('dataStatus').textContent =
      `Loaded ${papers.length} papers with precomputed embeddings (${model}).`;
    $('findReviewers').disabled = false;
  } catch (err) {
    $('dataStatus').textContent = `Failed to load proceedings: ${err.message}`;
    $('dataStatus').className = 'connection-err';
  }
}

function initThemeToggle() {
  const btn = $('themeToggle');
  const current = document.documentElement.dataset.theme || 'light';
  updateThemeButton(current);
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });
}

function updateThemeButton(theme) {
  const btn = $('themeToggle');
  btn.textContent = theme === 'dark' ? 'Dark' : 'Light';
  btn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  );
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  updateThemeButton(theme);
}

function updatePreviews() {
  const halfLife = $('halfLife').value;
  const positionDecay = $('positionDecay').value;
  const topK = $('topKPapers').value;
  const cap = $('topPapersPerReviewer').value;
  $('scoringPreview').textContent =
    `half-life ${halfLife}y · pos-decay ${positionDecay} · top-K ${topK} · cap ${cap}`;

  const topN = $('topNReviewers').value;
  const yearMin = $('yearMin').value;
  const yearMax = $('yearMax').value;
  const all = document.querySelectorAll('#conferenceFilters input');
  const sel = document.querySelectorAll('#conferenceFilters input:checked');
  const yearPart = yearMin && yearMax ? `${yearMin}–${yearMax}` : 'any years';
  const confPart =
    all.length === 0
      ? ''
      : sel.length === all.length
      ? `${all.length} conferences`
      : `${sel.length}/${all.length} conferences`;
  const filterParts = [`top-N ${topN}`, yearPart, confPart].filter(Boolean);
  $('filtersPreview').textContent = filterParts.join(' · ');
}

function populateFilters(papers) {
  const years = papers
    .map((p) => parseInt(p['year'], 10))
    .filter((y) => Number.isFinite(y));
  if (years.length > 0) {
    $('yearMin').value = Math.min(...years);
    $('yearMax').value = Math.max(...years);
  }

  const conferences = [...new Set(papers.map((p) => p['conference']).filter(Boolean))].sort();
  const container = $('conferenceFilters');
  container.innerHTML = '';
  for (const c of conferences) {
    const id = `conf-${c.replace(/\W+/g, '_')}`;
    const wrap = document.createElement('label');
    wrap.className = 'inline-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = true;
    cb.dataset.conference = c;
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(' ' + c));
    container.appendChild(wrap);
  }
}

async function testConnection() {
  const url = $('ollamaUrl').value.trim().replace(/\/$/, '');
  const status = $('connectionStatus');
  status.className = '';
  status.textContent = 'Testing…';
  try {
    const data = await listModels(url);
    const names = (data.models || []).map((m) => m.name);
    status.className = 'connection-ok';
    status.textContent = names.length
      ? `Connected. Models: ${names.join(', ')}`
      : 'Connected. No models installed.';
  } catch (err) {
    status.className = 'connection-err';
    status.textContent = `Failed: ${err.message}`;
  }
}

function readControls() {
  const halfLife = parseFloat($('halfLife').value);
  const positionDecay = parseFloat($('positionDecay').value);
  const topKPapers = parseInt($('topKPapers').value, 10);
  const topPapersPerReviewer = parseInt($('topPapersPerReviewer').value, 10);
  const topNReviewers = parseInt($('topNReviewers').value, 10);
  const yearMin = parseInt($('yearMin').value, 10);
  const yearMax = parseInt($('yearMax').value, 10);
  const conferences = new Set(
    [...document.querySelectorAll('#conferenceFilters input:checked')].map(
      (c) => c.dataset.conference
    )
  );
  return { halfLife, positionDecay, topKPapers, topPapersPerReviewer, topNReviewers, yearMin, yearMax, conferences };
}

function recencyWeight(year, currentYear, halfLife) {
  if (!Number.isFinite(year) || !Number.isFinite(halfLife) || halfLife <= 0) return 1;
  return Math.pow(0.5, (currentYear - year) / halfLife);
}

async function findReviewers() {
  const title = $('paperTitle').value.trim();
  const abstract = $('paperAbstract').value.trim();
  if (!title && !abstract) {
    alert('Enter a title and/or abstract first.');
    return;
  }
  const queryText = `${title}\n\n${abstract}`;
  const ctrl = readControls();
  const currentYear = new Date().getFullYear();

  const btn = $('findReviewers');
  const statusEl = $('findReviewersStatus');
  btn.disabled = true;

  try {
    const filtered = state.papers.filter((p) => {
      const y = parseInt(p['year'], 10);
      if (Number.isFinite(ctrl.yearMin) && Number.isFinite(y) && y < ctrl.yearMin) return false;
      if (Number.isFinite(ctrl.yearMax) && Number.isFinite(y) && y > ctrl.yearMax) return false;
      if (ctrl.conferences.size > 0 && !ctrl.conferences.has(p['conference'])) return false;
      return true;
    });

    if (filtered.length === 0) {
      statusEl.textContent = 'No papers match the filters.';
      return;
    }

    statusEl.textContent = 'Loading model and embedding query (first run downloads ~25 MB)…';
    const queryVec = await embed(queryText, (p) => {
      if (p.status === 'progress' && p.file) {
        const pct = p.progress ? p.progress.toFixed(0) : '?';
        statusEl.textContent = `Downloading model: ${p.file} (${pct}%)`;
      }
    });

    statusEl.textContent = 'Ranking…';
    const scored = filtered.map((p) => {
      const sim = cosine(queryVec, p._embedding);
      const year = parseInt(p['year'], 10);
      const recency = recencyWeight(year, currentYear, ctrl.halfLife);
      return { paper: p, sim, recency, score: sim * recency };
    });

    scored.sort((a, b) => b.score - a.score);
    const topPapers = scored.slice(0, ctrl.topKPapers);

    const authorMap = new Map();
    for (const entry of topPapers) {
      const authors = (entry.paper['author list'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      authors.forEach((author, k) => {
        const positionWeight = Math.pow(ctrl.positionDecay, k);
        const contribution = entry.score * positionWeight;
        if (!authorMap.has(author)) authorMap.set(author, { name: author, contributions: [] });
        authorMap.get(author).contributions.push({
          paper: entry.paper,
          paperScore: entry.score,
          sim: entry.sim,
          position: k,
          contribution,
        });
      });
    }

    const reviewers = [...authorMap.values()]
      .map((r) => {
        const sorted = r.contributions.sort((a, b) => b.contribution - a.contribution);
        const top = sorted.slice(0, ctrl.topPapersPerReviewer);
        const total = top.reduce((s, c) => s + c.contribution, 0);
        return { name: r.name, total, papers: top };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, ctrl.topNReviewers);

    renderReviewers(reviewers);
    $('reviewers-section').hidden = false;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('reviewers-section').scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    $('reviewersHeading').focus({ preventScroll: true });
    statusEl.textContent = `Ranked ${filtered.length} papers · top ${topPapers.length} fed reviewer aggregation.`;

    const ollamaUrl = $('ollamaUrl').value.trim().replace(/\/$/, '');
    const ollamaModel = $('ollamaModel').value.trim();
    if (ollamaUrl && ollamaModel) {
      statusEl.textContent += ' Generating LLM rationales…';
      await generateRationales(reviewers, queryText, ollamaUrl, ollamaModel, statusEl);
      statusEl.textContent = 'Done.';
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderReviewers(reviewers) {
  const list = $('reviewersList');
  list.innerHTML = '';
  state.lastReviewers = reviewers;
  $('saveStatus').textContent = '';
  $('saveStatus').className = 'status';
  const selectAll = $('selectAllReviewers');
  selectAll.checked = true;
  selectAll.indeterminate = false;

  // Globally normalize wt and sim across all displayed papers so cell colors
  // are comparable across reviewer cards.
  const allCells = reviewers.flatMap((r) => r.papers);
  const wts = allCells.map((c) => c.contribution);
  const sims = allCells.map((c) => c.sim);
  const wtLo = Math.min(...wts), wtHi = Math.max(...wts);
  const simLo = Math.min(...sims), simHi = Math.max(...sims);
  const norm = (v, lo, hi) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));

  renderLegend(wtLo, wtHi, simLo, simHi);

  const headerHtml =
    '<thead><tr>' +
      '<th scope="col">title</th>' +
      '<th scope="col" class="paper-th-r">wt</th>' +
      '<th scope="col" class="paper-th-r">sim</th>' +
      '<th scope="col">venue</th>' +
    '</tr></thead>';

  reviewers.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'reviewer-card has-checkbox';
    card.id = `reviewer-${i}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'reviewer-select';
    cb.checked = true;
    cb.dataset.reviewerIndex = String(i);
    cb.setAttribute('aria-label', `Include ${r.name} when saving this search`);
    cb.addEventListener('change', onCardCheckboxChange);
    card.appendChild(cb);

    const heading = document.createElement('h3');
    const scholarUrl = `https://scholar.google.com/citations?hl=en&view_op=search_authors&mauthors=${encodeURIComponent(r.name).replace(/%20/g, '+')}`;
    const scholarIcon = `<svg class="scholar-icon" aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg>`;
    heading.innerHTML = `<span class="reviewer-name">${escapeHtml(r.name)}<a class="scholar-link" href="${scholarUrl}" target="_blank" rel="noopener noreferrer" aria-label="Search ${escapeHtml(r.name)} on Google Scholar" title="Search on Google Scholar">${scholarIcon}</a></span><span class="score">total weighted score: ${r.total.toFixed(2)}</span>`;
    card.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'paper-table';

    const rowsHtml = r.papers.map((c) => {
      const title = c.paper['paper title'];
      const doi = c.paper['DOI'];
      const venue = `${c.paper['conference']} ${c.paper['year']}`;
      const titleEl = doi
        ? `<a class="paper-title" href="${escapeAttr(doi)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(title)} (opens in new tab)">${escapeHtml(title)}</a>`
        : `<span class="paper-title">${escapeHtml(title)}</span>`;
      const wtT = norm(c.contribution, wtLo, wtHi);
      const simT = norm(c.sim, simLo, simHi);
      return (
        '<tr>' +
        `<td>${titleEl}</td>` +
        `<td class="paper-num" style="background:${viridisCss(wtT)};color:${textOnViridis(wtT)}">${c.contribution.toFixed(2)}</td>` +
        `<td class="paper-num" style="background:${viridisCss(simT)};color:${textOnViridis(simT)}">${c.sim.toFixed(2)}</td>` +
        `<td class="paper-venue">${escapeHtml(venue)}</td>` +
        '</tr>'
      );
    }).join('');

    table.innerHTML = headerHtml + '<tbody>' + rowsHtml + '</tbody>';
    card.appendChild(table);

    const rationale = document.createElement('div');
    rationale.className = 'rationale';
    card.appendChild(rationale);

    list.appendChild(card);
  });
}

function renderLegend(wtLo, wtHi, simLo, simHi) {
  const grad = viridisGradient();
  $('legend').innerHTML = `
    <div class="legend-item">
      <div class="legend-label"><strong>wt</strong> — weighted contribution (sim × author-position decay)</div>
      <div class="legend-row">
        <span class="legend-min">${wtLo.toFixed(2)}</span>
        <span class="legend-bar" style="background:${grad}"></span>
        <span class="legend-max">${wtHi.toFixed(2)}</span>
      </div>
    </div>
    <div class="legend-item">
      <div class="legend-label"><strong>sim</strong> — cosine similarity to your submission</div>
      <div class="legend-row">
        <span class="legend-min">${simLo.toFixed(2)}</span>
        <span class="legend-bar" style="background:${grad}"></span>
        <span class="legend-max">${simHi.toFixed(2)}</span>
      </div>
    </div>
  `;
}

function viridisGradient() {
  const stops = [];
  for (let i = 0; i <= 10; i++) stops.push(viridisCss(i / 10));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// Viridis colormap (matplotlib), 11-stop lookup with linear interpolation.
// Perceptually uniform and colorblind-safe.
const VIRIDIS_STOPS = [
  [68, 1, 84], [72, 36, 117], [64, 67, 135], [52, 94, 141],
  [41, 120, 142], [32, 145, 140], [34, 168, 132], [68, 191, 112],
  [122, 209, 81], [189, 222, 38], [253, 231, 37],
];

function viridisRgb(t) {
  // Clamp to [0.2, 1.0] so even the lowest-scoring cells stay visible
  // against dark-mode card backgrounds (#111827).
  if (!Number.isFinite(t)) t = 0;
  t = 0.2 + 0.8 * Math.max(0, Math.min(1, t));
  const idx = t * (VIRIDIS_STOPS.length - 1);
  const i = Math.min(Math.floor(idx), VIRIDIS_STOPS.length - 2);
  const f = idx - i;
  const a = VIRIDIS_STOPS[i];
  const b = VIRIDIS_STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function viridisCss(t) {
  const [r, g, b] = viridisRgb(t);
  return `rgb(${r},${g},${b})`;
}

function textOnViridis(t) {
  const [r, g, b] = viridisRgb(t);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return Y > 0.179 ? '#000' : '#fff';
}

async function generateRationales(reviewers, queryText, baseUrl, model, statusEl) {
  for (let i = 0; i < reviewers.length; i++) {
    const r = reviewers[i];
    const card = document.getElementById(`reviewer-${i}`);
    const rationaleEl = card?.querySelector('.rationale');
    if (rationaleEl) rationaleEl.textContent = 'Generating…';

    const paperList = r.papers
      .map((c) => `- ${c.paper['paper title']}: ${(c.paper['abstract'] || '').slice(0, 400)}`)
      .join('\n');
    const prompt =
      `You are evaluating peer reviewer fit. The paper under submission is:\n\n${queryText}\n\n` +
      `Reviewer "${r.name}" has authored these papers (which were the closest matches by semantic similarity):\n${paperList}\n\n` +
      `In 1-2 sentences, explain why this person is a strong reviewer fit for the submission. Focus on shared topical expertise. Do not mention the similarity scores.`;

    try {
      const text = await chat(baseUrl, model, [{ role: 'user', content: prompt }]);
      if (rationaleEl) rationaleEl.textContent = text.trim();
    } catch (err) {
      if (rationaleEl) {
        rationaleEl.classList.add('error');
        rationaleEl.textContent = `Rationale failed: ${err.message}`;
      }
      statusEl.textContent = `LLM error: ${err.message}. Skipping remaining rationales.`;
      return;
    }
  }
}

function onSelectAllChange(e) {
  const checked = e.target.checked;
  for (const cb of document.querySelectorAll('#reviewersList .reviewer-select')) {
    cb.checked = checked;
  }
  e.target.indeterminate = false;
}

function onCardCheckboxChange() {
  const all = document.querySelectorAll('#reviewersList .reviewer-select');
  const checked = document.querySelectorAll('#reviewersList .reviewer-select:checked');
  const master = $('selectAllReviewers');
  if (checked.length === 0) {
    master.checked = false;
    master.indeterminate = false;
  } else if (checked.length === all.length) {
    master.checked = true;
    master.indeterminate = false;
  } else {
    master.checked = false;
    master.indeterminate = true;
  }
}

function getSelectedReviewerIndices() {
  return [...document.querySelectorAll('#reviewersList .reviewer-select:checked')]
    .map((cb) => parseInt(cb.dataset.reviewerIndex, 10))
    .filter((n) => Number.isInteger(n));
}

function onSaveSearch() {
  const status = $('saveStatus');
  status.className = 'status';
  status.textContent = '';

  const title = $('paperTitle').value.trim();
  if (!title) {
    status.className = 'status connection-err';
    status.textContent = 'Enter a paper title to label this search.';
    return;
  }

  if (!state.lastReviewers || state.lastReviewers.length === 0) {
    status.className = 'status connection-err';
    status.textContent = 'Run a search first.';
    return;
  }

  const selectedIdx = new Set(getSelectedReviewerIndices());
  if (selectedIdx.size === 0) {
    status.className = 'status connection-err';
    status.textContent = 'Select at least one reviewer.';
    return;
  }

  const reviewers = state.lastReviewers
    .filter((_, i) => selectedIdx.has(i))
    .map((r) => ({
      name: r.name,
      total: r.total,
      papers: r.papers.map((c) => ({
        title: c.paper['paper title'] || '',
        year: c.paper['year'] || '',
        conference: c.paper['conference'] || '',
        doi: c.paper['DOI'] || '',
        sim: c.sim,
        contribution: c.contribution,
        position: c.position,
      })),
    }));

  const entry = {
    id: makeId(),
    title,
    savedAt: new Date().toISOString(),
    reviewers,
  };
  state.saved.push(entry);

  const result = persist(state.saved);
  if (!result.ok) {
    state.storageWarning = `Couldn't save to localStorage: ${result.error}. Kept in memory only.`;
  } else {
    state.storageWarning = '';
  }

  renderSavedPanel();
  status.className = 'status connection-ok';
  status.textContent = `Saved "${title}" with ${reviewers.length} reviewer${reviewers.length === 1 ? '' : 's'}.`;
}

function onDeleteSaved(id) {
  const entry = state.saved.find((e) => e.id === id);
  if (!entry) return;
  if (!confirm(`Delete saved search "${entry.title}"?`)) return;
  state.saved = state.saved.filter((e) => e.id !== id);
  const result = persist(state.saved);
  state.storageWarning = result.ok ? '' : `Couldn't update localStorage: ${result.error}.`;
  renderSavedPanel();
}

function onExportClick() {
  if (state.saved.length === 0) return;
  const csv = toCsv(state.saved);
  triggerDownload(csv, `reviewer-finder-${todayStamp()}.csv`);
}

function renderSavedPanel() {
  const list = $('savedList');
  $('exportSaved').disabled = state.saved.length === 0;

  if (state.saved.length === 0) {
    list.innerHTML = '<p class="saved-empty">No searches saved yet.</p>';
    if (state.storageWarning) {
      list.innerHTML += `<p class="saved-warning">${escapeHtml(state.storageWarning)}</p>`;
    }
    return;
  }

  const rows = state.saved.map((entry) => {
    const date = (entry.savedAt || '').slice(0, 10);
    const count = entry.reviewers.length;
    return (
      `<div class="saved-entry">` +
        `<div class="saved-meta">` +
          `<div class="saved-title">${escapeHtml(entry.title)}</div>` +
          `<div class="saved-sub">${count} reviewer${count === 1 ? '' : 's'} · ${escapeHtml(date)}</div>` +
        `</div>` +
        `<button type="button" class="saved-delete" data-saved-id="${escapeAttr(entry.id)}" aria-label="Delete saved search ${escapeAttr(entry.title)}">×</button>` +
      `</div>`
    );
  }).join('');

  const warn = state.storageWarning
    ? `<p class="saved-warning">${escapeHtml(state.storageWarning)}</p>`
    : '';
  list.innerHTML = rows + warn;

  for (const btn of list.querySelectorAll('.saved-delete')) {
    btn.addEventListener('click', () => onDeleteSaved(btn.dataset.savedId));
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const escapeAttr = escapeHtml;

init();
