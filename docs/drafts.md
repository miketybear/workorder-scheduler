# Lập lịch và quản lý nháp

Cập nhật: 2026-10-01. Đã kiểm thử với HTTP Maximo giả và PostgreSQL 17 test;
chưa xác minh Entra/Maximo thật hoặc UAT. Mỗi nháp hiện chứa một WO.

## Sử dụng `/work-orders`

1. Đăng nhập Entra, chọn hệ thống/discipline được cấp quyền và retrieve theo khoảng ngày.
2. Bấm số WO để mở phần lập lịch. Backend lấy lại detail/PIC và kiểm tra WO còn trong scope.
3. Sửa Scheduled Start/Finish, PIC và Duration. Ngày giờ phải là ISO có offset đã xác nhận;
   không chuyển ngày theo timezone trình duyệt. Chưa hỗ trợ xóa giá trị thành null.
4. Chọn Change Target? để sửa target; PM/CFT luôn bị khóa. Bỏ chọn phục hồi target gốc.
5. Xem trường đã sửa và bảng trước/sau; Reset bỏ thay đổi về baseline đã mở.
6. Lưu nháp trên server. Sau đó dùng Danh sách nháp để mở, cập nhật hoặc xóa nháp của mình.

Grant read chỉ được xem; grant write mới được tạo/cập nhật/xóa. Maximo chưa nhận mutation.
API luôn kiểm tra owner, grants và discipline hiện tại; UI không thay thế phân quyền backend.

Đổi scope/filter, retrieve lại, mở WO/nháp khác hoặc bấm liên kết sẽ hỏi trước khi bỏ sửa chưa lưu.
Tải lại/đóng trang dùng cảnh báo beforeunload của trình duyệt; nội dung chưa lưu chỉ ở RAM.
Chưa có cơ chế chặn nút Back của trình duyệt trong SPA; lưu nháp trước khi dùng Back.

Kiểm tra lại phiên mỗi phút, khi focus hoặc tab hiện lại sẽ xóa bảng retrieve và ẩn editor.
Editor chỉ hiện lại sau khi xác minh đúng tài khoản/grants và đọc lại WO/nháp trong scope.
Lỗi tạm thời giữ nội dung sửa ở trạng thái ẩn; dùng Kiểm tra lại phiên để thử tiếp.
Phiên hết hạn hoặc mất quyền thì xóa dữ liệu đang giữ. Baseline đổi làm khóa lưu và hiển thị
giá trị Maximo hiện tại cạnh đề xuất; người dùng phải đối chiếu và mở WO để tạo nháp mới.

## Hợp đồng API

`GET /api/work-orders/detail` nhận connection_id, site_id, workorder_id, discipline;
trả item, baseline, baseline_token, allowed_pics và revision=null.

`POST /api/drafts` nhận các trường identity trên, changes, baseline_token và request_id (UUID).
`PUT /api/drafts/{draft_id}` nhận cùng payload và version (số nguyên dương).
Các mutation yêu cầu session và header X-CSRF-Token. changes theo allowlist ScheduleChanges;
target yêu cầu change_target=true, PM/CFT bị từ chối; PIC và thứ tự ngày được kiểm tra server-side.
Baseline lưu trong DB chỉ lấy từ reader server, không lấy nội dung baseline từ browser.

baseline_token là SHA-256 của identity, discipline, baseline và revision do server trả.
Nó dùng so sánh trạng thái lúc mở với trạng thái server đọc lại lúc lưu; không cấp quyền và
không phải ETag/If-Match của Maximo. Baseline khác hoặc version nháp cũ trả 409 và không lưu.
Cập nhật nháp không tự thay baseline cũ; nháp có baseline đã đổi phải được đối chiếu rồi tạo mới.
Kiểm tra này không khóa trạng thái Maximo giữa lúc đọc và lúc commit nháp.

request_id được lưu trong draft_submission, unique theo actor + request_id, cùng transaction
với thay đổi nháp. Gửi lại cùng payload trả cùng draft_id/version mà không tạo/cập nhật lần hai;
dùng cùng request_id cho payload khác trả 409. Quyền và upstream vẫn được kiểm tra khi gửi lại.
Biên nhận còn giữ sau khi xóa nháp; gửi lại request cũ không làm nháp đã xóa xuất hiện lại.
Hai yêu cầu cập nhật cùng version dùng khóa dòng PostgreSQL; chỉ một yêu cầu được cập nhật.

`GET /api/drafts?connection_id=...&discipline=...&offset=0` lấy tối đa 20 nháp của owner
mỗi trang, kiểm tra grants và WO hiện tại trước khi trả số WO/site. next_offset=null là hết trang.
Nháp không còn eligible/scope không được trả nội dung; lỗi upstream không trả dữ liệu cache.
Danh sách này không phải snapshot ổn định khi nháp được tạo/xóa giữa các lần lấy trang.

`GET /api/drafts/{draft_id}` trả version và items với baseline gốc, changes, current,
allowed_pics, baseline_changed, changes_valid_now, item và baseline_token hiện tại.
`DELETE /api/drafts/{draft_id}?version=...` kiểm tra owner, CSRF, write scope, WO hiện tại
và version trước xóa; thành công trả 204. Xóa lại nháp không tồn tại trả 404.

## Migration và kiểm chứng

Chạy `uv run alembic upgrade head` từ backend trước khi dùng API mới.
Readiness yêu cầu schema `0004_draft_submission`. Không thêm runtime dependency.
Retention/cleanup cho nháp và biên nhận cần được chốt trước vận hành lâu dài.

2026-10-01: 131 backend tests (97 fast + 34 PostgreSQL), 46 frontend tests,
Ruff lint/format, TypeScript, ESLint và Vite production build qua; Alembic upgrade/schema check qua.
Kiểm thử PostgreSQL đồng thời dùng transaction riêng đã xác minh duplicate create và version conflict.
Frontend tests dùng mock để kiểm tra CSRF/request serialization, lỗi lưu, hủy phản hồi cũ,
phiên/quyền đổi, ẩn/khôi phục edits và PM/CFT/ngày/PIC/duration; chưa thay thế browser E2E.

Grid sửa/paste nhiều dòng, timezone nghiệp vụ thật, revision/ETag, upload/audit/history,
browser E2E và kiểm thử khoảng 10 phiên vẫn nằm trong [backlog](todos.md).
