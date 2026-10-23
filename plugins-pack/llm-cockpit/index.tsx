'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import { useDashboardStore } from '@/lib/store'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// Eine Kachel fuer das KI-Setup, von oben nach unten:
//   1. Token-Zaehler (wie llm-token: heute/gestern/7 Tage, dazu der laufende Monat;
//      Klick auf den Titel klappt Monatsauswahl und Tagesliste auf)
//   2. LLM-Tempo (wie llm-tempo, aber nur die Server aus "Nur Server", Standard RTX2000)
//   3. Projektstatus (wie openclaw-status, kompakter mit Fortschritt je Projekt)
// Leere Adressen werden aus vorhandenen llm-token-/llm-tempo-/openclaw-status-Kacheln
// uebernommen, damit nach dem Umstieg nichts neu eingetragen werden muss.

const API = '/api/plugins/llm-cockpit'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

const FARBE_EIN = '#60a5fa'
const FARBE_AUS = '#34d399'
const FARBE_WARTET = '#f59e0b'
const FARBE_FEHLER = '#ef4444'
const zahlen: CSSProperties = { fontVariantNumeric: 'tabular-nums' }
const eineZeile: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/** 1234 -> 1,2k | 1234567 -> 1,2M */
function kurz(n: number, de: boolean): string {
  const l = de ? 'de-DE' : 'en-US'
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(l, { maximumFractionDigits: 1 })}M`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString(l, { maximumFractionDigits: 1 })}k`
  return Math.round(n).toLocaleString(l)
}

function vor(iso: string | number, de: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return de ? 'gerade eben' : 'just now'
  if (s < 3600) return de ? `vor ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`
  if (s < 86400) return de ? `vor ${Math.round(s / 3600)} h` : `${Math.round(s / 3600)} h ago`
  const t = Math.round(s / 86400)
  return de ? `vor ${t} ${t === 1 ? 'Tag' : 'Tagen'}` : `${t} d ago`
}

type ApiFehler = { error?: string; host?: string; status?: number }

/** Fehler des Serverteils in einen Satz: was fehlt und welcher Host. */
function fehlerText(b: ApiFehler, dienst: string, de: boolean): string {
  const host = b.host ? ` (${b.host})` : ''
  switch (b.error) {
    case 'timeout':
      return de ? `${dienst} antwortet nicht${host}` : `${dienst} timed out${host}`
    case 'unreachable':
      return de ? `${dienst} nicht erreichbar${host}` : `${dienst} unreachable${host}`
    case 'upstream_status':
      return `${dienst}: HTTP ${b.status ?? '?'}${host}`
    case 'unsafe_url':
      return de ? `Adresse gesperrt${host} – SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 setzen` : `URL blocked${host}`
    default:
      return `${dienst}: ${b.error || 'Fehler'}${host}`
  }
}

async function post<T>(body: unknown): Promise<{ ok: true; data: T } | { ok: false; fehler: ApiFehler }> {
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json()) as T & ApiFehler
    if (!res.ok || data.error) return { ok: false, fehler: data.error ? data : { error: `HTTP ${res.status}` } }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, fehler: { error: err instanceof Error ? err.message : String(err) } }
  }
}

function usePoll(load: () => Promise<void>, ms: number, active: boolean, enabled: boolean) {
  useEffect(() => {
    if (!active || !enabled) return
    void load()
    const t = setInterval(() => void load(), ms)
    return () => clearInterval(t)
  }, [load, ms, active, enabled])
}

function Abschnitt({ titel, rechts, children, onTitel }: { titel: string; rechts?: ReactNode; children: ReactNode; onTitel?: () => void }) {
  const kopf = (
    <>
      <strong style={{ flex: 1, fontSize: 13 }}>{titel}</strong>
      {rechts}
    </>
  )
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {onTitel ? (
        <button
          type="button"
          onClick={onTitel}
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          {kopf}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>{kopf}</div>
      )}
      {children}
    </section>
  )
}

/** Letzte gute Daten bleiben stehen; darunter ein ruhiger Hinweis statt leerer Kachel. */
function Hinweis({ text, stand, de }: { text: string; stand: number | null; de: boolean }) {
  return (
    <span style={{ color: stand ? FARBE_WARTET : FARBE_FEHLER, fontSize: 11 }}>
      {text}
      {stand && <span style={{ opacity: 0.8 }}> · {de ? 'Stand' : 'as of'} {vor(stand, de)}</span>}
    </span>
  )
}

const trenner: CSSProperties = { borderTop: '1px solid rgba(128,128,128,.18)', margin: '2px 0' }

// ---------------------------------------------------------------------------
// 1. Token-Zaehler
// ---------------------------------------------------------------------------

type Paar = { ein: number; aus: number }
type Summe = {
  gesamt: { ein: number; aus: number; cache_gelesen: number; cache_geschrieben: number }
  agenten: Record<string, Paar>
  server: Record<string, Paar>
  spitze: Record<string, number>
}
type TokenDaten = {
  erzeugt: string
  fehler?: string | null
  heute: Summe
  gestern: Summe
  woche: Summe
  monate: Record<string, Summe>
  tage: Record<string, Summe['gesamt']>
  adressen?: Record<string, string>
}

const NAMEN: Record<string, string> = { main: 'Self-Projekte', code: 'Programmierer', dokumente: 'Dokumente' }
const hübsch = (k: string): string => NAMEN[k] ?? k

/** Vergleichbare Form einer Server-Adresse: ohne Schluss-Slash und /v1. */
const normUrl = (u: string): string => u.trim().replace(/\/+$/, '').replace(/\/v1$/, '').toLowerCase()

const MONATE_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
function monatName(m: string, de: boolean): string {
  const [j, mm] = m.split('-')
  const i = Number(mm) - 1
  if (!de) return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return `${MONATE_DE[i] ?? m} ${j}`
}

