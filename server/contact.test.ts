import { describe, expect, test } from 'bun:test'
import { contactLimits } from '../shared/contact'
import { clientAddress } from './client-address'
import { ContentValidationError } from './content'
import { cleanContactMessage, createContactHandler, mailConfigFromEnv, sendContactEmail, type MailConfig } from './contact'
import { createRateLimiter } from './rate-limit'

const valid = { name: 'Olena', email: 'olena@example.com', message: 'Do you bake on Sundays?' }
const config: MailConfig = { token: 'secret-token', fromEmail: 'site@palianytsiabread.com', fromName: 'Site', to: 'palianytsiabread@gmail.com' }

describe('contact message validation', () => {
  test('accepts and trims a valid message', () => {
    expect(cleanContactMessage({ name: ' Olena ', email: ' olena@example.com ', message: ' Hello ', website: '' }))
      .toEqual({ name: 'Olena', email: 'olena@example.com', message: 'Hello' })
  })

  test('rejects missing, blank, malformed, and oversized fields', () => {
    const bad = [
      null, [], 'x', {}, { ...valid, name: '  ' }, { ...valid, name: 'x'.repeat(contactLimits.name + 1) },
      { ...valid, email: 'not-an-email' }, { ...valid, email: 'a@b' }, { ...valid, email: 'a b@c.com' }, { ...valid, email: '' },
      { ...valid, message: '   ' }, { ...valid, message: 'x'.repeat(contactLimits.message + 1) },
      { ...valid, name: 5 }, { ...valid, message: null },
    ]
    for (const input of bad) expect(() => cleanContactMessage(input)).toThrow(ContentValidationError)
  })

  test('treats a filled-in hidden field as a bot', () => {
    expect(cleanContactMessage({ ...valid, website: 'http://spam.example' })).toBeNull()
  })
})

describe('mail configuration', () => {
  test('needs a token, a sender, and a recipient', () => {
    const env = { MAILTRAP_API_TOKEN: 't', MAILTRAP_FROM_EMAIL: 'f@x.com', CONTACT_TO_EMAIL: 'to@x.com' }
    expect(mailConfigFromEnv(env)).toEqual({ token: 't', fromEmail: 'f@x.com', to: 'to@x.com', fromName: 'Palianytsia Bread website', inboxId: undefined })
    for (const missing of Object.keys(env)) {
      expect(mailConfigFromEnv({ ...env, [missing]: '  ' })).toBeNull()
      expect(mailConfigFromEnv({ ...env, [missing]: undefined })).toBeNull()
    }
  })

  test('reads the optional sender name and testing inbox', () => {
    const result = mailConfigFromEnv({ MAILTRAP_API_TOKEN: 't', MAILTRAP_FROM_EMAIL: 'f@x.com', CONTACT_TO_EMAIL: 'to@x.com', MAILTRAP_FROM_NAME: 'Bakery', MAILTRAP_INBOX_ID: '123' })
    expect(result).toMatchObject({ fromName: 'Bakery', inboxId: '123' })
  })
})

describe('sending through Mailtrap', () => {
  function capture(status = 200) {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status })
    }) as unknown as typeof fetch
    return { calls, fake }
  }

  test('posts the message to the live sending API with the visitor as reply-to', async () => {
    const { calls, fake } = capture()
    await sendContactEmail(config, valid, fake)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://send.api.mailtrap.io/api/send')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.from).toEqual({ email: 'site@palianytsiabread.com', name: 'Site' })
    expect(body.to).toEqual([{ email: 'palianytsiabread@gmail.com' }])
    expect(body.reply_to).toEqual({ email: 'olena@example.com', name: 'Olena' })
    expect(body.subject).toBe('Website message from Olena')
    expect(body.text).toContain('Name: Olena')
    expect(body.text).toContain('Email: olena@example.com')
    expect(body.text).toContain('Do you bake on Sundays?')
  })

  test('uses the testing inbox endpoint when an inbox id is configured', async () => {
    const { calls, fake } = capture()
    await sendContactEmail({ ...config, inboxId: '4242' }, valid, fake)
    expect(calls[0]!.url).toBe('https://sandbox.api.mailtrap.io/api/send/4242')
  })

  test('keeps line breaks out of the subject and sender name', async () => {
    const { calls, fake } = capture()
    await sendContactEmail(config, { ...valid, name: 'Eve\r\nBcc: evil@example.com' }, fake)
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.subject).not.toMatch(/[\r\n]/)
    expect(body.reply_to.name).not.toMatch(/[\r\n]/)
  })

  test('fails when Mailtrap rejects the request, without exposing the token', async () => {
    const { fake } = capture(401)
    const error = await sendContactEmail(config, valid, fake).catch(cause => cause as Error)
    expect((error as Error).message).toBe('Mailtrap responded with status 401')
    expect((error as Error).message).not.toContain('secret-token')
  })
})

