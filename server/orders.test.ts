import { describe, expect, test } from 'bun:test'
import { initialOrderStatus, normalizePhone, orderSlugPattern, orderStatuses, shippingStates, stateCodes } from '../shared/orders'
import type { Product } from '../shared/products'
import { ContentValidationError } from './content'
import {
  buildOrder, cleanAddress, cleanOrderRequest, cleanOrderStatus, createOrderHandler, newOrderSlug, orderFromRow, OrderUnavailableError, summaryOf, type NewOrder,
} from './orders'
import { createRateLimiter } from './rate-limit'

const product = (id: number, title: string, priceCents: number | null, shippingAvailable: boolean, enabled = true): Product => ({
  id, slug: title.toLowerCase(), sku: `SKU-${id}`, title, description: '', enabled, priceCents, shippingAvailable, mainPhotoId: null, photos: [],
})
const catalog = new Map([
  product(1, 'Rye', 1000, true), product(2, 'Bagel', 400, true), product(3, 'Cake', 3000, false),
  product(4, 'Hidden', 500, true, false), product(5, 'Unpriced', null, true),
].map(item => [item.id, item]))

const address = { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' }
const request = (overrides: Record<string, unknown> = {}) => ({
  items: [{ productId: 1, quantity: 2, delivery: 'ship' }],
  email: 'olena@example.com',
  phone: '424-408-0552',
  address,
  ...overrides,
})

describe('order references', () => {
  test('are 16 letters and digits', () => {
    for (let i = 0; i < 200; i++) expect(newOrderSlug()).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  test('do not repeat and use the whole alphabet', () => {
    const slugs = Array.from({ length: 2000 }, newOrderSlug)
    expect(new Set(slugs).size).toBe(2000)
    const characters = new Set(slugs.join(''))
    expect(characters.size).toBe(62)
  })
})

describe('phone numbers', () => {
  test('US numbers are accepted in any format and stored in one', () => {
    for (const text of [
      '4244080552', '424-408-0552', '(424) 408-0552', '424.408.0552', '424 408 0552', ' 424 408 0552 ',
      '+1 424 408 0552', '1-424-408-0552', '424/408/0552', '424-408-0552 (cell)', 'call 424 408 0552', '4 2 4 4 0 8 0 5 5 2',
    ]) {
      expect(normalizePhone(text)).toBe('(424) 408-0552')
    }
  })

  test('numbers with more than the 10 US digits are accepted and kept as typed', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(normalizePhone('  +380   44 123 4567  ')).toBe('+380 44 123 4567')
    // 11 digits that do not start with the country code 1 are not a US number either.
    expect(normalizePhone('22345678901')).toBe('22345678901')
    expect(normalizePhone('42440805520')).toBe('42440805520')
    expect(normalizePhone('+49 (30) 1234 5678 9')).toBe('+49 (30) 1234 5678 9')
  })

  test('up to 15 digits are accepted, but no more', () => {
    expect(normalizePhone('123456789012345')).toBe('123456789012345')
    expect(normalizePhone('1234567890123456')).toBeNull()
  })

  test('are not held to North American numbering rules', () => {
    // Area codes and exchanges starting with 0 or 1 are not valid in practice, but the form no longer cares.
    expect(normalizePhone('0244080552')).toBe('(024) 408-0552')
    expect(normalizePhone('4241080552')).toBe('(424) 108-0552')
    expect(normalizePhone('1111111111')).toBe('(111) 111-1111')
  })

  test('are refused with fewer than 10 digits, or when far too long', () => {
    for (const text of ['', '   ', 'call me', '123', '424-408-055', '424-408-055x', '+1 424 408 05', '(424) 408', 'x'.repeat(40)]) {
      expect(normalizePhone(text)).toBeNull()
    }
    // Many digits, but typed with so much around them that it would not fit in the field.
    expect(normalizePhone('call me on 424 408 0552 any time you like')).toBeNull()
  })
})

describe('order statuses', () => {
  test('are unpaid, paid, shipped, delivered, and orders start unpaid', () => {
    expect([...orderStatuses]).toEqual(['unpaid', 'paid', 'shipped', 'delivered'])
    expect(initialOrderStatus).toBe('unpaid')
  })
})

describe('shipping states', () => {
  test('are the 48 contiguous states', () => {
    expect(shippingStates).toHaveLength(48)
    expect(stateCodes.has('AK')).toBe(false)
    expect(stateCodes.has('HI')).toBe(false)
    expect(stateCodes.has('CA')).toBe(true)
    expect(stateCodes.has('DC')).toBe(false)
  })
})

describe('order request validation', () => {
  test('accepts a valid request and normalizes the phone number', () => {
    const result = cleanOrderRequest(request({ email: ' olena@example.com ' }))
    expect(result.email).toBe('olena@example.com')
    expect(result.phone).toBe('(424) 408-0552')
    expect(result.items).toEqual([{ productId: 1, quantity: 2, delivery: 'ship' }])
  })

  test('stores any phone number with 10 digits in one standard form', () => {
    for (const phone of ['4244080552', 'call 424 408 0552', '+1 (424) 408-0552', '424.408.0552 (cell)']) {
      expect(cleanOrderRequest(request({ phone })).phone).toBe('(424) 408-0552')
    }
  })

  test('keeps a longer, international phone number as typed', () => {
    expect(cleanOrderRequest(request({ phone: ' +44  20 7946 0958 ' })).phone).toBe('+44 20 7946 0958')
  })

  test('rejects bad shapes, items, contact details', () => {
    const bad = [
      null, [], 'x', {},
      request({ items: [] }), request({ items: 'x' }), request({ items: [null] }),
      request({ items: [{ productId: 1, quantity: 0, delivery: 'ship' }] }),
      request({ items: [{ productId: 1, quantity: 100, delivery: 'ship' }] }),
      request({ items: [{ productId: 1, quantity: 1.5, delivery: 'ship' }] }),
      request({ items: [{ productId: 0, quantity: 1, delivery: 'ship' }] }),
      request({ items: [{ productId: 1, quantity: 1, delivery: 'courier' }] }),
      request({ items: [{ productId: 1, quantity: 1, delivery: 'ship' }, { productId: 1, quantity: 1, delivery: 'pickup' }] }),
      request({ items: Array.from({ length: 51 }, (_, i) => ({ productId: i + 1, quantity: 1, delivery: 'ship' })) }),
      request({ email: 'nope' }), request({ email: '' }), request({ email: 5 }),
      request({ phone: '123' }), request({ phone: undefined }),
    ]
    for (const input of bad) expect(() => cleanOrderRequest(input)).toThrow(ContentValidationError)
  })
})

describe('shipping address validation', () => {
  test('accepts and trims a valid address, including ZIP+4', () => {
    expect(cleanAddress({ ...address, name: ' Olena K ', zip: '92626-1234' })).toEqual({ ...address, zip: '92626-1234' })
  })

  test('rejects missing fields, other regions, and malformed ZIP codes', () => {
    const bad = [
      null, 'x', {}, { ...address, name: ' ' }, { ...address, street: '' }, { ...address, city: 5 },
      { ...address, state: '' }, { ...address, state: 'AK' }, { ...address, state: 'HI' }, { ...address, state: 'California' },
      { ...address, zip: '9262' }, { ...address, zip: 'ABCDE' }, { ...address, zip: '92626-12' },
      { ...address, name: 'x'.repeat(101) },
    ]
    for (const input of bad) expect(() => cleanAddress(input)).toThrow(ContentValidationError)
  })
})

describe('building an order', () => {
  test('prices every line from the catalog and adds shipping for shipped items', () => {
    const order = buildOrder(cleanOrderRequest(request({
      items: [{ productId: 1, quantity: 2, delivery: 'ship' }, { productId: 2, quantity: 1, delivery: 'ship' }, { productId: 3, quantity: 1, delivery: 'pickup' }],
    })), catalog)
    expect(order.totals).toEqual({ subtotalCents: 5400, shippedUnits: 3, boxes: 1, shippingCents: 2000, totalCents: 7400 })
    expect(order.address).toEqual(address)
    expect(order.items).toEqual([
      { productId: 1, sku: 'SKU-1', title: 'Rye', unitPriceCents: 1000, quantity: 2, delivery: 'ship' },
      { productId: 2, sku: 'SKU-2', title: 'Bagel', unitPriceCents: 400, quantity: 1, delivery: 'ship' },
      { productId: 3, sku: 'SKU-3', title: 'Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' },
    ])
  })

  test('ignores prices and totals sent by the browser', () => {
    const order = buildOrder(cleanOrderRequest(request({
      items: [{ productId: 1, quantity: 1, delivery: 'ship', priceCents: 1, unitPriceCents: 1 }], totalCents: 1, shippingCents: 0,
    })), catalog)
    expect(order.items[0]!.unitPriceCents).toBe(1000)
    expect(order.totals.totalCents).toBe(3000)
  })

  test('treats a product that cannot be shipped as pickup even if the browser says ship', () => {
    const order = buildOrder(cleanOrderRequest(request({ items: [{ productId: 3, quantity: 2, delivery: 'ship' }] })), catalog)
    expect(order.items[0]!.delivery).toBe('pickup')
    expect(order.totals).toMatchObject({ shippedUnits: 0, shippingCents: 0, totalCents: 6000 })
  })

  test('needs no address when everything is picked up, and does not store one', () => {
    const noAddress = request({ items: [{ productId: 1, quantity: 5, delivery: 'pickup' }], address: undefined })
    const order = buildOrder(cleanOrderRequest(noAddress), catalog)
    expect(order.address).toBeNull()
    expect(order.totals.shippingCents).toBe(0)
    expect(buildOrder(cleanOrderRequest({ ...noAddress, address }), catalog).address).toBeNull()
  })

  test('needs a valid address as soon as anything is shipped', () => {
    expect(() => buildOrder(cleanOrderRequest(request({ address: undefined })), catalog)).toThrow(ContentValidationError)
    expect(() => buildOrder(cleanOrderRequest(request({ address: { ...address, state: 'HI' } })), catalog)).toThrow(ContentValidationError)
  })

  test('refuses products that are missing, disabled, or have no price', () => {
    for (const productId of [99, 4, 5]) {
      const input = request({ items: [{ productId: 1, quantity: 1, delivery: 'ship' }, { productId, quantity: 1, delivery: 'ship' }] })
      expect(() => buildOrder(cleanOrderRequest(input), catalog)).toThrow(OrderUnavailableError)
    }
  })
})

describe('order handler', () => {
  const placed = { slug: 'AbCdEfGh12345678', status: 'unpaid' as const, subtotalCents: 2000, shippingCents: 2000, totalCents: 4000, shippedUnits: 2, boxes: 1 }
  const make = (overrides: Partial<Parameters<typeof createOrderHandler>[0]> = {}) => {
    const saved: NewOrder[] = []
    const handler = createOrderHandler({
      loadProducts: async () => [...catalog.values()],
      save: async order => { saved.push(order); return placed },
      ...overrides,
    })
    return { handler, saved }
  }

  test('saves a valid order and returns its reference and totals', async () => {
    const { handler, saved } = make()
    const response = await handler(request(), '1.2.3.4')
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(placed)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.totals.totalCents).toBe(4000)
  })

  test('answers 400 for invalid details and saves nothing', async () => {
    const { handler, saved } = make()
    const response = await handler(request({ email: 'nope' }), '1.2.3.4')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Enter a valid email address.')
    expect(saved).toHaveLength(0)
  })

  test('answers 409 when an item is no longer available', async () => {
    const { handler, saved } = make()
    const response = await handler(request({ items: [{ productId: 4, quantity: 1, delivery: 'ship' }] }), '1.2.3.4')
    expect(response.status).toBe(409)
    expect(saved).toHaveLength(0)
  })

  test('limits orders per visitor and overall', async () => {
    const { handler } = make({
      perVisitor: createRateLimiter({ max: 1, windowMs: 1000 }),
      overall: createRateLimiter({ max: 2, windowMs: 1000 }),
    })
    expect((await handler(request(), 'a')).status).toBe(201)
    expect((await handler(request(), 'a')).status).toBe(429)
    expect((await handler(request(), 'b')).status).toBe(201)
    expect((await handler(request(), 'c')).status).toBe(429)
  })

  test('answers 503 with a friendly message when saving or loading fails, without leaking details', async () => {
    for (const overrides of [
      { save: async () => { throw new Error('connection to db.internal failed') } },
      { loadProducts: async () => { throw new Error('connection to db.internal failed') } },
    ]) {
      const response = await make(overrides).handler(request(), '1.2.3.4')
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).not.toContain('db.internal')
    }
  })
})

