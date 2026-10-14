# Cập nhật phân công và lọc backlog

Cập nhật: 2026-10-13. Áp dụng cho kế hoạch nội bộ trên Resource timeline.

## Sau thao tác lưu

Thêm, sửa, xóa và lưu batch trả lại `affected_days`, `planning_summary`,
`allocation_updates`, `work_order`, `previous_assignment_revision` và
`assignment_revision`. UI cập nhật phân công và capacity của đúng người/ngày,
giữ danh sách WO, roster, tháng và vị trí cuộn. Không tải lại toàn workspace
sau mỗi lần lưu thành công. Thiếu metadata dùng refresh ngày bị ảnh hưởng;
nếu đọc thất bại, capacity được đánh dấu chưa xác minh và chặn lưu.

Biên nhận giữ nguyên kết quả của yêu cầu gốc để đối soát. Metadata khi đọc lại
phản ánh ledger hiện tại, bao gồm allocation đã released hoặc chuyển ngày;
không dùng kết quả gốc để hồi sinh chip đã xóa. Mã yêu cầu được giữ nguyên
khi gửi lại sau kết quả chưa rõ. Dialog đang chờ đối soát có nút đóng để truy
cập thao tác phục hồi; đóng dialog không hủy hay tạo mã yêu cầu mới.

Revision được trả cùng snapshot timeline. Khi trang đang hoạt động, không
mở editor hoặc đang ghi, UI kiểm tra revision mỗi 30 giây. Thay đổi từ phiên
khác hiện thông báo yêu cầu làm mới; không tự tải lại danh sách. Sau mutation,
chỉ nhận revision mới làm baseline nếu revision trước khớp snapshot đang xem.
Backend kiểm tra lại quyền trong cùng transaction để tránh tự deadlock khi
transaction đã giữ User lock; session, CSRF, grant, pool và connection vẫn
được kiểm tra đầy đủ.

## Backlog và Completed

- Backlog: WO chưa phân bổ, phân bổ một phần hoặc chưa xác minh nhu cầu.
- Completed: mọi task đã được phân bổ đủ theo nhu cầu đã xác minh.
- Tất cả: cả hai nhóm. Completed không thay đổi trạng thái WO trong Maximo.

Summary tính theo task/assignment, mọi ngày và mọi pool liên quan trong cùng
connection/discipline; khử trùng dữ liệu Maximo đã đồng bộ. Không suy nhu cầu
từ estdur hoặc số giờ của riêng tháng đang xem. Thiếu giờ, quantity không
nhất quán hoặc còn nhu cầu ngoài discipline khiến WO chưa xác minh; thông tin
chi tiết của discipline khác không được trả cho Planner.

Snapshot task lưu trong migration `0014_assignment_snapshots`, TTL tối đa
300 giây. Đọc danh sách dùng tối đa hai truy vấn DB để lấy summary, không gọi
chi tiết từng WO. Task được xác minh khi mở dialog và khi thao tác phân công.
WO cũ chưa có snapshot hoặc snapshot hết hạn ở Backlog cho đến khi xác minh
lại. Completed có thể chuyển về chưa xác minh khi dữ liệu hết hạn.

WO card hiển thị gọn “Còn N task · còn X giờ”. Số đã tải trong phiên vẫn
hiển thị sau khi hết hạn, với tooltip cho biết cần mở WO để cập nhật;
quy tắc lọc Completed vẫn dùng độ mới của snapshot. Chưa có số liệu dùng
dấu —, không suy từ giờ ước tính WO. Chỉnh nhãn ngày13/10 được kiểm tra
bằng45tests timeline/typecheck/lint và browser thật.

Backlog/Completed/Tất cả hiện phân trang20WO sau filter/sort. Card trong
viewport của trang hiện tại tự đọc task/summary qua API hiện có, tối đa2
yêu cầu đồng thời. Rời viewport/trang, ẩn tab, đổi scope hoặc mở editor/ghi
sẽ hủy yêu cầu; phản hồi cũ không thay summary mới sau mutation. Không gọi
detail toàn117WO hoặc tự lặp vô hạn khi summary chưa xác minh. Lỗi có retry
riêng. Task dialog vẫn đọc mới trước lập kế hoạch. Phân trang là trên danh
sách WO đã tải; không thay contract list API hoặc phân quyền backend.

