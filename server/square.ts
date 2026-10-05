import { createHmac, timingSafeEqual } from 'node:crypto'
import type { OrderDetails, OrderItem } from '../shared/orders'
import { currency } from '../shared/products'

// Square Payment Links (the Checkout API): the customer pays on a page hosted by Square, and Square tells us
// about the payment with a signed webhook. No card details ever reach this server.

// The Square API version this code was written against. It can be overridden with SQUARE_API_VERSION.
export const defaultSquareVersion = '2026-09-16'

export interface SquareConfig {
  accessToken: string
  locationId: string
  environment: 'sandbox' | 'production'
  // Where customers are sent back to after paying, without a trailing slash: https://example.com
  siteUrl: string
  apiVersion: string
  baseUrl: string
  // Needed only for the webhook. The URL must be exactly the one registered in the Square dashboard.
  webhookSignatureKey?: string
  webhookUrl?: string
}

export function squareConfigFromEnv(env: Record<string, string | undefined>): SquareConfig | null {
  const accessToken = env.SQUARE_ACCESS_TOKEN?.trim()
  const locationId = env.SQUARE_LOCATION_ID?.trim()
  const siteUrl = env.SITE_URL?.trim().replace(/\/+$/, '')
  if (!accessToken || !locationId || !siteUrl) return null
  try {
    const parsed = new URL(siteUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }

  // Anything other than the word "production" means the sandbox, so a typo can never charge real cards.
  const environment = env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox'
  const defaultBase = environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'
  return {
    accessToken,
    locationId,
    environment,
    siteUrl,
    apiVersion: env.SQUARE_API_VERSION?.trim() || defaultSquareVersion,
    // Only tests override this, to point at a stand-in for Square.
    baseUrl: (env.SQUARE_API_BASE_URL?.trim() || defaultBase).replace(/\/+$/, ''),
    webhookSignatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() || undefined,
    webhookUrl: env.SQUARE_WEBHOOK_URL?.trim() || undefined,
  }
}

// ---- What we ask Square to charge for ----

export const itemLineName = (item: Pick<OrderItem, 'title' | 'sku'>) => `${item.title} (${item.sku})`
export const shippingLineName = (boxes: number) => `Shipping (${boxes} ${boxes === 1 ? 'box' : 'boxes'})`

export interface ExpectedLine {
  name: string
  quantity: number
  unitCents: number
}

// One line per product ordered, plus one for shipping when there is any. The payment is accepted only if
// Square's order has exactly these lines.
export function expectedLines(order: Pick<OrderDetails, 'items' | 'shippingCents' | 'boxes'>): ExpectedLine[] {
  const lines = order.items.map(item => ({ name: itemLineName(item), quantity: item.quantity, unitCents: item.unitPriceCents }))
  if (order.shippingCents > 0) lines.push({ name: shippingLineName(order.boxes), quantity: 1, unitCents: order.shippingCents })
  return lines
}

export function paymentLinkBody(order: OrderDetails, config: SquareConfig) {
  return {
    // The same order always produces the same key, so clicking Pay twice cannot create two links.
    idempotency_key: `pay-${order.slug}`,
    order: {
      location_id: config.locationId,
      reference_id: order.slug,
      line_items: expectedLines(order).map((line, index) => ({
        uid: `line-${index + 1}`,
        name: line.name,
        quantity: String(line.quantity),
        base_price_money: { amount: line.unitCents, currency },
      })),
    },
    checkout_options: {
      redirect_url: `${config.siteUrl}/order/${order.slug}`,
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    pre_populated_data: { buyer_email: order.email },
  }
}

// ---- Talking to Square ----

export class SquareError extends Error {}

interface SquareErrorBody {
  errors?: { code?: string; detail?: string; field?: string }[]
}

async function squareRequest(config: SquareConfig, method: 'GET' | 'POST', path: string, body: unknown, fetchImpl: typeof fetch) {
  const response = await fetchImpl(config.baseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Square-Version': config.apiVersion,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const parsed = await response.json().catch(() => null) as (SquareErrorBody & Record<string, unknown>) | null
  if (!response.ok) {
    // Square explains refusals in "errors"; it never echoes the access token, so this is safe to log.
    const detail = (parsed?.errors ?? []).map(error => [error.code, error.field, error.detail].filter(Boolean).join(' ')).join('; ')
    throw new SquareError(`Square responded with status ${response.status}${detail ? `: ${detail}`.slice(0, 400) : ''}`)
  }
  return parsed ?? {}
}

export interface PaymentLink {
  id: string
  url: string
  squareOrderId: string
}

export async function createPaymentLink(config: SquareConfig, order: OrderDetails, fetchImpl: typeof fetch = fetch): Promise<PaymentLink> {
  const result = await squareRequest(config, 'POST', '/v2/online-checkout/payment-links', paymentLinkBody(order, config), fetchImpl)
  const link = result.payment_link as { id?: string; url?: string; long_url?: string; order_id?: string } | undefined
  const url = link?.url || link?.long_url
  if (!link?.id || !link.order_id || !url || !/^https?:\/\//.test(url)) {
    throw new SquareError('Square did not return a usable payment link.')
  }
  return { id: link.id, url, squareOrderId: link.order_id }
}

export interface SquareMoney { amount?: number; currency?: string }
export interface SquareLineItem { uid?: string; name?: string; quantity?: string; base_price_money?: SquareMoney; total_money?: SquareMoney }
export interface SquareOrder {
  id?: string
  location_id?: string
  reference_id?: string
  line_items?: SquareLineItem[]
  total_money?: SquareMoney
  total_tax_money?: SquareMoney
  total_discount_money?: SquareMoney
  total_service_charge_money?: SquareMoney
}
export interface SquarePayment {
  id?: string
  status?: string
  order_id?: string
  location_id?: string
  amount_money?: SquareMoney
  total_money?: SquareMoney
}

export async function retrieveSquareOrder(config: SquareConfig, squareOrderId: string, fetchImpl: typeof fetch = fetch): Promise<SquareOrder> {
  const result = await squareRequest(config, 'GET', `/v2/orders/${encodeURIComponent(squareOrderId)}`, undefined, fetchImpl)
  const order = result.order as SquareOrder | undefined
  if (!order) throw new SquareError('Square did not return the order.')
  return order
}

// ---- Webhook signature ----

// Square signs "<notification URL><raw request body>" with HMAC-SHA256 and sends it, base64-encoded, in the
// x-square-hmacsha256-signature header. The URL must be exactly the one registered for the webhook.
export function verifyWebhookSignature({ body, signatureHeader, signatureKey, notificationUrl }: {
  body: string
  signatureHeader: string | null | undefined
  signatureKey: string
  notificationUrl: string
}): boolean {
  if (!signatureHeader) return false
  // Compare the base64 text itself, not decoded bytes: decoding is forgiving (it stops at the first "=" and
  // ignores what follows), and a signature check should accept exactly one spelling.
  const expected = Buffer.from(createHmac('sha256', signatureKey).update(notificationUrl + body).digest('base64'))
  const given = Buffer.from(signatureHeader.trim())
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// ---- Does the payment match the order? ----

const money = (cents: number | undefined) => (cents === undefined ? 'nothing' : `$${(cents / 100).toFixed(2)}`)

function lineKey(name: string | undefined, quantity: number | string | undefined, unitCents: number | undefined) {
  return `${name ?? '?'} × ${quantity ?? '?'} at ${money(unitCents)}`
}

// Compares what was paid for with what was ordered. Returns null when everything matches, otherwise a short
// plain-language description of the differences (kept for an admin to read). Nothing about the customer is in it.
export function checkPayment(order: OrderDetails, squareOrder: SquareOrder, payment: SquarePayment, config: SquareConfig): string | null {
  const problems: string[] = []

  if (squareOrder.id && payment.order_id !== squareOrder.id) problems.push('the payment belongs to a different Square order')
  for (const [what, location] of [['payment', payment.location_id], ['Square order', squareOrder.location_id]] as const) {
    if (location && location !== config.locationId) problems.push(`the ${what} is for a different location`)
  }
  if (squareOrder.reference_id && squareOrder.reference_id !== order.slug) problems.push('the Square order refers to a different order')

  if (payment.amount_money?.amount !== order.totalCents || payment.amount_money?.currency !== currency) {
    problems.push(`paid ${money(payment.amount_money?.amount)} but the order total is ${money(order.totalCents)}`)
  }
  if (squareOrder.total_money?.amount !== order.totalCents || squareOrder.total_money?.currency !== currency) {
    problems.push(`the Square order totals ${money(squareOrder.total_money?.amount)} but the order total is ${money(order.totalCents)}`)
  }
  for (const [what, value] of [
    ['tax', squareOrder.total_tax_money], ['a discount', squareOrder.total_discount_money], ['a service charge', squareOrder.total_service_charge_money],
  ] as const) {
    if ((value?.amount ?? 0) !== 0) problems.push(`the Square order includes ${what}`)
  }

  // The lines must be the same set, with the same quantities and prices.
  const expected = expectedLines(order).map(line => lineKey(line.name, line.quantity, line.unitCents))
  const actual = (squareOrder.line_items ?? []).map(line => lineKey(line.name, Number(line.quantity), line.base_price_money?.amount))
  const remaining = [...actual]
  for (const line of expected) {
    const found = remaining.indexOf(line)
    if (found >= 0) remaining.splice(found, 1)
    else problems.push(`the order has ${line} but Square does not`)
  }
  for (const line of remaining) problems.push(`Square has ${line} but the order does not`)

  return problems.length ? `Payment did not match the order: ${problems.join('; ')}.`.slice(0, 900) : null
}
