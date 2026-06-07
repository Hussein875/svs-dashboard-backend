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

# Dashboard-Farben (an SVS-Dashboard angelehnt)
CLR_HEADER_BG = (0.10, 0.14, 0.20)
CLR_HEADER_FG = (0.95, 0.97, 1.00)
CLR_SECTION_BG = (0.86, 0.91, 0.98)
CLR_SECTION_FG = (0.12, 0.23, 0.45)
CLR_TABLE_HEAD_BG = (0.12, 0.16, 0.22)
CLR_ZEBRA = (0.97, 0.98, 0.99)
CLR_CURRENT_YEAR = (0.88, 0.94, 1.00)
CLR_POSITIVE = (0.85, 0.95, 0.88)
CLR_POSITIVE_FG = (0.10, 0.40, 0.20)
CLR_NEGATIVE = (0.98, 0.88, 0.88)
CLR_NEGATIVE_FG = (0.55, 0.12, 0.12)
CLR_INSIGHT_BG = (1.00, 0.98, 0.90)


def _color(red, green, blue):
    return {'red': red, 'green': green, 'blue': blue}


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


def year_stats(parsed, jahressummen=None):
    jahressummen = jahressummen or {}
    by_year = defaultdict(list)
    for year, kw, anzahl in parsed:
        by_year[year].append((kw, anzahl))

    stats = {}
    for year in sorted(by_year):
        weeks = by_year[year]
        counts = [a for _, a in weeks]
        total = jahressummen.get(year, sum(counts))
        n = len(counts)
        strongest = max(weeks, key=lambda item: item[1])
        weakest = min(weeks, key=lambda item: item[1])
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

    forecast = compute_year_forecast(parsed, year_summary, current_year)
    if forecast and not forecast['complete']:
        prev = year_summary.get(current_year - 1)
        line = (
            f'Prognose {current_year}: ca. {forecast["forecast_total"]} GA '
            f'bis Jahresende (Ø {forecast["avg_overall"]}/Woche × '
            f'{forecast["weeks_remaining"]} verbleibende KW + {forecast["ytd_total"]} YTD)'
        )
        if prev:
            delta = yoy_delta(forecast['forecast_total'], prev['total'])
            if delta is not None:
                line += f' — ca. {delta:+.1f}% vs. {current_year - 1} Gesamt ({prev["total"]})'
        insights.append(line)

    return insights


def build_sheet_values(parsed, *, generated_at=None, jahressummen=None):
    generated_at = generated_at or datetime.now()
    current_year = generated_at.year
    year_summary = year_stats(parsed, jahressummen)

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
    values.append(['Kennzahlen', '', '', '', '', '', ''])
    kpi_header = ['Jahr', 'Wochen', 'Summe', 'Ø/Woche', 'Median', 'Min', 'Max',
                  'Stärkste KW', 'Schwächste KW', 'YoY Summe %']
    values.append(kpi_header)

    years_sorted = sorted(year_summary)
    kpi_start = len(values)
    for i, year in enumerate(years_sorted):
        s = year_summary[year]
        prev_total = year_summary[years_sorted[i - 1]]['total'] if i > 0 else None
        yoy = yoy_delta(s['total'], prev_total) if prev_total else None
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
    profile_start = None
    by_kw, profile_years = kw_profile(parsed)
    if by_kw and profile_years:
        display_years = profile_years[-6:] if len(profile_years) > 6 else profile_years
        values.append(['KW-Vergleich über Jahre', '', '', ''])
        profile_header = ['KW'] + [str(y) for y in display_years] + ['Ø']
        values.append(profile_header)
        profile_start = len(values)

        for kw in sorted(by_kw):
            year_vals = [by_kw[kw].get(y, '') for y in display_years]
            present = [v for v in year_vals if v != '']
            avg = round(sum(present) / len(present), 1) if present else ''
            values.append([str(kw)] + [str(v) if v != '' else '—' for v in year_vals]
                          + [str(avg) if avg != '' else '—'])
        values.append([])

    # --- Jahresend-Prognose ---
    prognosis_start = None
    prognosis_highlight_row = None
    forecast = compute_year_forecast(
        parsed, year_summary, current_year, generated_at=generated_at)
    if forecast:
        values.append([f'Prognose Jahresende {current_year}', '', '', ''])
        prognosis_start = len(values)
        values.append(['Kennzahl', 'Wert', 'Erläuterung', ''])

        if forecast['complete']:
            values.append([
                'Status',
                'Jahr abgeschlossen',
                f'{forecast["total_weeks"]} Kalenderwochen erfasst',
                '',
            ])
            values.append([
                'Jahressumme',
                str(forecast['ytd_total']),
                'Ist-Wert aus allen Wochen',
                '',
            ])
        else:
            prev = year_summary.get(current_year - 1)
            values.append([
                'Stand',
                f'bis KW {forecast["last_kw"]:02d} ({forecast["as_of"]})',
                f'{forecast["weeks_done"]} von {forecast["total_weeks"]} KW mit Daten',
                '',
            ])
            values.append([
                'Bisher (YTD)',
                str(forecast['ytd_total']),
                'Summe aller erfassten Wochen',
                '',
            ])
            values.append([
                'Ø pro Woche (gesamt)',
                str(forecast['avg_overall']),
                f'YTD ÷ {forecast["weeks_done"]} Wochen',
                '',
            ])
            values.append([
                'Ø pro Woche (letzte 12 KW)',
                str(forecast['avg_recent']),
                'Aktuelleres Tempo',
                '',
            ])
            values.append([
                'Verbleibende KW',
                str(forecast['weeks_remaining']),
                f'bis KW {forecast["total_weeks"]:02d}',
                '',
            ])
            values.append([
                'Erwartete Rest-GA (Ø gesamt)',
                str(forecast['forecast_rest']),
                f'{forecast["avg_overall"]} × {forecast["weeks_remaining"]} KW',
                '',
            ])
            prognosis_highlight_row = len(values) + 1
            values.append([
                'Prognose Jahresende',
                str(forecast['forecast_total']),
                'YTD + erwartete Rest-GA (lineare Hochrechnung)',
                '',
            ])
            values.append([
                'Prognose (12-Wochen-Tempo)',
                str(forecast['forecast_recent']),
                'YTD + Ø letzte 12 KW × Rest',
                '',
            ])
            if prev:
                delta = yoy_delta(forecast['forecast_total'], prev['total'])
                values.append([
                    f'vs. {current_year - 1} Gesamt',
                    f'{delta:+.1f}%' if delta is not None else '—',
                    f'Prognose {forecast["forecast_total"]} vs. Ist {prev["total"]} ({current_year - 1})',
                    '',
                ])
            values.append([
                'Hinweis',
                '',
                'Schätzung ohne Saisonkorrektur — Feiertage/Urlaub nicht berücksichtigt',
                '',
            ])
        values.append([])

    # --- Insights ---
    values.append(['Erkenntnisse', '', ''])
    insights_start = len(values)
    for line in compute_insights(parsed, year_summary, current_year):
        values.append([line])
    values.append([])

    meta = {
        'current_year': current_year,
        'kpi_start': kpi_start,
        'kpi_rows': len(years_sorted),
        'profile_start': profile_start,
        'profile_rows': len(by_kw) if by_kw else 0,
        'prognosis_start': prognosis_start,
        'prognosis_highlight_row': prognosis_highlight_row,
        'insights_start': insights_start,
        'insights_rows': len(compute_insights(parsed, year_summary, current_year)),
        'total_rows': len(values),
    }
    return values, meta


