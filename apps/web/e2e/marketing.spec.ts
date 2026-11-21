import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const width of [1440, 768, 390, 360]) {
  test(`public payment trace and navigation are accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto('/'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recover delivery.');
    const trace = page.getByRole('article', { name: 'Interactive test payment' });
    await page.getByRole('link', { name: 'Explore the test payment' }).click();
    await expect(trace).toBeInViewport();
    for (const [action, state] of [
      ['Show delivery failure', 'Delivery failed'],
      ['Replay notification', 'Replay queued'],
      ['See delivery result', 'Delivered'],
      ['Restart example', 'Queued'],
    ]) {
      await trace.getByRole('button', { name: action, exact: true }).click();
      await expect(trace.getByRole('strong').filter({ hasText: new RegExp(`^${state}$`) })).toBeVisible();
      await expect(trace.getByText('₦15,000.00', { exact: true })).toBeVisible();
      await expect(trace.getByText('Payment verified', { exact: true })).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 760) {
      const toggle = page.getByRole('button', { name: 'Open menu' });
      await toggle.click();
      const menu = page.getByRole('navigation', { name: 'Mobile marketing' });
      await expect(menu.getByRole('link', { name: 'Developers' })).toBeVisible();
      expect((await new AxeBuilder({ page }).include('#marketing-mobile-nav').analyze()).violations).toEqual(
        [],
      );
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(menu).toBeHidden();
      const header = await page.locator('.mkt-header').boundingBox();
      const badge = await page.locator('.trace-kicker').boundingBox();
      expect(badge!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    }
  });
}
test('keyboard selects delivery states with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const replay = page.getByRole('button', { name: 'Replay', exact: true });
  await replay.focus();
  await page.keyboard.press('Space');
  await expect(replay).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Replay queued', { exact: true })).toBeVisible();
  expect(await page.locator('.phase-copy').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
});

test('developer guide is readable without the payments API', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: 'Your first test payment.' })).toBeVisible();
  await expect(page.getByText('pnpm demo:seed', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /OpenAPI schema/ })).toHaveAttribute(
    'href',
    '/v1/openapi.json',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [1440, 360]) {
  test(`self-host and pilot options are honest at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto('/pricing'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Self-host the complete demo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discuss a pilot' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Run the demo', exact: true })).toHaveAttribute(
      'href',
      '/product#demo',
    );
    await expect(page.getByRole('link', { name: 'Contact the builder' })).toHaveAttribute('href', '/contact');
    await expect(page.getByText(/Starter|Growth|₦45,000|₦180,000/)).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test(`product deep-dive explains every shipped capability at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto('/product'))?.status()).toBe(200);
    await expect(page.locator('.product-sheet')).toHaveCount(6);
    for (const id of [
      'idempotency',
      'verification',
      'webhooks',
      'delivery',
      'ledger',
      'reconciliation',
      'refunds',
      'x402',
      'operations',
      'merchant-api',
    ]) {
      await expect(page.locator(`#${id}`).getByRole('heading').first()).toBeVisible();
    }
    if (width === 1440)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(4500);
    for (const summary of await page.locator('details.sheet-detail summary').all()) await summary.click();
    for (const proof of [
      'Idempotent-Replayed: true',
      '409 idempotency_key_reuse',
      'charge.success',
      'idempotency_ref',
      'amount_mismatch',
      '422 refund_exceeds_refundable',
      'PAYMENT-RESPONSE',
      '402 payment_already_used',
    ]) {
      await expect(page.getByText(proof, { exact: false }).first()).toBeVisible();
    }
    await expect(page.locator('#webhooks img')).toHaveAttribute('src', /settlement-dlq/);
    await expect(page.locator('#reconciliation img')).toHaveAttribute('src', /settlement-reconciliation/);
    await expect(page.locator('#refunds')).toContainText('payment-row lock');
    await expect(page.locator('#x402 a').first()).toHaveAttribute('href', '/x402');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('public OpenAPI link serves the actual merchant contract without a session', async ({ request }) => {
  const response = await request.get('/v1/openapi.json');
  expect(response.status()).toBe(200);
  const schema = await response.json();
  expect(schema.openapi).toBe('3.0.3');
  expect(schema.paths['/v1/payments'].post).toBeDefined();
  expect(schema.paths['/v1/x402/routes']).toBeDefined();
  const backend = await request.get('http://localhost:4000/v1/openapi.json');
  expect(schema).toEqual(await backend.json());
});

test('contact validates a local draft and never claims to send it', async ({ page, context }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Prepare email draft' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByLabel('Your name').fill('  ');
  await page.getByLabel('Email address', { exact: true }).fill('ada@example.com');
  await page.getByLabel('Your message', { exact: true }).fill('                    ');
  await page.getByRole('button', { name: 'Prepare email draft' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('at least 20 characters');
  await page.getByLabel('Your name').fill('Ada Okafor');
  await page
    .getByLabel('Your message', { exact: true })
    .fill('We are testing a local integration & webhook replay.');
  await page.getByRole('button', { name: 'Prepare email draft' }).click();
  await expect(page.getByRole('status')).toContainText('Your draft is ready.');
  const href = await page.getByRole('link', { name: 'Open email app' }).getAttribute('href');
  expect(href).toContain('mailto:obarodestinez@gmail.com?subject=');
  expect(new URL(href!).searchParams.get('body')).toBe(
    'Name: Ada Okafor\nReply email: ada@example.com\n\nWe are testing a local integration & webhook replay.',
  );
  await expect(page.getByText('No message has been sent by Paybox.')).toBeVisible();
  expect(posts).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const route of ['/security', '/about', '/contact', '/changelog']) {
  test(`${route} is public and usable at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    expect((await page.goto(route))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `.local/marketing-${route.slice(1)}-360.png`, fullPage: true });
  });
}

for (const width of [1440, 360]) {
  test(`privacy is accessible at ${width}px without a session`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto('/privacy'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');
    await expect(page.getByText(/Sessions expire after eight hours/)).toBeVisible();
    await expect(page.getByText(/There is no automatic short-term deletion schedule/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/marketing-privacy-${width}.png`, fullPage: true });
  });
}

test('every footer legal link opens a public 200 page', async ({ page, request }) => {
  for (const [label, href] of [
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
    ['Cookies', '/cookies'],
    ['Acceptable use', '/acceptable-use'],
  ] as const) {
    await page.goto('/');
    const link = page.getByRole('contentinfo').getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', href);
    expect((await request.get(href!)).status()).toBe(200);
    await link.click();
    await expect(page).toHaveURL(href!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('.sidebar')).toHaveCount(0);
  }
});

test('public routes have unique metadata and one headline', async ({ page }) => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  const routes = [
    '/',
    '/product',
    '/pricing',
    '/developers',
    '/security',
    '/about',
    '/contact',
    '/changelog',
    '/privacy',
    '/terms',
    '/cookies',
    '/acceptable-use',
  ];
  for (const route of routes) {
    expect((await page.goto(route))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const title = await page.title();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(title).toContain('Paybox');
    expect(description?.length).toBeGreaterThan(40);
    titles.add(title);
    descriptions.add(description!);
  }
  expect(titles.size).toBe(routes.length);
  expect(descriptions.size).toBe(routes.length);
});

test('missing pages offer a useful public 404', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.goto('/missing-payment-reference'))?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found | Paybox');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page is off the trail.');
  await expect(page.getByRole('link', { name: 'Back to Paybox' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Looking for operations? Sign in' })).toHaveAttribute(
    'href',
    '/login',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
