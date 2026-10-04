import { expect, test, type Page } from '@playwright/test'

interface Photo { id: number; url: string; width: number; height: number }
interface Product { id: number; slug: string; sku: string; title: string; description: string; enabled: boolean; priceCents: number | null; mainPhotoId: number | null; photos: Photo[] }

// 1x1 PNG, served for every photo URL.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function mockApi(page: Page, products: Product[]) {
  let nextId = 100
  const find = (url: string) => products.find(p => p.id === Number(url.match(/products\/(\d+)/)?.[1]))!
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/product-photos/*', route => route.fulfill({ body: png, contentType: 'image/webp' }))
  await page.route('**/api/admin/products**', async route => {
    const request = route.request()
    const url = request.url()
    const method = request.method()
    if (url.endsWith('/products') && method === 'GET') return route.fulfill({ json: products })
    if (url.endsWith('/products') && method === 'POST') {
      const input = request.postDataJSON()
      const product = { id: nextId++, slug: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...input, mainPhotoId: null, photos: [] }
      products.push(product)
      return route.fulfill({ status: 201, json: product })
    }
    if (url.endsWith('/products/order') && method === 'PUT') {
      const ids: number[] = request.postDataJSON().ids
      products.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      return route.fulfill({ json: products })
    }
    const product = find(url)
    if (url.endsWith('/photos') && method === 'POST') {
      const id = nextId++
      product.photos.push({ id, url: `/api/product-photos/${id}`, width: 800, height: 400 })
      product.mainPhotoId ??= id
    } else if (url.endsWith('/main-photo')) {
      product.mainPhotoId = request.postDataJSON().photoId
    } else if (method === 'DELETE') {
      const id = Number(url.split('/').pop())
      product.photos = product.photos.filter(photo => photo.id !== id)
      if (product.mainPhotoId === id) product.mainPhotoId = product.photos[0]?.id ?? null
    } else if (method === 'PUT') {
      Object.assign(product, request.postDataJSON())
    }
    return route.fulfill({ json: product })
  })
}

const photo = { name: 'loaf.png', mimeType: 'image/png', buffer: png }

test('admin creates a product, uploads photos, changes the main photo, and removes one', async ({ page }) => {
  await mockApi(page, [])
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await expect(page.getByText('No products yet')).toBeVisible()

  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('Create the product first, then add photos.')).toBeVisible()
  await page.locator('#products-panel').getByLabel('SKU').fill('RYE-01')
  await page.locator('#products-panel').getByLabel('Title').fill('Rye loaf')
  await page.locator('#products-panel').getByLabel('Description').fill('Dark rye.')
  await page.locator('#products-panel').locator('#product-price').fill('12.50')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Product saved.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Edit product' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Products' }).getByText('Rye loaf')).toBeVisible()
  await expect(page.getByRole('link', { name: '/buy/rye-loaf' })).toHaveAttribute('href', '/buy/rye-loaf')

  await page.locator('#products-panel').getByLabel('Add photos').setInputFiles([photo, photo])
  const photos = page.getByRole('list', { name: 'Product photos' }).getByRole('listitem')
  await expect(photos).toHaveCount(2)
  await expect(photos.nth(0).getByText('Main photo')).toBeVisible()
  await photos.nth(1).getByRole('button', { name: 'Make main' }).click()
  await expect(photos.nth(1).getByText('Main photo')).toBeVisible()
  await expect(photos.nth(0).getByText('Main photo')).toHaveCount(0)

  page.once('dialog', dialog => dialog.accept())
  await photos.nth(1).getByRole('button', { name: 'Remove photo 2' }).click()
  await expect(photos).toHaveCount(1)
  await expect(photos.nth(0).getByText('Main photo')).toBeVisible()
})

