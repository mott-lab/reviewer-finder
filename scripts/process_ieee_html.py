#!/usr/bin/env python3
"""
Parse IEEE VR proceedings HTML files into the project CSV schema.

Three HTML layouts are handled:
  - 2026: .session-container / .paper-block.paper-item
  - 2024-2025: p.medLarge + p.font_70 + div.wrap-collabsible + h2.pink sessions
  - 2021-2023: h4 + p>i + div.wrap-collabsible + h2 sessions

No DOIs are listed on the IEEE VR website, so all papers use Google Scholar URLs.

Run from the project root:
    python scripts/process_ieee_html.py
"""
import csv
import glob
import os
import re
from urllib.parse import quote_plus
from bs4 import BeautifulSoup

SCHOLAR_URL_BASE = "https://scholar.google.com/scholar?hl=en&as_sdt=0%2C10&q="
INPUT_DIR = "IEEE_proceedings"
OUTPUT_DIR = "ACM_proceedings_csv"
HEADERS = ['conference', 'year', 'session name', 'paper title', 'DOI', 'author list', 'abstract']

# Trailing type labels appended to some 2024 titles: "(Journal: P1220)", "(Conference: C1234)"
_PAPER_TYPE_SUFFIX = re.compile(
    r'\s*\((?:Invited\s+)?(?:Journal|Conference|TVCG):\s*[A-Z0-9-]+\)\s*$'
)


def scholar_url(title):
    return SCHOLAR_URL_BASE + quote_plus(title)


def clean(text):
    """Collapse whitespace."""
    return re.sub(r'\s+', ' ', text).strip()


def clean_abstract(text):
    """Flatten newlines so the abstract stays on one CSV line."""
    return re.sub(r'[\r\n]+', ' ', text).strip()


# ---------------------------------------------------------------------------
# Format: 2026
# Papers live in .paper-block.paper-item inside .session-container divs.
# ---------------------------------------------------------------------------
def parse_2026(soup, year):
    papers = []
    for session_div in soup.select('.session-container'):
        id_tag = session_div.select_one('.session-id-tag')
        name_tag = session_div.select_one('.session-name-title')
        parts = [
            clean(id_tag.get_text()) if id_tag else '',
            clean(name_tag.get_text()) if name_tag else '',
        ]
        session_name = ' '.join(p for p in parts if p)

        for paper_div in session_div.select('.paper-block.paper-item'):
            title_span = paper_div.select_one('.paper-title-text')
            if not title_span:
                continue
            title = clean(title_span.get_text())
            if not title:
                continue

            # Authors: first div whose style contains "#444" holds <strong>Name</strong> entries
            author_names = []
            for div in paper_div.find_all('div', recursive=True):
                if '#444' in div.get('style', ''):
                    for strong in div.find_all('strong'):
                        name = clean(strong.get_text()).rstrip(',')
                        if name:
                            author_names.append(name)
                    break

            abstract = ''
            toggle = paper_div.select_one('.toggle-content')
            if toggle:
                abstract = clean_abstract(toggle.get_text())

            papers.append(_row('IEEE VR', year, session_name, title, author_names, abstract))
    return papers


# ---------------------------------------------------------------------------
# Format: 2024-2025
# p.medLarge = title  |  p.font_70 = authors  |  div.wrap-collabsible = abstract
# h2.pink = session header
# ---------------------------------------------------------------------------
def parse_medlarge(soup, year):
    papers = []
    all_titles = [
        p for p in soup.find_all('p', class_='medLarge')
        if p.find(['b', 'strong'])
    ]

    for i, title_p in enumerate(all_titles):
        next_title = all_titles[i + 1] if i + 1 < len(all_titles) else None

        prev_h2 = title_p.find_previous('h2', class_='pink')
        session_name = clean(prev_h2.get_text()) if prev_h2 else ''

        bold = title_p.find(['b', 'strong'])
        title = _PAPER_TYPE_SUFFIX.sub('', clean(bold.get_text()))
        if not title:
            continue

        font70 = None
        wrap_coll = None
        for elem in title_p.next_elements:
            if elem is next_title:
                break
            if not hasattr(elem, 'name') or elem.name is None:
                continue
            if elem.name == 'p' and 'font_70' in (elem.get('class') or []) and font70 is None:
                font70 = elem
            if elem.name == 'div' and 'wrap-collabsible' in (elem.get('class') or []) and wrap_coll is None:
                wrap_coll = elem
            if font70 and wrap_coll:
                break

        author_names = []
        if font70:
            bold_spans = font70.find_all('span', class_='bold')
            if bold_spans:
                for span in bold_spans:
                    name = clean(span.get_text()).rstrip(',')
                    if name:
                        author_names.append(name)
            else:
                # Fallback: some entries use bare <i>Name;</i> elements
                for italic in font70.find_all('i'):
                    name = clean(italic.get_text()).rstrip(';').rstrip(',')
                    if name:
                        author_names.append(name)

        abstract = ''
        if wrap_coll:
            inner = wrap_coll.select_one('.content-inner p')
            if inner:
                abstract = clean_abstract(inner.get_text())

        papers.append(_row('IEEE VR', year, session_name, title, author_names, abstract))
    return papers


