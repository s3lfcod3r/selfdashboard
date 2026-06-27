import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/guard'
import { buildTotpQrDataUrl } from '@/lib/auth/totpQr'
import {  adminMustSetupTotp,
  buildOtpAuthUri,
  generateTotpSecret,
  isTotpEnabledForUser,
} from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = requireAuth(req)
  if (auth instanceof NextResponse) return auth

  // "replace" = enrolling a new authenticator device while 2FA stays enabled
  // (e.g. phone swap). This is the only way an admin under mandatory 2FA can
  // rotate devices without first disabling 2FA, which the policy forbids.
  const replace = new URL(req.url).searchParams.get('replace') === '1'
  const enabled = isTotpEnabledForUser(auth.userId)

  if (replace) {
    if (!enabled) {
      // Nothing to replace — fall back to the normal first-time setup below.
      return NextResponse.json({ error: 'not_enabled' }, { status: 400 })
    }
    // Rotating an active second factor is a sensitive action: require that this
    // session already passed MFA (the new secret is only persisted on confirm).
    if (!auth.mfaVerified) {
      return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
    }
  } else {
    if (enabled) {
      return NextResponse.json({ error: 'already_enabled' }, { status: 400 })
    }
    const mandatorySetup = adminMustSetupTotp(auth.userId, auth.role)
    if (!auth.mfaVerified && !mandatorySetup) {
      return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
    }
  }

  const secret = generateTotpSecret()
  const uri = buildOtpAuthUri(auth.username, secret)
  const qrDataUrl = await buildTotpQrDataUrl(uri)
  return NextResponse.json({
    ok: true,
    secret,
    uri,
    qrDataUrl,
  })
}
