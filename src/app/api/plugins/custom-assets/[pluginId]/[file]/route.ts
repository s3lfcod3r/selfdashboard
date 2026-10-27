import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { requirePluginAccess } from '@/lib/auth/guard'
import { customPluginDir, readInstalledPluginVersion } from '@/lib/pluginVolumeInfo'
import { createServerTiming } from '@/lib/serverTiming'
import { prepareWidgetJs } from '@/lib/pluginWidgetJs'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function safeFile(name: string): boolean {
  return name === path.basename(name) && !name.includes('..') && name.length > 0
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pluginId: string; file: string }> },
) {
  const { pluginId, file } = await ctx.params
  const timing = createServerTiming(`GET custom-assets/${pluginId}/${file}`)
  const denied = timing.measure('auth', () => requirePluginAccess(req, pluginId))
  if (denied instanceof NextResponse) return timing.apply(denied)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId) || !safeFile(file)) {
    return timing.apply(NextResponse.json({ error: 'invalid_path' }, { status: 400 }))
  }

  const dir = customPluginDir(pluginId)
  const abs = path.join(dir, file)
  const exists = timing.measure(
    'stat',
    () => path.resolve(abs).startsWith(path.resolve(dir)) && fs.existsSync(abs) && fs.statSync(abs).isFile(),
  )
  if (!exists) {
    return timing.apply(NextResponse.json({ error: 'not_found' }, { status: 404 }))
  }

  const ext = path.extname(file).toLowerCase()
  let body = timing.measure('read', () => fs.readFileSync(abs))
  timing.add('size', 0, `${Math.round(body.length / 1024)}KB`)
  if (ext === '.js' || ext === '.mjs') {
    body = Buffer.from(await prepareWidgetJs(body.toString('utf8'), timing), 'utf8')
  }
  // Mit ?v=<installierte Version> unveränderlich (widget.js/css, aber auch nachgeladene
  // Daten wie die CrowdSec-Weltkarte); ein Plugin-Update ändert die Version und damit die URL.
  const versionParam = new URL(req.url).searchParams.get('v')?.trim() ?? ''
  const installedVersion = versionParam ? timing.measure('version', () => readInstalledPluginVersion(pluginId) ?? '') : ''
  const versionMatches = Boolean(versionParam && installedVersion && versionParam === installedVersion)
  const cacheControl = versionMatches ? 'private, max-age=31536000, immutable' : 'no-store'

  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
    // Manually-built NextResponse does not inherit next.config.js headers().
    'X-Content-Type-Options': 'nosniff',
  }
  // SVGs are active documents: served inline they can execute embedded script
  // (stored XSS). Force download and forbid any resource loading/execution.
  if (ext === '.svg') {
    headers['Content-Disposition'] = `attachment; filename="${file}"`
    headers['Content-Security-Policy'] = "default-src 'none'; sandbox"
  }

  return timing.apply(new NextResponse(body, { headers }))
}
