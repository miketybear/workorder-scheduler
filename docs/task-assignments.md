# Phân công theo task trên Resource timeline

Cập nhật: 2026-10-12. Triển khai local Onshore Test E&I.
[Đánh giá ban đầu](task-assignments-assessment.md),
[nghiệm thu cuối](evidence/task-final-acceptance-2026-10-12.json).

## Sử dụng

Kéo WO vào người/ngày: dialog lazy-load task, planned labor và assignment Maximo
trong scope. Chọn task/assignment chờ phân công, giờ đề xuất; laborcode lấy từ
binding roster. Các task lưu nguyên tử bằng một request: đủ capacity lưu cả
batch, lỗi thì không lưu một phần. Mỗi task có thanh riêng để kéo chuyển,
sửa giờ hoặc xóa reservation nội bộ. Giữ bố cục PoC và phân bổ WO cũ, không
tự gán legacy allocation vào task. WO không có task giữ lựa chọn cấp WO.

Giờ planned labor/quantity là gợi ý; không suy demand từ estdur. Nhiều dòng
WAITASGN cần chọn đúng assignment; ID kỹ thuật không hiện trong nhãn lựa chọn.
Không tự ghi đè assignment đã có labor hoặc tạo dòng Maximo mới.

## Capacity và scope

Backend đọc assignment theo labor/ngày trên toàn connection, bao gồm WO task
và WO/site ngoài backlog/discipline đang xem. Chỉ aggregate ngoài scope được
trả ra. Khử trùng assignment ID, từ chối duplicate dữ liệu khác nhau hoặc
quan hệ/paging thiếu. Hiện tính tải mọi status có labor/ngày một cách bảo thủ,
kể cả COMPLETE; WAITASGN chưa labor/ngày chưa tiêu hao giờ của một người.

Tổng = tải Maximo + reservation local chưa phản ánh trên Maximo. Bản synced
trùng đúng labor/ngày/phút chỉ tính một lần. Khi dữ liệu ngoài thay đổi hoặc
unknown, tính bảo thủ. External overbook vẫn hiển thị, thiếu load thì chặn
tạo/sửa. Giới hạn là630phút hoặc capacity rota thấp hơn. Connection/pool locks
ngăn concurrent local reservations qua nhiều pool chung labor; Maximo độc lập
không tham gia PostgreSQL lock này.

Planner cần grant connection/discipline của WO gốc; task thuộc đúng WO/site,
craft phù hợp discipline/roster. Recheck session/PERSON/WO/pool/connection sau
I/O và trước send. Admin không bypass WO grant; Material Controller vẫn loại.
Budget tính theo ngày scheduledate, chưa là kiểm tra trùng khoảng giờ/skill.

## Upload

Mở task đã lưu, nhập ngày giờ bắt đầu theo timezone connection và upload.
Lưu thay đổi local trước upload. Backend dùng ledger + revision, không nhận
nested payload/laborcode tùy ý. Intent có actor/request UUID commit trước POST;
confirmed chỉ sau read-back khớp. Conflict báo rõ; unknown giữ request/attempt
để đối soát, không retry write. Pre-intent rejection có outcome `not_sent`.

Contract xác minh: điền laborcode/scheduledate/laborhrs vào assignment WAITASGN
**hiện hữu**, qua child `assignment` của task resource, với root/child rowstamp.
Luôn gửi `patchtype: MERGE` để giữ các assignment còn lại. Intent lưu đầy đủ
sibling baseline; confirmed/reconcile phải kiểm tra toàn bộ sibling IDs,
business fields và revisions giữ nguyên. Thiếu/thêm/đổi sibling hoặc intent
cũ không có collection baseline giữ unknown, không retry.
Maximo tự chuyển ASSIGNED và có thể đổi lịch task; dialog thông báo hành vi này.
Chỉ Onshore Test và app development/test được bật. Synced/unknown không được
sửa/xóa như local; tạo/split assignment mới, remote edit/delete chưa bật.
Rollback probe là operator Test có audit riêng, không là chức năng Planner.

## API và cấu hình

- GET `/api/work-orders/{connection_id}/{site_id}/{workorder_id}/tasks?discipline=...`
  trả tasks/planned_labor/assignments/revision/upload_enabled.
