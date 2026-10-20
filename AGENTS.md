# AGENTS.md — selfdashboard

Kurze Orientierung fuer KI-Assistenten (Bonsai/Claude). **Diese Datei zuerst lesen, nicht die grosse README.**
Zum Finden: `rg -n "BEGRIFF"`. Fuer Symbole: Serena `get_symbols_overview`/`find_symbol`. Grosse Dateien nur zeilenweise (`sed -n`).

## Typ & Stack

- Node/JS-TS: `package.json` (react, next)
- Android-App: Quellcode in `_android-src/` (gitignored, nie pushen)

## Bauen / Testen / Starten

```bash
npm run dev   # next dev
npm run build   # next build
npm run test   # node node_modules/vitest/vitest.mjs run
npm run lint   # eslint .
npm run start   # next start
bash /mnt/user/appdata/android-build/apk-release.sh selfdashboard build   # APK bauen
bash /mnt/user/appdata/android-build/apk-release.sh selfdashboard         # komplettes Release
```

## Struktur (oberste Ebenen)

- `.github/` — CI/Workflows
- `_android-src/` — Android-Quellcode (lokal)
- `assets/`
- `docs/` — Dokumentation
- `node_modules/`
- `plugins-pack/`
- `public/` — statische Dateien
- `scripts/` — Skripte
- `src/` — Quellcode
- `unraid/`

---
*Automatisch erzeugt als Navigationshilfe. Bei Bedarf von Hand praeziser machen.*