function Kennzahl({ wert, text, farbe, gross = true }: { wert: string; text: string; farbe?: string; gross?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: gross ? 17 : 13, fontWeight: 700, ...zahlen }}>{wert}</span>
      <span style={{ fontSize: 11, opacity: 0.6, color: farbe }}>{text}</span>
    </span>
  )
}

type GruppenZeile = { key: string; name: string; ein: number; aus: number }

/** Eine Zeile je Eintrag: Name, Balken (Anteil am Groessten, blau rein / gruen raus), Zahlen. */
function Gruppe({ titel, zeilen, de }: { titel: string; zeilen: GruppenZeile[]; de: boolean }) {
  if (zeilen.length === 0) return null
  const max = Math.max(...zeilen.map((z) => z.ein + z.aus))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.45 }}>{titel}</div>
      {zeilen.map((z) => {
        const breite = max > 0 ? Math.max(3, ((z.ein + z.aus) / max) * 100) : 0
        return (
          <div key={z.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, ...zahlen }}>
            <span style={{ width: '38%', minWidth: 0, ...eineZeile }}>{z.name}</span>
            <span style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(128,128,128,.18)', overflow: 'hidden' }}>
              <span style={{ display: 'flex', width: `${breite}%`, height: '100%' }}>
                <span style={{ flex: z.ein, background: FARBE_EIN }} />
                <span style={{ flex: z.aus, background: FARBE_AUS }} />
              </span>
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: FARBE_EIN }}>{kurz(z.ein, de)}</span>
              <span style={{ opacity: 0.35 }}> / </span>
              <span style={{ color: FARBE_AUS }}>{kurz(z.aus, de)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Server mit gleichem Anzeigenamen (z.B. zwei Modelle auf einer GPU) zusammenzaehlen. */
function nachNamen(zeilen: GruppenZeile[]): GruppenZeile[] {
  const summe = new Map<string, GruppenZeile>()
  for (const z of zeilen) {
    const alt = summe.get(z.name)
    summe.set(z.name, alt ? { ...alt, ein: alt.ein + z.ein, aus: alt.aus + z.aus } : z)
  }
  return [...summe.values()].sort((x, y) => y.ein + y.aus - (x.ein + x.aus))
}

function TokenTeil({ url, zeitraum, namenNachUrl, refreshMs, active, de }: {
  url: string
  zeitraum: string
  namenNachUrl: Record<string, string>
  refreshMs: number
  active: boolean
  de: boolean
}) {
  const [daten, setDaten] = useState<TokenDaten | null>(null)
  const [fehler, setFehler] = useState('')
  const [stand, setStand] = useState<number | null>(null)
  // 'heute' | 'gestern' | 'woche' | 'YYYY-MM'
  const [wahl, setWahl] = useState(zeitraum)

  const load = useCallback(async () => {
    const r = await post<TokenDaten>({ kind: 'tokens', url })
    if (r.ok) {
      setDaten(r.data)
      setFehler('')
      setStand(Date.now())
    } else {
      setFehler(fehlerText(r.fehler, de ? 'Token-Sammler' : 'Token collector', de))
    }
  }, [url, de])
  usePoll(load, refreshMs, active, !!url)

  const titel = de ? 'Token-Zähler' : 'Token counter'
  if (!url) {
    return (
      <Abschnitt titel={titel}>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{de ? 'Adresse des Token-Sammlers in den Einstellungen eintragen.' : 'Set the collector URL in the settings.'}</span>
      </Abschnitt>
    )
  }

  const serverName = (k: string): string => {
    const a = daten?.adressen?.[k]
    return (a && namenNachUrl[normUrl(a)]) || k
  }
  const monate = Object.keys(daten?.monate ?? {}).sort()
  const aktMonat = monate[monate.length - 1] ?? ''
  const istMonat = /^\d{4}-\d{2}$/.test(wahl)
  const s: Summe | undefined = !daten
    ? undefined
    : istMonat
      ? daten.monate[wahl]
      : wahl === 'woche'
        ? daten.woche
        : wahl === 'gestern'
          ? daten.gestern
          : daten.heute

  const zeilen = (o: Record<string, Paar> | undefined) =>
    Object.entries(o ?? {})
      .filter(([, v]) => v.ein + v.aus > 0)
      .sort((a, b) => b[1].ein + b[1].aus - (a[1].ein + a[1].aus))
  const spitze = Math.max(0, ...Object.values(s?.spitze ?? {}))
  const monatSumme = aktMonat ? daten?.monate[aktMonat]?.gesamt : undefined
  const alleTage = Object.keys(daten?.tage ?? {}).sort()
  const erfasstSeit = alleTage[0]
  const leer = !!s && s.gesamt.ein + s.gesamt.aus === 0
  const tageDesMonats = istMonat
    ? Object.entries(daten?.tage ?? {})
        .filter(([t]) => t.startsWith(wahl))
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    : []

  return (
    <Abschnitt
      titel={titel}
      rechts={
        daten && (
          <Auswahl
            wert={wahl}
            onWahl={setWahl}
            optionen={[
              { wert: 'heute', text: de ? 'Heute' : 'Today' },
              { wert: 'gestern', text: de ? 'Gestern' : 'Yesterday' },
              { wert: 'woche', text: de ? 'Letzte 7 Tage' : 'Last 7 days' },
              ...monate
                .slice()
                .reverse()
                .map((m) => ({ wert: m, text: monatName(m, de) })),
            ]}
          />
        )
      }
    >
      {fehler && <Hinweis text={fehler} stand={daten ? stand : null} de={de} />}
      {daten?.fehler && <span style={{ color: FARBE_WARTET, fontSize: 12 }}>{daten.fehler}</span>}

      {s && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            <Kachel wert={kurz(s.gesamt.ein, de)} text={de ? 'rein' : 'in'} farbe={FARBE_EIN} />
            <Kachel wert={kurz(s.gesamt.aus, de)} text={de ? 'raus' : 'out'} farbe={FARBE_AUS} />
            <Kachel wert={spitze > 0 ? kurz(spitze, de) : '–'} text={de ? 'max. Kontext' : 'peak ctx'} />
          </div>
          {leer && erfasstSeit && (
            <span style={{ fontSize: 11, opacity: 0.55 }}>
              {de ? `Noch nichts gezählt – erfasst seit ${datumKurz(erfasstSeit, de)}.` : `Nothing counted yet – recording since ${datumKurz(erfasstSeit, de)}.`}
            </span>
          )}
          {!istMonat && monatSumme && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, opacity: 0.85 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55 }}>{monatName(aktMonat, de)}</span>
              <Kennzahl gross={false} wert={kurz(monatSumme.ein, de)} text={de ? 'rein' : 'in'} farbe={FARBE_EIN} />
              <Kennzahl gross={false} wert={kurz(monatSumme.aus, de)} text={de ? 'raus' : 'out'} farbe={FARBE_AUS} />
            </div>
          )}
          <TageVerlauf tage={daten?.tage ?? {}} monat={istMonat ? wahl : ''} onMonat={setWahl} de={de} />
          <Gruppe titel={de ? 'Agenten' : 'Agents'} zeilen={zeilen(s.agenten).map(([k, v]) => ({ key: k, name: hübsch(k), ...v }))} de={de} />
          <Gruppe
            titel={de ? 'Modelle' : 'Models'}
            zeilen={nachNamen(zeilen(s.server).map(([k, v]) => ({ key: k, name: serverName(k), ...v })))}
            de={de}
          />
        </>
      )}

      {istMonat && tageDesMonats.length > 0 && (
        <div style={{ maxHeight: 160, overflow: 'auto', paddingRight: 2 }}>
          <Gruppe
            titel={de ? 'Tage' : 'Days'}
            zeilen={tageDesMonats.map(([t, g]) => ({ key: t, name: datumKurz(t, de), ein: g.ein, aus: g.aus }))}
            de={de}
          />
        </div>
      )}
    </Abschnitt>
  )
}

