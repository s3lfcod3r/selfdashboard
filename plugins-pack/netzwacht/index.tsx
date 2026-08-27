'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

type NetzwachtHost = {
  ip: string
  name: string
  mac: string
  bps: number
  totalBytes: number
  score: number
}

type NetzwachtAlert = {
  ts: string
  sig: string
  cat: string
  sev: number
  src: string
  spt?: number | null
  dst: string
  dpt: number | null
  proto: string
}

type NetzwachtData = {
  ntopng: {
    ok: boolean
    error?: string
    throughputBps?: number
    numLocalHosts?: number
    numHosts?: number
    alertedFlows?: number
    engagedAlerts?: number
    topHosts?: NetzwachtHost[]
  }
  suricata: {
    ok: boolean
    configured: boolean
    error?: string
    h24?: { high: number; medium: number; low: number; total: number }
    latest?: string | null
    alerts?: NetzwachtAlert[]
  }
  error?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}

function num(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v))
  return Number.isFinite(n) ? n : 0
}

function formatBps(bps: number, de: boolean): string {
  const bits = bps * 8
  const fmt = (v: number, unit: string) => {
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
    return `${de ? s.replace('.', ',') : s} ${unit}`
  }
  if (bits >= 1e9) return fmt(bits / 1e9, 'Gbit/s')
  if (bits >= 1e6) return fmt(bits / 1e6, 'Mbit/s')
  if (bits >= 1e3) return fmt(bits / 1e3, 'kbit/s')
  return fmt(bits, 'bit/s')
}

