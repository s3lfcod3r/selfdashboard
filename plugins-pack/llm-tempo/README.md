# LLM-Tempo

Zeigt, wie schnell deine lokalen Sprachmodelle arbeiten – gemessen vom
llama.cpp-Server selbst, nicht geschätzt.

- **schreiben**: Token pro Sekunde der letzten Antwort (vor der ersten Antwort: Schnitt seit Serverstart)
- **lesen**: Tempo beim Einlesen des Prompts
- **MTP**: Anteil der angenommenen Vorschläge bei MTP/Spekulativ-Decoding
- grün = arbeitet gerade, blau = bereit, grau = aus

## Voraussetzung

Der `llama-server` muss mit `--metrics` laufen. Ohne den Schalter zeigt die
Kachel „läuft ohne --metrics“.

## Einstellungen

Je Zeile ein Server als `Name=URL`, zum Beispiel:

```
GPU-Server=http://192.168.1.x:8080
Laptop=http://192.168.1.y:8081
```

Die Adresse ist die Basis des Servers (ein angehängtes `/v1` wird entfernt).
