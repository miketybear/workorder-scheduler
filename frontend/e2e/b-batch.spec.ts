import { expect, test } from '@playwright/test';
import { AUTH_FILE, BATCH_WOS, log, openWorkOrders, readRow, shot, tableRow } from './helpers';

test.use({ storageState: AUTH_FILE });
test.setTimeout(900_000);

// Scenario B: Batch of 3 WOs:
// - select 3 WOs
// - group edit (date/PIC/duration from the allowed PIC list)
// - undo once (test "Hủy thay đổi" to undo the edits, verify undone, then re-apply and save)
// - save group draft ("Lưu 3 nháp")
// - close and reopen "Gửi N WO" (auto reconcile)
// - upload all
// - check per-WO results and summary counts, reload and confirm values.
test('B. batch of 3: select, group edit, undo, save, auto reconcile, upload, verify', async ({ page }) => {
  await openWorkOrders(page);

  // Check no drafts on the 3 WOs
  for (const wonum of BATCH_WOS) {
    const r = await readRow(page, wonum);
    expect(r.drafts).toBe(false);
  }

  // 1. Select the 3 WOs
  for (const wonum of BATCH_WOS) {
    const row = tableRow(page, wonum);
    const cb = row.locator('input[type="checkbox"]').first();
    await cb.check();
  }
  await shot(page, 'B1-selected-3-wos');

  const firstWonum = BATCH_WOS[0];
  const firstRow = tableRow(page, firstWonum);

  // Focus table or hover over table to ensure crew is loaded
  await page.getByRole('region', { name: 'WO từ Maximo' }).hover();
  await page.waitForTimeout(500);

  // 2. Group edit:
  // Edit Duration on the first WO and fill down with Ctrl+D
  const durTd = firstRow.locator('td[data-nav="estdur"]');
  const durInput = durTd.locator('input');
  await durInput.fill('8.0');
  await durTd.press('Control+d');
  await page.waitForTimeout(500);

  // Edit Scheduled Start on first WO and fill down with Ctrl+D
  const startTd = firstRow.locator('td[data-nav="schedstart"]');
  const startInput = startTd.locator('input');
  await startInput.fill('06/10/2026 06:30');
  await startInput.press('Enter');
  await page.waitForTimeout(500);
  await startTd.press('Control+d');
  await page.waitForTimeout(500);

  // Select PIC on first WO and fill down with Ctrl+D
  const picTd = firstRow.locator('td[data-nav="pic"]');
  const picSelect = picTd.locator('select');
  await picSelect.selectOption('CUONGLV');
  await picTd.press('Control+d');
  await page.waitForTimeout(500);

  await shot(page, 'B2-group-edited');
  log('B group edited 3 WOs');

  // Verify the bulk bar shows 3 WO có thay đổi chưa lưu
  const stagedBar = page.getByRole('region', { name: 'Thay đổi trong bảng' });
  await expect(stagedBar).toContainText('3 WO có thay đổi chưa lưu');

  // 3. Undo once: click "Hủy thay đổi"
  const discardBtn = stagedBar.getByRole('button', { name: 'Hủy thay đổi' });
  await discardBtn.click();
  await shot(page, 'B3-undone');
  log('B undone once via Hủy thay đổi');
  await expect(page.getByRole('region', { name: 'Thay đổi trong bảng' })).toHaveCount(0);

  // Re-apply group edits for saving
  for (const wonum of BATCH_WOS) {
    const row = tableRow(page, wonum);
    await row.locator('input[type="checkbox"]').first().check();
  }
  await durInput.fill('8.0');
  await durTd.press('Control+d');
  await page.waitForTimeout(500);

  await startInput.fill('06/10/2026 06:30');
  await startInput.press('Enter');
  await page.waitForTimeout(500);
  await startTd.press('Control+d');
  await page.waitForTimeout(500);

  await picSelect.selectOption('CUONGLV');
  await picTd.press('Control+d');
  await page.waitForTimeout(500);

  // 4. Save group draft: click "Lưu 3 nháp"
  const saveBtn = page.getByRole('button', { name: 'Lưu 3 nháp' });
  await saveBtn.click();
  await expect(page.getByText(/Đã lưu nháp cho 3 WO/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'B4-saved-drafts');
  log('B saved 3 drafts');

  // Check the send bar appears: "3 WO có nháp chưa gửi", button "Gửi 3 WO lên Maximo"
  const sendBar = page.getByRole('region', { name: 'Gửi WO có nháp lên Maximo' });
  await expect(sendBar).toBeVisible();
  const sendBtn = sendBar.getByRole('button', { name: 'Gửi 3 WO lên Maximo' });
  await expect(sendBtn).toBeVisible();

  // 5. Open "Gửi N WO", close and reopen (auto reconcile)
  await sendBtn.click();
  const sendDialog = page.getByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  await expect(sendDialog).toBeVisible({ timeout: 60_000 });
  // Wait for auto preview/reconcile
  await expect(sendDialog.getByText(/tất cả khớp với Maximo/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'B5-send-dialog-opened-1');

  // Close dialog
  await sendDialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(sendDialog).toHaveCount(0);
  await shot(page, 'B6-send-dialog-closed');

  // Reopen
  await sendBar.getByRole('button', { name: 'Gửi 3 WO lên Maximo' }).click();
  await expect(sendDialog).toBeVisible({ timeout: 60_000 });
  // Auto reconcile re-runs
  await expect(sendDialog.getByText(/tất cả khớp với Maximo/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'B7-send-dialog-reopened-reconciled');
  log('B auto reconciled upon reopen');

  // 6. Upload all
  const uploadAllBtn = sendDialog.getByRole('button', { name: /Upload toàn bộ nhóm/ });
  await expect(uploadAllBtn).toBeEnabled();
  await uploadAllBtn.click();
  await shot(page, 'B8-uploading-batch');

  // 7. Check per-WO results and summary counts
  // Wait for results: "Hoàn tất 3"
  await expect(sendDialog.getByText(/Hoàn tất 3/)).toBeVisible({ timeout: 240_000 });
  await shot(page, 'B9-batch-upload-confirmed');
  log('B batch upload confirmed for all 3 WOs');

  // Close dialog
  await sendDialog.getByRole('button', { name: 'Đóng' }).click();

  // Reload page and confirm values
  await page.reload();
  await openWorkOrders(page);
  await shot(page, 'B10-after-reload');

  for (const wonum of BATCH_WOS) {
    const after = await readRow(page, wonum);
    log(`B after reload ${wonum}: ${JSON.stringify(after)}`);
    expect(after.drafts).toBe(false);
    expect(after.start).toBe('06/10/2026 06:30');
    expect(after.pic).toBe('CUONGLV');
    expect(parseFloat(after.estdur)).toBe(8.0);
  }
});
