# API Route WO đến Tech PIC (hợp đồng cho frontend)

Ngày: 2026-10-23. Backend: `backend/app/workflow_route/`. Thiết kế: [workflow-route-design.md](workflow-route-design.md).
Chỉ hoạt động trên kết nối Onshore **test** của ứng dụng development/test; ngoài ra `status.enabled=false`.

## Quy ước chung

- Tiền tố `/api/workflow`. Cookie phiên Entra như các API khác. Mọi POST/DELETE gửi header `X-CSRF-Token`
  (preview cũng là POST nên cần CSRF). Mọi phản hồi có `Cache-Control: no-store`.
- `connection_id` (UUID) và `discipline` luôn là giá trị đã được cấp quyền cho người dùng. Quyền route = quyền Planner **ghi**
  của kết nối/discipline đó (không có quyền riêng). Người chỉ có quyền đọc, hoặc sai discipline, nhận `404` chuỗi
  (`"Connection or discipline not found"` / `"Work order not found"`), giống mọi API WO khác.
- Lỗi có mã dạng `{"detail": {"code": "...", ...}}`. Lỗi chuỗi (`401 "Sign-in required"`, `403 "Invalid CSRF token"`,
  `404`, `502 {"detail":"..."}`) giống các API còn lại. **Không dùng 401 cho lỗi đăng nhập Maximo** (401 = hết phiên Entra).
- `workorder_id` là chuỗi số (`^[0-9]{1,30}$`), `site_id` chuỗi 1-50 ký tự. Tối đa 20 WO mỗi preview/route, không trùng.
- Mật khẩu chỉ gửi ở `POST /route/session`, không bao giờ xuất hiện trong phản hồi, log hay audit (kể cả lỗi 422).

## 1. Trạng thái tính năng

`GET /api/workflow/route/status?connection_id=<uuid>&discipline=<code>`

```json
{ "enabled": true, "can_route": true, "personid": "ENISUP",
  "session": { "active": false, "expires_at": null } }
```

- `enabled`: kết nối + discipline có tài khoản position được cấu hình và là kết nối test (không cần cấu hình revision); revision BD_WO đang `active` được server tự xác định khi chạy (tối đa vài chục giây bộ nhớ đệm), nên revision mới được kích hoạt sẽ tự được nhận. `can_route`: `enabled` và người dùng có quyền
  Planner ghi. `personid` (tên tài khoản position, hiển thị cố định trong ô đăng nhập) chỉ có khi `can_route`.
- `session.active`: server đang giữ phiên Maximo của tài khoản position cho phiên Entra này; `expires_at` (ISO 8601) = lúc
  phiên Entra hết hạn. Phiên bị bỏ khi logout, hết phiên Entra, đổi kết nối/discipline, khởi động lại backend, hoặc Maximo trả 401.
- Ẩn nút Route khi `can_route=false`. Lỗi: `401` chưa đăng nhập, `404` không có grant.

## 2. Phiên tài khoản position

`POST /api/workflow/route/session`

```json
{ "connection_id": "…", "discipline": "E&I", "username": "ENISUP", "password": "…" }
```

- `username` (không phân biệt hoa thường) phải bằng `personid` ở trên, nếu không `422 username_mismatch` (không gọi Maximo).
- Thành công `200`: `{ "personid": "ENISUP", "session": { "active": true, "expires_at": "2026-10-23T18:00:00+00:00" } }`.
- Lỗi:
  - `422 {"code":"maximo_login_failed","remaining_attempts":2}` sai mật khẩu. Giới hạn: **3 lần sai / 5 phút / người dùng**
    và **10 lần sai / giờ / tài khoản position** (dùng chung). Đăng nhập thành công không tốn lượt.
  - `429 {"code":"login_rate_limited","retry_after_seconds":N}` (kèm header `Retry-After`): hết lượt, kể cả khi mật khẩu đúng.
  - `422 {"code":"invalid_request"}` body sai (không lặp lại dữ liệu đã gửi).
  - `409 {"code":"workflow_route_disabled"}`; `502 {"code":"maximo_unavailable"}` (không tốn lượt).
- Xóa ô mật khẩu ngay sau khi gửi; không lưu ở `localStorage`.

`DELETE /api/workflow/route/session?connection_id=…&discipline=…` -> `204`. Bỏ qua hai tham số để quên mọi phiên của
đăng nhập hiện tại. Logout Entra (`POST /api/auth/logout`) cũng quên phiên.

## 3. Kiểm tra trước (chỉ đọc)

`POST /api/workflow/route/preview`

