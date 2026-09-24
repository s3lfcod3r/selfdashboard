# Token-Zähler

Zeigt, wie viele Token dein KI-Agent verbraucht – Eingang und Ausgang, heute,
gestern oder über sieben Tage, aufgeschlüsselt nach Agent und Modell.

## Voraussetzung

Ein kleiner Sammel-Dienst, der die Zähler des Agenten regelmäßig abfragt und
fortschreibt (die Zähler selbst beginnen nach jedem Neustart wieder bei null).
Er liefert `GET /tokens` als JSON. Seine Adresse trägst du in den Einstellungen
der Kachel ein, zum Beispiel `http://192.168.1.x:8098/tokens`.

Erwartetes Format:

```json
{
  "heute":  { "gesamt": { "ein": 0, "aus": 0, "cache_gelesen": 0, "cache_geschrieben": 0 },
              "agenten": { "<name>": { "ein": 0, "aus": 0 } },
              "modelle": { "<name>": { "ein": 0, "aus": 0 } } },
  "gestern": { "…" },
  "woche":   { "…" }
}
```

Der Zugangsschlüssel für den Agenten bleibt beim Sammel-Dienst und kommt nie in
den Browser.
