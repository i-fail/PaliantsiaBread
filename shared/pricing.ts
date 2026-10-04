// Shipping: shipped products are packed into boxes, each holding up to 3 products and costing $20.
export const shippingBox = { capacity: 3, cents: 2000 } as const

export function shippingBoxes(shippedUnits: number): number {
  return shippedUnits > 0 ? Math.ceil(shippedUnits / shippingBox.capacity) : 0
}

export interface PricedLine {
  priceCents: number
  quantity: number
  shippingAvailable: boolean
}

export interface CartTotals {
  subtotalCents: number
  // Products in the cart that will be shipped (those with shipping available), counting quantities.
  shippedUnits: number
  boxes: number
  shippingCents: number
  totalCents: number
}

// Products without shipping are charged only their price; shipped ones also add the cost of their boxes.
export function cartTotals(lines: PricedLine[]): CartTotals {
  const subtotalCents = lines.reduce((total, line) => total + line.priceCents * line.quantity, 0)
  const shippedUnits = lines.reduce((total, line) => total + (line.shippingAvailable ? line.quantity : 0), 0)
  const boxes = shippingBoxes(shippedUnits)
  const shippingCents = boxes * shippingBox.cents
  return { subtotalCents, shippedUnits, boxes, shippingCents, totalCents: subtotalCents + shippingCents }
}
