# Thiết kế: Route WO đến Tech PIC trong ứng dụng

Ngày: 2026-10-23 (cập nhật 2026-10-26). Trạng thái: **đã triển khai và nghiệm thu trên Onshore test với 3 WO** (backend `app/workflow_route/`, giao diện cột Action + `RoutePanel`); hợp đồng API ở [workflow-route-api.md](workflow-route-api.md). Khác thiết kế ban đầu: route còn ghi `ASSIGNEDTO` từ PIC (phiên ENISUP), tên đăng nhập `maxauth` chữ thường, revision lấy bản đang active. Nền: kết quả route thử thành công trên
Onshore test ở [maximo-workflow-route.md](maximo-workflow-route.md). Phạm vi đầu tiên: Onshore **test**, discipline
E&I (tài khoản position `ENISUP`), WO cha đã có lịch và PIC.

## 1. Mục tiêu và nguyên tắc

- Sau khi lịch/PIC của WO đã lên Maximo (nút "Gửi N WO"), Planner bấm **Route tới PIC** để giao việc cho
  `ASSIGNEDTO` qua workflow BD_WO, thay vì mở Maximo UI.
- Route là **một loại ghi mới**, không phải một trong sáu trường được phép; nó chỉ thực hiện đúng một thao tác
  workflow ("Route to Tech PIC for execution"). Không ghi trường WO nào, không start workflow, không gửi
  `interactioncomplete`.
- Giữ các bất biến của dự án: quyền theo discipline tính ở backend; audit ý định bền vững **trước** khi gọi Maximo;
  không gửi lại mù quáng; báo thành công/thất bại/chưa rõ trung thực; khóa theo WO; secret chỉ ở server.
- Đặc thù đã học được: workflow dở dang không khôi phục được từ ứng dụng (WO mất việc). Vì vậy **kiểm tra
  trước thật kỹ, và ưu tiên không route hơn route sai**.

## 2. Hợp đồng Maximo (đã nghiệm thu trên test)

| Bước | Gọi | Tài khoản |
| --- | --- | --- |
| Đọc điều kiện WO | `BDSCHED_WO` (status, lịch, `assignedto`, `assigneddate`, `parent`) | API key tích hợp (đường đọc sẵn có) |
| Đọc việc workflow | `MXAPIWFASSIGNMENT?oslc.where=ownerid=<id> and ownertable="WORKORDER" and assignstatus="ACTIVE" and processname="BD_WO"` | API key của tài khoản position (stateless) |
| Đọc định nghĩa | `MXAPIWFPROCESS` rev cấu hình, node 34 và các node 20/40 | API key tích hợp |
| Hoàn thành việc | `POST <href>?action=wsmethod:completeAssignment`, header `x-method-override: PATCH`, `{"memo","accepted":true}` | **phiên `maxauth`** của tài khoản position |
| Chọn lựa chọn | `POST <Location>` `{"actionid","memo"}` (cùng phiên) | cùng phiên |
| Readback | việc ACTIVE ở node 34, `assigncode` = `assignedto` | API key |

Quy tắc cứng khi gọi: chỉ gửi tới host của kết nối đã cấu hình (link do Maximo trả được ghi lại về host test
bằng cơ chế `paging_origin_aliases` hiện có; **không bao giờ** gửi `maxauth`/API key tới host trong link);
tắt redirect; timeout có hạn; không bao giờ log header `maxauth`/`apikey`.

## 3. Cấu hình (đặt trong `app/config.py`, theo kết nối)

Mở rộng cấu hình đã có `workflow_route_accounts` (personid + API key theo discipline) bằng khối `workflow_route`:

```text
process: BD_WO          revision: 27
nodes:   {20: {action_id: 427}, 40: {action_id: 437}}     # tên lựa chọn bắt buộc: "Route to Tech PIC for execution"
assignment_node: 34     object_structure: MXAPIWFASSIGNMENT
```

Chỉ bật khi `WOS_ENVIRONMENT` là development/test và kết nối có `environment=test` (giống `write_enabled`).
Đổi rev hoặc định nghĩa lệch hợp đồng → tính năng **khóa** (xem 5.1).

## 4. Dữ liệu và quyền

