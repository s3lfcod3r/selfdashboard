import { NextResponse } from 'next/server'
import { requirePluginAccess } from '@/lib/auth/guard'
import { isReservedPluginApiSegment } from '@/lib/auth/pluginPolicy'
import { loadAllPluginServers } from '@/lib/pluginServerLoader'
import { getPluginServerHandler } from '@/lib/pluginServerRegistry'
import {
  hasPluginReadRule,
  invalidatePluginReadCache,
  isCacheablePluginRead,
  pluginReadCache,
  pluginReadCacheKey,
} from '@/lib/pluginReadCache'
import { manifestReadRule } from '@/lib/pluginReadCacheManifest'
import { createServerTiming } from '@/lib/serverTiming'

export const dynamic = 'force-dynamic'

let serversReady: Promise<void> | null = null
function ensureServers(): Promise<void> {
  if (!serversReady) serversReady = loadAllPluginServers()
  return serversReady
}
void ensureServers()

type RouteParams = { pluginId: string; path?: string[] }

async function dispatch(req: Request, params: RouteParams): Promise<Response> {
  const pluginId = params.pluginId
  if (isReservedPluginApiSegment(pluginId)) {
    return NextResponse.json({ error: 'invalid_plugin_route', pluginId }, { status: 404 })
  }
  const path = params.path ?? []
  const timing = createServerTiming(`${req.method} /api/plugins/${pluginId}/${path.join('/')}`)
  const denied = timing.measure('auth', () => requirePluginAccess(req, pluginId))
  if (denied instanceof NextResponse) return timing.apply(denied)
  // Wartet beim ersten Request nach Start, bis alle server.mjs geladen sind.
  await timing.measure('servers-wait', () => ensureServers())
  const handler = getPluginServerHandler(pluginId)
  if (!handler) {
    return timing.apply(NextResponse.json({ error: 'plugin_not_found', pluginId }, { status: 404 }))
  }
  const manifestRule = manifestReadRule(pluginId)
  if (!hasPluginReadRule(pluginId, manifestRule)) {
    return timing.apply(await timing.measure('handler', () => handler({ pluginId, path, request: req })))
  }

  // Plugin mit Lese-Regel: Body einmal lesen, für jeden (auch späteren Hintergrund-)Aufruf neu verpacken.
  const method = req.method.toUpperCase()
  const bodyText = method === 'GET' || method === 'HEAD' ? '' : await req.text()
  const fresh = () =>
    handler({
      pluginId,
      path,
      request: new Request(req.url, { method, headers: req.headers, body: bodyText || undefined }),
    })
  if (!isCacheablePluginRead(pluginId, method, bodyText, manifestRule)) {
    invalidatePluginReadCache(pluginId)
    return timing.apply(await timing.measure('handler', fresh))
  }
  const key = pluginReadCacheKey(denied.userId, method, req.url, bodyText)
  return timing.apply(await timing.measure('handler', () => pluginReadCache(pluginId).respond(key, fresh)))
}

export async function GET(req: Request, ctx: { params: Promise<RouteParams> }) {
  return dispatch(req, await ctx.params)
}

export async function POST(req: Request, ctx: { params: Promise<RouteParams> }) {
  return dispatch(req, await ctx.params)
}

export async function PUT(req: Request, ctx: { params: Promise<RouteParams> }) {
  return dispatch(req, await ctx.params)
}

export async function PATCH(req: Request, ctx: { params: Promise<RouteParams> }) {
  return dispatch(req, await ctx.params)
}

export async function DELETE(req: Request, ctx: { params: Promise<RouteParams> }) {
  return dispatch(req, await ctx.params)
}
