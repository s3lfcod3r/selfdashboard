import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/guard'
import { listMissingDashboardPlugins } from '@/lib/pluginInstallMissing'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const data = await listMissingDashboardPlugins()
  return NextResponse.json(data)
}
