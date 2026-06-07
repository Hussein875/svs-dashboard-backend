"""Read-only analytics for WochenStat + WochenStat_Archiv → Google Sheet tab."""
import re
from collections import defaultdict
from datetime import date, datetime
from os import getenv

from import_gutachten_to_sheet import (
    SPREADSHEET_ID,
    WOCHEN_STAT_ARCHIV_TAB,
    WOCHEN_STAT_RANGE,
    WOCHEN_STAT_TAB,
    ensure_tab,
    get_sheet_id,
    is_wochen_section_row,
    is_wochen_summary_row,
    normalize_number,
    normalize_wochen_stat_row,
    read_all_wochenstat,
    tab_exists,
    wochen_row_year,
)

WOCHEN_STAT_AUSWERTUNG_TAB = getenv('SHEET_WOCHEN_STAT_AUSWERTUNG_TAB', 'WochenStat_Auswertung')
SECTION_COLS = 10
PROG_COL_LABEL = 0
PROG_COL_VALUE = 3
PROG_COL_EXPLAIN = 7

# Dashboard-Farben (an SVS-Dashboard angelehnt)
CLR_HEADER_BG = (0.10, 0.14, 0.20)
CLR_HEADER_FG = (0.95, 0.97, 1.00)
CLR_SECTION_BG = (0.86, 0.91, 0.98)
CLR_SECTION_FG = (0.12, 0.23, 0.45)
CLR_TABLE_HEAD_BG = (0.12, 0.16, 0.22)
CLR_ZEBRA = (0.93, 0.96, 0.99)
CLR_CURRENT_YEAR = (0.82, 0.91, 1.00)
CLR_POSITIVE = (0.78, 0.93, 0.82)
CLR_POSITIVE_FG = (0.08, 0.38, 0.16)
CLR_NEGATIVE = (0.97, 0.82, 0.82)
CLR_NEGATIVE_FG = (0.62, 0.10, 0.10)
CLR_INSIGHT_BG = (1.00, 0.96, 0.82)
KW_PROFILE_TOP_N = int(getenv('KW_PROFILE_TOP_N', '3'))
KW_PROFILE_BOTTOM_N = int(getenv('KW_PROFILE_BOTTOM_N', '3'))
WEAK_KW_IGNORE = {52, 53}


def _color(red, green, blue):
    return {'red': red, 'green': green, 'blue': blue}


def section_title(text):
    row = [''] * SECTION_COLS
    row[0] = text
    return row


def prog_row(label, value='', explain=''):
    row = [''] * SECTION_COLS
    row[PROG_COL_LABEL] = label
    if value != '':
        row[PROG_COL_VALUE] = str(value)
    row[PROG_COL_EXPLAIN] = explain
    return row


def read_jahressummen(sheets_service):
    """Jahressumme pro Jahr aus WochenStat-Tabs (manuell gepflegte Jahrestotals)."""
    summaries = {}
    for tab in (WOCHEN_STAT_ARCHIV_TAB, WOCHEN_STAT_TAB):
        if not tab_exists(sheets_service, tab):
            continue
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f'{tab}!{WOCHEN_STAT_RANGE}',
        ).execute()
        current_year = None
        for raw in result.get('values', []) or []:
            row = normalize_wochen_stat_row(raw)
            if not row:
                continue
            if is_wochen_section_row(row):
                current_year = int(wochen_row_year(row))
                continue
            if is_wochen_summary_row(row) and current_year:
                total = int(normalize_number(row[4] if len(row) > 4 else 0) or 0)
                if total > 0:
                    summaries[current_year] = total
                current_year = None
    return summaries


def parse_wochen_rows(rows):
    """Normalize rows into (year:int, kw:int, anzahl:int) tuples."""
    by_key = {}
    for raw in rows:
        row = normalize_wochen_stat_row(raw)
        if not row or len(row) < 5:
            continue
        year_s = str(row[0]).strip()
        kw_s = str(row[1]).strip()
        if not re.fullmatch(r'\d{4}', year_s) or not kw_s.isdigit():
            continue
        anzahl = int(normalize_number(row[4]) or 0)
        if anzahl <= 0:
            continue
        by_key[(int(year_s), int(kw_s))] = anzahl
    return [(year, kw, anzahl) for (year, kw), anzahl in sorted(by_key.items())]


