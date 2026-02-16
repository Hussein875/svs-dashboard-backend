import os
import re
from datetime import datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Konfiguration
SERVICE_ACCOUNT_FILE = 'ux-dashboard-465511-29cd7fce4011.json'
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']

SPREADSHEET_ID = '10mfm9SVVDiWcxnfK2QuUCj3msaVFBQIQx34NnPlUEo4'
TAB_NAME = 'Dashboard'
FOLDER_ID = '15o5wS4TNaaMyukZx_ICK3kAA7nEaA3Sa'

current_year = str(datetime.now().year % 100).zfill(2)

def main():
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
        if status != 'versendet':
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
    response = drive_service.files().list(
        q=f"'{FOLDER_ID}' in parents and trashed = false",
        fields="files(name)",
        pageSize=200
    ).execute()
    dateien = response.get('files', [])
    vorhandene = [row[0] for row in filtered_rows if row]
    neue_eintraege = []

    for file in dateien:
        name = file['name'].strip()

        # Ausschlüsse
        if name.lower() == 'organisation':
            print(f'⏭️ Übersprungen (Organisation): {name}')
            continue
        if re.match(r'^(RB|KVA)[\s_:\-]?', name, re.IGNORECASE):
            print(f'⏭️ Übersprungen (RB/KVA): {name}')
            continue
        if 'gutachten' not in name.lower():
            print(f'⏭️ Übersprungen (kein Gutachten): {name}')
            continue

        match = re.search(rf'(\d{{3,5}})[/_:\-]{current_year}', name)
        if not match:
            print(f'⏭️ Kein gültiges Format: {name}')
            continue

        nummer = match.group(1)

        if nummer in vorhandene or any(nummer == e[0] for e in neue_eintraege):
            continue

        neue_eintraege.append([nummer])

    # 6. Neue Einträge gezielt in Spalte A schreiben
    startzeile = len(filtered_rows) + 2
    for i, eintrag in enumerate(neue_eintraege):
        zielzeile = startzeile + i
        sheet.values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f'{TAB_NAME}!A{zielzeile}',
            valueInputOption='RAW',
            body={'values': [[eintrag[0]]]}
        ).execute()

    if neue_eintraege:
        print(f"✅ {len(neue_eintraege)} neue Gutachten eingetragen.")
    else:
        print("✅ Keine neuen Gutachten eingetragen.")

if __name__ == '__main__':
    main()