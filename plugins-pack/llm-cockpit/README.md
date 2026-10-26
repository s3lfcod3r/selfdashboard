# LLM-Cockpit

Token-Zähler, LLM-Tempo und Projektstatus in **einer** Kachel, von oben nach unten:

1. **Token-Zähler** – rein / raus / max. Kontext für heute (oder gestern / 7 Tage), darunter die Summe des laufenden Monats. Klick auf den Titel: Monatsauswahl und Tagesliste.
2. **LLM-Tempo** – Token pro Sekunde der llama.cpp-Server, standardmäßig nur `RTX2000`, mit kleinem Verlauf der letzten Messungen.
3. **Projektstatus** – Projekte aus den `STATUS.md`-Dateien mit Fortschrittsbalken, offenen Fragen zuerst, höchstens 5 Projekte (einstellbar).

## Einrichtung

Leere Felder übernimmt die Kachel aus vorhandenen `llm-token`-, `llm-tempo`- und `openclaw-status`-Kacheln. Wer die alten Kacheln schon eingerichtet hat, muss nichts neu eintragen.

| Einstellung | Beispiel |
|---|---|
| Token-Sammler | `http://192.168.1.x:8098/tokens` |
| llama.cpp-Server | `RTX2000=http://192.168.1.x:8080` (llama-server mit `--metrics`) |
| Nur Server | `RTX2000` (Komma-getrennt, leer = alle) |
| Projektstatus | `http://192.168.1.x:8097/status` |

Private LAN-Adressen brauchen `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1`.

Ist ein Dienst nicht erreichbar, bleiben die letzten Daten stehen und die Kachel nennt den Host, der fehlt. Der letzte Stand wird auf dem Dashboard-Server gemerkt (`data/plugins/llm-cockpit/letzter-stand.json`) und ist damit in jedem Browser und auch nach Neuladen oder Neustart noch da; ein ausgeschalteter llama.cpp-Server (z. B. die RTX2000) bekommt ein graues **offline**-Schild und zeigt seine letzten Werte mit „zuletzt vor …“.