- POST `/api/resource-pools/{pool_id}/task-allocations`: identity WO/person/date,
  request_id và tasks `[{task_workorder_id,task_id,assignment_id,minutes}]`, max50;
  trả `{items,request_id}`. Receipt assignment-submissions trả `{result:batch}`.
- PATCH/DELETE assignment hiện có giữ task identity/version và audit/receipt.
- POST `/api/assignments/{id}/upload`: version/request_id/scheduled_start có offset.
- GET `/api/assignment-upload-submissions/{request_id}` hoặc
  `/api/assignment-uploads/{attempt_id}`; POST `/reconcile` chỉ đọc upstream.

Migration0012 thêm task identity/baseline/sync_state, unique reserved assignment
theo connection và assignment_upload. Runtime chỉ INSERT upload và UPDATE state,
không đổi intent/xóa audit. Local đã backup, owner upgrade/check và provision.
Không áp remote/production.

Collection allowlist old `oslcmxwodetail` và mới `BDSCHED_WO`; local đã chuyển
reader sang mới. task_load_contract=`bdsched_assignment_test` bật sau probe;
assignment_write_contract=`native_assignment_rowstamp_test` bật sau write/conflict/
restore. Href chỉ chuẩn hóa case object-name, page origins khai báo rõ và luôn
rewrite về endpoint Test configured, không gọi hostname quảng bá. Sender lịch/PIC
WO cũ giữ khóa trên object mới đến khi nghiệm thu lại riêng đường ghi đó.

## Bằng chứng và giới hạn

- [Read/schema](evidence/task-assignment-contract-2026-10-12.json),
  [load/paging](evidence/task-load-contract-2026-10-12.json),
  [migration](evidence/task-development-2026-10-12.json).
- [Write/conflict/restore](evidence/task-write-contract-2026-10-12.json),
  [browser upload/khử trùng](evidence/task-browser-acceptance-2026-10-12.json),
  [ảnh upload](evidence/task-timeline-upload-2026-10-12.jpg).
- [Dialog task sau kéo WO](evidence/task-timeline-picker-2026-10-12.jpg),
  [timeline sau chuyển task](evidence/task-timeline-move-2026-10-12.jpg).
- Batch task10/20/30 tổng10,5h; chặn11h; kéo task20 sang04/10, sửa9→8h,
  xóa trial. Upload task10 confirmed; remote30 + local600 =630phút. Restore
  labor/ngày/giờ/status và lịch task/WO; giữ4phân công user240phút/version1.
- Live E&I/quantity1 và quantity2 đã qua. WO H14306907/task10 có hai slot5h;
  public upload HAIDQ/CHANLD cùng03/10 confirmed, mỗi người300phút không tính
  trùng, sibling giữ nguyên. [Bằng chứng](evidence/quantity-final-acceptance-2026-10-12.json).
- Lần quantity2 đầu phát hiện default PATCH xóa sibling1968932. Đã sửa MERGE,
  khôi phục có audit; Maximo cấp ID2001462 thay ID cũ. Cả hai slot WAITASGN/null
  labor/ngày/5h và lịch WO/task đã restore; target giữ nguyên;4trials released,
  giữ4phân công gốc240phút/version1. Không tuyên bố khôi phục nguyên identity.
- Nhiều ngày/70h, precision DURATION và shift calendar chưa đủ live UAT.
  Remote deployment chưa nghiệm thu; không mở tạo/split assignment tự động.
- Review tìm2P1 (upload/edit, pool revocation) và2P2 (unknown UI, overbook parser),
  đã sửa/regression checks. Focused recheck dừng do credits; Main tự kiểm tra
  và chạy PG tests, không tuyên bố completed independent recheck.
- Kiểm tra cuối:603backend offline,13guarded PG,300frontend tests;
  Ruff/TypeScript/lint/build/diffcheck qua. Build cảnh báo chunk510,90kB.
- Kiểm tra bổ sung quantity2/MERGE:612backend offline,12taskPG/Ruff qua.
  Review độc lập mới38tests không còn P1 bảo toàn sibling; P2 concurrent receipt/
  lost-authority/not_sent đã sửa và main xác minh regression. Frontend không
  đổi trong lượt này. [Hai upload](evidence/quantity-merge-both-upload-2026-10-12.json),
  [restore](evidence/quantity-merge-restored-2026-10-12.json),
  [ảnh xác nhận](evidence/quantity-two-people-upload-2026-10-12.png).