const datumKurz = (t: string, de: boolean): string => (de ? `${t.slice(8)}.${t.slice(5, 7)}.` : t.slice(5))

/** Kompakte Auswahl im Kopf eines Abschnitts (Zeitraum, Filter). */
function Auswahl({ wert, optionen, onWahl }: { wert: string; optionen: { wert: string; text: string }[]; onWahl: (w: string) => void }) {
  return (
    <select
      value={wert}
      onChange={(e) => onWahl(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'rgba(128,128,128,.12)',
        color: 'inherit', fontSize: 11, cursor: 'pointer', colorScheme: 'dark light', maxWidth: 130,
      }}
    >
      {optionen.map((o) => (
        <option key={o.wert} value={o.wert}>
          {o.text}
        </option>
      ))}
    </select>
  )
}

/** Grosse Zahl in einer ruhigen Box. */
function Kachel({ wert, text, farbe }: { wert: string; text: string; farbe?: string }) {
  return (
    <div style={{ background: 'rgba(128,128,128,.08)', borderRadius: 8, padding: '5px 7px', minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15, color: farbe, ...zahlen, ...eineZeile }}>{wert}</div>
      <div style={{ fontSize: 10, opacity: 0.55, ...eineZeile }}>{text}</div>
    </div>
  )
}

/**
 * Balken je Tag: ohne Monat die letzten 14 Tage, mit Monat alle Tage des Monats.
 * Klick auf einen Balken springt in dessen Monat.
 */
