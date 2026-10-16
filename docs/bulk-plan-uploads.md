# Đồng bộ hàng loạt phân công trên timeline

Cập nhật: 2026-10-15. Luồng dùng API đồng bộ từng kế hoạch đã có, với một
preview chung và một lần xác nhận cho Planner.

## Phạm vi và thao tác

Nút **Đồng bộ Maximo** ở đầu Resource timeline gom kế hoạch có ngày nằm trong
tháng đang chọn, thuộc resource pool và discipline được cấp quyền. Danh sách
không phụ thuộc trang backlog, bộ lọc Completed hay từ khóa tìm WO. Kế hoạch
đi qua tháng khác được lấy đủ các đoạn, không chỉ những ô đang hiển thị.

Hệ thống chuẩn bị preview lần lượt và báo tiến độ. Mỗi dòng hiển thị WO, task,
nhân lực, ngày và giờ; các kế hoạch bị chặn hoặc đã gửi có trạng thái riêng.
Planner kiểm tra preview rồi xác nhận một lần để gửi các kế hoạch sẵn sàng.
Preview chung hết hạn sau120giây kể từ khi chuẩn bị xong.

Một lần xác nhận không tạo một request Maximo khổng lồ. Giao diện gọi API xử
lý từng mục; backend giữ nội dung đã duyệt, request UUID và trạng thái của mỗi
mục. Mỗi lần xử lý kiểm tra lại nguồn assignment, quyền, WO, rota, tải và
cấu hình kết nối trước khi gọi luồng gửi một lần. Các ngày và giờ gửi phải
khớp nội dung preview đã duyệt; thay đổi kế hoạch sau preview làm mục bị chặn.

Kết quả được báo riêng: đã đồng bộ, lỗi, xung đột, bị chặn, đã gửi hoặc cần
đối soát. Không hoàn tác mục thành công khi mục khác lỗi. Mục đã bắt đầu mà
chưa rõ kết quả không tự gửi lại. Việc đối soát dùng biên nhận gửi của kế hoạch
và chỉ đọc Maximo. Các mục còn chờ có thể tiếp tục từ batch được lưu sau khi
tải lại; không có worker chạy ngầm khi đóng browser.

Đóng dialog dừng gửi các mục tiếp theo. Mục đã bắt đầu vẫn được tra cứu bằng
biên nhận khi mở lại. Nếu chưa có biên nhận cho mục đang chưa rõ, không mở
luồng gửi lại để thay cho đối soát.

Assignment cũ không có plan_id không bị bỏ qua âm thầm: được liệt kê với lý
do chưa thuộc luồng kế hoạch. Có thể dùng luồng riêng của loại phân công đó.
Backend giới hạn1000mục mỗi batch và báo lỗi rõ khi vượt, không cắt danh sách
rồi báo đã gửi toàn bộ. Preview/kết quả phân trang20mục để giữ dialog gọn.

## API

| Method | Route | Vai trò |
| --- | --- | --- |
| POST | `/api/resource-pools/{pool_id}/plan-upload-batches` | Tạo batch bằng request UUID, tháng và giờ bắt đầu |
| POST | `/api/plan-upload-batches/{id}/prepare-next` | Chuẩn bị một mục, không ghi Maximo |
| POST | `/api/plan-upload-batches/{id}/confirm` | Xác nhận một lần bằng UUID |
| POST | `/api/plan-upload-batches/{id}/continue` | Xử lý một mục đã xếp hàng |
| GET | `/api/plan-upload-batches/{id}?cursor=0` | Biên nhận và trang kết quả |
| GET | `/api/plan-upload-batch-submissions/{request_id}` | Tìm batch khi mất phản hồi tạo/xác nhận |
| GET | `/api/resource-pools/{pool_id}/plan-upload-batches?month=2026-10` | Tìm batch gần nhất của người gửi sau tải lại |

`next_item_id` chọn công việc kế tiếp trên toàn batch; không phải mục kế tiếp
của trang đang xem. `has_more` và `next_cursor` chỉ dùng phân trang. Counts
là tiến độ ledger của batch đã duyệt, không phải tổng WO hiện tại trong Maximo.

Batch thuộc người gửi. Mọi thao tác kiểm tra session, quyền pool/discipline và
CSRF cho POST. Khi quyền WO thay đổi, dữ liệu nhận diện của mục không còn được
phép đọc phải bị che; không dùng biên nhận để lộ dữ liệu ngoài phạm vi hiện tại.
Các response không cache; frontend không lưu WO/receipt vào browser storage.

## Lưu trữ và giới hạn

Migration0016 thêm header batch và các mục cùng proposal cố định, request UUID,
confirmation UUID và tiến độ. Luồng ghi từng kế hoạch vẫn dùng durable intent,
mapping theo ngày và khóa synced/unknown của
[API kế hoạch](daily-plan-uploads.md). Preview không bật quyền ghi mới.
Contract vẫn chỉ được bật trên kết nối Onshore Test đã xác minh.