def year_is_complete(parsed, year, *, generated_at=None):
    """Jahr gilt als abgeschlossen, wenn alle ISO-KW erfasst sind."""
    generated_at = generated_at or datetime.now()
    if year < generated_at.year:
        return True
    year_rows = sorted(kw for y, kw, _ in parsed if y == year)
    if not year_rows:
        return False
    return year_rows[-1] >= iso_weeks_in_year(year)


def _weakest_week(weeks):
    """Schwächste KW; 52/53 auslassen (oft unvollständige Jahresenden)."""
    eligible = [item for item in weeks if item[0] not in WEAK_KW_IGNORE]
    pool = eligible or list(weeks)
    return min(pool, key=lambda item: item[1])


def year_stats(parsed, jahressummen=None, *, generated_at=None):
    jahressummen = jahressummen or {}
    generated_at = generated_at or datetime.now()
    by_year = defaultdict(list)
    for year, kw, anzahl in parsed:
        by_year[year].append((kw, anzahl))

    stats = {}
    for year in sorted(by_year):
        weeks = by_year[year]
        counts = [a for _, a in weeks]
        complete = year_is_complete(parsed, year, generated_at=generated_at)
        if complete and year in jahressummen:
            total = jahressummen[year]
        else:
            total = sum(counts)
        n = len(counts)
        strongest = max(weeks, key=lambda item: item[1])
        weakest = _weakest_week(weeks)
        stats[year] = {
            'weeks': n,
            'total': total,
            'avg': round(total / n, 1) if n else 0,
            'median': _median(counts),
            'min': min(counts) if counts else 0,
            'max': max(counts) if counts else 0,
            'strongest_kw': strongest[0],
            'strongest_val': strongest[1],
            'weakest_kw': weakest[0],
            'weakest_val': weakest[1],
        }
    return stats


def _median(values):
    if not values:
        return 0
    sorted_vals = sorted(values)
    mid = len(sorted_vals) // 2
    if len(sorted_vals) % 2:
        return sorted_vals[mid]
    return round((sorted_vals[mid - 1] + sorted_vals[mid]) / 2, 1)


def kw_profile(parsed):
    """Per calendar week: values by year + average."""
    by_kw = defaultdict(dict)
    years = set()
    for year, kw, anzahl in parsed:
        by_kw[kw][year] = anzahl
        years.add(year)
    return by_kw, sorted(years)


def kw_profile_year_extremes(by_kw, year, profile_data_start, display_years, *,
                           top_n=KW_PROFILE_TOP_N, bottom_n=KW_PROFILE_BOTTOM_N):
    """Beste/schlechteste KW eines Jahres in der KW-Vergleich-Spalte markieren."""
    if year not in display_years:
        return []
    col = display_years.index(year) + 1
    entries = []
    for row_offset, kw in enumerate(sorted(by_kw)):
        val = by_kw[kw].get(year, '')
        if val != '':
            entries.append((val, kw, profile_data_start + row_offset))
    if not entries:
        return []

    sorted_desc = sorted(entries, key=lambda x: (-x[0], x[1]))
    sorted_asc = sorted(entries, key=lambda x: (x[0], x[1]))
    highlights = []
    top_cells = set()
    for _, _, sheet_row in sorted_desc[:top_n]:
        top_cells.add(sheet_row)
        highlights.append({'row': sheet_row, 'col': col, 'kind': 'above'})
    for _, _, sheet_row in sorted_asc[:bottom_n]:
        if sheet_row in top_cells:
            continue
        highlights.append({'row': sheet_row, 'col': col, 'kind': 'below'})
    return highlights


def yoy_delta(current, previous):
    if not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def iso_weeks_in_year(year):
    """Anzahl ISO-Kalenderwochen im Jahr (52 oder 53)."""
    return date(year, 12, 28).isocalendar()[1]