function TageVerlauf({ tage, monat, onMonat, de }: {
  tage: Record<string, { ein: number; aus: number }>
  monat: string
  onMonat: (m: string) => void
  de: boolean
}) {
  const liste: string[] = []
  if (monat) {
    const [j, m] = monat.split('-').map(Number)
    const anzahl = new Date(j, m, 0).getDate()
    for (let d = 1; d <= anzahl; d++) liste.push(`${monat}-${String(d).padStart(2, '0')}`)
  } else {
    for (let d = 13; d >= 0; d--) {
      const x = new Date(Date.now() - d * 86400e3)
      liste.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`)
    }
  }
  const werte = liste.map((t) => ({ t, ein: tage[t]?.ein ?? 0, aus: tage[t]?.aus ?? 0 }))
  const max = Math.max(1, ...werte.map((w) => w.ein + w.aus))
  if (werte.every((w) => w.ein + w.aus === 0)) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.45 }}>
        {monat ? (de ? 'Verlauf im Monat' : 'This month') : de ? 'Letzte 14 Tage' : 'Last 14 days'}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 34 }}>
        {werte.map((w) => {
          const h = ((w.ein + w.aus) / max) * 100
          return (
            <button
              key={w.t}
              type="button"
              title={`${datumKurz(w.t, de)}  ${kurz(w.ein, de)} ${de ? 'rein' : 'in'} / ${kurz(w.aus, de)} ${de ? 'raus' : 'out'}`}
              onClick={() => onMonat(w.t.slice(0, 7))}
              style={{
                flex: 1, minWidth: 2, height: `${Math.max(4, h)}%`, padding: 0, border: 'none', borderRadius: 2, cursor: 'pointer',
                background: w.ein + w.aus === 0 ? 'rgba(128,128,128,.18)' : `linear-gradient(to top, ${FARBE_EIN} ${(w.ein / (w.ein + w.aus)) * 100}%, ${FARBE_AUS} 0)`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. LLM-Tempo
// ---------------------------------------------------------------------------

type Metrics = Record<string, number>
type ServerState = { name: string; state: 'ok' | 'off' | 'no_metrics' | 'error'; metrics?: Metrics }
type TempoZeile = {
  name: string
  state: ServerState['state']
  busy: boolean
  schreibt: number | null
  schnitt: number | null
  liest: number | null
  mtp: number | null
}

/** "Name=URL" je Zeile; ohne Namen wird die Adresse als Name benutzt. */
function parseServers(text: string): { name: string; url: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      if (i > 0 && !l.slice(0, i).includes('://')) return { name: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }
      return { name: l, url: l }
    })
}

/** Alle "Name=URL"-Zeilen -> Adresse -> Name (fuer die Modellnamen im Token-Teil). */
function namenNachAdresse(serversText: string): Record<string, string> {
  const aus: Record<string, string> = {}
  for (const s of parseServers(serversText)) if (s.name !== s.url) aus[normUrl(s.url)] = s.name
  return aus
}

const rate = (tokens?: number, seconds?: number): number | null =>
  tokens !== undefined && seconds !== undefined && seconds > 0 && tokens > 0 ? tokens / seconds : null

const RANG: Record<ServerState['state'], number> = { ok: 3, no_metrics: 2, error: 1, off: 0 }
const rang = (z: TempoZeile): number => RANG[z.state] * 2 + (z.busy ? 1 : 0)
function zusammenfassen(zeilen: TempoZeile[]): TempoZeile[] {
  const beste = new Map<string, TempoZeile>()
  for (const z of zeilen) {
    const alt = beste.get(z.name)
    if (!alt || rang(z) > rang(alt)) beste.set(z.name, z)
  }
  return [...beste.values()]
}

const VERLAUF = 30

/** Kleiner Balkenverlauf der letzten Messungen (t/s beim Schreiben). */
function Verlauf({ werte, farbe }: { werte: number[]; farbe: string }) {
  if (werte.length < 2) return null
  const max = Math.max(...werte, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 16, paddingLeft: 14 }}>
      {werte.map((w, i) => (
        <span key={i} style={{ flex: 1, maxWidth: 6, height: `${Math.max(8, (w / max) * 100)}%`, borderRadius: 1, background: farbe, opacity: 0.35 + 0.65 * ((i + 1) / werte.length) }} />
      ))}
    </div>
  )
}

function TempoTeil({ serversText, nur, refreshMs, active, de }: {
  serversText: string
  nur: string[]
  refreshMs: number
  active: boolean
  de: boolean
}) {
  const servers = useMemo(() => {
    const alle = parseServers(serversText)
    if (nur.length === 0) return alle
    const set = new Set(nur.map((n) => n.toLowerCase()))
    return alle.filter((s) => set.has(s.name.toLowerCase()))
  }, [serversText, nur])
  const serversKey = JSON.stringify(servers)

  const [zeilen, setZeilen] = useState<TempoZeile[]>([])
  const [fehler, setFehler] = useState('')
  const vorher = useRef<Record<string, Metrics>>({})
  const zuletzt = useRef<Record<string, number>>({})
  const verlauf = useRef<Record<string, number[]>>({})

  const load = useCallback(async () => {
    const liste = JSON.parse(serversKey) as { name: string; url: string }[]
    const r = await post<{ servers: ServerState[] }>({ kind: 'tempo', servers: liste })
    if (!r.ok) {
      setFehler(fehlerText(r.fehler, 'LLM-Tempo', de))
      return
    }
    setFehler('')
    const alle = r.data.servers.map((s, i): TempoZeile => {
      // Mehrere Zeilen duerfen denselben Namen tragen (z.B. zwei Modelle auf einer GPU),
      // deshalb die Messwerte je Name + Adresse merken.
      const key = `${s.name}|${liste[i]?.url ?? i}`
      const m = s.metrics
      if (s.state !== 'ok' || !m) {
        delete vorher.current[key]
        delete zuletzt.current[key]
        return { name: s.name, state: s.state, busy: false, schreibt: null, schnitt: null, liest: null, mtp: null }
      }
      const alt = vorher.current[key]
      if (alt && m.tokens_predicted_total >= alt.tokens_predicted_total) {
        const neu = rate(
          m.tokens_predicted_total - alt.tokens_predicted_total,
          m.tokens_predicted_seconds_total - alt.tokens_predicted_seconds_total,
        )
        if (neu !== null) {
          zuletzt.current[key] = neu
          verlauf.current[s.name] = [...(verlauf.current[s.name] ?? []), neu].slice(-VERLAUF)
        }
      }
      vorher.current[key] = m
      const draft = m.spec_decode_num_draft_tokens_total
      return {
        name: s.name,
        state: 'ok',
        busy: (m.requests_processing ?? 0) > 0,
        schreibt: zuletzt.current[key] ?? null,
        schnitt: rate(m.tokens_predicted_total, m.tokens_predicted_seconds_total),
        liest: rate(m.prompt_tokens_total, m.prompt_seconds_total),
        mtp: draft ? (m.spec_decode_num_accepted_tokens_total ?? 0) / draft : null,
      }
    })
    setZeilen(zusammenfassen(alle))
  }, [serversKey, de])
  usePoll(load, refreshMs, active, servers.length > 0)

  const fmt = (n: number | null, d = 1) =>
    n === null ? '–' : n.toLocaleString(de ? 'de-DE' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
  const titel = de ? 'LLM-Tempo' : 'LLM speed'

  if (servers.length === 0) {
    return (
      <Abschnitt titel={titel}>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {serversText.trim()
            ? de ? `Kein Server namens ${nur.join(', ')} eingetragen.` : `No server named ${nur.join(', ')}.`
            : de ? 'Server in den Einstellungen eintragen (Name=URL).' : 'Add a server in the settings (Name=URL).'}
        </span>
      </Abschnitt>
    )
  }

  return (
    <Abschnitt titel={titel}>
      {fehler && <Hinweis text={fehler} stand={null} de={de} />}
      {zeilen.map((z) => {
        const an = z.state === 'ok'
        const farbe = !an ? '#6b7280' : z.busy ? FARBE_AUS : FARBE_EIN
        const zustand =
          z.state === 'off'
            ? de ? 'aus' : 'off'
            : z.state === 'no_metrics'
              ? de ? 'ohne --metrics' : 'no --metrics'
              : z.state === 'error'
                ? de ? 'Fehler' : 'error'
                : z.busy
                  ? de ? 'arbeitet' : 'busy'
                  : de ? 'bereit' : 'idle'
        const haupt = z.schreibt ?? z.schnitt
        const neben = [
          z.liest !== null ? `${de ? 'lesen' : 'in'} ${fmt(z.liest, 0)}` : '',
          z.schreibt !== null && z.schnitt !== null ? `Ø ${fmt(z.schnitt)}` : '',
          z.mtp !== null ? `MTP ${fmt(z.mtp * 100, 0)} %` : '',
        ].filter(Boolean)
        return (
          <div key={z.name} style={{ opacity: an ? 1 : 0.55, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: 4, background: farbe, flexShrink: 0, alignSelf: 'center',
                  boxShadow: z.busy ? `0 0 0 3px ${farbe}33` : 'none',
                }}
              />
              <strong style={{ flex: 1, minWidth: 0, ...eineZeile }}>{z.name}</strong>
              <span style={{ fontSize: 11, opacity: 0.55 }}>{zustand}</span>
              {an && haupt !== null && (
                <span style={{ whiteSpace: 'nowrap', ...zahlen }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: z.busy ? farbe : undefined }}>{fmt(haupt)}</span>
                  <span style={{ fontSize: 11, opacity: 0.6 }}> t/s</span>
                </span>
              )}
            </div>
            {an && haupt !== null && neben.length > 0 && (
              <div style={{ paddingLeft: 14, fontSize: 11, opacity: 0.6, ...zahlen }}>
                {neben.join(' · ')}
                {z.schreibt === null && (de ? ' · Schnitt' : ' · avg')}
              </div>
            )}
            {an && <Verlauf werte={verlauf.current[z.name] ?? []} farbe={farbe} />}
          </div>
        )
      })}
    </Abschnitt>
  )
}

// ---------------------------------------------------------------------------
// 3. Projektstatus
// ---------------------------------------------------------------------------

type Aufgabe = { name: string; zustand: string; text: string }
type Projekt = { name: string; geaendert: string; aufgaben: Aufgabe[]; fragen: string[] }
type Status = { erzeugt: string; projekte: Projekt[]; updates: { meldungen?: string[] } | null }
type Art = 'wartet' | 'arbeit' | 'fertig'

function art(zustand: string): Art {
  const z = zustand.toLowerCase()
  if (z.includes('wartet') || z.includes('waiting')) return 'wartet'
  if (z.includes('fertig') || z.includes('done') || z.includes('✅')) return 'fertig'
  return 'arbeit'
}

const FARBE: Record<Art, string> = { wartet: FARBE_WARTET, arbeit: FARBE_EIN, fertig: FARBE_AUS }

/** Markdown-Reste aus STATUS.md entfernen: **fett**, `code`, fuehrende Haken. */
const sauber = (t: string): string =>
  t.replace(/\*\*/g, '').replace(/`/g, '').replace(/^[\s✅☑✔️⚠️-]+/u, '').replace(/\s+/g, ' ').trim()

/** Platzhalter, die der Agent statt "keine Fragen" in die Liste schreibt. */
const LEER = new Set(['keine', '(keine)', 'keine fragen', 'none', '(none)', 'offen', 'nichts', '-', '–', '—', 'n/a'])

function echteFragen(p: Projekt): string[] {
  const gruende = new Set(p.aufgaben.map((a) => sauber(a.text).toLowerCase()))
  return p.fragen.map(sauber).filter((f) => f && !LEER.has(f.toLowerCase()) && !gruende.has(f.toLowerCase()))
}

/** "Code · viergewinnt" -> Praefix + Name, damit der Name vorne steht. */
function teileName(n: string): { vor: string; name: string } {
  const i = n.indexOf(' · ')
  return i > 0 ? { vor: n.slice(0, i), name: n.slice(i + 3) } : { vor: '', name: n }
}

function Chip({ farbe, children, voll }: { farbe: string; children: ReactNode; voll?: boolean }) {
  return (
    <span
      style={{
        borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', ...zahlen,
        background: voll ? farbe : `${farbe}22`, color: voll ? '#111' : farbe,
      }}
    >
      {children}
    </span>
  )
}

const MAX_AUFGABEN = 8

/** Umschaltbarer Filter (zweiter Klick hebt ihn wieder auf). */
function FilterKnopf({ aktiv, farbe, onClick, children }: { aktiv: boolean; farbe: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: 'inherit', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', ...zahlen,
        border: `1px solid ${aktiv ? farbe : 'transparent'}`, background: aktiv ? `${farbe}33` : `${farbe}17`, color: farbe,
      }}
    >
      {children}
    </button>
  )
}

