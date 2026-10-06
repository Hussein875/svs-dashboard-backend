# Gutachten-Bot: feste Arbeitsschritte

Jeder Lauf folgt dieser Datei. Ein Schritt, der im Zustandsspeicher als erledigt steht, wird übersprungen. Unklare oder unleserliche Werte werden nicht geschätzt und nicht ergänzt. Das Feld bleibt leer, der Report nennt nur den Feldnamen und den Grund.

## Pflichtfelder

Vor der Eingabe in UltraExpert muss die Akte gegen diese Liste geprüft sein.

- Fahrzeugschein, lesbar
- Kennzeichen, lesbar
- Kilometerstand, lesbar
- Schadenfotos aus allen vier Perspektiven: vorne links, vorne rechts, hinten rechts, hinten links
- Vorschäden-Angabe, auch wenn sie „Keine“ lautet
- Auftraggeberdaten: Anrede, Name, Straße, PLZ, Ort

Fehlt ein Feld oder ist es unleserlich, startet die Eingabe nicht. Der Stand wird `wartet_auf_eingabe`.

## Zustand

Je Vorgangsnummer, in dieser Reihenfolge: `eingelesen`, `geprueft`, `eingetippt`, `abgeschlossen`. Dazu `wartet_auf_eingabe`, wenn die Pflichtfelder nicht erfüllt sind.

## Reihenfolge vs. UltraExpert-Menü

Phase 2 folgt der **linken Menüleiste** in UltraExpert: **Auftrag → Beteiligte → Besichtigungen → Fahrzeug** und danach Bereifung usw.

Der Reiter **Auftrag** wird ausgefüllt: Kennzeichen, Kennzeichen des Unfallgegners mit Z@Online, Fahrzeugidentifikationsnummer, Schadentag, Schadennummer, Versicherungsnummer, Schadenort, Straße und Sachverständiger aus der Klammer im Ordnernamen. Erteilung ist immer telefonisch, Erteilt durch immer den Auftraggeber. Aktenzeichen und Weitere Sachbearbeiter bleiben unangetastet. Die Zuweisung läuft über **Zuweisen** im Dashboard.

## Mit KI bearbeiten (Dashboard → assign-service)

Der Knopf liefert Aktenzeichen und Drive-Ordner-ID. Keine PIN, keine lokale Bot-Seite.

**Phase 1 läuft beim Klick mit**, bevor in UltraExpert etwas gespeichert wird. Phase 1 schreibt nichts in UltraExpert.

1. `dokumente-lesen` und `fotos-auswerten` — der Klick liest BD, Abtretung und die Fotos im Drive-Ordner selbst. Videos und der Ordner Fotos 2 bleiben draußen. JSON-Dateien nur, wenn keine Dokumente im Ordner liegen.
2. `pflichtfelder-pruefen` — Fahrzeugschein, Kennzeichen, Kilometerstand, vier Übersichten, Vorschäden, Auftraggeber (Liste oben). Fehlt etwas → Lauf bricht ab, **kein Tippen** in UX.
3. `report-schreiben` — merkt sich nur, dass die Prüfung durch ist. Das Google Doc „Aktennummer Report“ entsteht dabei **nicht**.

Erst wenn Phase 1 durch ist, startet **Phase 2**. Der KI-Lauf tippt zuerst Auftrag, danach Beteiligte, Besichtigung, Fahrzeug, Bereifung, Vor Ort, Vorschäden und Schadenfeststellung. Lichtbilder und Dokumentenimport bleiben offen, wenn dafür noch kein Klickpfad da ist.

Sind 1 und 2 erledigt, ist der Stand `eingelesen`. Ist 3 erfolgreich, ist der Stand `geprueft`.

## Phase 1, Analyse (vollständig, später)

Diese Schritte dürfen später für mehrere Akten parallel laufen. Sie schreiben nichts in UltraExpert.

1. `dokumente-lesen` — BD, Fahrzeugschein, Abtretung, Vollmacht lesen (Ziel: nicht nur JSON, sondern echte Dokumentenlesung).
2. `fotos-auswerten` — Lichtbilder und Fotos 2 sichten. Aufnahmen über 10 MB nicht über den Chat-Download holen. Über `GUTACHTEN_DRIVE_CREDENTIALS` laden und mit `src/drive-foto.js` verkleinern, den Titel aus der Vorschau lesen. Videos ignorieren.
3. `pflichtfelder-pruefen` — Liste oben. Nur bei vollständigem Datensatz erledigt.
4. `report-schreiben` — was übernommen wurde, was fehlt, welche Felder leer bleiben.

## Phase 2, Eingabe

Streng eine Akte nach der anderen. Nur mit einem Datensatz, dessen Pflichtprüfung erledigt ist.

