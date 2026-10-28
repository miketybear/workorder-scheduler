import { expect, test } from '@playwright/test';
import { AUTH_FILE, SINGLE_WO, loadBaseline, log, openWorkOrders, readRow, setDateTimeText, shot, tableRow } from './helpers';

test.use({ storageState: AUTH_FILE });
test.setTimeout(900_000);

// Scenario D (part 1): restore the single-flow WO to its recorded baseline through the same upload flow.
test('D. restore single WO to baseline', async ({ page }) => {
  const baseline = loadBaseline()[SINGLE_WO];
  await openWorkOrders(page);
  expect((await readRow(page, SINGLE_WO)).drafts).toBe(false);

  await page.getByRole('button', { name: SINGLE_WO, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa nháp' });
  await expect(dialog.getByRole('heading', { name: SINGLE_WO })).toBeVisible();
  await dialog.getByLabel('Est. Duration').fill(String(parseFloat(baseline.estdur)));
  await setDateTimeText(page, 'Scheduled Start', baseline.start, dialog);
  await dialog.getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(dialog.getByText('Đã lưu nháp trên server. Maximo chưa thay đổi.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Đối chiếu với Maximo trước upload' }).click();
  await expect(dialog.getByText(/tất cả khớp với Maximo/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'D1-single-restore-preview');
  log(`D single preview: ${(await dialog.getByRole('table', { name: 'Thay đổi sẽ ghi' }).innerText()).replace(/\s+/g, ' ')}`);
  await dialog.getByRole('button', { name: 'Upload lên Onshore test' }).click();
  const done = page.getByText(/Đã xác nhận 1 WO trong Maximo/);
  const bad = page.getByText(/Chưa xác định|Xung đột|Thất bại|Kiểm tra trạng thái/).first();
  await expect(done.or(bad)).toBeVisible({ timeout: 180_000 });
  if (!(await done.count())) { log('D single STOP: result not confirmed'); throw new Error('restore not confirmed'); }
  await page.reload();
  await openWorkOrders(page);
  const after = await readRow(page, SINGLE_WO);
  await shot(page, 'D2-single-restored');
  log(`D single restored: ${JSON.stringify(after)}`);
  expect(after.start).toBe(baseline.start);
  expect(parseFloat(after.estdur)).toBe(parseFloat(baseline.estdur));
  expect(after.finish).toBe(baseline.finish);
  expect(after.pic).toBe(baseline.pic);
  await expect(tableRow(page, SINGLE_WO)).toHaveCount(1);
});
