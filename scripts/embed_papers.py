"""Precompute paper embeddings for the frontend.

Reads every CSV in ACM_proceedings_csv/, encodes each paper with
sentence-transformers/all-MiniLM-L6-v2, and writes a sidecar binary
(<basename>.embeddings.bin) of L2-normalized float32 vectors. Also rewrites
csv_manifest.json with the schema the frontend expects.

Run from the project root after process_acm_json.py:
    python scripts/embed_papers.py
"""

import csv
import json
import sys
from pathlib import Path

import numpy as np

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_DIM = 384
BATCH_SIZE = 256

CSV_DIR = Path("ACM_proceedings_csv")
EMBEDDINGS_DIR = Path("embeddings")
MANIFEST_PATH = Path("csv_manifest.json")


def main() -> None:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("ERROR: sentence-transformers not installed.", file=sys.stderr)
        print("Run: pip install -r scripts/requirements.txt", file=sys.stderr)
        sys.exit(1)

    if not CSV_DIR.is_dir():
        print(f"ERROR: {CSV_DIR} not found. Run scripts/process_acm_json.py first.", file=sys.stderr)
        sys.exit(1)

    csv_files = sorted(CSV_DIR.glob("*.csv"))
    if not csv_files:
        print(f"ERROR: no CSV files in {CSV_DIR}.", file=sys.stderr)
        sys.exit(1)

    EMBEDDINGS_DIR.mkdir(exist_ok=True)

    print(f"Loading model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    print(f"Device: {model.device}")

    actual_dim = model.get_sentence_embedding_dimension()
    if actual_dim != EMBED_DIM:
        print(f"ERROR: expected dim {EMBED_DIM}, got {actual_dim}", file=sys.stderr)
        sys.exit(1)

    manifest_files = []

    for csv_path in csv_files:
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))

        # Match the frontend's text-construction exactly: title \n\n abstract.
        texts = [
            f"{(row.get('paper title') or '')}\n\n{(row.get('abstract') or '')}"
            for row in rows
        ]

        print(f"\n{csv_path.name}: encoding {len(texts)} papers (batch {BATCH_SIZE})")
        embeddings = model.encode(
            texts,
            batch_size=BATCH_SIZE,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=True,
        )

        # Force little-endian float32; JS reads `new Float32Array(buf)` in native order,
        # which is LE on every platform we care about.
        embeddings = embeddings.astype("<f4", copy=False)

        out_path = EMBEDDINGS_DIR / f"{csv_path.stem}.embeddings.bin"
        embeddings.tofile(out_path)
        size = out_path.stat().st_size
        expected = len(rows) * EMBED_DIM * 4
        assert size == expected, f"size mismatch: {size} != {expected}"
        print(f"  wrote {out_path} ({size} bytes, {len(rows)} papers)")

        # Manifest paths are project-relative so the frontend can fetch them directly.
        manifest_files.append({
            "csv": f"{CSV_DIR.name}/{csv_path.name}",
            "embeddings": f"{EMBEDDINGS_DIR.name}/{out_path.name}",
            "count": len(rows),
        })

    manifest = {
        "model": MODEL_NAME,
        "dim": EMBED_DIM,
        "files": manifest_files,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {MANIFEST_PATH} with {len(manifest_files)} entries.")


if __name__ == "__main__":
    main()
