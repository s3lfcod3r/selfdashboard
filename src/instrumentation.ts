/** Next.js instrumentation — runs once on server start (Node.js runtime only). */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const t0 = performance.now()
    const lap = (() => {
      let last = t0
      return () => {
        const now = performance.now()
        const ms = now - last
        last = now
        return `${ms.toFixed(0)}ms`
      }
    })()
    const { logServerTiming } = await import('@/lib/serverTiming')
    const { warnInsecureProductionEnv } = await import('@/lib/auth/productionGuard')
    warnInsecureProductionEnv()

    const { ensureDefaultPluginsOnVolume } = await import('@/lib/pluginVolumeExtract')
    ensureDefaultPluginsOnVolume()
    const tExtract = lap()

    const { warmPluginScan } = await import('@/lib/pluginScan')
    const { loadAllPluginServers } = await import('@/lib/pluginServerLoader')
    const { listInstalledVolumePluginIds } = await import('@/lib/pluginVolumeInfo')

    warmPluginScan()
    const tScan = lap()
    await loadAllPluginServers()
    const tServers = lap()
    logServerTiming(
      `Start: extract=${tExtract} scan=${tScan} servers=${tServers} gesamt=${(performance.now() - t0).toFixed(0)}ms`,
    )

    if (listInstalledVolumePluginIds().includes('calendar')) {
      const { startScheduler } = await import('@/lib/calendar/sync')
      startScheduler()
    }
  }
}
