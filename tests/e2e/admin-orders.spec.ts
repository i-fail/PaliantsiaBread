import { expect, test, type Page } from '@playwright/test'

const shipped = {
  slug: 'AbCdEfGh12345678', status: 'unpaid', createdAt: '2026-10-04T19:30:00.000Z', email: 'olena@example.com', phone: '(424) 408-0552',
  address: { name: 'Olena K', street: '1 Main St', city: 'Costa Mesa', state: 'CA', zip: '92626' },
  items: [
    { productId: 1, sku: 'RYE-01', title: 'Dark Rye', unitPriceCents: 1000, quantity: 4, delivery: 'ship' },
    { productId: 3, sku: 'CAKE-02', title: 'Celebration Cake', unitPriceCents: 3000, quantity: 1, delivery: 'pickup' },
  ],
  itemCount: 5, subtotalCents: 7000, shippingCents: 4000, totalCents: 11000, shippedUnits: 4, boxes: 2, currency: 'USD',
}
const pickup = {
  slug: 'ZyXwVuTs87654321', status: 'paid', createdAt: '2026-10-03T16:05:00.000Z', email: 'ivan@example.com', phone: '(310) 555-0100',
  address: null,
  items: [{ productId: 3, sku: 'CAKE-02', title: 'Celebration Cake', unitPriceCents: 3000, quantity: 2, delivery: 'pickup' }],
  itemCount: 2, subtotalCents: 6000, shippingCents: 0, totalCents: 6000, shippedUnits: 0, boxes: 0, currency: 'USD',
}
const summary = ({ slug, status, createdAt, email, itemCount, shippedUnits, totalCents }: typeof shipped) =>
  ({ slug, status, createdAt, email, itemCount, shippedUnits, totalCents })

async function mockAdmin(page: Page, orders = [shipped, pickup], admin = true) {
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: admin } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/admin/orders', route => route.fulfill({ json: orders.map(order => summary(order as typeof shipped)) }))
  await page.route('**/api/orders/*', route => {
    const slug = route.request().url().split('/').pop()
    const order = orders.find(candidate => candidate.slug === slug)
    return route.fulfill(order ? { json: order } : { status: 404, json: { error: 'Not found' } })
  })
}

test('the Orders tab lists every order with the essentials', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/orders')
  await expect(page.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true')

  const rows = page.getByRole('row')
  await expect(rows).toHaveCount(3) // header + two orders
  await expect(rows.nth(1)).toContainText('AbCdEfGh12345678')
  await expect(rows.nth(1)).toContainText('olena@example.com')
  await expect(rows.nth(1)).toContainText('Oct 4, 2026')
  await expect(rows.nth(1)).toContainText('5') // items
  await expect(rows.nth(1)).toContainText('Shipping')
  await expect(rows.nth(1)).toContainText('$110.00')
  await expect(rows.nth(1)).toContainText('Unpaid')
  await expect(rows.nth(2)).toContainText('ZyXwVuTs87654321')
  await expect(rows.nth(2)).toContainText('Pickup')
  await expect(rows.nth(2)).toContainText('$60.00')
  await expect(rows.nth(2)).toContainText('Paid')
})

test('opening an order from the list goes to /order/<slug>, by its link or anywhere on the row', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/orders')
  await page.getByRole('link', { name: 'AbCdEfGh12345678' }).click()
  await expect(page).toHaveURL('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')

  await page.goBack()
  await expect(page).toHaveURL('/admin/orders')
  await page.getByRole('cell', { name: 'ivan@example.com' }).click()
  await expect(page).toHaveURL('/order/ZyXwVuTs87654321')

  // Clicking the link must open the order once, so a single Back returns to the list.
  await page.goBack()
  await expect(page).toHaveURL('/admin/orders')
})

