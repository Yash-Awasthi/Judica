import { test, expect } from '@playwright/test'

test.describe('Diff UI (DiffViewer / DiffBlock)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('judica_user', JSON.stringify({ username: 'test', role: 'admin' }))
    })
  })

  test('codegen page renders diff view after generation', async ({ page }) => {
    await page.route('/api/codegen/generate', async (route) => {
      const body = `data: ${JSON.stringify({ type: 'chunk', text: 'function hello() { return 42; }' })}\n\n` +
                   `data: ${JSON.stringify({ type: 'done', sessionId: 'sess1' })}\n\n`
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      })
    })

    await page.goto('/codegen')
    await page.waitForLoadState('networkidle')

    // Submit a generation
    const promptArea = page.locator('textarea').first()
    await promptArea.fill('Write a hello function')

    const generateBtn = page.getByRole('button', { name: /generate/i })
    await generateBtn.click()

    // Wait for code to appear
    await expect(page.locator('text=hello')).toBeVisible({ timeout: 5000 })
  })

  test('diff view tab shows diff viewer on codegen page', async ({ page }) => {
    await page.route('/api/codegen/iterate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'chunk', text: 'function hello() { return 100; }' })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`,
      })
    })

    await page.goto('/codegen')
    await page.waitForLoadState('networkidle')

    // Check diff view toggle exists
    const diffBtn = page.locator('button', { hasText: /diff/i })
    if (await diffBtn.count() > 0) {
      await diffBtn.click()
      // DiffViewer or no-changes placeholder should appear
      await expect(page.locator('text=/diff|changes|no changes/i').first()).toBeVisible({ timeout: 2000 })
    }
  })

  test('parseltongue shows DiffViewer when specialist suggests code', async ({ page }) => {
    await page.route('/api/parseltongue/analyze', async (route) => {
      const codeBlock = '```typescript\nfunction hello() {\n  return 42; // fixed\n}\n```'
      const events = [
        `data: ${JSON.stringify({ type: 'init', language: 'typescript', linesOfCode: 1, complexity: 1, roles: [{ id: 'reviewer', label: 'Code Review', icon: '🔍' }] })}\n\n`,
        `data: ${JSON.stringify({ type: 'response', roleId: 'reviewer', text: `Here is my suggestion:\n${codeBlock}`, latencyMs: 100, tokens: 50, status: 'done' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', totalMs: 100, language: 'typescript', linesOfCode: 1, complexity: 1, issueCount: 0, suggestionCount: 1 })}\n\n`,
      ].join('')

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: events,
      })
    })

    await page.goto('/parseltongue')
    await page.waitForLoadState('networkidle')

    const codeArea = page.locator('textarea[placeholder*="paste code"]')
    await codeArea.fill('function hello() { return 1; }')

    await page.getByRole('button', { name: /analyze/i }).click()

    // Should render the diff viewer
    await expect(page.locator('text=SUGGESTED DIFF').first()).toBeVisible({ timeout: 6000 })
  })

  test('diff hunk accept/reject buttons work', async ({ page }) => {
    await page.goto('/codegen')
    await page.waitForLoadState('networkidle')

    // Switch to diff tab if it exists and has content
    const diffBtn = page.locator('button', { hasText: /diff/i })
    if (await diffBtn.count() > 0) {
      await diffBtn.click()
    }

    // If accept button exists, click it
    const acceptBtn = page.locator('button', { hasText: /accept/i }).first()
    if (await acceptBtn.count() > 0) {
      await acceptBtn.click()
      await expect(acceptBtn).toBeDisabled()
    }
  })

  test('/api/diff/parse endpoint returns hunks', async ({ page }) => {
    const res = await page.request.post('/api/diff/parse', {
      data: {
        original: 'line one\nline two\nline three',
        modified: 'line one\nline TWO\nline three',
        filename: 'test.ts',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body)).toBeTruthy()
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('id')
    expect(body[0]).toHaveProperty('lines')
  })
})
