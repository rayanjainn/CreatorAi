import { expect, test } from '@playwright/test'
import { API, authHeaders, login } from '../helpers'

test('mock mode: a pitch is written and labelled MOCK', async ({ page, request }) => {
  const brand = `E2E Pitch ${Date.now()}`
  const res = await request.post(`${API}/api/v1/monetization/deals`, {
    headers: await authHeaders(request),
    data: { brand, contact_name: 'Sam', fee: 900, deliverables: 'a 60 second integration' },
  })
  expect(res.ok()).toBeTruthy()
  await login(page)
  await page.goto('/monetization')
  await page.getByTestId('deal-card').filter({ hasText: brand }).getByTestId('deal-pitch').click()
  await page.getByTestId('pitch-generate').click()
  const out = page.getByTestId('pitch-output')
  await expect(out).toContainText('Hi Sam,')
  await expect(out.locator('.prov[data-source=mock]')).toBeVisible()
})