describe('contact handler', () => {
  const sent: string[] = []
  const makeHandler = (overrides: Parameters<typeof createContactHandler>[0] = { config }) =>
    createContactHandler({ send: async (_config, message) => { sent.push(message.email) }, ...overrides })

  test('sends a valid message', async () => {
    sent.length = 0
    const response = await makeHandler()(valid, '1.2.3.4')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(sent).toEqual(['olena@example.com'])
  })

  test('answers 400 for invalid input and sends nothing', async () => {
    sent.length = 0
    const response = await makeHandler()({ ...valid, email: 'nope' }, '1.2.3.4')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Enter a valid email address.')
    expect(sent).toEqual([])
  })

  test('pretends to succeed for bots but sends nothing', async () => {
    sent.length = 0
    const response = await makeHandler()({ ...valid, website: 'spam' }, '1.2.3.4')
    expect(response.status).toBe(200)
    expect(sent).toEqual([])
  })

  test('answers 503 when mail is not configured', async () => {
    const response = await makeHandler({ config: null })(valid, '1.2.3.4')
    expect(response.status).toBe(503)
  })

  test('answers 502 with a friendly message when sending fails', async () => {
    const response = await createContactHandler({ config, send: async () => { throw new Error('boom secret-token') } })(valid, '1.2.3.4')
    expect(response.status).toBe(502)
    const body = JSON.stringify(await response.json())
    expect(body).not.toContain('boom')
    expect(body).not.toContain('secret-token')
  })

  test('limits each visitor and the whole site', async () => {
    sent.length = 0
    const handler = makeHandler({
      config,
      perVisitor: createRateLimiter({ max: 2, windowMs: 1000 }),
      overall: createRateLimiter({ max: 3, windowMs: 1000 }),
    })
    expect((await handler(valid, 'a')).status).toBe(200)
    expect((await handler(valid, 'a')).status).toBe(200)
    expect((await handler(valid, 'a')).status).toBe(429)
    expect((await handler(valid, 'b')).status).toBe(200)
    expect((await handler(valid, 'c')).status).toBe(429)
    expect(sent).toHaveLength(3)
  })
})

describe('rate limiter', () => {
  test('forgets attempts after the window passes', () => {
    let time = 0
    const limiter = createRateLimiter({ max: 2, windowMs: 100, now: () => time })
    expect(limiter.take('x')).toBe(true)
    expect(limiter.take('x')).toBe(true)
    expect(limiter.take('x')).toBe(false)
    time = 101
    expect(limiter.take('x')).toBe(true)
  })
})

describe('client address', () => {
  const request = (forwarded?: string) => new Request('http://localhost/', forwarded ? { headers: { 'X-Forwarded-For': forwarded } } : {})

  test('uses the address nginx forwards when the connection is local', () => {
    expect(clientAddress(request('203.0.113.9'), '127.0.0.1')).toBe('203.0.113.9')
    expect(clientAddress(request('203.0.113.9'), '::1')).toBe('203.0.113.9')
  })

  test('takes the last entry, so a visitor cannot choose their own address', () => {
    expect(clientAddress(request('1.1.1.1, 203.0.113.9'), '127.0.0.1')).toBe('203.0.113.9')
  })

  test('ignores the header on non-local connections and falls back to the socket', () => {
    expect(clientAddress(request('1.1.1.1'), '198.51.100.4')).toBe('198.51.100.4')
    expect(clientAddress(request(), '127.0.0.1')).toBe('127.0.0.1')
    expect(clientAddress(request(), undefined)).toBe('unknown')
  })
})
