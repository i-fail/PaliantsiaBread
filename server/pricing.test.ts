import { describe, expect, test } from 'bun:test'
import { cartTotals, shippingBoxes } from '../shared/pricing'

describe('shipping boxes', () => {
  test('holds three products per box', () => {
    const boxes = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10].map(shippingBoxes)
    expect(boxes).toEqual([0, 1, 1, 1, 2, 2, 2, 3, 3, 4])
  })
})

describe('cart totals', () => {
  const rye = { priceCents: 1000, quantity: 1, shipped: true }
  const cake = { priceCents: 3000, quantity: 1, shipped: false }

  test('an empty cart costs nothing', () => {
    expect(cartTotals([])).toEqual({ subtotalCents: 0, shippedUnits: 0, boxes: 0, shippingCents: 0, totalCents: 0 })
  })

  test('products without shipping are charged only their price', () => {
    expect(cartTotals([{ ...cake, quantity: 5 }])).toEqual({ subtotalCents: 15000, shippedUnits: 0, boxes: 0, shippingCents: 0, totalCents: 15000 })
  })

  test('one to three shipped products cost one $20 box', () => {
    for (const quantity of [1, 2, 3]) {
      const totals = cartTotals([{ ...rye, quantity }])
      expect(totals.boxes).toBe(1)
      expect(totals.shippingCents).toBe(2000)
      expect(totals.totalCents).toBe(1000 * quantity + 2000)
    }
  })

  test('the fourth shipped product needs a second box', () => {
    const totals = cartTotals([{ ...rye, quantity: 4 }])
    expect(totals).toEqual({ subtotalCents: 4000, shippedUnits: 4, boxes: 2, shippingCents: 4000, totalCents: 8000 })
  })

  test('different shipped products share boxes', () => {
    const totals = cartTotals([{ ...rye, quantity: 2 }, { priceCents: 400, quantity: 1, shipped: true }])
    expect(totals.shippedUnits).toBe(3)
    expect(totals.boxes).toBe(1)
    expect(totals.totalCents).toBe(2400 + 2000)
  })

  test('items chosen for pickup do not count toward shipping', () => {
    // Four Rye would need two boxes, but two of them are picked up, so one box is enough.
    const totals = cartTotals([{ ...rye, quantity: 2 }, { ...rye, quantity: 2, shipped: false }])
    expect(totals).toEqual({ subtotalCents: 4000, shippedUnits: 2, boxes: 1, shippingCents: 2000, totalCents: 6000 })
    // Everything picked up: no shipping at all.
    expect(cartTotals([{ ...rye, quantity: 7, shipped: false }]).shippingCents).toBe(0)
  })

  test('products that cannot be shipped neither fill boxes nor add shipping', () => {
    const totals = cartTotals([{ ...rye, quantity: 3 }, { ...cake, quantity: 10 }])
    expect(totals.shippedUnits).toBe(3)
    expect(totals.boxes).toBe(1)
    expect(totals.subtotalCents).toBe(3000 + 30000)
    expect(totals.shippingCents).toBe(2000)
    expect(totals.totalCents).toBe(35000)
  })
})
