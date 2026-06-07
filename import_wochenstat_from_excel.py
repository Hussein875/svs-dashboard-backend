#!/usr/bin/env python3
"""Historische GA-Zahlen pro KW aus Excel nach WochenStat importieren."""
import argparse
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from os import getenv, path

from google.oauth2 import service_account
from googleapiclient.discovery import build

from import_gutachten_to_sheet import (
    SERVICE_ACCOUNT_FILE,
    SCOPES,
    WOCHEN_STAT_ARCHIV_TAB,
    WOCHEN_STAT_TAB,
    current_calendar_year,
    normalize_number,
    normalize_wochen_stat_row,
    WOCHEN_STAT_ARCHIV_FROZEN,
    WOCHEN_STAT_MANUAL,
    read_all_wochenstat,
    split_wochen_rows,
    write_wochenstat_current,
    write_wochenstat_tabs,
)

DEFAULT_XLSX = getenv(
    'GA_KW_XLSX',
    '/Users/husseinsouleiman/Downloads/GA-Anzahl pro KW.xlsx',
)
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def col_idx(ref):
    match = re.match(r'([A-Z]+)', ref)
    col = 0
    for ch in match.group(1):
        col = col * 26 + ord(ch) - 64
    return col


def row_idx(ref):
    return int(re.search(r'(\d+)', ref).group(1))


def load_shared_strings(zf):
    if 'xl/sharedStrings.xml' not in zf.namelist():
        return []
    root = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    strings = []
    for si in root.findall(f'.//{NS}si'):
        parts = [t.text or '' for t in si.iter(f'{NS}t')]
        strings.append(''.join(parts))
    return strings


def read_sheet_rows(zf, target, shared_strings):
    root = ET.fromstring(zf.read(target))
    rows = {}
    for cell in root.findall(f'.//{NS}c'):
        ref = cell.get('r')
        if not ref:
            continue
        cell_type = cell.get('t')
        value_el = cell.find(f'{NS}v')
        value = value_el.text if value_el is not None else ''
        if cell_type == 's' and str(value).isdigit():
            value = shared_strings[int(value)]
        rows.setdefault(row_idx(ref), {})[col_idx(ref)] = value
    return rows


def parse_workbook(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as zf:
        workbook = ET.fromstring(zf.read('xl/workbook.xml'))
        rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
        rid_map = {rel.get('Id'): rel.get('Target') for rel in rels}
        shared_strings = load_shared_strings(zf)

        sheets = []
        for sheet in workbook.findall(f'.//{NS}sheet'):
            name = sheet.get('name')
            rid = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            if not name or not rid:
                continue
            target = rid_map.get(rid, '')
            if target.startswith('/'):
                target = target[1:]
            if not target.startswith('xl/'):
                target = f'xl/{target}'
            sheets.append((name, target))

        data = {}
        for name, target in sheets:
            if not str(name).isdigit():
                continue
            data[int(name)] = read_sheet_rows(zf, target, shared_strings)
    return data


def parse_kw_header(value):
    match = re.search(r'KW\s*(\d+)', str(value or ''), re.I)
    return int(match.group(1)) if match else None


def parse_akten_nummer(raw):
    text = str(raw or '').strip().upper()
    if not text or text == 'RB':
        return None
    if any(token in text for token in ('GESAMTSUMME', 'DURCHSCHNITT', 'SUMME')):
        return None

    if re.fullmatch(r'\d+\.\d+', text):
        try:
            return int(float(text.replace(',', '.')))
        except ValueError:
            return None

    text = text.replace('_', '/').replace(',', '.')
    if re.fullmatch(r'\d{4}', text):
        number = int(text)
        return number if number < 10000 else None

    cleaned = re.sub(r'[^0-9/.A-Z]', '', text)
    match = re.match(r'^(\d+)(?:/(\d{2,4}))?[A-Z]?$', cleaned)
    if match:
        return int(match.group(1))

    match = re.search(r'(\d+)', cleaned)
    if not match:
        return None
    number = int(match.group(1))
    return number if number < 10000 else None


def extract_week_block(sheet_rows, col):
    """Erste fortlaufende GA-Liste von oben nach unten (Wochenstart = erste Nummer)."""
    entries = []
    for row_num in sorted(sheet_rows):
        if row_num == 1:
            continue
        parsed = parse_akten_nummer(sheet_rows[row_num].get(col, ''))
        if parsed is not None and parsed > 0:
            entries.append((row_num, parsed))

    if not entries:
        return []

    block = [entries[0][1]]
    first_num = entries[0][1]

    for i in range(1, len(entries)):
        prev_row, prev_num = entries[i - 1]
        cur_row, cur_num = entries[i]

        if cur_row - prev_row > 15:
            break
        if cur_num < first_num - 20:
            break
        if cur_num < prev_num - 5:
            break
        if cur_num - prev_num > 120:
            break

        block.append(cur_num)

    return block


def iso_week_monday(year, kw):
    try:
        return date.fromisocalendar(year, kw, 1).strftime('%Y-%m-%d')
    except ValueError:
        return 'historisch'


def rows_from_excel(xlsx_path):
    workbook = parse_workbook(xlsx_path)
    rows = []

    for year in sorted(workbook):
        header = workbook[year].get(1, {})
        week_columns = sorted(
            (col, parse_kw_header(header[col]))
            for col in header
            if parse_kw_header(header[col]) is not None
        )

        for col, kw in week_columns:
            block = extract_week_block(workbook[year], col)
            if not block:
                continue

            wochenstart = block[0]
            nummer = block[-1]
            anzahl = len(block)
            rows.append([
                str(year),
                str(kw),
                str(wochenstart),
                str(nummer),
                str(anzahl),
                iso_week_monday(year, kw),
            ])

    return rows


def is_live_row(row):
    normalized = normalize_wochen_stat_row(row)
    if not normalized or len(normalized) < 6:
        return False
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}$', str(normalized[5]).strip()))