```json
{ "connection_id": "…", "discipline": "E&I", "items": [ { "site_id": "BD1", "workorder_id": "531789" } ] }
```

`200`:

```json
{ "connection_id": "…", "discipline": "E&I",
  "contract": { "ok": true, "problem": null },
  "items": [ { "site_id": "BD1", "workorder_id": "531789", "wonum": "P13467327",
               "ready": true, "code": "ready", "node_id": 20, "wfassignment_id": "1645243",
               "assigned_to": "VIETLV",
               "supervisor": { "current": null, "will_set": "VINHDN" } } ] }
```

- Không cần phiên Maximo; không ghi gì lên Maximo hay DB. WO ngoài phạm vi hoặc không tồn tại đều trả `code:"out_of_scope"`,
  `wonum:null` (không phân biệt được).
- `assigned_to` = `ASSIGNEDTO` hiện có. Route không bao giờ ghi `ASSIGNEDTO`/`ASSIGNEDDATE`; PIC là trường `assignedto` (đã thay `assignedtechname`, trường cũ đã bị loại hoàn toàn khỏi API).
- `supervisor.will_set`: giá trị `SUPNAME` sẽ được ghi (chỉ khi `current` trống và Planner thuộc nhóm `ALLSUPN`);
  `supervisor.current` khác rỗng thì không bao giờ bị ghi đè.
- `code` (ổn định). `ready` là duy nhất cho phép route; còn lại là lý do mờ nút:

| code | Ý nghĩa gợi ý hiển thị |
| --- | --- |
| `out_of_scope` | không thấy WO này |
| `not_synced` | còn nháp chưa gửi (của bạn) hoặc upload đang chạy cho WO |
| `supervisor_missing` | `SUPNAME` trống và bạn không thuộc nhóm giám sát để điền |
| `is_child` | WO con |
| `status_not_routable` | status ngoài `APPR, WSCHED, SCHED, WMAT, WPCOND, CPLAN, WMATL` |
| `missing_schedule` | thiếu lịch bắt đầu/kết thúc |
| `missing_assignee` | thiếu `assignedto` (PIC) hoặc ngày giao (`ASSIGNEDDATE`, do Maximo tự điền khi có PIC) |
| `no_workflow` | WO chưa có việc workflow BD_WO nào đang chờ |
| `no_active_assignment` | có workflow nhưng không phải việc đang chờ của tài khoản position ở node 20/40, đúng revision |
| `multiple_assignments` | nhiều việc ACTIVE, cần kiểm tra tay |
| `already_routed` | đã ở node giao việc cho kỹ thuật viên |
| `contract_changed` | định nghĩa workflow đã đổi hoặc không có đúng một revision `active` (xem `contract.problem`, ví dụ `process_revision_not_found`, `process_revision_ambiguous`, `node_34_condition_present`); mọi route bị khóa. Việc còn nằm ở revision cũ báo `no_active_assignment` |

- Preview lỗi `502 {"detail":"…"}` khi không đọc được Maximo.

## 4. Route

`POST /api/workflow/route`

```json
{ "connection_id": "…", "discipline": "E&I", "request_id": "<uuid>", "items": [ { "site_id": "BD1", "workorder_id": "531789" } ] }
```

Cần phiên ở mục 2 (`409 route_session_required` nếu chưa có hoặc đã hết). Server chạy từng WO tuần tự, ghi audit trước khi
gọi Maximo, **không bao giờ gửi lại** một thao tác Maximo, và vẫn hoàn tất nếu trình duyệt đóng giữa chừng. Dùng **một
`request_id` mới cho mỗi lần bấm**; gửi lại cùng `request_id` chỉ trả kết quả đã lưu, không route lại.

`200` (cũng là dạng của `GET /route-submissions/{request_id}`):

```json
{ "request_id": "…", "connection_id": "…", "discipline": "E&I",
  "complete": true, "counts": { "confirmed": 1, "rejected": 1 },
  "items": [ { "site_id": "BD1", "workorder_id": "531789", "wonum": "P13467327",
               "state": "confirmed", "code": null, "attempt_id": "…",
               "wfassignment_id_after": "1646001", "assigned_to": "VIETLV",
               "updated_at": "2026-10-23T09:19:59.920226+00:00" } ] }
```

`state` của từng WO:

