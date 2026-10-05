import { expect, test, type Page } from '@playwright/test'

const product = (id: number, title: string, priceCents: number | null, shippingAvailable: boolean) => ({
  id, slug: title.toLowerCase(), sku: `SKU-${id}`, title, description: '', enabled: true,
  priceCents, shippingAvailable, mainPhotoId: null, photos: [],
})
const rye = product(1, 'Rye', 1000, true)
const cake = product(3, 'Cake', 3000, false)

async function setUp(page: Page, cartItems: { productId: number; quantity: number; delivery?: string }[]) {
  await page.addInitScript(items => {
    // Only seed once, so what the page does to the cart survives reloads.
    if (!localStorage.getItem('palianytsia-cart')) localStorage.setItem('palianytsia-cart', JSON.stringify(items))
  }, cartItems)
  await page.route('**/api/products', route => route.fulfill({ json: [rye, cake] }))
}

const placed = { slug: 'AbCdEfGh12345678', subtotalCents: 2000, shippingCents: 2000, totalCents: 4000, shippedUnits: 2, boxes: 1 }

async function captureOrders(page: Page, response: { status?: number; json: unknown } = { status: 201, json: placed }) {
  const bodies: Record<string, unknown>[] = []
  await page.route('**/api/orders', route => {
    bodies.push(route.request().postDataJSON())
    return route.fulfill(response)
  })
  return bodies
}

async function fillContact(page: Page) {
  await page.getByLabel('Email').fill('olena@example.com')
  await page.getByLabel('Phone').fill('424-408-0552')
}

async function fillAddress(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Olena K')
  await page.getByLabel('Street address').fill('1 Main St')
  await page.getByLabel('City').fill('Costa Mesa')
  await page.getByLabel('State').selectOption('CA')
  await page.getByLabel('ZIP code').fill('92626')
}

test('a pickup-only order asks only for email and phone', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }, { productId: 1, quantity: 2, delivery: 'pickup' }])
  const orders = await captureOrders(page, { status: 201, json: { ...placed, shippingCents: 0, shippedUnits: 0, boxes: 0, totalCents: 5000 } })
  await page.goto('/checkout')

  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Phone')).toBeVisible()
  for (const label of ['Name', 'Street address', 'City', 'State', 'ZIP code']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'Shipping address' })).toHaveCount(0)

  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders).toEqual([{
    items: [{ productId: 3, quantity: 1, delivery: 'pickup' }, { productId: 1, quantity: 2, delivery: 'pickup' }],
    email: 'olena@example.com',
    phone: '424-408-0552',
  }])
})

test('shipping adds name and address fields, with every state except Alaska and Hawaii', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 2 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')

  await expect(page.getByRole('heading', { name: 'Shipping address' })).toBeVisible()
  const options = await page.getByLabel('State').locator('option').allTextContents()
  expect(options[0]).toBe('Select a state')
  expect(options).toHaveLength(49)
  // Two-letter codes, in alphabetical order.
  expect(options.slice(1, 5)).toEqual(['AL', 'AR', 'AZ', 'CA'])
  expect(options.slice(1)).toEqual([...options.slice(1)].sort())
  expect(options).toContain('CA')
  expect(options).toContain('WY')
  expect(options).not.toContain('AK')
  expect(options).not.toContain('HI')
  expect(options.slice(1).every(option => /^[A-Z]{2}$/.test(option))).toBe(true)

  await fillContact(page)
  await fillAddress(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders).toEqual([{
    items: [{ productId: 1, quantity: 2, delivery: 'ship' }],
    email: 'olena@example.com',
    phone: '424-408-0552',
    address: { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' },
  }])
})

test('the address fields follow the delivery choice and keep what was typed', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  await captureOrders(page)
  await page.goto('/checkout')
  await page.getByLabel('Street address').fill('1 Main St')

  await page.getByRole('radio', { name: 'Pickup' }).check()
  await expect(page.getByLabel('Street address')).toHaveCount(0)
  await expect(page.getByLabel('Email')).toBeVisible()

  await page.getByRole('radio', { name: 'Ship' }).check()
  await expect(page.getByLabel('Street address')).toHaveValue('1 Main St')
})

test('a successful order shows its reference and empties the cart', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 2 }])
  await captureOrders(page)
  await page.goto('/checkout')
  await expect(page.getByRole('link', { name: /^Cart:/ })).toHaveAccessibleName('Cart: 2 items')
  await fillContact(page)
  await fillAddress(page)
  await page.getByRole('button', { name: 'Place order' }).click()

  await expect(page.getByText('AbCdEfGh12345678')).toBeVisible()
  await expect(page.getByText('$40.00')).toBeVisible()
  await expect(page.getByText('including $20.00 shipping')).toBeVisible()
  await expect(page.getByText('olena@example.com')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Cart:/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Place order' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('Your cart is empty.')).toBeVisible()
  await page.getByRole('link', { name: 'Browse our bread' }).click()
  await expect(page).toHaveURL('/buy')
})

