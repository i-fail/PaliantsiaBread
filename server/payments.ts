import type { OrderDetails } from '../shared/orders'
import { getDatabase } from './db'
import { getOrder, orderFromRow } from './orders'
import { createRateLimiter } from './rate-limit'
import {
  checkPayment, createPaymentLink, retrieveSquareOrder, verifyWebhookSignature,
  type PaymentLink, type SquareConfig, type SquarePayment,
} from './square'

// What the payment code needs from the database. The real one is below; tests use an in-memory stand-in.
export interface PaymentStore {
  getOrder(slug: string): Promise<OrderDetails | null>
  // The payment link already created for this order, if any.
  getPaymentLink(slug: string): Promise<{ url: string } | null>
  // Remembers a new link. Returns false if the order already has one (another click got there first).
  saveLink(slug: string, link: PaymentLink): Promise<boolean>
  findBySquareOrder(squareOrderId: string): Promise<OrderDetails | null>
  // The id of the Square payment that paid this order, if one did.
  paidWith(slug: string): Promise<string | null>
  // unpaid -> paid. Returns false if the order was not unpaid (so it is never moved backwards or done twice).
  markPaid(slug: string, squarePaymentId: string): Promise<boolean>
  recordProblem(slug: string, problem: string): Promise<void>
}

export function createDatabasePaymentStore(): PaymentStore {
  type Row = Parameters<typeof orderFromRow>[0]
  return {
    getOrder: slug => getOrder(slug),

    async getPaymentLink(slug) {
      const rows = await getDatabase()`SELECT payment_link_url AS url FROM orders WHERE slug = ${slug} AND payment_link_url IS NOT NULL`
      return rows[0] ? { url: rows[0].url as string } : null
    },

    async saveLink(slug, link) {
      const rows = await getDatabase()`
        UPDATE orders SET payment_link_id = ${link.id}, payment_link_url = ${link.url}, square_order_id = ${link.squareOrderId}
        WHERE slug = ${slug} AND payment_link_url IS NULL
        RETURNING slug
      `
      return rows.length > 0
    },

    async findBySquareOrder(squareOrderId) {
      const rows: Row[] = await getDatabase()`SELECT * FROM orders WHERE square_order_id = ${squareOrderId}`
      return rows[0] ? orderFromRow(rows[0]) : null
    },

    async paidWith(slug) {
      const rows = await getDatabase()`SELECT square_payment_id FROM orders WHERE slug = ${slug}`
      return (rows[0]?.square_payment_id as string | null | undefined) ?? null
    },

    async markPaid(slug, squarePaymentId) {
      const rows = await getDatabase()`
        UPDATE orders
        SET status = 'paid', square_payment_id = ${squarePaymentId}, paid_at = NOW(), payment_problem = NULL
        WHERE slug = ${slug} AND status = 'unpaid'
        RETURNING slug
      `
      return rows.length > 0
    },

    async recordProblem(slug, problem) {
      await getDatabase()`UPDATE orders SET payment_problem = ${problem} WHERE slug = ${slug}`
    },
  }
}

interface PaymentHandlerOptions {
  config: SquareConfig | null
  store: PaymentStore
  fetchImpl?: typeof fetch
  perVisitor?: ReturnType<typeof createRateLimiter>
}

const hour = 60 * 60 * 1000
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

