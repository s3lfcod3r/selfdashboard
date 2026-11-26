# Node64 Angriffskarte

🇩🇪 Honeypot64 aus Node64 (ipv64.net): Weltkarte der Angriffe (Punkte oder Bögen), Top-Länder, letzte Zugriffe, gesperrte Adressen. Ersatz für CrowdSec-Widget und SelfThreatMap.

🇬🇧 Honeypot64 from Node64 (ipv64.net): world map of attacks (dots or arcs), top countries, recent hits and banned addresses.

## Einrichtung / Setup

1. 🇩🇪 In Node64 einen Benutzer mit der Rolle **Nur lesen** anlegen und unter **API** einen Schlüssel erzeugen (`node64_…`).
   🇬🇧 In Node64, create a user with the **Read only** role and generate a key under **API** (`node64_…`).
2. 🇩🇪 Im Widget **Node64-Adresse** (z. B. `http://192.168.1.20:8080`) und **API-Schlüssel** eintragen.
   🇬🇧 In the widget, enter the **Node64 address** (e.g. `http://192.168.1.20:8080`) and the **API key**.
3. 🇩🇪 Läuft Node64 im Heimnetz, muss der SelfDashboard-Container `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` haben.
   🇬🇧 If Node64 runs on your LAN, the SelfDashboard container needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1`.

🇩🇪 Die Abfrage läuft serverseitig über `/api/plugins/node64-map`; der Schlüssel erscheint nicht im Browser-Netzwerkverkehr zu Node64.
🇬🇧 Requests run server-side via `/api/plugins/node64-map`; the key is not exposed in browser traffic to Node64.

🇩🇪 Benutzernamen und Passwörter, die der Honeypot mitschreibt, gibt das Plugin bewusst nicht weiter.
🇬🇧 Usernames and passwords captured by the honeypot are deliberately never passed on.

🇩🇪 Weltkarte: Natural Earth (gemeinfrei).
🇬🇧 World map: Natural Earth (public domain).
