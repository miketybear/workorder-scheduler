# Nhóm 100/200 WO và bàn phím — 2026-10-07

Đã kiểm chứng thao tác nhóm lớn bằng dữ liệu synthetic, PostgreSQL test riêng và
Chromium local. Nháp không ghi Maximo; kết quả này chưa thay nghiệm thu monthly-load live,
10 planner đồng thời, screen reader hoặc performance SLO trên staging.

## Phạm vi và lỗi đã sửa

- Nhóm 100 và 200 WO: áp Start/PIC cho nhóm, sửa duration riêng, Finish suy ra đúng,
  Reset dòng/Undo, dán TSV CRLF hợp lệ hoặc lỗi PIC cuối nhóm, preview, lưu và mở lại.
  Paste lỗi không áp một phần; ô trống giữ nguyên. Định danh gồm site/WOID trong scope.
- Lỗi baseline, phiên bản nháp, thu hồi quyền và phản hồi prepare đến muộn được kiểm tra.
  Xung đột phiên bản HTTP 409 nay khóa lưu lại và giữ các sửa đổi để đối chiếu.
- Panel đơn, nhóm và chooser nhận focus khi mở; Tab/Shift+Tab quay vòng qua control
  khả dụng, bỏ qua disabled/hidden và nội dung details đóng. Đóng panel trả focus về
  control đã mở nó; chuyển chooser sang editor giữ đúng control gốc.
  Nếu mở WO khác từ nền khi panel còn mở, đóng panel trả focus về WO vừa chọn.
- Focus rơi về body khi nút Save bị vô hiệu hóa được đưa lại panel sau khi browser
  hoàn tất chuyển focus. Escape sau lưu hoạt động; Escape với edits chưa lưu giữ
  cơ chế xác nhận bỏ sửa đổi. Panel ẩn ở route khác gỡ xử lý Tab và không giành focus.

Nguồn regression: [large batch UI tests](../frontend/src/scheduling/BatchPlanner.large.test.tsx),
[focus tests](../frontend/src/scheduling/usePanelFocus.test.tsx),
[batch API tests](../backend/tests/test_batch_api.py),
[Chromium harness](../frontend/scripts/verify-monthly-keyboard.mjs).

## Bằng chứng

- Backend **244 tests** qua: 136 fast + 108 PostgreSQL, Ruff check/format qua trên Windows.
  Tám ca mới chạy 100/200 WO cho success, stale baseline, PIC không hợp lệ và grant
  bị thu hồi giữa I/O. Kiểm tra số Draft/DraftItem/receipt trong DB để chứng minh không
  lưu một phần; success restore/update/replay, stale version và non-owner denial qua.
  Upstream chỉ là mock GET; prepare đọc crew một lần và tối đa 4 detail GET đồng thời.
- Frontend **151 tests / 14 files** qua; ESLint, TypeScript và production build qua.
- Chromium **154.0.8037.98**, viewport **1600×1000**, chạy bản production build local
  với toàn bộ API giả và chặn request ra origin khác: 27 API requests, không page error
  hoặc request ngoài harness. Single/batch/chooser: Tab/Shift+Tab/Enter/Escape/Space,
  dirty close cancel/accept, focus return; nhóm lưu/mở lại đúng 100/200 thành viên.
  Settings: radio ArrowDown, Tab tới Save và Enter lưu connection giả qua.
- Chuyển Settings khi nhóm còn edits rồi quay về giữ duration/PIC và nhận lại focus.
  Case giữ edits này dùng click link Settings; các mốc kiểm tra phím dùng locator focus
  rồi phát phím native. Chưa khẳng định đã Tab tuần tự qua mọi ô hoặc keyboard-only
  toàn ứng dụng, và không dùng API giả làm bằng chứng policy backend.

Một lượt đo từ harness đã lưu trong repository:

| Số WO | Mở nhóm | Áp TSV | Dựng preview | Lưu API giả |
| --- | ---: | ---: | ---: | ---: |
| 100 | 91 ms | 53 ms | 67 ms | 152 ms |
| 200 | 146 ms | 101 ms | 155 ms | 286 ms |

Số đo gồm automation overhead, không phải benchmark thống kê hoặc độ trễ Maximo/DB thật.
Preview chứa lần lượt 400/800 thay đổi, bao gồm Finish suy ra. Screenshot panel 200 WO
và JSON kết quả được giữ local trong `.cache/monthly-keyboard/`, không chứa dữ liệu thật.

## Chạy lại

Từ frontend chạy `npm test`, `npm run lint` và `npm run build`. Backend chạy
`uv run --frozen pytest --run-db-tests` khi PostgreSQL test localhost:55432 sẵn sàng,
theo [database tests](database-tests.md).

Harness yêu cầu Chrome và Playwright đã cài. Từ root repository:

```powershell
node frontend/scripts/verify-monthly-keyboard.mjs <absolute-path-to-playwright-index.mjs>
```

Nếu Playwright đã có trong module resolution, có thể bỏ đối số. Harness không cài
package/browser, không đọc credential hoặc `.env`, tự mở server loopback và đóng browser/server
sau kiểm tra. Trong lần này dùng Playwright bundled của Codex, không thêm dependency.
Harness chưa được chạy tự động trong GitHub CI; regression Vitest và PostgreSQL nằm trong CI.

## Phần còn lại

- Nghiệm thu hàng trăm WO thật và planner workflow; kiểm thử mạng chậm, nhiều phiên,
  độ trễ prepare/save/restore với Maximo, đặc biệt trang có nhiều nhóm.
- Keyboard-only từ đầu tới cuối bằng Tab, screen reader, zoom/high contrast và nhiều
  browser; các ca focus/phím đã qua chỉ được tick trong đúng phạm vi synthetic ở todos.
- Upload/reconciliation, ETag/conditional writes và capacity/ca làm vẫn là task riêng.
