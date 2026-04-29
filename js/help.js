const CONTENT = {
  overview: {
    title: 'How Reviewer Finder works',
    html: `
      <p>Paste a paper title and abstract — yours, or a paper representative of the topic you want reviewers for — and click <strong>Find Reviewers</strong>. The app embeds your text using a small language model running in your browser, then ranks every paper in the loaded corpus by cosine similarity to that text.</p>
      <p>It keeps the top-K best-matching papers and rolls them up into a per-author score. Authors at position 1 count more than later co-authors (controlled by the position-decay setting), and each author's total is the sum of their top 5 contributing papers.</p>
      <p>The right-hand <strong>Saved searches</strong> panel lets you keep selected reviewers across multiple queries and export everything as a single CSV for outreach tracking.</p>
      <p>Everything runs in your browser — no data leaves your machine.</p>
    `,
  },
  submission: {
    title: 'Your submission',
    html: `
      <p>Paste the title and abstract of the paper you're trying to find reviewers for. The combined text is embedded into a 384-dimensional vector and compared against every paper in the corpus.</p>
      <p>More text gives a better ranking signal — just a title works but is noisier. The text never leaves your browser.</p>
    `,
  },
  scoring: {
    title: 'Scoring weights',
    html: `
      <p>Each paper's score is <code>cosine(query, paper) × recency(year)</code>. Each author's contribution from a paper is <code>paper_score × r^position</code>, where position 0 is the first author. A reviewer's total is the sum of their top 5 contributions.</p>
      <ul>
        <li><strong>Recency half-life (years)</strong> — a paper N years old contributes <code>0.5^(N/half-life)</code> of its similarity. Default 50 leaves recency mostly off; lower it (e.g. 5–10) to favor active researchers.</li>
        <li><strong>Author-position decay r</strong> — author at position k gets weight <code>r^k</code>. With r = 0.7, second author counts 70%, third 49%. Set to 1 to weight all authors equally.</li>
        <li><strong>Top-K papers aggregated</strong> — only the K best-matching papers feed reviewer aggregation. Smaller K = sharper recommendations from a tighter pool.</li>
        <li><strong>Top-N reviewers shown</strong> — caps how many reviewers appear in the results.</li>
      </ul>
    `,
  },
  filters: {
    title: 'Filters',
    html: `
      <p>Filters apply <em>before</em> the top-K cut, so they directly shape which papers can contribute to reviewer scores.</p>
      <ul>
        <li><strong>Year range</strong> — inclusive bounds. Useful if you only want recent work.</li>
        <li><strong>Conferences</strong> — scope to specific venues. By default every loaded venue is checked.</li>
      </ul>
    `,
  },
  reviewers: {
    title: 'Recommended reviewers',
    html: `
      <p>Each card shows up to 5 of the reviewer's papers that contributed to their score. Columns:</p>
      <ul>
        <li><strong>wt</strong> — that paper's weighted contribution (similarity × recency × position decay).</li>
        <li><strong>sim</strong> — raw cosine similarity (0–1) between your submission and the paper.</li>
      </ul>
      <p>Clicking a paper title opens the DOI (or a Google Scholar search if no DOI was available). Cell colors use the viridis colormap, normalized across all visible cards so values are comparable horizontally.</p>
      <p>Each card has a checkbox. Untick reviewers you don't want, then save the search to capture the selection.</p>
    `,
  },
  saved: {
    title: 'Saving & exporting searches',
    html: `
      <p>Use this panel to build up a working list of reviewers across multiple queries.</p>
      <ol>
        <li>Run <strong>Find Reviewers</strong>, untick anyone you don't want, click <strong>Save this search</strong>. The current paper title labels the entry.</li>
        <li>Run another search with a different title/abstract and save again. Repeat for each of your papers.</li>
        <li>Click <strong>Export CSV</strong> to download a spreadsheet with one row per (search, reviewer). Columns: <code>search_title</code>, <code>reviewer_name</code>, <code>reviewer_total</code>, plus blank <code>email</code>, <code>contacted</code>, and <code>response</code> columns for tracking outreach.</li>
      </ol>
      <p>Saved searches persist across page refreshes (stored in your browser's <code>localStorage</code>). Use the <strong>×</strong> on a row to remove that saved search.</p>
    `,
  },
};

export function initHelp() {
  const dialog = document.getElementById('helpModal');
  if (!dialog) return;
  const titleEl = document.getElementById('helpModalTitle');
  const bodyEl = document.getElementById('helpModalBody');

  const open = (key) => {
    const c = CONTENT[key];
    if (!c) return;
    titleEl.textContent = c.title;
    bodyEl.innerHTML = c.html;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  const close = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  for (const btn of document.querySelectorAll('[data-help-key]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(btn.dataset.helpKey);
    });
  }

  dialog.querySelector('.help-modal-close')?.addEventListener('click', close);

  // Backdrop click: clicks on the <dialog> element itself (not its inner content) close it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
}
