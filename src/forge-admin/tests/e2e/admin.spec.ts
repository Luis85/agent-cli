import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './support/forge'

test('loads the CLI-managed system, refreshes without writes, and preserves access on reload', async ({ page, forge }, testInfo) => {
  const pageErrors: string[] = []
  const writes: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).origin !== forge.origin) externalRequests.push(request.url())
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.method())
  })
  await page.goto(forge.url)
  await expect(page.getByRole('heading', { name: 'Developer admin', exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await expect(page.getByText('inspection-fixture', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Plugins\b/ })).toBeVisible()
  await expect.poll(() => new URL(page.url()).hash).toBe('')
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/system') && response.status() === 200)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await refreshed
  await page.reload()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await page.screenshot({ path: testInfo.outputPath('admin-desktop.png'), fullPage: true })
  expect(pageErrors).toEqual([])
  expect(writes).toEqual([])
  expect(externalRequests).toEqual([])
})

test('filters plugins and provides an actionable empty search state', async ({ page, forge }) => {
  await page.goto(forge.url)
  const search = page.getByRole('textbox', { name: 'Search plugins' })
  await expect(search).toBeVisible()
  await search.fill('claude')
  await expect(page.getByText('claude', { exact: true }).first()).toBeVisible()
  await search.fill('no-such-plugin-7391')
  await expect(page.getByText(/no plugins match/i)).toBeVisible()
  await search.clear()
  await expect(page.getByText('claude', { exact: true }).first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Plugin status' }).click()
  await page.getByRole('option', { name: 'Disabled', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Plugins' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('claude', { exact: true }).first()).toBeVisible()
})

test('supports keyboard navigation and a narrow mobile viewport', async ({ page, forge }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: /skip to/i })).toBeFocused()
  await page.keyboard.press('Enter')
  const search = page.getByRole('textbox', { name: 'Search plugins' })
  await search.focus()
  await page.keyboard.type('claude')
  await expect(search).toHaveValue('claude')
  await search.clear()
  const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path: testInfo.outputPath('admin-mobile.png'), fullPage: true })
})

test('rejects missing and expired access without exposing workspace state', async ({ page, forge }) => {
  await page.goto(`${forge.origin}/views/admin/`)
  await expect(page.getByText('Open a fresh admin link', { exact: true })).toBeVisible()
  await expect(page.getByText('inspection-fixture', { exact: true })).toHaveCount(0)
  await page.goto('about:blank')
  const unauthorized = page.waitForResponse(response => response.url().endsWith('/api/system') && response.status() === 401)
  await page.goto(`${forge.origin}/views/admin/#token=expired-test-token`)
  await unauthorized
  await expect(page.getByText('Open a fresh admin link', { exact: true })).toBeVisible()
  await expect(page.getByText('inspection-fixture', { exact: true })).toHaveCount(0)
})

test('retains the last snapshot on disconnect and recovers on refresh', async ({ page, forge }) => {
  await page.goto(forge.url)
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await page.route('**/api/system', route => route.abort('connectionrefused'))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Server unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('inspection-fixture', { exact: true }).first()).toBeVisible()
  await page.unroute('**/api/system')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  await expect(page.getByText('Server unavailable', { exact: true })).toHaveCount(0)
})

test('reports an unavailable selection when the selected project disappears', async ({ page, forge }) => {
  const marker = join(forge.workspace, 'projects/inspection-fixture/.forge/project.json')
  const backup = `${marker}.e2e-backup`
  await rename(marker, backup)
  try {
    await page.goto(forge.url)
    // The server briefly caches snapshots; retry actual refreshes until discovery runs again.
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(page.getByText('Selection unavailable', { exact: true })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000, intervals: [250, 1000] })
    await expect(page.getByRole('region', { name: 'System warnings' })).toContainText('Could not inspect project current')
    await expect(page.getByText('No project selected', { exact: true })).toHaveCount(0)
    await expect(page.getByText('The CLI is using workspace scope.', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Plugins\b/ })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Connected')
  } finally {
    await rename(backup, marker)
  }
})
