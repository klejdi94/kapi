import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Getting started')).toBeVisible();
});

test('opens a saved request from the sidebar', async ({ page }) => {
  await page.getByText('Simple GET', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Simple GET');
});

test('shows the request editor tabs, including Scripts', async ({ page }) => {
  await page.getByText('Simple GET', { exact: true }).click();
  for (const tab of ['Params', 'Body', 'Headers', 'Auth', 'Scripts', 'Settings']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${tab}\\b`) }).first()).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Scripts' }).first().click();
  await expect(page.locator('.cm-editor').first()).toBeVisible();
});

test('opens the command palette from the keyboard', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder(/search|command|type/i).first()).toBeVisible();
});

test('renders without errors in the console', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    // Outside the desktop shell, Tauri's bridge isn't there — that's expected here.
    if (m.type() === 'error' && !/__TAURI|transformCallback|invoke/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!/__TAURI|transformCallback|invoke/.test(e.message)) problems.push(e.message);
  });
  await page.reload();
  await expect(page.getByText('Getting started')).toBeVisible();
  expect(problems).toEqual([]);
});

test('runs a short load test from the Runner', async ({ page }) => {
  // The collection page has the Run button; clicking the collection name opens it.
  await page.getByText('Getting started', { exact: true }).first().click();
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await page.getByRole('tab', { name: 'Load test' }).click();
  await page.getByRole('tab', { name: 'For N iterations' }).click();
  await page.getByLabel('Virtual users').fill('2');
  await page.getByLabel('Iterations / user').fill('1');
  await page.getByRole('button', { name: 'Start load test' }).click();
  // Outside the desktop shell the requests may fail (CORS, no network) —
  // what matters here is that every one of them is accounted for.
  await expect(page.getByRole('button', { name: 'New test' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Requests', { exact: true })).toBeVisible();
  await expect(page.getByText('Req/s', { exact: true })).toBeVisible();
});

test('creates a monitor and runs it now', async ({ page }) => {
  await page.getByText('Getting started', { exact: true }).first().click();
  await page.getByRole('tab', { name: /^Monitors/ }).click();
  await page.getByRole('button', { name: 'New monitor' }).click();
  await expect(page.getByLabel('Monitor name')).toHaveValue('Getting started health');
  await page.getByRole('button', { name: 'Run now' }).click();
  // Outside the desktop shell the requests may not get through; either way the run is recorded.
  await expect(page.getByText(/last run \d+s ago/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Run in CI…' }).click();
  await expect(page.getByText(/npx -y kapi run getting-started\.kapi\.json/)).toBeVisible();
  await page.getByRole('tab', { name: /^History/ }).click();
  await expect(page.getByText('monitor', { exact: true }).first()).toBeVisible();
});

test('compares a request across environments', async ({ page }) => {
  await page.getByText('Untitled request', { exact: true }).click();
  const url = page.getByPlaceholder(/paste a cURL command/);
  await url.fill('http://127.0.0.1:18090/echo?token={{token}}');
  await page.getByRole('button', { name: 'Compare across environments' }).click();
  await page.getByRole('combobox', { name: 'Environment B' }).selectOption({ label: 'No environment' });
  await page.getByRole('button', { name: 'Send both' }).click();
  // With "Local", {{token}} resolves; without an environment it doesn't — so the echoed URL differs.
  await expect(page.getByRole('cell', { name: '$.url' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('"/echo?token=a-token-httpbin-will-echo-back"')).toBeVisible();
});
