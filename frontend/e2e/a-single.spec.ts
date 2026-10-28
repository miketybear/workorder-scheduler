import { expect, test } from '@playwright/test';
import { AUTH_FILE, SINGLE_WO, loadBaseline, log, openWorkOrders, readRow, setDateTimeText, shot, tableRow } from './helpers';

test.use({ storageState: AUTH_FILE });
test.setTimeout(900_000);

const NEW_DUR = '21';
const NEW_START = '05/10/2026 06:30';

// Scenario A: single WO, real upload to Onshore TEST.
test('A. single WO: draft, restore, preview, upload, verify', async ({ page }) => {
  const baseline = loadBaseline()[SINGLE_WO];
  await openWorkOrders(page);
  expect((await readRow(page, SINGLE_WO)).drafts).toBe(false);

  await page.getByRole('button', { name: SINGLE_WO, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa nháp' });
  await expect(dialog.getByRole('heading', { name: SINGLE_WO })).toBeVisible();
  await expect(dialog.getByLabel('Est. Duration')).toBeEnabled();
  await shot(page, 'A1-before-draft');
  const states = {
    saveDraftDisabled: await dialog.getByRole('button', { name: 'Lưu nháp' }).isDisabled(),
    resetDisabled: await dialog.getByRole('button', { name: 'Reset về baseline' }).isDisabled(),
    deleteVisible: await dialog.getByRole('button', { name: 'Xóa nháp' }).count(),
    uploadSectionVisible: await dialog.getByLabel('Upload nháp đã lưu').count(),
  };
  log(`A before draft: ${JSON.stringify(states)}`);

  await dialog.getByLabel('Est. Duration').fill(NEW_DUR);
  await setDateTimeText(page, 'Scheduled Start', NEW_START, dialog);
  await shot(page, 'A2-edited');
  await dialog.getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(dialog.getByText('Đã lưu nháp trên server. Maximo chưa thay đổi.')).toBeVisible();
  await shot(page, 'A3-draft-saved');
  log('A draft saved');

  // Close and reopen: the draft must be restored.
  await dialog.getByRole('button', { name: 'Đóng nháp' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: SINGLE_WO, exact: true }).click();
  await expect(dialog.getByLabel('Est. Duration')).toHaveValue(NEW_DUR);
  await expect(dialog.getByText(/Nháp đã lưu/)).toBeVisible();
  await shot(page, 'A4-draft-restored');

  // Preview against Maximo.
  await dialog.getByRole('button', { name: 'Đối chiếu với Maximo trước upload' }).click();
  await expect(dialog.getByText(/tất cả khớp với Maximo/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'A5-preview');
  log(`A preview: ${(await dialog.getByRole('table', { name: 'Thay đổi sẽ ghi' }).innerText()).replace(/\s+/g, ' ')}`);

  // Upload; watch whether Delete is disabled while it is in progress.
  const uploadButton = dialog.getByRole('button', { name: 'Upload lên Onshore test' });
  await uploadButton.click();
  let deleteDisabledDuringUpload: boolean | null = null;
  for (let i = 0; i < 40; i++) {
    const del = dialog.getByRole('button', { name: 'Xóa nháp' });
    if (await del.count()) { deleteDisabledDuringUpload = await del.isDisabled(); break; }
    if (await page.getByText(/Đã xác nhận 1 WO trong Maximo/).count()) break;
    await page.waitForTimeout(100);
  }
  log(`A delete disabled during upload: ${deleteDisabledDuringUpload}`);
  await shot(page, 'A6-uploading');

  const done = page.getByText(/Đã xác nhận 1 WO trong Maximo/);
  const bad = page.getByText(/Chưa xác định|Xung đột|Thất bại|Kiểm tra trạng thái/).first();
  await expect(done.or(bad)).toBeVisible({ timeout: 180_000 });
  await shot(page, 'A7-result');
  if (!(await done.count())) {
    log('A STOP: result unknown/conflict/failed; not retrying');
    throw new Error('A upload result not confirmed; stopped');
  }
  log('A upload confirmed');
  await expect(tableRow(page, SINGLE_WO).getByText('Nháp', { exact: true })).toHaveCount(0);

  await page.reload();
  await openWorkOrders(page);
  const after = await readRow(page, SINGLE_WO);
  await shot(page, 'A8-after-reload');
  log(`A after reload: ${JSON.stringify(after)} (baseline ${JSON.stringify(baseline)})`);
  expect(after.estdur).toMatch(/^21(\.0)?$/);
  expect(after.start).toBe(NEW_START);
  expect(after.drafts).toBe(false);
});
