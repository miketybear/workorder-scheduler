# Quyền chỉ xem từ Maximo PERSON

Triển khai và kiểm tra 2026-10-02 theo yêu cầu chủ dự án. Trên Onshore test,
nguồn discipline là `PERSON.ct_discipline` qua object structure `mxperson`.

## Ánh xạ người dùng

Khóa identity vẫn là Entra tenant ID + object ID. Sau token exchange và JWT validation,
callback lưu claim `preferred_username` đã xác thực vào `app_user.login_name`.
Backend lấy phần trước `@` chỉ khi domain khớp `person_login_domain` của connection.
Ví dụ đã chốt: `nhatnh@biendongpoc.vn` → `personid=nhatnh`.
Không nhận personid/email/discipline quyền hạn từ browser; không dùng email làm khóa quyền.
Thiếu claim, sai tenant/domain hoặc guest `#EXT#` không được cấp quyền.

`maximo_person_binding` gắn user ổn định với PERSON trên từng connection, có unique constraint
không cho hai Entra object ID sở hữu cùng personid. Login thay đổi sau khi đã bind không tự
chuyển sang PERSON khác; cần quy trình quản trị/remap có audit (chưa có UI/API cho bước này).

## Lookup và quyền

Registry backend có `person_login_domain: "biendongpoc.vn"` để bật nguồn PERSON cho
connection đã cấu hình. Các connection không có trường này giữ cơ chế grants hiện có.
URL PERSON chỉ được suy ra từ sibling object structure của WO collection đã tin cậy:

```text
GET /maximo/oslc/os/mxperson
lean=1
oslc.select=personid,ct_discipline
oslc.where=personid="nhatnh"
ignorers=1
ignorekeyref=1
oslc.pageSize=2
```

API key chỉ ở header `apikey`, không nằm trong URL. Có timeout/response limit 64 KB,
không redirect, không retry. Yêu cầu tối đa một PERSON, không nextPage, personid phải khớp
không phân biệt hoa/thường: test thật trả `NHATNH`. Response sai hoặc không đầy đủ bị chặn.
Null/rỗng/không tìm thấy PERSON → không có grant. `ct_discipline` là một mã duy nhất;
không tách danh sách hoặc đoán multi-value. Trường hợp multi-value cần hợp đồng riêng.

Session API và các đường truy xuất WO/detail/draft kiểm tra nguồn PERSON.
WO list kiểm tra trước và sau retrieve, detail/draft qua checked_settings trước/sau upstream.
Connection dùng nguồn PERSON được đồng bộ thành đúng một grant **read**, hoặc không có grant;
không tự cấp write/admin. Grants thủ công trên cùng connection cũng bị thay thế bởi nguồn này.
Để thu hồi bền vững, sửa nguồn PERSON, disable user/connection hoặc đổi chính sách nguồn;
xóa riêng grant sẽ được đồng bộ lại từ PERSON ở request sau.
Không giữ cache quyền từ PERSON. Các request đồng bộ cùng user được serialize bằng row lock;
chưa có kiểm thử tải 10 phiên hoặc nhiều connection chậm.

Khi lookup thất bại, backend commit việc thu hồi grant cũ rồi trả 503, không cung cấp dữ liệu
bằng quyền cũ. Connection HTTP chỉ được dùng với opt-in, DB environment=test và app không production;
guard kiểm tra metadata trước/sau network. Không tắt xác minh HTTPS.

Migration `0005_person_access` thêm locator, binding và `authorization_event` append-only.
Binding, thay đổi grants và bootstrap connection có audit actor, before/after khi quyền đổi;
không lưu response thô hoặc key. DB owner vẫn có thể gỡ trigger như audit upload hiện tại.

## Cấu hình local và bằng chứng

Đã tạo Onshore test connection UUID `aab45085-e84f-4273-82d2-960b1f26c3da` trong DB local 55433,
timezone `Asia/Ho_Chi_Minh`, với audit actor là user đã đăng nhập. Script
`backend/configure_local_person_access.py` chỉ chạy trên DB local này, từ chối production hoặc
ghi đè connection khác. Không cấp admin hay manual grant. Registry/domain đã nạp vào backend.

186 backend tests qua (129 fast + 57 PostgreSQL), Ruff lint/format qua. Tests bao gồm claim
đã xác thực thay vì query browser, wrong domain/tenant, null/missing/duplicate PERSON,
binding collision/rename, read-only, đổi/thu hồi discipline, lỗi upstream, metadata thay đổi,
WO bị chặn trước network và quyền đổi trong retrieve, audit append-only.
Alembic upgrade/schema check qua trên DB automated-test và DB local SSO; readiness HTTPS 200.

Kiểm chứng Maximo test chỉ đọc thật: ví dụ `duongvq` trả HTTP 200, `ct_discipline=E&I`;
`nhatnh` trả HTTP 200, `personid=NHATNH`, `ct_discipline` null/không có giá trị, không nextPage.
Sau đó chủ dự án điền E&I cho NHATNH và đăng nhập lại (2026-10-02): giao diện hiển thị E&I.
Đọc DB local xác nhận signed login nhatnh@biendongpoc.vn, binding nhatnh, đúng một grant
E&I/read, is_admin=false và audit connection_created/person_binding/person_grants.
Nguồn quyền PERSON đã được kiểm chứng end-to-end cơ bản; không suy ra quyền từ ví dụ duongvq.

Phiên tạo trước migration chưa có login locator: đăng xuất rồi đăng nhập lại để callback
lưu signed claim. Browser login → PERSON → grant E&I đã được chủ dự án xác nhận;
WO retrieve thật, crew/PIC, status domains, revision/ETag và upload vẫn pending.
