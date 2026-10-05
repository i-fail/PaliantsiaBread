import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import type { OrderDetails } from '../shared/orders'
import {
  checkPayment, createPaymentLink, defaultSquareVersion, expectedLines, paymentLinkBody, retrieveSquareOrder, shippingLineName,
  SquareError, squareConfigFromEnv, verifyWebhookSignature, type SquareConfig, type SquareOrder, type SquarePayment,
} from './square'

const config: SquareConfig = {
  accessToken: 'secret-access-token', locationId: 'LOC1', environment: 'sandbox', siteUrl: 'https://shop.example.com',
  apiVersion: defaultSquareVersion, baseUrl: 'https://connect.squareupsandbox.com',
  webhookSignatureKey: 'webhook-key', webhookUrl: 'https://shop.example.com/api/square/webhook',
}

// 4 Rye shipped (2 boxes = $40) and 1 Cake picked up.
const order: OrderDetails = {
  slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T19:30:00.000Z', email: 'olena@example.com', phone: '(424) 408-0552',
  address: { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' },
  items: [
    { productId: 1, sku: 'RYE-01', title: 'Dark Rye', unitPriceCents: 1000, quantity: 4, delivery: 'ship' },
    { productId: 3, sku: 'CAKE-02', title: 'Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' },
  ],
  itemCount: 5, subtotalCents: 7000, shippingCents: 4000, totalCents: 11000, shippedUnits: 4, boxes: 2, currency: 'USD',
  paidAt: null, paymentProblem: null, needsAttention: false,
}

// The Square order that a correct payment link produces.
const squareOrder = (overrides: Partial<SquareOrder> = {}): SquareOrder => ({
  id: 'SQ-ORDER-1', location_id: 'LOC1', reference_id: 'AbCdEfGh12345678',
  line_items: [
    { uid: 'line-1', name: 'Dark Rye (RYE-01)', quantity: '4', base_price_money: { amount: 1000, currency: 'USD' }, total_money: { amount: 4000, currency: 'USD' } },
    { uid: 'line-2', name: 'Cake (CAKE-02)', quantity: '1', base_price_money: { amount: 3000, currency: 'USD' }, total_money: { amount: 3000, currency: 'USD' } },
    { uid: 'line-3', name: 'Shipping (2 boxes)', quantity: '1', base_price_money: { amount: 4000, currency: 'USD' }, total_money: { amount: 4000, currency: 'USD' } },
  ],
  total_money: { amount: 11000, currency: 'USD' },
  total_tax_money: { amount: 0, currency: 'USD' }, total_discount_money: { amount: 0, currency: 'USD' }, total_service_charge_money: { amount: 0, currency: 'USD' },
  ...overrides,
})
const payment = (overrides: Partial<SquarePayment> = {}): SquarePayment => ({
  id: 'PAY-1', status: 'COMPLETED', order_id: 'SQ-ORDER-1', location_id: 'LOC1',
  amount_money: { amount: 11000, currency: 'USD' }, total_money: { amount: 11000, currency: 'USD' }, ...overrides,
})

describe('Square configuration', () => {
  const env = { SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'LOC', SITE_URL: 'https://shop.example.com/' }

  test('needs a token, a location, and the site address', () => {
    expect(squareConfigFromEnv(env)).not.toBeNull()
    for (const key of Object.keys(env)) {
      expect(squareConfigFromEnv({ ...env, [key]: '  ' })).toBeNull()
      expect(squareConfigFromEnv({ ...env, [key]: undefined })).toBeNull()
    }
    expect(squareConfigFromEnv({ ...env, SITE_URL: 'not a url' })).toBeNull()
    expect(squareConfigFromEnv({ ...env, SITE_URL: 'ftp://shop.example.com' })).toBeNull()
  })

  test('uses the sandbox unless production is spelled out exactly', () => {
    expect(squareConfigFromEnv(env)).toMatchObject({ environment: 'sandbox', baseUrl: 'https://connect.squareupsandbox.com' })
    for (const value of ['', 'prod', 'live', 'productions', 'sandbox']) {
      expect(squareConfigFromEnv({ ...env, SQUARE_ENVIRONMENT: value })?.environment).toBe('sandbox')
    }
    expect(squareConfigFromEnv({ ...env, SQUARE_ENVIRONMENT: ' Production ' })).toMatchObject({ environment: 'production', baseUrl: 'https://connect.squareup.com' })
  })

  test('tidies the site address and reads the optional settings', () => {
    const result = squareConfigFromEnv({
      ...env, SQUARE_WEBHOOK_SIGNATURE_KEY: ' key ', SQUARE_WEBHOOK_URL: ' https://shop.example.com/api/square/webhook ',
      SQUARE_API_VERSION: '2030-01-01', SQUARE_API_BASE_URL: 'http://127.0.0.1:4010/',
    })!
    expect(result).toMatchObject({
      siteUrl: 'https://shop.example.com', webhookSignatureKey: 'key', webhookUrl: 'https://shop.example.com/api/square/webhook',
      apiVersion: '2030-01-01', baseUrl: 'http://127.0.0.1:4010',
    })
    expect(squareConfigFromEnv(env)!.apiVersion).toBe(defaultSquareVersion)
    expect(squareConfigFromEnv(env)!.webhookSignatureKey).toBeUndefined()
  })
})

describe('webhook signature', () => {
  const body = '{"type":"payment.updated","data":{"id":"PAY-1"}}'
  const url = 'https://shop.example.com/api/square/webhook'
  // Computed independently, exactly as Square documents it: base64(HMAC-SHA256(key, url + body)).
  const sign = (key: string, notificationUrl: string, text: string) => createHmac('sha256', key).update(notificationUrl + text).digest('base64')
  const check = (overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
    verifyWebhookSignature({ body, signatureHeader: sign('k', url, body), signatureKey: 'k', notificationUrl: url, ...overrides })

  test('accepts a correctly signed request', () => {
    expect(check()).toBe(true)
  })

  test('rejects anything that does not match exactly', () => {
    expect(check({ signatureKey: 'other-key' })).toBe(false)
    expect(check({ body: body.replace('PAY-1', 'PAY-2') })).toBe(false)
    expect(check({ notificationUrl: url + '/' })).toBe(false)
    expect(check({ notificationUrl: url.replace('https', 'http') })).toBe(false)
    expect(check({ signatureHeader: sign('k', url, body + ' ') })).toBe(false)
  })

  test('rejects a missing, empty, or malformed signature', () => {
    for (const signatureHeader of [undefined, null, '', '   ', 'not base64 !!!', 'AAAA', sign('k', url, body).slice(0, 20), sign('k', url, body) + sign('k', url, body)]) {
      expect(check({ signatureHeader })).toBe(false)
    }
  })
})

describe('what is sent to Square', () => {
  test('a line for every product, plus one for shipping', () => {
    expect(expectedLines(order)).toEqual([
      { name: 'Dark Rye (RYE-01)', quantity: 4, unitCents: 1000 },
      { name: 'Cake (CAKE-02)', quantity: 1, unitCents: 3000 },
      { name: 'Shipping (2 boxes)', quantity: 1, unitCents: 4000 },
    ])
    expect(shippingLineName(1)).toBe('Shipping (1 box)')
  })

  test('no shipping line when nothing is shipped', () => {
    const pickup = { ...order, items: [order.items[1]!], shippingCents: 0, boxes: 0, shippedUnits: 0, subtotalCents: 3000, totalCents: 3000 }
    expect(expectedLines(pickup).map(line => line.name)).toEqual(['Cake (CAKE-02)'])
  })

  test('the payment link request', () => {
    const body = paymentLinkBody(order, config)
    expect(body.idempotency_key).toBe('pay-AbCdEfGh12345678')
    expect(body.order.location_id).toBe('LOC1')
    expect(body.order.reference_id).toBe('AbCdEfGh12345678')
    expect(body.order.line_items).toEqual([
      { uid: 'line-1', name: 'Dark Rye (RYE-01)', quantity: '4', base_price_money: { amount: 1000, currency: 'USD' } },
      { uid: 'line-2', name: 'Cake (CAKE-02)', quantity: '1', base_price_money: { amount: 3000, currency: 'USD' } },
      { uid: 'line-3', name: 'Shipping (2 boxes)', quantity: '1', base_price_money: { amount: 4000, currency: 'USD' } },
    ])
    expect(body.checkout_options).toEqual({ redirect_url: 'https://shop.example.com/order/AbCdEfGh12345678', ask_for_shipping_address: false, allow_tipping: false })
    expect(body.pre_populated_data).toEqual({ buyer_email: 'olena@example.com' })
    // Square wants quantities as strings and whole-cent amounts.
    for (const line of body.order.line_items) {
      expect(typeof line.quantity).toBe('string')
      expect(Number.isInteger(line.base_price_money.amount)).toBe(true)
    }
    // The request carries no card, phone number, or street address.
    expect(JSON.stringify(body)).not.toMatch(/408-0552|Main St|92626/)
  })

  test('the line items add up to the order total', () => {
    const sum = paymentLinkBody(order, config).order.line_items.reduce((total, line) => total + Number(line.quantity) * line.base_price_money.amount, 0)
    expect(sum).toBe(order.totalCents)
  })
})

describe('Square requests', () => {
  function fakeSquare(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    }) as unknown as typeof fetch
    return { calls, fake }
  }
  const linkResponse = { payment_link: { id: 'LINK-1', url: 'https://square.link/u/abc', long_url: 'https://checkout.square.site/long', order_id: 'SQ-ORDER-1', version: 1 } }

  test('creating a payment link: where, how, and what comes back', async () => {
    const { calls, fake } = fakeSquare(200, linkResponse)
    const link = await createPaymentLink(config, order, fake)
    expect(link).toEqual({ id: 'LINK-1', url: 'https://square.link/u/abc', squareOrderId: 'SQ-ORDER-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://connect.squareupsandbox.com/v2/online-checkout/payment-links')
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret-access-token')
    expect(headers['Square-Version']).toBe(defaultSquareVersion)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(paymentLinkBody(order, config))
  })

  test('production uses the production address', async () => {
    const { calls, fake } = fakeSquare(200, linkResponse)
    await createPaymentLink({ ...config, environment: 'production', baseUrl: 'https://connect.squareup.com' }, order, fake)
    expect(calls[0]!.url).toBe('https://connect.squareup.com/v2/online-checkout/payment-links')
  })

  test('falls back to the long link when there is no short one', async () => {
    const { fake } = fakeSquare(200, { payment_link: { ...linkResponse.payment_link, url: undefined } })
    expect((await createPaymentLink(config, order, fake)).url).toBe('https://checkout.square.site/long')
  })

  test('a refusal is explained without exposing the access token', async () => {
    const { fake } = fakeSquare(400, { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'INVALID_VALUE', field: 'order.location_id', detail: 'Location not found.' }] })
    const error = await createPaymentLink(config, order, fake).catch(cause => cause as Error)
    expect(error).toBeInstanceOf(SquareError)
    expect((error as Error).message).toBe('Square responded with status 400: INVALID_VALUE order.location_id Location not found.')
    expect((error as Error).message).not.toContain('secret-access-token')
  })

  test('an unusable answer is an error, not a broken link', async () => {
    for (const body of [{}, { payment_link: {} }, { payment_link: { id: 'L', order_id: 'O' } }, { payment_link: { id: 'L', order_id: 'O', url: 'javascript:alert(1)' } }]) {
      await expect(createPaymentLink(config, order, fakeSquare(200, body).fake)).rejects.toBeInstanceOf(SquareError)
    }
  })

  test('retrieving an order', async () => {
    const { calls, fake } = fakeSquare(200, { order: squareOrder() })
    const result = await retrieveSquareOrder(config, 'SQ ORDER/1', fake)
    expect(result.id).toBe('SQ-ORDER-1')
    expect(calls[0]!.url).toBe('https://connect.squareupsandbox.com/v2/orders/SQ%20ORDER%2F1')
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.body).toBeUndefined()
    await expect(retrieveSquareOrder(config, 'X', fakeSquare(200, {}).fake)).rejects.toBeInstanceOf(SquareError)
    await expect(retrieveSquareOrder(config, 'X', fakeSquare(404, { errors: [{ code: 'NOT_FOUND' }] }).fake)).rejects.toThrow('status 404: NOT_FOUND')
  })
})