Chưa mở sửa/xóa assignment đã gửi, rollback tự động hoặc production. Bằng
chứng kiểm thử và nghiệm thu được ghi ở [TODO](todos.md).

## Nghiệm thu dữ liệu Test — 2026-10-14

User chọn đối chiếu bằng API đọc và bảng dưới đây do đang remote bằng điện
thoại, chưa có phiên đăng nhập UI Maximo. Không coi đây là kiểm chứng trực tiếp
tab Assignments. Phạm vi: Onshore Test, BD1/P13469691, E&I, HAIDQ,
Asia/Ho_Chi_Minh; Task10 và Task20, tổng22h.

| Task | Assignment ID | Ngày | Người | Bắt đầu | Finishdate đọc lại | Giờ |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 552343 (nguồn) | 01/10/2026 | HAIDQ | 06:30 | 07:30 | 1 |
| 20 | 552349 (nguồn) | 01/10/2026 | HAIDQ | 06:30 | 16:00 | 9,5 |
| 20 | 2001472 (mới) | 02/10/2026 | HAIDQ | 06:30 | 17:00 | 10,5 |
| 20 | 2001474 (mới) | 03/10/2026 | HAIDQ | 06:30 | 07:30 | 1 |

Cả4dòng có trạng thái ASSIGNED. Finishdate là trường thật đọc lại, đồng thời
khớp scheduledate+laborhrs. Mapping duy nhất từng ngày khớp biên nhận; tổng tải
HAIDQ630/630/60phút không cộng trùng local/remote, giữ đúng sau reload Scheduler.
Task30/552355 vẫn WAITASGN3h/null labor/ngày và cùng rowstamp; planned labor
của cả3task giữ nguyên. Parent schedstart/schedfinish/estdur và target dates
giữ nguyên so với snapshot sau Task10, trước Task20.

Lượt đầu batch `8c0e8f9b-bd4e-4e75-8f40-c5965843f1be` thành công Task10 rồi
Task20 gặp pool lock timeout10s trước daily preview/intent. UI cập nhật tải
bất đồng bộ sau Task10 đang giữ shared pool lock; mục tiếp theo tranh exclusive
lock. Không có durable intent/receipt Task20, source rowstamp chưa đổi.
Main dừng đúng backend local đã hết request, kiểm tra đầy đủ dữ liệu và ghi
3event `batch_no_send`, đóng mục thành blocked; UUID/proposal cũ không đổi.
Đây là phục hồi operator có bằng chứng, không phải tự gửi lại mục unknown.

Bản sửa backend tra biên nhận sau SQLAlchemyError: xác minh không có intent
thì blocked/chưa gửi; có biên nhận thì dùng trạng thái thật; không đọc được
biên nhận thì unknown. UI chờ áp dụng biên nhận/làm mới tải xong trước khi gửi
mục kế tiếp, dừng khi đóng dialog hoặc đổi scope. Batch completed chỉ có nút
**Tạo preview mới** khi không còn unknown; kế hoạch đã synced được bỏ qua.

Batch mới `4bbe4519-c323-4e0b-a944-b9149aa6c69d` bỏ qua Task10 đã synced và
xác nhận Task20. Tổng cộng2lệnh ghi, không có Add retry/rollback; hai biên nhận
confirmed và4mapping được lưu. Các assignment Test đã gửi được giữ để kiểm tra.
Sau sửa,50PG (23bulk+27daily),65frontend liên quan, Ruff/typecheck/lint/build
đạt. Build còn chunk advisory hiện có. Chưa chạy live batch mới có nhiều mục
sẵn sàng sau sửa sequencing; regression dùng deferred capacity refresh kiểm
chứng chờ và dừng khi đóng. Không mở rộng production/edit/delete/rollback.

[Snapshot khi lỗi](evidence/bulk-plan-live-initial-2026-10-14.json),
[đối chiếu cuối và audit](evidence/bulk-plan-live-2026-10-14.json),
[ảnh kết quả](evidence/bulk-plan-live-confirmed-2026-10-14.jpg),
[biên nhận sau reload](evidence/bulk-plan-live-reloaded-2026-10-14.jpg).

## Sequencing thật với hai mục sẵn sàng — 2026-10-14

Batch `de22845d-65aa-4603-afb0-03cb90620e45` trên cùng Onshore Test/pool/E&I
có2mục ready mới: P13470381/BD1, Task10=1h và Task20=5h, HAIDQ ngày04/10.
Hai kế hoạch P13469691 đã synced được skipped; không ghi lại chúng. Một lần
bấm xác nhận, UI tự xử lý2continue, cả hai200/confirmed, khôngblocked/unknown,
không timeout, không thao tác tiếp tục/operator repair hoặc retry.

| Task | Assignment ID giữ nguyên | Ngày | Người | Scheduledate | Finishdate | Giờ |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 555221 | 04/10/2026 | HAIDQ | 06:30 | 07:30 | 1 |
| 20 | 555225 | 04/10/2026 | HAIDQ | 06:30 | 11:30 | 5 |