test('the order page shows the full details of a shipped order', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('unpaid')
  await expect(page.getByText(/Placed October 4, 2026/)).toBeVisible()

  const contact = page.getByRole('region', { name: 'Contact' })
  await expect(contact).toContainText('olena@example.com')
  await expect(contact).toContainText('(424) 408-0552')

  const address = page.getByRole('region', { name: 'Shipping address' })
  await expect(address).toContainText('Olena K')
  await expect(address).toContainText('1 Main St')
  await expect(address).toContainText('Costa Mesa, CA 92626')

  const items = page.getByRole('region', { name: 'Items' }).getByRole('row')
  await expect(items).toHaveCount(3)
  await expect(items.nth(1)).toContainText('Dark Rye')
  await expect(items.nth(1)).toContainText('RYE-01')
  await expect(items.nth(1)).toContainText('$10.00')
  await expect(items.nth(1)).toContainText('Ship')
  await expect(items.nth(1)).toContainText('$40.00')
  await expect(items.nth(2)).toContainText('Celebration Cake')
  await expect(items.nth(2)).toContainText('Pickup')

  const totals = page.getByRole('region', { name: 'Totals' })
  await expect(totals).toContainText('Items$70.00')
  await expect(totals).toContainText('Shipping · 2 boxes for 4 shipped items$40.00')
  await expect(totals).toContainText('Total$110.00')
})