describe('does the payment match the order?', () => {
  const check = (squareOverrides: Partial<SquareOrder> = {}, paymentOverrides: Partial<SquarePayment> = {}) =>
    checkPayment(order, squareOrder(squareOverrides), payment(paymentOverrides), config)

  test('accepts exactly what was ordered, in any line order', () => {
    expect(check()).toBeNull()
    expect(check({ line_items: squareOrder().line_items!.slice().reverse() })).toBeNull()
  })

  test('accepts a payment that includes a tip, since the order amount still matches', () => {
    expect(check({}, { total_money: { amount: 12000, currency: 'USD' } })).toBeNull()
  })

  test('refuses when a quantity differs', () => {
    const lines = squareOrder().line_items!.map(line => line.uid === 'line-1' ? { ...line, quantity: '3' } : line)
    const result = check({ line_items: lines })!
    expect(result).toContain('Payment did not match the order')
    expect(result).toContain('the order has Dark Rye (RYE-01) × 4 at $10.00 but Square does not')
    expect(result).toContain('Square has Dark Rye (RYE-01) × 3 at $10.00 but the order does not')
  })

  test('refuses when a product is missing, extra, or at a different price', () => {
    const lines = squareOrder().line_items!
    expect(check({ line_items: lines.filter(line => line.uid !== 'line-2') })).toContain('the order has Cake (CAKE-02) × 1')
    expect(check({ line_items: [...lines, { uid: 'x', name: 'Extra', quantity: '1', base_price_money: { amount: 100 } }] })).toContain('Square has Extra × 1 at $1.00')
    expect(check({ line_items: lines.map(line => line.uid === 'line-2' ? { ...line, base_price_money: { amount: 100, currency: 'USD' } } : line) })).toContain('Cake (CAKE-02) × 1 at $1.00')
    expect(check({ line_items: undefined })).toContain('but Square does not')
  })

  test('refuses when the shipping line is missing or wrong', () => {
    const lines = squareOrder().line_items!
    expect(check({ line_items: lines.filter(line => line.uid !== 'line-3') })).toContain('Shipping (2 boxes)')
    expect(check({ line_items: lines.map(line => line.uid === 'line-3' ? { ...line, name: 'Shipping (1 box)' } : line) })).toContain('Shipping (1 box)')
  })

  test('refuses when the amounts do not add up', () => {
    expect(check({}, { amount_money: { amount: 10000, currency: 'USD' } })).toContain('paid $100.00 but the order total is $110.00')
    expect(check({}, { amount_money: { amount: 11000, currency: 'CAD' } })).toContain('paid')
    expect(check({}, { amount_money: undefined })).toContain('paid nothing')
    expect(check({ total_money: { amount: 9000, currency: 'USD' } })).toContain('the Square order totals $90.00')
  })

  test('refuses tax, discounts, or service charges the order does not have', () => {
    expect(check({ total_tax_money: { amount: 100, currency: 'USD' } })).toContain('includes tax')
    expect(check({ total_discount_money: { amount: 100, currency: 'USD' } })).toContain('includes a discount')
    expect(check({ total_service_charge_money: { amount: 100, currency: 'USD' } })).toContain('includes a service charge')
  })

  test('refuses a payment from the wrong place', () => {
    expect(check({}, { order_id: 'SQ-OTHER' })).toContain('different Square order')
    expect(check({}, { location_id: 'LOC2' })).toContain('different location')
    expect(check({ location_id: 'LOC2' })).toContain('different location')
    expect(check({ reference_id: 'ZzZzZzZz87654321' })).toContain('refers to a different order')
  })

  test('lists every difference, and never mentions the customer', () => {
    const result = check({ total_money: { amount: 1, currency: 'USD' } }, { amount_money: { amount: 2, currency: 'USD' } })!
    expect(result.split(';').length).toBeGreaterThan(1)
    expect(result).not.toMatch(/olena|408-0552|Main St/)
    expect(result.length).toBeLessThanOrEqual(900)
  })

  test('works for an order with nothing to ship', () => {
    const pickup: OrderDetails = { ...order, items: [order.items[1]!], shippingCents: 0, boxes: 0, shippedUnits: 0, subtotalCents: 3000, totalCents: 3000 }
    const square = squareOrder({ line_items: [squareOrder().line_items![1]!], total_money: { amount: 3000, currency: 'USD' } })
    expect(checkPayment(pickup, square, payment({ amount_money: { amount: 3000, currency: 'USD' } }), config)).toBeNull()
  })
})
