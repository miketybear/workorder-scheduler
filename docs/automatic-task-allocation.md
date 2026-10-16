# Phân bổ tự động nhiều task theo rota

Cập nhật: 2026-10-13. Kế hoạch nội bộ, không ghi Maximo.

Sau lưu, timeline cập nhật phân công/capacity/summary của các ô liên quan;
WO đủ nhu cầu chuyển sang Completed. Khi giảm hoặc xóa giờ, WO trở về Backlog.
Không reload toàn danh sách sau mỗi lần lưu. Chi tiết snapshot/revision và
nghiệm thu ở [cập nhật phân công nhẹ](incremental-assignment-updates.md).
Danh sách timeline tải từng trang từ backend/Maximo, không gom cả tháng;
[phân trang và giới hạn bộ lọc](maximo-backlog-pagination.md).

## Cách sử dụng

Khi phân bổ task nhiều ngày, Nhân lực và một trường Ngày bắt đầu hiện cùng hàng;
không còn ngày bắt đầu lặp trong bảng. Đổi ngày xếp lại preview, tóm tắt và
capacity theo ngày đã chọn. Sửa phân công/WO không có task giữ bộ chọn Ngày rota.
Thẻ task có dòng checkbox/Task ID, mô tả riêng, ô giờ cố định80px kèm đơn vị
và thông tin assignment bên dưới. Thẻ đang chọn có viền nhấn nhẹ; task ngoài
nhóm vẫn chỉ đọc. Ngày ở bảng phân bổ và tóm tắt hiện dd/mm/yyyy; dữ liệu
date-only trong state/API vẫn dùng ISO yyyy-mm-dd.
Danh sách task và bảng ngày có vùng
cuộn riêng để WO nhiều task không che khung nhập giờ. Tổng giờ/ngày giữ ở
cuối bảng khi cuộn. Làm mới timeline nằm cạnh bộ chọn tháng ở header.

API đã lọc planned labor/assignment theo discipline và trả marker an toàn
`has_out_of_scope_demand`. UI giữ thẻ task ngoài nhóm với Task ID và mô tả
API đã trả, kèm nhãn ngoài discipline; không có ô chọn hoặc điều khiển labor.
Task có cả labor
trong/ngoài nhóm vẫn có mô tả chung, nhưng chỉ phân công phần trong discipline.
Thiếu marker không suy “nhóm khác” từ labor trống. WO chỉ có task ngoài nhóm
không fallback sang phân công WO chung. Đây là cách hiển thị trong scope
hiện có; không đổi quyền hoặc quy tắc Completed toàn WO.
[Preview P13470485](evidence/task-dialog-scope-days-2026-10-13.png): Task20/30
ngoài E&I, bốn task10/40/50/60 tổng16h→10,5+5,5h; chưa lưu/ghi Maximo.

Chọn WO và nhân lực trên Resource timeline. Giữ các task cần phân công,
điều chỉnh tổng giờ mong muốn. Khi chỉ có một assignment WAITASGN khả dụng,
hệ thống tự chọn và hiện thông tin chỉ đọc; khi có nhiều dòng, Planner chọn
dòng nguồn rõ ràng trong dropdown. Giờ lấy từ
assignment đã chọn; không nhân quantity lần nữa hoặc suy giờ từ estdur của WO.

Preview xếp theo Task ID tăng dần, dùng hết giờ còn trống của ngày sớm nhất
rồi tiếp tục ngày làm tiếp theo. Đây là thứ tự xếp lịch mặc định, không suy
ra quan hệ phụ thuộc kỹ thuật giữa task. Ngày nghỉ được bỏ qua. Mỗi ngày chỉ
dùng tối đa min(giờ rota,10,5 giờ), trừ tải Maximo và mọi reservation nội bộ
của laborcode trên cùng connection; các task trong preview dùng chung budget.

Ví dụ hai task mỗi task10h, ngày01 còn10,5h và ngày02 còn10,5h:

