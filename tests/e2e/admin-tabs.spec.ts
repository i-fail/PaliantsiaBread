import { expect, test, type Page } from '@playwright/test'

async function mockAdmin(page: Page, authenticated = true) {
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'Title', subtitle: 'Sub', story: '<p>Story</p>' } }))
  await page.route('**/api/admin/products', route => route.fulfill({ json: [] }))
}

test('/admin redirects to the front page tab', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin')
  await expect(page).toHaveURL('/admin/front')
  await expect(page.getByRole('tab', { name: 'Front page' })).toHaveAttribute('aria-selected', 'true')
})

test('unknown admin addresses fall back to the front page tab', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/nonsense/more')
  await expect(page).toHaveURL('/admin/front')
})

test('products tab can be opened directly by its address', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/products')
  await expect(page.getByRole('tab', { name: 'Products page' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible()
})

test('switching tabs changes the address, works with back and forward, and keeps the draft', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/front')
  await page.getByLabel('Story HTML').fill('<p>Unsaved draft</p>')

  await page.getByRole('tab', { name: 'Products page' }).click()
  await expect(page).toHaveURL('/admin/products')
  await expect(page.getByRole('tab', { name: 'Products page' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL('/admin/front')
  await expect(page.getByRole('tab', { name: 'Front page' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Story HTML')).toHaveValue('<p>Unsaved draft</p>')

  await page.goForward()
  await expect(page).toHaveURL('/admin/products')
  await expect(page.getByRole('tab', { name: 'Products page' })).toHaveAttribute('aria-selected', 'true')
})

test('arrow keys move between tabs and update the address', async ({ page }) => {
  await mockAdmin(page)
  await page.goto('/admin/front')
  await page.getByRole('tab', { name: 'Front page' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL('/admin/products')
  await expect(page.getByRole('tab', { name: 'Products page' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page).toHaveURL('/admin/front')
  await expect(page.getByRole('tab', { name: 'Front page' })).toBeFocused()
})

test('signing in on a tab address returns to that tab', async ({ page }) => {
  let authenticated = false
  await mockAdmin(page)
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated } }))
  await page.route('**/api/admin/login', route => {
    authenticated = true
    return route.fulfill({ json: { authenticated: true } })
  })
  await page.goto('/admin/products')
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page).toHaveURL('/admin/products')

  await page.getByLabel('Admin password').fill('secret')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Products page' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible()
})
