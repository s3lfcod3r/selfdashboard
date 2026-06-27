import { NextResponse } from 'next/server'
import { requireFullAuth } from '@/lib/auth/guard'
import { rateLimitResponse, rateLimitTotpEnable } from '@/lib/auth/rateLimit'
import { markSessionMfaVerified } from '@/lib/auth/sessions'
import { verifyUserPassword } from '@/lib/auth/users'
import {
  enableTotpForUser,
  generateBackupCodes,
  isTotpEnabledForUser,
  verifyTotpCodeStep,
} from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

/**
 * Rotate the TOTP authenticator to a new device without ever disabling 2FA.
 * Lets an admin under mandatory 2FA swap phones (the /disable route refuses
 * that with admin_totp_required). Re-auth = current password (step-up) plus a
 * valid code from the NEW secret, which proves the new device is set up. The
 * swap overwrites the secret and issues fresh backup codes atomically.
 */
export async function POST(req: Request) {
  const auth = requireFullAuth(req)
  if (auth instanceof NextResponse) return auth

  const rl = rateLimitTotpEnable(req, auth.userId)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  if (!isTotpEnabledForUser(auth.userId)) {
    // Nothing to replace — the caller should use /enable for first-time setup.
    return NextResponse.json({ error: 'not_enabled' }, { status: 400 })
  }

  let body: { password?: string; secret?: string; code?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const password = String(body.password ?? '')
  const secret = String(body.secret ?? '').trim()
  const code = String(body.code ?? '').trim()
  if (!password || !secret || !code) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  if (!verifyUserPassword(auth.userId, password)) {
    return NextResponse.json({ error: 'wrong_password' }, { status: 403 })
  }

  // Code must match the NEW secret, proving the new authenticator is enrolled.
  const step = verifyTotpCodeStep(secret, code)
  if (step === null) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 403 })
  }

  // Overwrite the secret and record the consumed step so the enrollment code
  // cannot be replayed at login.
  enableTotpForUser(auth.userId, secret, step)
  const backupCodes = generateBackupCodes(auth.userId)
  markSessionMfaVerified(auth.id)

  return NextResponse.json({ ok: true, backupCodes })
}