function ProjektKarte({ p, showDone, de }: { p: Projekt; showDone: boolean; de: boolean }) {
  const [auf, setAuf] = useState(false)
  const fragen = echteFragen(p)
  const alle = p.aufgaben.map((a) => ({ ...a, k: art(a.zustand), name: sauber(a.name), text: sauber(a.text) }))
  const offen = alle.filter((a) => a.k !== 'fertig')
  const fertig = alle.length - offen.length
  const liste = showDone ? alle : offen
  const sichtbar = liste.slice(0, MAX_AUFGABEN)
  const versteckt = liste.length - sichtbar.length
  const farbe = fragen.length ? FARBE.wartet : offen.length ? FARBE.arbeit : FARBE.fertig
  const { vor: praefix, name } = teileName(p.name)
  const anteil = alle.length ? fertig / alle.length : 1

  return (
    <button
      type="button"
      onClick={() => setAuf((v) => !v)}
      title={de ? (auf ? 'Zuklappen' : 'Aufklappen') : auf ? 'Collapse' : 'Expand'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 5, textAlign: 'left', width: '100%',
        background: auf ? 'rgba(128,128,128,.1)' : 'rgba(128,128,128,.05)', border: 'none', borderRadius: 8,
        padding: '6px 8px', color: 'inherit', font: 'inherit', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
        <Ring anteil={anteil} farbe={farbe} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontSize: 13, ...eineZeile }}>{name}</strong>
          <span style={{ fontSize: 10, opacity: 0.5, ...eineZeile }}>
            {praefix && `${praefix} · `}
            {alle.length > 0 ? `${fertig}/${alle.length} ${de ? 'erledigt' : 'done'} · ` : ''}
            {vor(p.geaendert, de)}
          </span>
        </span>
        {fragen.length > 0 && <Chip farbe={FARBE_WARTET} voll>? {fragen.length}</Chip>}
        {offen.length > 0 && <Chip farbe={FARBE_EIN}>{offen.length}</Chip>}
        <span style={{ fontSize: 10, opacity: 0.4, width: 8 }}>{auf ? '▲' : '▼'}</span>
      </div>

      {auf && fragen.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: `${FARBE_WARTET}1a`, borderRadius: 6, padding: '3px 6px' }}>
          {fragen.map((f) => (
            <div key={f} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.3, minWidth: 0 }}>
              <span style={{ color: FARBE_WARTET, fontWeight: 700, flexShrink: 0 }}>?</span>
              <span style={auf ? undefined : eineZeile}>{f}</span>
            </div>
          ))}
        </div>
      )}

      {!auf && fragen.length > 0 && (
        <span style={{ fontSize: 11, lineHeight: 1.3, color: FARBE_WARTET, paddingLeft: 27, ...eineZeile }}>? {fragen[0]}</span>
      )}

      {auf && sichtbar.map((a) => (
        <div key={a.name} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.3, minWidth: 0, opacity: a.k === 'fertig' ? 0.55 : 0.9 }}>
          <span style={{ color: FARBE[a.k], flexShrink: 0 }}>{a.k === 'fertig' ? '✓' : a.k === 'wartet' ? '◷' : '●'}</span>
          <span>
            {a.name}
            {a.text && <span style={{ opacity: 0.6 }}> – {a.text}</span>}
          </span>
        </div>
      ))}
      {auf && versteckt > 0 && <span style={{ fontSize: 11, opacity: 0.5 }}>+ {versteckt} {de ? 'weitere' : 'more'}</span>}
      {auf && fragen.length === 0 && liste.length === 0 && (
        <span style={{ fontSize: 11, opacity: 0.5 }}>{de ? 'nichts offen' : 'nothing open'}</span>
      )}
    </button>
  )
}

