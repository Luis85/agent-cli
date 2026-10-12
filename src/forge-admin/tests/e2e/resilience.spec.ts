import { test, expect } from './support/forge'

test('recovers access when a fresh CLI link opens in the same tab', async ({ page, forge }) => {
  await page.goto(`${forge.origin}/views/admin/#token=expired-test-token`)
  await expect(page.getByText('Open a fresh admin link', { exact: true })).toBeVisible()
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await expect(page.getByText('inspection-fixture', { exact: true }).first()).toBeVisible()
  await expect.poll(() => new URL(page.url()).hash).toBe('')
  await page.reload()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
})

test('uses the CLI link in memory when browser session storage is blocked', async ({ page, forge }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError') },
    })
  })
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await expect.poll(() => new URL(page.url()).hash).toBe('')
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/system') && response.status() === 200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await refreshed
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
})

test('keeps the last successful snapshot when a response is malformed, then recovers', async ({ page, forge }) => {
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await page.route('**/api/system', async route => {
    const response = await route.fetch()
    const envelope = await response.json()
    envelope.data.stats.commands = -1
    await route.fulfill({ response, json: envelope })
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('System response could not be read', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Response unavailable')
  await expect(page.getByText('The view below is the last successful snapshot.', { exact: true })).toBeVisible()
  await expect(page.getByText('inspection-fixture', { exact: true }).first()).toBeVisible()
  await page.unroute('**/api/system')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await expect(page.getByText('System response could not be read', { exact: true })).toHaveCount(0)
})

test('honors polling preferences and stops retrying expired credentials', async ({ page, forge }) => {
  await page.clock.install()
  let requests = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/system') requests++ })
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  expect(requests).toBe(1)
  await page.clock.runFor(15_000)
  await expect.poll(() => requests).toBe(2)
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await page.getByRole('switch', { name: 'Auto-refresh' }).click()
  await page.clock.runFor(30_000)
  expect(requests).toBe(2)
  await page.getByRole('switch', { name: 'Auto-refresh' }).click()
  await page.route('**/api/system', route => route.fulfill({ status: 401, json: { ok: false } }))
  await page.clock.runFor(15_000)
  await expect(page.getByText('Open a fresh admin link', { exact: true })).toBeVisible()
  const afterExpiry = requests
  await page.clock.runFor(30_000)
  expect(requests).toBe(afterExpiry)
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => sessionStorage.getItem('forge.admin.token'))).toBeNull()
})

test('wraps long metadata and keeps primary controls touchable at narrow widths', async ({ page, forge }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const longText = 'long-metadata-'.repeat(16)
  await page.route('**/api/system', async route => {
    const response = await route.fetch()
    const envelope = await response.json()
    envelope.data.server.version = longText
    envelope.data.workspace.root = `/workspace/${longText}`
    envelope.data.workspace.selectedProject.name = longText
    envelope.data.projects[0].type = longText
    envelope.data.plugins[0].version = longText
    await route.fulfill({ response, json: envelope })
  })
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport)
  // Check content boxes as well as the page: hidden section overflow can mask clipped metadata.
  const clipped = await page.locator('.selected-project, .runtime-details dd, .project-type, .plugin-version').evaluateAll(elements =>
    elements.filter(element => {
      const bounds = element.getBoundingClientRect()
      const section = element.closest('section')!.getBoundingClientRect()
      return element.scrollWidth > element.clientWidth + 1 || bounds.left < section.left || bounds.right > section.right
    }).map(element => element.className))
  expect(clipped).toEqual([])
  for (const control of [
    page.getByRole('button', { name: 'Refresh', exact: true }),
    page.getByRole('textbox', { name: 'Search plugins' }),
    page.getByRole('combobox', { name: 'Plugin status' }),
  ]) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  // The visual switch stays compact; its associated label must offer a real
  // touch target, rather than only adding height to a noninteractive wrapper.
  const autoRefreshLabel = page.locator('label').filter({ hasText: 'Auto-refresh' })
  const labelBox = await autoRefreshLabel.boundingBox()
  expect(labelBox?.height).toBeGreaterThanOrEqual(44)
  await autoRefreshLabel.click({ position: { x: 5, y: 2 } })
  await expect(page.getByRole('switch', { name: 'Auto-refresh' })).not.toBeChecked()
})