def compute_year_forecast(parsed, year_summary, year, *, generated_at=None):
    """Jahresend-Prognose für ein laufendes Jahr (lineare Hochrechnung)."""
    generated_at = generated_at or datetime.now()
    if year not in year_summary:
        return None

    year_rows = sorted(
        [(kw, a) for y, kw, a in parsed if y == year],
        key=lambda item: item[0],
    )
    if not year_rows:
        return None

    ytd_total = sum(a for _, a in year_rows)
    weeks_done = len(year_rows)
    last_kw = year_rows[-1][0]
    total_weeks = iso_weeks_in_year(year)
    weeks_remaining = max(0, total_weeks - last_kw)

    avg_overall = round(ytd_total / weeks_done, 1) if weeks_done else 0

    recent_counts = [a for _, a in year_rows[-min(12, weeks_done):]]
    avg_recent = round(sum(recent_counts) / len(recent_counts), 1) if recent_counts else avg_overall

    if weeks_remaining == 0:
        return {
            'year': year,
            'complete': True,
            'last_kw': last_kw,
            'total_weeks': total_weeks,
            'ytd_total': ytd_total,
            'weeks_done': weeks_done,
            'avg_overall': avg_overall,
            'avg_recent': avg_recent,
            'weeks_remaining': 0,
            'forecast_rest': 0,
            'forecast_total': ytd_total,
            'forecast_recent': ytd_total,
        }

    forecast_rest = round(avg_overall * weeks_remaining)
    forecast_total = ytd_total + forecast_rest
    forecast_recent = ytd_total + round(avg_recent * weeks_remaining)

    return {
        'year': year,
        'complete': False,
        'last_kw': last_kw,
        'total_weeks': total_weeks,
        'ytd_total': ytd_total,
        'weeks_done': weeks_done,
        'weeks_remaining': weeks_remaining,
        'avg_overall': avg_overall,
        'avg_recent': avg_recent,
        'forecast_rest': forecast_rest,
        'forecast_total': forecast_total,
        'forecast_recent': forecast_recent,
        'as_of': generated_at.strftime('%Y-%m-%d'),
    }


def compute_insights(parsed, year_summary, current_year):
    insights = []
    if not parsed:
        insights.append('Keine WochenStat-Daten vorhanden.')
        return insights

    all_time_best = max(parsed, key=lambda item: item[2])
    insights.append(
        f'Stärkste Woche gesamt: {all_time_best[0]} KW {all_time_best[1]:02d} '
        f'({all_time_best[2]} GA)'
    )

    if current_year in year_summary:
        cur = year_summary[current_year]
        insights.append(
            f'{current_year}: {cur["total"]} GA in {cur["weeks"]} Wochen '
            f'(Ø {cur["avg"]}/Woche) — stärkste KW {cur["strongest_kw"]:02d} '
            f'({cur["strongest_val"]}), schwächste KW {cur["weakest_kw"]:02d} '
            f'({cur["weakest_val"]})'
        )

        prev = year_summary.get(current_year - 1)
        if prev and prev['weeks']:
            comparable = [
                (kw, a) for year, kw, a in parsed if year == current_year - 1
            ]
            prev_ytd_weeks = {kw for kw, _ in comparable if kw <= cur['weeks']}
            if prev_ytd_weeks:
                prev_ytd_total = sum(
                    a for year, kw, a in parsed
                    if year == current_year - 1 and kw <= max(k for k in prev_ytd_weeks)
                )
                ytd_delta = yoy_delta(cur['total'], prev_ytd_total)
                if ytd_delta is not None:
                    direction = 'über' if ytd_delta >= 0 else 'unter'
                    insights.append(
                        f'YTD vs. {current_year - 1}: {abs(ytd_delta):.1f}% {direction} '
                        f'Vorjahresstand ({cur["total"]} vs. {prev_ytd_total} bis KW '
                        f'{max(k for k in prev_ytd_weeks):02d})'
                    )

    prev_full = year_summary.get(current_year - 1)
    cur_partial = year_summary.get(current_year)
    if prev_full and cur_partial and prev_full['avg']:
        pace_delta = yoy_delta(cur_partial['avg'], prev_full['avg'])
        if pace_delta is not None:
            insights.append(
                f'Tempo {current_year}: Ø {cur_partial["avg"]}/Woche vs. '
                f'{prev_full["avg"]}/Woche im Gesamtjahr {current_year - 1} '
                f'({pace_delta:+.1f}%)'
            )

    by_kw, years = kw_profile(parsed)
    if len(years) >= 2 and current_year in years:
        last_year = current_year - 1
        if last_year in years:
            gains = []
            for kw in sorted(by_kw):
                cur_val = by_kw[kw].get(current_year)
                prev_val = by_kw[kw].get(last_year)
                if cur_val is not None and prev_val:
                    gains.append((kw, cur_val - prev_val))
            if gains:
                best_gain = max(gains, key=lambda item: item[1])
                worst_gain = min(gains, key=lambda item: item[1])
                insights.append(
                    f'Größter KW-Zuwachs vs. {last_year}: KW {best_gain[0]:02d} '
                    f'({best_gain[1]:+d} GA)'
                )
                if worst_gain[1] < 0:
                    insights.append(
                        f'Größter KW-Rückgang vs. {last_year}: KW {worst_gain[0]:02d} '
                        f'({worst_gain[1]:+d} GA)'
                    )

    return insights


