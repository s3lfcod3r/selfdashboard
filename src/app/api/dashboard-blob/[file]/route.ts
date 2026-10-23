import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/guard'
import { BLOB_FILE_RE, MIME_BY_EXT, blobDir } from '@/lib/dashboardBlobs'
import { resolveKioskAccess } from '@/lib/kiosk/kioskViewRequest'

export const dynamic = 'force-dynamic'

/**
 * Ausgelagerte Bilder aus Widget-Konfigurationen (siehe lib/dashboardBlobs).
 * Dateiname = SHA-256 des Inhalts → unveränderlich, dauerhaft cachebar.
 */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  const m = BLOB_FILE_RE.exec(file)
  if (!m) return NextResponse.json({ error: 'invalid_path' }, { status: 400 })

  const auth = requireAuth(req)
  if (auth instanceof NextResponse && !resolveKioskAccess(req)) return auth

  const abs = path.join(blobDir(), file)
  let body: Buffer
  try {
    body = await fs.promises.readFile(abs)
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const headers: Record<string, string> = {
    'Content-Type': MIME_BY_EXT[m[2]] ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  }
  // SVGs können Skript enthalten: nur als <img> nutzbar, nie als aktives Dokument.
  if (m[2] === 'svg') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  return new NextResponse(new Uint8Array(body), { headers })
}
