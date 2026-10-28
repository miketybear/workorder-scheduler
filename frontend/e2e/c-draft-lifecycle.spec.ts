import { expect, test } from '@playwright/test';
import { AUTH_FILE, BATCH_WOS, loadBaseline, log, openWorkOrders, readRow, shot, tableRow } from './helpers';

test.use({ storageState: AUTH_FILE });
test.setTimeout(600_000);

// Scenario C: create a draft on a batch WO and delete it without uploading; Maximo must stay unchanged.
test('C. draft lifecycle: create and delete without upload', async ({ page }) => {
  const wonum = BATCH_WOS[0];
  const baseline = loadBaseline()[wonum];
  await openWorkOrders(page);
  await page.getByRole('button', { name: wonum, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa nháp' });
  await expect(dialog.getByRole('heading', { name: wonum })).toBeVisible();
  await dialog.getByLabel('Est. Duration').fill('7');
  await dialog.getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(dialog.getByText('Đã lưu nháp trên server. Maximo chưa thay đổi.')).toBeVisible();
  await shot(page, 'C1-draft-created');
  await dialog.getByRole('button', { name: 'Xóa nháp' }).click();
  await shot(page, 'C2-confirm-delete');
  await dialog.getByRole('button', { name: 'Xác nhận xóa nháp' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tableRow(page, wonum).getByText('Nháp', { exact: true })).toHaveCount(0);
  await page.reload();
  await openWorkOrders(page);
  const after = await readRow(page, wonum);
  await shot(page, 'C3-after-delete');
  log(`C after delete: ${JSON.stringify(after)}`);
  expect(after.drafts).toBe(false);
  expect(after.estdur).toBe(baseline.estdur);
  expect(after.start).toBe(baseline.start);
  expect(after.finish).toBe(baseline.finish);
  expect(after.pic).toBe(baseline.pic);
});