def build_sheet_values(parsed, *, generated_at=None, jahressummen=None):
    generated_at = generated_at or datetime.now()
    current_year = generated_at.year
    year_summary = year_stats(parsed, jahressummen, generated_at=generated_at)

    values = []
    values.append([
        'WochenStat Auswertung',
        '',
        '',
        'Aktualisiert',
        generated_at.strftime('%Y-%m-%d %H:%M'),
    ])
    values.append([])
    values.append(['Quellen', WOCHEN_STAT_TAB, WOCHEN_STAT_ARCHIV_TAB, '', ''])
    values.append([])

    # --- KPI overview ---
    values.append(section_title('Kennzahlen'))
    kpi_header = ['Jahr', 'Wochen', 'Summe', 'Ø/Woche', 'Median', 'Min', 'Max',
                  'Stärkste KW', 'Schwächste KW', 'YoY Summe %']
    values.append(kpi_header)

    years_sorted = sorted(year_summary)
    kpi_start = len(values)
    for i, year in enumerate(years_sorted):
        s = year_summary[year]
        prev_total = year_summary[years_sorted[i - 1]]['total'] if i > 0 else None
        complete = year_is_complete(parsed, year, generated_at=generated_at)
        yoy = yoy_delta(s['total'], prev_total) if prev_total and complete else None
        values.append([
            str(year),
            str(s['weeks']),
            str(s['total']),
            str(s['avg']),
            str(s['median']),
            str(s['min']),
            str(s['max']),
            f'KW {s["strongest_kw"]:02d} ({s["strongest_val"]})',
            f'KW {s["weakest_kw"]:02d} ({s["weakest_val"]})',
            f'{yoy:+.1f}%' if yoy is not None else '—',
        ])
    values.append([])

    # --- KW profile (last 6 years or all) ---
    profile_header_row = None
    profile_data_start = None
    profile_section_row = None
    profile_avg_col = None
    profile_highlights = []
    by_kw, profile_years = kw_profile(parsed)
    if by_kw and profile_years:
        display_years = profile_years[-6:] if len(profile_years) > 6 else profile_years
        profile_avg_col = 1 + len(display_years)
        values.append(section_title('KW-Vergleich über Jahre'))
        profile_section_row = len(values)
        profile_header = ['KW'] + [str(y) for y in display_years] + ['Ø']
        while len(profile_header) < SECTION_COLS:
            profile_header.append('')
        profile_header = profile_header[:SECTION_COLS]
        values.append(profile_header)
        profile_header_row = len(values)
        profile_data_start = profile_header_row + 1

        for kw in sorted(by_kw):
            year_vals = [by_kw[kw].get(y, '') for y in display_years]
            present = [v for v in year_vals if v != '']
            avg = round(sum(present) / len(present), 1) if present else ''
            values.append([str(kw)] + [str(v) if v != '' else '—' for v in year_vals]
                          + [str(avg) if avg != '' else '—'])
        if current_year in display_years:
            profile_highlights = kw_profile_year_extremes(
                by_kw, current_year, profile_data_start, display_years)
        values.append([])

    # --- Jahresend-Prognose ---
    prognosis_section_row = None
    prognosis_header_row = None
    prognosis_highlight_row = None
    forecast = compute_year_forecast(
        parsed, year_summary, current_year, generated_at=generated_at)
    if forecast and forecast['complete']:
        values.append(section_title(f'Prognose Jahresende {current_year}'))
        prognosis_section_row = len(values)
        values.append(prog_row('Kennzahl', 'Wert', 'Erläuterung'))
        prognosis_header_row = len(values)
        values.append(prog_row(
            'Status',
            'Jahr abgeschlossen',
            f'{forecast["total_weeks"]} Kalenderwochen erfasst',
        ))
        values.append(prog_row(
            'Jahressumme',
            forecast['ytd_total'],
            'Ist-Wert aus allen Wochen',
        ))
        values.append([])

    # --- Insights ---
    insights_section_row = len(values) + 1
    values.append(section_title('Erkenntnisse'))
    insights_data_start = len(values) + 1
    insight_lines = compute_insights(parsed, year_summary, current_year)
    for line in insight_lines:
        values.append([line] + [''] * (SECTION_COLS - 1))
    values.append([])

    meta = {
        'current_year': current_year,
        'kpi_header_row': kpi_start,
        'kpi_data_start': kpi_start,
        'kpi_rows': len(years_sorted),
        'profile_section_row': profile_section_row if by_kw else None,
        'profile_header_row': profile_header_row,
        'profile_data_start': profile_data_start,
        'profile_rows': len(by_kw) if by_kw else 0,
        'profile_avg_col': profile_avg_col,
        'profile_highlights': profile_highlights,
        'prognosis_section_row': prognosis_section_row,
        'prognosis_header_row': prognosis_header_row,
        'prognosis_highlight_row': prognosis_highlight_row,
        'insights_section_row': insights_section_row,
        'insights_data_start': insights_data_start,
        'insights_rows': len(insight_lines),
        'total_rows': len(values),
    }
    return values, meta


