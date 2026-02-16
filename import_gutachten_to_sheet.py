import re
import sys
from os import path, getenv
from datetime import datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Konfiguration
SERVICE_ACCOUNT_FILE = getenv('GOOGLE_APPLICATION_CREDENTIALS', 'ux-dashboard-465511-29cd7fce4011.json')
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']

SPREADSHEET_ID = getenv('SHEET_ID', '10mfm9SVVDiWcxnfK2QuUCj3msaVFBQIQx34NnPlUEo4')
TAB_NAME = getenv('SHEET_TAB_NAME', 'Dashboard')
FOLDER_ID = getenv('DRIVE_FOLDER_ID', '15o5wS4TNaaMyukZx_ICK3kAA7nEaA3Sa')

current_year = str(datetime.now().year % 100).zfill(2)
AKTE_REGEX = re.compile(rf'(\d{{3,5}})[/_:\-]{current_year}')


def normalize_number(value):
    return re.sub(r'[^0-9]', '', str(value or ''))


def list_drive_files(drive_service):
    files = []
    page_token = None

    while True:
        response = drive_service.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed = false",
            fields='nextPageToken, files(name)',
            pageSize=200,
            pageToken=page_token
        ).execute()

        files.extend(response.get('files', []))
        page_token = response.get('nextPageToken')
        if not page_token:
            break

    return files


def find_new_entries(dateien, filtered_rows):
    vorhandene = {normalize_number(row[0]) for row in filtered_rows if row}
    neue_nummern = []
    gesehen = set(vorhandene)

    for file in dateien:
        name = file['name'].strip()

        if name.lower() == 'organisation':
            print(f'⏭️ Übersprungen (Organisation): {name}')
            continue
        if re.match(r'^(RB|KVA)[\s_:\-]?', name, re.IGNORECASE):
            print(f'⏭️ Übersprungen (RB/KVA): {name}')
            continue
        if 'gutachten' not in name.lower():
            print(f'⏭️ Übersprungen (kein Gutachten): {name}')
            continue

        match = AKTE_REGEX.search(name)
        if not match:
            print(f'⏭️ Kein gültiges Format: {name}')
            continue

        nummer = normalize_number(match.group(1))
        if not nummer or nummer in gesehen:
            continue

        gesehen.add(nummer)
        neue_nummern.append(nummer)

    return neue_nummern

def main():
    if not path.exists(SERVICE_ACCOUNT_FILE):
        print(f'❌ Service-Account-Datei nicht gefunden: {SERVICE_ACCOUNT_FILE}', file=sys.stderr)
        return 1

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    drive_service = build('drive', 'v3', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)

    # 1. Alle Daten aus dem Sheet lesen (A-C, ab Zeile 2)
    sheet = sheets_service.spreadsheets()
    result = sheet.values().get(spreadsheetId=SPREADSHEET_ID, range=f'{TAB_NAME}!A2:C').execute()
    rows = result.get('values', [])

    if not rows:
        rows = []

    # 2. Alle Zeilen mit Status 'versendet' aussortieren
    filtered_rows = []
    for row in rows:
        status = row[2].strip().lower() if len(row) > 2 else ''
        if not status.startswith('versendet'):
            filtered_rows.append(row)

    # 3. Alte Daten löschen
    sheet.values().clear(spreadsheetId=SPREADSHEET_ID, range=f'{TAB_NAME}!A2:C').execute()

    # 4. Gefilterte Daten zurückschreiben
    if filtered_rows:
        sheet.values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f'{TAB_NAME}!A2',
            valueInputOption='RAW',
            body={'values': filtered_rows}
        ).execute()

    print(f"✅ {len(rows) - len(filtered_rows)} versendete Zeilen gelöscht.")

    # 5. Neue Einträge aus Google Drive abrufen
    dateien = list_drive_files(drive_service)
    neue_nummern = find_new_entries(dateien, filtered_rows)

    # 6. Neue Einträge gezielt in Spalte A schreiben
    startzeile = len(filtered_rows) + 2
    if neue_nummern:
        values = [[nummer] for nummer in neue_nummern]
        sheet.values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f'{TAB_NAME}!A{startzeile}',
            valueInputOption='RAW',
            body={'values': values}
        ).execute()

    if neue_nummern:
        print(f"✅ {len(neue_nummern)} neue Gutachten eingetragen.")
    else:
        print("✅ Keine neuen Gutachten eingetragen.")

    return 0

if __name__ == '__main__':
    raise SystemExit(main())