5. `auftrag` — Kennzeichen, Unfallgegner-Kennzeichen mit Z@Online, Fahrzeugidentifikationsnummer, Schadentag, Schadennummer, Versicherungsnummer, Schadenort, Straße, Sachverständiger. Erteilung immer telefonisch, Erteilt durch immer den Auftraggeber. Aktenzeichen nicht ändern.
6. `beteiligte` — Liegt eine Vollmacht im Drive-Ordner, den Kanzleinamen daraus lesen und als Anwalt mit Anrede „Firma“ eintragen. Ohne Vollmacht keinen Anwalt. Auftraggeber Anrede „Herr“, außer es steht etwas anderes da oder der Name ist bekannt weiblich. Name aus der Abtretung. Weicht der Name auf dem Fahrzeugschein ab, wird er Fahrzeughalter. Stimmen die Namen überein, gibt es keinen zusätzlichen Fahrzeughalter. Kennzeichen: Schein und Bilder gelten, wenn die Abtretung davon abweicht. Die Versicherung nicht als Name abtippen.
7. `besichtigung` — In UltraExpert ggf. zuerst **„+ Neue Besichtigung“**, dann Adresse des Auftraggebers, Ort/Firma leer. Sachverständiger aus der Klammer im Drive-Ordner: `(HU)` Hussein Souleiman, `(H)` oder `(HJ)` Hussein Jaber, `(B)` Hussein Selman, `(OS)` Osama Sleiman, `(HK)` Hassan Khodr.
8. `fahrzeug` — Fahrzeug über die FIN identifizieren, nicht über HSN/TSN. Variante nach FIN, Erstzulassung und Getriebe. Nächste HU von der Plakette am Kennzeichen oder von der BD, nicht aus dem abgelaufenen Stempel im Schein. Getriebe am Wählhebel prüfen, wenn der Schein es nicht hergibt.
9. `bereifung` — Profiltiefe, Hersteller, Dimension, Felgen. Oberes Kreuz Stahl, unteres Aluminium. Fehlt das auf der BD, die Reifenfotos lesen und nur übernehmen, was auf Flanke, Messschieber oder Felge lesbar ist. Reifentyp, Modell und Bemerkung leer.
10. `vor-ort` — Bedingungen ausreichend, Hebebühne leer, Zustand unrepariert, Identifizierung FZ-Schein. Scheckheft nur bei Kreuz auf der BD, dann Fachwerkstatt. Probelauf Antrieb durchgeführt. Allgemeinzustand gepflegt, normale Gebrauchsspuren. Schilderung aus der BD. Polizei nur eintragen, wenn auf der BD angekreuzt. Plausibilität plausibel.
11. `vorschaeden` — „Keine“ nur dort entfernen, wo die BD einen Vorschaden nennt. Unfachgerecht bleibt „Keine“. Unter „Im Schadenbereich“ nur Bauteile, die der neue Anstoß wieder trifft. Dieselbe Seite reicht nicht. Die übrigen nicht reparierten Vorschäden nur unter „Nicht im Schadenbereich“. Kein Bauteil doppelt. Mehrschaden und Wertverbesserung nur, wenn etwas im Schadenbereich steht.
12. `schadenfeststellung` — Fahrbereitschaft nur verkehrssicher, nicht verkehrssicher oder nicht fahrbereit. Kein Kreuz auf der BD heißt verkehrssicher. Ein gesetztes Kreuz bleibt so. Airbag nur „Ja“, wenn BD oder Bilder eine Auslösung zeigen. Schadenbeschreibung aus den Triggern in `schaden-trigger.json`, ein Punkt pro Bauteil, letzter Punkt `div`. Skizze nur die auf der BD markierten Regionen.
13. `dokumente-import` — Abtretungserklärung über Importieren. Vollmacht nur, wenn sie im Ordner liegt. Verkehrsunfallanzeige, wenn vorhanden, als Unfallbericht. Videos ignorieren.
14. `lichtbilder` — Vier Übersichten, dann die Übersicht mit Geomaßstab, Bauteile, Kilometerstand, FIN, Fahrzeugschein, danach Vorschäden. Kleine Bauteile dürfen mit dem größeren Teil auf einem Bild liegen, wenn der Schaden klar zu sehen ist. Jedes Bodenbild bleibt ohne Titel. Das Bodenbild am Ende der Schadenaufnahme markiert die Vorschäden. Besichtigungsbilder dem Gutachten zuordnen. Fotos 2 nur nach Kundenbilder, nicht dem Gutachten zuordnen. Videos ignorieren.

Sind die Eingabe-Schritte erledigt, ist der Stand `eingetippt`.

## Abschluss

15. `abschluss` — Report als Google Doc im Drive-Ordner der Akte, Name „Aktennummer Report“. Stand danach `abgeschlossen`.