def _get_auswertung_sheet(sheets_service):
    spreadsheet = sheets_service.spreadsheets().get(
        spreadsheetId=SPREADSHEET_ID,
        fields='sheets(properties.sheetId,properties.title,conditionalFormats,merges)',
    ).execute()
    for sheet in spreadsheet.get('sheets', []):
        if sheet['properties']['title'] == WOCHEN_STAT_AUSWERTUNG_TAB:
            return sheet
    return None


def _clear_sheet_layout(sheets_service, sheet_id):
    sheet = _get_auswertung_sheet(sheets_service)
    if not sheet:
        return
    requests = []
    for merge in sheet.get('merges', []) or []:
        requests.append({'unmergeCells': {'range': merge}})
    rule_count = len(sheet.get('conditionalFormats', []) or [])
    for index in range(rule_count - 1, -1, -1):
        requests.append({
            'deleteConditionalFormatRule': {'sheetId': sheet_id, 'index': index},
        })
    if requests:
        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={'requests': requests},
        ).execute()


def _merge_row(sheet_id, row_index, start_col=0, end_col=SECTION_COLS):
    return {
        'mergeCells': {
            'range': {
                'sheetId': sheet_id,
                'startRowIndex': row_index,
                'endRowIndex': row_index + 1,
                'startColumnIndex': start_col,
                'endColumnIndex': end_col,
            },
            'mergeType': 'MERGE_ALL',
        }
    }


