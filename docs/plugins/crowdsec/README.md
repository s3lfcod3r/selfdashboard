# Plugin: CrowdSec (`crowdsec`)

[← Plugin index](README.md) · [Main catalog](../../README.md#plugins)

## Deutsch

### Kurzbeschreibung

Optional: **Alerts/Bans** aus lokaler **`crowdsec.db`**, Zeitraumfilter, GeoIP-Flags, optionales Entsperren über die **CrowdSec Local API (LAPI)**.

**CrowdSec ist nicht Pflicht** für SelfDashboard.

### Installation

Plugin installieren → optional Mount **`/crowdsec-data`** → Widget **⚙️**.

### Daten

| Thema | Details |
|-------|---------|
| **DB** | `crowdsec.db` read-only |
| **Mount** | Host → `/crowdsec-data` |
| **Zeitraum** | 1 / 7 / 30 / 90 Tage, **1 / 2 / 5 / 10 Jahre**, **Alle** (gesamte DB) |
| **Max. Alerts** | 500 … 10.000 oder **Alle** (kein SQL-LIMIT) |
| **GeoIP** | `GeoLite2-*.mmdb` im Mount oder `CROWDSEC_GEOIP_PATH` |

### Entsperren (optional)

Über die **CrowdSec Local API** — **kein Docker-Socket** nötig. Im CrowdSec-Container eine eigene Maschine anlegen:

```bash
docker exec crowdsec cscli machines add selfdashboard --password 'LANGES-PASSWORT' -f /dev/null
```

(`-f /dev/null` ist wichtig — sonst überschreibt `cscli` CrowdSecs eigene `local_api_credentials.yaml`.) Dann am SelfDashboard-Container `CROWDSEC_LAPI_URL` (z. B. `http://192.168.1.7:8080`, Standard `http://crowdsec:8080`), `CROWDSEC_LAPI_MACHINE_ID` und `CROWDSEC_LAPI_PASSWORD` setzen und im Widget **Entsperren per CrowdSec-LAPI** aktivieren. Fehlen die Zugangsdaten, meldet das Widget das beim Entsperren.

### Env

`CROWDSEC_DATA_DIR`, `CROWDSEC_GEOIP_PATH`, `CROWDSEC_DB_PATH`, `CROWDSEC_LAPI_URL`, `CROWDSEC_LAPI_MACHINE_ID`, `CROWDSEC_LAPI_PASSWORD`

```bash
-v /mnt/user/appdata/crowdsec/data:/crowdsec-data:ro
```

### API

`/api/crowdsec`, `/api/crowdsec/decision`

---

## English

### Summary

Optional: **alerts/bans** from local **`crowdsec.db`**, time range filter, GeoIP flags, optional unban via the **CrowdSec Local API (LAPI)**.

**CrowdSec is not required** to run SelfDashboard.

### Installation

Install plugin → optional mount **`/crowdsec-data`** → widget **⚙️**.

### Data

| Topic | Details |
|-------|---------|
| **DB** | `crowdsec.db` read-only |
| **Mount** | Host → `/crowdsec-data` |
| **Range** | 1 / 7 / 30 / 90 days, **1 / 2 / 5 / 10 years**, **All** (entire DB) |
| **Max alerts** | 500 … 10,000 or **All** (no SQL LIMIT) |
| **GeoIP** | `GeoLite2-*.mmdb` in mount or `CROWDSEC_GEOIP_PATH` |

### Unban (optional)

Via the **CrowdSec Local API** — **no Docker socket** needed. Create a dedicated machine inside the CrowdSec container:

```bash
docker exec crowdsec cscli machines add selfdashboard --password 'LONG-PASSWORD' -f /dev/null
```

(`-f /dev/null` matters — otherwise `cscli` overwrites CrowdSec's own `local_api_credentials.yaml`.) Then set `CROWDSEC_LAPI_URL` (e.g. `http://192.168.1.7:8080`, default `http://crowdsec:8080`), `CROWDSEC_LAPI_MACHINE_ID` and `CROWDSEC_LAPI_PASSWORD` on the SelfDashboard container and enable **Unban via CrowdSec LAPI** in the widget. If the credentials are missing, the widget says so when you unban.

### Env

`CROWDSEC_DATA_DIR`, `CROWDSEC_GEOIP_PATH`, `CROWDSEC_DB_PATH`, `CROWDSEC_LAPI_URL`, `CROWDSEC_LAPI_MACHINE_ID`, `CROWDSEC_LAPI_PASSWORD`

```bash
-v /mnt/user/appdata/crowdsec/data:/crowdsec-data:ro
```

### API

`/api/crowdsec`, `/api/crowdsec/decision`
