import { test } from '@playwright/test';
import * as fs from 'node:fs';
import { ALL_WOS, AUTH_FILE, BASELINE_FILE, RESULTS_DIR, log, openWorkOrders, readRow, shot, tableRow } from './helpers';

test.use({ storageState: AUTH_FILE });

// Read-only: records the baseline of the four WOs before anything is changed.
test('record baseline (read-only)', async ({ page }) => {
  await openWorkOrders(page);
  const baseline: Record<string, unknown> = {};
  for (const wonum of ALL_WOS) {
    const row = await readRow(page, wonum);
    if (row.drafts) throw new Error(`${wonum} already has a draft`);
    baseline[wonum] = row;
    log(`baseline ${JSON.stringify(row)}`);
    await tableRow(page, wonum).scrollIntoViewIfNeeded();
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (!fs.existsSync(BASELINE_FILE)) fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 1));
  await shot(page, '02-baseline');
});
