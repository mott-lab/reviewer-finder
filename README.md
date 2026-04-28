# Reviewer Finder

## Conference Program Processing

This project provides tools to process ACM proceedings data (such as CHI conference programs) originally in JSON format and convert them into structured CSV files. This data extraction serves as a foundational step for finding and mapping potential reviewers based on their publication history, topics, and sessions.

### Directory Structure

* `ACM_proceedings_json/`: Place the source JSON proceedings files here (e.g., `CHI_2022_program.json`).
* `scripts/`: Contains the python data processing scripts.
  * `process_acm_json.py`: Parses the JSON programs and generates the CSVs. Filters out reprised papers (titles prefixed with a previous edition's tag, e.g. `UIST'21:`) so they don't double-count in ranking. Dedupes cross-CSV duplicates by DOI (first occurrence by sorted filename wins). For papers that lack a DOI, writes a Google Scholar search URL into the `DOI` column so the frontend can still render a clickable link.
  * `embed_papers.py`: Encodes each paper's title+abstract with `sentence-transformers/all-MiniLM-L6-v2` and writes the binary sidecars consumed by the frontend.
* `ACM_proceedings_csv/`: The output directory where the generated CSV files are saved.
* `embeddings/`: Sibling output directory for the precomputed `.embeddings.bin` sidecars (one per CSV).

### Generated CSV Data

The `process_acm_json.py` script extracts the following columns for each paper (content item) found in the JSON:

* **conference**: The short name of the conference (e.g., CHI).
* **year**: The year of the conference.
* **session name**: The name of the session the paper was presented in.
* **paper title**: The title of the accepted paper.
* **DOI**: The Digital Object Identifier link for the paper.
* **author list**: A comma-separated list of the authors' full names (resolved from the `people` array in the JSON).
* **abstract**: The abstract of the paper (with all newline characters removed to ensure it remains on a single line in the CSV).

### Usage

1. Ensure your original ACM proceedings JSON files are located in the `ACM_proceedings_json/` directory.
2. Run the two pipeline scripts from the root of the project, in order:

```bash
python scripts/process_acm_json.py    # JSON → CSV
pip install -r scripts/requirements.txt
python scripts/embed_papers.py        # CSV → .embeddings.bin (uses GPU if available)
```

`process_acm_json.py` writes `.csv` files to `ACM_proceedings_csv/` (and silently drops reprised papers — see Directory Structure above). `embed_papers.py` then reads each CSV, encodes every paper with `sentence-transformers/all-MiniLM-L6-v2` (CUDA if available — small corpus, takes seconds), and writes a `*.embeddings.bin` sidecar into the top-level `embeddings/` directory (flat little-endian Float32, 384 floats per paper). It also rewrites `csv_manifest.json` so the frontend picks up the new files. Commit the CSVs and the `embeddings/` directory.

## Adding Your Own Conference Program Processor

If you have proceedings data from other conferences or platforms (e.g., IEEE, OpenReview), you can easily integrate them by writing your own processor script. The Reviewer Recommendation System only relies on the format of the generated CSV files.

To ensure compatibility, your custom processor must generate a CSV file containing exactly the following columns:

* `conference`
* `year`
* `session name`
* `paper title`
* `DOI`
* `author list`
* `abstract`

As long as your final CSV files match this schema and are placed in the output CSV directory, the frontend system will be able to load and search through them seamlessly.

After generating a new CSV, re-run `scripts/embed_papers.py` — it picks up every CSV in `ACM_proceedings_csv/` automatically and rewrites `csv_manifest.json` to include it.

## Frontend (Reviewer Recommendation Web App)

A static, client-side web app lives at the project root (`index.html`, `styles.css`, `js/*.js`). It loads the precomputed paper embeddings (the `*.embeddings.bin` sidecars produced by `scripts/embed_papers.py`) and uses Transformers.js (`Xenova/all-MiniLM-L6-v2`) only to embed the user's *query*.

Paste a paper title and abstract, then click **Find Reviewers**. The app ranks each paper by cosine similarity to the query, takes the top-K, and aggregates author scores with a position-decay weight (first author > second > third …), capped at each reviewer's top 3 matched papers. The **Scoring weights** panel lets you tune position decay, top-K, and top-N. The **Filters** panel lets you restrict by year range or conference.

### Running locally

ES modules and `fetch` require an HTTP origin, so serve over a local server:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. The first session-finding run downloads the embedding model (~25 MB) and caches it in the browser.

### Hosting on GitHub Pages

Push the repo to GitHub and enable Pages on the `main` branch (root). The repo already includes a `.nojekyll` file, and all paths are relative. CSVs in `ACM_proceedings_csv/` are served as static assets.

### Disabled features

Things I've implemented but have hidden in the UI for now — either still experimenting, or not convinced the behavior is right yet. The code is intact; each is gated by a `feature-disabled` class on the relevant DOM element (see `styles.css`: `.feature-disabled { display: none; }`). To bring one back, remove the class from the element in `index.html` (and undo the small JS workaround noted below).

#### LLM-written reviewer rationales (Ollama)

Each recommended reviewer can have a 1–2 sentence rationale generated by a local LLM, explaining why they're a fit based on the matched papers. The Ollama config inputs (URL, model, **Test connection**), the help disclosure, and the per-reviewer rationale generation in `js/app.js` / `js/ollama.js` are all still wired up — just hidden.

To re-enable: remove `feature-disabled` from the `.config` and `.help` elements in `index.html`. Then run [Ollama](https://ollama.com) with CORS allowed for the page:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

On Windows, set `OLLAMA_ORIGINS=*` as a system environment variable and restart the Ollama service. Pull a model (e.g. `ollama pull llama3`), enter the URL (`http://localhost:11434`) and model name in the page's config header, and click **Test connection**. GitHub Pages serves over HTTPS but Ollama runs over HTTP on `localhost`; browsers treat `localhost` as a "potentially trustworthy" origin and allow the mixed-content request, so no proxy is needed.

#### Recency half-life weighting

Each paper's cosine similarity gets multiplied by `0.5^((current_year − paper.year) / half_life)` before ranking, so newer papers count more. Currently disabled because the bias felt stronger than warranted — a barely-relevant 2026 paper would outrank a strongly matched 2022 paper at the default 5-year half-life.

To re-enable: remove `feature-disabled` from the half-life `<label>` in `index.html`, and in `js/app.js readControls` change `const halfLife = Infinity;` back to `const halfLife = parseFloat($('halfLife').value);`. The math in `recencyWeight()` is unchanged; with `halfLife = Infinity` it returns 1 for every paper, so paper score is just raw cosine similarity.

## TODO

- do an accessibility audit and identify accessibility issues.
- set default top-k papers aggregated to 100
- right-align the total weighted score in author card