import { randomInt } from 'node:crypto'
import { emailPattern } from '../shared/contact'
import type { Delivery } from '../shared/delivery'
import {
  initialOrderStatus, normalizePhone, orderLimits, orderSlugPattern, stateCodes, zipPattern,
  type OrderDetails, type OrderItem, type OrderRequest, type OrderStatus, type OrderSummary, type PlacedOrder, type ShippingAddress,
} from '../shared/orders'
import { cartTotals, type CartTotals } from '../shared/pricing'
import { currency, type Product } from '../shared/products'
import { ContentValidationError } from './content'
import { getDatabase } from './db'
import { createRateLimiter } from './rate-limit'

export class OrderUnavailableError extends Error {}

const slugAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// 16 characters from 62 symbols, drawn with a cryptographic generator, so references cannot be guessed.
export function newOrderSlug(): string {
  return Array.from({ length: 16 }, () => slugAlphabet[randomInt(slugAlphabet.length)]).join('')
}

export interface ParsedOrderRequest extends Omit<OrderRequest, 'address'> {
  // Checked only once we know whether anything is being shipped.
  address: unknown
}

const asObject = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentValidationError(message)
  return value as Record<string, unknown>
}

export function cleanOrderRequest(value: unknown): ParsedOrderRequest {
  const source = asObject(value, 'Send your cart and contact details.')

  const rawItems = source.items
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > orderLimits.lines) {
    throw new ContentValidationError('Your cart is empty.')
  }
  const seen = new Set<number>()
  const items = rawItems.map(raw => {
    const line = asObject(raw, 'Each cart item must have a product, quantity, and delivery.')
    const { productId, quantity, delivery } = line
    if (!Number.isSafeInteger(productId) || (productId as number) < 1) throw new ContentValidationError('Each cart item must have a product.')
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > orderLimits.maxQuantity) {
      throw new ContentValidationError(`Each quantity must be between 1 and ${orderLimits.maxQuantity}.`)
    }
    if (delivery !== 'ship' && delivery !== 'pickup') throw new ContentValidationError('Choose shipping or pickup for each item.')
    if (seen.has(productId as number)) throw new ContentValidationError('Each product can appear in the cart only once.')
    seen.add(productId as number)
    return { productId: productId as number, quantity: quantity as number, delivery: delivery as Delivery }
  })

  const email = typeof source.email === 'string' ? source.email.trim() : ''
  if (!email || email.length > orderLimits.email || !emailPattern.test(email)) {
    throw new ContentValidationError('Enter a valid email address.')
  }
  const phone = typeof source.phone === 'string' ? normalizePhone(source.phone) : null
  if (!phone) throw new ContentValidationError('Enter a phone number with at least 10 digits.')

  return { items, email, phone, address: source.address }
}

export function cleanAddress(value: unknown): ShippingAddress {
  const source = asObject(value, 'Enter the shipping name and address.')
  const text = (field: 'name' | 'street' | 'city', label: string, max: number) => {
    const entry = typeof source[field] === 'string' ? (source[field] as string).trim() : ''
    if (!entry) throw new ContentValidationError(`Enter the ${label}.`)
    if (entry.length > max) throw new ContentValidationError(`The ${label} must be at most ${max} characters.`)
    return entry
  }
  const name = text('name', 'name for the shipment', orderLimits.name)
  const street = text('street', 'street address', orderLimits.street)
  const city = text('city', 'city', orderLimits.city)

  const state = typeof source.state === 'string' ? source.state.trim() : ''
  if (!state) throw new ContentValidationError('Choose a state.')
  if (!stateCodes.has(state)) throw new ContentValidationError('We can only ship within the contiguous United States.')

  const zip = typeof source.zip === 'string' ? source.zip.trim() : ''
  if (!zipPattern.test(zip)) throw new ContentValidationError('Enter a valid ZIP code.')
  return { name, street, city, state, zip }
}

export interface NewOrder {
  email: string
  phone: string
  address: ShippingAddress | null
  items: OrderItem[]
  totals: CartTotals
}

// Prices, availability, and shipping all come from the product list given here, never from the browser.
export function buildOrder(request: ParsedOrderRequest, products: Map<number, Product>): NewOrder {
  const items: OrderItem[] = request.items.map(line => {
    const product = products.get(line.productId)
    if (!product || !product.enabled || product.priceCents === null) {
      throw new OrderUnavailableError('Some items in your cart are no longer available. Please review your cart and try again.')
    }
    return {
      productId: product.id,
      sku: product.sku,
      title: product.title,
      unitPriceCents: product.priceCents,
      quantity: line.quantity,
      // A product that cannot be shipped is always picked up, whatever the browser sent.
      delivery: product.shippingAvailable && line.delivery === 'ship' ? 'ship' : 'pickup',
    }
  })
  const totals = cartTotals(items.map(item => ({
    priceCents: item.unitPriceCents,
    quantity: item.quantity,
    shipped: item.delivery === 'ship',
  })))
  return {
    email: request.email,
    phone: request.phone,
    address: totals.shippedUnits > 0 ? cleanAddress(request.address) : null,
    items,
    totals,
  }
}

