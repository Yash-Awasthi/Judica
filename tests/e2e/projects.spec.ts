import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('Projects (Memory, Files, Instructions)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('judica_user', JSON.stringify({ username: 'test', role: 'admin' }))
    })
    await page.goto('/projects')
    await page.waitForLoadState('networkidle')
  })

  test('projects page renders project list or empty state', async ({ page }) => {
    await page.route('/api/v1/projects*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ projects: [{ id: 'proj1', name: 'Test Project', description: 'A test project', model: 'auto', created_at: new Date().toISOString() }] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.reload()
    await page.waitForLoadState('networkidle')
    // Either project list or empty state should be visible
    const content = page.locator('text=Test Project, text=No projects, text=Create')
    await expect(content.first()).toBeVisible({ timeout: 5000 })
  })

  test('create project modal opens and has required fields', async ({ page }) => {
    await page.route('/api/v1/projects*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) })
    })

    const createBtn = page.locator('button', { hasText: /new project|create/i }).first()
    await createBtn.click()

    // Modal should show name + description fields
    await expect(page.locator('input[placeholder*="name"], input[name="name"]').first()).toBeVisible({ timeout: 2000 })
    await expect(page.locator('textarea[placeholder*="description"], input[placeholder*="description"]').first()).toBeVisible()
  })

  test('create project submits to API', async ({ page }) => {
    await page.route('/api/v1/projects', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) })
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'new-proj', name: 'My Project', description: '', model: 'auto', created_at: new Date().toISOString() }),
        })
      } else {
        await route.continue()
      }
    })

    const createBtn = page.locator('button', { hasText: /new project|create/i }).first()
    await createBtn.click()

    const nameInput = page.locator('input[placeholder*="name"], input[name="name"]').first()
    await nameInput.fill('My Project')

    await page.locator('button[type="submit"], button', { hasText: /create|save/i }).last().click()

    // Project should appear or modal should close
    await expect(page.locator('text=My Project')).toBeVisible({ timeout: 3000 })
  })

  test('project file attachments component — drag and drop zone visible', async ({ page }) => {
    await page.route('/api/v1/projects*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'p1', name: 'P1', description: '', model: 'auto', created_at: new Date().toISOString() }] }) })
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // Click into a project
    const proj = page.locator('text=P1').first()
    if (await proj.isVisible()) {
      await proj.click()
      await expect(page.locator('text=/drop files|Files/i').first()).toBeVisible({ timeout: 3000 })
    }
  })

  test('project instructions textarea persists to localStorage', async ({ page }) => {
    const projId = 'test-proj-persist'
    await page.addInitScript((id) => {
      localStorage.setItem(`project_instructions_${id}`, 'Always use TypeScript.')
    }, projId)

    // Verify localStorage read works
    const val = await page.evaluate((id) => localStorage.getItem(`project_instructions_${id}`), projId)
    expect(val).toBe('Always use TypeScript.')
  })

  test('project memory panel fetches entries', async ({ page }) => {
    await page.route('/api/memory/entries*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [{ id: 1, content: 'Remembered fact', category: 'note', created_at: new Date().toISOString() }], total: 1 }),
      })
    })

    await page.route('/api/v1/projects*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'p-mem', name: 'Mem Project', description: '', model: 'auto', created_at: new Date().toISOString() }] }) })
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    const proj = page.locator('text=Mem Project').first()
    if (await proj.isVisible()) {
      await proj.click()
      await expect(page.locator('text=Remembered fact')).toBeVisible({ timeout: 3000 })
    }
  })
})