### 4.1 Quyền route (đã chốt: gộp vào quyền Planner)
Không thêm bảng quyền mới. Ai có quyền Planner **ghi** (`planner_permission` + grant ghi, giao với PERSON discipline)
cho kết nối/discipline thì được route WO của discipline đó. Hệ quả cần lưu ý: mọi Planner cùng discipline dùng chung
tài khoản position, nên **audit của ứng dụng là nguồn xác định người route** (memo Maximo chỉ có tên Planner).
Nếu sau này cần tách quyền, thêm bảng cùng khóa với `planner_permission`; không làm trong lát đầu.

### 4.2 Audit và khóa theo WO: bảng `workflow_route_attempt`
Cột chính: `id`, `request_id` (unique, idempotency), `actor_user_id`, `connection_id`, `site_id`,
`workorder_id`, `wonum`, `discipline`, `process`, `revision`, `node_id`, `wfassignment_id_before`,
`chosen_action_id`, `state`, `error_code`, `wfassignment_id_after`, `assigncode_after`, `evidence` (json đã
loại bỏ secret), `created_at`, `updated_at`.

- `state`: `pending` → `sending` → `confirmed | failed | stranded | unknown | rejected`.
  `rejected` = từ chối trước khi gọi Maximo (điều kiện không đạt); `failed` = lỗi trước `completeAssignment`
  (đã đọc lại, WO không đổi); `stranded` = đã `completeAssignment` nhưng không có việc mới (cần admin);
  `unknown` = timeout/lỗi sau khi bắt đầu ghi, chưa đối chiếu.
- **Khóa theo WO**: chỉ mục unique một phần trên `(connection_id, site_id, workorder_id)` khi `state IN
  ('pending','sending')`; lần thứ hai nhận 409. Cùng mẫu với `upload_item`. Ngoài ra khóa theo tài khoản
  position: tối đa 1 route đang chạy mỗi tài khoản (một phiên Maximo mỗi lần, tránh chồng input node).
- Runtime role chỉ INSERT và UPDATE các cột trạng thái (như migration upload); không xóa audit.
- Dòng audit được ghi **trước** khi gọi Maximo; nếu ghi thất bại thì không gọi.

## 5. Backend

### 5.1 Khóa tính năng theo định nghĩa workflow ("contract check")
Trước khi route (cache ngắn, làm lại khi đổi rev/khởi động): đọc `MXAPIWFPROCESS` rev cấu hình và kiểm tra:
rev đang `active`; node 20 và 40 có lựa chọn "Route to Tech PIC for execution" với đúng action id; node 34 có
dòng assignment role `WO ASS` và **không có điều kiện `&APPNAME&`** (hoặc điều kiện rỗng). Sai lệch → trả
`409 workflow_contract_changed`, không route. Đây là chốt chặn cho sự cố "WO mất việc" đã gặp.

### 5.2 Phiên thông tin đăng nhập
- `POST /api/workflow/route/session {connection_id, discipline, username, password}`: kiểm tra CSRF, quyền Planner ghi,
  `username` (không phân biệt hoa thường) phải bằng `personid` cấu hình cho discipline; gọi `whoami` bằng
  `maxauth`; thành công thì **chỉ giữ chuỗi `maxauth` trong bộ nhớ tiến trình**, khóa theo (phiên đăng nhập Entra,
  kết nối, discipline). **Đã chốt: nhập một lần ở lần route đầu và giữ theo phiên Entra** (hết hạn đúng lúc phiên
  Entra hết hạn, hoặc khi logout/đổi kết nối/đổi discipline/Maximo trả 401). Không ghi DB, log, audit hay phản hồi.
  Mật khẩu bị bỏ ngay sau khi tạo `maxauth`; mất bộ nhớ (khởi động lại backend) thì hỏi lại. Nếu Maximo từ chối
  `maxauth` đang giữ (đổi mật khẩu) thì xóa phiên và hỏi lại.
- **Giới hạn thử sai**: tối đa 3 lần/5 phút cho mỗi người dùng và 10 lần/giờ cho mỗi tài khoản position, vì
  tài khoản position **dùng chung** và Maximo có thể khóa tài khoản làm ảnh hưởng mọi người.
- `DELETE` cùng đường dẫn: quên phiên. `GET /api/workflow/route/status` trả `{enabled, can_route, personid,
  session: {active, expires_at}}`.
- Rủi ro đã chấp nhận (chỉ test): Onshore test dùng HTTP nên `maxauth` đi dạng rõ tới Maximo; production
  cấm HTTP, giữ nguyên điều kiện hiện có của dự án.