test('admin edits a product and disables and enables it from the list', async ({ page }) => {
  const products = [{ id: 1, slug: 'sourdough', sku: 'SOUR-1', title: 'Sourdough', description: 'Tangy.', enabled: true, priceCents: 800, mainPhotoId: null, photos: [] }]
  await mockApi(page, products)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()

  await page.getByRole('button', { name: 'Edit Sourdough' }).click()
  await page.locator('#products-panel').getByLabel('Title').fill('Country sourdough')
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByRole('list', { name: 'Products' }).getByText('Country sourdough')).toBeVisible()
  expect(products[0]!.title).toBe('Country sourdough')

  await page.getByRole('button', { name: 'Disable Country sourdough' }).click()
  await expect(page.getByRole('button', { name: 'Enable Country sourdough' })).toBeVisible()
  expect(products[0]!.enabled).toBe(false)
  await expect(page.locator('#products-panel').getByLabel('Enabled — show on the buy page')).not.toBeChecked()
  await page.getByRole('button', { name: 'Enable Country sourdough' }).click()
  await expect(page.getByRole('button', { name: 'Disable Country sourdough' })).toBeVisible()
  expect(products[0]!.enabled).toBe(true)
})

test('product errors are shown and keep the draft', async ({ page }) => {
  await mockApi(page, [])
  await page.route('**/api/admin/products', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, json: { error: 'Another product already uses this SKU.' } })
    : route.fulfill({ json: [] }))
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await page.getByRole('button', { name: 'Add product' }).click()
  await page.locator('#products-panel').getByLabel('SKU').fill('DUP')
  await page.locator('#products-panel').getByLabel('Title').fill('Duplicate')
  await page.locator('#products-panel').locator('#product-price').fill('3')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page.getByRole('alert')).toHaveText('Another product already uses this SKU.')
  await expect(page.locator('#products-panel').getByLabel('Title')).toHaveValue('Duplicate')
})

const rye = {
  id: 1, slug: 'rye-loaf', sku: 'RYE-01', title: 'Rye loaf', description: 'Dark rye.', enabled: true, priceCents: 1250, mainPhotoId: 12,
  photos: [11, 12].map(id => ({ id, url: `/api/product-photos/${id}`, width: 800, height: 400 })),
}

test('buy page lists products with their main photo and links to each product page', async ({ page }) => {
  await page.route('**/api/product-photos/*', route => route.fulfill({ body: png, contentType: 'image/webp' }))
  await page.route('**/api/products', route => route.fulfill({ json: [rye] }))
  await page.goto('/buy')
  await expect(page.getByRole('heading', { name: 'Rye loaf' })).toBeVisible()
  await expect(page.getByText('SKU RYE-01')).toBeVisible()
  await expect(page.locator('.buy-card .buy-price')).toHaveText('$12.50')
  await expect(page.locator('.buy-photo')).toHaveAttribute('src', '/api/product-photos/12')
  await expect(page.getByRole('link', { name: 'Rye loaf' })).toHaveAttribute('href', '/buy/rye-loaf')
  await page.getByRole('link', { name: 'Rye loaf' }).click()
  await expect(page).toHaveURL('/buy/rye-loaf')
})

test('product page shows the product, its photos, and a way back', async ({ page }) => {
  await page.route('**/api/product-photos/*', route => route.fulfill({ body: png, contentType: 'image/webp' }))
  await page.route('**/api/products/rye-loaf', route => route.fulfill({ json: rye }))
  await page.goto('/buy/rye-loaf')
  await expect(page.getByRole('heading', { level: 1, name: 'Rye loaf' })).toBeVisible()
  await expect(page.getByText('Dark rye.')).toBeVisible()
  await expect(page.locator('.product-info .buy-price')).toHaveText('$12.50')
  await expect(page.getByText('SKU RYE-01')).toBeVisible()
  const image = page.getByRole('img', { name: 'Rye loaf', exact: true })
  await expect(image).toHaveAttribute('src', '/api/product-photos/12')
  await page.getByRole('button', { name: 'Show photo 1' }).click()
  await expect(image).toHaveAttribute('src', '/api/product-photos/11')
  await page.getByRole('link', { name: '← All bread' }).click()
  await expect(page).toHaveURL('/buy')
})

