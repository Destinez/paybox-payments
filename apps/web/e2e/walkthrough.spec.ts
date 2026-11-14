import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const run = (step: string) =>
  promisify(execFile)('pnpm', ['exec', 'tsx', 'scripts/demo/walkthrough.mts', step], { timeout: 90000 });
test('full operations walkthrough covers retries, browser replay, reconciliation, refund and x402', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const credentials = JSON.parse(await readFile('.local/demo.json', 'utf8'));
  await run('01');
  await run('02');
  await run('03');
  const state = JSON.parse(await readFile('.local/walkthrough.json', 'utf8'));
  await page.goto('/login');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Dead-letter queue', exact: true }).click();
  await expect(page.getByText('8 total attempts', { exact: true })).toBeVisible();
  await page.getByText('View attempt history').click();
  await expect(page.getByRole('cell', { name: '#8', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.local/demo-dlq.png', fullPage: true });
  await request.post('http://localhost:4100/control', { data: { fail: false } });
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(
    page.getByText('Job queued for replay. Its attempt history has been preserved.'),
  ).toBeVisible();
  await page.goto(`/payments/${state.second.id}`);
  await expect(page.getByText('notify merchant').first()).toBeVisible();
  await run('04');
  await page.getByRole('link', { name: 'Reconciliation', exact: true }).click();
  await expect(page.getByText('amount mismatch', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.local/demo-reconciliation.png', fullPage: true });
  await page.goto(`/payments/${state.second.id}`);
  await expect(page.getByText('Partial refund demonstration')).toBeVisible();
  await expect(page.getByText('partially refunded', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '.local/demo-payment.png', fullPage: true });
  await promisify(execFile)('pnpm', ['demo:x402']);
  await page.getByRole('link', { name: 'Paid endpoints', exact: true }).click();
  await expect(page.getByText('settled', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
