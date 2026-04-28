export async function loadAllPapers(manifestPath = './csv_manifest.json') {
  const manifest = await fetch(manifestPath).then((r) => {
    if (!r.ok) throw new Error(`Failed to load manifest (${r.status})`);
    return r.json();
  });

  if (!manifest.dim || !Array.isArray(manifest.files) || !manifest.files[0]?.embeddings) {
    throw new Error(
      'Manifest missing precomputed-embedding fields (dim, files[].embeddings). ' +
      'Run `python scripts/embed_papers.py` to regenerate.'
    );
  }

  const dim = manifest.dim;
  const papers = [];

  for (const entry of manifest.files) {
    const [csvText, embedBuf] = await Promise.all([
      fetch(`./${entry.csv}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${entry.csv} (${r.status})`);
        return r.text();
      }),
      fetch(`./${entry.embeddings}`).then((r) => {
        if (!r.ok) {
          throw new Error(
            `Failed to load ${entry.embeddings} (${r.status}). ` +
            'Run `python scripts/embed_papers.py` to generate paper embeddings.'
          );
        }
        return r.arrayBuffer();
      }),
    ]);

    const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;

    const expectedBytes = rows.length * dim * 4;
    if (embedBuf.byteLength !== expectedBytes) {
      throw new Error(
        `Embedding size mismatch for ${entry.csv}: expected ${expectedBytes} bytes ` +
        `(${rows.length} rows × ${dim} × 4), got ${embedBuf.byteLength}. ` +
        'CSV and embeddings file are out of sync — re-run `python scripts/embed_papers.py`.'
      );
    }

    const flat = new Float32Array(embedBuf);
    for (let i = 0; i < rows.length; i++) {
      rows[i]._embedding = flat.subarray(i * dim, (i + 1) * dim);
      papers.push(rows[i]);
    }
  }

  return { papers, dim, model: manifest.model };
}