/** Kleiner Fortschrittsring (Anteil erledigter Aufgaben), innen der Zustand als Punkt. */
function Ring({ anteil, farbe }: { anteil: number; farbe: string }) {
  const r = 8
  const u = 2 * Math.PI * r
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }} aria-hidden>
      <circle cx={10} cy={10} r={r} fill="none" stroke="rgba(128,128,128,.25)" strokeWidth={2.5} />
      <circle
        cx={10} cy={10} r={r} fill="none" stroke={FARBE_AUS} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${anteil * u} ${u}`} transform="rotate(-90 10 10)"
      />
      <circle cx={10} cy={10} r={3} fill={farbe} />
    </svg>
  )
}

function ProjektTeil({ url, showDone, maxProjekte, refreshMs, active, de }: {
  url: string
  showDone: boolean
  maxProjekte: number
  refreshMs: number
  active: boolean
  de: boolean
}) {
  const [data, setData] = useState<Status | null>(null)
  const [fehler, setFehler] = useState('')
  const [stand, setStand] = useState<number | null>(null)
  const [alleZeigen, setAlleZeigen] = useState(false)
  const [filter, setFilter] = useState<'alle' | Art>('alle')
  const [zeit, setZeit] = useState('alle')

  const load = useCallback(async () => {
    const r = await post<Status>({ kind: 'status', url })
    if (r.ok) {
      setData(r.data)
      setFehler('')
      setStand(Date.now())
    } else {
      setFehler(fehlerText(r.fehler, de ? 'Projektstatus-Dienst' : 'Status service', de))
    }
  }, [url, de])
  usePoll(load, refreshMs, active, !!url)

  const titel = de ? 'Projektstatus' : 'Project status'
  if (!url) {
    return (
      <Abschnitt titel={titel}>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{de ? 'Status-URL in den Einstellungen eintragen.' : 'Set the status URL in the settings.'}</span>
      </Abschnitt>
    )
  }

  const grenze = zeit === 'alle' ? 0 : Date.now() - Number(zeit) * 86400e3
  const projekte = [...(data?.projekte ?? [])]
    .filter((p) => new Date(p.geaendert).getTime() >= grenze)
    .sort((a, b) => {
      const fa = echteFragen(a).length > 0 ? 1 : 0
      const fb = echteFragen(b).length > 0 ? 1 : 0
      return fb - fa || (a.geaendert < b.geaendert ? 1 : -1)
    })
  /** Ein Projekt zaehlt zu genau einer Gruppe: Fragen vor offen vor fertig. */
  const gruppe = (p: Projekt): Art =>
    echteFragen(p).length > 0 ? 'wartet' : p.aufgaben.some((a) => art(a.zustand) !== 'fertig') ? 'arbeit' : 'fertig'
  const anzahl: Record<Art, number> = { wartet: 0, arbeit: 0, fertig: 0 }
  for (const p of projekte) anzahl[gruppe(p)]++
  const gefiltert = filter === 'alle' ? projekte : projekte.filter((p) => gruppe(p) === filter)
  const sichtbar = alleZeigen || maxProjekte <= 0 ? gefiltert : gefiltert.slice(0, maxProjekte)
  const meldungen = data?.updates?.meldungen ?? []
  const umschalten = (k: Art) => {
    setFilter((f) => (f === k ? 'alle' : k))
    setAlleZeigen(false)
  }

  return (
    <Abschnitt
      titel={titel}
      rechts={
        data && (
          <Auswahl
            wert={zeit}
            onWahl={setZeit}
            optionen={[
              { wert: 'alle', text: de ? 'Alle' : 'All' },
              { wert: '7', text: de ? 'Letzte 7 Tage' : 'Last 7 days' },
              { wert: '30', text: de ? 'Letzte 30 Tage' : 'Last 30 days' },
              { wert: '90', text: de ? 'Letzte 3 Monate' : 'Last 3 months' },
            ]}
          />
        )
      }
    >
      {fehler && <Hinweis text={fehler} stand={data ? stand : null} de={de} />}
      {data && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <FilterKnopf aktiv={filter === 'wartet'} farbe={FARBE_WARTET} onClick={() => umschalten('wartet')}>
            ? {anzahl.wartet} {de ? 'Fragen' : 'questions'}
          </FilterKnopf>
          <FilterKnopf aktiv={filter === 'arbeit'} farbe={FARBE_EIN} onClick={() => umschalten('arbeit')}>
            ● {anzahl.arbeit} {de ? 'in Arbeit' : 'active'}
          </FilterKnopf>
          <FilterKnopf aktiv={filter === 'fertig'} farbe={FARBE_AUS} onClick={() => umschalten('fertig')}>
            ✓ {anzahl.fertig} {de ? 'fertig' : 'done'}
          </FilterKnopf>
        </div>
      )}
      {data && gefiltert.length === 0 && (
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {data.projekte.length === 0
            ? de ? 'Noch kein Projekt mit STATUS.md – der Agent legt sie bei der ersten Aufgabe an.' : 'No project with STATUS.md yet.'
            : de ? 'Keine Projekte für diesen Filter.' : 'No projects for this filter.'}
        </span>
      )}
      {sichtbar.map((p) => (
        <ProjektKarte key={p.name} p={p} showDone={showDone} de={de} />
      ))}
      {gefiltert.length > sichtbar.length && (
        <button
          type="button"
          onClick={() => setAlleZeigen(true)}
          style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', fontSize: 12, opacity: 0.6, cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          + {gefiltert.length - sichtbar.length} {de ? 'weitere Projekte' : 'more projects'}
        </button>
      )}
      {meldungen.map((m) => (
        <div key={m} style={{ fontSize: 12, opacity: 0.85 }}>
          🔔 {m}
        </div>
      ))}
    </Abschnitt>
  )
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

/** Wert aus der ersten Kachel eines alten Einzel-Plugins (fuer den Umstieg). */
function useAlterWert(pluginId: string, key: string): string {
  return useDashboardStore((st) => {
    for (const d of st.dashboards) {
      for (const p of d.plugins) {
        if (p.pluginId === pluginId) {
          const v = str(p.config[key])
          if (v.trim()) return v
        }
      }
    }
    return ''
  })
}

const liste = (s: string): string[] => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const { ref, active } = usePollingActive()

  const altToken = useAlterWert('llm-token', 'tokenUrl')
  const altServers = useAlterWert('llm-tempo', 'servers')
  const altStatus = useAlterWert('openclaw-status', 'statusUrl')

  const tokenUrl = str(config.tokenUrl).trim() || altToken
  const serversText = str(config.servers).trim() || altServers
  const statusUrl = str(config.statusUrl).trim() || altStatus
  const nur = useMemo(() => liste(config.nurServer === undefined ? 'RTX2000' : str(config.nurServer)), [config.nurServer])
  const namenNachUrl = useMemo(() => namenNachAdresse(`${altServers}\n${serversText}`), [altServers, serversText])

  const zeigeToken = config.showTokens !== false
  const zeigeTempo = config.showTempo !== false
  const zeigeStatus = config.showStatus !== false

  const teile = [
    zeigeToken && (
      <TokenTeil
        key="token"
        url={tokenUrl}
        zeitraum={str(config.zeitraum) || 'heute'}
        namenNachUrl={namenNachUrl}
        refreshMs={Math.max(15, num(config.tokenRefreshSeconds) || 60) * 1000}
        active={active}
        de={de}
      />
    ),
    zeigeTempo && (
      <TempoTeil key="tempo" serversText={serversText} nur={nur} refreshMs={Math.max(3, num(config.tempoRefreshSeconds) || 5) * 1000} active={active} de={de} />
    ),
    zeigeStatus && (
      <ProjektTeil
        key="status"
        url={statusUrl}
        showDone={config.showDone === true}
        maxProjekte={config.maxProjekte === undefined ? 5 : num(config.maxProjekte)}
        refreshMs={Math.max(15, num(config.statusRefreshSeconds) || 60) * 1000}
        active={active}
        de={de}
      />
    ),
  ].filter(Boolean)

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'auto', fontSize: 13 }}>
      {teile.map((t, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {i > 0 && <div style={trenner} />}
          {t}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const inp: CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' }
const lab: CSSProperties = { display: 'block', fontSize: 12, marginBottom: 4 }
const gruppe: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(128,128,128,.2)', paddingTop: 10 }

function Settings({ config, onChange }: PluginSettingsProps) {
  const { de } = usePluginLocale()
  const altToken = useAlterWert('llm-token', 'tokenUrl')
  const altServers = useAlterWert('llm-tempo', 'servers')
  const altStatus = useAlterWert('openclaw-status', 'statusUrl')
  const leerHinweis = (alt: string) => (alt ? (de ? `leer = aus alter Kachel: ${alt.split('\n')[0]}` : `empty = from old tile: ${alt.split('\n')[0]}`) : '')
  const haken = (key: string, text: string, standard = true) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input
        type="checkbox"
        checked={config[key] === undefined ? standard : config[key] === true}
        onChange={(e) => onChange(key, e.target.checked)}
      />
      {text}
    </label>
  )
  const zahl = (key: string, text: string, standard: number, min: number) => (
    <div>
      <label style={lab}>{text}</label>
      <input style={inp} type="number" min={min} value={config[key] === undefined ? standard : num(config[key])} onChange={(e) => onChange(key, Number(e.target.value))} />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {haken('showTokens', de ? 'Token-Zähler anzeigen' : 'Show token counter')}
        {haken('showTempo', de ? 'LLM-Tempo anzeigen' : 'Show LLM speed')}
        {haken('showStatus', de ? 'Projektstatus anzeigen' : 'Show project status')}
      </div>

      <div style={gruppe}>
        <strong style={{ fontSize: 12 }}>{de ? 'Token-Zähler' : 'Token counter'}</strong>
        <div>
          <label style={lab}>{de ? 'Adresse des Token-Sammlers' : 'Token collector URL'}</label>
          <input style={inp} value={str(config.tokenUrl)} placeholder={leerHinweis(altToken) || 'http://192.168.1.x:8098/tokens'} onChange={(e) => onChange('tokenUrl', e.target.value)} />
        </div>
        <div>
          <label style={lab}>{de ? 'Zeitraum beim Laden' : 'Period on load'}</label>
          <select style={inp} value={str(config.zeitraum) || 'heute'} onChange={(e) => onChange('zeitraum', e.target.value)}>
            <option value="heute">{de ? 'heute' : 'today'}</option>
            <option value="gestern">{de ? 'gestern' : 'yesterday'}</option>
            <option value="woche">{de ? '7 Tage' : '7 days'}</option>
          </select>
        </div>
        {zahl('tokenRefreshSeconds', de ? 'Aktualisieren alle … Sekunden' : 'Refresh every … seconds', 60, 15)}
      </div>

      <div style={gruppe}>
        <strong style={{ fontSize: 12 }}>LLM-Tempo</strong>
        <div>
          <label style={lab}>{de ? 'llama.cpp-Server, je Zeile Name=URL' : 'llama.cpp servers, one Name=URL per line'}</label>
          <textarea
            style={{ ...inp, minHeight: 70, fontFamily: 'monospace' }}
            value={str(config.servers)}
            placeholder={altServers || 'RTX2000=http://192.168.1.x:8080'}
            onChange={(e) => onChange('servers', e.target.value)}
          />
        </div>
        <div>
          <label style={lab}>{de ? 'Nur diese Server anzeigen (Komma, leer = alle)' : 'Only show these servers (comma, empty = all)'}</label>
          <input style={inp} value={config.nurServer === undefined ? 'RTX2000' : str(config.nurServer)} onChange={(e) => onChange('nurServer', e.target.value)} />
        </div>
        {zahl('tempoRefreshSeconds', de ? 'Aktualisieren alle … Sekunden' : 'Refresh every … seconds', 5, 3)}
      </div>

      <div style={gruppe}>
        <strong style={{ fontSize: 12 }}>{de ? 'Projektstatus' : 'Project status'}</strong>
        <div>
          <label style={lab}>{de ? 'Status-URL des Projektstatus-Dienstes' : 'Project status service URL'}</label>
          <input style={inp} value={str(config.statusUrl)} placeholder={leerHinweis(altStatus) || 'http://192.168.1.x:8097/status'} onChange={(e) => onChange('statusUrl', e.target.value)} />
        </div>
        {zahl('maxProjekte', de ? 'Höchstens … Projekte (0 = alle)' : 'At most … projects (0 = all)', 5, 0)}
        {zahl('statusRefreshSeconds', de ? 'Aktualisieren alle … Sekunden' : 'Refresh every … seconds', 60, 15)}
        {haken('showDone', de ? 'Fertige Aufgaben anzeigen' : 'Show finished tasks', false)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'llm-cockpit',
  name: 'LLM-Cockpit',
  description:
    'Token-Zaehler, LLM-Tempo und Projektstatus in einer Kachel: oben die Token (heute und Monat, Klick auf den Titel zeigt Monatsauswahl und Tage), darunter das Tempo der RTX2000, darunter die Projekte mit Fortschritt und offenen Fragen. Uebernimmt die Adressen aus vorhandenen Einzel-Kacheln.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '🧠',
  version: '1.1.0',
  defaultLayout: { w: 4, h: 9, minW: 2, minH: 4 },
  configSchema: [
    { key: 'tokenUrl', label: 'Sammler-URL', type: 'text', defaultValue: '' },
    { key: 'zeitraum', label: 'Zeitraum', type: 'text', defaultValue: 'heute' },
    { key: 'tokenRefreshSeconds', label: 'Token-Aktualisierung (s)', type: 'number', defaultValue: 60 },
    { key: 'servers', label: 'Server (Name=URL je Zeile)', type: 'text', defaultValue: '' },
    { key: 'nurServer', label: 'Nur Server', type: 'text', defaultValue: 'RTX2000' },
    { key: 'tempoRefreshSeconds', label: 'Tempo-Aktualisierung (s)', type: 'number', defaultValue: 5 },
    { key: 'statusUrl', label: 'Status-URL', type: 'text', defaultValue: '' },
    { key: 'maxProjekte', label: 'Max. Projekte', type: 'number', defaultValue: 5 },
    { key: 'statusRefreshSeconds', label: 'Status-Aktualisierung (s)', type: 'number', defaultValue: 60 },
    { key: 'showDone', label: 'Fertige anzeigen', type: 'boolean', defaultValue: false },
    { key: 'showTokens', label: 'Token anzeigen', type: 'boolean', defaultValue: true },
    { key: 'showTempo', label: 'Tempo anzeigen', type: 'boolean', defaultValue: true },
    { key: 'showStatus', label: 'Projektstatus anzeigen', type: 'boolean', defaultValue: true },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
