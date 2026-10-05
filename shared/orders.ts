import type { Delivery } from './delivery'

// Shipping covers the contiguous United States: the 50 states minus Alaska and Hawaii.
export const shippingStates = [
  ['AL', 'Alabama'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
  ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
  ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const

export const stateCodes: ReadonlySet<string> = new Set(shippingStates.map(([code]) => code))

export const orderLimits = {
  email: 254,
  name: 100,
  street: 120,
  city: 80,
  lines: 50,
  maxQuantity: 99,
} as const

export const zipPattern = /^\d{5}(-\d{4})?$/

// Reads a US phone number typed in any common format and returns it as "(424) 408-0552", or null when it
// is not a valid 10-digit number (an optional leading country code 1 is accepted).
export function normalizePhone(text: string): string | null {
  if (/[^\d\s().+-]/.test(text)) return null
  let digits = text.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  // Area codes and exchanges never start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export interface ShippingAddress {
  name: string
  street: string
  city: string
  state: string
  zip: string
}

export interface OrderRequestLine {
  productId: number
  quantity: number
  delivery: Delivery
}

export interface OrderRequest {
  items: OrderRequestLine[]
  email: string
  phone: string
  // Required when any item is shipped; ignored otherwise.
  address?: ShippingAddress
}

// What is stored for each line: a snapshot, so later product edits never change an existing order.
export interface OrderItem {
  productId: number
  sku: string
  title: string
  unitPriceCents: number
  quantity: number
  // What actually happens to this line: products that cannot be shipped are always picked up.
  delivery: Delivery
}

// An order's progress, in order. Every order starts as unpaid.
export const orderStatuses = ['unpaid', 'paid', 'shipped', 'delivered'] as const
export type OrderStatus = (typeof orderStatuses)[number]
export const initialOrderStatus: OrderStatus = 'unpaid'

export interface PlacedOrder {
  slug: string
  status: OrderStatus
  subtotalCents: number
  shippingCents: number
  totalCents: number
  shippedUnits: number
  boxes: number
}

// An order's reference: 16 letters and digits.
export const orderSlugPattern = /^[A-Za-z0-9]{16}$/

// One row of the admin's list of orders.
export interface OrderSummary {
  slug: string
  status: OrderStatus
  createdAt: string
  email: string
  // Total number of products ordered, counting quantities.
  itemCount: number
  shippedUnits: number
  totalCents: number
}

// Everything stored about an order.
export interface OrderDetails extends OrderSummary {
  phone: string
  // Present only when something is shipped.
  address: ShippingAddress | null
  items: OrderItem[]
  subtotalCents: number
  shippingCents: number
  boxes: number
  currency: string
}

export function orderStatusLabel(status: OrderStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
