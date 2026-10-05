import { createHmac } from 'node:crypto'
import { describe, expect, spyOn, test } from 'bun:test'
import type { OrderDetails } from '../shared/orders'
import { createPaymentHandlers, type PaymentStore } from './payments'
import { createRateLimiter } from './rate-limit'
import { defaultSquareVersion, type PaymentLink, type SquareConfig, type SquareOrder } from './square'

const webhookUrl = 'https://shop.example.com/api/square/webhook'
const config: SquareConfig = {
  accessToken: 'secret-access-token', locationId: 'LOC1', environment: 'sandbox', siteUrl: 'https://shop.example.com',
  apiVersion: defaultSquareVersion, baseUrl: 'https://square.test', webhookSignatureKey: 'webhook-key', webhookUrl,
}

const baseOrder: OrderDetails = {
  slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T19:30:00.000Z', email: 'olena@example.com', phone: '(424) 408-0552',
  address: { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' },
  items: [
    { productId: 1, sku: 'RYE-01', title: 'Dark Rye', unitPriceCents: 1000, quantity: 4, delivery: 'ship' },
    { productId: 3, sku: 'CAKE-02', title: 'Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' },
  ],
  itemCount: 5, subtotalCents: 7000, shippingCents: 4000, totalCents: 11000, shippedUnits: 4, boxes: 2, currency: 'USD',
  paidAt: null, paymentProblem: null, needsAttention: false,
}

// An in-memory stand-in for the database, with the same rules (a link is saved once; only unpaid orders become paid).
function makeStore(initial: Partial<OrderDetails> = {}) {
  const state = {
    order: { ...baseOrder, ...initial } as OrderDetails,
    link: null as (PaymentLink & { url: string }) | null,
    paymentId: null as string | null,
    markPaidCalls: 0,
    failWith: null as Error | null,
  }
  const guard = () => { if (state.failWith) throw state.failWith }
  const store: PaymentStore = {
    async getOrder(slug) { guard(); return slug === state.order.slug ? state.order : null },
    async getPaymentLink() { guard(); return state.link ? { url: state.link.url } : null },
    async saveLink(_slug, link) { guard(); if (state.link) return false; state.link = link; return true },
    async findBySquareOrder(id) { guard(); return state.link?.squareOrderId === id ? state.order : null },
    async paidWith() { guard(); return state.paymentId },
    async markPaid(_slug, paymentId) {
      guard(); state.markPaidCalls++
      if (state.order.status !== 'unpaid') return false
      state.order = { ...state.order, status: 'paid', paidAt: '2026-10-05T00:00:00.000Z', paymentProblem: null, needsAttention: false }
      state.paymentId = paymentId
      return true
    },
    async recordProblem(_slug, problem) { guard(); state.order = { ...state.order, paymentProblem: problem, needsAttention: true } },
  }
  return { state, store }
}

const goodSquareOrder = (overrides: Partial<SquareOrder> = {}): SquareOrder => ({
  id: 'SQ-ORDER-1', location_id: 'LOC1', reference_id: baseOrder.slug,
  line_items: [
    { uid: 'line-1', name: 'Dark Rye (RYE-01)', quantity: '4', base_price_money: { amount: 1000, currency: 'USD' } },
    { uid: 'line-2', name: 'Cake (CAKE-02)', quantity: '1', base_price_money: { amount: 3000, currency: 'USD' } },
    { uid: 'line-3', name: 'Shipping (2 boxes)', quantity: '1', base_price_money: { amount: 4000, currency: 'USD' } },
  ],
  total_money: { amount: 11000, currency: 'USD' },
  ...overrides,
})

// A stand-in for Square's API.
function fakeSquare(options: { order?: SquareOrder | null; linkStatus?: number; orderStatus?: number } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined })
    if (url.endsWith('/v2/online-checkout/payment-links')) {
      return options.linkStatus && options.linkStatus >= 400
        ? new Response(JSON.stringify({ errors: [{ code: 'BAD', detail: 'nope' }] }), { status: options.linkStatus })
        : new Response(JSON.stringify({ payment_link: { id: 'LINK-1', url: 'https://square.link/u/abc', order_id: 'SQ-ORDER-1' } }), { status: 200 })
    }
    if (options.orderStatus && options.orderStatus >= 400) return new Response('{}', { status: options.orderStatus })
    return new Response(JSON.stringify({ order: options.order === undefined ? goodSquareOrder() : options.order }), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const link: PaymentLink = { id: 'LINK-1', url: 'https://square.link/u/abc', squareOrderId: 'SQ-ORDER-1' }

describe('starting a payment', () => {
  const make = (initial: Partial<OrderDetails> = {}, square = fakeSquare(), overrides: { config?: SquareConfig | null } = {}) => {
    const { state, store } = makeStore(initial)
    const handlers = createPaymentHandlers({ config: overrides.config === undefined ? config : overrides.config, store, fetchImpl: square.fetchImpl })
    return { state, square, handlers }
  }

  test('creates a payment link, remembers it, and returns its address', async () => {
    const { state, square, handlers } = make()
    const response = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'https://square.link/u/abc' })
    expect(state.link).toEqual(link)
    expect(square.calls).toHaveLength(1)
    expect(square.calls[0]!.body).toMatchObject({ idempotency_key: 'pay-AbCdEfGh12345678', order: { reference_id: baseOrder.slug } })
  })

  test('clicking Pay again reuses the link and does not call Square again', async () => {
    const { square, handlers } = make()
    await handlers.startPayment(baseOrder.slug, 'visitor')
    const again = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(await again.json()).toEqual({ url: 'https://square.link/u/abc' })
    expect(square.calls).toHaveLength(1)
  })

  test('if another click saved a link first, that one is used', async () => {
    const { state, store } = makeStore()
    state.link = { id: 'EARLIER', url: 'https://square.link/u/earlier', squareOrderId: 'SQ-ORDER-0' }
    // Pretend the link only appeared after this request had looked for it.
    let lookedOnce = false
    const racing: PaymentStore = { ...store, async getPaymentLink() { if (!lookedOnce) { lookedOnce = true; return null } return { url: state.link!.url } } }
    const handlers = createPaymentHandlers({ config, store: racing, fetchImpl: fakeSquare().fetchImpl })
    const response = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(await response.json()).toEqual({ url: 'https://square.link/u/earlier' })
    expect(state.link!.id).toBe('EARLIER')
  })

  test('is not available until Square is configured', async () => {
    const { state, square, handlers } = make({}, fakeSquare(), { config: null })
    const response = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(response.status).toBe(503)
    expect(square.calls).toHaveLength(0)
    expect(state.link).toBeNull()
  })

  test('an unknown order is a 404', async () => {
    const { handlers } = make()
    expect((await handlers.startPayment('ZzZzZzZz87654321', 'visitor')).status).toBe(404)
  })

  test('an order that is already paid cannot be paid again', async () => {
    for (const status of ['paid', 'shipped', 'delivered'] as const) {
      const { square, handlers } = make({ status })
      const response = await handlers.startPayment(baseOrder.slug, 'visitor')
      expect(response.status).toBe(409)
      expect(square.calls).toHaveLength(0)
    }
  })

  test('a Square failure is a friendly 502 that saves nothing and leaks nothing', async () => {
    const { state, handlers } = make({}, fakeSquare({ linkStatus: 500 }))
    const response = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(response.status).toBe(502)
    const text = JSON.stringify(await response.json())
    expect(text).not.toContain('secret-access-token')
    expect(text).not.toContain('nope')
    expect(state.link).toBeNull()
  })

  test('a database failure is also a friendly 502', async () => {
    const { state, handlers } = make()
    state.failWith = new Error('connection to db.internal refused')
    const response = await handlers.startPayment(baseOrder.slug, 'visitor')
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('db.internal')
  })

  test('limits how often one visitor can start payments', async () => {
    const { store } = makeStore()
    const handlers = createPaymentHandlers({ config, store, fetchImpl: fakeSquare().fetchImpl, perVisitor: createRateLimiter({ max: 2, windowMs: 1000 }) })
    expect((await handlers.startPayment(baseOrder.slug, 'a')).status).toBe(200)
    expect((await handlers.startPayment(baseOrder.slug, 'a')).status).toBe(200)
    expect((await handlers.startPayment(baseOrder.slug, 'a')).status).toBe(429)
    expect((await handlers.startPayment(baseOrder.slug, 'b')).status).toBe(200)
  })
})

