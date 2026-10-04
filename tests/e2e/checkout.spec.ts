import { expect, test, type Page } from '@playwright/test'

const product = (id: number, title: string, priceCents: number | null, shippingAvailable: boolean) => ({
  id, slug: title.toLowerCase().replace(/ /g, '-'), sku: `SKU-${id}`, title, description: '', enabled: true,
  priceCents, shippingAvailable, mainPhotoId: null, photos: [],
})
const rye = product(1, 'Rye', 1000, true)
const bagel = product(2, 'Bagel', 400, true)
const cake = product(3, 'Cake', 3000, false)

async function setUp(page: Page, cartItems: { productId: number; quantity: number }[], products = [rye, bagel, cake]) {
  await page.addInitScript(items => {
    // Only seed once, so changes made on the page survive a reload.
    if (!localStorage.getItem('palianytsia-cart')) localStorage.setItem('palianytsia-cart', JSON.stringify(items))
  }, cartItems)
  await page.route('**/api/products', route => route.fulfill({ json: products }))
}

const summary = (page: Page) => page.getByRole('region', { name: 'Order summary' })
const row = (page: Page, label: string) => summary(page).locator('div', { has: page.getByText(label, { exact: false }) }).last()

test('shows each item, its line total, and the order summary with shipping', async ({ page }) => {
  // 2 Rye + 1 Bagel are shipped (3 products = 1 box), the Cake is not.
  await setUp(page, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }, { productId: 3, quantity: 1 }])
  await page.goto('/checkout')
  const items = page.getByRole('list', { name: 'Items in your cart' }).getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Rye')
  await expect(items.nth(0)).toContainText('$10.00 each')
  await expect(items.nth(0)).toContainText('$20.00')
  await expect(items.nth(0)).toContainText('Shipping available')
  await expect(items.nth(2)).toContainText('Shipping not available')

  await expect(summary(page)).toContainText('Items$54.00')
  await expect(summary(page)).toContainText('1 box for 3 shipped items$20.00')
  await expect(summary(page)).toContainText('Total$74.00')
})

test('changing a quantity updates the totals and adds a box after three shipped products', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 3 }, { productId: 3, quantity: 1 }])
  await page.goto('/checkout')
  await expect(summary(page)).toContainText('1 box for 3 shipped items$20.00')
  await expect(summary(page)).toContainText('Total$80.00')

  await page.getByLabel('Quantity of Rye').fill('4')
  await page.getByLabel('Quantity of Rye').blur()
  await expect(summary(page)).toContainText('2 boxes for 4 shipped items$40.00')
  await expect(summary(page)).toContainText('Items$70.00')
  await expect(summary(page)).toContainText('Total$110.00')

  // Products without shipping never add boxes.
  await page.getByLabel('Quantity of Cake').fill('9')
  await page.getByLabel('Quantity of Cake').blur()
  await expect(summary(page)).toContainText('2 boxes for 4 shipped items$40.00')
  await expect(summary(page)).toContainText('Total$350.00')
  await expect(page.getByRole('link', { name: /^Cart:/ })).toHaveAccessibleName('Cart: 13 items')
})

test('invalid quantities are corrected to a valid number', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 2 }])
  await page.goto('/checkout')
  const quantity = page.getByLabel('Quantity of Rye')
  await quantity.fill('0')
  await quantity.blur()
  await expect(quantity).toHaveValue('1')
  await expect(summary(page)).toContainText('Items$10.00')
  await quantity.fill('500')
  await quantity.blur()
  await expect(quantity).toHaveValue('99')
  await quantity.fill('')
  await quantity.blur()
  await expect(quantity).toHaveValue('1')
})

test('removing items updates the totals and finally shows an empty cart', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 1 }])
  await page.goto('/checkout')
  await expect(summary(page)).toContainText('Total$60.00')

  await page.getByRole('button', { name: 'Remove Rye' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(summary(page)).toContainText('Shipping' + 'None')
  await expect(summary(page)).toContainText('Total$30.00')

  await page.getByRole('button', { name: 'Remove Cake' }).click()
  await expect(page.getByText('Your cart is empty.')).toBeVisible()
  await expect(summary(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Cart:/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Browse our bread' }).click()
  await expect(page).toHaveURL('/buy')
})

test('changes are remembered after a reload', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 1 }])
  await page.goto('/checkout')
  await page.getByLabel('Quantity of Rye').fill('3')
  await page.getByLabel('Quantity of Rye').blur()
  await page.getByRole('button', { name: 'Remove Bagel' }).click()
  await expect(summary(page)).toContainText('Total$50.00')
  await page.reload()
  await expect(page.getByLabel('Quantity of Rye')).toHaveValue('3')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(summary(page)).toContainText('Total$50.00')
})

test('the header cart icon opens the checkout page', async ({ page }) => {
  await setUp(page, [{ productId: 1, quantity: 2 }])
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  for (const start of ['/', '/buy', '/contact']) {
    await page.goto(start)
    const cartLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Cart:/ })
    await expect(cartLink).toHaveAttribute('href', '/checkout')
    await cartLink.click()
    await expect(page).toHaveURL('/checkout')
    await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible()
  }
})

test('items that are no longer available are flagged, removable, and left out of the total', async ({ page }) => {
  const unpriced = product(4, 'Unpriced', null, true)
  await setUp(page, [{ productId: 1, quantity: 1 }, { productId: 99, quantity: 2 }, { productId: 4, quantity: 1 }], [rye, unpriced])
  await page.goto('/checkout')
  await expect(page.getByText('no longer available')).toHaveCount(2)
  await expect(summary(page)).toContainText('Items$10.00')
  await expect(summary(page)).toContainText('1 box for 1 shipped item$20.00')
  await expect(summary(page)).toContainText('Total$30.00')

  await page.getByRole('button', { name: 'Remove unavailable item' }).first().click()
  await page.getByRole('button', { name: 'Remove unavailable item' }).first().click()
  await expect(page.getByText('no longer available')).toHaveCount(0)
  await expect(summary(page)).toContainText('Total$30.00')
})

test('prices can be reloaded when they fail to load', async ({ page }) => {
  let available = false
  await page.addInitScript(() => localStorage.setItem('palianytsia-cart', JSON.stringify([{ productId: 1, quantity: 1 }])))
  await page.route('**/api/products', route => route.fulfill(available ? { json: [rye] } : { status: 503, json: { error: 'x' } }))
  await page.goto('/checkout')
  await expect(page.getByRole('alert')).toContainText('couldn’t load the latest prices')
  available = true
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(summary(page)).toContainText('Total$30.00')
})
