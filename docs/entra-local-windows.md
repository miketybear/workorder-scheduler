# Kiểm thử Entra trên Windows local

Chuẩn bị ngày 2026-10-02. Frontend HTTPS và backend/API cùng origin tại
`https://localhost:5173`; Vite chuyển `/api` tới `http://127.0.0.1:8000` trên loopback.
Không dùng địa chỉ `https://127.0.0.1:5173` trong browser: chứng chỉ chỉ có tên localhost.
Không mở các dịch vụ này ra LAN. Đây là môi trường development riêng, không phải staging.

## Chuẩn bị và chạy lại

Đã thực hiện trên máy hiện tại: hai script setup, Docker database và migration.
Không chạy lại setup khi file đã tồn tại; script từ chối ghi đè.

Từ root, nếu dựng trên máy Windows mới:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-local-https.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-local-entra.ps1
```

Script HTTPS tạo chứng chỉ localhost 30 ngày trong `Cert:\CurrentUser\My`, export PFX
và tin cậy bản public trong `Cert:\CurrentUser\Root`. Chứng chỉ máy hiện tại hết hạn
2026-11-01. Private key/password và thumbprint nằm trong `.cache/local-https/`, được Git ignore.
Script Entra tạo mật khẩu DB ngẫu nhiên vào `.cache/entra-local-db.env` và `backend/.env`,
đều Git ignore. Các trường Entra được comment cho tới khi có cấu hình đầy đủ.

Chạy database riêng từ root (Docker Desktop phải hoạt động):

```powershell
docker compose -f compose.entra-local.yaml --env-file .cache/entra-local-db.env up -d --wait
```

Database `scheduler_entra_local` ở loopback 55433, volume riêng; không dùng PostgreSQL
automated-test trên 55432. Không xóa volume để xử lý lỗi cấu hình; DB chứa identity/session.

Trong terminal backend:

```powershell
cd backend
uv run alembic upgrade head
uv run python run_local_windows.py
```

Launcher dùng SelectorEventLoop cho psycopg async trên Windows và tắt access log.
Trong terminal frontend khác:

```powershell
cd frontend
npm run dev:https
```

Vite chỉ bind loopback, cổng cố định 5173; nếu cổng bận, dừng thay vì đổi callback.
Config HTTPS đọc PFX trực tiếp, không thêm dependency. Proxy lỗi xóa query trước khi Vite log;
không bật browser-console forwarding hoặc MSAL debug/PII logging.

## Cấu hình trên Entra và nạp secret

Trong app registration đã tạo:

1. **Authentication → Add Redirect URI** (hoặc **Add a platform**) → **Web**.
2. Thêm chính xác `https://localhost:5173/api/auth/callback` và lưu cấu hình.
   Không bật implicit grant; để trống Front-channel logout URL vì ứng dụng chưa hỗ trợ.
3. **Certificates & secrets → Client secrets → New client secret**. Tạo secret test,
   chọn hạn dùng ngắn theo chính sách IT. Sao chép **Value** trực tiếp vào backend `.env`;
   Secret ID không phải giá trị credential. Không gửi Value trong chat.
4. Trong `backend/.env`, bỏ comment cả bốn trường `WOS_ENTRA__...` đã chuẩn bị,
   điền secret vào `WOS_ENTRA__CLIENT_SECRET`. Giữ Tenant ID/Client ID đã nhận và callback local.
   Không khởi động với Entra config chỉ điền một phần.
5. Khởi động lại backend. Mở `https://localhost:5173`, bấm đăng nhập và hoàn tất MFA nếu yêu cầu.

App registration cần single-tenant. Xác nhận Enterprise Application assignment và
MFA/Conditional Access với IT; không nới chính sách tenant để chạy test.
Đăng nhập thành công vẫn không tự cấp WO grants hoặc admin.

## Kiểm tra và giới hạn

Trên máy hiện tại đã kiểm tra: HTTPS frontend 200 bằng Windows trust store, API live/ready 200,
migration/Alembic schema check qua, frontend typecheck/lint và Ruff launcher qua.
Đã thử proxy callback với code/state giả khi backend dừng: 502, log chỉ có đường dẫn.
Git ignore đã xác nhận cho backend `.env`, database password, PFX và PFX password.
Đã nạp secret vào backend `.env` và bật cả bốn trường Entra ngày 2026-10-02.
`/api/auth/configuration` trả `login_available=true`; MSAL đọc discovery tenant thật thành công.
Login qua HTTPS trả 303 tới `login.microsoftonline.com`, đúng tenant/callback, có PKCE
và flow cookie Secure/HttpOnly. Backend chạy ngoài giới hạn mạng sandbox sau khi request
trong sandbox trả 503; không thay đổi TLS verification. Không in secret hoặc code/state.
Chủ dự án báo browser login thành công ngày 2026-10-02. Truy vấn chỉ đọc DB xác nhận một
user đúng tenant, active, một session còn hạn, is_admin=false và không có WO grants.
Callback chỉ tạo session sau MSAL token exchange và JWT validation, nên login/callback
đã có bằng chứng live cơ bản. Không đọc/in session token hoặc credential.
Chưa kiểm thử logout/expiry hoặc xác nhận MFA challenge/Conditional Access.
Readiness chỉ chứng minh DB/schema.

Nếu chứng chỉ hết hạn: dừng Vite, đọc thumbprint trong `.cache/local-https/thumbprint.txt`,
đối chiếu chứng chỉ có friendly name **Work Order Scheduler localhost test** trong certmgr.msc.
Xóa đúng chứng chỉ đó khỏi Personal và Trusted Root của Current User, đổi tên thư mục
`.cache/local-https` sang thư mục lưu tạm bên trong `.cache`, rồi chạy lại script HTTPS.
Khi kết thúc test, thu hồi client secret test trên Entra và gỡ đúng chứng chỉ local theo thumbprint.

Tham khảo: [Microsoft redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri),
[Microsoft client secret](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials),
[Vite HTTPS](https://vite.dev/config/server-options#server-https), [Entra setup](entra-setup.md).
