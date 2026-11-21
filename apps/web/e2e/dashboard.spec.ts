import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

let credentials: { email: string; password: string; viewer_email: string; viewer_password: string };
test.beforeAll(async () => {
  credentials = JSON.parse(await readFile('.local/demo.json', 'utf8'));
});
test('dashboard login, payment filters, detail, responsive layout and accessibility', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Every payment. Accounted for.' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  await page.screenshot({ path: '.local/dashboard-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'View all payments' }).click();
  await page.getByLabel('Search payments').fill('PBX-1040');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'PBX-1040', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment timeline' })).toBeVisible();
  await expect(page.getByText('Balances are derived from immutable entries.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue refund', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Issue a refund' })).toBeVisible();
  await page.getByLabel('Refund amount (NGN)').fill('5000');
  await page.getByLabel('Reason', { exact: true }).fill('Customer requested a partial refund');
  await page.getByRole('button', { name: 'Request refund', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Customer requested a partial refund')).toBeVisible();
  await page.getByRole('link', { name: 'Dead-letter queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing needs rescuing' })).toBeVisible();
  await page.getByRole('link', { name: 'Reconciliation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reconciliation report' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Reconciliation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  await page.screenshot({ path: '.local/dashboard-mobile.png', fullPage: true });
});
test('viewer sees masked details and cannot initiate money movement', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(credentials.viewer_email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.viewer_password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Every payment. Accounted for.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create payment' })).toHaveCount(0);
  await page.locator('tbody .reference-link').first().click();
  await expect(page.getByRole('heading', { name: 'Payment timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue refund', exact: true })).toHaveCount(0);
  await expect(page.getByText(/\*\*\*@example.com/)).toBeVisible();
});

test('x402 demo pays once, route editing works, and the tab is accessible on desktop and mobile', async ({
  page,
}) => {
  const demoCredentials = JSON.parse(await readFile('.local/demo.json', 'utf8'));
  const auth = { Authorization: `Bearer ${demoCredentials.api_key}` };
  const before = await (await fetch('http://localhost:4000/v1/x402/payments', { headers: auth })).json();
  const routes = await (await fetch('http://localhost:4000/v1/x402/routes', { headers: auth })).json();
  const amount =
    BigInt(before.books.USDC) +
    BigInt(routes.data.find((r: { path: string }) => r.path === '/v1/stock').price);
  const expectedBalance = `${amount / 1000000n}.${String(amount % 1000000n).padStart(6, '0')} USDC`;
  await promisify(execFile)('pnpm', ['demo:x402'], {
    env: { ...process.env, COREPACK_HOME: '/tmp/paybox-corepack' },
  });
  await page.goto('/login');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Paid endpoints', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paid endpoints' })).toBeVisible();
  await expect(page.getByText('settled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: expectedBalance })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Stock availability' }).click();
  await page.getByLabel('Price (USDC)').fill('0.02');
  await page.getByRole('button', { name: 'Save priced route', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '0.020000 USDC', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.local/x402-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/x402-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Deactivate Stock availability' }).click();
  await expect(page.getByText('inactive', { exact: true })).toBeVisible();
});
