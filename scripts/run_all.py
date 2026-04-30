"""Run the full data pipeline end-to-end.

Equivalent to:
    python scripts/process_acm_json.py
    python scripts/dedup_csvs.py
    python scripts/embed_papers.py

Run from the project root:
    python scripts/run_all.py
"""

import subprocess
import sys
from pathlib import Path

STEPS = [
    "scripts/process_acm_json.py",
    "scripts/process_ieee_html.py",
    "scripts/dedup_csvs.py",
    "scripts/embed_papers.py",
]


def main() -> None:
    for step in STEPS:
        if not Path(step).is_file():
            print(f"ERROR: {step} not found. Run from the project root.", file=sys.stderr)
            sys.exit(1)

    for step in STEPS:
        print(f"\n=== {step} ===")
        result = subprocess.run([sys.executable, step])
        if result.returncode != 0:
            print(f"\nERROR: {step} exited with code {result.returncode}.", file=sys.stderr)
            sys.exit(result.returncode)

    print("\n=== Pipeline complete. ===")


if __name__ == "__main__":
    main()
