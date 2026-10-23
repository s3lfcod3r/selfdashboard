/**
 * Worker-Thread-Einstieg für die CrowdSec-Auswertung.
 *
 * better-sqlite3 arbeitet synchron — im Hauptthread blockierte jede Auswertung
 * (~1 s) den kompletten Node-Server. Hier läuft sie in einem eigenen Thread.
 * Gebaut von scripts/build-server-workers.mjs nach server-workers/crowdsec-worker.mjs;
 * angesprochen über ./crowdsecDashboardRunner.ts.
 */
import { parentPort } from 'node:worker_threads'
import { loadCrowdsecDashboard, type CrowdsecDbOptions } from './crowdsecDb'

type WorkerRequest = { id: number; dbPath: string; opts: CrowdsecDbOptions }

parentPort?.on('message', (msg: WorkerRequest) => {
  loadCrowdsecDashboard(msg.dbPath, msg.opts).then(
    (data) => parentPort?.postMessage({ id: msg.id, ok: true, data }),
    (e: unknown) => parentPort?.postMessage({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
  )
})
