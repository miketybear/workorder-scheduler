# Hồ sơ nghiệm thu cùng IT

Cập nhật: 2026-10-08. Hồ sơ này là đầu vào và các ca nghiệm thu cần thực hiện;
chưa có xác nhận IT hoặc nghiệm thu staging. Không cần roster cố định trước login.
Chủ dự án đã chọn bản thân và được bootstrap admin trên DB Entra local; không cấp WO grants mới.
Không gửi secret trong hồ sơ. Xem [intake](integration-intake.md),
[Planner](planner-access.md), [DB và retention](database-operations.md) và
[write contract](maximo-write-contract.md).

## Năm việc cần trao đổi với IT

1. Admin là chủ dự án. Người đăng nhập Entra có PERSON/discipline hợp lệ được đọc
   trong scope; chủ dự án cấp Planner khi cần sửa/lưu nháp. IT đối chiếu identity
   và quyền trên staging; không yêu cầu danh sách tất cả người dùng từ đầu.
2. Giữ lịch sử; tự xóa nháp sau khi toàn bộ upload được read-back xác nhận.
   Chốt người sao lưu/phục hồi và cấp tài khoản DB riêng
   cho ứng dụng với tài khoản dùng nâng cấp schema.
3. Cung cấp địa chỉ HTTPS trên server thử nghiệm và cấu hình đăng nhập công ty;
   cùng chạy các ca cho phép/chặn và thu hồi quyền.
4. Nhờ quản trị Maximo xác nhận các trường/danh sách WO web đọc đúng, crew/PIC và
   phạm vi Onshore/Offshore; so với workbook cùng bộ lọc/thời điểm.
5. Chủ dự án đã cho chọn WO trong danh sách tải server test ngày 08/10. Đã chọn
   CM P13463520/BD1/523961 cho GET, chưa ghi. Cùng chứng minh ETag chặn
   ghi đè khi WO đã được người khác đổi; sau đó mới phát triển upload.

Các bảng dưới là chi tiết kỹ thuật để IT đối chiếu, không yêu cầu chủ dự án tự lấy
hết thông tin một lần. Không gửi credential trong chat/tài liệu.

## Quyết định cần trả về

| Mã | IT/chủ dự án cung cấp hoặc phê duyệt | Bằng chứng cần lưu | Trạng thái |
| --- | --- | --- | --- |
| A1 | Trusted DB operator và admin đầu tiên: tenant/object ID, lý do, người duyệt | Quyết định có ngày; audit bootstrap và không thêm WO grants | Chủ dự án chọn bản thân; local bootstrap/audit qua 07/10, staging operator chưa chốt |
| A2 | Identity/PERSON theo connection; Planner do chủ dự án cấp | Stable identity, PERSON binding/discipline, audit cấp/thu hồi | Chốt 08/10: mặc định chỉ đọc, không cần roster cố định; live một Planner Onshore E&I |
| D1 | DB owner/migrator/runtime, đường secret riêng, quyền máy chủ | Test runtime từ chối DDL/audit mutation; migration owner upgrade; DSN runtime không owner | Chờ áp trên staging |
| D2 | Retention, replay horizon, backup RPO/RTO và restore owner | Chính sách có người duyệt/ngày; restore diễn tập; cleanup dry-run | Chốt 08/10: giữ lịch sử, tự xóa nháp sau toàn bộ upload confirmed; finalizer và backup staging còn pending |
| R1 | Metadata/status domain/read filters/paging cho từng connection | Response/metadata đã redaction và so tập web/workbook cùng thời điểm | Onshore E&I GET có bằng chứng; hợp đồng đầy đủ còn mở |
| T1 | Entra single-tenant/Web, assignment, MFA/CA, guest policy | Portal settings đã redaction và các ca allow/deny thực tế | Local login qua; portal chưa đối chiếu |
| S1 | Ubuntu/hostname HTTPS/callback, DNS/CA, outbound routes, secret injection | TLS/proxy/network checks từ Ubuntu và login trên staging | Chưa có hostname staging |
| W1 | WO test CM/PM/CFT, trường được phép ghi, window/rollback owner | Quyền ghi cụ thể; href/orgid và ca If-Match stale token | Cho chọn WO từ danh sách test 08/10; CM GET qua, ETag `0` chưa xác minh; chưa mutation/upload |

Không dùng email hoặc tên hiển thị để cấp quyền. UI quản trị chỉ dùng identity đã
đăng nhập và có trong DB; user mới vẫn không có quyền WO. PERSON xác định discipline,
Planner permission chỉ giao với discipline đó để mở sửa/lưu nháp.

## Danh sách quyền quản trị phát sinh

Mỗi hàng là một identity và một connection/discipline. Có thể có nhiều hàng cho cùng
identity; không dùng ALL/wildcard hoặc suy rộng Onshore sang Offshore.