test('an invalid phone number is explained and nothing is sent', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')
  await page.getByLabel('Email').fill('olena@example.com')
  await page.getByLabel('Phone').fill('12345')
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('alert')).toContainText('phone number with at least 10 digits')
  expect(orders).toHaveLength(0)
})

test('Place order stays disabled until every shown field is filled in', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')
  const place = page.getByRole('button', { name: 'Place order' })
  await expect(place).toBeDisabled()
  await expect(page.getByText('Fill in all the fields above to place your order.')).toBeVisible()

  await page.getByLabel('Email').fill('olena@example.com')
  await expect(place).toBeDisabled()
  await page.getByLabel('Phone').fill('424-408-0552')
  await expect(place).toBeDisabled()
  await page.getByLabel('Name', { exact: true }).fill('Olena K')
  await page.getByLabel('Street address').fill('1 Main St')
  await page.getByLabel('City').fill('Costa Mesa')
  await expect(place).toBeDisabled()
  await page.getByLabel('State').selectOption('CA')
  await expect(place).toBeDisabled()

  // Spaces alone are not an answer.
  await page.getByLabel('ZIP code').fill('   ')
  await expect(place).toBeDisabled()
  await page.getByLabel('ZIP code').fill('92626')
  await expect(place).toBeEnabled()
  await expect(page.getByText('Fill in all the fields above to place your order.')).toHaveCount(0)

  // Emptying any field disables it again.
  await page.getByLabel('City').fill('')
  await expect(place).toBeDisabled()
  await page.getByLabel('City').fill('Costa Mesa')
  await expect(place).toBeEnabled()
  expect(orders).toHaveLength(0)

  await place.click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders).toHaveLength(1)
})

test('without anything to ship only email and phone are needed', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  await captureOrders(page)
  await page.goto('/checkout')
  const place = page.getByRole('button', { name: 'Place order' })
  await expect(place).toBeDisabled()
  await page.getByLabel('Email').fill('olena@example.com')
  await expect(place).toBeDisabled()
  await page.getByLabel('Phone').fill('424-408-0552')
  await expect(place).toBeEnabled()
})

test('switching an item to shipping makes the address fields required for the button', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1, delivery: 'pickup' }])
  await captureOrders(page)
  await page.goto('/checkout')
  await fillContact(page)
  const place = page.getByRole('button', { name: 'Place order' })
  await expect(place).toBeEnabled()

  await page.getByRole('radio', { name: 'Ship' }).check()
  await expect(place).toBeDisabled()
  await fillAddress(page)
  await expect(place).toBeEnabled()

  await page.getByRole('radio', { name: 'Pickup' }).check()
  await expect(place).toBeEnabled()
})

test('a refused order shows the reason, keeps the cart and form, and refreshes prices', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  let priceLoads = 0
  await page.route('**/api/products', route => { priceLoads++; return route.fulfill({ json: [rye, cake] }) })
  await captureOrders(page, { status: 409, json: { error: 'Some items in your cart are no longer available. Please review your cart and try again.' } })
  await page.goto('/checkout')
  await fillContact(page)
  await fillAddress(page)
  await page.getByRole('button', { name: 'Place order' }).click()

  await expect(page.getByRole('alert')).toContainText('no longer available')
  expect(priceLoads).toBeGreaterThan(1)
  await expect(page.getByLabel('Email')).toHaveValue('olena@example.com')
  await expect(page.getByLabel('Street address')).toHaveValue('1 Main St')
  await expect(page.getByLabel('Quantity of Rye')).toHaveValue('1')
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
})

test('a server problem shows a friendly message and the order can be retried', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  let attempts = 0
  await page.route('**/api/orders', route => {
    attempts++
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: 'We couldn’t place your order right now. Please try again or call us.' } }
      : { status: 201, json: { ...placed, shippingCents: 0, shippedUnits: 0, boxes: 0, totalCents: 3000 } })
  })
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t place your order')
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
})

test('unavailable items are not sent with the order', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }, { productId: 99, quantity: 4 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders[0]!.items).toEqual([{ productId: 3, quantity: 1, delivery: 'pickup' }])
})

test('what you type is remembered and filled in again on your next visit', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  await captureOrders(page)
  await page.goto('/checkout')
  await fillContact(page)
  await fillAddress(page)
  await expect(page.getByLabel('Email')).toHaveValue('olena@example.com')

  await page.reload()
  await expect(page.getByLabel('Email')).toHaveValue('olena@example.com')
  await expect(page.getByLabel('Phone')).toHaveValue('424-408-0552')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Olena K')
  await expect(page.getByLabel('Street address')).toHaveValue('1 Main St')
  await expect(page.getByLabel('City')).toHaveValue('Costa Mesa')
  await expect(page.getByLabel('State')).toHaveValue('CA')
  await expect(page.getByLabel('ZIP code')).toHaveValue('92626')
  // Everything is already filled in, so the order can be placed straight away.
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
})