| Task | Ngày01 | Ngày02 | Tổng |
| --- | ---: | ---: | ---: |
| 10 | 10h | 0h | 10h |
| 20 | 0,5h | 9,5h | 10h |
| Tổng phân bổ | 10,5h | 9,5h | 20h |

Khi cần thêm ngày, UI tự tải capacity từng khoảng tối đa31ngày và mở rộng
preview, tối đa366ngày. Không coi ngày thiếu roster/tải Maximo chưa đủ là ngày
trống. Planner xem và chỉnh giờ trên bảng task × ngày trước khi xác nhận.
Tổng từng task phải đúng giờ yêu cầu; tổng từng ngày phải trong budget.

Một lần xác nhận lưu tất cả task hoặc không task nào. Sau lưu, timeline có
thanh riêng cho từng task/ngày; mỗi source có plan riêng. Các invariant sửa/xóa
và khóa upload của [kế hoạch nhiều ngày](multiday-local-timeline.md) vẫn áp dụng.

## API

POST `/api/resource-pools/{pool_id}/task-plan-batches` nhận scope chung
`connection_id/site_id/workorder_id/discipline/person_id/request_id` và
`tasks[]` (1–50): `task_workorder_id/task_id/assignment_id/total_minutes/segments[]`.
Mỗi segment có `date/minutes`. Không lặp source, tổng segment đúng demand,
span toàn batch tối đa366ngày. Response `{request_id,plans[]}`, mỗi plan trả
`plan_id/task_workorder_id/task_id/assignment_id/total_minutes/items[]`.
GET submission trả receipt cùng shape cho cùng UUID/context bất biến.

Backend khóa connection/pool, kiểm tra tổng theo ngày của toàn batch, đọc lại
WO/source/grants sau I/O rồi ghi một transaction. Lỗi source/quyền/capacity
không để lại reservation từng phần. Không thêm migration hay dependency.

## Xác minh

- Backend20PostgreSQL cases và43offline tests/Ruff qua, gồm aggregate overload,
  source conflict/change, mất quyền, receipt và rollback. Một giao dịch lưu
  nhiều plan/segment; không migration hay thay đổi dữ liệu người dùng.
- Frontend50tests API/timeline qua; full325tests qua, typecheck/lint/build qua.
  Review và một focused recheck: sửa fallback capacity sau reactivation,
  cell âm và autoextend do chỉnh tay; không còn finding trong phạm vi recheck.
- Test PoC cũ timeout do truy vấn role toàn DOM lớn: thu hẹp truy vấn theo
  button text/label và navigation header, giữ các assertions, không tăng timeout.
  Full suite sau sửa đạt325/325. Build vẫn cảnh báo chunk528,73kB.
- Browser P13468351/Le Duc Chan ngày01/10: task10=10h, task20=0,5h01/10+
  9,5h02/10; giữ cả hai task, nút lưu mở. Đổi Dao Quang Hai có2h reservation
  mỗi ngày01/02: task10=8,5+1,5h; task20=7h02/10+3h03/10. Chỉnh11h khóa lưu.
- Bắt đầu15/10 cho Le Duc Chan: task10=10h, task20=0,5h15/10+9,5h13/11,
  UI tự tải ngày ngoài tháng và bỏ các ngày rota0. Trả preview về01/10,
  chưa bấm lưu; không ghi Maximo. Bốn reservation gốc vẫn hiển thị.
- [Preview và đối chiếu](evidence/automatic-task-preview-2026-10-13.json),
  [ảnh bảng](evidence/automatic-task-preview-2026-10-13.png).

Tiếp theo: nghiệm thu lưu preview nhiều task qua UI theo lịch thực tế của
Planner. Bổ sung14/10: [đồng bộ từng kế hoạch trên Test](daily-plan-uploads.md)
có preview và mapping theo ngày; sửa/xóa đã gửi và rollback chưa mở.
