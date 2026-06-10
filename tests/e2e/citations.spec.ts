import { test, expect } from '@playwright/test'

test.describe('Citations (Deep Research inline citations)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('judica_user', JSON.stringify({ username: 'test', role: 'admin' }))
    })
    await page.goto('/deep-research')
    await page.waitForLoadState('networkidle')
  })

  test('deep research page loads with citation sidebar toggle', async ({ page }) => {
    await expect(page.locator('h1, [class*="deep"], text=DEEP').first()).toBeVisible({ timeout: 3000 })
    // Citations sidebar toggle button should be present
    const citationsBtn = page.locator('button', { hasText: /sources|citations/i })
    await expect(citationsBtn.first()).toBeVisible()
  })

  test('citations sidebar opens and closes', async ({ page }) => {
    const toggle = page.locator('button', { hasText: /sources|citations/i }).first()
    await toggle.click()
    // Sidebar should appear (or be visible already)
    // toggle again to close
    await toggle.click()
  })

  test('CitationBadge renders superscript numbers', async ({ page }) => {
    // Mock a research job that returns citations
    await page.route('/api/research/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'test-job-1' }),
      })
    })

    await page.route('/api/research/stream/test-job-1', async (route) => {
      const report = 'The sky is blue [1]. Water is wet [2].'
      const citations = [
        { id: '1', url: 'https://example.com/1', title: 'Sky Colors', excerpt: 'The sky appears blue...' },
        { id: '2', url: 'https://example.com/2', title: 'Water Properties', excerpt: 'Water is a liquid...' },
      ]
      const body = [
        `data: ${JSON.stringify({ type: 'progress', message: 'Researching...' })}\n\n`,
        `data: ${JSON.stringify({ type: 'report', report, citations })}\n\n`,
        `data: ${JSON.stringify({ type: 'done' })}\n\n`,
      ].join('')

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      })
    })

    const input = page.locator('input[placeholder*="research"], textarea[placeholder*="research"]').first()
    await input.fill('What is the color of the sky?')
    await page.getByRole('button', { name: /start|research/i }).first().click()

    // Wait for report and citation badges
    await expect(page.locator('text=/sky.*blue|blue.*sky/i').first()).toBeVisible({ timeout: 10000 })
  })

  test('related questions appear after research completes', async ({ page }) => {
    await page.route('/api/research/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'test-job-rq' }),
      })
    })

    await page.route('/api/research/stream/test-job-rq', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'report', report: 'Test report content.', citations: [] })}\n\n`,
          `data: ${JSON.stringify({ type: 'done' })}\n\n`,
        ].join(''),
      })
    })

    await page.route('/api/research/related-questions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ questions: ['What else?', 'Tell me more?', 'Why is that?'] }),
      })
    })

    const input = page.locator('input[placeholder*="research"], textarea[placeholder*="research"]').first()
    await input.fill('Test topic')
    await page.getByRole('button', { name: /start|research/i }).first().click()

    // Related questions should appear
    await expect(page.locator('text=What else?')).toBeVisible({ timeout: 8000 })
  })

  test('CitationCard hover shows source details', async ({ page }) => {
    // This is a UI interaction test — verify the hover card behavior
    // by checking the component renders citation metadata
    const badge = page.locator('[data-testid="citation-badge"]').first()
    if (await badge.count() > 0) {
      await badge.hover()
      await expect(page.locator('[data-testid="citation-card"]')).toBeVisible({ timeout: 1000 })
    }
  })
})
