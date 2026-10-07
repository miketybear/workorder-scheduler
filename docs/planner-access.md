# Quyền Planner và kiểm thử nháp

Cập nhật 2026-10-07. Migration `0006_planner_permission` lưu quyền Planner riêng theo
user + connection + discipline. PERSON vẫn quyết định discipline hiện tại. Chỉ khi có
permission khớp và PERSON được xác minh thành công, grant mới là `write`; mặc định là `read`.
Admin không tự có quyền xem/sửa WO. Quyền này hiện mở sửa/lưu/xóa nháp; upload chưa triển khai.

## Cấp và thu hồi

API `PUT /api/admin/planner-permissions` yêu cầu session admin đang hoạt động và
`X-CSRF-Token`. Body gồm `user_id`, `connection_id`, `discipline`, `enabled` và `reason`.
Các ID được kiểm tra ở server; chỉ hỗ trợ connection đã bật nguồn PERSON.
GET `/api/admin/roster` yêu cầu admin đang hoạt động trong tenant được cấu hình và
trả users, configured PERSON connections, Planner assignments và grants DB gần nhất;
không trả secret/host và dùng no-store. PUT chỉ cấp discipline có crew mapping;
thu hồi vẫn được phép với assignment cũ khi discipline bị bỏ hoặc user/connection inactive.
Admin UI tại `/admin` xác minh session, dùng CSRF, yêu cầu lý do tối đa 500 ký tự,
giữ ý định khi lỗi và tải lại trạng thái sau mutation. Grant DB là kết quả PERSON
gần nhất, không phải bảo đảm access hiện tại; enable chờ lần xác minh PERSON tiếp theo.

## Admin đầu tiên

Chủ dự án chọn bản thân là admin đầu tiên ngày 2026-10-07. Công cụ chỉ xử lý Entra
identity đang active đã tồn tại ở tenant cấu hình; không tạo user hoặc WO grants.
Migration `0008_admin_authority` thêm audit toàn cục append-only riêng, không gắn
connection giả. Bootstrap được serialize bằng advisory transaction lock và bị từ chối
khi bất kỳ admin đã tồn tại. Runtime DB không được sửa is_admin hoặc insert audit bootstrap.

Từ backend, trong shell operator có DSN đặc quyền được IT quản lý riêng:

```sh
uv run python bootstrap_admin.py --tenant <tenant-uuid> --user-object <existing-object-uuid> --operator '<trusted operator attribution>' --reason '<approved reason>'
```

Mặc định dry-run, không commit; đối chiếu preview stable identity trước khi thêm
`--execute`. Operator attribution là khai báo người vận hành tin cậy, không giả làm
session admin đã tồn tại. Quyền máy chủ/DB operator phải được kiểm soát bên ngoài app.
Đây không phải endpoint tự cấp admin. CLI không có chức năng cấp thêm admin hoặc revoke
admin; các thay đổi authority tiếp theo cần quy trình/audit được review riêng.

Local ngày 2026-10-07: đối chiếu identity Entra đã đăng nhập của chủ dự án, chạy
dry-run rồi execute trên `scheduler_entra_local` (loopback 55433) sau additive upgrade
0007 → 0008 và schema check. Đọc lại xác nhận user active/admin=true và đúng một
admin_authority_event; access_grant và planner_permission đều giữ một hàng như trước.
Không tạo thêm WO grants, không chạy provisioning/cleanup execute trên DB này.
Đây là cấp admin local theo lựa chọn chủ dự án, chưa phải bootstrap/IT nghiệm thu staging.

Người vận hành tin cậy có quyền DB có thể dùng CLI từ `backend/`:

```powershell
uv run python manage_planner.py grant --tenant <tenant-uuid> --actor-object <operator-object-uuid> --user-object <planner-object-uuid> --connection <connection-uuid> --discipline 'E&I' --reason 'Approved scope and reason'
```

Dùng `revoke` thay cho `grant` để thu hồi. CLI đọc cấu hình duy nhất qua Settings;
không truyền password hoặc API key trên command line. Actor/target phải là identity Entra
đã có trong DB, không tạo tài khoản hoặc cấp admin. Đây là đường vận hành đặc quyền DB,
không phải đăng nhập Entra: actor là người vận hành khai báo bằng stable object ID và audit
ghi rõ `source=trusted_database_operator`. API lấy actor từ session, không nhận actor từ body.
Bảo vệ quyền truy cập máy chủ, CLI và credential DB; không expose CLI thành endpoint công khai.

Permission và authorization_event được commit trong cùng transaction. Audit chứa actor,
target identity, connection, discipline, before/after, lý do và nguồn thao tác.
Gửi lại trạng thái không đổi không tạo audit trùng. Audit dùng trigger append-only hiện có.
Thu hồi hạ effective grant xuống read ngay; sync PERSON sau đó không tự cấp lại write.
Cấp mới chờ lần xác minh PERSON tiếp theo. Permission của discipline cũ được giữ nhưng không
có hiệu lực khi PERSON đổi discipline; nếu PERSON trở lại discipline đó, permission lại có hiệu lực.
Muốn thu hồi vĩnh viễn quyền Planner phải dùng revoke, không chỉ xóa access_grant.

PERSON sync, quản lý Planner và bước lưu nháp cuối cùng dùng cùng user row lock.
Lưu/xóa nháp lấy user lock trước draft lock; không giữ draft lock trong lúc gọi PERSON.
Restore kiểm tra lại version sau network để không trả một nháp trộn hai phiên bản.
WO baseline token vẫn chỉ bảo vệ nháp, không thay thế ETag/If-Match cho upload.

## Bằng chứng

Browser local với Entra session thật, Onshore test/E&I: tạo nháp P13457392/BD1 với lịch,
PIC và duration; mở lại khớp nội dung; cập nhật phiên bản 1 lên 2. Thu hồi Planner làm editor
chuyển Chỉ xem, khóa các trường và nút lưu; cấp lại sau kiểm tra. Xóa nháp v2 sau xác nhận
của chủ dự án: danh sách không còn P13457392/BD1, truy vấn DB chỉ đọc xác nhận không còn
DraftItem của WO đó và hai nháp khác vẫn còn. Không cấp admin.
Toàn bộ truy cập Maximo trong luồng này chỉ GET; không cập nhật WO từ nháp.

Tests PostgreSQL + HTTP mocks bao gồm admin/CSRF, từ chối viewer/anonymous, scope khác,
PERSON đổi/null, thu hồi giữa network I/O, session hết hạn, baseline conflict, PM/CFT,
vòng đời tạo/restore/update/delete và audit. Xem [TODO](todos.md) cho số tests và giới hạn cuối task.
Offshore, tenant policy, tải đồng thời 10 người, quản trị qua UI trên staging và upload
chưa nghiệm thu. Admin UI có synthetic behavior tests; chưa thử cấp/thu hồi qua browser live.