Resource timeline rộng100% vùng màn hình (giữ padding), không còn giới hạn
1600px; thanh chia hai panel kéo bằng chuột hoặc phím trái/phải/Home/End.
Độ rộng có giới hạn để chừa khung ngày; viewport nhỏ xếp dọc. Nghiệm thu
13/10:342frontend/typecheck/lint/build đạt; live20card/trang,117WO/6trang,
P13469440 tự tải5task/84h. Không ghi business allocation hoặc Maximo.
[Ảnh nghiệm thu](evidence/backlog-pagination-splitter-2026-10-13.png).

Header hiện3donut theo chức danh Technician/Supervisor/Assistant Supervisor,
thay các summary card cuối trang. Số giờ dùng cùng snapshot tháng với bảng
timeline, tự cập nhật theo metadata sau mutation; không có request mới.
Role khác có text tổng hợp riêng và giữ nguyên trong bảng. Dữ liệu chưa đủ,
capacity0 hoặc nhóm trống không được diễn giải thành0% tải. Vượtcapacity giữ
tỷ lệ thực và giờ vượt, chỉ giới hạn vòng vẽ100%. Hai dòng mô tả/scope được
bỏ theo yêu cầu user; nút Làm mới timeline nằm cạnh tháng và dòng nhóm/tháng
ở toolbar đã được bỏ. WO priority badge được
căn cố định cột phải. 54tests timeline/typecheck/lint/build đạt; browser
1033/1270/600px không tràn ngang.
[Ảnh header mới](evidence/timeline-donuts-1033-2026-10-13.png).

Runtime chỉ có SELECT/INSERT/UPDATE trên `assignment_planning_snapshot`, không
có DELETE/TRUNCATE. Development đã backup, upgrade 0013→0014 và kiểm tra
schema/privilege; dữ liệu bảng cũ giữ nguyên tại thời điểm migration.
[Bằng chứng migration](evidence/incremental-local-development-2026-10-13.json).

## Nghiệm thu

- Frontend: 336 kiểm thử đạt; typecheck, lint và build đạt. Build còn cảnh báo
  chunk khoảng 540 kB. Backend: 61 kiểm thử liên quan và Ruff đạt.
- PostgreSQL: 35 kiểm thử không concurrent và hai kiểm thử transaction độc
  lập đạt; thêm một kiểm thử quyền runtime/provisioning đạt. Independent
  review và focused recheck lỗi deadlock P1 hoàn tất.
- Live P13465911/task10: 20 giờ chia 10,5 + 9,5 giờ; Completed xuất hiện ngay.
  Chuyển đoạn ngày 04→05, giảm còn 9 giờ: WO trở về Backlog với thiếu 0,5 giờ.
  Xóa cả hai đoạn thử; dữ liệu gốc giữ nguyên trong đợt thử và không upload.
  [Tạo](evidence/incremental-live-created-2026-10-13.json),
  [chuyển ngày](evidence/incremental-live-moved-2026-10-13.json),
  [giảm giờ](evidence/incremental-live-edited-2026-10-13.json),
  [dọn trial](evidence/incremental-live-final-2026-10-13.json).
- WO P13468351 có hai task đã phân bổ từ trước: sau đọc task, xuất hiện trong
  Completed, vẫn có trạng thái WMATL.
  [Ảnh nghiệm thu](evidence/incremental-existing-completed-2026-10-13.png).
- Theo xác nhận của người dùng, gửi lại yêu cầu xóa P13431393/HAIDQ ngày
  01/10, 60 phút, bằng UUID `61916eba-edfd-4a37-ab42-04a17151c293`.
  Receipt và ledger đều released/version2; ngày đó còn 630 phút, không upload.
  [Biên nhận kiểm chứng](evidence/incremental-user-delete-2026-10-13.json).
  [Timeline sau đối soát và làm mới thủ công](evidence/incremental-final-timeline-2026-10-13.png).

Các số lượng trong bằng chứng là snapshot tại thời điểm nghiệm thu. Chưa
nghiệm thu hai Planner thật đồng thời; revision/conflict có kiểm thử tự động.
Upload kế hoạch nhiều ngày vẫn khóa, cần contract Maximo delete/rollback và
định danh assignment trước khi mở. Kiểm thử liên quan đạt; không tuyên bố
toàn bộ backend suite đạt vì nhóm backup/restore Windows có lỗi invocation
sandbox ngoài phạm vi thay đổi này.