export function createPaymentHandlers({
  config,
  store,
  fetchImpl = fetch,
  perVisitor = createRateLimiter({ max: 20, windowMs: hour }),
}: PaymentHandlerOptions) {
  // The customer clicked Pay: get them a Square checkout page for this order.
  async function startPayment(slug: string, visitor: string): Promise<Response> {
    if (!config) {
      console.error('Payments are not configured: set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, and SITE_URL.')
      return json({ error: 'Online payment is not available right now. Please contact us to pay.' }, 503)
    }
    if (!perVisitor.take(visitor)) return json({ error: 'Too many attempts. Please try again later.' }, 429)

    try {
      const order = await store.getOrder(slug)
      if (!order) return json({ error: 'Order not found.' }, 404)
      if (order.status !== 'unpaid') return json({ error: 'This order has already been paid.' }, 409)

      // Clicking Pay again reuses the link, so one order never ends up with several.
      const existing = await store.getPaymentLink(slug)
      if (existing) return json({ url: existing.url })

      const link = await createPaymentLink(config, order, fetchImpl)
      if (await store.saveLink(slug, link)) return json({ url: link.url })
      // Another request saved a link first (Square returns the same link for the same order); use the saved one.
      const saved = await store.getPaymentLink(slug)
      return saved ? json({ url: saved.url }) : json({ url: link.url })
    } catch (error) {
      console.error('Starting a payment failed:', errorMessage(error))
      return json({ error: 'We couldn’t start the payment right now. Please try again, or contact us to pay.' }, 502)
    }
  }

  // Square tells us a payment happened. Only a verified, completed payment whose order lines match exactly
  // marks an order as paid.
  async function handleWebhook(rawBody: string, signature: string | null): Promise<Response> {
    if (!config?.webhookSignatureKey || !config.webhookUrl) {
      console.error('The Square webhook is not configured: set SQUARE_WEBHOOK_SIGNATURE_KEY and SQUARE_WEBHOOK_URL.')
      return json({ error: 'Not configured.' }, 503)
    }
    if (!verifyWebhookSignature({ body: rawBody, signatureHeader: signature, signatureKey: config.webhookSignatureKey, notificationUrl: config.webhookUrl })) {
      return json({ error: 'Invalid signature.' }, 403)
    }

    let event: { type?: unknown; data?: { object?: { payment?: SquarePayment } } }
    try {
      event = JSON.parse(rawBody)
    } catch {
      return json({ error: 'Invalid JSON.' }, 400)
    }
    // Everything below answers 200 for events that need no action, so Square does not keep retrying them.
    if (event.type !== 'payment.created' && event.type !== 'payment.updated') return json({ ok: true, ignored: 'event type' })
    const payment = event.data?.object?.payment
    if (!payment?.id || !payment.order_id) return json({ ok: true, ignored: 'no payment' })
    if (payment.status !== 'COMPLETED') return json({ ok: true, ignored: 'payment not completed' })

    try {
      const order = await store.findBySquareOrder(payment.order_id)
      if (!order) {
        console.error('A Square payment arrived for an order we do not know:', payment.order_id)
        return json({ ok: true, ignored: 'unknown order' })
      }

      if (order.status !== 'unpaid') {
        // Normal when the same payment is reported twice. Anything else (a second payment, or a payment for an
        // order already marked paid by hand) is left for a person to look at.
        const paidWith = await store.paidWith(order.slug)
        if (paidWith !== payment.id) {
          await store.recordProblem(order.slug, `A Square payment (${payment.id}) was received although this order was already marked ${order.status}. Check Square for a possible duplicate or refund.`)
          console.error('Extra payment for order', order.slug)
        }
        return json({ ok: true, ignored: 'already handled' })
      }

      // The payment event does not say what was bought, so ask Square for the order and compare.
      const squareOrder = await retrieveSquareOrder(config, payment.order_id, fetchImpl)
      const problem = checkPayment(order, squareOrder, payment, config)
      if (problem) {
        await store.recordProblem(order.slug, problem)
        console.error('Payment did not match order', order.slug, '-', problem)
        return json({ ok: true, matched: false })
      }

      if (!(await store.markPaid(order.slug, payment.id))) {
        // Lost a race with the same payment reported twice at once.
        const paidWith = await store.paidWith(order.slug)
        if (paidWith !== payment.id) await store.recordProblem(order.slug, `A Square payment (${payment.id}) was received while the order was being updated by someone else. Check the order.`)
      } else {
        console.log('Order', order.slug, 'marked paid')
      }
      return json({ ok: true, matched: true })
    } catch (error) {
      // Square, or our database, had a hiccup: answering with an error makes Square send the event again later.
      console.error('Handling a Square payment failed:', errorMessage(error))
      return json({ error: 'Try again later.' }, 503)
    }
  }

  return { startPayment, handleWebhook }
}
