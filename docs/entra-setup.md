# Cấu hình Entra SSO

Luồng login/callback/session/logout đã triển khai. Đăng nhập/callback thật trên Windows local
đã xác minh ngày 2026-10-02. Chủ dự án xác nhận logout/login lại đúng;
expiry, chính sách tenant và staging còn cần nghiệm thu.
Không cần cấu hình Entra để chạy bảng demo; login khi thiếu cấu hình trả 503.
Staging/production không khởi động nếu thiếu Entra; cấu hình thiếu một phần luôn bị từ chối.

## Thông tin từ IT

1. App registration **single tenant**, platform **Web**, authorization-code flow.
2. Tenant ID, Application (client) ID và client secret qua kênh quản lý secret.
3. Redirect URI chính xác `https://<hostname>/api/auth/callback`, cùng origin với giao diện.
4. HTTPS với chứng chỉ browser/server tin cậy; mạng backend tới login.microsoftonline.com.
5. Cấu hình Enterprise Application yêu cầu assignment và gán nhóm/người được đăng nhập.

Mặc định ứng dụng chỉ yêu cầu OIDC login/profile. Tính năng ảnh tùy chọn dùng Microsoft
Graph delegated `User.Read`, không cấp quyền WO. WO grants nằm trong PostgreSQL theo connection + discipline.
User mới có identity theo tenant ID + object ID, không có grants và không có admin.
Không dùng email, roles hoặc nhóm từ browser làm bằng chứng quyền WO.
Planner grants có API/CLI audit; xem [Planner access](planner-access.md).
Bootstrap admin đầu tiên và UI Planner có công cụ riêng; không tự seed quyền quản trị.
Xem [Planner/admin](planner-access.md) và [nghiệm thu tenant/staging cùng IT](it-acceptance.md).

## Theo dõi thu thập — 2026-10-02

Đã nhận tenant/client ID và xác minh login/callback thật trên Windows local.
Điền thông tin không bí mật dưới đây khi chủ dự án/IT cung cấp.

| Thông tin | Trạng thái / yêu cầu |
| --- | --- |
| App registration và đầu mối IT | Chủ dự án báo đã tạo app registration (2026-10-02); chưa đối chiếu cấu hình portal |
| Directory (tenant) ID | `f9e06204-6d4e-4c6b-935b-52a3151e25a8` — chủ dự án cung cấp 2026-10-02 |
| Application (client) ID | `6a8601d2-efd9-42e4-b19b-c507f384c069` — chủ dự án cung cấp 2026-10-02 |
| Tên miền HTTPS cho môi trường kiểm thử | Chọn Windows local HTTPS (2026-10-02); staging chưa có tên miền |
| Redirect URI | Local: `https://localhost:5173/api/auth/callback`; login/callback thật thành công 2026-10-02 |
| Phạm vi tài khoản | Yêu cầu single-tenant theo thiết kế; chưa kiểm tra portal |
| Credential | Client secret trong backend `.env` được Git ignore; token exchange/callback thành công 2026-10-02; chưa nhận ngày hết hạn; không ghi giá trị |
| Người/nhóm được đăng nhập | Chưa nhận; xác nhận assignment và chính sách MFA/Conditional Access với IT |
| Tài khoản kiểm thử | Một identity Entra đã xác thực có PERSON binding và Planner Onshore test/E&I; roster/scopes còn lại chưa nhận; email không dùng làm proof quyền |
| Logout | Hiện chỉ logout phiên ứng dụng; chưa hỗ trợ Entra front-channel logout |

Bước tiếp theo: đối chiếu portal/assignment/MFA/Conditional Access, expiry/logout live,
staging HTTPS và roster/scopes còn lại; xem [kế hoạch sau đối soát](checklist-review.md).
Đã chuẩn bị chứng chỉ tin cậy, HTTPS frontend/API và PostgreSQL riêng trên Windows;
xem [hướng dẫn local Windows](entra-local-windows.md). MSAL đã đọc discovery tenant thật;
login trả 303 tới đúng tenant/callback, có PKCE và flow cookie Secure/HttpOnly.
Ở mốc login đầu tiên, chủ dự án báo browser login thành công; DB local xác nhận một user
đúng tenant và một phiên còn hạn, user active, chưa có admin hoặc WO grants. Sau đó cùng
ngày 02/10 đã có PERSON read/Planner Onshore E&I; vẫn không cấp admin. Chưa xác nhận MFA challenge hoặc
kiểm thử các chính sách chặn đăng nhập.
Chủ dự án xác nhận logout/login lại hoạt động đúng; SSO không hỏi lại mật khẩu là
hành vi được chấp nhận. Chưa kiểm chứng riêng cookie cũ bị từ chối trong browser.
Không gửi client secret, password hoặc token trong chat.
Thông tin credential bàn giao qua kênh quản lý secret và chỉ nạp vào backend.

