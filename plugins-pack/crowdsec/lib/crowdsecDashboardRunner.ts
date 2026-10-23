import fs from 'fs'
import path from 'path'
import { Worker } from 'node:worker_threads'
import { loadCrowdsecDashboard, type CrowdsecDbOptions } from './crowdsecDb'
import type { CrowdsecDashboardData } from './crowdsecMetrics'

/**
 * Führt die CrowdSec-Auswertung in einem Worker-Thread aus (siehe ./crowdsecWorker.ts),
 * damit die synchronen SQLite-Abfragen den Server nicht blockieren.
 *
 * Fehlt die Worker-Datei (z. B. `next dev`) oder fällt der Worker selbst aus,
 * läuft die Auswertung wie früher im Hauptthread. Fachliche Fehler
 * (db_not_found, db_schema_unsupported …) kommen unverändert als Error-Message zurück.
 */

const MAX_WORKER_FAILURES = 3

class WorkerFailure extends Error {}

type Pending = { resolve: (data: CrowdsecDashboardData) => void; reject: (e: Error) => void }
type WorkerReply = { id: number; ok: boolean; data?: CrowdsecDashboardData; error?: string }

let worker: Worker | null = null
let nextId = 1
let failures = 0
let disabled = false
const pending = new Map<number, Pending>()

function workerFile(): string | null {
  const file = path.join(process.cwd(), 'server-workers', 'crowdsec-worker.mjs')
  return fs.existsSync(file) ? file : null
}

function failWorker(w: Worker, err: Error): void {
  if (worker === w) worker = null
  const failure = new WorkerFailure(err.message)
  for (const p of pending.values()) p.reject(failure)
  pending.clear()
  failures += 1
  if (failures >= MAX_WORKER_FAILURES && !disabled) {
    disabled = true
    console.warn(`[SelfDashboard][crowdsec] Worker ${failures}x ausgefallen — Auswertung läuft ab jetzt im Hauptthread (${err.message})`)
  }
}

function getWorker(): Worker | null {
  if (disabled) return null
  if (worker) return worker
  const file = workerFile()
  if (!file) {
    disabled = true
    return null
  }
  const w = new Worker(file)
  w.unref()
  w.on('message', (msg: WorkerReply) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    failures = 0
    if (msg.ok && msg.data) p.resolve(msg.data)
    else p.reject(new Error(msg.error || 'crowdsec_error'))
  })
  w.on('error', (err) => failWorker(w, err))
  w.on('exit', (code) => {
    if (worker === w) failWorker(w, new Error(`crowdsec_worker_exit_${code}`))
  })
  worker = w
  return w
}

export function loadCrowdsecDashboardOffThread(
  dbPath: string,
  opts: CrowdsecDbOptions = {},
): Promise<CrowdsecDashboardData> {
  const w = getWorker()
  if (!w) return loadCrowdsecDashboard(dbPath, opts)
  return new Promise<CrowdsecDashboardData>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    w.postMessage({ id, dbPath, opts })
  }).catch((e: unknown) => {
    if (e instanceof WorkerFailure) return loadCrowdsecDashboard(dbPath, opts)
    throw e
  })
}
