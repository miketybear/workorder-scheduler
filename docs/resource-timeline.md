# Resource timeline trên roster thật

Task planning và upload Onshore Test đã triển khai ngày2026-10-12:
[cách dùng, API và giới hạn](task-assignments.md). Lazy-load task khi chọn WO,
batch nguyên tử, mỗi task một thanh; budget gồm tải Maximo và local khử trùng.

Ngày: 2026-10-12. Đã triển khai local; nghiệm thu và giới hạn được ghi tại
[todos](todos.md). Phương án bảng phân bổ riêng ở WO đã hủy.

## Luồng phân công

Route `/resource-timeline` hiển thị backlog WO bên cạnh các hàng nhân lực và
cột ngày trong tháng. Nhân lực, rota working/off/blank và giờ còn lại lấy từ
roster đã kích hoạt. WO lấy từ Maximo theo quyền connection/discipline hiện hành.

- Kéo WO từ backlog vào ô người × ngày làm việc để tạo đề xuất. Nhập giờ và
  xác nhận trước khi lưu. Một WO có thể có nhiều người và nhiều ngày.
- Kéo thanh phân công đã lưu sang người/ngày khác để đề xuất di chuyển;
  xác nhận dùng API sửa cùng identity WO và version hiện tại.
- Bấm thanh để sửa giờ hoặc xóa. Xóa release reservation và hoàn trả giờ,
  giữ audit. Có thao tác chọn/bấm để thay thế drag-and-drop bằng bàn phím.
- Ngày nghỉ, ô trống và ngày không có capacity không nhận phân công mới.
  Server cộng tải từ mọi WO/site trong pool để kiểm tra630phút/người/ngày.
  Giờ phân công được nhập rõ; không suy ra từ elapsed duration của WO.

Timeline này dùng đơn vị ngày và labor-hours. Không có giờ bắt đầu/kết thúc
ca nên không biểu diễn trùng giờ trong ngày. Không tự chia/resize theo thời gian
trong ca. Thay đổi là reservation chung nội bộ, không đổi PIC/estdur hoặc ghi
ASSIGNMENT Maximo.

## Quyền

Planner chỉ có nhân lực thuộc craft trùng discipline đã được server cấp trên
connection hiện hành: E&I, MECH, P&P, RES hoặc DECK. WO và phân công phải thuộc
cùng scope. Không chọn discipline từ browser để mở rộng quyền; các endpoint
đọc/ghi/biên nhận kiểm tra grant hiện hành và craft của người trong ngày.
Quyền pool không thay thế quyền WO. Admin không có quyền bypass scope Planner.

Quản trị file staging/đối chiếu/kích hoạt rota tổng thể là chức năng quản trị;
Planner không có quyền xem toàn bộ file rota qua quyền implicit pool. Admin
xử lý source tổng thể nhưng timeline vẫn áp quyền WO/craft của tài khoản.

## API

`GET /api/resource-pools/{pool_id}/assignment-timeline` nhận connection_id,
discipline, date_from và date_before (exclusive), tối đa31ngày. Trả rows theo
người/ngày, tải/phút còn lại, phân công trong scope và metadata WO tương ứng.
Giới hạn kiểm tra tối đa200WO đã được phân công mỗi snapshot; không trả một
phần kết quả thành công nếu chưa xác minh scope hiện tại từ Maximo.

Thêm/sửa/xóa dùng [API ledger hiện có](workforce-allocations.md). Mỗi mutation
có CSRF, request UUID, version, audit và biên nhận bền vững. Khi chưa rõ kết quả,
UI khóa mutation, đối soát request UUID trước khi cho gửi lại cùng nội dung.

## Giới hạn

PoC `/assignment-demo` vẫn dùng dữ liệu giả và không phải kế hoạch thật.
Timeline thật không gồm ASSIGNMENT ngoài hệ thống từ Maximo; giờ còn lại chỉ
phản ánh reservation nội bộ và không chứng minh nhân lực đã đủ skill yêu cầu WO.


## Bằng chứng local

[Bố cục](evidence/resource-timeline-poc-aligned-2026-10-12.jpg) đối chiếu PoC:
backlog trái, timeline phải, nhóm role và tổng craft. Browser E&I trả21người
và117WO, đã nghiệm thu thêm/sửa/đổi ngày/xóa, chặn11giờ và hoàn trả test data.
[Ledger read-back](evidence/resource-timeline-2026-10-12.json) xác nhận4audit/
receipts và giữ2phân công có sẵn. FE286tests/BE562offline và58focused qua.
Kéo thả dùng Pointer Events và pointer capture. [Nghiệm thu native IAB](evidence/resource-timeline-native-drag-2026-10-12.json)
đã kéo WO vào người/ngày, lưu 2 giờ, kéo thanh sang ngày khác, chặn tổng 11 giờ
và xóa trial. DB xác nhận 3 audit/3 receipts; giữ 4 phân công người dùng.
Frontend cuối: 290 tests qua với 1 worker; TypeScript, lint và build qua.