describe('reading orders', () => {
  const row = {
    slug: 'AbCdEfGh12345678', status: 'unpaid', created_at: new Date('2026-10-04T12:30:00Z'), email: 'olena@example.com', phone: '(424) 408-0552',
    ship_name: 'Olena K', ship_street: '1 Main St', ship_city: 'Costa Mesa', ship_state: 'CA', ship_zip: '92626',
    items: [
      { productId: 1, sku: 'SKU-1', title: 'Rye', unitPriceCents: 1000, quantity: 4, delivery: 'ship' as const },
      { productId: 3, sku: 'SKU-3', title: 'Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' as const },
    ],
    subtotal_cents: 7000, shipping_cents: 4000, total_cents: 11000, shipped_units: 4, boxes: 2, currency: 'USD',
    paid_at: null as Date | null, payment_problem: null as string | null,
  }

  test('turns a stored row into the full order', () => {
    expect(orderFromRow(row)).toEqual({
      slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T12:30:00.000Z', email: 'olena@example.com', phone: '(424) 408-0552',
      address: { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' },
      items: row.items, itemCount: 5, subtotalCents: 7000, shippingCents: 4000, totalCents: 11000, shippedUnits: 4, boxes: 2, currency: 'USD',
      paidAt: null, paymentProblem: null, needsAttention: false,
    })
  })

  test('carries the payment time and any payment problem', () => {
    const paid = orderFromRow({ ...row, status: 'paid', paid_at: new Date('2026-10-05T01:02:03Z') })
    expect(paid.paidAt).toBe('2026-10-05T01:02:03.000Z')
    expect(paid.needsAttention).toBe(false)
    const problem = orderFromRow({ ...row, payment_problem: 'Quantity differs' })
    expect(problem.paymentProblem).toBe('Quantity differs')
    expect(problem.needsAttention).toBe(true)
    expect(summaryOf(problem).needsAttention).toBe(true)
  })

  test('has no address for a pickup order', () => {
    const pickup = orderFromRow({ ...row, ship_name: null, ship_street: null, ship_city: null, ship_state: null, ship_zip: null, shipped_units: 0, boxes: 0, shipping_cents: 0, total_cents: 7000 })
    expect(pickup.address).toBeNull()
  })

  test('the list shows only a summary and never the phone number or address', () => {
    const summary = summaryOf(orderFromRow(row))
    expect(summary).toEqual({ slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T12:30:00.000Z', email: 'olena@example.com', itemCount: 5, shippedUnits: 4, totalCents: 11000, needsAttention: false })
    expect(JSON.stringify(summary)).not.toContain('Main St')
    expect(JSON.stringify(summary)).not.toContain('408-0552')
  })

  test('recognizes well-formed order references only', () => {
    for (const good of ['AbCdEfGh12345678', '0000000000000000', 'zzzzzzzzzzzzzzzz']) expect(orderSlugPattern.test(good)).toBe(true)
    for (const bad of ['', 'short', 'AbCdEfGh1234567', 'AbCdEfGh123456789', 'AbCdEfGh1234567-', "AbCdEfGh1234567' OR 1=1", 'AbCdEfGh12345678\n']) {
      expect(orderSlugPattern.test(bad)).toBe(false)
    }
  })
})

describe('changing an order status', () => {
  test('accepts exactly the four statuses', () => {
    for (const status of ['unpaid', 'paid', 'shipped', 'delivered']) {
      expect<string>(cleanOrderStatus({ status })).toBe(status)
    }
  })

  test('refuses anything else, including look-alikes and wrong shapes', () => {
    const bad = [
      null, undefined, [], 'paid', 5, {}, { status: undefined }, { status: null }, { status: '' }, { status: ' paid' }, { status: 'paid ' },
      { status: 'PAID' }, { status: 'Paid' }, { status: 'placed' }, { status: 'cancelled' }, { status: 'refunded' },
      { status: 1 }, { status: ['paid'] }, { status: { value: 'paid' } }, { status: true }, ['paid'],
    ]
    for (const input of bad) expect(() => cleanOrderStatus(input)).toThrow(ContentValidationError)
  })

  test('ignores extra fields, so only the status can be changed through this endpoint', () => {
    expect(cleanOrderStatus({ status: 'paid', totalCents: 1, email: 'x@y.co', slug: 'AbCdEfGh12345678' })).toBe('paid')
  })
})
