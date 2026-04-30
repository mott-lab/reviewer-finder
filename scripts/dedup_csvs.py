"""Cross-CSV and per-CSV dedup of papers in ACM_proceedings_csv/.

Two passes:

1. **Cross-CSV link dedup.** Reads every CSV in sorted filename order
   and removes rows whose `DOI` column value has already been seen in
   an earlier file (or earlier row in the same file). The DOI column
   holds either a real DOI URL or a deterministic Google Scholar
   search URL synthesized from the title, so matching on the string
   catches both real-DOI duplicates and title duplicates among
   DOI-less papers. First occurrence by sorted filename wins.

2. **Per-CSV title dedup.** Within a single CSV, if multiple rows
   share the same paper title and at least one row has a real DOI,
   drop sibling rows whose link is a Google Scholar fallback. The
   DOI'd row is the canonical record; the GS-link row is a duplicate
   the cross-CSV pass missed because the link strings differ.

Run from the project root after process_acm_json.py and before
embed_papers.py:
    python scripts/dedup_csvs.py
"""

import csv
import sys
from pathlib import Path

CSV_DIR = Path("ACM_proceedings_csv")
HEADERS = ['conference', 'year', 'session name', 'paper title', 'DOI', 'author list', 'abstract']
SCHOLAR_PREFIX = "https://scholar.google.com/"


def is_scholar_link(link: str) -> bool:
    return bool(link) and link.startswith(SCHOLAR_PREFIX)


def main() -> None:
    if not CSV_DIR.is_dir():
        print(f"ERROR: {CSV_DIR} not found. Run scripts/process_acm_json.py first.", file=sys.stderr)
        sys.exit(1)

    csv_files = sorted(CSV_DIR.glob("*.csv"))
    if not csv_files:
        print(f"ERROR: no CSV files in {CSV_DIR}.", file=sys.stderr)
        sys.exit(1)

    seen_links = set()
    total_link_removed = 0
    total_title_removed = 0

    for csv_path in csv_files:
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))

        # Pass 1: cross-CSV link dedup.
        kept = []
        link_removed = 0
        for row in rows:
            link = row.get('DOI', '')
            if link and link in seen_links:
                link_removed += 1
                continue
            if link:
                seen_links.add(link)
            kept.append(row)

        # Pass 2: per-CSV title dedup. If a title has a row with a real
        # DOI, drop sibling rows whose link is a scholar fallback.
        titles_with_doi = {
            row['paper title']
            for row in kept
            if row.get('paper title')
            and row.get('DOI')
            and not is_scholar_link(row['DOI'])
        }
        final = []
        title_removed = 0
        for row in kept:
            if (row.get('paper title') in titles_with_doi
                    and is_scholar_link(row.get('DOI', ''))):
                title_removed += 1
                continue
            final.append(row)

        print(
            f"{csv_path.name}: kept {len(final)}, "
            f"removed {link_removed} link-dup + {title_removed} title-dup"
        )

        if link_removed or title_removed:
            with csv_path.open("w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=HEADERS)
                writer.writeheader()
                writer.writerows(final)
            total_link_removed += link_removed
            total_title_removed += title_removed

    print(
        f"\nTotal removed: {total_link_removed} link-dup, {total_title_removed} title-dup."
    )


if __name__ == "__main__":
    main()
