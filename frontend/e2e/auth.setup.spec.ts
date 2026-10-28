import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const AUTH_DIR = path.resolve(import.meta.dirname, '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'state.json');
const RESULTS_DIR = path.resolve(import.meta.dirname, 'results');

test('Wait for Entra ID sign-in and save storage state', async ({ browser }) => {
  test.setTimeout(620_000);
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : {}),
  });
  const page = await context.newPage();
  await page.goto('https://localhost:5173/');

  const deadline = Date.now() + 600_000;
  let signedIn = false;
  while (Date.now() < deadline) {
    try {
      const url = page.url();
      if (url.startsWith('https://localhost:5173') || url.startsWith('https://127.0.0.1:5173')) {
        const res = await page.evaluate(async () => {
          const r = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) return null;
          return r.json();
        });
        if (res && res.user && Array.isArray(res.grants) && res.grants.length > 0) {
          signedIn = true;
          break;
        }
      }
    } catch {
      // Navigating through Microsoft login redirect
    }
    await page.waitForTimeout(1000);
  }

  expect(signedIn, 'Human must sign in within 10 minutes').toBe(true);

  await page.goto('https://localhost:5173/work-orders');
  const envChip = page.locator('[data-env]').first();
  await expect(envChip).toBeVisible({ timeout: 30_000 });
  const envText = (await envChip.textContent())?.trim() ?? '';
  if (envText !== 'Onshore · TEST') {
    throw new Error(`ABORT: Environment chip shows "${envText}", expected "Onshore · TEST"`);
  }

  await page.screenshot({ path: path.join(RESULTS_DIR, '00-signed-in-onshore-test.png'), fullPage: true });
  await context.storageState({ path: AUTH_FILE });
  await context.close();
});
