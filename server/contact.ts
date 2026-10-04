import { contactLimits, emailPattern, type ContactMessage } from '../shared/contact'
import { ContentValidationError } from './content'
import { createRateLimiter } from './rate-limit'

export interface MailConfig {
  token: string
  fromEmail: string
  fromName: string
  to: string
  // When set, mail goes to this Mailtrap testing inbox instead of the real recipient (for development).
  inboxId?: string
}

export function mailConfigFromEnv(env: Record<string, string | undefined>): MailConfig | null {
  const token = env.MAILTRAP_API_TOKEN?.trim()
  const fromEmail = env.MAILTRAP_FROM_EMAIL?.trim()
  const to = env.CONTACT_TO_EMAIL?.trim()
  if (!token || !fromEmail || !to) return null
  return {
    token,
    fromEmail,
    to,
    fromName: env.MAILTRAP_FROM_NAME?.trim() || 'Palianytsia Bread website',
    inboxId: env.MAILTRAP_INBOX_ID?.trim() || undefined,
  }
}

// Returns null when the hidden "website" field was filled in, which only automated senders do.
export function cleanContactMessage(value: unknown): ContactMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentValidationError('Enter your name, email, and message.')
  }
  const source = value as Record<string, unknown>
  if (typeof source.website === 'string' && source.website.trim()) return null

  const text = (field: 'name' | 'email' | 'message') => {
    const entry = source[field]
    if (typeof entry !== 'string') throw new ContentValidationError(`Enter your ${field}.`)
    return entry.trim()
  }
  const name = text('name')
  const email = text('email')
  const message = text('message')

  if (!name) throw new ContentValidationError('Enter your name.')
  if (name.length > contactLimits.name) throw new ContentValidationError(`Your name must be at most ${contactLimits.name} characters.`)
  if (!email || email.length > contactLimits.email || !emailPattern.test(email)) {
    throw new ContentValidationError('Enter a valid email address.')
  }
  if (!message) throw new ContentValidationError('Enter a message.')
  if (message.length > contactLimits.message) {
    throw new ContentValidationError(`Your message must be at most ${contactLimits.message} characters.`)
  }
  return { name, email, message }
}

const withoutLineBreaks = (value: string) => value.replace(/[\r\n]+/g, ' ')

// Sends through Mailtrap's HTTP API. Fields are passed as JSON, so visitor text cannot inject mail headers.
export async function sendContactEmail(config: MailConfig, message: ContactMessage, fetchImpl: typeof fetch = fetch) {
  const url = config.inboxId
    ? `https://sandbox.api.mailtrap.io/api/send/${encodeURIComponent(config.inboxId)}`
    : 'https://send.api.mailtrap.io/api/send'
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: config.fromEmail, name: config.fromName },
      to: [{ email: config.to }],
      reply_to: { email: message.email, name: withoutLineBreaks(message.name) },
      subject: `Website message from ${withoutLineBreaks(message.name)}`,
      text: `New message from the website contact form\n\nName: ${withoutLineBreaks(message.name)}\nEmail: ${message.email}\n\n${message.message}\n`,
      category: 'Contact form',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    // Mailtrap explains refusals in the body (for example an unverified sender domain). It echoes no
    // secrets, so it is safe to put in the server log; the visitor never sees it.
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300)
    throw new Error(`Mailtrap responded with status ${response.status}${detail ? `: ${detail}` : ''}`)
  }
}

interface ContactHandlerOptions {
  config: MailConfig | null
  send?: (config: MailConfig, message: ContactMessage) => Promise<void>
  perVisitor?: ReturnType<typeof createRateLimiter>
  overall?: ReturnType<typeof createRateLimiter>
}

const hour = 60 * 60 * 1000

export function createContactHandler({
  config,
  send = sendContactEmail,
  perVisitor = createRateLimiter({ max: 5, windowMs: hour }),
  overall = createRateLimiter({ max: 40, windowMs: hour }),
}: ContactHandlerOptions) {
  return async (body: unknown, visitor: string): Promise<Response> => {
    if (!config) {
      console.error('Contact form is not configured: set MAILTRAP_API_TOKEN, MAILTRAP_FROM_EMAIL, and CONTACT_TO_EMAIL.')
      return Response.json({ error: 'The contact form is not available right now. Please call us instead.' }, { status: 503 })
    }

    let message: ContactMessage | null
    try {
      message = cleanContactMessage(body)
    } catch (error) {
      if (error instanceof ContentValidationError) return Response.json({ error: error.message }, { status: 400 })
      throw error
    }
    // Automated senders get the same answer as everyone else, but nothing is sent.
    if (!message) return Response.json({ ok: true })

    if (!perVisitor.take(visitor) || !overall.take('all')) {
      return Response.json({ error: 'Too many messages. Please try again later or call us.' }, { status: 429 })
    }

    try {
      await send(config, message)
    } catch (error) {
      // Never log the message or the visitor's details.
      console.error('Contact email failed:', error instanceof Error ? error.message : 'Unknown error')
      return Response.json({ error: 'We couldn’t send your message right now. Please try again later or call us.' }, { status: 502 })
    }
    return Response.json({ ok: true })
  }
}
