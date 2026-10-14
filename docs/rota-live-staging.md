# Rota upload và PostgreSQL staging

Ngày: 2026-10-12. Giao diện thật: `/rota-imports`; `/rota-staging-demo` vẫn là
prototype giả lập. Preview nối [kích hoạt roster/capacity](rota-activation.md)
trong PostgreSQL; [assignment ledger nội bộ](workforce-allocations.md) đã triển khai.

Policy v5 hiện tại không tính Material Controller vào Labor/capacity. Preview
ghi rõ số/dòng bị loại, gồm cả source cũ bất biến; phải upload lại để activation
nhận source v5. Nhãn Person/Position hiển thị trên mapping/candidates, dùng phân biệt
trùng tên nếu đúng một title khớp position rota. Không đủ bằng chứng thì giữ
blocker; không tự chọn theo craft hoặc role TECH chung. Refresh thật12/10 đã
lưu149LABOR/147title,85người map/0LABORblocker sau loại2MC; các số14blockers
ở phần lịch sử dưới đây không còn là trạng thái hiện tại.

Theo yêu cầu phân quyền discipline ngày12/10, chỉ Admin quản trị upload,
làm mới LABOR, xem/hủy staging và activation rota tổng thể. Planner chỉ xem
nhân lực/assignment cùng discipline trên Resource timeline; policy này thay
quyền implicit import của Planner trước đó. Backend kiểm tra phiên Entra, tenant,
trạng thái tài khoản, role/quyền pool và kết nối cho mỗi yêu cầu; quyền WO theo
discipline vẫn áp dụng riêng. Pool Onshore Test/BDPOC dùng chung cả năm craft,
không chia theo site hoặc giàn.

## Quản trị viên sử dụng

1. Đăng nhập, mở **Rota staging**, chọn pool rồi chọn XLSX hoặc ODS tối đa 8 MB.
   Sheet mặc định `ROTA_2026`.
2. **Upload và tạo staging** đọc file, lưu nguồn đã parse vào PostgreSQL trước,
   sau đó lấy LABOR ACTIVE của organization bằng REST và lưu snapshot/mapping.
3. Xem từng tháng: ngày working 10,5 giờ, ô trống/ngày nghỉ 0 giờ, mã không biết
   báo lỗi với dòng/ô. Name, position, craft và lịch nguồn không sửa trực tiếp;
   nếu sai, sửa file rồi upload revision mới.
4. Preview hiển thị bảng lỗi LABOR riêng trước lịch: dòng/tên/chức danh, craft
   rota, từng mã LABOR/PERSON/organization, PERSON.title và default craft Maximo, nguyên nhân.
   Planner không chọn hoặc sửa mapping. Maximo admin xử lý LABOR thiếu, trùng
   identity, thiếu/nhiều default craft hoặc lệch craft trên server Maximo.
   Upload vẫn lưu staging có lỗi; những dòng này chưa sẵn sàng dùng cho assignment.
5. **Phiên đã lưu** mở lại sau reload. Mapping dùng version; xung đột yêu cầu
   tải lại phiên mới. Sau khi admin sửa, **Làm mới LABOR** đọc REST và tự đối chiếu
   lại toàn bộ dòng, chỉ map khi duy nhất identity/craft đúng nguồn. Nếu REST lỗi,
   giữ snapshot/mapping trước đó và báo snapshot chưa đầy đủ.
   **Hủy phiên staging** giữ lịch sử và khóa sửa tiếp.

Tổng capacity là gross capacity của toàn bộ nguồn đã parse, bao gồm dòng chưa
map; không phải capacity đã xác minh có thể phân công. Luồng kích hoạt riêng
hiển thị diff và chặn toàn bộ import nếu còn lỗi nguồn hoặc LABOR.

## Lưu trữ và vận hành