test('changes and cleared fields are remembered too', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByLabel('Email').fill('')
  await page.getByLabel('Phone').fill('310-555-0100')
  await page.reload()
  await expect(page.getByLabel('Email')).toHaveValue('')
  await expect(page.getByLabel('Phone')).toHaveValue('310-555-0100')
})

test('the details are still there after an order is placed, for the next order', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  await captureOrders(page)
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()

  // Come back later with a new cart.
  await page.evaluate(() => localStorage.setItem('palianytsia-cart', JSON.stringify([{ productId: 3, quantity: 2, delivery: 'ship' }])))
  await page.goto('/checkout')
  await expect(page.getByLabel('Email')).toHaveValue('olena@example.com')
  await expect(page.getByLabel('Phone')).toHaveValue('424-408-0552')
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
})

test('address details typed for a shipped order come back even after a pickup-only visit', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  await page.goto('/checkout')
  await fillAddress(page)
  await page.getByRole('radio', { name: 'Pickup' }).check()
  await page.reload()
  await expect(page.getByLabel('Street address')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Ship' }).check()
  await expect(page.getByLabel('Street address')).toHaveValue('1 Main St')
  await expect(page.getByLabel('State')).toHaveValue('CA')
})

test('unusable saved details are ignored, including a state we do not ship to', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }])
  await page.addInitScript(() => localStorage.setItem('palianytsia-checkout', JSON.stringify({
    email: 'saved@example.com', phone: 5, name: 'Olena K', street: '1 Main St', city: 'Anchorage', state: 'AK', zip: '99501',
  })))
  await page.goto('/checkout')
  await expect(page.getByLabel('Email')).toHaveValue('saved@example.com')
  await expect(page.getByLabel('Phone')).toHaveValue('')
  await expect(page.getByLabel('City')).toHaveValue('Anchorage')
  await expect(page.getByLabel('State')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled()
})

test('corrupt saved details do not break the page', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  await page.addInitScript(() => localStorage.setItem('palianytsia-checkout', '{not json'))
  await page.goto('/checkout')
  await expect(page.getByLabel('Email')).toHaveValue('')
  await fillContact(page)
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled()
})

test('a phone number in any format is accepted as long as it has 10 digits', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')
  await page.getByLabel('Email').fill('olena@example.com')

  const phone = page.getByLabel('Phone')
  const place = page.getByRole('button', { name: 'Place order' })
  await phone.fill('424 408 055')
  await place.click()
  await expect(page.getByRole('alert')).toContainText('at least 10 digits')
  expect(orders).toHaveLength(0)

  await phone.fill('call 424.408.0552 (cell)')
  await place.click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders).toHaveLength(1)
})

test('an international phone number with more than 10 digits is accepted', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  const orders = await captureOrders(page)
  await page.goto('/checkout')
  await page.getByLabel('Email').fill('olena@example.com')
  await page.getByLabel('Phone').fill('+44 20 7946 0958')
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  expect(orders[0]!.phone).toBe('+44 20 7946 0958')
})

test('after ordering, the confirmation links to the order page', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  await captureOrders(page)
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you! Your order has been placed.' })).toBeVisible()
  // The reference itself is a link to the order page, as is the button below it.
  await expect(page.getByRole('link', { name: 'AbCdEfGh12345678' })).toHaveAttribute('href', '/order/AbCdEfGh12345678')
  await expect(page.getByRole('link', { name: 'View your order' })).toHaveAttribute('href', '/order/AbCdEfGh12345678')
  await expect(page.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/buy')
})

test('clicking the order reference in the confirmation opens that order', async ({ page }) => {
  await setUp(page, [{ productId: 3, quantity: 1 }])
  await captureOrders(page)
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
  await page.route('**/api/orders/AbCdEfGh12345678', route => route.fulfill({
    json: {
      slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T19:30:00.000Z', email: 'olena@example.com', phone: '(424) 408-0552',
      address: null, items: [{ productId: 3, sku: 'SKU-3', title: 'Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' }],
      itemCount: 1, subtotalCents: 3000, shippingCents: 0, totalCents: 3000, shippedUnits: 0, boxes: 0, currency: 'USD',
    },
  }))
  await page.goto('/checkout')
  await fillContact(page)
  await page.getByRole('button', { name: 'Place order' }).click()
  await page.getByRole('link', { name: 'AbCdEfGh12345678' }).click()
  await expect(page).toHaveURL('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')
  await expect(page.getByRole('region', { name: 'Items' })).toContainText('Cake')
})