describe('the Square webhook', () => {
  const sign = (body: string, key = 'webhook-key', url = webhookUrl) => createHmac('sha256', key).update(url + body).digest('base64')
  const paymentEvent = (overrides: Record<string, unknown> = {}, type = 'payment.updated') => JSON.stringify({
    merchant_id: 'M1', type, event_id: 'EV-1', created_at: '2026-10-05T00:00:00Z',
    data: { type: 'payment', id: 'PAY-1', object: { payment: {
      id: 'PAY-1', status: 'COMPLETED', order_id: 'SQ-ORDER-1', location_id: 'LOC1',
      amount_money: { amount: 11000, currency: 'USD' }, total_money: { amount: 11000, currency: 'USD' }, ...overrides,
    } } },
  })

  // An order that already has a payment link, as it would when the customer clicked Pay.
  const make = (initial: Partial<OrderDetails> = {}, square = fakeSquare(), overrides: { config?: SquareConfig | null } = {}) => {
    const { state, store } = makeStore(initial)
    state.link = link
    const handlers = createPaymentHandlers({ config: overrides.config === undefined ? config : overrides.config, store, fetchImpl: square.fetchImpl })
    return { state, square, handlers }
  }

  test('marks the order paid when a verified, completed payment matches it exactly', async () => {
    const { state, square, handlers } = make()
    const body = paymentEvent()
    const response = await handlers.handleWebhook(body, sign(body))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, matched: true })
    expect(state.order.status).toBe('paid')
    expect(state.paymentId).toBe('PAY-1')
    expect(state.order.paidAt).not.toBeNull()
    expect(state.order.paymentProblem).toBeNull()
    expect(square.calls).toEqual([{ method: 'GET', url: 'https://square.test/v2/orders/SQ-ORDER-1', body: undefined }])
  })

  test('payment.created is handled the same way', async () => {
    const { state, handlers } = make()
    const body = paymentEvent({}, 'payment.created')
    expect((await handlers.handleWebhook(body, sign(body))).status).toBe(200)
    expect(state.order.status).toBe('paid')
  })

  test('refuses a request that is not signed by Square, and changes nothing', async () => {
    for (const signature of [null, '', 'AAAA', sign(paymentEvent(), 'wrong-key'), sign(paymentEvent(), 'webhook-key', 'https://evil.example.com/hook')]) {
      const { state, square, handlers } = make()
      const response = await handlers.handleWebhook(paymentEvent(), signature)
      expect(response.status).toBe(403)
      expect(state.order.status).toBe('unpaid')
      expect(square.calls).toHaveLength(0)
    }
  })

  test('refuses a body that was altered after signing', async () => {
    const { state, handlers } = make()
    const body = paymentEvent()
    const response = await handlers.handleWebhook(body.replace('PAY-1', 'PAY-2'), sign(body))
    expect(response.status).toBe(403)
    expect(state.order.status).toBe('unpaid')
  })

  test('says in the log why a request was refused, without revealing any secret', async () => {
    const errors: string[] = []
    const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.join(' ')) })
    try {
      const { handlers } = make()
      await handlers.handleWebhook(paymentEvent(), sign(paymentEvent(), 'wrong-key'))
      expect(errors.join('\n')).toContain('the signature does not match')
      expect(errors.join('\n')).toContain('SQUARE_WEBHOOK_URL')
      expect(errors.join('\n')).not.toMatch(/webhook-key|secret-access-token|wrong-key/)
    } finally {
      spy.mockRestore()
    }
  })

  test('records in the log what it did with each event it accepted', async () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
    try {
      const other = JSON.stringify({ type: 'order.updated', data: {} })
      await make().handlers.handleWebhook(other, sign(other))
      const approved = paymentEvent({ status: 'APPROVED' })
      await make().handlers.handleWebhook(approved, sign(approved))
      const good = paymentEvent()
      await make().handlers.handleWebhook(good, sign(good))
      const text = lines.join('\n')
      expect(text).toContain('order.updated - ignored')
      expect(text).toContain('payment PAY-1 is APPROVED for Square order SQ-ORDER-1')
      expect(text).toContain('payment PAY-1 is COMPLETED for Square order SQ-ORDER-1')
      expect(text).toContain('Order ' + baseOrder.slug + ' marked paid')
      // No customer details in any line.
      expect(text).not.toMatch(/olena|408-0552|Main St/i)
    } finally {
      spy.mockRestore()
    }
  })

  test('is switched off until the signature key and address are configured', async () => {
    for (const partial of [{ webhookSignatureKey: undefined }, { webhookUrl: undefined }]) {
      const { state, handlers } = make({}, fakeSquare(), { config: { ...config, ...partial } })
      const body = paymentEvent()
      expect((await handlers.handleWebhook(body, sign(body))).status).toBe(503)
      expect(state.order.status).toBe('unpaid')
    }
    const { handlers } = make({}, fakeSquare(), { config: null })
    expect((await handlers.handleWebhook('{}', sign('{}'))).status).toBe(503)
  })

  test('a signed but unreadable body is a 400', async () => {
    const { handlers } = make()
    expect((await handlers.handleWebhook('{not json', sign('{not json'))).status).toBe(400)
  })

  test('ignores events that are not completed payments', async () => {
    const cases = [
      JSON.stringify({ type: 'order.updated', data: {} }),
      JSON.stringify({ type: 'refund.created', data: {} }),
      paymentEvent({ status: 'APPROVED' }),
      paymentEvent({ status: 'FAILED' }),
      paymentEvent({ status: 'CANCELED' }),
      paymentEvent({ id: undefined }),
      paymentEvent({ order_id: undefined }),
      JSON.stringify({ type: 'payment.updated', data: {} }),
    ]
    for (const body of cases) {
      const { state, square, handlers } = make()
      const response = await handlers.handleWebhook(body, sign(body))
      expect(response.status).toBe(200)
      expect(state.order.status).toBe('unpaid')
      expect(square.calls).toHaveLength(0)
    }
  })

  test('ignores a payment for an order we do not know, and answers 200 so Square stops retrying', async () => {
    const { state, square, handlers } = make()
    const body = paymentEvent({ order_id: 'SQ-SOMEONE-ELSES' })
    const response = await handlers.handleWebhook(body, sign(body))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ignored: 'unknown order' })
    expect(state.order.status).toBe('unpaid')
    expect(square.calls).toHaveLength(0)
  })

  describe('when what was paid for does not match the order', () => {
    const refused = async (squareOrder: SquareOrder, paymentOverrides: Record<string, unknown> = {}) => {
      const { state, handlers } = make({}, fakeSquare({ order: squareOrder }))
      const body = paymentEvent(paymentOverrides)
      const response = await handlers.handleWebhook(body, sign(body))
      return { state, response }
    }

    test('a different quantity: not paid, and the difference is recorded for an admin', async () => {
      const lines = goodSquareOrder().line_items!.map(line => line.uid === 'line-1' ? { ...line, quantity: '3' } : line)
      const { state, response } = await refused(goodSquareOrder({ line_items: lines }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, matched: false })
      expect(state.order.status).toBe('unpaid')
      expect(state.order.needsAttention).toBe(true)
      expect(state.order.paymentProblem).toContain('Dark Rye (RYE-01) × 4')
      expect(state.order.paymentProblem).toContain('Dark Rye (RYE-01) × 3')
      expect(state.paymentId).toBeNull()
    })

    test('a missing, extra, or repriced line', async () => {
      const lines = goodSquareOrder().line_items!
      for (const altered of [
        lines.slice(0, 2),
        [...lines, { uid: 'x', name: 'Mystery', quantity: '1', base_price_money: { amount: 100, currency: 'USD' } }],
        lines.map(line => line.uid === 'line-2' ? { ...line, base_price_money: { amount: 1, currency: 'USD' } } : line),
      ]) {
        const { state } = await refused(goodSquareOrder({ line_items: altered }))
        expect(state.order.status).toBe('unpaid')
        expect(state.order.needsAttention).toBe(true)
      }
    })

    test('a different amount paid', async () => {
      const { state } = await refused(goodSquareOrder(), { amount_money: { amount: 9000, currency: 'USD' } })
      expect(state.order.status).toBe('unpaid')
      expect(state.order.paymentProblem).toContain('paid $90.00 but the order total is $110.00')
    })

    test('tax or a discount added in Square', async () => {
      const { state } = await refused(goodSquareOrder({ total_tax_money: { amount: 500, currency: 'USD' }, total_money: { amount: 11500, currency: 'USD' } }))
      expect(state.order.status).toBe('unpaid')
      expect(state.order.paymentProblem).toContain('includes tax')
    })

    test('a payment from another Square location', async () => {
      const { state } = await refused(goodSquareOrder(), { location_id: 'OTHER' })
      expect(state.order.status).toBe('unpaid')
      expect(state.order.paymentProblem).toContain('different location')
    })

    test('the recorded problem never contains the customer’s details', async () => {
      const lines = goodSquareOrder().line_items!.slice(0, 1)
      const { state } = await refused(goodSquareOrder({ line_items: lines }))
      expect(state.order.paymentProblem).not.toMatch(/olena|408-0552|Main St|92626/i)
    })

    test('a later correct payment clears the problem and marks the order paid', async () => {
      const lines = goodSquareOrder().line_items!.slice(0, 1)
      const { state, handlers } = make({}, fakeSquare({ order: goodSquareOrder({ line_items: lines }) }))
      const body = paymentEvent()
      await handlers.handleWebhook(body, sign(body))
      expect(state.order.needsAttention).toBe(true)

      const { handlers: fixed } = (() => {
        const square = fakeSquare()
        return { handlers: createPaymentHandlers({ config, store: makeStoreFrom(state), fetchImpl: square.fetchImpl }) }
      })()
      await fixed.handleWebhook(body, sign(body))
      expect(state.order.status).toBe('paid')
      expect(state.order.paymentProblem).toBeNull()
    })
  })

  test('the same payment reported twice marks the order paid once and raises no problem', async () => {
    const { state, handlers } = make()
    const body = paymentEvent()
    await handlers.handleWebhook(body, sign(body))
    const second = await handlers.handleWebhook(body, sign(body))
    expect(second.status).toBe(200)
    expect(state.order.status).toBe('paid')
    expect(state.order.paymentProblem).toBeNull()
    expect(state.markPaidCalls).toBe(1)

    // And the "created" and "updated" events for one payment, arriving together.
    const both = make()
    const created = paymentEvent({}, 'payment.created')
    await Promise.all([both.handlers.handleWebhook(created, sign(created)), both.handlers.handleWebhook(body, sign(body))])
    expect(both.state.order.status).toBe('paid')
    expect(both.state.order.paymentProblem).toBeNull()
  })

  test('a second, different payment for an order that is already paid is flagged, not ignored', async () => {
    const { state, handlers } = make()
    const first = paymentEvent()
    await handlers.handleWebhook(first, sign(first))
    const second = paymentEvent({ id: 'PAY-2' })
    await handlers.handleWebhook(second, sign(second))
    expect(state.order.status).toBe('paid')
    expect(state.paymentId).toBe('PAY-1')
    expect(state.order.needsAttention).toBe(true)
    expect(state.order.paymentProblem).toContain('PAY-2')
  })

  test('never moves an order backwards: a shipped order stays shipped, and the payment is flagged for review', async () => {
    for (const status of ['paid', 'shipped', 'delivered'] as const) {
      const { state, handlers } = make({ status })
      const body = paymentEvent()
      const response = await handlers.handleWebhook(body, sign(body))
      expect(response.status).toBe(200)
      expect(state.order.status).toBe(status)
      expect(state.order.paymentProblem).toContain('already marked ' + status)
    }
  })

  test('if Square cannot be reached, the order is untouched and Square is asked to retry', async () => {
    const { state, handlers } = make({}, fakeSquare({ orderStatus: 500 }))
    const body = paymentEvent()
    const response = await handlers.handleWebhook(body, sign(body))
    expect(response.status).toBe(503)
    expect(state.order.status).toBe('unpaid')
    expect(state.order.needsAttention).toBe(false)
  })

  test('if our database fails, Square is asked to retry', async () => {
    const { state, handlers } = make()
    state.failWith = new Error('connection to db.internal refused')
    const body = paymentEvent()
    const response = await handlers.handleWebhook(body, sign(body))
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('db.internal')
  })
})

// A store that shares state with an earlier one, so a second handler sees what the first one did.
function makeStoreFrom(state: ReturnType<typeof makeStore>['state']): PaymentStore {
  return {
    async getOrder() { return state.order },
    async getPaymentLink() { return state.link ? { url: state.link.url } : null },
    async saveLink() { return false },
    async findBySquareOrder(id) { return state.link?.squareOrderId === id ? state.order : null },
    async paidWith() { return state.paymentId },
    async markPaid(_slug, paymentId) {
      if (state.order.status !== 'unpaid') return false
      state.order = { ...state.order, status: 'paid', paidAt: '2026-10-05T00:00:00.000Z', paymentProblem: null, needsAttention: false }
      state.paymentId = paymentId
      return true
    },
    async recordProblem(_slug, problem) { state.order = { ...state.order, paymentProblem: problem, needsAttention: true } },
  }
}