### 5.3 Kiểm tra trước (preview, chỉ đọc)
`POST /api/workflow/route/preview {connection_id, discipline, items:[{site_id, workorder_id}]}` (tối đa 20)
trả từng WO `ready` hoặc lý do cụ thể (mã ổn định):

| Mã | Điều kiện |
| --- | --- |
| `out_of_scope` | WO không thuộc discipline/grant (trả như không tồn tại) |
| `not_synced` | còn nháp chưa gửi của người dùng hiện tại (nút Route bị mờ) |
| `upload_pending` | WO có upload `pending`/`sending`/`unknown` của bất kỳ người dùng nào; ưu tiên trước nháp, vẫn chặn Route |
| `supervisor_missing` | `SUPNAME` trống và Planner đang đăng nhập không ánh xạ được sang người trong nhóm `ALLSUPN` |
| `is_child` | WO con (`parent` khác null) |
| `status_not_routable` | status ngoài `APPR, WSCHED, SCHED, WMAT, WPCOND, CPLAN, WMATL` |
| `missing_schedule` | thiếu `schedstart`/`schedfinish` |
| `missing_assignee` | thiếu `assignedto` hoặc `assigneddate` |
| `no_workflow` / `no_active_assignment` | không có việc ACTIVE đúng process/rev/node 20 hoặc 40 của tài khoản position |
| `multiple_assignments` | nhiều hơn một việc ACTIVE |
| `already_routed` | đã có việc ACTIVE ở node 34 |
| `contract_changed` | contract check thất bại |

### 5.4 Thực thi
`POST /api/workflow/route {connection_id, discipline, request_id, items:[…]}`: yêu cầu phiên thông tin hợp lệ,
quyền route, CSRF. Mỗi WO **tuần tự** (không song song), mỗi WO một client HTTP riêng (một phiên Maximo):
1. Kiểm tra lại toàn bộ 5.3 ngay trước khi gọi; ghi audit `pending`, lấy khóa, đặt `sending`.
2. `completeAssignment`; xác nhận 200, có `Location`, và lựa chọn đúng tên + đúng action id xuất hiện;
   khác kỳ vọng → **dừng**, đọc lại, ghi `failed`/`stranded` tương ứng. Nếu `completeAssignment` lỗi trước khi
   có lựa chọn thì đọc lại: việc vẫn ACTIVE ở node cũ ⇒ `failed` (an toàn).
3. Chọn lựa chọn. Bước này chỉ gửi **một lần**, không retry; mọi kết quả khác 200/201/204 ⇒ đọc lại ngay.
4. Readback (đọc nhiều lần ngắn): có việc ACTIVE ở node 34 với `assigncode` = `assignedto` ⇒ `confirmed`;
   không còn việc nào ở node 20/40 và không có việc ở node 34 ⇒ **`stranded`** (báo cần admin); còn việc cũ ⇒
   `failed`; không đọc được/timeout ⇒ `unknown`.
5. Trả kết quả từng WO; không bao giờ gộp thành "thành công" khi có WO thất bại; nhật ký `/route-submissions/
   {request_id}` để khôi phục UI sau khi mất kết nối. `unknown` chỉ đối chiếu bằng đọc (nút "Kiểm tra lại"), không
   gửi lại.

### 5.5 Trường `SUPNAME` (mọi loại WO)
Chủ dự án (2026-10-23): WO phải có `WORKORDER.SUPNAME` = **mã người** của người giám sát/lập kế hoạch; các loại WO ngoài PM
gần như đã có sẵn, PM thường trống. Dữ liệu test: `SUPNAME` đọc được trên `BDSCHED_WO` nhưng **không truy vấn được
trong `oslc.where`** (BMXAA4184E); trong 200 PM SCHED cha, 198 trống và 2 có `VINHDN`. Nhóm `ALLSUPN` có 17 người
(`persongroupteam.respparty`), đều ACTIVE.
- **Quy tắc (đã chốt)**: `SUPNAME` đã có giá trị ⇒ giữ nguyên, **không ghi đè**, route như bình thường (dù Planner không thuộc
  `ALLSUPN`). `SUPNAME` trống ⇒ ghi `SUPNAME = person_id` của Planner đang đăng nhập rồi route. Trống **và** Planner không
  ánh xạ được vào `ALLSUPN` ⇒ `supervisor_missing`, nút mờ.