| state | Ý nghĩa | Hành động UI |
| --- | --- | --- |
| `confirmed` | đã route; việc mới ở node giao việc cho `assigned_to` | "Đã route · <PIC>" |
| `rejected` | bị từ chối **trước** khi gọi Maximo; `code` là mã preview (xem mục 3) hoặc `route_in_progress`, `authorization_changed`, `request_id_conflict` | WO không đổi |
| `failed` | thất bại, WO không đổi; `code` ví dụ `complete_rejected`, `route_session_expired`, `read_failed`, `audit_unavailable`, `supname_write_rejected`, `supname_write_unknown`, `supname_conflict`, `supname_unwritable`, `supname_not_confirmed`, `assignment_changed`, `route_session_required`, `abandoned_pending`, `internal_error` | có thể thử lại bằng `request_id` mới |
| `stranded` | **mất việc**: Maximo đã hoàn thành việc cũ nhưng không tạo việc mới. `code` ví dụ `stranded_no_assignment`, `option_mismatch`, `choose_rejected`, `choice_location_invalid` | báo đỏ, cần admin Maximo khởi động lại workflow; **không** thử lại |
| `unknown` | chưa rõ (timeout/không đọc lại được/trạng thái bất thường). `code` ví dụ `complete_unconfirmed`, `choose_unconfirmed`, `readback_unavailable`, `unexpected_assignment`, `internal_error` | nút "Kiểm tra lại" (mục 5), **không** route lại |
| `pending`, `sending` | đang chạy (chỉ thấy khi đọc lại receipt giữa chừng) | quay vòng, poll `GET` |
| `not_attempted` | chưa thử vì WO trước đó dừng cả lô (`code`: `stranded`/`unknown`/`route_session_expired`/`authorization_changed`/`internal_error` hoặc `previous_work_order_*`) hoặc `not_started` khi replay | cho phép route lại bằng `request_id` mới |

- `complete=false` khi còn `pending`, `sending` hoặc `not_attempted`. Không bao giờ hiển thị "thành công" chung khi còn
  mục khác `confirmed`.
- Lô dừng ngay sau `stranded`, `unknown`, `route_session_expired` hoặc `authorization_changed`; `failed`/`rejected` không dừng lô.
- `route_session_expired` trong một mục = Maximo từ chối phiên (ví dụ đổi mật khẩu): server đã quên phiên, hỏi lại mật khẩu.
- Lỗi cấp yêu cầu (không có mục nào được thử):
  - `409 {"code":"route_session_required"}`
  - `409 {"code":"workflow_contract_changed","problem":"node_34_condition_present"}` (định nghĩa BD_WO lệch; khóa)
  - `409 {"code":"route_account_busy"}` đang có lần route khác dùng cùng tài khoản position; thử lại sau ít giây
  - `409 {"code":"request_id_conflict"}` dùng lại `request_id` cho WO/phạm vi khác
  - `409 {"code":"workflow_route_disabled"}`, `404`, `403`, `401` như trên

## 5. Khôi phục

`GET /api/workflow/route-submissions/{request_id}` -> cùng dạng như mục 4 (chỉ các WO đã có dòng audit; không gọi Maximo).
`404 {"code":"receipt_not_found"}` nếu chưa có dòng nào: có thể yêu cầu còn đang chạy, hãy thử lại hoặc tạo `request_id` mới
sau khi chắc chắn. Dùng khi mất kết nối trong lúc route, hoặc để poll khi `complete=false`.

`POST /api/workflow/route-submissions/{request_id}/reconcile` body `{}` (CSRF, quyền ghi; **không cần phiên Maximo**):
chỉ **đọc** Maximo để xử lý các mục `unknown` và các mục `pending`/`sending` bị bỏ dở quá 5 phút, trả cùng dạng mục 4.
Một mục `unknown` có thể thành `confirmed`, `stranded`, `failed` hoặc vẫn `unknown`. Không bao giờ gửi lại thao tác ghi.

## 6. Ghi chú hành vi

- Thứ tự mỗi WO: ghi `SUPNAME` (chỉ nếu trống) -> `completeAssignment` -> chọn lựa chọn. Mỗi bước ghi đúng một lần, không gửi lại, và mọi bước nằm trong evidence của audit.
- Khi `SUPNAME` của WO trống, server ghi `SUPNAME` = mã người của Planner (đúng giá trị trong nhóm `ALLSUPN`) bằng ghi có
  `_rowstamp` **trước** khi route; thất bại thì không route (`failed`). Giá trị đã có không bao giờ bị ghi đè.
- Mỗi WO chỉ một lần route đang chạy (khóa theo kết nối + site + WO) và mỗi tài khoản position chỉ một yêu cầu route cùng lúc.
- Memo gửi Maximo: `Route by <tên Planner> via Work Order Scheduler`; người thực hiện thật nằm ở audit của ứng dụng.
- Sau mỗi route nên tải lại danh sách WO/preview; trạng thái workflow do Maximo sở hữu.
