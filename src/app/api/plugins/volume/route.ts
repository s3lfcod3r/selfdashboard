import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/guard'
import { isPluginAllowed } from '@/lib/auth/pluginPolicy'
import { resolveKioskAccess } from '@/lib/kiosk/kioskViewRequest'
import { getCustomPluginsRoot } from '@/lib/pluginPaths'
import {
  customPluginDir,
  getCustomServerPluginIds,
  getCustomWidgetOverrideIds,
  hasVolumeFile,
  listInstalledVolumePluginIds,
  readInstalledPluginVersion,
} from '@/lib/pluginVolumeInfo'
import { createServerTiming } from '@/lib/serverTiming'
export const dynamic = 'force-dynamic'

function filterIdsForUser(ids: string[], userId: string, role: 'admin' | 'user') {
  return ids.filter((id) => isPluginAllowed(userId, role, id))
}

function filterIdsForKiosk(ids: string[], kioskPluginIds: string[]) {
  const allowed = new Set(kioskPluginIds)
  return ids.filter((id) => allowed.has(id))
}

/** Dateigröße von widget.js — der Client teilt das Widget-Bundle danach in Teile auf. */
function buildWidgetSizes(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of ids) {
    try {
      out[id] = fs.statSync(path.join(customPluginDir(id), 'widget.js')).size
    } catch {
      /* fehlt → Client schätzt */
    }
  }
  return out
}

function buildPluginVersions(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const version = readInstalledPluginVersion(id)
    if (version) out[id] = version
  }
  return out
}

function buildVolumePayload(
  installedFiltered: string[],
  widgetsFiltered: string[],
  overridesFiltered: string[],
  serversFiltered: string[],
  missingWidgetJs: string[],
) {
  return {
    customRoot: getCustomPluginsRoot(),
    volumeOnly: true,
    installedIds: installedFiltered,
    missingWidgetJs: missingWidgetJs.filter((id) => installedFiltered.includes(id)),
    widgetOverrideIds: overridesFiltered,
    customWidgetIds: widgetsFiltered,
    /** Nur diese haben widget.css — Client fragt CSS nicht mehr blind für alle an. */
    widgetCssIds: widgetsFiltered.filter((id) => hasVolumeFile(id, 'widget.css')),
    customServerIds: serversFiltered,
    pluginVersions: buildPluginVersions(widgetsFiltered),
    widgetSizes: buildWidgetSizes(widgetsFiltered),
    hint:
      missingWidgetJs.length > 0
        ? 'plugin.json without widget.js — install from Store or upload a ZIP with widget.js.'
        : undefined,
  }
}

export async function GET(req: Request) {
  const timing = createServerTiming('GET /api/plugins/volume')
  const { widgetOverrideIds, customWidgetIds, customServerIds, installedIds, missingWidgetJs } = timing.measure(
    'scan',
    () => {
      const widgetOverrideIds = getCustomWidgetOverrideIds()
      const customWidgetIds = listInstalledVolumePluginIds().filter((id) => hasVolumeFile(id, 'widget.js'))
      const customServerIds = getCustomServerPluginIds()
      const installedIds = listInstalledVolumePluginIds()
      const missingWidgetJs = installedIds.filter((id) => !hasVolumeFile(id, 'widget.js'))
      return { widgetOverrideIds, customWidgetIds, customServerIds, installedIds, missingWidgetJs }
    },
    'volume dirs',
  )

  const auth = timing.measure('auth', () => requireAuth(req))
  if (!(auth instanceof NextResponse)) {
    const payload = timing.measure(
      'payload',
      () =>
        buildVolumePayload(
          filterIdsForUser(installedIds, auth.userId, auth.role),
          filterIdsForUser(customWidgetIds, auth.userId, auth.role),
          filterIdsForUser(widgetOverrideIds, auth.userId, auth.role),
          filterIdsForUser(customServerIds, auth.userId, auth.role),
          missingWidgetJs,
        ),
      'plugin.json versions',
    )
    return timing.apply(NextResponse.json(payload))
  }

  const kioskView = resolveKioskAccess(req)
  if (kioskView) {
    const payload = timing.measure(
      'payload',
      () =>
        buildVolumePayload(
          filterIdsForKiosk(installedIds, kioskView.pluginIds),
          filterIdsForKiosk(customWidgetIds, kioskView.pluginIds),
          filterIdsForKiosk(widgetOverrideIds, kioskView.pluginIds),
          filterIdsForKiosk(customServerIds, kioskView.pluginIds),
          missingWidgetJs,
        ),
      'plugin.json versions',
    )
    return timing.apply(NextResponse.json(payload))
  }

  return timing.apply(auth)
}
