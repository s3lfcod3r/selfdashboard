# Projektstatus

Zeigt auf einen Blick, wo jedes Projekt steht und wo Fragen an dich warten.
Gedacht für Projekte, an denen ein KI-Agent (z. B. OpenClaw) arbeitet und seinen
Stand in einer `STATUS.md` im Projektordner festhält.

- **Offene Fragen zuerst** – mit Zähler im Kopf der Kachel
- Aufgaben je Projekt: ⚠ wartet, ● in Arbeit, ✓ fertig (fertige optional)
- Update-Hinweise am unteren Rand, falls der Dienst welche liefert

## Voraussetzung

Ein kleiner Dienst, der die `STATUS.md`-Dateien liest und als JSON ausliefert
(`GET /status`). Seine Adresse trägst du in den Einstellungen der Kachel ein.

Erwartetes Format einer `STATUS.md`:

```markdown
## Aufgaben
- Login — in Arbeit: Passwort-Reset fehlt noch
- Export — wartet auf dich: CSV oder Excel?

## Offene Fragen
- CSV oder Excel?
```

Zusätzlich zählt jede Zeile mit dem Wartevermerk des Agenten (z. B. `WARTET AUF …`) als offene Frage.
