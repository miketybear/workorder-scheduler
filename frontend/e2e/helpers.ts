import { expect, type Page, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AUTH_FILE = path.resolve(import.meta.dirname, '.auth', 'state.json');
export const RESULTS_DIR = path.resolve(import.meta.dirname, 'results');
export const BASELINE_FILE = path.join(RESULTS_DIR, 'baseline.json');
export const LOG_FILE = path.join(RESULTS_DIR, 'e2e-log.md');

// WOs are chosen per run on Onshore TEST (not PM/CFT, no open draft or unresolved upload).
export const SINGLE_WO = process.env.E2E_SINGLE_WO?.trim() ?? '';
export const BATCH_WOS = (process.env.E2E_BATCH_WOS ?? '').split(',').map((wonum) => wonum.trim()).filter(Boolean);
export const ALL_WOS = [SINGLE_WO, ...BATCH_WOS];

export type RowValues = { wonum: string; status: string; estdur: string; start: string; finish: string; pic: string; drafts: boolean };

export function log(line: string) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `- ${new Date().toISOString()} ${line}\n`);
}

export async function shot(page: Page, name: string) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(RESULTS_DIR, `${name}.png`), fullPage: false });
}

export async function openWorkOrders(page: Page) {
  if (!SINGLE_WO || !BATCH_WOS.length) throw new Error('Set E2E_SINGLE_WO and E2E_BATCH_WOS before running the live E2E suite');
  await page.goto('/work-orders');
  // Abort unless the UI says Onshore TEST.
  await expect(page.locator('[data-env]').first()).toHaveText('Onshore · TEST', { timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'WO từ Maximo' })).toBeVisible({ timeout: 240_000 });
}

export function tableRow(page: Page, wonum: string): Locator {
  return page.getByRole('region', { name: 'WO từ Maximo' }).locator('tbody tr', {
    has: page.getByRole('button', { name: wonum, exact: true }),
  });
}

export async function readRow(page: Page, wonum: string): Promise<RowValues> {
  const row = tableRow(page, wonum);
  await expect(row).toHaveCount(1);
  const estdur = await row.getByLabel(/Est\. Duration/).inputValue();
  const start = await row.getByLabel(/Scheduled Start \(nhập\)|Scheduled Start.*\(nhập\)/).first().inputValue();
  const picSel = row.getByLabel(/Assigned PIC/);
  const pic = await picSel.evaluate((el) => (el as HTMLSelectElement).value);
  const cells = row.locator('td');
  const finishText = (await cells.nth(5).textContent()) ?? '';
  const finish = finishText.includes('→') ? finishText.split('→')[1].replace(/Nháp|Giờ bắt đầu.*/g, '').trim() : '';
  const status = ((await cells.nth(3).textContent()) ?? '').trim();
  const drafts = ((await cells.nth(1).textContent()) ?? '').includes('Nháp');
  return { wonum, status, estdur, start, finish, pic, drafts };
}

export function loadBaseline(): Record<string, RowValues> {
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

export async function setDateTimeText(page: Page, label: string, text: string, scope?: Locator) {
  const root = scope ?? page;
  const input = root.getByLabel(`${label} (nhập)`);
  await input.fill(text);
  await input.press('Enter');
}
