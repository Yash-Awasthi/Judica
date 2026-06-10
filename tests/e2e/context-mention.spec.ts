import { test, expect } from '@playwright/test'

test.describe('Context Mention (@context syntax)', () => {
  test.beforeEach(async ({ page }) => {
    // Set up auth bypass
    await page.addInitScript(() => {
      localStorage.setItem('judica_user', JSON.stringify({ username: 'test', role: 'admin' }))
    })
    await page.goto('/chat')
    await page.waitForLoadState('networkidle')
  })

  test('typing @ in chat textarea opens context picker', async ({ page }) => {
    const textarea = page.locator('textarea[placeholder*="enter prompt"]')
    await textarea.click()
    await textarea.type('@')
    // Picker overlay should appear
    await expect(page.locator('text=@file:')).toBeVisible({ timeout: 2000 })
    await expect(page.locator('text=@symbol:')).toBeVisible()
    await expect(page.locator('text=@web:')).toBeVisible()
  })

  test('typing @file: triggers file search', async ({ page }) => {
    // Mock the API
    await page.route('/api/context/files*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ name: 'chat.tsx', path: 'frontend/app/routes/chat.tsx' }] }),
      })
    })

    const textarea = page.locator('textarea[placeholder*="enter prompt"]')
    await textarea.click()
    await textarea.type('@file:chat')

    await expect(page.locator('text=chat.tsx')).toBeVisible({ timeout: 3000 })
  })

  test('typing @symbol: triggers symbol search', async ({ page }) => {
    await page.route('/api/context/symbols*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ name: 'handleSend', kind: 'function', file: 'chat.tsx' }] }),
      })
    })

    const textarea = page.locator('textarea[placeholder*="enter prompt"]')
    await textarea.click()
    await textarea.type('@symbol:handleSend')

    await expect(page.locator('text=handleSend')).toBeVisible({ timeout: 3000 })
  })

  test('pressing Escape closes context picker', async ({ page }) => {
    const textarea = page.locator('textarea[placeholder*="enter prompt"]')
    await textarea.click()
    await textarea.type('@')

    // Wait for picker
    await expect(page.locator('text=@file:')).toBeVisible({ timeout: 2000 })

    await textarea.press('Escape')
    await expect(page.locator('text=@file:')).not.toBeVisible({ timeout: 1000 })
  })

  test('selecting a file result creates a context pill', async ({ page }) => {
    await page.route('/api/context/files*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ name: 'README.md', path: 'README.md' }] }),
      })
    })

    const textarea = page.locator('textarea[placeholder*="enter prompt"]')
    await textarea.click()
    await textarea.type('@file:README')

    await page.locator('text=README.md').click()

    // A pill should appear
    await expect(page.locator('text=README.md').first()).toBeVisible()
  })

  test('@context works in parseltongue code textarea', async ({ page }) => {
    await page.goto('/parseltongue')
    await page.waitForLoadState('networkidle')

    const textarea = page.locator('textarea[placeholder*="paste code"]')
    await textarea.click()
    await textarea.type('@')

    // picker opens in parseltongue too
    await expect(page.locator('text=type @file')).toBeVisible({ timeout: 2000 })
  })
})
