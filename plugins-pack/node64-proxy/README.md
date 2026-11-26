# Node64 Reverse-Proxy

🇩🇪 PROXY64 aus Node64 (ipv64.net): Proxy-Hosts mit Erreichbarkeit, Anfragen, Sperren und Restlaufzeit der Zertifikate, Verlauf der letzten 24 Stunden. Ersatz für das Zoraxy-Widget.

🇬🇧 PROXY64 from Node64 (ipv64.net): proxy hosts with reachability, requests, blocks and certificate lifetime, plus the last 24 hours.

## Einrichtung / Setup

1. 🇩🇪 In Node64 einen Benutzer mit der Rolle **Nur lesen** anlegen und unter **API** einen Schlüssel erzeugen (`node64_…`).
   🇬🇧 In Node64, create a user with the **Read only** role and generate a key under **API** (`node64_…`).
2. 🇩🇪 Im Widget **Node64-Adresse** (z. B. `http://192.168.1.20:8080`) und **API-Schlüssel** eintragen.
   🇬🇧 In the widget, enter the **Node64 address** (e.g. `http://192.168.1.20:8080`) and the **API key**.
3. 🇩🇪 Läuft Node64 im Heimnetz, muss der SelfDashboard-Container `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` haben.
   🇬🇧 If Node64 runs on your LAN, the SelfDashboard container needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1`.

🇩🇪 Die Abfrage läuft serverseitig über `/api/plugins/node64-proxy`; der Schlüssel erscheint nicht im Browser-Netzwerkverkehr zu Node64.
🇬🇧 Requests run server-side via `/api/plugins/node64-proxy`; the key is not exposed in browser traffic to Node64.
