import json
import csv
import glob
import os
import re
from urllib.parse import quote_plus

# Matches "UIST'21:", "CHI '20 :", etc. — papers reprised from a previous edition.
REPRISE_PREFIX = re.compile(r"^[A-Z]{2,6}\s*['′'']\s*\d{2}\s*:")

SCHOLAR_URL_BASE = "https://scholar.google.com/scholar?hl=en&as_sdt=0%2C10&q="


def scholar_url(title):
    """Build a Google Scholar search URL for a paper title (DOI fallback)."""
    return SCHOLAR_URL_BASE + quote_plus(title)


def process_acm_json(input_dir, output_dir):
    # Sorted so dedup is deterministic: within a conference the older year wins;
    # across conferences alphabetical order breaks ties.
    json_files = sorted(glob.glob(os.path.join(input_dir, '*.json')))

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Persists across all files in this run; first occurrence of a DOI wins.
    seen_dois = set()

    for json_file in json_files:
        print(f"Processing {json_file}...")
        
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        conference_data = data.get('conference', {})
        conference_name = conference_data.get('shortName', 'Unknown Conference')
        conference_year = conference_data.get('year', '')
        
        people_array = data.get('people', [])
        contents_array = data.get('contents', [])
        sessions_array = data.get('sessions', [])
        
        # Build lookup for content -> session name
        session_dict = {}
        for session in sessions_array:
            session_name = session.get('name', '')
            for c_id in session.get('contentIds', []):
                session_dict[c_id] = session_name
                
        # Build a lookup dictionary for people using their id
        people_dict = {}
        for person in people_array:
            person_id = person.get('id')
            first_name = person.get('firstName', '').strip()
            middle_name = person.get('middleInitial', '').strip()
            last_name = person.get('lastName', '').strip()
            
            # Combine names, filtering out empty parts
            full_name = " ".join(filter(None, [first_name, middle_name, last_name]))
            people_dict[person_id] = full_name
            
        # Prepare the output CSV filename
        base_name = os.path.splitext(os.path.basename(json_file))[0]
        csv_filename = os.path.join(output_dir, f"{base_name}.csv")
        
        # Define the headers
        headers = ['conference', 'year', 'session name', 'paper title', 'DOI', 'author list', 'abstract']
        
        # Write to CSV
        with open(csv_filename, 'w', encoding='utf-8', newline='') as f_out:
            writer = csv.DictWriter(f_out, fieldnames=headers)
            writer.writeheader()
            
            skipped = 0
            duplicates = 0
            for item in contents_array:
                item_id = item.get('id')
                session_name = session_dict.get(item_id, '')
                title = item.get('title', '')
                if title and REPRISE_PREFIX.match(title):
                    skipped += 1
                    continue
                abstract = item.get('abstract', '')
                if abstract:
                    # Remove all newlines from abstract to keep it on one line
                    abstract = abstract.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')

                # Look for the DOI
                doi = ''
                addons = item.get('addons', {})
                if 'doi' in addons:
                    doi = addons['doi'].get('url', '')

                # Skip cross-CSV duplicates by DOI (real DOIs only — not Scholar fallbacks).
                if doi:
                    if doi in seen_dois:
                        duplicates += 1
                        continue
                    seen_dois.add(doi)
                elif title:
                    # No DOI: synthesize a Google Scholar search URL so the frontend can still link.
                    doi = scholar_url(title)
                
                # Build author list
                authors = item.get('authors', [])
                author_names = []
                for author in authors:
                    person_id = author.get('personId')
                    if not person_id and 'id' in author:
                        person_id = author.get('id')
                        
                    if person_id in people_dict:
                        author_names.append(people_dict[person_id])
                
                author_list_str = ", ".join(author_names)
                
                # Write row
                writer.writerow({
                    'conference': conference_name,
                    'year': conference_year,
                    'session name': session_name,
                    'paper title': title,
                    'DOI': doi,
                    'author list': author_list_str,
                    'abstract': abstract
                })
                
        notes = []
        if skipped:
            notes.append(f"{skipped} reprised")
        if duplicates:
            notes.append(f"{duplicates} duplicates")
        suffix = f" ({', '.join(notes)} filtered out)" if notes else ""
        print(f"Created {csv_filename} successfully{suffix}.")

if __name__ == "__main__":
    TARGET_DIR = 'ACM_proceedings_json'
    OUTPUT_DIR = 'ACM_proceedings_csv'
    process_acm_json(TARGET_DIR, OUTPUT_DIR)
