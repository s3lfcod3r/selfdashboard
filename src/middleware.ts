import { NextResponse, type NextRequest } from 'next/server'
import { readSessionIdFromCookieHeader } from '@/lib/auth/cookies'
import {
  checkApiPluginAccess,
  getSessionFromRequest,
  isAdminOnlyApiPath,
  isKioskApiPath,
  isLoginPath,
  isMfaPendingAllowedApi,
  isPublicPath,
  isSetupPath,
  isTotpLoginPath,
} from '@/lib/auth/guard'
import { isAuthDisabled } from '@/lib/auth/service'
import {
  isPluginAllowedForKiosk,
  resolvePluginIdFromApiPath,
} from '@/lib/kiosk/kioskApiAccess'
import { resolveKioskAccess } from '@/lib/kiosk/kioskViewRequest'
import { needsSetup } from '@/lib/auth/users'

export const runtime = 'nodejs'

/**
 * Internal identity headers set by the middleware for downstream route handlers.
 * They MUST only ever be set on the *request* (never the response) and any
 * client-supplied copies must be stripped first, so a caller cannot spoof their
 * identity by sending these headers directly.
 */
const INTERNAL_IDENTITY_HEADERS = ['x-sd-user-id', 'x-sd-role', 'x-sd-kiosk'] as const

/** Clone request headers and remove any client-supplied internal identity headers. */
function sanitizedRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers)
  for (const name of INTERNAL_IDENTITY_HEADERS) headers.delete(name)
  return headers
}

function nextWithKioskHeaders(request: NextRequest, kioskAccess: { ownerUserId: string }) {
  const requestHeaders = sanitizedRequestHeaders(request)
  requestHeaders.set('x-sd-user-id', kioskAccess.ownerUserId)
  requestHeaders.set('x-sd-role', 'user')
  requestHeaders.set('x-sd-kiosk', '1')
  // Set only on the request for internal handlers — never echo identity on the response.
  return NextResponse.next({ request: { headers: requestHeaders } })
}

/** Forward the request with all client-supplied internal identity headers stripped. */
function nextWithoutClientIdentity(request: NextRequest): NextResponse {
  const headers = sanitizedRequestHeaders(request)
  return NextResponse.next({ request: { headers } })
}

function allowKioskPluginApi(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (!pathname.startsWith('/api/')) return null
  const kioskAccess = resolveKioskAccess(request)
  if (!kioskAccess) return null
  const pluginId = resolvePluginIdFromApiPath(pathname)
  const volumeOk = pathname === '/api/plugins/volume'
  if (!volumeOk && !(pluginId && isPluginAllowedForKiosk(kioskAccess, pluginId))) return null
  return nextWithKioskHeaders(request, kioskAccess)
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return nextWithoutClientIdentity(request)
  }

  if (isAuthDisabled()) {
    return nextWithoutClientIdentity(request)
  }

  const setupRequired = needsSetup()

  if (setupRequired) {
    if (isSetupPath(pathname)) return nextWithoutClientIdentity(request)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'setup_required' }, { status: 503 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/setup'
    return NextResponse.redirect(url)
  }

  if (isSetupPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (isLoginPath(pathname)) {
    const sessionId = readSessionIdFromCookieHeader(request.headers.get('cookie'))
    const session = sessionId ? getSessionFromRequest(request) : null
    if (session?.mfaVerified) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard/home'
      return NextResponse.redirect(url)
    }
    if (session && !session.mfaVerified) {
      const url = request.nextUrl.clone()
      url.pathname = '/login/totp'
      url.searchParams.set('next', request.nextUrl.searchParams.get('next') || '/dashboard/home')
      return NextResponse.redirect(url)
    }
    return nextWithoutClientIdentity(request)
  }

  if (isTotpLoginPath(pathname)) {
    const session = getSessionFromRequest(request)
    if (!session) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    if (session.mfaVerified) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard/home'
      return NextResponse.redirect(url)
    }
    return nextWithoutClientIdentity(request)
  }

  const session = getSessionFromRequest(request)
  if (session && !session.mfaVerified) {
    if (pathname.startsWith('/api/') && isMfaPendingAllowedApi(pathname)) {
      return nextWithoutClientIdentity(request)
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login/totp'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (!session) {
    if (isKioskApiPath(pathname)) {
      return nextWithoutClientIdentity(request)
    }
    const kioskAllowed = allowKioskPluginApi(request)
    if (kioskAllowed) return kioskAllowed
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/api/') && isAdminOnlyApiPath(pathname, request.method)) {
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const kioskAllowed = allowKioskPluginApi(request)
  if (kioskAllowed) return kioskAllowed

  if (pathname.startsWith('/api/')) {
    const pluginDenied = checkApiPluginAccess(session, pathname)
    if (pluginDenied) return pluginDenied
  }

  const requestHeaders = sanitizedRequestHeaders(request)
  requestHeaders.set('x-sd-user-id', session.userId)
  requestHeaders.set('x-sd-role', session.role)
  // Set only on the request for internal handlers — never echo identity on the response.
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/kiosk',
    '/login',
    '/login/totp',
    '/setup',
    '/api/:path*',
  ],
}