test('product page explains when the product does not exist or is disabled', async ({ page }) => {
  await page.route('**/api/products/missing', route => route.fulfill({ status: 404, json: { error: 'Not found' } }))
  await page.goto('/buy/missing')
  await expect(page.getByRole('alert')).toContainText('couldn’t find that bread')
  await page.getByRole('link', { name: 'See all bread' }).click()
  await expect(page).toHaveURL('/buy')
})

test('product page offers a retry when the product cannot load', async ({ page }) => {
  let available = false
  await page.route('**/api/products/rye-loaf', route => route.fulfill(available
    ? { json: { ...rye, photos: [] } }
    : { status: 503, json: { error: 'Unavailable' } }))
  await page.goto('/buy/rye-loaf')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  available = true
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Rye loaf' })).toBeVisible()
})

test('buy page explains when no products are available', async ({ page }) => {
  await page.route('**/api/products', route => route.fulfill({ json: [] }))
  await page.goto('/buy')
  await expect(page.getByText('No bread is available right now')).toBeVisible()
})

const sample = (id: number, title: string): Product => ({ id, slug: title.toLowerCase(), sku: `SKU-${id}`, title, description: '', enabled: true, priceCents: 500, mainPhotoId: null, photos: [] })
const titles = (page: Page) => page.locator('.product-row .product-summary strong').allTextContents()