function relTime(ts: string, de: boolean): string {
  const t = Date.parse(ts.replace(/(\.\d+)?\+0000$/, 'Z'))
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 60) return de ? 'gerade eben' : 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return de ? `vor ${min} min` : `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return de ? `vor ${h} h` : `${h}h ago`
  const d = Math.round(h / 24)
  return de ? `vor ${d} Tagen` : `${d}d ago`
}

function sevColor(sev: number): string {
  if (sev <= 1) return '#ef4444'
  if (sev === 2) return '#f59e0b'
  return '#60a5fa'
}

function hostLabel(h: NetzwachtHost): string {
  let name = h.name && h.name !== h.ip ? h.name : ''
  if (name) {
    // Docker-/mDNS-Namen wie "zoraxy_32b021a0-…" auf den lesbaren Kern kuerzen
    const m = name.match(/^(.{3,}?)[_-][0-9a-f]{6}[0-9a-f-]*$/i)
    if (m) name = m[1]
    // reine UUIDs sind kein Name — dann lieber die IP zeigen
    if (/^[0-9a-f-]{30,}$/i.test(name)) name = ''
  }
  return name || h.ip
}

function cleanSig(sig: string): string {
  // "ET INFO Observed DNS…" → "Observed DNS…" (Klasse steckt schon im Farbpunkt)
  return sig.replace(/^ET\s+[A-Z0-9_]+\s+/, '').replace(/^GPL\s+[A-Z0-9_]+\s+/, '')
}

function sevLabel(sev: number, de: boolean): string {
  if (sev <= 1) return de ? 'Ernster Alarm' : 'Severe alert'
  if (sev === 2) return de ? 'Warnung' : 'Warning'
  return 'Info'
}

/** Verstaendliche Kurzerklaerung der Suricata-Kategorie. */
function catInfo(cat: string, de: boolean): string {
  const map: Record<string, [string, string]> = {
    'Misc activity': ['Allgemeine Beobachtung — meist harmlos.', 'General observation — usually harmless.'],
    'Misc Attack': ['Bekanntes Angriffsmuster erkannt.', 'Known attack pattern detected.'],
    'Not Suspicious Traffic': ['Als unbedenklich eingestufter Verkehr.', 'Traffic classified as benign.'],
    'Generic Protocol Command Decode': ['Technische Protokoll-Auffälligkeit.', 'Technical protocol anomaly.'],
    'Potential Corporate Privacy Violation': [
      'Gerät sendet möglicherweise Daten nach außen (Datenschutz).',
      'Device may be sending data outside (privacy).',
    ],
    'Attempted Information Leak': ['Möglicher Versuch, Informationen abzugreifen.', 'Possible information-gathering attempt.'],
    'Detection of a Network Scan': ['Jemand tastet das Netz systematisch ab.', 'Someone is scanning the network.'],
    'A Network Trojan was detected': ['Muster von Schadsoftware-Kommunikation!', 'Malware communication pattern!'],
    'Malware Command and Control Activity Detected': [
      'Schadsoftware-Fernsteuerung erkannt — Gerät prüfen!',
      'Malware command & control detected — check device!',
    ],
    'Crypto Currency Mining Activity Detected': ['Krypto-Mining-Kommunikation erkannt.', 'Crypto mining communication detected.'],
    'Attempted Administrator Privilege Gain': ['Versuch, Admin-Rechte zu erlangen!', 'Attempt to gain admin privileges!'],
    'Web Application Attack': ['Angriffsmuster gegen eine Web-Anwendung.', 'Attack pattern against a web application.'],
    'Potentially Bad Traffic': ['Verdächtiger, aber nicht eindeutiger Verkehr.', 'Suspicious but inconclusive traffic.'],
    'Device Retrieving External IP Address Detected': [
      'Gerät fragt seine öffentliche IP ab — machen viele Apps routinemäßig.',
      'Device looks up its public IP — many apps do this routinely.',
    ],
  }
  const pair = map[cat]
  return pair ? pair[de ? 0 : 1] : cat
}

function isPrivateIp(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fd)/i.test(ip)
}

type AdviceTone = 'calm' | 'watch' | 'act'

/** Eingebautes Wissen zu haeufigen Meldungen — erspart das Googeln. */
const SIG_WISSEN: Array<{ re: RegExp; de: string; en: string; tone: AdviceTone }> = [
  {
    re: /LeakIX|l9explore|Shodan|Censys|Stretchoid|InternetMeasurement|Driftnet/i,
    de: 'Das ist ein bekannter Internet-Scanner: Dienste wie LeakIX oder Shodan klopfen das gesamte Internet nach offenen Diensten ab. Solche Scanner treffen jeden öffentlich erreichbaren Server — normales Grundrauschen. CrowdSec bannt solche Absender in der Regel automatisch.',
    en: 'This is a known internet scanner (LeakIX/Shodan-style) probing the whole internet for open services. Every publicly reachable server gets hit — normal background noise. CrowdSec usually bans these senders automatically.',
    tone: 'calm',
  },
  {
    re: /ZeroTier/i,
    de: 'ZeroTier ist ein VPN-Dienst für Fernzugriff. Im ZimaBoard steckt er als eingebauter Fernzugriff „Zima Remote". Die Meldung heißt nur: das Gerät nutzt ZeroTier — kein Angriff.',
    en: 'ZeroTier is a VPN service for remote access. On the ZimaBoard it powers the built-in "Zima Remote". This just means the device uses ZeroTier — not an attack.',
    tone: 'calm',
  },
  {
    re: /edonkey|emule/i,
    de: 'Muster einer eDonkey/eMule-Tauschbörse. Wichtig: VPN-Verkehr wie ZeroTier (Zima Remote) sieht auf UDP-Ebene fast genauso aus und löst diese Regel häufig fälschlich aus.',
    en: 'eDonkey/eMule file-sharing pattern. Note: VPN traffic like ZeroTier (Zima Remote) looks almost identical on the UDP level and often falsely triggers this rule.',
    tone: 'watch',
  },
  {
    re: /Dshield|Spamhaus|CINS|DROP Listed|Known Compromised|3CORESec/i,
    de: 'Die Gegenstelle steht auf einer öffentlichen Liste bekannter Angreifer-IPs. Ein Kontaktversuch heißt: dein Anschluss wird — wie jeder — abgetastet. Solange kein interner Dienst antwortet, reicht es, dass CrowdSec und Firewall ihren Job machen.',
    en: 'The remote address is on a public list of known attacker IPs. A contact attempt means your connection is being probed — like everyone else. As long as no internal service responds, CrowdSec and the firewall have it covered.',
    tone: 'watch',
  },
  {
    re: /DNS Over HTTPS|DNS over TLS|DoH /i,
    de: 'Das Gerät verschlüsselt seine DNS-Anfragen (DNS-over-HTTPS). Moderne Geräte und Browser machen das ab Werk — legitim, umgeht aber lokale DNS-Filter wie AdGuard.',
    en: 'The device encrypts its DNS queries (DNS-over-HTTPS). Modern devices and browsers do this by default — legitimate, but it bypasses local DNS filters like AdGuard.',
    tone: 'calm',
  },
  {
    re: /External IP.*(Lookup|Address)|ipify|ifconfig\.me|icanhazip/i,
    de: 'Das Gerät fragt seine öffentliche IP-Adresse ab („Wie lautet meine Adresse im Internet?"). Machen DynDNS-Dienste, Apps und Spiele routinemäßig.',
    en: 'The device looks up its public IP address. DynDNS services, apps and games do this routinely.',
    tone: 'calm',
  },
  {
    re: /Steam/i,
    de: 'Verkehr der Spieleplattform Steam (Updates, Login, Downloads). Harmlos, solange auf dem Gerät tatsächlich gespielt wird.',
    en: 'Traffic from the Steam gaming platform (updates, login, downloads). Harmless if the device is actually used for gaming.',
    tone: 'calm',
  },
  {
    re: /Nmap|Network Scan|Port ?Scan|masscan|zgrab/i,
    de: 'Jemand tastet systematisch Ports oder Dienste ab. Von extern: Internet-Grundrauschen, CrowdSec regelt das. Von intern: prüfen, welches Gerät da scannt!',
    en: 'Someone is systematically probing ports or services. From outside: internet background noise, CrowdSec handles it. From inside: check which device is scanning!',
    tone: 'watch',
  },
  {
    re: /Trojan|Command and Control|C2 |Malware|Botnet|CobaltStrike/i,
    de: 'Kommunikationsmuster von Schadsoftware. Das ernst nehmen: betroffenes Gerät möglichst vom Netz trennen und genauer prüfen (Virenscan, unbekannte Apps).',
    en: 'Malware communication pattern. Take this seriously: disconnect the affected device if possible and investigate (AV scan, unknown apps).',
    tone: 'act',
  },
  {
    re: /Mining|Coinhive|Monero|XMR/i,
    de: 'Krypto-Mining-Kommunikation. Wenn auf dem Gerät nicht bewusst gemint wird, kann Schadsoftware dahinterstecken — Gerät prüfen.',
    en: 'Crypto-mining communication. If the device is not intentionally mining, malware may be behind it — check the device.',
    tone: 'act',
  },
  {
    re: /\bTor\b|Onion/i,
    de: 'Das Gerät nutzt das Tor-Anonymisierungsnetz. Legitim, aber ungewöhnlich für Haushaltsgeräte — wissen, wer das ist, schadet nicht.',
    en: 'The device uses the Tor anonymity network. Legitimate, but unusual for household devices — worth knowing who it is.',
    tone: 'watch',
  },
  {
    re: /SSH (Brute|Scan)|Brute.?Force/i,
    de: 'Wiederholte Anmeldeversuche (Brute-Force-Muster). Von extern auf einen erreichbaren Dienst: üblich — Fail2ban/CrowdSec drosseln das. Häufung auf ein internes Ziel: Passwörter prüfen.',
    en: 'Repeated login attempts (brute-force pattern). External against a reachable service: common — Fail2ban/CrowdSec throttle it. Repeated against an internal target: review passwords.',
    tone: 'watch',
  },
]

type Insight = { direction: string; wissen: string | null; advice: string; tone: AdviceTone }

function buildInsight(a: NetzwachtAlert, de: boolean, watchHost: string): Insight {
  const srcPriv = isPrivateIp(a.src)
  const dstPriv = isPrivateIp(a.dst)
  const dstPort = a.dpt ? `:${a.dpt}` : ''

  let direction: string
  if (srcPriv && !dstPriv) {
    direction = de
      ? `Ausgehend: Dein Gerät ${a.src} hat die Internet-Adresse ${a.dst}${dstPort} kontaktiert.`
      : `Outbound: your device ${a.src} contacted internet address ${a.dst}${dstPort}.`
  } else if (!srcPriv && dstPriv) {
    direction = de
      ? `Eingehend aus dem Internet: ${a.src} hat dein Gerät ${a.dst}${dstPort} angesprochen.`
      : `Inbound from the internet: ${a.src} contacted your device ${a.dst}${dstPort}.`
  } else if (srcPriv && dstPriv) {
    direction = de
      ? `Interner Verkehr in deinem Netz: ${a.src} → ${a.dst}${dstPort}.`
      : `Internal traffic in your network: ${a.src} → ${a.dst}${dstPort}.`
  } else {
    direction = de ? `Verkehr zwischen ${a.src} und ${a.dst}${dstPort}.` : `Traffic between ${a.src} and ${a.dst}${dstPort}.`
  }
  const localIp = srcPriv ? a.src : dstPriv ? a.dst : ''
  if (watchHost && localIp === watchHost) {
    direction += de
      ? ` ${localIp} ist übrigens dein NetzWacht-Server (ZimaBoard) selbst.`
      : ` Note: ${localIp} is your NetzWacht server (ZimaBoard) itself.`
  }

  const hit = SIG_WISSEN.find((w) => w.re.test(a.sig))
  let tone: AdviceTone = hit ? hit.tone : a.sev <= 1 ? 'act' : a.sev === 2 ? 'watch' : 'calm'
  let wissen = hit ? (de ? hit.de : hit.en) : null

  // Spezialfall: eDonkey-Muster vom ZeroTier-Host = fast sicher Fehlalarm
  if (hit && /edonkey|emule/i.test(a.sig) && watchHost && localIp === watchHost) {
    tone = 'calm'
    wissen = de
      ? `${wissen} Da die Meldung von deinem ZimaBoard kommt (Zima Remote nutzt ZeroTier), ist das fast sicher genau dieser Fehlalarm.`
      : `${wissen} Since this comes from your ZimaBoard (Zima Remote uses ZeroTier), this is almost certainly that false positive.`
  }

  const advice =
    tone === 'act'
      ? de
        ? 'Zeitnah prüfen!'
        : 'Check soon!'
      : tone === 'watch'
        ? de
          ? 'Beobachten — nur bei Häufung genauer ansehen.'
          : 'Keep an eye on it — investigate only if it piles up.'
        : de
          ? '✓ Kein Handlungsbedarf.'
          : '✓ No action needed.'
  return { direction, wissen, advice, tone }
}

function toneColor(tone: AdviceTone): string {
  return tone === 'act' ? '#ef4444' : tone === 'watch' ? '#f59e0b' : '#34d399'
}

const PORT_NAMES: Record<number, string> = {
  20: 'FTP',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'Mail (SMTP)',
  53: 'DNS',
  80: 'Webserver (HTTP)',
  110: 'Mail (POP3)',
  123: 'Zeitserver (NTP)',
  143: 'Mail (IMAP)',
  443: 'Webserver (HTTPS)',
  445: 'Windows-Freigabe (SMB)',
  465: 'Mail (SMTPS)',
  587: 'Mail (Versand)',
  993: 'Mail (IMAPS)',
  1194: 'VPN (OpenVPN)',
  3389: 'Fernzugriff (RDP)',
  5060: 'Telefonie (SIP)',
  8080: 'Webserver (Alt-Port)',
  8443: 'Webserver (HTTPS Alt)',
  9993: 'ZeroTier',
  51820: 'VPN (WireGuard)',
}

function portLabel(port: number | null | undefined): string {
  return port ? PORT_NAMES[port] || '' : ''
}

/** Die interessante Gegenstelle eines Alarms: die oeffentliche Seite. */
function pickRemoteIp(a: NetzwachtAlert): string {
  if (!isPrivateIp(a.src)) return a.src
  if (!isPrivateIp(a.dst)) return a.dst
  return a.src
}

type IpInfoData = {
  ip: string
  isPublic: boolean
  rdns: string | null
  geo: { country: string; countryCode: string; city: string; isp: string; org: string; as: string } | null
  crowdsec: { banned: boolean; scenario: string; until: string } | null
  stats: { ip24h: number; sig24h: number } | null
}

function fmtTime(ts: string, de: boolean): string {
  const t = Date.parse(ts.replace(/(\.\d+)?\+0000$/, 'Z'))
  if (!Number.isFinite(t)) return ts
  return new Date(t).toLocaleString(de ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}

const sectionLabel: CSSProperties = {
  fontSize: 'clamp(8px, 2cqmin, 9px)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--text-muted)',
  borderTop: '1px solid var(--border)',
  paddingTop: 7,
}

function errorText(code: string, de: boolean): string {
  const map: Record<string, [string, string]> = {
    auth_failed: ['ntopng-Login abgelehnt — Benutzer/Passwort prüfen.', 'ntopng login rejected — check user/password.'],
    missing_credentials: ['ntopng-Zugangsdaten fehlen.', 'ntopng credentials missing.'],
    missing_url: ['ntopng-URL fehlt.', 'ntopng URL missing.'],
    invalid_url: ['Ungültige URL.', 'Invalid URL.'],
    blocked_url: ['URL blockiert (SSRF-Schutz).', 'URL blocked (SSRF guard).'],
    timeout: ['Zeitüberschreitung.', 'Timeout.'],
    network_error: ['Nicht erreichbar.', 'Unreachable.'],
    upstream_error: ['ntopng-Fehler.', 'ntopng error.'],
    alerts_auth_failed: ['Alarm-API: Token abgelehnt.', 'Alert API: token rejected.'],
    alerts_upstream_error: ['Alarm-API nicht erreichbar.', 'Alert API unreachable.'],
  }
  const pair = map[code]
  return pair ? pair[de ? 0 : 1] : code
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <span
        style={{
          fontSize: 'clamp(8px, 2cqmin, 9px)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'clamp(12px, 4cqmin, 17px)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: accent || 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const { active } = usePollingActive()
  const [data, setData] = useState<NetzwachtData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<NetzwachtAlert | null>(null)
  const [ipInfo, setIpInfo] = useState<IpInfoData | null>(null)
  const [ipInfoLoading, setIpInfoLoading] = useState(false)

  const ntopngUrl = str(config.ntopngUrl)
  const username = str(config.username)
  const password = str(config.password)
  const ifid = num(config.ifid)
  const alertsUrl = str(config.alertsUrl)
  const alertsToken = str(config.alertsToken)
  const maxAlerts = Math.min(25, Math.max(1, num(config.maxAlerts) || 6))
  const refreshMs = Math.max(10, num(config.refreshSeconds) || 30) * 1000
  const title = config.title === undefined ? 'NetzWacht' : str(config.title)
  const showDevices = config.showDevices === true
  const showInfoAlerts = config.showInfoAlerts === true
  const configured = Boolean(ntopngUrl && username && password)
  // Host der Alarm-API = das ZimaBoard — hilft bei der Einordnung eigener Meldungen
  const watchHost = (alertsUrl.match(/\/\/([^:/]+)/) || [])[1] || ''
  const insight = detail ? buildInsight(detail, de, watchHost) : null

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/plugins/netzwacht', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ntopngUrl,
          username,
          password,
          ifid,
          alertsUrl,
          alertsToken,
          maxAlerts,
          importantOnly: !showInfoAlerts,
        }),
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as NetzwachtData
      if (!res.ok || json.error) {
        setError(errorText(json.error || `HTTP ${res.status}`, de))
        return
      }
      setData(json)
      setError(null)
    } catch {
      setError(errorText('network_error', de))
    } finally {
      setLoading(false)
    }
  }, [alertsToken, alertsUrl, configured, de, ifid, maxAlerts, ntopngUrl, password, showInfoAlerts, username])

  useEffect(() => {
    setLoading(true)
    void refresh()
    if (!active) return
    const t = setInterval(() => void refresh(), refreshMs)
    return () => clearInterval(t)
  }, [refresh, refreshMs, active])

  // Zusatzinfos zur Gegenstelle laden, sobald das Detail-Popup aufgeht
  useEffect(() => {
    if (!detail) {
      setIpInfo(null)
      return
    }
    let alive = true
    setIpInfoLoading(true)
    setIpInfo(null)
    fetch('/api/plugins/netzwacht/ipinfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: pickRemoteIp(detail), sig: detail.sig, alertsUrl, alertsToken }),
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && !j.error) setIpInfo(j as IpInfoData)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setIpInfoLoading(false)
      })
    return () => {
      alive = false
    }
  }, [detail, alertsUrl, alertsToken])

  const shell: CSSProperties = {
    height: '100%',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    padding: '10px 12px',
    containerType: 'size',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }

  if (!configured) {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <span style={{ fontSize: 24 }}>🛡️</span>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.45 }}>
          {de
            ? 'ntopng-URL, Benutzer und Passwort in den Einstellungen eintragen. Optional: Alarm-API-URL + Token für Suricata-Meldungen.'
            : 'Enter ntopng URL, user and password in settings. Optional: alert API URL + token for Suricata alerts.'}
        </p>
      </div>
    )
  }

  if (loading && !data && !error) {
    return (
      <div style={shell}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 38, flex: 1, borderRadius: 8 }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[70, 55, 62].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 11, width: `${w}%`, borderRadius: 3 }} />
          ))}
        </div>
      </div>
    )
  }

  const nt = data?.ntopng
  const su = data?.suricata
  const h24 = su?.ok ? su.h24 : undefined
  const shownAlerts = (su?.alerts ?? []).filter((a) => showInfoAlerts || a.sev <= 2).slice(0, maxAlerts)

  // Ampel-Logik: rot = ernste Alarme, orange = Warnungen, gruen = ruhig
  type Level = 'crit' | 'warn' | 'ok' | 'off'
  const level: Level = !h24 ? 'off' : h24.high > 0 ? 'crit' : h24.medium > 0 ? 'warn' : 'ok'
  const levelColor =
    level === 'crit' ? '#ef4444' : level === 'warn' ? '#f59e0b' : level === 'ok' ? '#34d399' : 'var(--text-muted)'
  const heroTitle =
    level === 'crit'
      ? de
        ? `${h24!.high} ernste${h24!.high === 1 ? 'r' : ''} Alarm${h24!.high === 1 ? '' : 'e'}!`
        : `${h24!.high} severe alert${h24!.high === 1 ? '' : 's'}!`
      : level === 'warn'
        ? de
          ? `${h24!.medium} Warnung${h24!.medium === 1 ? '' : 'en'} (24 h)`
          : `${h24!.medium} warning${h24!.medium === 1 ? '' : 's'} (24h)`
        : level === 'ok'
          ? de
            ? 'Alles ruhig'
            : 'All quiet'
          : de
            ? 'Alarm-Überwachung aus'
            : 'Alert monitoring off'
  const heroSub =
    level === 'crit'
      ? de
        ? 'Zeitnah prüfen — betroffene Geräte unten.'
        : 'Check soon — affected devices below.'
      : level === 'warn'
        ? de
          ? 'Nichts Ernstes — bei Gelegenheit ansehen.'
          : 'Nothing severe — review when convenient.'
        : level === 'ok'
          ? h24 && h24.low > 0
            ? de
              ? `Keine wichtigen Meldungen · ${h24.low} Info-Notizen (24 h)`
              : `No important alerts · ${h24.low} info notes (24h)`
            : de
              ? 'Keine Meldungen in den letzten 24 h.'
              : 'No alerts in the last 24h.'
          : su?.configured
            ? errorText(su.error || 'alerts_upstream_error', de)
            : de
              ? 'Alarm-API-URL + Token in den Einstellungen eintragen.'
              : 'Enter alert API URL + token in settings.'

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {title ? (
          <p
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontSize: 'clamp(9px, 2.4cqmin, 10px)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </p>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <span
          title={nt?.ok ? (de ? 'Verbunden' : 'Connected') : de ? 'Störung' : 'Degraded'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: nt?.ok ? '#34d399' : '#ef4444',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          flexShrink: 0,
          background: `color-mix(in srgb, ${levelColor} 11%, transparent)`,
          border: `1px solid color-mix(in srgb, ${levelColor} 32%, transparent)`,
        }}
      >
        <span
          style={{
            width: 'clamp(28px, 9cqmin, 38px)',
            height: 'clamp(28px, 9cqmin, 38px)',
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'clamp(14px, 4.5cqmin, 19px)',
            fontWeight: 700,
            background: `color-mix(in srgb, ${levelColor} 18%, transparent)`,
            color: levelColor,
          }}
        >
          {level === 'ok' ? '✓' : level === 'off' ? '·' : '!'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 'clamp(13px, 4.2cqmin, 17px)',
              fontWeight: 700,
              color: level === 'off' ? 'var(--text)' : levelColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {heroTitle}
          </span>
          <span
            style={{
              fontSize: 'clamp(9px, 2.4cqmin, 10.5px)',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {heroSub}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {showDevices && nt?.ok && (nt.topHosts?.length ?? 0) > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={sectionLabel}>{de ? 'Top-Geräte' : 'Top devices'}</span>
            {(() => {
              const hosts = nt.topHosts!.slice(0, 3)
              const maxBps = Math.max(1, ...hosts.map((h) => h.bps))
              return hosts.map((h) => {
                const label = hostLabel(h)
                return (
                  <div key={h.ip} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          minWidth: 0,
                          fontSize: 'clamp(10px, 2.8cqmin, 12px)',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`${h.name || label} · ${h.ip}${h.mac ? ` · ${h.mac}` : ''}`}
                      >
                        {label}
                      </span>
                      {label !== h.ip ? (
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 'clamp(8px, 2.2cqmin, 10px)',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h.ip}
                        </span>
                      ) : (
                        <span style={{ flex: 1 }} />
                      )}
                      <span
                        style={{
                          fontSize: 'clamp(9px, 2.4cqmin, 11px)',
                          color: 'var(--text-muted)',
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatBps(h.bps, de)}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(4, Math.round((h.bps / maxBps) * 100))}%`,
                          borderRadius: 2,
                          background: 'var(--accent)',
                          opacity: 0.85,
                        }}
                      />
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        ) : null}

        {su?.ok && shownAlerts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={sectionLabel}>
              {showInfoAlerts ? (de ? 'Letzte Meldungen' : 'Recent alerts') : de ? 'Wichtige Meldungen' : 'Important alerts'}
            </span>
            {shownAlerts.map((a, i) => {
              const key = `${a.ts}-${i}`
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(a)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setDetail(a)
                  }}
                  title={de ? 'Für Details anklicken' : 'Click for details'}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    minWidth: 0,
                    cursor: 'pointer',
                    borderRadius: 6,
                    padding: '2px 4px',
                    margin: '0 -4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: sevColor(a.sev),
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 'clamp(9px, 2.6cqmin, 11px)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cleanSig(a.sig)}
                    </span>
                    <span
                      style={{
                        fontSize: 'clamp(8px, 2.2cqmin, 10px)',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {relTime(a.ts, de)}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--text-muted)',
                        flexShrink: 0,
                      }}
                    >
                      ▸
                    </span>
                  </div>
                  <span
                    style={{
                      paddingLeft: 13,
                      fontSize: 'clamp(8px, 2.1cqmin, 9.5px)',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.src} → {a.dst}
                    {a.dpt ? `:${a.dpt}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <p
        style={{
          margin: 0,
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 'clamp(9px, 2.3cqmin, 10.5px)',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: 6,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {nt?.ok ? (
          <>
            <span style={{ whiteSpace: 'nowrap' }}>↕ {formatBps(num(nt.throughputBps), de)}</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              {num(nt.numLocalHosts)} {de ? 'Geräte im Netz' : 'devices online'}
            </span>
          </>
        ) : (
          <span style={{ color: '#ef4444' }}>{errorText(nt?.error || 'network_error', de)}</span>
        )}
      </p>

      {error ? (
        <p style={{ margin: 0, fontSize: 10, color: '#ef4444', lineHeight: 1.4, wordBreak: 'break-word' }}>{error}</p>
      ) : null}

      {detail && typeof document !== 'undefined'
        ? createPortal(
            <div
              onClick={() => setDetail(null)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2000,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(460px, 94vw)',
                  maxHeight: '82vh',
                  overflowY: 'auto',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '16px 18px',
                  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      color: sevColor(detail.sev),
                      background: `color-mix(in srgb, ${sevColor(detail.sev)} 14%, transparent)`,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor(detail.sev) }} />
                    {sevLabel(detail.sev, de)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => setDetail(null)}
                    aria-label={de ? 'Schließen' : 'Close'}
                    style={{
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      borderRadius: 8,
                      width: 28,
                      height: 28,
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{cleanSig(detail.sig)}</p>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                  {catInfo(detail.cat, de)}
                </p>

                {insight ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1px solid color-mix(in srgb, ${toneColor(insight.tone)} 35%, transparent)`,
                      background: `color-mix(in srgb, ${toneColor(insight.tone)} 8%, transparent)`,
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {de ? 'Einordnung' : 'Assessment'}
                    </span>
                    <span>{insight.direction}</span>
                    {insight.wissen ? <span>{insight.wissen}</span> : null}
                    <span style={{ fontWeight: 700, color: toneColor(insight.tone) }}>{insight.advice}</span>
                  </div>
                ) : null}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '5px 14px',
                    fontSize: 12.5,
                    fontVariantNumeric: 'tabular-nums',
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{de ? 'Quelle' : 'Source'}</span>
                  <span style={{ fontWeight: 600 }}>
                    {detail.src}
                    {detail.spt ? `:${detail.spt}` : ''}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{de ? 'Ziel' : 'Target'}</span>
                  <span>
                    {detail.dst}
                    {detail.dpt ? `:${detail.dpt}` : ''}
                    {portLabel(detail.dpt) ? (
                      <span style={{ color: 'var(--text-muted)' }}> · {portLabel(detail.dpt)}</span>
                    ) : null}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{de ? 'Protokoll' : 'Protocol'}</span>
                  <span>{detail.proto || '–'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{de ? 'Kategorie' : 'Category'}</span>
                  <span>{detail.cat || '–'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{de ? 'Zeitpunkt' : 'Time'}</span>
                  <span>{fmtTime(detail.ts, de)}</span>
                </div>

                {ipInfoLoading || ipInfo ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      borderTop: '1px solid var(--border)',
                      paddingTop: 10,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {de ? 'Gegenstelle' : 'Remote party'} · {ipInfo?.ip || pickRemoteIp(detail)}
                    </span>
                    {ipInfoLoading ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {[65, 45].map((w, i) => (
                          <div key={i} className="skeleton" style={{ height: 11, width: `${w}%`, borderRadius: 3 }} />
                        ))}
                      </div>
                    ) : ipInfo ? (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          gap: '5px 14px',
                          fontSize: 12.5,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {ipInfo.rdns ? (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>{de ? 'Hostname' : 'Hostname'}</span>
                            <span style={{ wordBreak: 'break-all' }}>{ipInfo.rdns}</span>
                          </>
                        ) : null}
                        {ipInfo.geo ? (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>{de ? 'Standort' : 'Location'}</span>
                            <span>
                              {[ipInfo.geo.city, ipInfo.geo.country].filter(Boolean).join(', ') || '–'}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>{de ? 'Anbieter' : 'Provider'}</span>
                            <span>{ipInfo.geo.isp || ipInfo.geo.org || ipInfo.geo.as || '–'}</span>
                          </>
                        ) : null}
                        {ipInfo.stats ? (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>{de ? 'Heute (24 h)' : 'Today (24h)'}</span>
                            <span>
                              {de
                                ? `${ipInfo.stats.ip24h}× diese IP · ${ipInfo.stats.sig24h}× diese Regel`
                                : `${ipInfo.stats.ip24h}× this IP · ${ipInfo.stats.sig24h}× this rule`}
                            </span>
                          </>
                        ) : null}
                        {ipInfo.crowdsec ? (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>CrowdSec</span>
                            <span style={{ color: ipInfo.crowdsec.banned ? '#34d399' : 'var(--text-muted)', fontWeight: 600 }}>
                              {ipInfo.crowdsec.banned
                                ? de
                                  ? `✓ bereits gebannt${ipInfo.crowdsec.scenario ? ` (${ipInfo.crowdsec.scenario})` : ''}`
                                  : `✓ already banned${ipInfo.crowdsec.scenario ? ` (${ipInfo.crowdsec.scenario})` : ''}`
                                : de
                                  ? 'nicht gebannt'
                                  : 'not banned'}
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`"${detail.sig}" suricata`)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
                  >
                    {de ? 'Regel im Web nachschlagen ↗' : 'Look up rule on the web ↗'}
                  </a>
                  {isPrivateIp(detail.src) || isPrivateIp(detail.dst) ? (
                    <a
                      href={`${ntopngUrl.replace(/\/+$/, '')}/lua/host_details.lua?host=${encodeURIComponent(
                        isPrivateIp(detail.src) ? detail.src : detail.dst,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
                    >
                      {de ? 'Gerät in ntopng öffnen ↗' : 'Open device in ntopng ↗'}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

const inp: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
}

function Settings({ config, onChange }: PluginSettingsProps) {
  const { de } = usePluginLocale()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Widget-Titel (leer = ausblenden)' : 'Widget title (empty = hidden)'}
        </label>
        <input
          style={inp}
          value={config.title === undefined ? 'NetzWacht' : str(config.title)}
          placeholder="NetzWacht"
          onChange={(e) => onChange('title', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ntopng-URL</label>
        <input
          style={inp}
          value={str(config.ntopngUrl)}
          placeholder="http://192.168.1.103:3000"
          onChange={(e) => onChange('ntopngUrl', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'ntopng-Benutzer' : 'ntopng user'}
        </label>
        <input
          style={inp}
          value={str(config.username)}
          autoComplete="off"
          placeholder="admin"
          onChange={(e) => onChange('username', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'ntopng-Passwort' : 'ntopng password'}
        </label>
        <input
          style={inp}
          type="password"
          value={str(config.password)}
          autoComplete="new-password"
          onChange={(e) => onChange('password', e.target.value)}
        />
        <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {de
            ? 'Abfrage läuft serverseitig über /api/plugins/netzwacht — die Zugangsdaten verlassen das Dashboard nicht.'
            : 'Requests go server-side via /api/plugins/netzwacht — credentials never leave the dashboard.'}
        </p>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Alarm-API-URL (Suricata, optional)' : 'Alert API URL (Suricata, optional)'}
        </label>
        <input
          style={inp}
          value={str(config.alertsUrl)}
          placeholder="http://192.168.1.103:3001"
          onChange={(e) => onChange('alertsUrl', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'Alarm-API-Token' : 'Alert API token'}
        </label>
        <input
          style={inp}
          type="password"
          value={str(config.alertsToken)}
          autoComplete="new-password"
          onChange={(e) => onChange('alertsToken', e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.showInfoAlerts === true}
            onChange={(e) => onChange('showInfoAlerts', e.target.checked)}
          />
          {de ? 'Auch Info-Meldungen anzeigen (sonst nur Warnungen & Alarme)' : 'Also show info alerts (otherwise warnings & alerts only)'}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.showDevices === true}
            onChange={(e) => onChange('showDevices', e.target.checked)}
          />
          {de ? 'Top-Geräte-Liste anzeigen' : 'Show top devices list'}
        </label>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {de ? 'Aktualisieren (Sek.)' : 'Refresh (seconds)'}
          </label>
          <input
            style={inp}
            type="number"
            min={10}
            max={3600}
            value={num(config.refreshSeconds) || 30}
            onChange={(e) => onChange('refreshSeconds', Math.max(10, num(e.target.value) || 30))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {de ? 'Max. Meldungen' : 'Max alerts'}
          </label>
          <input
            style={inp}
            type="number"
            min={1}
            max={25}
            value={num(config.maxAlerts) || 6}
            onChange={(e) => onChange('maxAlerts', Math.min(25, Math.max(1, num(e.target.value) || 6)))}
          />
        </div>
      </div>
    </div>
  )
}

export const meta: PluginMeta = {
  id: 'netzwacht',
  name: 'NetzWacht',
  description:
    'Netzwerk-Wächter: Live-Durchsatz, Top-Geräte und Suricata-Sicherheitsalarme vom ntopng-Stack. (Beta)',
  version: '0.7.0',
  author: 'SelfDashboard',
  category: 'security',
  icon: '🛡️',
  defaultLayout: { w: 4, h: 4, minW: 2, minH: 2 },
  configSchema: [
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'NetzWacht' },
    { key: 'ntopngUrl', label: 'ntopng-URL', type: 'text', placeholder: 'http://192.168.1.103:3000', defaultValue: '' },
    { key: 'username', label: 'ntopng-Benutzer', type: 'text', defaultValue: '' },
    { key: 'password', label: 'ntopng-Passwort', type: 'password', defaultValue: '' },
    { key: 'alertsUrl', label: 'Alarm-API-URL', type: 'text', placeholder: 'http://192.168.1.103:3001', defaultValue: '' },
    { key: 'alertsToken', label: 'Alarm-API-Token', type: 'password', defaultValue: '' },
    { key: 'showInfoAlerts', label: 'Auch Info-Meldungen anzeigen', type: 'boolean', defaultValue: false },
    { key: 'showDevices', label: 'Top-Geräte-Liste anzeigen', type: 'boolean', defaultValue: false },
    { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number', defaultValue: 30 },
    { key: 'maxAlerts', label: 'Max. Meldungen', type: 'number', defaultValue: 6 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