Migration `0009_rota_staging` tạo `resource_pool`, `resource_pool_grant`,
`rota_import`, `rota_event`. Nguồn, metadata upload và actor của import bất biến;
mapping/snapshot/status có optimistic version. Audit append-only có actor.
Không lưu nguyên workbook hoặc cột passport, DOB, training.

Chạy migration bằng schema owner, sau đó chạy lại `backend/sql/provision_roles.sql`
để runtime được SELECT các bảng mới, INSERT/UPDATE staging và INSERT audit.
Runtime không được sửa pool/grants hoặc audit. Operator dùng helper
`app.rota.provision.provision_pool` để tạo pool cho kết nối đã đăng ký và ghi
operator/reason; helper `change_pool_grant` hỗ trợ quyền riêng bằng tenant/object
ID đã tồn tại. Chưa có giao diện quản trị pool hoặc CLI chuyên dụng.

Parser dùng standard library với giới hạn ZIP/XML/row/column; không thực thi macro
hoặc formula. Header ngày chỉ dùng cached date đã kiểm tra; formula trong lịch
người là lỗi. Native UTF-8 XLSX/ODS được hỗ trợ; XML encoding khác bị từ chối.
Template hiện tại yêu cầu ngày ở H4 và đủ năm section craft.

Policy v4 theo xác nhận chủ dự án chỉ lấy nhân lực công ty: cột C (Company)
phải là `BD POC` hoặc `BDPOC`, không phân biệt hoa/thường và khoảng trắng.
Dòng của công ty khác bị loại trước mapping và tính giờ, dù có LABOR ACTIVE
trùng tên. Company trống hoặc có formula bị loại và báo lỗi nguồn tại ô C;
planner cần sửa file rồi upload lại. Chỉ lưu mã công ty đã xác nhận và tổng số
dòng loại; không lưu dữ liệu cá nhân khác của nhà thầu.
Các phiên v3 đã lưu giữ nguyên lịch sử; upload mới áp dụng v4. Chưa có activation.

Policy v3 chuẩn hóa Đ/dấu/khoảng trắng và bỏ đúng annotation cuối tên `(1A)`–`(9B)`
đã thấy trong file mẫu, giữ nguyên tên nguồn. Tên cơ sở trùng vẫn cần xử lý identity;
không bỏ chú thích khác hoặc chọn tự động khi có nhiều candidate.

LABOR dùng object structure `mxlabor`, scope ACTIVE/organization, kiểm tra hoàn
chỉnh trang/tổng số, giới hạn thời gian/dung lượng/hàng và chỉ chấp nhận paging
trong cùng kết nối được cấu hình. Không đọc Maximo DB. Credentials ở backend.
API/DTO: [contract](rota-staging-api-contract.md).

## Giới hạn còn lại

- Maximo admin sửa tên/identity và default craft trên Maximo nếu khác rota;
  không fuzzy match hoặc tạo alias/override craft trong luồng upload.
- Đã có activation, active-roster diff và assignment ledger/reservation nội bộ.
  Activation/allocation được kiểm chứng bằng dữ liệu giả lập; roster thật chưa activate.
- Chưa triển khai Ubuntu/remote-access; localhost không truy cập từ iPhone từ xa.

Evidence live hiện tại được ghi trong [TODO](todos.md) và
[policy title mới](evidence/rota-title-policy-2026-10-12.json).
Các số trong [evidence11/10](evidence/rota-live-read-2026-10-11.json) bên dưới
là đối chiếu lịch sử trước khi xử lý LABOR.
Kiểm tra cột Company trên mẫu thật: cả87dòng hiện tại đều ghi `BD POC`, kể cả
14dòng chưa map (6không có exact-name candidate,1trùng identity,7lệch craft).
Vì vậy bộ lọc công ty không làm giảm roster mẫu hiện tại; không suy luận nhà
thầu từ việc thiếu LABOR hoặc lệch craft. Xem
[evidence company policy](evidence/rota-company-policy-2026-10-11.json).
