/**
 * Auth-Guards des Hosts für Volume-Plugins (server.mjs).
 *
 * Gebündelte server.mjs können `@/lib/auth/guard` nicht importieren. Der Host
 * (src/lib/pluginCustomServer.ts) legt die echten Guards vor dem Laden auf
 * globalThis ab; diese Datei reicht sie durch. Fehlt die Brücke (älteres Image),
 * wird abgelehnt — niemals stillschweigend erlaubt.
 *
 * Aufrufer prüfen das Ergebnis mit `instanceof Response` (nicht NextResponse:
 * die Klasse im Bundle ist eine andere als die des Hosts).
 */

type GuardFn = (req: Request) => unknown

type HostGuards = {
  requireAuth?: GuardFn
  requireAdmin?: GuardFn
  requireFullAdmin?: GuardFn
}

function hostGuards(): HostGuards | undefined {
  return (globalThis as Record<string, unknown>).__selfDashboardServerHost as HostGuards | undefined
}

function call(name: keyof HostGuards, req: Request): unknown {
  const fn = hostGuards()?.[name]
  if (typeof fn !== 'function') {
    return Response.json({ error: 'forbidden', detail: 'host_guard_missing' }, { status: 403 })
  }
  return fn(req)
}

export function requireAuth(req: Request): unknown {
  return call('requireAuth', req)
}

export function requireAdmin(req: Request): unknown {
  return call('requireAdmin', req)
}

export function requireFullAdmin(req: Request): unknown {
  return call('requireFullAdmin', req)
}
