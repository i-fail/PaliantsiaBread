import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
})

test('admin saves HTML, the homepage renders it, and the products tab preserves the draft', async ({ page }) => {
  let content = { title: 'Original <span>title</span>', subtitle: 'Original subtitle', story: '<p>Original story</p>' }
  await page.route('**/api/admin/products', route => route.fulfill({ json: [] }))
  await page.route('**/api/front-page', async route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().headers().authorization).toBeUndefined()
      content = route.request().postDataJSON()
    }
    await route.fulfill({ json: content })
  })

  await page.goto('/admin')
  await expect(page.getByLabel('Title HTML', { exact: true })).toHaveValue(content.title)
  await page.getByLabel('Title HTML', { exact: true }).fill('Fresh <span>bread</span>')
  await page.getByRole('tab', { name: 'Products page' }).click()
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible()
  await page.getByRole('tab', { name: 'Front page' }).click()
  await expect(page.getByLabel('Title HTML', { exact: true })).toHaveValue('Fresh <span>bread</span>')
  await page.getByLabel('Subtitle HTML').fill('Baked <em>today</em>')
  await page.getByLabel('Story HTML').fill('<p>A new <strong>story</strong>.</p>')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved. The front page is updated.')
  await page.getByRole('link', { name: 'View website' }).click()
  await expect(page.locator('h1 span')).toHaveText('bread')
  await expect(page.locator('.subtitle em')).toHaveText('today')
  await expect(page.locator('.story strong')).toHaveText('story')
  await page.reload()
  await expect(page.locator('.story strong')).toHaveText('story')
})

test('failed saves keep the draft and do not show success', async ({ page }) => {
  await page.route('**/api/front-page', route => route.fulfill(route.request().method() === 'PUT'
    ? { status: 503, json: { error: 'Content is temporarily unavailable.' } }
    : { json: { title: 'Title', subtitle: 'Subtitle', story: '<p>Story</p>' } }))
  await page.goto('/admin')
  await page.getByLabel('Story HTML').fill('<p>Unsaved draft</p>')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toHaveText('Content is temporarily unavailable.')
  await expect(page.getByLabel('Story HTML')).toHaveValue('<p>Unsaved draft</p>')
  await expect(page.getByText('Changes saved. The front page is updated.')).toHaveCount(0)
})

test('admin requires login before loading the editor and signs out', async ({ page }) => {
  let authenticated = false
  let contentRequests = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated } }))
  await page.route('**/api/admin/login', route => {
    authenticated = route.request().postDataJSON().password === 'test-password'
    return route.fulfill(authenticated
      ? { json: { authenticated: true } }
      : { status: 401, json: { error: 'The admin password is incorrect.' } })
  })
  await page.route('**/api/admin/logout', route => {
    authenticated = false
    return route.fulfill({ json: { authenticated: false } })
  })
  await page.route('**/api/front-page', route => {
    contentRequests++
    return route.fulfill({ json: { title: 'Title', subtitle: 'Subtitle', story: '<p>Story</p>' } })
  })
  await page.goto('/admin')
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  expect(contentRequests).toBe(0)
  await page.getByLabel('Admin password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The admin password is incorrect.')
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.getByLabel('Admin password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Front page' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Front page' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Admin password')).toBeVisible()
})

test('expired sessions require login again and preserve unsaved edits', async ({ page }) => {
  await page.route('**/api/front-page', route => route.fulfill(route.request().method() === 'PUT'
    ? { status: 401, json: { error: 'Please sign in.' } }
    : { json: { title: 'Title', subtitle: 'Subtitle', story: '<p>Story</p>' } }))
  await page.route('**/api/admin/login', route => route.fulfill({ json: { authenticated: true } }))
  await page.goto('/admin')
  await page.getByLabel('Story HTML').fill('<p>Keep my draft</p>')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('Your session expired')
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.getByLabel('Admin password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByLabel('Story HTML')).toHaveValue('<p>Keep my draft</p>')
})

test('homepage shows a retry action when content cannot load', async ({ page }) => {
  let available = false
  await page.route('**/api/front-page', route => route.fulfill(available
    ? { json: { title: 'Recovered title', subtitle: 'Subtitle', story: '<p>Story</p>' } }
    : { status: 503, json: { error: 'Unavailable' } }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  available = true
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recovered title')
})