export async function saveOrder(order: NewOrder): Promise<PlacedOrder> {
  const db = getDatabase()
  const { address, totals } = order
  // Two orders drawing the same random reference is astronomically unlikely, but the unique index decides.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = newOrderSlug()
    try {
      await db`
        INSERT INTO orders (
          slug, status, email, phone, ship_name, ship_street, ship_city, ship_state, ship_zip, items,
          subtotal_cents, shipping_cents, total_cents, shipped_units, boxes, currency
        ) VALUES (
          ${slug}, ${initialOrderStatus}, ${order.email}, ${order.phone},
          ${address?.name ?? null}, ${address?.street ?? null}, ${address?.city ?? null},
          ${address?.state ?? null}, ${address?.zip ?? null}, ${order.items}::jsonb,
          ${totals.subtotalCents}, ${totals.shippingCents}, ${totals.totalCents},
          ${totals.shippedUnits}, ${totals.boxes}, ${currency}
        )
      `
      return {
        slug,
        status: initialOrderStatus,
        subtotalCents: totals.subtotalCents,
        shippingCents: totals.shippingCents,
        totalCents: totals.totalCents,
        shippedUnits: totals.shippedUnits,
        boxes: totals.boxes,
      }
    } catch (error) {
      const failure = error as { errno?: string; constraint?: string }
      if (failure.errno === '23505' && failure.constraint === 'orders_slug_key') continue
      throw error
    }
  }
  throw new Error('Could not generate a unique order reference.')
}

interface OrderHandlerOptions {
  loadProducts: () => Promise<Product[]>
  save?: (order: NewOrder) => Promise<PlacedOrder>
  perVisitor?: ReturnType<typeof createRateLimiter>
  overall?: ReturnType<typeof createRateLimiter>
}

const hour = 60 * 60 * 1000

export function createOrderHandler({
  loadProducts,
  save = saveOrder,
  perVisitor = createRateLimiter({ max: 10, windowMs: hour }),
  overall = createRateLimiter({ max: 200, windowMs: hour }),
}: OrderHandlerOptions) {
  return async (body: unknown, visitor: string): Promise<Response> => {
    let order: NewOrder
    try {
      const request = cleanOrderRequest(body)
      if (!perVisitor.take(visitor) || !overall.take('all')) {
        return Response.json({ error: 'Too many orders. Please try again later or call us.' }, { status: 429 })
      }
      const products = new Map((await loadProducts()).map(product => [product.id, product]))
      order = buildOrder(request, products)
    } catch (error) {
      if (error instanceof OrderUnavailableError) return Response.json({ error: error.message }, { status: 409 })
      if (error instanceof ContentValidationError) return Response.json({ error: error.message }, { status: 400 })
      console.error('Order request failed:', error instanceof Error ? error.message : 'Unknown error')
      return Response.json({ error: 'We couldn’t place your order right now. Please try again or call us.' }, { status: 503 })
    }

    try {
      return Response.json(await save(order), { status: 201, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      // Never log the customer's details.
      console.error('Saving order failed:', error instanceof Error ? error.message : 'Unknown error')
      return Response.json({ error: 'We couldn’t place your order right now. Please try again or call us.' }, { status: 503 })
    }
  }
}

interface OrderRow {
  slug: string
  status: string
  created_at: Date
  email: string
  phone: string
  ship_name: string | null
  ship_street: string | null
  ship_city: string | null
  ship_state: string | null
  ship_zip: string | null
  items: OrderItem[]
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  shipped_units: number
  boxes: number
  currency: string
}

export function orderFromRow(row: OrderRow): OrderDetails {
  const hasAddress = row.ship_name !== null
  return {
    slug: row.slug,
    status: row.status as OrderStatus,
    createdAt: new Date(row.created_at).toISOString(),
    email: row.email,
    phone: row.phone,
    address: hasAddress
      ? { name: row.ship_name!, street: row.ship_street!, city: row.ship_city!, state: row.ship_state!, zip: row.ship_zip! }
      : null,
    items: row.items,
    itemCount: row.items.reduce((total, item) => total + item.quantity, 0),
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    shippedUnits: row.shipped_units,
    boxes: row.boxes,
    currency: row.currency,
  }
}

export function summaryOf(order: OrderDetails): OrderSummary {
  const { slug, status, createdAt, email, itemCount, shippedUnits, totalCents } = order
  return { slug, status, createdAt, email, itemCount, shippedUnits, totalCents }
}

// The most recent orders first. The list is capped so the admin page stays quick.
export const maxListedOrders = 500

export async function listOrders(): Promise<OrderSummary[]> {
  const db = getDatabase()
  const rows: OrderRow[] = await db`SELECT * FROM orders ORDER BY id DESC LIMIT ${maxListedOrders}`
  return rows.map(row => summaryOf(orderFromRow(row)))
}

export async function getOrder(slug: string): Promise<OrderDetails | null> {
  // Anything that is not a well-formed reference cannot exist, so there is no need to ask the database.
  if (!orderSlugPattern.test(slug)) return null
  const db = getDatabase()
  const rows: OrderRow[] = await db`SELECT * FROM orders WHERE slug = ${slug}`
  return rows[0] ? orderFromRow(rows[0]) : null
}
