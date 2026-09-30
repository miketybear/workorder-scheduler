# Cấu hình Entra SSO

Luồng login/callback/session/logout đã triển khai, chưa xác minh trên tenant thật.
Không cần cấu hình Entra để chạy bảng demo; login khi thiếu cấu hình trả 503.
Staging/production không khởi động nếu thiếu Entra; cấu hình thiếu một phần luôn bị từ chối.

## Thông tin từ IT

1. App registration **single tenant**, platform **Web**, authorization-code flow.
2. Tenant ID, Application (client) ID và client secret qua kênh quản lý secret.
3. Redirect URI chính xác `https://<hostname>/api/auth/callback`, cùng origin với giao diện.
4. HTTPS với chứng chỉ browser/server tin cậy; mạng backend tới login.microsoftonline.com.
5. Cấu hình Enterprise Application yêu cầu assignment và gán nhóm/người được đăng nhập.

Ứng dụng chỉ yêu cầu OIDC login/profile, không gọi Microsoft Graph và không yêu cầu
quyền đọc WO qua Entra. WO grants nằm trong PostgreSQL theo connection + discipline.
User mới có identity theo tenant ID + object ID, không có grants và không có admin.
Không dùng email, roles hoặc nhóm từ browser làm bằng chứng quyền WO.
Đường cấp admin/grants có audit vẫn chưa triển khai; chưa tự seed quyền quản trị.

## Backend settings

Đặt các biến dưới trong môi trường backend hoặc `backend/.env` (được Git ignore):

```dotenv
WOS_ENTRA__TENANT_ID=<tenant UUID>
WOS_ENTRA__CLIENT_ID=<application UUID>
WOS_ENTRA__CLIENT_SECRET=<secret qua kênh bảo mật>
WOS_ENTRA__REDIRECT_URI=https://<hostname>/api/auth/callback
WOS_ENTRA__TIMEOUT_SECONDS=10
```

Áp migration `uv run alembic upgrade head`, rồi khởi động backend. Compose hiện tại dành
cho demo HTTP, chưa truyền cấu hình Entra hoặc cung cấp HTTPS. Khi tích hợp SSO cần bổ sung
secret injection và HTTPS proxy; không bỏ Secure cookie để chạy đăng nhập qua HTTP.

Chạy Uvicorn với `--no-access-log`. Nginx trong repo chỉ log `$uri`, không log query string.
Proxy ngoài cùng cũng phải bỏ query, Cookie, Authorization và body callback khỏi log.
Không bật MSAL debug/PII logging. Login dùng response_mode=query để cookie SameSite=Lax
được gửi khi redirect từ Microsoft; query chỉ chứa code/state, không có token.
MSAL khuyến nghị form_post; nếu chuyển sang form_post cần đổi và kiểm thử chính sách cookie.

## Luồng và kiểm soát

- `/api/auth/configuration`: chỉ báo login đã cấu hình hay chưa, không chứng minh Entra truy cập được.
- `/api/auth/login`: MSAL sinh state/nonce/PKCE. Lưu flow phía DB trong 10 phút,
  gắn với cookie ngẫu nhiên Secure/HttpOnly; xóa flow cũ của browser và flow hết hạn khi login mới.
- `/api/auth/callback`: tiêu thụ flow bằng DELETE RETURNING trước token exchange.
  Callback sai browser, hết hạn, trùng tham số hoặc replay bị từ chối.
- MSAL xử lý state/nonce/PKCE. PyJWT kiểm tra chữ ký RS256 qua JWKS tenant đã cấu hình,
  issuer v2, audience, expiry và các claims bắt buộc; kiểm tra thêm tenant ID/object ID.
  Không nhận JWT trực tiếp từ browser, không lưu access/refresh/ID tokens sau xử lý.
- Thành công tạo session mới, thu hồi session cookie cũ, giữ quyền hiện có từ DB.
  User bị disable không được đăng nhập lại. Tài khoản mới không tự được cấp quyền.
- `/api/auth/logout` chỉ kết thúc phiên ứng dụng, không đăng xuất Microsoft toàn công ty.
  Cần CSRF header; session không được tự gia hạn. Chưa có Entra front-channel logout.

Flow chứa PKCE verifier/nonce ngắn hạn trong DB: bảo vệ DB và backup như dữ liệu nhạy cảm.
Chưa có tác vụ dọn định kỳ khi không có login mới, giới hạn tốc độ login hoặc kiểm thử tải.

## Bằng chứng và phần cần nghiệm thu

Tests offline dùng MSAL thật với HTTP giả để kiểm tra state/nonce/PKCE và RSA synthetic để
kiểm tra chữ ký/issuer/audience/expiry. PostgreSQL tests kiểm tra cookie binding, flow hết hạn,
replay, user bị disable, tenant sai, session rotation và user mới không tự được quyền.
Không thay thế kiểm thử tenant thật, MFA/Conditional Access, TLS/proxy và nhiều worker đồng thời.

Sau khi có cấu hình: thử login, consent/MFA, account bị chặn, logout, session hết hạn,
revoked grants và hai discipline; ghi kết quả vào implementation-status.md.

Tham khảo: [MSAL code flow](https://msal-python.readthedocs.io/en/latest/),
[MSAL 1.39 OIDC implementation](https://github.com/AzureAD/microsoft-authentication-library-for-python/blob/1.39.0/msal/oauth2cli/oidc.py).