# ---------------------------------------------------------------------------
# Format: 2021-2023
# h4 = title  |  p>i = authors  |  div.wrap-collabsible = abstract
# h2 with "Session:" text = session header
#
# 2021 author italic text uses "Name: Institution; Name: Institution" format.
# 2022-2023 use plain comma-separated names.
# ---------------------------------------------------------------------------
def parse_h4(soup, year):
    papers = []

    for h4 in soup.find_all('h4'):
        title = clean(h4.get_text())
        if not title:
            continue

        prev_h2 = h4.find_previous('h2')
        session_name = ''
        if prev_h2:
            h2_text = clean(prev_h2.get_text())
            if 'Session' in h2_text:
                session_name = h2_text

        author_names = []
        wrap_coll = None

        for elem in h4.next_elements:
            if not hasattr(elem, 'name') or elem.name is None:
                continue
            if elem.name == 'h4':
                break  # reached next paper

            if elem.name == 'p' and not author_names:
                italic = elem.find('i')
                if italic:
                    raw = clean(italic.get_text())
                    author_names = _parse_author_text(raw)

            if elem.name == 'div' and 'wrap-collabsible' in (elem.get('class') or []) and wrap_coll is None:
                wrap_coll = elem
                break

        # Skip non-paper h4 elements (no abstract found)
        if not wrap_coll:
            continue

        abstract = ''
        inner = wrap_coll.select_one('.content-inner p')
        if inner:
            abstract = clean_abstract(inner.get_text())

        papers.append(_row('IEEE VR', year, session_name, title, author_names, abstract))
    return papers


def _parse_author_text(raw):
    """
    Handle two author-list formats found in the italic <p> elements:
      - 2021: "Name: Institution; Name: Institution, More; Name: Last Institution."
      - 2022/2023: "Name, Name, Name"
    """
    # Heuristic: 2021 format has ": " (name-institution separator) and ";" (author separator)
    if ': ' in raw and ';' in raw:
        names = []
        for part in raw.split(';'):
            part = part.strip().rstrip('.')
            if not part:
                continue
            # Take everything before the first ":" as the name
            name = part.split(':')[0].strip() if ': ' in part else part
            if name:
                names.append(name)
        return names
    else:
        return [n.strip() for n in raw.split(',') if n.strip()]


def _row(conference, year, session_name, title, author_names, abstract):
    return {
        'conference': conference,
        'year': year,
        'session name': session_name,
        'paper title': title,
        'DOI': scholar_url(title),
        'author list': ', '.join(author_names),
        'abstract': abstract,
    }


def detect_format(soup):
    if soup.find(class_='paper-item'):
        return '2026'
    if soup.find('p', class_='medLarge'):
        return 'medlarge'
    return 'h4'


def process_file(html_path, output_dir):
    year_match = re.search(r'(\d{4})', os.path.basename(html_path))
    year = int(year_match.group(1)) if year_match else 0

    with open(html_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f, 'html.parser')

    fmt = detect_format(soup)
    if fmt == '2026':
        papers = parse_2026(soup, year)
    elif fmt == 'medlarge':
        papers = parse_medlarge(soup, year)
    else:
        papers = parse_h4(soup, year)

    base = os.path.splitext(os.path.basename(html_path))[0]
    out_path = os.path.join(output_dir, f"{base}.csv")

    os.makedirs(output_dir, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(papers)

    print(f"  {len(papers)} papers -> {out_path}  [format: {fmt}]")
    return len(papers)


def main():
    html_files = sorted(glob.glob(os.path.join(INPUT_DIR, '*.html')))
    if not html_files:
        print(f"No HTML files found in {INPUT_DIR}/")
        return

    total = 0
    for path in html_files:
        print(f"Processing {path} ...")
        total += process_file(path, OUTPUT_DIR)
    print(f"\nDone. {total} papers total across {len(html_files)} files.")


if __name__ == '__main__':
    main()