def _get_auswertung_sheet(sheets_service):
    spreadsheet = sheets_service.spreadsheets().get(
        spreadsheetId=SPREADSHEET_ID,
        fields='sheets(properties.sheetId,properties.title,conditionalFormats)',
    ).execute()
    for sheet in spreadsheet.get('sheets', []):
        if sheet['properties']['title'] == WOCHEN_STAT_AUSWERTUNG_TAB:
            return sheet
    return None


def _clear_conditional_formats(sheets_service, sheet_id):
    sheet = _get_auswertung_sheet(sheets_service)
    if not sheet:
        return
    rule_count = len(sheet.get('conditionalFormats', []) or [])
    if not rule_count:
        return
    requests = [
        {'deleteConditionalFormatRule': {'sheetId': sheet_id, 'index': index}}
        for index in range(rule_count - 1, -1, -1)
    ]
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={'requests': requests},
    ).execute()


def format_auswertung_tab(sheets_service, total_rows, meta):
    sheet_id = get_sheet_id(sheets_service, WOCHEN_STAT_AUSWERTUNG_TAB)
    if sheet_id is None or total_rows < 2:
        return

    _clear_conditional_formats(sheets_service, sheet_id)

    current_year = meta.get('current_year', datetime.now().year)
    kpi_data_start = meta['kpi_start']
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
        3,
        meta['kpi_start'] - 1,
        meta.get('profile_start') and meta['profile_start'] - 2,
        meta.get('prognosis_start') and meta['prognosis_start'] - 1,
        meta['insights_start'] - 1,
    ]
    for sheet_row in section_rows:
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
                    'endColumnIndex': 10,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_SECTION_BG),
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

    header_rows = [
        meta['kpi_start'],
        meta.get('profile_start'),
        meta.get('prognosis_start'),
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

    prognosis_start = meta.get('prognosis_start')
    if prognosis_start:
        prog_header = prognosis_start
        prog_data_end = meta['insights_start'] - 2
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': prog_header,
                    'endRowIndex': prog_data_end,
                    'startColumnIndex': 1,
                    'endColumnIndex': 2,
                },
                'cell': {
                    'userEnteredFormat': {
                        'horizontalAlignment': 'RIGHT',
                        'textFormat': {'bold': True, 'fontSize': 11},
                        'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'},
                    }
                },
                'fields': 'userEnteredFormat(horizontalAlignment,textFormat,numberFormat)',
            }
        })
        highlight_row = meta.get('prognosis_highlight_row')
        if highlight_row:
            row_idx = highlight_row - 1
            requests.append({
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': row_idx,
                        'endRowIndex': row_idx + 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 3,
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

    insights_start = meta['insights_start']
    insights_end = insights_start + meta.get('insights_rows', 0)
    if meta.get('insights_rows'):
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': insights_start,
                    'endRowIndex': insights_end,
                    'startColumnIndex': 0,
                    'endColumnIndex': 10,
                },
                'cell': {
                    'userEnteredFormat': {
                        'backgroundColor': _color(*CLR_INSIGHT_BG),
                        'wrapStrategy': 'WRAP',
                        'textFormat': {'fontSize': 10},
                    }
                },
                'fields': 'userEnteredFormat(backgroundColor,wrapStrategy,textFormat)',
            }
        })

    col_widths = [(72, 0, 1), (56, 1, 2), (72, 2, 3), (64, 3, 7), (110, 7, 9), (80, 9, 10)]
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
                            'values': [{'userEnteredValue': '-'}],
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