def merge_wochen_rows(existing_rows, imported_rows):
    merged = {}

    for raw in existing_rows:
        row = normalize_wochen_stat_row(raw)
        if not row or len(row) < 2:
            continue
        merged[(str(row[0]).strip(), str(row[1]).strip())] = row

    for raw in imported_rows:
        row = normalize_wochen_stat_row(raw)
        if not row or len(row) < 4:
            continue
        key = (str(row[0]).strip(), str(row[1]).strip())
        imported_end = int(normalize_number(row[3]) or 0)
        imported_start = int(normalize_number(row[2]) or imported_end)
        imported_count = int(normalize_number(row[4]) or 0)

        if key not in merged:
            merged[key] = row
            continue

        if WOCHEN_STAT_MANUAL:
            continue

        current = normalize_wochen_stat_row(merged[key])
        current_end = int(normalize_number(current[3]) or 0)
        current_start = int(normalize_number(current[2]) or current_end)
        current_count = int(normalize_number(current[4]) or 0)

        if is_live_row(current) and imported_end <= current_end:
            merged[key] = current
            continue

        end = max(current_end, imported_end)
        start = imported_start if imported_start else current_start
        if current_start and imported_start:
            start = imported_start
        elif current_start:
            start = current_start

        count = max(current_count, imported_count, end - start + 1 if end >= start else 1)
        aktualisiert = current[5] if is_live_row(current) and imported_end <= current_end else row[5]
        merged[key] = [key[0], key[1], str(start), str(end), str(count), aktualisiert]

    return sorted(
        merged.values(),
        key=lambda row: (int(str(row[0]).strip() or 0), int(str(row[1]).strip() or 0)),
    )


def main():
    parser = argparse.ArgumentParser(description='GA-KW-Excel nach WochenStat importieren')
    parser.add_argument('xlsx', nargs='?', default=DEFAULT_XLSX, help='Pfad zur Excel-Datei')
    parser.add_argument('--dry-run', action='store_true', help='Nur anzeigen, nichts schreiben')
    parser.add_argument(
        '--rewrite-archiv',
        action='store_true',
        help='Archiv-Tab überschreiben (Standard: Archiv ist eingefroren)',
    )
    args = parser.parse_args()

    if not path.exists(args.xlsx):
        print(f'❌ Excel nicht gefunden: {args.xlsx}', file=sys.stderr)
        return 1

    imported = rows_from_excel(args.xlsx)
    print(f'ℹ️ {len(imported)} KW-Zeilen aus Excel gelesen.')
    if imported:
        print(f'   Erste: {imported[0]}')
        print(f'   Letzte: {imported[-1]}')
        kw23 = next((r for r in imported if r[0] == '2026' and r[1] == '23'), None)
        if kw23:
            print(f'   2026/KW23: {kw23}')

    current, archive = split_wochen_rows(imported)
    print(f'ℹ️ Aufteilung: {len(current)} Zeilen → {WOCHEN_STAT_TAB} ({current_calendar_year()}), '
          f'{len(archive)} Zeilen → {WOCHEN_STAT_ARCHIV_TAB}')

    if args.dry_run:
        print('ℹ️ Dry-run — Sheet wird nicht verändert.')
        return 0

    if not path.exists(SERVICE_ACCOUNT_FILE):
        print(f'❌ Service-Account-Datei nicht gefunden: {SERVICE_ACCOUNT_FILE}', file=sys.stderr)
        return 1

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    sheets_service = build('sheets', 'v4', credentials=creds)

    existing = read_all_wochenstat(sheets_service)
    merged = merge_wochen_rows(existing, imported)
    current, archive = split_wochen_rows(merged)

    if WOCHEN_STAT_ARCHIV_FROZEN and not args.rewrite_archiv:
        write_wochenstat_current(sheets_service, merged)
        print(f'✅ {len(current)} Zeilen in {WOCHEN_STAT_TAB} aktualisiert.')
        print(f'ℹ️ {WOCHEN_STAT_ARCHIV_TAB} eingefroren – nicht verändert ({len(archive)} Zeilen).')
        print('   Zum Überschreiben: --rewrite-archiv')
    else:
        write_wochenstat_tabs(sheets_service, merged, rewrite_archiv=True)
        print(f'✅ WochenStat aufgeteilt: {len(current)} Zeilen in {WOCHEN_STAT_TAB}, '
              f'{len(archive)} Zeilen in {WOCHEN_STAT_ARCHIV_TAB} ({len(existing)} zuvor gesamt).')

    from wochenstat_auswertung import update_wochenstat_auswertung, WOCHEN_STAT_AUSWERTUNG_TAB
    weeks = update_wochenstat_auswertung(sheets_service)
    print(f'✅ {weeks} KW in Google-Sheet-Tab "{WOCHEN_STAT_AUSWERTUNG_TAB}" ausgewertet.')
    print(f'ℹ️ Excel-Datei unverändert — Auswertung nur im Sheet-Tab "{WOCHEN_STAT_AUSWERTUNG_TAB}".')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
