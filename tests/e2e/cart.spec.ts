import { expect, test, type Page } from '@playwright/test'

const product = (id: number, title: string, priceCents: number | null = 500) => ({
  id, slug: title.toLowerCase(), sku: `SKU-${id}`, title, description: '', enabled: true, priceCents,
  shippingAvailable: false, mainPhotoId: null, photos: [],
})
const rye = product(1, 'Rye')
const bagel = product(2, 'Bagel')
const unpriced = product(3, 'Unpriced', null)

async function mockShop(page: Page) {
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/products', route => route.fulfill({ json: [rye, bagel, unpriced] }))
  await page.route('**/api/products/rye', route => route.fulfill({ json: rye }))
}

const cart = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Cart:/ })

test('the cart appears in the header once something is added, and counts every addition', async ({ page }) => {
  await mockShop(page)
  await page.goto('/buy')
  await expect(page.getByRole('heading', { name: 'Rye' })).toBeVisible()
  await expect(cart(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Add Rye to cart' }).click()
  await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')
  await expect(page.getByRole('button', { name: 'Add Rye to cart' })).toHaveText('Added ✓')

  await page.getByRole('button', { name: 'Add Rye to cart' }).click()
  await page.getByRole('button', { name: 'Add Bagel to cart' }).click()
  await expect(cart(page)).toHaveAccessibleName('Cart: 3 items')
  await expect(cart(page).locator('.cart-count')).toHaveText('3')
  // The icon is public/cart.svg (Vite may inline a file this small), and it must actually render.
  await expect(cart(page).locator('img')).toHaveJSProperty('complete', true)
  expect(await cart(page).locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
})

test('the cart is remembered across reloads and shown on other pages', async ({ page }) => {
  await mockShop(page)
  await page.goto('/buy')
  await page.getByRole('button', { name: 'Add Bagel to cart' }).click()
  await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')

  await page.reload()
  await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')
  for (const path of ['/', '/contact', '/buy/rye']) {
    await page.goto(path)
    await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')
  }
})

test('products can be added from their own page', async ({ page }) => {
  await mockShop(page)
  await page.goto('/buy/rye')
  await page.getByRole('button', { name: 'Add Rye to cart' }).click()
  await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')
})

test('products without a price cannot be added to the cart', async ({ page }) => {
  await mockShop(page)
  await page.goto('/buy')
  await expect(page.getByRole('heading', { name: 'Unpriced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Unpriced to cart' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add Rye to cart' })).toBeVisible()
})

test('unreadable saved cart data is ignored', async ({ page }) => {
  await mockShop(page)
  await page.addInitScript(() => localStorage.setItem('palianytsia-cart', '{not json'))
  await page.goto('/buy')
  await expect(page.getByRole('heading', { name: 'Rye' })).toBeVisible()
  await expect(cart(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Add Rye to cart' }).click()
  await expect(cart(page)).toHaveAccessibleName('Cart: 1 item')
})
