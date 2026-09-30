# STATUS

## Stand
- Repo: `s3lfcod3r/selfdashboard` (GitHub, Branch `main`).
- Letzte Änderung: Befunde 1–2 behoben und gepushen (commit `205d18c`, 2026-09-30).

## Aufgaben
- Befund 1 — fertig: `PluginStoreModal.tsx` `existingPlugins` in `useMemo(..., [activeDashboard])` stabilisiert → `react-hooks/exhaustive-deps` weg.
- Befund 2 — fertig: ungenutztes `eslint-disable` in `postcss-legacy-compat.js` entfernt.
- Befund 3 (npm audit) — offen: 21 Schwachstellen (1 critical, 11 high, 5 moderate, 4 low). **Runtime-Risiko minimal**: critical Next.js-Server-Actions greift nicht (0 Server-Actions); axios nur im Build-`external` und nirgendwo importiert; hohe Dev-Abhängigkeiten (brace-expansion, browserslist) nur im Build. Auf Wunsch: gezieltes Bumpen.

## Offene Fragen
- **Fork / lokale Kopie:** Die lokale Arbeitskopie hatte ungeschobene Änderungen (`esbuild` in dependencies, `android/`, `plugin-pack/`, `netzwacht`, `privacy.html`), die im GitHub-Repo fehlen. Sie ist gesichert als `selfdashboard.bak-20260930_164718` (im Projektordner). Wie damit umgehen: Änderungen in den Repo-Zweig übernehmen (Merge/Rebase) oder verwerfen?
- Repo-lokale Git-Identität: `s3lfcod3r <s3lfcod3r@example.com>` (nur für lokale Commits).

## Gelernt
- GitHubTool arbeitet auf `/repos/<name>` = `<share>/<name>`; der Klon muss unter dem exakten Repo-Namen liegen.
- `diffpruefen`/`gitpush` aus dem GitHubTool-Container; Push nur fast-forward.