### Tạo app kiểm thử

1. Đăng nhập Entra admin center bằng tài khoản công ty; kiểm tra đúng tenant.
2. Vào **Entra ID → App registrations → New registration**.
3. Tên đề xuất: **Work Order Scheduler - Test**; chọn tài khoản trong tenant công ty
   (**Single tenant** / **Accounts in this organizational directory only**).
4. Nếu màn hình có Redirect URI tùy chọn, để trống khi chưa chốt hostname HTTPS;
   bổ sung platform **Web** và callback chính xác sau. Không nhập hostname giả.
5. Chọn **Register**, lấy **Directory (tenant) ID** và **Application (client) ID**
   từ **Overview**. Chưa cần tạo secret trong bước thu thập ban đầu.

Nếu không có quyền tạo app, nhờ quản trị Entra thực hiện các bước trên.
Tạo app chưa đồng nghĩa đã cấu hình hoặc kiểm thử đăng nhập.

Hướng dẫn: [đăng ký ứng dụng với Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

Tham khảo Microsoft: [cấu hình MSAL và application ID](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration),
[quy tắc redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

## Nạp cấu hình backend

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


## Entra profile photo - 2026-10-28

Default: `WOS_ENTRA__PROFILE_PHOTO_ENABLED=true` (owner decision 2026-10-28; IT confirmed
the required permissions are set). Set it to `false` only if a tenant blocks it. IT checks
the app registration: **API permissions > Add a permission > Microsoft Graph
> Delegated permissions > User.Read**. No Application permission is needed.
`User.Read` normally permits user consent; tenant policy may require IT to **Grant admin
consent**. IT confirmed delegated `User.Read` and consent on 2026-10-28 (reported by the project owner);
the live photo is verified only after a fresh sign-in.
Allow outbound HTTPS from the backend to `graph.microsoft.com`.

When enabled, login requests `User.Read`. A denied optional permission starts one fresh
OIDC-only flow with new state/nonce/PKCE; identity validation is never bypassed. Keep the
flag false until consent is ready. Log out and log in again after enabling the feature.

The callback fetches `GET https://graph.microsoft.com/v1.0/me/photos/48x48/$value` once,
with a 5-second timeout and a 128 KiB limit, accepting JPEG/PNG only. The delegated token
is transient: no token is stored in the database, shared cache or browser. Only image
bytes/content type enter a process-local session cache (128 entries, 8-hour TTL,
served only while the database session remains valid). Logout/session rotation removes the old entry. No migration
or runtime dependency is needed; existing HTTPX/MSAL provide the required functionality.
Expired entries are purged on cache access/insertion. Restart, eviction or requests
reaching another worker can cause initial-letter fallback.
This tradeoff avoids persisting optional photo data; deployments requiring consistent
photos across workers would need a separate shared image-cache design.

`GET /api/auth/photo` authenticates the current session and serves only that session's
photo. The frontend `user` query parameter distinguishes browser URLs; it never selects
another person's photo. Missing photo/consent or Graph failure means 404; unauthenticated
requests receive 401. Images use `Cache-Control: private, max-age=0, must-revalidate`,
`Vary: Cookie` and validated content type. The same-origin avatar uses `alt=""` and falls
back to the initial on error, preserving size and account-menu behavior. Never enable
PII/token logging; the proxy logging rules above still apply.

Microsoft references: [profile photo endpoint and 48x48 size](https://learn.microsoft.com/en-us/graph/api/profilephoto-get?view=graph-rest-1.0),
[User.Read delegated permission and consent](https://learn.microsoft.com/en-us/graph/permissions-reference#userread).
