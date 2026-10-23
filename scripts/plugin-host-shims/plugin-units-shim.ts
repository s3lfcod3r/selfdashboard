/** Esbuild shim: unit system hook from the host app store. */
export function usePluginUnitSystem(): ReturnType<
  NonNullable<typeof globalThis.SelfDashboard>['usePluginUnitSystem']
> {
  const fn = globalThis.SelfDashboard?.usePluginUnitSystem
  // Older host images lack the hook — fall back to metric instead of breaking the widget.
  if (!fn) return { unitSystem: 'metric', resolved: 'metric' }
  return fn()
}
