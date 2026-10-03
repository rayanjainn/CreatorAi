import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

export const API = process.env.E2E_API_URL || 'http://localhost:8100'
export const DEMO = { email: 'demo@creatorai.local', password: 'demo1234' }

export async function login(page: Page) {
  await page.goto('/login')
  await page.fill('#email', DEMO.email)
  await page.fill('#password', DEMO.password)
  await page.click('[data-testid=login-submit]')
  await page.waitForURL('**/dashboard')
}

export async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/api/v1/auth/login`, { data: DEMO })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).access_token
}

export type ApiCard = { id: string; title: string; stage: string; position: number }

export async function apiBoard(request: APIRequestContext): Promise<{ stage: string; cards: ApiCard[] }[]> {
  const token = await apiToken(request)
  const res = await request.get(`${API}/api/v1/content/board`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()).columns
}

export async function apiFindCard(request: APIRequestContext, title: string): Promise<ApiCard | undefined> {
  const cols = await apiBoard(request)
  return cols.flatMap((c) => c.cards).find((c) => c.title.includes(title))
}

/** Native HTML5 drag & drop needs several intermediate mouse moves (locator.dragTo emits too few). */
export async function dragTo(page: Page, source: Locator, target: Locator) {
  const s = (await source.boundingBox())!
  const t = (await target.boundingBox())!
  await page.mouse.move(s.x + 40, s.y + 30)
  await page.mouse.down()
  await page.mouse.move(s.x + 60, s.y + 50, { steps: 5 })
  await page.mouse.move(t.x + 50, t.y + 40, { steps: 10 })
  await page.mouse.move(t.x + 52, t.y + 42, { steps: 3 })
  await page.mouse.up()
}
