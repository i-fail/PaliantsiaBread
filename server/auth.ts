import { CookieMap } from 'bun'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const cookieName = 'palianytsia_admin'
const sessionLifetime = 8 * 60 * 60 * 1000
const attemptWindow = 5 * 60 * 1000

export function createAdminAuth({ password, secureCookies = false, now = Date.now }: {
  password: string | undefined
  secureCookies?: boolean
  now?: () => number
}) {
  const sessions = new Map<string, number>()
  const attempts = new Map<string, { count: number; expires: number }>()

  function token(request: Request) {
    return new CookieMap(request.headers.get('Cookie') ?? '').get(cookieName)
  }

  function cookie(value: string, maxAge: number) {
    return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`
  }

  function json(body: unknown, status = 200, setCookie?: string) {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
    if (setCookie) headers['Set-Cookie'] = setCookie
    return Response.json(body, { status, headers })
  }

  function authorized(request: Request) {
    const value = token(request)
    if (!password || !value) return false
    const expires = sessions.get(value)
    if (!expires) return false
    if (expires <= now()) {
      sessions.delete(value)
      return false
    }
    return true
  }

  return {
    authorized,
    session: (request: Request) => json({ authenticated: authorized(request) }),
    async login(request: Request, address: string) {
      if (!password) return json({ error: 'Admin access is not configured. Set ADMIN_PASSWORD on the server.' }, 503)
      if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
        return json({ error: 'Send credentials as JSON.' }, 415)
      }

      for (const [key, entry] of attempts) if (entry.expires <= now()) attempts.delete(key)
      const attempt = attempts.get(address)
      if (attempt && attempt.count >= 10) return json({ error: 'Too many attempts. Please try again in five minutes.' }, 429)

      let supplied: unknown
      try {
        const body = await request.json()
        supplied = body?.password
      } catch {
        return json({ error: 'Invalid JSON.' }, 400)
      }
      const digest = (value: string) => createHash('sha256').update(value).digest()
      if (typeof supplied !== 'string' || supplied.length > 1024 || !timingSafeEqual(digest(supplied), digest(password))) {
        attempts.set(address, { count: (attempt?.count ?? 0) + 1, expires: attempt?.expires ?? now() + attemptWindow })
        return json({ error: 'The admin password is incorrect.' }, 401)
      }

      attempts.delete(address)
      for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key)
      const oldToken = token(request)
      if (oldToken) sessions.delete(oldToken)
      const sessionToken = randomBytes(32).toString('hex')
      sessions.set(sessionToken, now() + sessionLifetime)
      return json({ authenticated: true }, 200, cookie(sessionToken, sessionLifetime / 1000))
    },
    logout(request: Request) {
      const value = token(request)
      if (value) sessions.delete(value)
      return json({ authenticated: false }, 200, cookie('', 0))
    },
  }
}