- **Quyền route không phụ thuộc `ALLSUPN`**: nó do quyền Planner ghi + việc workflow ACTIVE của tài khoản position quyết định.
  `ALLSUPN` chỉ quyết định giá trị có thể điền vào `SUPNAME`.
- **Ánh xạ**: dùng liên kết PERSON đã có (`maximo_person_binding.person_id`, suy ra từ tài khoản Entra và đã đọc xác minh)
  rồi kiểm tra `person_id` thuộc `ALLSUPN` (đọc `MXAPIPERSONGROUP`). Không ánh xạ theo tên hiển thị (dễ lệch dấu/thứ tự
  tên); tên thật chỉ dùng để hiển thị.
- Đây là một trường ghi mới ngoài sáu trường: dùng cùng đường ghi có `_rowstamp` (sender `BDSCHED_WO` đã nghiệm thu), ghi
  trước khi route, audit riêng trong `workflow_route_attempt.evidence`; allowlist chỉ mở cho `supname` trong luồng route và
  chỉ khi trống. Ghi `SUPNAME` thất bại ⇒ không route.
- Chưa chứng minh được `SUPNAME` trống làm route thất bại (hành vi do chủ dự án nêu). Nghiệm thu thật trên test với một PM
  trống `SUPNAME` (mục 7).

Memo gửi Maximo: `Route by <tên Planner> via Work Order Scheduler` (người thực hiện trong Maximo là tài khoản
position; người thật nằm ở memo và ở audit của ứng dụng).

## 6. Giao diện

- **Nút Route nằm trong cột Action ở cuối mỗi dòng** của bảng WO (đã chốt). Trạng thái từng dòng:
  - *Sẵn sàng*: nút Route bật, dòng có dải/nhãn xanh "Sẵn sàng route" để dễ nhận ra các WO đủ điều kiện (status, lịch,
    PIC/`ASSIGNEDTO`, việc đang chờ ở node 20/40, không còn nháp chưa gửi, và với PM có `SUPNAME` hoặc ánh xạ được).
  - *Chưa đủ điều kiện*: nút **mờ** kèm tooltip/nhãn lý do ngắn ("Còn nháp chưa gửi", "Thiếu lịch", "Chưa có PIC",
    "Đã route"…); WO còn nháp luôn mờ (`not_synced`). Upload chưa đối soát dùng `upload_pending`, chip hành động "Upload chưa xong" và lý do "Đang có lần upload chưa đối soát — mở Gửi WO để kiểm tra kết quả". WO chỉ có upload chưa đối soát không được tính là "Còn nháp"; "Chưa có nháp" vẫn dựa trên nháp thực tế.
  - *Đã route*: nhãn "Đã route · <PIC>"; *Đang route*: vòng quay, khóa dòng; *Mất việc / Chưa rõ*: nhãn đỏ/vàng với
    hành động "Kiểm tra lại".
  Có thêm bộ lọc "Sẵn sàng route" để gom các WO đã đủ điều kiện. Kiểm tra sẵn sàng chạy theo lô cho các dòng đang hiện
  (`preview`, chỉ đọc, có bộ nhớ đệm ngắn) và chỉ cho người có quyền Planner ghi trên kết nối test. Route từng dòng một;
  vẫn có thể tích nhiều dòng để route theo lô cùng một hộp thoại.
