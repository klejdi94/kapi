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
