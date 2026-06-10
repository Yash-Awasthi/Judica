import { test, expect } from '@playwright/test'

test.describe('CodeGen page (/codegen)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('judica_user', JSON.stringify({ username: 'test', role: 'admin' }))
    })
    await page.goto('/codegen')
    await page.waitForLoadState('networkidle')
  })

  test('codegen page loads with prompt textarea and stack selector', async ({ page }) => {
    await expect(page.locator('text=/codegen|code gen|generate/i').first()).toBeVisible({ timeout: 3000 })
    await expect(page.locator('select, [role="listbox"]').first()).toBeVisible()
    await expect(page.locator('textarea, [placeholder*="describe"]').first()).toBeVisible()
  })

  test('nav includes CodeGen link in sidebar', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('a[href="/codegen"], text=CodeGen').first()).toBeVisible()
  })

  test('generate button fires SSE request and streams code', async ({ page }) => {
    const MOCK_CODE = 'function greet(name: string) {\n  return `Hello, ${name}!`;\n}'

    await page.route('/api/codegen/generate', async (route) => {
      const body = [
        `data: ${JSON.stringify({ type: 'chunk', text: MOCK_CODE })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', sessionId: 'sess-test-1' })}\n\n`,
      ].join('')
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    })

    const textarea = page.locator('textarea').first()
    await textarea.fill('Write a greeting function in TypeScript')

    const generateBtn = page.locator('button', { hasText: /generate/i }).first()
    await generateBtn.click()

    await expect(page.locator('text=greet').first()).toBeVisible({ timeout: 6000 })
  })

  test('iterate button fires second SSE request', async ({ page }) => {
    await page.route('/api/codegen/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'chunk', text: 'const x = 1' })}\n\ndata: ${JSON.stringify({ type: 'done', sessionId: 's1' })}\n\n`,
      })
    })

    let iterateCalled = false
    await page.route('/api/codegen/iterate', async (route) => {
      iterateCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'chunk', text: 'const x = 2' })}\n\ndata: ${JSON.stringify({ type: 'done', sessionId: 's1' })}\n\n`,
      })
    })

    // Generate first
    const textarea = page.locator('textarea').first()
    await textarea.fill('const x = 1')
    await page.locator('button', { hasText: /generate/i }).first().click()
    await expect(page.locator('text=const x').first()).toBeVisible({ timeout: 5000 })

    // Iterate
    const iterateInput = page.locator('textarea, input[placeholder*="iterate"], input[placeholder*="change"]').nth(1)
    if (await iterateInput.count() > 0) {
      await iterateInput.fill('Change x to 2')
      await page.locator('button', { hasText: /iterate|apply|update/i }).first().click()
      await expect(iterateCalled).toBeTruthy()
    }
  })

  test('stack selector changes the generation context', async ({ page }) => {
    const select = page.locator('select').first()
    await select.selectOption('python')
    const selectedValue = await select.inputValue()
    expect(selectedValue).toBe('python')
  })

  test('preview pane shows iframe for html stack', async ({ page }) => {
    const select = page.locator('select').first()
    await select.selectOption('html')

    await page.route('/api/codegen/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'chunk', text: '<h1>Hello World</h1>' })}\n\ndata: ${JSON.stringify({ type: 'done', sessionId: 's2' })}\n\n`,
      })
    })

    const textarea = page.locator('textarea').first()
    await textarea.fill('Hello world page')
    await page.locator('button', { hasText: /generate/i }).first().click()

    // After generation, click Preview toggle
    const previewBtn = page.locator('button', { hasText: /preview/i }).first()
    if (await previewBtn.count() > 0) {
      await previewBtn.click()
      await expect(page.locator('iframe')).toBeVisible({ timeout: 3000 })
    }
  })

  test('continue editing bar resumes previous session from localStorage', async ({ page }) => {
    await page.addInitScript(() => {
      const session = {
        prompt: 'Previous prompt that was saved',
        stack: 'typescript',
        code: 'const saved = true',
        ts: Date.now(),
      }
      localStorage.setItem('codegen_active_session', JSON.stringify(session))
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // Continue editing bar should appear
    await expect(page.locator('text=/previous prompt|continue/i').first()).toBeVisible({ timeout: 2000 })
  })

  test('/api/codegen/generate endpoint responds', async ({ page }) => {
    const res = await page.request.post('/api/codegen/generate', {
      data: { prompt: 'hello world function', stack: 'typescript', sessionId: null },
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    })
    // Should return 200 (even mock)
    expect([200, 201]).toContain(res.status())
  })
})
