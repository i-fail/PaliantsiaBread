import { expect, test, type Page } from '@playwright/test'

const healthy = {
  checkedAt: '2026-10-05T12:00:00.000Z',
  disk: { usedPercent: 26.4, remainingGb: 36.4 },
  cpu: { usedPercent: 12.3 },
  ram: { usedPercent: 61.8, remainingGb: 0.7 },
  ssl: { validTo: '2026-12-20T10:00:00.000Z', daysRemaining: 45.6, expiringSoon: false, checked: 'palianytsiabread.com' },
  problems: {},
}

async function mockHealth(page: Page, health: unknown = healthy, admin = true) {
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: admin } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  const requests: string[] = []
  await page.route('**/api/admin/server-health', route => {
    requests.push(route.request().method())
    return typeof health === 'function'
      ? route.fulfill(health(requests.length))
      : route.fulfill({ json: health })
  })
  return requests
}

const card = (page: Page, metric: string) => page.locator(`[data-metric="${metric}"]`)

test('the Server Health tab has its own address and shows disk, CPU, memory and the certificate', async ({ page }) => {
  await mockHealth(page)
  await page.goto('/admin/server-health')
  await expect(page.getByRole('tab', { name: 'Server Health' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Server Health' })).toBeVisible()
  await expect(page.getByText('Live resource usage for the current server.')).toBeVisible()

  await expect(card(page, 'disk')).toContainText('Disk used')
  await expect(card(page, 'disk')).toContainText('26.4%')
  await expect(card(page, 'disk')).toContainText('36.4 GB remaining')
  await expect(card(page, 'cpu')).toContainText('Average CPU usage')
  await expect(card(page, 'cpu')).toContainText('12.3%')
  await expect(card(page, 'cpu')).toContainText('Sampled across all CPU cores')
  await expect(card(page, 'ram')).toContainText('RAM used')
  await expect(card(page, 'ram')).toContainText('61.8%')
  await expect(card(page, 'ram')).toContainText('0.7 GB free')
  await expect(card(page, 'ssl')).toContainText('SSL certificate')
  await expect(card(page, 'ssl')).toContainText('45 days')
  await expect(card(page, 'ssl')).toContainText('Expires Dec 20, 2026')
  await expect(card(page, 'ssl')).toContainText('Checked: palianytsiabread.com')
  await expect(page.getByText(/^Last checked Oct 5, 2026/)).toBeVisible()
})

test('each chart is described for screen readers and filled to its percentage', async ({ page }) => {
  await mockHealth(page)
  await page.goto('/admin/server-health')
  await expect(page.getByRole('img', { name: 'Disk used 26.4%' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Average CPU usage 12.3%' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'RAM used 61.8%' })).toBeVisible()
  // The ring is drawn as a dash of 26.4% of the circle's length.
  const dash = await card(page, 'disk').locator('.health-fill').getAttribute('stroke-dasharray')
  const [used, whole] = dash!.split(' ').map(Number)
  expect(used! / whole!).toBeCloseTo(0.264, 3)
})

test('a very full resource turns its chart red', async ({ page }) => {
  await mockHealth(page, { ...healthy, disk: { usedPercent: 93.2, remainingGb: 1.2 }, ram: { usedPercent: 89.9, remainingGb: 0.2 } })
  await page.goto('/admin/server-health')
  await expect(card(page, 'disk').locator('.health-fill')).toHaveAttribute('stroke', '#9a2b1d')
  await expect(card(page, 'ram').locator('.health-fill')).not.toHaveAttribute('stroke', '#9a2b1d')
  await expect(card(page, 'cpu').locator('.health-fill')).not.toHaveAttribute('stroke', '#9a2b1d')
})

test('a certificate close to expiry is highlighted, an expired one says so', async ({ page }) => {
  await mockHealth(page, { ...healthy, ssl: { validTo: '2026-10-09T10:00:00.000Z', daysRemaining: 3.8, expiringSoon: true, checked: 'palianytsiabread.com' } })
  await page.goto('/admin/server-health')
  await expect(card(page, 'ssl')).toHaveClass(/is-danger/)
  await expect(card(page, 'ssl')).toContainText('3 days')

  const expired = await page.context().browser()!.newContext()
  const second = await expired.newPage()
  await mockHealth(second, { ...healthy, ssl: { validTo: '2026-10-01T10:00:00.000Z', daysRemaining: -4.2, expiringSoon: true, checked: 'palianytsiabread.com' } })
  await second.goto('/admin/server-health')
  await expect(card(second, 'ssl')).toHaveClass(/is-danger/)
  await expect(card(second, 'ssl')).toContainText('Expired')
  await expect(card(second, 'ssl')).toContainText('Expired Oct 1, 2026')
  await expired.close()

  const healthyPage = await page.context().browser()!.newContext()
  const third = await healthyPage.newPage()
  await mockHealth(third)
  await third.goto('/admin/server-health')
  await expect(card(third, 'ssl')).not.toHaveClass(/is-danger/)
  await healthyPage.close()
})

test('one day left is singular, and less than a day is not rounded down to zero', async ({ page }) => {
  await mockHealth(page, { ...healthy, ssl: { validTo: '2026-10-06T20:00:00.000Z', daysRemaining: 1.2, expiringSoon: true, checked: 'x' } })
  await page.goto('/admin/server-health')
  await expect(card(page, 'ssl')).toContainText('1 day')
  await expect(card(page, 'ssl')).not.toContainText('1 days')

  const other = await page.context().browser()!.newContext()
  const second = await other.newPage()
  await mockHealth(second, { ...healthy, ssl: { validTo: '2026-10-05T20:00:00.000Z', daysRemaining: 0.4, expiringSoon: true, checked: 'x' } })
  await second.goto('/admin/server-health')
  await expect(card(second, 'ssl')).toContainText('Under 1 day')
  await other.close()
})

test('a measurement that could not be taken says why, while the others are still shown', async ({ page }) => {
  await mockHealth(page, {
    ...healthy, disk: null, ssl: null,
    problems: { disk: 'df: command not found', ssl: 'Could not connect to palianytsiabread.com:443 (ECONNREFUSED).' },
  })
  await page.goto('/admin/server-health')
  await expect(card(page, 'disk')).toContainText('Unavailable')
  await expect(card(page, 'disk')).toContainText('df: command not found')
  await expect(card(page, 'ssl')).toContainText('Unavailable')
  await expect(card(page, 'ssl')).toContainText('ECONNREFUSED')
  await expect(card(page, 'cpu')).toContainText('12.3%')
  await expect(card(page, 'ram')).toContainText('61.8%')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Refresh asks for fresh figures and shows them', async ({ page }) => {
  const requests = await mockHealth(page, (count: number) => ({
    json: { ...healthy, cpu: { usedPercent: count === 1 ? 12.3 : 55.5 }, checkedAt: count === 1 ? healthy.checkedAt : '2026-10-05T12:30:00.000Z' },
  }))
  await page.goto('/admin/server-health')
  await expect(card(page, 'cpu')).toContainText('12.3%')
  // The time shown depends on the machine's time zone, so check that it changes rather than what it is.
  const checkedBefore = await page.locator('.health-checked').textContent()
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(card(page, 'cpu')).toContainText('55.5%')
  await expect(page.locator('.health-checked')).not.toHaveText(checkedBefore!)
  await expect(page.locator('.health-checked')).toHaveText(/^Last checked Oct 5, 2026/)
  expect(requests).toEqual(['GET', 'GET'])
})

test('while refreshing the button is disabled and the old figures stay on screen', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/admin/server-health', async route => {
    calls++
    if (calls > 1) await gate
    await route.fulfill({ json: healthy })
  })
  await page.goto('/admin/server-health')
  await expect(card(page, 'cpu')).toContainText('12.3%')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
  await expect(card(page, 'cpu')).toContainText('12.3%')
  release()
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

test('a failed load is explained and can be retried', async ({ page }) => {
  let available = false
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/admin/server-health', route => route.fulfill(available
    ? { json: healthy }
    : { status: 503, json: { error: 'This is temporarily unavailable. Please try again.' } }))
  await page.goto('/admin/server-health')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  available = true
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(card(page, 'disk')).toContainText('26.4%')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a failed refresh keeps the figures already shown', async ({ page }) => {
  let calls = 0
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/admin/server-health', route => route.fulfill(++calls === 1
    ? { json: healthy }
    : { status: 503, json: { error: 'This is temporarily unavailable. Please try again.' } }))
  await page.goto('/admin/server-health')
  await expect(card(page, 'disk')).toContainText('26.4%')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await expect(card(page, 'disk')).toContainText('26.4%')
})

test('an expired admin session returns to the sign-in form', async ({ page }) => {
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/front-page', route => route.fulfill({ json: { title: 'T', subtitle: 'S', story: '<p>x</p>' } }))
  await page.route('**/api/admin/server-health', route => route.fulfill({ status: 401, json: { error: 'Please sign in as an admin.' } }))
  await page.goto('/admin/server-health')
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('session expired')
})

test('nothing is requested until an admin has signed in', async ({ page }) => {
  const requests = await mockHealth(page, healthy, false)
  await page.goto('/admin/server-health')
  await expect(page.getByLabel('Admin password')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  expect(requests).toEqual([])
})

test('the figures are only measured when the tab is opened, and kept when switching tabs', async ({ page }) => {
  const requests = await mockHealth(page)
  await page.route('**/api/admin/orders', route => route.fulfill({ json: [] }))
  await page.goto('/admin/front')
  await expect(page.getByLabel('Story HTML')).toBeVisible()
  expect(requests).toEqual([])

  await page.getByRole('tab', { name: 'Server Health' }).click()
  await expect(page).toHaveURL('/admin/server-health')
  await expect(card(page, 'disk')).toContainText('26.4%')
  await page.getByRole('tab', { name: 'Orders' }).click()
  await page.getByRole('tab', { name: 'Server Health' }).click()
  await expect(card(page, 'disk')).toContainText('26.4%')
  expect(requests).toEqual(['GET'])
})
