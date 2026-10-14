# Kích hoạt rota

Phạm vi milestone: chuyển một staging hợp lệ thành roster/capacity chính thức
trong PostgreSQL. Không tạo assignment, không thay WO và không ghi Maximo.

## Luồng planner

1. Upload rota và đọc báo cáo lỗi LABOR/craft như trước. Company chỉ nhận
   BD POC/BDPOC. Maximo admin xử lý lỗi LABOR tại nguồn; uploader không map thủ công.
2. Chọn **Xem thay đổi để kích hoạt**: xem người thêm/bớt, craft/chức danh,
   mã rota, giờ trước/sau và phạm vi ngày. Chi tiết ngày được lấy mẫu tối đa
   20 ngày thay đổi mỗi người; tổng số ngày thay đổi vẫn là số đầy đủ.
3. Xác nhận thay toàn bộ lịch pool trong khoảng ngày của file. Người vắng khỏi
   file mới cũng bị bỏ capacity trong khoảng này; lịch ngoài khoảng giữ nguyên.
4. Kích hoạt tạo revision bất biến và capacity ngày. Một ngày working là
   10,5 giờ, blank/known-off là 0 giờ. Staging đã kích hoạt không sửa/hủy/refresh.

Nguồn hoặc LABOR còn lỗi sẽ chặn toàn bộ kích hoạt; không tự loại dòng lỗi và
không kích hoạt một phần. File cũ có policy khác importer hiện tại cần upload
lại. Không có snapshot hoặc snapshot báo REST lỗi cũng chặn kích hoạt.

Kích hoạt dùng snapshot LABOR đã lưu, không thực hiện REST mới; thành công
không chứng minh LABOR chưa thay đổi trên Maximo sau thời điểm snapshot.
Điều này cho phép xây và kiểm tra tính năng bằng dữ liệu giả lập khi Maximo
Test chưa truy cập được. Các 14 dòng lỗi trong mẫu thật vẫn chờ Maximo admin.

## Phiên bản và khôi phục

Preview mang version của staging và pool. Kích hoạt kiểm tra lại quyền,
version, policy và dữ liệu trong transaction có khóa pool. Hai planner dùng
cùng baseline chỉ một người được áp dụng; người còn lại phải xem lại diff.
Thay file/refresh/chuyển pool hoặc version mới làm mất xác nhận trước đó.

Nếu POST kích hoạt mất kết nối, không tự gửi lại. Dùng **Kiểm tra kết quả
kích hoạt** để GET biên nhận bền vững theo import. POST trùng cùng baseline
trả biên nhận cũ; không tạo revision lần hai.

Stable person UUID được lưu theo pool/PERSONID. Tên chỉ dùng đối chiếu LABOR,
không làm khóa người. Day capacity giữ craft/role/code và nguồn revision để
đổi lịch mới không viết lại lịch sử revision cũ. Một người có metadata khác
nhau theo khoảng ngày có thể xuất hiện ở nhiều nhóm hàng trên active-rota;
không được cộng thành nhiều người.

## API và lưu trữ

- `GET /api/rota-imports/{id}/activation-preview`: version baseline, diff,
  blocker và `activation_receipt` nếu đã kích hoạt.
- `POST /api/rota-imports/{id}/activate`: `{version, pool_version,
  confirm_full_replacement: true}`; trả biên nhận revision.
- `GET /api/resource-pools/{id}/active-rota?date_from=YYYY-MM-DD&date_before=YYYY-MM-DD`:
  lịch chính thức trong khoảng 1–366 ngày, end exclusive.

Planner của pool connection hoặc Admin được kích hoạt; explicit pool grant
vẫn hỗ trợ quyền read/write. WO scope không mở rộng. Backend kiểm tra session,
tenant, pool/config/role, CSRF và no-store theo cùng policy của staging.

Runtime chỉ ghi state/version, person identity và capacity, thêm revision/audit;
pool/grants vẫn do operator quản lý. Revision/audit phải append-only ở PostgreSQL.
Chạy migration bằng schema owner rồi cập nhật grants theo
[database operations](database-operations.md).

## Phần tiếp theo

[Assignment ledger](workforce-allocations.md) dùng cùng khóa pool với activation.
Preview và kích hoạt đều chặn replacement nếu làm giảm capacity dưới giờ đã
phân công, bỏ người/ngày đã giữ chỗ hoặc đổi craft/role/labor binding của ngày
đó. Planner phải xử lý phân công trước rồi xem lại preview; không tự xóa assignment.
