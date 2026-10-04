import { expect, test } from '@playwright/test'

test('contact page shows the address and a phone link', async ({ page }) => {
  await page.goto('/contact')
  await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible()
  const address = page.getByRole('group').or(page.locator('address'))
  await expect(address).toContainText('The Hood Kitchen')
  await expect(address).toContainText('For Palianytsia Bread')
  await expect(address).toContainText('350 Clinton St Ste A')
  await expect(address).toContainText('Costa Mesa, CA 92626')
  await expect(address).toContainText('United States')
  await expect(page.getByRole('link', { name: '(424) 408-0552' })).toHaveAttribute('href', 'tel:+14244080552')
  const directions = page.getByRole('link', { name: 'Get directions' })
  await expect(directions).toHaveAttribute('href', /google\.com\/maps\/search.*350%20Clinton%20St%20Ste%20A/)
  await expect(directions).toHaveAttribute('target', '_blank')
  await expect(directions).toHaveAttribute('rel', /noopener/)
})

test('every public page links to the contact page from its footer', async ({ page }) => {
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/products', route => route.fulfill({ json: [] }))
  await page.route('**/api/products/rye', route => route.fulfill({
    json: { id: 1, slug: 'rye', sku: 'R', title: 'Rye', description: '', enabled: true, priceCents: 500, shippingAvailable: false, mainPhotoId: null, photos: [] },
  }))
  for (const path of ['/', '/buy', '/buy/rye', '/contact']) {
    await page.goto(path)
    await expect(page.locator('footer').getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact')
  }
  await page.goto('/')
  await page.locator('footer').getByRole('link', { name: 'Contact' }).click()
  await expect(page).toHaveURL('/contact')
  await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible()
})

test('the header links to the contact page from every public page', async ({ page }) => {
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/products', route => route.fulfill({ json: [] }))
  await page.route('**/api/products/rye', route => route.fulfill({
    json: { id: 1, slug: 'rye', sku: 'R', title: 'Rye', description: '', enabled: true, priceCents: 500, shippingAvailable: false, mainPhotoId: null, photos: [] },
  }))
  for (const path of ['/', '/buy', '/buy/rye']) {
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact')
  }
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Contact' }).click()
  await expect(page).toHaveURL('/contact')
  // On the contact page itself the header offers the other pages instead.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Our story' })).toHaveAttribute('href', '/')
  await expect(nav.getByRole('link', { name: 'Buy bread' })).toHaveAttribute('href', '/buy')
})

test('the contact form sends the message and then clears itself', async ({ page }) => {
  let sent: Record<string, string> | null = null
  await page.route('**/api/contact', route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/contact')
  await page.getByLabel('Name', { exact: true }).fill('Olena')
  await page.getByLabel('Email', { exact: true }).fill('olena@example.com')
  await page.getByLabel('Message', { exact: true }).fill('Do you bake on Sundays?')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(page.getByRole('status')).toContainText('Your message has been sent')
  expect(sent).toEqual({ name: 'Olena', email: 'olena@example.com', message: 'Do you bake on Sundays?', website: '' })
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('')
})

test('a failed send shows the error and keeps what was typed', async ({ page }) => {
  await page.route('**/api/contact', route => route.fulfill({ status: 502, json: { error: 'We couldn’t send your message right now. Please try again later or call us.' } }))
  await page.goto('/contact')
  await page.getByLabel('Name', { exact: true }).fill('Olena')
  await page.getByLabel('Email', { exact: true }).fill('olena@example.com')
  await page.getByLabel('Message', { exact: true }).fill('Hello there')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(page.getByRole('alert')).toContainText('couldn’t send your message')
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Hello there')
  await expect(page.getByText('Your message has been sent')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
})

test('the form needs a name, a valid email, and a message before anything is sent', async ({ page }) => {
  let requests = 0
  await page.route('**/api/contact', route => { requests++; return route.fulfill({ json: { ok: true } }) })
  await page.goto('/contact')
  const send = page.getByRole('button', { name: 'Send message' })
  await send.click()
  await page.getByLabel('Name', { exact: true }).fill('Olena')
  await send.click()
  await page.getByLabel('Email', { exact: true }).fill('not-an-email')
  await page.getByLabel('Message', { exact: true }).fill('Hi')
  await send.click()
  expect(requests).toBe(0)
})

test('the hidden anti-spam field is not reachable for visitors', async ({ page }) => {
  await page.goto('/contact')
  const trap = page.locator('#contact-website')
  await expect(trap).toHaveAttribute('tabindex', '-1')
  await expect(page.locator('.contact-trap')).toHaveAttribute('aria-hidden', 'true')
  const box = await trap.boundingBox()
  expect(box === null || box.x < -1000).toBe(true)
})