API đọc xác nhận cả2ASSIGNED, hai durable receipts/mapping duy nhất, mỗi
task vẫn một assignment, không Add child hoặc duplicate. Task30/555229 vẫn
WAITASGN1h/null labor/ngày và toàn protected snapshot/rowstamp giữ nguyên;
cả3planned labor và toàn parent business snapshot giữ. Effective load HAIDQ
360phút (local0,external360,synced360,allocated360), sau reload vẫn6/10,5h.
P13469691 từ lượt trước giữ toàn parent/tasks/protected rows và load630/630/60.

Observer ASGI tạm ở local chỉ ghi route/status/thời gian, không body/header/
query/credential; không thay handler hoặc transport Maximo, không fault injection.
Thứ tự UTC14/10: continue1 kết thúc16:10:05.144727; GETtimeline bắt đầu
16:10:05.714932, kết thúc16:10:06.913883; continue2 bắt đầu16:10:07.680385,
kết thúc16:10:10.424571. Khoảng cách đo bằng monotonic giữa GET kết thúc và
continue2 bắt đầu0,766s; không overlap. GET sau continue2 cũng200. Một confirm,
chính xác2continue, timestamps tạo intent nằm trong đúng request tương ứng.
Đã dừng observer và khôi phục runner backend ban đầu; ready200.

Đóng giới hạn live nhiều mục ready sau sửa sequencing cho batch nhỏ này.
Không sửa code/schema/dependency, không chạy lại app test suite vì không có
app change; kiểm chứng bằng live UI/API/ledger/timing và reload thật. Phạm vi
vẫn local Windows/Vite/HTTPS với Maximo Test, chưa Ubuntu/capacity stress/
production hoặc tab Assignments UI (user chọn API đọc). Dữ liệu Test giữ lại.

[Snapshot, assertions và timing](evidence/bulk-sequence-live-2026-10-14.json),
[preview hai mục ready](evidence/bulk-sequence-preview-2026-10-14.jpg),
[kết quả](evidence/bulk-sequence-confirmed-2026-10-14.jpg),
[biên nhận sau reload](evidence/bulk-sequence-reloaded-2026-10-14.jpg).

## Đối chiếu trực tiếp tab Assignments — 2026-10-15

User đã mở phiên đăng nhập Maximo Test; main đọc tab Assignments trong
Work Order Tracking (Oil), siteBD1 và tra cả2WO. Kết quả UI khớp từng dòng
API/preview trước đó:

| WO | Task | Labor | Scheduled Start | Hours trên UI | Status |
| --- | --- | --- | --- | --- | --- |
| P13470381 | 10 | HAIDQ | 04/Oct/2026 6:30 AM | 1:00 | ASSIGNED |
| P13470381 | 20 | HAIDQ | 04/Oct/2026 6:30 AM | 5:00 | ASSIGNED |
| P13470381 | 30 | trống | trống | 1:00 | WAITASGN |
| P13469691 | 10 | HAIDQ | 01/Oct/2026 6:30 AM | 1:00 | ASSIGNED |
| P13469691 | 20 | HAIDQ | 01/Oct/2026 6:30 AM | 9:30 | ASSIGNED |
| P13469691 | 20 | HAIDQ | 02/Oct/2026 6:30 AM | 10:30 | ASSIGNED |
| P13469691 | 20 | HAIDQ | 03/Oct/2026 6:30 AM | 1:00 | ASSIGNED |
| P13469691 | 30 | trống | trống | 3:00 | WAITASGN |

P13470381 có3dòng và6h đãassigned; P13469691 có5dòng và22h đãassigned,
không dòng thừa. Hours hiển thịhh:mm:9:30=9,5h,10:30=10,5h. CraftE&I và
SkillLevelOPSTECH khớp. Parent ScheduledStart/Finish và TargetStart/Finish
của cả2WO khớp APIbaseline; task30 của cả2WO giữ chưa phân công.

ViewDetailsTask10/P13470381 hiển thị cùng labor/start/hours/status. Bảng và
detail này không có AssignmentID hoặc assignmentFinishdate; không suy rằng
đã thấy hai trường đó trên UI. IDs/finishdates đã có proof API đọc14/10.
Assertions parse trực tiếp UIrow/header và so với APIevidence đạt.

Lượt này chỉ tra cứu/mởđóngdetails, khôngsave/edit/delete/upload/remote
mutation, không sửa app hoặc chạy lại app test suite. Tab trả về P13470381 /
Assignments. Khép giới hạn chưa kiểm tra trực tiếp UI ở các lượt14/10;
Ubuntu/stress/production và contractremoteedit/delete vẫn ngoài phạm vi.

[UIrows/header/assertions](evidence/maximo-assignments-ui-2026-10-15.json),
[ảnh P13470381](evidence/maximo-assignments-P13470381-2026-10-15.jpg),
[ảnh P13469691](evidence/maximo-assignments-P13469691-2026-10-15.jpg).
