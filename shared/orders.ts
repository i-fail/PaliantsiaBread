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

// 10 digits or more. 15 is the longest an international number can be, and the length cap keeps what is stored sane.
export const phoneLimits = { minDigits: 10, maxDigits: 15, maxLength: 30 } as const

// A phone number is good when it has at least 10 digits; whatever else is typed around them (spaces, dashes,
// brackets, dots, a "+", even a note such as "cell") is ignored for the count. A US number (10 digits, or 11
// with a leading country code 1) is returned in one standard form, "(424) 408-0552"; any longer number, such
// as an international one, is kept as typed. Returns null when it has too few digits.
export function normalizePhone(text: string): string | null {
  const typed = text.trim().replace(/\s+/g, ' ')
  if (typed.length > phoneLimits.maxLength) return null
  const digits = typed.replace(/\D/g, '')
  if (digits.length < phoneLimits.minDigits || digits.length > phoneLimits.maxDigits) return null
  const us = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return us.length === 10 ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : typed
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