| Tenant ID | Object ID | Connection UUID | System/environment | PERSON ID đã đối chiếu | Discipline | Planner enabled | Người duyệt/ngày/lý do |
| --- | --- | --- | --- | --- | --- | --- | --- |

Bảng dùng khi cấp Planner, không phải điều kiện đăng nhập/read. Tên/email chỉ bổ sung để
người đọc đối chiếu, không thay tenant/object ID. `Planner enabled` không phải giấy
phép upload; integration account và WO được phép ghi có quyết định riêng ở W1.
Thu hồi assignment phải dùng revoke permission; chỉ xóa cached grant không đủ.

## Nghiệm thu read theo connection

1. Ghi connection UUID/system/environment, object structures, site/org và discipline
   được phép kiểm tra; xác minh account/secret owner và rotation qua kênh riêng.
2. Từ Ubuntu, kiểm tra DNS/routing và TLS với CA tin cậy. HTTP chỉ dùng connection
   test đã opt-in; không suy ra kết quả mạng Ubuntu từ máy Windows.
3. Đối chiếu metadata cho toàn bộ SELECT ở [reader](../backend/app/maximo/reader.py),
   đặc biệt `lochierarchy.systemid`, identity và field optional/null. Lưu precision,
   length và đơn vị duration, PIC relationship/group theo từng discipline.
4. Đối chiếu domain APPR/SCHED/WMATL/WMAT/DFAPPR và ý nghĩa `parent!="*"`, `istask=0`.
   Dùng biên ngày với offset, từ bao gồm/đến loại trừ; xác nhận timezone riêng.
5. Chọn khoảng đủ nhiều trang: ghi page size, sort/next-page/tổng count; không duplicate
   connection/site/WOID, không bỏ trang. Lưu snapshot workbook/web cùng filter/timepoint
   và đối chiếu tập identity, số lượng và các khác biệt có giải thích.
6. Lặp các discipline được duyệt và Offshore độc lập. Mỗi kết quả ghi ngày/runner,
   request không secret, kết quả mong đợi/thực tế và evidence đã redaction; không tick
   scope chưa chạy. GET không chứng minh conditional update.

## Nghiệm thu tenant và staging

| Ca | Điều kiện / kết quả cần chứng minh |
| --- | --- |
| Portal | Single-tenant, platform Web, callback chính xác cùng HTTPS origin, assignment required; chốt guest policy, MFA/Conditional Access và expiry/rotation secret |
| Login allow | Hai người khác scope và một admin không grant; login nhận đúng tid/oid, WO chỉ trong scope; admin không thấy WO nếu chưa có grant |
| Login deny | Unassigned, wrong tenant, disabled account và guest theo chính sách; không tạo phiên/quyền trái phép; lưu evidence portal/upstream cùng app |
| Phiên | Logout rồi cookie cũ bị từ chối, app session hết hạn, callback replay/expired; không nhầm logout app với logout Microsoft |
| Thu hồi | Revoke Planner/read, PERSON đổi/null, connection disabled khi tab/nháp đang mở; backend từ chối thao tác, UI ẩn dữ liệu ngoài quyền |
| Proxy | TLS browser/server tin cậy, Secure/HttpOnly cookies, CSRF mutation; callback query/Cookie/Authorization/body không vào access logs |
| Hạ tầng | Ubuntu outbound Maximo/Entra, nhiều worker dùng chung sessions/DB, restart, backup/restore và khoảng 10 phiên khác scope |

Ứng dụng hiện có session cố định 8 giờ và không kiểm tra Graph/CAE cho mỗi request.
Disable tài khoản trong Entra chưa chứng minh phiên app đang tồn tại bị thu hồi tức thì.
IT phải chốt độ trễ chấp nhận và đường emergency revoke ở DB (`app_user.active=false`
và thu hồi sessions bởi operator, có change record); thử cả login mới lẫn cookie đang có.
UI Planner không phải UI disable tài khoản hoặc quản lý admin.

## Ghi kết quả và điều kiện chuyển bước

Mỗi ca dùng: mã ca, connection/scope, thời điểm, người chạy/người duyệt, expected,
actual, pass/fail, đường dẫn evidence đã redaction và việc còn lại. Không lưu raw auth
flow, cookie, token, API key hoặc response có nội dung WO không cần cho bằng chứng.

Sau R1/T1/S1 có thể nghiệm thu read và nháp trên các scope đã qua. Chỉ chuyển sang
triển khai sender/upload khi W1 và DB/audit/retention đủ điều kiện theo
[cổng write contract](maximo-write-contract.md). Lần này không gửi email cho IT,
chỉ bootstrap chủ dự án trên DB local với audit; không áp quyền DB chung và không gọi mutation Maximo.