- Hộp thoại 3 bước (side panel như `DraftEditor`, vừa mobile):
  1. **Đăng nhập tài khoản position** (chỉ khi chưa có phiên): tên cố định `ENISUP` (không cho sửa), ô mật khẩu
     `type=password`, `autocomplete="off"`, cảnh báo ngắn ("Mật khẩu chỉ được dùng để route, không lưu; tự hết hạn sau
     15 phút"); sai mật khẩu hiển thị số lần còn lại; xóa ô sau khi gửi hoặc đóng. Không lưu vào `localStorage`/state bền.
  2. **Xem trước**: bảng WO, PIC, lịch, node hiện tại, kết quả kiểm tra (xanh/đỏ kèm lý do dễ hiểu); WO không đủ
     điều kiện bị loại và nói rõ cách sửa (ví dụ "thiếu lịch: sửa lịch rồi Gửi lên Maximo").
  3. **Kết quả** theo từng WO: Đã route / Chưa route (không đổi) / **Mất việc, cần admin** / Chưa rõ (nút kiểm tra
     lại). Số liệu tổng không bao giờ ghi "thành công" khi còn WO thất bại hoặc chưa rõ.
- Văn bản xác nhận trước khi chạy: "Route sẽ giao việc cho PIC của từng WO. Ứng dụng không hoàn tác được."
- Nút tắt khi đang chạy; đóng hộp thoại giữa chừng không dừng yêu cầu đang xử lý, kết quả xem lại qua
  submission.

## 7. Kiểm thử

- Backend (Maximo giả, test nhanh): quyền route/discipline/scope; từ chối khi sai tài khoản; thử sai mật khẩu và
  giới hạn tốc độ; mật khẩu/`maxauth` không xuất hiện trong log, audit, lỗi, phản hồi; từng mã preview; thứ tự
  audit trước gọi; khóa WO và khóa tài khoản (đồng thời); `completeAssignment` lỗi; lựa chọn thiếu/lệch action id;
  chọn thất bại ⇒ `stranded`/`failed` đúng theo readback; timeout ⇒ `unknown` không gửi lại; contract check
  khóa khi rev/điều kiện node 34 lệch; chặn host lạ trong link.
- Frontend: panel đăng nhập (xóa ô, hết phiên), xem trước, kết quả hỗn hợp, mobile.
- Nghiệm thu thật trên test (có chủ dự án): 2 WO đủ điều kiện (đã đồng bộ lịch qua ứng dụng) route thành công; 1
  WO thiếu điều kiện bị từ chối trước khi gọi; thử khóa đồng thời.

## 8. Kế hoạch triển khai (lát cắt)

1. Migration `workflow_route_permission`, `workflow_route_attempt` + CLI quyền + cấu hình `workflow_route` (backend).
2. Dịch vụ backend: contract check, phiên thông tin, preview, thực thi, submission (backend, kiểm thử bằng Maximo giả).
3. Hợp đồng API cố định → giao diện (frontend) song song với lát 2.
4. Nghiệm thu trên test với chủ dự án; cập nhật `docs/todos.md`, `AGENTS.md`.

## 9. Quyết định cần chủ dự án duyệt

1. ~~Giữ `maxauth` bao lâu~~ **Đã chốt (2026-10-23): nhập ở lần route đầu và giữ theo phiên Entra** (5.2).
2. ~~Route khi còn nháp~~ **Đã chốt: không; nút Route mờ** (6).
3. ~~Quyền route~~ **Đã chốt: gộp vào quyền Planner** (4.1).
4. ~~Cập nhật `AGENTS.md`~~ **Đã chốt và đã ghi** (2026-10-23).
4a. ~~Quy tắc `SUPNAME`~~ **Đã chốt (2026-10-23):** ghi mã người của Planner; chỉ ghi khi trống, không ghi đè; áp dụng cho mọi loại WO; chặn
    chỉ khi trống và không ánh xạ được vào `ALLSUPN` (5.5).
5. Thứ tự mở rộng cho MECHSUP/FIELDPRODSUP/RES/DECKFMHSE (cần cấp `MXAPIWFASSIGNMENT` cho nhóm bảo mật của từng
   tài khoản và API key test của họ); và cách xử lý WO dở dang (P13457863, H14323938) trước khi dùng thật.
6. Chốt cách bảo vệ sau này khi chạy production: HTTPS bắt buộc, không giữ `maxauth` qua HTTP.

### Upload bị từ chối và kết quả chưa xác định (2026-10-28)

`POST /api/drafts/{id}/uploads` trả 409 là từ chối trước khi ghi Maximo trong yêu cầu đó: UI giữ nháp, cho đối chiếu mới và không tra receipt. Hiển thị "Upload bị từ chối — Maximo chưa thay đổi: <lý do>"; unresolved upload → "WO đang có lần upload chưa đối soát", preview changed → "Dữ liệu đã đổi, hãy đối chiếu lại", draft changed → "Nháp đã đổi, hãy mở lại"; lý do khác giữ nội dung backend. Thông báo này không kết luận về kết quả của lần upload cũ đang chờ đối soát. Lỗi mạng, timeout và 5xx vẫn dùng luồng chưa xác định/tra receipt, không gửi lại mù.

Các kiểm tra nháp/preview và đặt chỗ upload chạy trước `execute_batch`/`transport.write`.
Sau khi batch đã tồn tại, `submission_result` chuyển 409 từ thực thi, hoàn tất hoặc dựng trạng thái
thành 503: dữ liệu audit bất nhất có thể được phát hiện sau ghi, nên không được báo là từ chối chắc chắn.