def format_auswertung_tab(sheets_service, total_rows, meta):
    sheet_id = get_sheet_id(sheets_service, WOCHEN_STAT_AUSWERTUNG_TAB)
    if sheet_id is None or total_rows < 2:
        return

    _clear_sheet_layout(sheets_service, sheet_id)

    current_year = meta.get('current_year', datetime.now().year)
    kpi_header_row = meta['kpi_header_row']
    kpi_data_start = meta['kpi_data_start']
    kpi_data_end = kpi_data_start + meta['kpi_rows']

    requests = [
        {
            'updateSheetProperties': {
                'properties': {
                    'sheetId': sheet_id,
                    'gridProperties': {'frozenRowCount': 1},
                },
                'fields': 'gridProperties.frozenRowCount',
            }
        },
        {
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': 0,
                    'endRowIndex': 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': 10,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_HEADER_BG),
                        'textFormat': {
                            'bold': True,
                            'fontSize': 14,
                            'foregroundColor': _color(*CLR_HEADER_FG),
                        },
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,textFormat)',
            }
        },
    ]

    section_rows = [
        (3, 'LEFT', CLR_SECTION_BG),
        (kpi_header_row - 1, 'LEFT', CLR_SECTION_BG),
        (meta.get('insights_section_row'), 'LEFT', CLR_SECTION_BG),
    ]
    for sheet_row, align, bg in section_rows:
        if not sheet_row or sheet_row < 1:
            continue
        row_index = sheet_row - 1
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': row_index,
                    'endRowIndex': row_index + 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': SECTION_COLS,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*bg),
                        'horizontalAlignment': align,
                        'textFormat': {
                            'bold': True,
                            'fontSize': 11,
                            'foregroundColor': _color(*CLR_SECTION_FG),
                        },
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)',
            }
        })

    merged_section_rows = [
        meta.get('profile_section_row'),
        meta.get('prognosis_section_row'),
    ]
    for sheet_row in merged_section_rows:
        if not sheet_row:
            continue
        row_index = sheet_row - 1
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': row_index,
                    'endRowIndex': row_index + 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': SECTION_COLS,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_TABLE_HEAD_BG),
                        'horizontalAlignment': 'CENTER',
                        'textFormat': {
                            'bold': True,
                            'fontSize': 11,
                            'foregroundColor': _color(*CLR_HEADER_FG),
                        },
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)',
            }
        })
        requests.append(_merge_row(sheet_id, row_index))

    requests.append(_merge_row(sheet_id, 0, start_col=0, end_col=3))

    header_rows = [
        kpi_header_row,
        meta.get('profile_header_row'),
    ]
    for sheet_row in header_rows:
        if not sheet_row:
            continue
        row_index = sheet_row - 1
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': row_index,
                    'endRowIndex': row_index + 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': 10,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_TABLE_HEAD_BG),
                        'horizontalAlignment': 'CENTER',
                        'textFormat': {
                            'bold': True,
                            'fontSize': 10,
                            'foregroundColor': _color(*CLR_HEADER_FG),
                        },
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)',
            }
        })

    if meta['kpi_rows']:
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': kpi_data_start,
                    'endRowIndex': kpi_data_end,
                    'startColumnIndex': 2,
                    'endColumnIndex': 7,
                },
                'cell': {
                    'userEnteredFormat': {
                        'horizontalAlignment': 'RIGHT',
                        'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0.0'},
                    }
                },
                'fields': 'userEnteredFormat(horizontalAlignment,numberFormat)',
            }
        })
        for i in range(meta['kpi_rows']):
            if i % 2 == 1:
                requests.append({
                    'repeatCell': {
                        'range': {
                            'sheetId': sheet_id,
                            'startRowIndex': kpi_data_start + i,
                            'endRowIndex': kpi_data_start + i + 1,
                            'startColumnIndex': 0,
                            'endColumnIndex': 10,
                        },
                        'cell': {
                            'userEnteredFormat': {
                                'backgroundColor': _color(*CLR_ZEBRA),
                            }
                        },
                        'fields': 'userEnteredFormat.backgroundColor',
                    }
                })

    prognosis_header_row = meta.get('prognosis_header_row')
    insights_section_row = meta.get('insights_section_row')
    if prognosis_header_row and insights_section_row:
        prog_header_idx = prognosis_header_row - 1
        prog_data_end_idx = insights_section_row - 3
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': prog_header_idx,
                    'endRowIndex': prog_header_idx + 1,
                    'startColumnIndex': PROG_COL_VALUE,
                    'endColumnIndex': PROG_COL_VALUE + 1,
                },
                'cell': {
                    'userEnteredFormat': {
                        'horizontalAlignment': 'RIGHT',
                        'textFormat': {'bold': True, 'fontSize': 11},
                    }
                },
                'fields': 'userEnteredFormat(horizontalAlignment,textFormat)',
            }
        })
        if prog_data_end_idx > prognosis_header_row:
            requests.append({
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': prognosis_header_row,
                        'endRowIndex': prog_data_end_idx,
                        'startColumnIndex': PROG_COL_VALUE,
                        'endColumnIndex': PROG_COL_VALUE + 1,
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'horizontalAlignment': 'LEFT',
                            'textFormat': {'bold': True, 'fontSize': 11},
                        }
                    },
                    'fields': 'userEnteredFormat(horizontalAlignment,textFormat)',
                }
            })
        highlight_row = meta.get('prognosis_highlight_row')
        if highlight_row:
            row_idx = highlight_row - 1
            for start_col, end_col in (
                (PROG_COL_LABEL, PROG_COL_LABEL + 1),
                (PROG_COL_VALUE, PROG_COL_VALUE + 1),
                (PROG_COL_EXPLAIN, PROG_COL_EXPLAIN + 1),
            ):
                requests.append({
                    'repeatCell': {
                        'range': {
                            'sheetId': sheet_id,
                            'startRowIndex': row_idx,
                            'endRowIndex': row_idx + 1,
                            'startColumnIndex': start_col,
                            'endColumnIndex': end_col,
                        },
                        'cell': {
                            'userEnteredFormat': {
                                'backgroundColor': _color(*CLR_CURRENT_YEAR),
                                'textFormat': {
                                    'bold': True,
                                    'fontSize': 11,
                                    'foregroundColor': _color(*CLR_SECTION_FG),
                                },
                            }
                        },
                        'fields': 'userEnteredFormat(backgroundColor,textFormat)',
                    }
                })

    profile_data_start = meta.get('profile_data_start')
    profile_rows = meta.get('profile_rows', 0)
    profile_avg_col = meta.get('profile_avg_col')
    if profile_data_start and profile_rows and profile_avg_col:
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': profile_data_start - 1,
                    'endRowIndex': profile_data_start - 1 + profile_rows,
                    'startColumnIndex': 1,
                    'endColumnIndex': profile_avg_col + 1,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(1, 1, 1),
                        'textFormat': {
                            'bold': False,
                            'foregroundColor': _color(0, 0, 0),
                        },
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,textFormat)',
            }
        })
        for hl in meta.get('profile_highlights', []):
            if hl['kind'] == 'above':
                bg, fg = CLR_POSITIVE, CLR_POSITIVE_FG
            else:
                bg, fg = CLR_NEGATIVE, CLR_NEGATIVE_FG
            requests.append({
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': hl['row'] - 1,
                        'endRowIndex': hl['row'],
                        'startColumnIndex': hl['col'],
                        'endColumnIndex': hl['col'] + 1,
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': _color(*bg),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': _color(*fg),
                            },
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat)',
                }
            })

    insights_data_start = meta.get('insights_data_start')
    insights_rows = meta.get('insights_rows', 0)
    if insights_section_row:
        requests.append(_merge_row(sheet_id, insights_section_row - 1))
    if insights_data_start and insights_rows:
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': insights_data_start - 1,
                    'endRowIndex': insights_data_start - 1 + insights_rows,
                    'startColumnIndex': 0,
                    'endColumnIndex': SECTION_COLS,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_INSIGHT_BG),
                        'wrapStrategy': 'WRAP',
                        'horizontalAlignment': 'LEFT',
                        'verticalAlignment': 'TOP',
                        'textFormat': {'fontSize': 10},
                    }
                },
                'fields': (
                    'userEnteredFormat(backgroundColor,wrapStrategy,'
                    'horizontalAlignment,verticalAlignment,textFormat)'
                ),
            }
        })
        for i in range(insights_rows):
            requests.append(_merge_row(sheet_id, insights_data_start - 1 + i))

    col_widths = [
        (72, 0, 1), (56, 1, 2), (72, 2, 3), (64, 3, 4), (64, 4, 5),
        (64, 5, 6), (64, 6, 7), (110, 7, 8), (110, 8, 9), (80, 9, 10),
        (120, 10, 15),
    ]
    for width, start, end in col_widths:
        requests.append({
            'updateDimensionProperties': {
                'range': {
                    'sheetId': sheet_id,
                    'dimension': 'COLUMNS',
                    'startIndex': start,
                    'endIndex': end,
                },
                'properties': {'pixelSize': width},
                'fields': 'pixelSize',
            }
        })

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={'requests': requests},
    ).execute()

    cf_requests = []

    if meta['kpi_rows']:
        kpi_range = {
            'sheetId': sheet_id,
            'startRowIndex': kpi_data_start,
            'endRowIndex': kpi_data_end,
            'startColumnIndex': 0,
            'endColumnIndex': 10,
        }
        cf_requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [kpi_range],
                    'booleanRule': {
                        'condition': {
                            'type': 'CUSTOM_FORMULA',
                            'values': [{
                                'userEnteredValue': (
                                    f'=INDIRECT("A"&ROW())="{current_year}"'
                                ),
                            }],
                        },
                        'format': {
                            'backgroundColor': _color(*CLR_CURRENT_YEAR),
                            'textFormat': {'bold': True},
                        },
                    },
                },
                'index': 0,
            }
        })
        yoy_range = {
            'sheetId': sheet_id,
            'startRowIndex': kpi_data_start,
            'endRowIndex': kpi_data_end,
            'startColumnIndex': 9,
            'endColumnIndex': 10,
        }
        cf_requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [yoy_range],
                    'booleanRule': {
                        'condition': {
                            'type': 'TEXT_CONTAINS',
                            'values': [{'userEnteredValue': '+'}],
                        },
                        'format': {
                            'backgroundColor': _color(*CLR_POSITIVE),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': _color(*CLR_POSITIVE_FG),
                            },
                        },
                    },
                },
                'index': 0,
            }
        })
        cf_requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [yoy_range],
                    'booleanRule': {
                        'condition': {
                            'type': 'TEXT_CONTAINS',
                            'values': [{'userEnteredValue': '-%'}],
                        },
                        'format': {
                            'backgroundColor': _color(*CLR_NEGATIVE),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': _color(*CLR_NEGATIVE_FG),
                            },
                        },
                    },
                },
                'index': 0,
            }
        })

    prognosis_header_row = meta.get('prognosis_header_row')
    insights_section_row = meta.get('insights_section_row')
    if prognosis_header_row and insights_section_row:
        prog_value_range = {
            'sheetId': sheet_id,
            'startRowIndex': prognosis_header_row,
            'endRowIndex': insights_section_row - 3,
            'startColumnIndex': PROG_COL_VALUE,
            'endColumnIndex': PROG_COL_VALUE + 1,
        }
        cf_requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [prog_value_range],
                    'booleanRule': {
                        'condition': {
                            'type': 'TEXT_CONTAINS',
                            'values': [{'userEnteredValue': '+'}],
                        },
                        'format': {
                            'backgroundColor': _color(*CLR_POSITIVE),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': _color(*CLR_POSITIVE_FG),
                            },
                        },
                    },
                },
                'index': 0,
            }
        })
        cf_requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [prog_value_range],
                    'booleanRule': {
                        'condition': {
                            'type': 'TEXT_CONTAINS',
                            'values': [{'userEnteredValue': '-%'}],
                        },
                        'format': {
                            'backgroundColor': _color(*CLR_NEGATIVE),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': _color(*CLR_NEGATIVE_FG),
                            },
                        },
                    },
                },
                'index': 0,
            }
        })

    if cf_requests:
        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={'requests': cf_requests},
        ).execute()


