import { describe, expect, test } from 'bun:test'
import { createAdminAuth } from './auth'

function loginRequest(password: string) {
  return new Request('http://localhost/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  })
}

function sessionRequest(response: Response) {
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]
  return new Request('http://localhost/api/admin/session', { headers: { Cookie: cookie } })
}

describe('admin sessions', () => {
  test('rejects incorrect passwords and unsigned requests', async () => {
    const auth = createAdminAuth({ password: 'test-password' })
    expect(auth.authorized(new Request('http://localhost/api/front-page'))).toBe(false)
    expect((await auth.login(loginRequest('wrong'), 'local')).status).toBe(401)
    expect(auth.authorized(new Request('http://localhost', { headers: { Authorization: 'Bearer test-password' } }))).toBe(false)
  })

  test('issues a secure cookie, authenticates it, and invalidates it on logout', async () => {
    const auth = createAdminAuth({ password: 'test-password', secureCookies: true })
    const response = await auth.login(loginRequest('test-password'), 'local')
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800; Secure')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const request = sessionRequest(response)
    expect(auth.authorized(request)).toBe(true)
    expect(auth.logout(request).headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(auth.authorized(request)).toBe(false)
  })

  test('sessions expire after eight hours', async () => {
    let now = 0
    const auth = createAdminAuth({ password: 'test-password', now: () => now })
    const request = sessionRequest(await auth.login(loginRequest('test-password'), 'local'))
    expect(auth.authorized(request)).toBe(true)
    now = 8 * 60 * 60 * 1000
    expect(auth.authorized(request)).toBe(false)
  })

  test('throttles repeated failures and allows another attempt after the window', async () => {
    let now = 0
    const auth = createAdminAuth({ password: 'test-password', now: () => now })
    for (let i = 0; i < 10; i++) expect((await auth.login(loginRequest('wrong'), 'local')).status).toBe(401)
    expect((await auth.login(loginRequest('test-password'), 'local')).status).toBe(429)
    now = 5 * 60 * 1000
    expect((await auth.login(loginRequest('test-password'), 'local')).status).toBe(200)
  })

  test('fails closed when no password is configured', async () => {
    const auth = createAdminAuth({ password: undefined })
    expect((await auth.login(loginRequest(''), 'local')).status).toBe(503)
  })
})
