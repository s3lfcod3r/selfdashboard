import 'server-only'
import { isAuthDisabled } from '@/lib/auth/service'
import { resolveSessionCookieSecure } from '@/lib/auth/cookies'

let warned = false

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production'
}

function hasAuthResetEnv(): boolean {
  return Boolean(
    process.env.SELFDASHBOARD_AUTH_RESET?.trim() ||
      process.env.SELFDASHBOARD_AUTH_RESET_PASSWORD?.trim() ||
      process.env.SELFDASHBOARD_AUTH_RESET_USER?.trim(),
  )
}

/** Log once on server start when risky env vars are set in production. */
export function warnInsecureProductionEnv(): void {
  if (!isProductionRuntime() || warned) return
  warned = true

  if (isAuthDisabled()) {
    console.error(
      '[security] SELFDASHBOARD_AUTH_DISABLED is set in production — remove it before exposing the app.',
    )
  }

  if (hasAuthResetEnv()) {
    console.error(
      '[security] SELFDASHBOARD_AUTH_RESET* is set in production — remove after use; reset is ignored.',
    )
  }

  if (!resolveSessionCookieSecure()) {
    console.warn(
      '[security] Session cookies are not Secure. Set SELFDASHBOARD_SECURE_COOKIES=1 when serving over HTTPS.',
    )
  }
}

/**
 * Whether the operator explicitly opted in to env-based password reset in production.
 * Acts as a safety net in case NODE_ENV is not set to 'production' in the container.
 */
function hasProductionResetOptIn(): boolean {
  const value = process.env.SELFDASHBOARD_ENABLE_ENV_RESET?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * Allow the one-time env password reset.
 *
 * - Outside production: always allowed (homelab convenience).
 * - In production: only when SELFDASHBOARD_ENABLE_ENV_RESET is explicitly set,
 *   so a forgotten NODE_ENV cannot leave the reset path silently enabled.
 */
export function allowEnvPasswordReset(): boolean {
  if (!isProductionRuntime()) return true
  return hasProductionResetOptIn()
}