def update_wochenstat_auswertung(sheets_service):
    """Recompute analytics from WochenStat tabs (read-only) and write Auswertung tab."""
    rows = read_all_wochenstat(sheets_service)
    jahressummen = read_jahressummen(sheets_service)
    parsed = parse_wochen_rows(rows)
    values, meta = build_sheet_values(parsed, jahressummen=jahressummen)

    ensure_tab(sheets_service, WOCHEN_STAT_AUSWERTUNG_TAB, ['WochenStat Auswertung'])
    sheets_service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f'{WOCHEN_STAT_AUSWERTUNG_TAB}!A:Z',
    ).execute()
    sheets_service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f'{WOCHEN_STAT_AUSWERTUNG_TAB}!A1',
        valueInputOption='RAW',
        body={'values': values},
    ).execute()
    format_auswertung_tab(sheets_service, meta['total_rows'], meta)
    return len(parsed)


def main():
    import sys
    from os import path
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from import_gutachten_to_sheet import SERVICE_ACCOUNT_FILE, SCOPES

    if not path.exists(SERVICE_ACCOUNT_FILE):
        print(f'❌ Service-Account-Datei nicht gefunden: {SERVICE_ACCOUNT_FILE}', file=sys.stderr)
        return 1

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    sheets_service = build('sheets', 'v4', credentials=creds)
    weeks = update_wochenstat_auswertung(sheets_service)
    print(f'✅ {weeks} KW in Tab "{WOCHEN_STAT_AUSWERTUNG_TAB}" ausgewertet.')
    return 0


if __name__ == '__main__':
    import sys
    raise SystemExit(main())
