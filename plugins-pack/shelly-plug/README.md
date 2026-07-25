# Shelly Plug

Einzelne Steckdosen mit **Shelly Plug PM Gen3 / Plug S Gen3** (und anderen
Gen2+ Steckdosen) überwachen **und schalten** — direkt über die lokale RPC-API,
ohne Cloud, ohne API-Key.

## Was es zeigt

- **Momentanleistung** (W), Spannung, Strom und Geräte-Temperatur.
- **An/Aus-Schalter** direkt in der Kachel (optional abschaltbar).
- Optionaler **kWh-Verlauf**: heute, 7 Tage, 30 Tage.

## Einrichtung

1. Shelly Plug ins WLAN bringen und die **IP-Adresse** notieren.
2. Widget hinzufügen → Einstellungen → Steckdose(n) mit **Name + IP** eintragen.
3. Nur falls am Gerät die **Authentifizierung** aktiv ist: Passwort eintragen
   (Benutzer ist bei Shelly immer `admin`). Sonst leer lassen.
4. „Schalten erlauben" und „Verlauf speichern" nach Wunsch.

> **LAN-Zugriff:** Der SelfDashboard-Server ruft das Gerät direkt im Heimnetz
> auf. Dazu muss am Container `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` gesetzt sein,
> sonst meldet das Widget „LAN blockiert (SSRF)".
>
> **Schalten** ist nur für angemeldete Dashboard-Nutzer möglich (jeder
> Plugin-Aufruf läuft über die Login-Prüfung des Hosts).

## Technik

- Status: `Switch.GetStatus?id=0` (`apower`, `voltage`, `current`,
  `aenergy.total`, `temperature.tC`, `output`).
- Schalten: `Switch.Set?id=0&on=true|false`.
- Verlauf: Zählerstands-Schnappschüsse im Daten-Volume; kWh je Zeitfenster =
  Summe positiver Deltas (zählerreset-fest).

---

# Shelly Plug (English)

Monitor **and switch** individual sockets with the **Shelly Plug PM Gen3 /
Plug S Gen3** (and other Gen2+ plugs) via the local RPC API — no cloud, no key.

**Shows:** live power (W), voltage, current, device temperature, an on/off
toggle (optional) and an optional kWh history (today / 7d / 30d).

**Setup:** add each plug by name + IP in settings; set a password only if the
device has authentication enabled (Shelly user is always `admin`). The container
needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` to reach LAN devices. Switching is
restricted to logged-in dashboard users.
