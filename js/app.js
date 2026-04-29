import { loadAllPapers } from './data.js';
import { embed, cosine } from './embed.js';
import { listModels, chat } from './ollama.js';

const PER_REVIEWER_PAPER_CAP = 5;

const state = {
  papers: [],
  embeddingModel: null,
};

const $ = (id) => document.getElementById(id);

async function init() {
  initThemeToggle();

  $('testConnection').addEventListener('click', testConnection);
  $('findReviewers').addEventListener('click', findReviewers);

  for (const id of ['positionDecay', 'topKPapers', 'topNReviewers', 'yearMin', 'yearMax']) {
    $(id).addEventListener('input', updatePreviews);
  }
  $('conferenceFilters').addEventListener('change', updatePreviews);

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
  const positionDecay = $('positionDecay').value;
  const topK = $('topKPapers').value;
  const topN = $('topNReviewers').value;
  $('scoringPreview').textContent = `pos-decay ${positionDecay} · top-K ${topK} · top-N ${topN}`;

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
  $('filtersPreview').textContent = confPart ? `${yearPart} · ${confPart}` : yearPart;
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
  // Recency half-life weighting is currently disabled; force Infinity so
  // recencyWeight() returns 1 and paper_score equals raw cosine similarity.
  const halfLife = Infinity;
  const positionDecay = parseFloat($('positionDecay').value);
  const topKPapers = parseInt($('topKPapers').value, 10);
  const topNReviewers = parseInt($('topNReviewers').value, 10);
  const yearMin = parseInt($('yearMin').value, 10);
  const yearMax = parseInt($('yearMax').value, 10);
  const conferences = new Set(
    [...document.querySelectorAll('#conferenceFilters input:checked')].map(
      (c) => c.dataset.conference
    )
  );
  return { halfLife, positionDecay, topKPapers, topNReviewers, yearMin, yearMax, conferences };
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
        const top = sorted.slice(0, PER_REVIEWER_PAPER_CAP);
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
    card.className = 'reviewer-card';
    card.id = `reviewer-${i}`;

    const heading = document.createElement('h3');
    heading.innerHTML = `${escapeHtml(r.name)} <span class="score">total weighted score: ${r.total.toFixed(2)}</span>`;
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const escapeAttr = escapeHtml;

init();