test('the order page for a pickup order has no address and no shipping charge', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/order/ZyXwVuTs87654321')
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('paid')
  await expect(page.getByRole('region', { name: 'Shipping address' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Delivery' })).toContainText('Pickup — nothing to ship.')
  await expect(page.getByRole('region', { name: 'Totals' })).toContainText('ShippingNone')
  await expect(page.getByRole('region', { name: 'Totals' })).toContainText('Total$60.00')
})

test('the order page says so when the order does not exist, and links back to the list', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/order/NoSuchOrder000000')
  await expect(page.getByRole('alert')).toContainText('couldn’t find that order')
  await page.getByRole('link', { name: 'See all orders' }).click()
  await expect(page).toHaveURL('/admin/orders')
})


test('the Orders tab explains when there are no orders yet', async ({ page }) => {
  await mockAdmin(page, [])
  await page.goto('/admin/orders')
  await expect(page.getByText('No orders yet.')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('the Orders tab offers a retry when orders cannot be loaded', async ({ page }) => {
  await mockAdmin(page)
  let available = false
  await page.route('**/api/admin/orders', route => route.fulfill(available
    ? { json: [summary(shipped)] }
    : { status: 503, json: { error: 'This is temporarily unavailable. Please try again.' } }))
  await page.goto('/admin/orders')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  available = true
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('link', { name: 'AbCdEfGh12345678' })).toBeVisible()
})

test('an expired session on the Orders tab returns to the sign-in form', async ({ page }) => {
  await mockAdmin(page)
  await page.route('**/api/admin/orders', route => route.fulfill({ status: 401, json: { error: 'Please sign in as an admin.' } }))
  await page.goto('/admin/orders')
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('session expired')
})

test('the three tabs are reachable with the arrow keys, wrapping around', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/front')
  await page.getByRole('tab', { name: 'Front page' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL('/admin/orders')
  await expect(page.getByRole('tab', { name: 'Orders' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL('/admin/front')
  await page.keyboard.press('End')
  await expect(page).toHaveURL('/admin/orders')
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL('/admin/products')
})

test('an unpaid order has a Pay button at the right, level with the heading and not in the header', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('unpaid')

  const pay = page.getByRole('button', { name: 'Pay' })
  await expect(pay).toBeVisible()
  // It belongs to the page content, not the site header.
  await expect(page.locator('header').getByRole('button', { name: 'Pay' })).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('button', { name: 'Pay' })).toHaveCount(1)

  const button = (await pay.boundingBox())!
  const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  const headerNav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!
  // Level with the <h1>: it starts within the heading's height, and sits below the header.
  expect(button.y).toBeGreaterThanOrEqual(heading.y - 2)
  expect(button.y).toBeLessThan(heading.y + heading.height)
  expect(button.y).toBeGreaterThan(80)
  // On the right, lined up with the right edge of the header above it.
  expect(Math.abs(button.x + button.width - (headerNav.x + headerNav.width))).toBeLessThan(2)
  expect(button.x).toBeGreaterThan(heading.x + heading.width / 2)
})

test('orders that are no longer unpaid have no Pay button', async ({ page }) => {
  const others = ['paid', 'shipped', 'delivered'].map((status, index) => ({ ...pickup, slug: `StatusOrder00000${index}`, status }))
  await mockAdmin(page, [shipped, ...others])
  for (const order of others) {
    await page.goto(`/order/${order.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(order.slug)
    await expect(page.getByRole('button', { name: 'Pay' })).toHaveCount(0)
  }
  // And it is not shown while the order is still loading or missing.
  await page.goto('/order/NoSuchOrder000000')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pay' })).toHaveCount(0)
})


// A stateful stand-in for the API, so the page can be driven through several status changes.
async function mockStatusApi(page: Page, initial = 'unpaid', respond?: (status: string) => { status: number; json: unknown } | null, admin = true) {
  const order = { ...shipped, status: initial }
  const puts: string[] = []
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: admin } }))
  await page.route('**/api/admin/orders/*/status', route => {
    const status = route.request().postDataJSON().status as string
    puts.push(status)
    const custom = respond?.(status)
    if (custom) return route.fulfill(custom)
    order.status = status
    return route.fulfill({ json: order })
  })
  await page.route('**/api/orders/AbCdEfGh12345678', route => route.fulfill({ json: order }))
  return puts
}

test('the status is a dropdown with the four statuses, set to the current one', async ({ page }) => {
  await mockStatusApi(page, 'shipped')
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })
  await expect(status).toHaveValue('shipped')
  expect(await status.locator('option').allTextContents()).toEqual(['Unpaid', 'Paid', 'Shipped', 'Delivered'])
  await expect(status).toBeEnabled()
})

test('choosing another status saves it straight away and shows it afterwards', async ({ page }) => {
  const puts = await mockStatusApi(page)
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })

  await status.selectOption('paid')
  await expect(page.getByRole('status')).toHaveText('Status changed to Paid.')
  expect(puts).toEqual(['paid'])
  await expect(status).toHaveValue('paid')

  await status.selectOption('delivered')
  await expect(page.getByRole('status')).toHaveText('Status changed to Delivered.')
  expect(puts).toEqual(['paid', 'delivered'])

  // It is really stored: a reload shows the new status.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('delivered')
})

test('the Pay button follows the status: gone once paid, back if set to unpaid again', async ({ page }) => {
  await mockStatusApi(page)
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })
  const pay = page.getByRole('button', { name: 'Pay' })
  await expect(pay).toBeVisible()

  await status.selectOption('paid')
  await expect(page.getByRole('status')).toHaveText('Status changed to Paid.')
  await expect(pay).toHaveCount(0)

  await status.selectOption('unpaid')
  await expect(page.getByRole('status')).toHaveText('Status changed to Unpaid.')
  await expect(pay).toBeVisible()
})

test('the dropdown is disabled while a change is being saved, so it cannot be changed twice at once', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const puts: string[] = []
  const order = { ...shipped }
  await page.route('**/api/admin/orders/*/status', async route => {
    puts.push(route.request().postDataJSON().status)
    await gate
    order.status = 'paid'
    await route.fulfill({ json: order })
  })
  await page.route('**/api/orders/AbCdEfGh12345678', route => route.fulfill({ json: order }))
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })

  await status.selectOption('paid')
  await expect(status).toBeDisabled()
  release()
  await expect(status).toBeEnabled()
  await expect(status).toHaveValue('paid')
  expect(puts).toEqual(['paid'])
})

test('a refused change puts the old status back and says why', async ({ page }) => {
  await mockStatusApi(page, 'unpaid', () => ({ status: 503, json: { error: 'This is temporarily unavailable. Please try again.' } }))
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })
  await status.selectOption('paid')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await expect(status).toHaveValue('unpaid')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible()
  await expect(status).toBeEnabled()
})

test('if the admin session has expired, the change is refused and the admin is told to sign in', async ({ page }) => {
  await mockStatusApi(page, 'unpaid', () => ({ status: 401, json: { error: 'Please sign in as an admin.' } }))
  await page.goto('/order/AbCdEfGh12345678')
  const status = page.getByRole('combobox', { name: 'Status' })
  await status.selectOption('shipped')
  await expect(page.getByRole('alert')).toContainText('session expired')
  // No longer an admin: the dropdown is replaced by the plain, unchanged status.
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/admin/orders')
})

// --- Anyone with the link can see an order; only admins get the extra controls. ---

test('anyone with the link sees the order, with the status as plain text and no admin controls', async ({ page }) => {
  await mockAdmin(page, [shipped, pickup], false)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '← All orders' })).toHaveCount(0)

  // The full details are there.
  await expect(page.getByRole('region', { name: 'Contact' })).toContainText('olena@example.com')
  await expect(page.getByRole('region', { name: 'Shipping address' })).toContainText('1 Main St')
  await expect(page.getByRole('region', { name: 'Items' }).getByRole('row')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Totals' })).toContainText('Total$110.00')

  // The ordinary site header, not the admin one.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Buy bread' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Contact' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})

test('a visitor cannot change the status, and the page never asks the server to', async ({ page }) => {
  const puts = await mockStatusApi(page, 'unpaid', undefined, false)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('option')).toHaveCount(0)
  expect(puts).toEqual([])
})

test('an admin sees the same order with the status dropdown and a link back to all orders', async ({ page }) => {
  await mockAdmin(page, [shipped, pickup], true)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('unpaid')
  await expect(page.getByTestId('order-status')).toHaveCount(0)
  await page.getByRole('link', { name: '← All orders' }).click()
  await expect(page).toHaveURL('/admin/orders')
})

test('the order page does not need the admin check to work: if it fails, the visitor just sees the order', async ({ page }) => {
  await mockAdmin(page)
  await page.route('**/api/admin/session', route => route.fulfill({ status: 503, json: { error: 'down' } }))
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByRole('combobox')).toHaveCount(0)
})

test('the Pay button is for everyone while the order is unpaid', async ({ page }) => {
  const others = ['paid', 'shipped', 'delivered'].map((status, index) => ({ ...pickup, slug: 'PublicOrder00000' + index, status }))
  await mockAdmin(page, [shipped, ...others], false)
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible()
  for (const order of others) {
    await page.goto('/order/' + order.slug)
    await expect(page.getByTestId('order-status')).toHaveText(order.status[0]!.toUpperCase() + order.status.slice(1))
    await expect(page.getByRole('button', { name: 'Pay' })).toHaveCount(0)
  }
})

test('an unknown order tells a visitor so and offers the bread, not the admin list', async ({ page }) => {
  await mockAdmin(page, [shipped], false)
  await page.goto('/order/NoSuchOrder000000')
  await expect(page.getByRole('alert')).toContainText('couldn’t find that order')
  await expect(page.getByText('olena@example.com')).toHaveCount(0)
  await page.getByRole('link', { name: 'Browse our bread' }).click()
  await expect(page).toHaveURL('/buy')
})

test('a busy server is explained, with a retry', async ({ page }) => {
  await mockAdmin(page, [shipped], false)
  let available = false
  await page.route('**/api/orders/AbCdEfGh12345678', route => route.fulfill(available
    ? { json: shipped }
    : { status: 429, json: { error: 'Too many requests. Please try again in a few minutes.' } }))
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('alert')).toContainText('Too many requests')
  available = true
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AbCdEfGh12345678')
})

test('search engines are told to leave the order page out, and only that page', async ({ page }) => {
  await mockAdmin(page, [shipped], false)
  await page.route('**/api/products', route => route.fulfill({ json: [] }))
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Buy bread' }).click()
  await expect(page).toHaveURL('/buy')
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
})

// ---- Paying with Square ----
// Square's checkout page lives on another site; here a page on our own address stands in for it.

async function mockPaying(page: Page, options: { admin?: boolean; order?: Record<string, unknown>; pay?: { status: number; json: unknown } } = {}) {
  const order = { ...shipped, ...options.order }
  const requests: string[] = []
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: options.admin ?? false } }))
  await page.route('**/api/orders/*', route => route.fulfill({ json: order }))
  await page.route('**/api/orders/*/pay', route => {
    requests.push(route.request().method() + ' ' + new URL(route.request().url()).pathname)
    return route.fulfill(options.pay ?? { json: { url: new URL(route.request().url()).origin + '/fake-square-checkout' } })
  })
  await page.route('**/fake-square-checkout', route => route.fulfill({ contentType: 'text/html', body: '<h1>Square checkout</h1>' }))
  return { order, requests }
}

test('Pay asks the server for a checkout page and sends the customer there', async ({ page }) => {
  const { requests } = await mockPaying(page)
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page).toHaveURL('/fake-square-checkout')
  await expect(page.getByRole('heading', { name: 'Square checkout' })).toBeVisible()
  expect(requests).toEqual(['POST /api/orders/AbCdEfGh12345678/pay'])
})

test('Pay works the same for an admin', async ({ page }) => {
  await mockPaying(page, { admin: true })
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page).toHaveURL('/fake-square-checkout')
})

test('Pay cannot be clicked twice while the payment page is being prepared', async ({ page }) => {
  const requests: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
  await page.route('**/api/orders/*', route => route.fulfill({ json: shipped }))
  await page.route('**/api/orders/*/pay', async route => {
    requests.push('pay')
    await gate
    await route.fulfill({ json: { url: new URL(route.request().url()).origin + '/fake-square-checkout' } })
  })
  await page.route('**/fake-square-checkout', route => route.fulfill({ contentType: 'text/html', body: '<h1>Square checkout</h1>' }))
  await page.goto('/order/AbCdEfGh12345678')
  const pay = page.getByRole('button', { name: 'Pay' })
  await pay.click()
  await expect(page.getByRole('button', { name: 'Opening payment…' })).toBeDisabled()
  release()
  await expect(page).toHaveURL('/fake-square-checkout')
  expect(requests).toEqual(['pay'])
})

test('if the payment cannot be started the customer is told, stays on the order, and can try again', async ({ page }) => {
  const { requests } = await mockPaying(page, { pay: { status: 502, json: { error: 'We couldn’t start the payment right now. Please try again, or contact us to pay.' } } })
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t start the payment')
  await expect(page).toHaveURL('/order/AbCdEfGh12345678')
  const again = page.getByRole('button', { name: 'Pay' })
  await expect(again).toBeEnabled()
  await again.click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(requests).toHaveLength(2)
})

test('an answer that is not a web address is never followed', async ({ page }) => {
  await mockPaying(page, { pay: { status: 200, json: { url: 'javascript:alert(1)' } } })
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t start the payment')
  await expect(page).toHaveURL('/order/AbCdEfGh12345678')
})

test('payment that is not set up yet is explained', async ({ page }) => {
  await mockPaying(page, { pay: { status: 503, json: { error: 'Online payment is not available right now. Please contact us to pay.' } } })
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page.getByRole('alert')).toContainText('not available right now')
})

// ---- Coming back from paying ----

const justStartedPaying = (slug = 'AbCdEfGh12345678', ageMs = 0) =>
  ({ key: 'palianytsia-payment-started', value: JSON.stringify({ slug, at: Date.now() - ageMs }) })

// Moves the page's clock forward in 3-second steps. The page chains each new timer after a network answer, so
// every step is given a moment to finish before the next one (a single big jump would fire only one timer).
async function tick(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.clock.runFor(3000)
    await page.waitForTimeout(40)
  }
}

async function comeBackFromPaying(page: Page, flag = justStartedPaying()) {
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), flag)
}

test('after paying, the page waits for the confirmation and then shows the order as paid', async ({ page }) => {
  const order = { ...shipped }
  let lookups = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
  await page.route('**/api/orders/*', route => {
    lookups++
    // The webhook arrives after a few seconds: the third look finds the order paid.
    if (lookups >= 3) Object.assign(order, { status: 'paid', paidAt: '2026-10-05T15:00:00.000Z' })
    return route.fulfill({ json: order })
  })
  await comeBackFromPaying(page)
  await page.clock.install()
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByText('If you have just paid, this page will update in a moment')).toBeVisible()

  await tick(page, 2)
  await expect(page.getByTestId('order-status')).toHaveText('Paid')
  await expect(page.getByText('Payment received. Thank you!')).toBeVisible()
  await expect(page.getByText('If you have just paid')).toHaveCount(0)
  await expect(page.getByText(/^Paid October 5, 2026/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pay' })).toHaveCount(0)

  // It stops looking once it has the answer.
  const before = lookups
  await tick(page, 10)
  expect(lookups).toBe(before)
})

test('if the confirmation never arrives, the page stops waiting and says so', async ({ page }) => {
  let lookups = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
  await page.route('**/api/orders/*', route => { lookups++; return route.fulfill({ json: shipped }) })
  await comeBackFromPaying(page)
  await page.clock.install()
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByText('If you have just paid')).toBeVisible()

  await tick(page, 23)
  await expect(page.getByText('We haven’t received the confirmation of your payment yet')).toBeVisible()
  await expect(page.getByText('If you have just paid')).toHaveCount(0)
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible()
  const stopped = lookups
  await tick(page, 20)
  expect(lookups).toBe(stopped)
  // The first look, then at most one every 3 seconds for a minute.
  expect(stopped).toBeLessThanOrEqual(22)
})

test('the page only waits for a customer who has just been to pay', async ({ page }) => {
  for (const flag of [
    undefined,
    justStartedPaying('ZyXwVuTs87654321'),
    justStartedPaying('AbCdEfGh12345678', 31 * 60 * 1000),
  ]) {
    const context = await page.context().browser()!.newContext()
    const fresh = await context.newPage()
    let lookups = 0
    await fresh.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
    await fresh.route('**/api/orders/*', route => { lookups++; return route.fulfill({ json: shipped }) })
    if (flag) await comeBackFromPaying(fresh, flag)
    await fresh.clock.install()
    await fresh.goto('/order/AbCdEfGh12345678')
    await expect(fresh.getByTestId('order-status')).toHaveText('Unpaid')
    await expect(fresh.getByText('If you have just paid')).toHaveCount(0)
    for (let i = 0; i < 6; i++) { await fresh.clock.runFor(3000); await fresh.waitForTimeout(40) }
    expect(lookups).toBe(1)
    await context.close()
  }
})

test('a paid order never waits, even for a customer who has just been to pay', async ({ page }) => {
  let lookups = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: false } }))
  await page.route('**/api/orders/*', route => { lookups++; return route.fulfill({ json: { ...shipped, status: 'paid' } }) })
  await comeBackFromPaying(page)
  await page.clock.install()
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Paid')
  await expect(page.getByText('If you have just paid')).toHaveCount(0)
  await tick(page, 6)
  expect(lookups).toBe(1)
})

test('starting a payment leaves a note so the page can wait when the customer returns', async ({ page }) => {
  await mockPaying(page)
  await page.goto('/order/AbCdEfGh12345678')
  await page.getByRole('button', { name: 'Pay' }).click()
  await expect(page).toHaveURL('/fake-square-checkout')
  const note = await page.evaluate(() => JSON.parse(sessionStorage.getItem('palianytsia-payment-started') ?? 'null'))
  expect(note.slug).toBe('AbCdEfGh12345678')
  expect(Math.abs(note.at - Date.now())).toBeLessThan(60000)
})

// ---- A payment that did not match ----

const withProblem = { needsAttention: true, paymentProblem: 'Payment did not match the order: the order has Dark Rye (RYE-01) × 4 at $10.00 but Square does not; Square has Dark Rye (RYE-01) × 3 at $10.00 but the order does not.' }

test('an admin is told about a payment that did not match, and what to do', async ({ page }) => {
  await mockPaying(page, { admin: true, order: withProblem })
  await page.goto('/order/AbCdEfGh12345678')
  const notice = page.getByRole('alert').filter({ hasText: 'A payment needs your attention' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Dark Rye (RYE-01) × 3')
  await expect(notice).toContainText('The order was not marked paid')
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('unpaid')
})

test('a visitor never sees a payment problem, even if one were sent to the page', async ({ page }) => {
  await mockPaying(page, { admin: false, order: withProblem })
  await page.goto('/order/AbCdEfGh12345678')
  await expect(page.getByTestId('order-status')).toHaveText('Unpaid')
  await expect(page.getByText('needs your attention')).toHaveCount(0)
  await expect(page.getByText('Square does not')).toHaveCount(0)
})

test('the list of orders flags the ones with a payment problem', async ({ page }) => {
  await mockAdmin(page, [shipped, pickup])
  await page.route('**/api/admin/orders', route => route.fulfill({
    json: [{ ...summary(shipped), needsAttention: true }, { ...summary(pickup), needsAttention: false }],
  }))
  await page.goto('/admin/orders')
  const rows = page.getByRole('row')
  await expect(rows.nth(1)).toContainText('Check payment')
  await expect(rows.nth(2)).not.toContainText('Check payment')
})