test('admin reorders products with the up and down buttons', async ({ page }) => {
  const products = [sample(1, 'Apple'), sample(2, 'Bagel'), sample(3, 'Cake')]
  await mockApi(page, products)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await expect.poll(() => titles(page)).toEqual(['Apple', 'Bagel', 'Cake'])
  await expect(page.getByRole('button', { name: 'Move Apple up' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move Cake down' })).toBeDisabled()

  await page.getByRole('button', { name: 'Move Cake up' }).click()
  await expect.poll(() => titles(page)).toEqual(['Apple', 'Cake', 'Bagel'])
  await page.getByRole('button', { name: 'Move Apple down' }).click()
  await expect.poll(() => titles(page)).toEqual(['Cake', 'Apple', 'Bagel'])
  expect(products.map(p => p.title)).toEqual(['Cake', 'Apple', 'Bagel'])
})

test('admin reorders products by dragging and dropping', async ({ page }) => {
  const products = [sample(1, 'Apple'), sample(2, 'Bagel'), sample(3, 'Cake')]
  await mockApi(page, products)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  const rows = page.locator('.product-row')
  await expect(rows).toHaveCount(3)

  await rows.nth(2).dragTo(rows.nth(0))
  await expect.poll(() => titles(page)).toEqual(['Cake', 'Apple', 'Bagel'])
  await rows.nth(0).dragTo(rows.nth(2))
  await expect.poll(() => titles(page)).toEqual(['Apple', 'Bagel', 'Cake'])
  expect(products.map(p => p.title)).toEqual(['Apple', 'Bagel', 'Cake'])
})

test('a failed reorder restores the previous order and shows the error', async ({ page }) => {
  await mockApi(page, [sample(1, 'Apple'), sample(2, 'Bagel')])
  await page.route('**/api/admin/products/order', route => route.fulfill({ status: 409, json: { error: 'The product list has changed. Reload the page and try again.' } }))
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await page.getByRole('button', { name: 'Move Bagel up' }).click()
  await expect(page.getByRole('alert')).toHaveText('The product list has changed. Reload the page and try again.')
  expect(await titles(page)).toEqual(['Apple', 'Bagel'])
})

test('a new product needs a unique SKU and nothing is sent otherwise', async ({ page }) => {
  const products = [sample(1, 'Sourdough')]
  await mockApi(page, products)
  let created = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/admin/products')) created++ })
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  const panel = page.locator('#products-panel')
  await panel.getByRole('button', { name: 'Add product' }).click()
  await panel.getByLabel('Title').fill('Another loaf')
  await panel.locator('#product-price').fill('4.25')

  // Creating is not possible until the SKU has at least one letter or number.
  const create = panel.getByRole('button', { name: 'Create product' })
  for (const blank of ['', '   ', '---', '._']) {
    await panel.getByLabel('SKU').fill(blank)
    await expect(create).toBeDisabled()
  }
  await panel.getByLabel('SKU').fill('-a')
  await expect(create).toBeEnabled()

  await panel.getByLabel('SKU').fill('sku-1')
  await panel.getByRole('button', { name: 'Create product' }).click()
  await expect(page.getByRole('alert')).toHaveText('Another product already uses this SKU.')
  expect(created).toBe(0)

  await panel.getByLabel('SKU').fill('SKU-2')
  await panel.getByRole('button', { name: 'Create product' }).click()
  await expect(panel.getByRole('status').filter({ hasText: 'Product saved.' })).toBeVisible()
  expect(created).toBe(1)
})

test('the price is required, shown in cents-accurate form, and saved as whole cents', async ({ page }) => {
  const products: Product[] = []
  await mockApi(page, products)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  const panel = page.locator('#products-panel')
  await panel.getByRole('button', { name: 'Add product' }).click()
  await panel.getByLabel('SKU').fill('PRICE-1')
  await panel.getByLabel('Title').fill('Priced loaf')

  const create = panel.getByRole('button', { name: 'Create product' })
  for (const bad of ['', '0', '0.00', '-3', 'abc', '1.234', '1,50', '$5']) {
    await panel.locator('#product-price').fill(bad)
    await expect(create).toBeDisabled()
  }
  await panel.locator('#product-price').fill('19.9')
  await expect(create).toBeEnabled()
  await create.click()
  await expect(panel.getByRole('status').filter({ hasText: 'Product saved.' })).toBeVisible()
  expect(products[0]!.priceCents).toBe(1990)
  await expect(panel.locator('#product-price')).toHaveValue('19.90')
  await expect(page.getByRole('list', { name: 'Products' })).toContainText('$19.90')

  await panel.locator('#product-price').fill('21')
  await panel.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByRole('list', { name: 'Products' })).toContainText('$21.00')
  expect(products[0]!.priceCents).toBe(2100)
})

test('products without a price can still be enabled or disabled, but need a price to be saved', async ({ page }) => {
  const products = [{ ...sample(1, 'Legacy'), priceCents: null }]
  await mockApi(page, products)
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await expect(page.getByRole('list', { name: 'Products' })).toContainText('No price')

  await page.getByRole('button', { name: 'Disable Legacy' }).click()
  await expect(page.getByRole('button', { name: 'Enable Legacy' })).toBeVisible()
  expect(products[0]!.enabled).toBe(false)
  expect(products[0]!.priceCents).toBeNull()

  const panel = page.locator('#products-panel')
  await page.getByRole('button', { name: 'Edit Legacy' }).click()
  await panel.getByLabel('Title').fill('Legacy loaf')
  await expect(panel.getByRole('button', { name: 'Save product' })).toBeDisabled()
  await panel.locator('#product-price').fill('7')
  await panel.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByRole('list', { name: 'Products' })).toContainText('$7.00')
  expect(products[0]!.priceCents).toBe(700)
})

test('buy page leaves out the price for a product that has none', async ({ page }) => {
  await page.route('**/api/products', route => route.fulfill({ json: [{ ...rye, priceCents: null, photos: [] }] }))
  await page.goto('/buy')
  await expect(page.getByRole('heading', { name: 'Rye loaf' })).toBeVisible()
  await expect(page.locator('.buy-price')).toHaveCount(0)
})
