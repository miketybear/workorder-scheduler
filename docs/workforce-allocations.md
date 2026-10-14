# Phân bổ nhân lực cho WO

Migration0012 và [phân công theo task](task-assignments.md) đã nối BDSCHED_WO,
tải Maximo theo labor/ngày và upload existing WAITASGN trên Onshore Test.
Phần v1 dưới đây ghi lại baseline trước mở rộng task; local legacy giữ nguyên.

Phân bổ v1 là kế hoạch nội bộ được lưu trong PostgreSQL. Không thay PIC,
`estdur`, ngày lịch của WO hoặc ghi ASSIGNMENT trên Maximo. Giờ còn lại chỉ
phản ánh phân bổ nội bộ; chưa bao gồm assignment bên ngoài từ Maximo.

## Quy tắc

- Chỉ người có identity đã xác minh trong rota được kích hoạt mới được chọn.
  Capacity theo ngày và chức danh nguồn; SUP/ASST_SUP có thể hỗ trợ như TECH,
  vẫn giữ chức danh riêng.
- Material Controller không được enrollment/phân công theo policy v5 ngày12/10.
  PERSON.title giúp phân biệt tên trùng khi duy nhất khớp chức danh rota; tên
  vẫn không là khóa identity. Roster/lịch sử MC cũ không tạo capacity mới.
- Ngày working có tối đa 10,5 giờ (630 phút). Ngày nghỉ, ô trống hoặc ngày thiếu
  rota không được phân công. Thứ Bảy/Chủ nhật dùng mã rota, không tự loại trừ.
- Tổng giờ của một người/ngày cộng mọi phân bổ đang giữ chỗ trong cùng pool,
  kể cả WO/site không nằm trong danh sách hiện đang xem. Sửa phân bổ thay thế
  số giờ cũ; xóa trả giờ về pool. Không tự chia duration thành labor-hours.
- Phân quyền WO và pool được kiểm tra riêng. Admin của pool không mặc nhiên
  được xem/sửa WO. API đọc lại WO từ Maximo để xác minh discipline hiện tại.
- V1 chỉ phân bổ WO thuộc connection của pool. Binding cùng một người qua
  nhiều connection chưa có; không dùng tên hoặc laborcode để đoán identity.
- Theo yêu cầu ngày2026-10-12, Planner chỉ thấy/chọn nhân lực có craft trùng
  discipline được cấp quyền của WO. Quyền pool/Admin không bypass quyền WO.
  Chưa có requirement/skill từ Maximo để xác minh đủ kỹ năng cụ thể cho WO.
- Thay rota bị chặn nếu làm giảm capacity dưới số phút đã phân công hoặc
  làm thay đổi craft, role hoặc labor binding của ngày đang phân công. Không
  tự xóa phân công để kích hoạt.

## Lưu và khôi phục

Thêm/sửa/xóa là thay đổi reservation chung ngay khi API lưu thành công.
Các thay đổi có version, actor và audit; request UUID lưu biên nhận trong cùng
transaction. Hai planner không thể cùng tiêu hao số giờ còn lại vượt 630 phút.
Assignment và activation dùng cùng khóa pool để kiểm tra capacity nhất quán.

Nếu mất response, tra cứu biên nhận theo request UUID trước khi thao tác tiếp.
Không suy rằng chưa lưu chỉ vì timeout; không gửi một request UUID mới để thử
lại thao tác cũ. Version cũ bị từ chối, cần tải lại dữ liệu trước khi sửa tiếp.

## API

- `GET /api/resource-pools/{pool_id}/assignments`: một WO theo connection,
  discipline, site và workorder ID; khoảng ngày `date_from` đến `date_before`
  (exclusive). Trả roster/capacity/tổng phút đã dùng và phân bổ của WO đó.
- `POST /api/resource-pools/{pool_id}/assignments`: connection, discipline,
  site, workorder ID, person UUID, ngày, số phút và request UUID.
- `PATCH /api/assignments/{id}`: cùng định danh WO, person/ngày/phút mới,
  version và request UUID. Không chuyển một assignment sang WO khác.
- `DELETE /api/assignments/{id}`: version và request UUID; đánh dấu released.
- `GET /api/assignment-submissions/{request_id}`: biên nhận của actor hiện tại,
  kiểm tra lại quyền trước khi trả kết quả.

Giờ hiển thị cho người dùng; API/ledger dùng phút nguyên để tránh sai số.
Mutation yêu cầu CSRF. Dữ liệu/audit/biên nhận tạo qua migration 0011; cập nhật
runtime grants bằng [provisioning SQL](../backend/sql/provision_roles.sql)
sau migration với schema owner. Không chạy migration trên môi trường thật
chỉ để thử chức năng.

## Trạng thái giao diện — 2026-10-12

User yêu cầu Resource timeline và đã hủy panel phân bổ dạng bảng tại WO.
Nút Phân bổ nhân lực và panel CRUD tại `/work-orders` đã được gỡ. API/ledger,
roster đã kích hoạt và audit giữ nguyên; đã nối [Resource timeline thật](resource-timeline.md).

Route `/assignment-demo` vẫn là PoC dữ liệu giả; `/resource-timeline` nối
roster thật, backlog WO và thanh phân công, cùng budget630phút/người/ngày.
Bố cục thật theo PoC; Planner chỉ thấy resource/assignment cùng discipline.
Thêm/sửa/đổi ngày/xóa và chặn11giờ đã nghiệm thu bằng click/dialog;
drag handlers có test, kéo chuột native còn cần xác nhận thủ công.

Các kết quả UAT bên dưới là bằng chứng backend và giao diện cũ trước khi hủy,
không phải nghiệm thu Resource timeline với dữ liệu thật.

Đã kiểm chứng bằng HTTP giả lập và PostgreSQL Test, hai planner tranh chấp và
activation/reservation race. Backend47focused tests,534offline tests, runtime
role1test và frontend282tests/lint/TypeScript/build qua. Schema0011 đã được
áp dụng/kiểm tra trên designated test DB và development local ngày2026-10-12.
Development đã tách schema owner/runtime và backend/frontend HTTPS đang chạy;
live/ready/proxy200, dữ liệu nghiệp vụ trước/sau giữ nguyên. Ngày12/10 đã upload
lại và kích hoạt sourcepolicyv5 với85người/0blocker sau loại2MC. Authenticated
browser UAT đạt thêm4→sửa6giờ, WO khác nhận4,5giờ (tổng10,5); vượt11giờ bị
chặn tại UI và backend với snapshot cũ. Xóa2phân công thử hoàn trả toàn bộ giờ;
read-back PostgreSQL xác nhận0reserved và7audit/receipts có actor.
13offline backend/4PG/11FE focused checks qua.
[Bằng chứng UAT](evidence/assignments-acceptance-2026-10-12.json). Staging v3/v4
cũ vẫn bất biến và không được kích hoạt dù preview LABOR đã hết lỗi.
