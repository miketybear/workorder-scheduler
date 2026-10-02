# Trạng thái triển khai — foundation

Cập nhật: 2026-10-02. Chưa phải ứng dụng nghiệp vụ hoàn chỉnh.

## Đã triển khai

- Khởi tạo Git và ignore secrets/cache/dependencies; đã có commits và remote GitHub.
- Backend FastAPI app factory, settings bắt buộc, live/readiness và session/logout endpoints dùng session DB và CSRF.
- Policy grants theo connection/discipline; session và draft service đọc grants từ DB.
- Validation payload allowlist, target intent, PM/CFT, ngày có timezone, PIC và duration.
- Models/migrations cho identity, grants, sessions, drafts, upload batches/items và audit; không seed credential.
- React overview và bảng demo giả lập: sửa ngày, khóa target PM/CFT, preview và reset.
- Dockerfiles và Compose phát triển local, migration service, DB volume và healthchecks.
- uv.lock, package-lock.json, scripts lint/test/typecheck/build và tài liệu chạy local.

## Bằng chứng kiểm tra

- Backend: 194 tests qua (HTTP mocks + PostgreSQL integration scenarios); suite không gọi Maximo/Entra thật.
- Frontend: 52 tests (UI + API boundary); TypeScript và ESLint qua; Vite production build thành công.
- Ruff lint/format qua.
- Alembic upgrade từ DB trống, downgrade về base và upgrade lại qua trên PostgreSQL 17 test; schema/model không lệch.
- `docker compose config --quiet` qua với credential giả chỉ để validate cấu hình.
- Trình duyệt local hiển thị overview, backend liveness và bảng demo; sửa DEMO-001 Finish
  từ 2026-09-29 sang 2026-10-01 hiển thị đúng before/after, Upload vẫn bị khóa.

Validation dùng Python 3.12.14 và Node.js 26.0.0 trên Windows. Có cảnh báo deprecation của
Starlette TestClient khi dùng HTTPX; tests vẫn qua, cần theo dõi khi nâng bộ test client.
Kiểm tra UI đã thực hiện trong panel trình duyệt hẹp; chưa thay thế kiểm thử desktop đầy đủ.

## Chưa xác minh / chưa triển khai

- Docker Desktop và PostgreSQL test đã chạy. Full application image builds chưa xác minh.
- Container image digest/scan, backup/restore và khả năng chạy Ubuntu chưa xác minh.
- Entra local và Onshore test đã cấu hình; đọc WO list/detail và 25 PIC E&I_N thành công,
  grant E&I chỉ xem từ PERSON và timezone Asia/Ho_Chi_Minh đã xác nhận. Offshore chưa kiểm chứng.
- Entra login/callback thật đã xác minh trên Windows local; logout/expiry, chính sách tenant và staging còn pending. Đã có scoped API list WO; đã có detail/create/restore draft; chưa có history, upload Maximo hoặc đối soát upstream.
- Draft đã có API/UI tạo/list/mở/cập nhật/xóa theo owner, stale-edit/version checks và duplicate receipts; audit vẫn là dịch vụ nội bộ. Recovery chỉ chuyển sending cũ sang unknown.
- Chưa tách DB runtime role/migration owner; chưa kiểm thử worker concurrency hay crash durability.
- Chưa có E2E với backend nghiệp vụ, kiểm thử 10 phiên, CI hay triển khai production.

## Bước tiếp theo

1. Kiểm thử Entra logout/expiry và chính sách tenant; triển khai đường quản trị grants có audit.
2. Mở rộng kiểm chứng detail/crew/PIC ngoài E&I Onshore test; xác minh revision/ETag.
3. Kiểm thử browser E2E cho nháp, hoàn thiện sửa nhiều dòng và triển khai upload có audit/đối soát.

## Entra login live local — 2026-10-02

Chủ dự án xác nhận đăng nhập browser thành công trên HTTPS localhost. Truy vấn chỉ đọc
PostgreSQL development riêng xác nhận một user đúng tenant, active, một session còn hạn,
không có admin và không có WO grants. Callback chỉ tạo session sau token exchange/JWT validation.
Đây là bằng chứng login/callback/session live cơ bản, không phải toàn bộ UAT Entra.
Chưa kiểm thử logout/expiry, sai tenant live, assignment, Conditional Access hoặc nhiều phiên;
chưa xác nhận MFA challenge. Không thêm/cấp quyền, không gọi Maximo hoặc chạy lại bộ tests.
Hướng dẫn: [Windows local](entra-local-windows.md).

## PERSON discipline — 2026-10-02

Đã triển khai nguồn grant read từ `mxperson.ct_discipline`, signed Entra login bỏ domain
biendongpoc.vn, binding duy nhất per connection và authorization audit append-only (migration 0005).
186 backend tests/Ruff qua, Alembic upgrade/schema check qua ở DB test và local SSO,
backend restart và HTTPS readiness 200. GET Maximo test mxperson HTTP 200: duongvq có E&I,
NHATNH có ct_discipline trống. Onshore test connection đã tạo có audit; chưa cấp grant cho chủ dự án.
Chủ dự án sau đó điền E&I và re-login, giao diện hiển thị E&I; DB local xác nhận signed login,
binding nhatnh, đúng một grant E&I/read, không admin, có audit binding/grant.
Login → PERSON → grant đã được kiểm chứng live cơ bản; chưa WO retrieve thật hoặc E2E nháp.
Xem [hợp đồng và giới hạn](person-access.md).

## Cập nhật bảng theo Excel

- Đã đối chiếu đủ 21 cột, đúng thứ tự sheet Work Order Scheduler của workbook gốc.
- Thêm thông tin progress, discipline, tag/system, actual dates, priority, PIC, target start và WOID.
- Cho sửa PIC/duration; Change Target? mở hai trường target cho WO hợp lệ; bỏ chọn khôi phục target gốc.
- Preview chỉ gồm dòng thay đổi có Upload? được chọn; PM/CFT vẫn khóa target.
- Cuộn ngang với cột Work Order cố định; dữ liệu vẫn giả lập, chưa kết nối Maximo.
- Typecheck, lint, 5 frontend tests và build đã qua.

## Palette 2026-09-28

Áp dụng màu theo ảnh tham chiếu: ground #f1f4f4, surface #e7eaeb, ink #171c1d,
accent #2e817d, tint #d7eeeb, deep #075a56. Các badge trạng thái dùng màu riêng;
SCHED dùng cùng họ màu WSCH nhưng giữ nguyên mã dữ liệu. Build/typecheck và lint đã qua.

## Persistence 2026-09-29

Session chỉ lưu token hash, cookie Secure/HttpOnly, CSRF logout và expiry; grants không nằm
trong cookie. Draft kiểm tra owner, scope và discipline hiện tại; lỗi reader thì không trả nháp.
Upload unique theo connection/site/WO và idempotency theo actor; intent và state cùng transaction.
Audit trigger chặn sửa/xóa/truncate; unknown không được tự retry.
Hướng dẫn và giới hạn kiểm thử: [database-tests.md](database-tests.md). Không thêm dependency.

## Entra SSO 2026-09-29

MSAL + PyJWT, flow một lần gắn cookie/expiry, session rotation, login/logout trên UI.
Migration 0003_login_flow đã áp dụng PostgreSQL; schema check qua. Không có WO grants tự động.
Tests MSAL offline và JWT RSA synthetic qua, chưa gọi tenant thật. MSAL cảnh báo khuyến nghị
form_post; hiện dùng query + SameSite=Lax, log không ghi query.
Xem [entra-setup.md](entra-setup.md) cho cấu hình, giới hạn và checklist tích hợp.

## Maximo reader 2026-09-29

GET /api/work-orders, registry UUID, API key header, TLS/CA và HTTP client riêng cho mỗi lần retrieve.
Đã đọc tĩnh tên trường VBA, không chạy macro/lấy key. Đã test pagination, scope/revocation,
identity site/WO, nullable fields, timeout, unsafe links, duplicate/loop và response limits.
109 backend tests + Ruff qua; không thay đổi frontend ở mốc này. Chưa gọi Maximo thật,
chưa có tính nhất quán snapshot trong paging hoặc revision phục vụ upload.
Chi tiết [maximo-reader.md](maximo-reader.md).

## Giao diện retrieve 2026-09-30

Route /work-orders đã nối API list WO; chọn scope từ grants, nhãn system/environment,
nhập ISO offset và hiển thị đủ cột Excel + Site. Chỉ đọc; demo chỉnh sửa vẫn riêng ở /demo.
Xóa dữ liệu khi scope/filter/phiên thay đổi hoặc kiểm tra lại quyền; chống phản hồi đến muộn.
18 frontend tests, TypeScript, ESLint và build qua. Backend không đổi, không chạy lại bộ
109 tests ở mốc này. Chưa xác minh browser/live Maximo, timezone nghiệp vụ hoặc E2E.

## Detail/PIC/draft API 2026-09-30

129 backend tests và Ruff qua, PostgreSQL thật với HTTP Maximo giả. Đã có detail + PIC,
tạo/mở draft với CSRF, scope và fresh baseline. Chưa có revision/stale-edit precondition,
UI chỉnh sửa hoặc remote writes. Frontend không đổi trong mốc này.


## Nháp và editor — 2026-10-01

API nháp đã có list/update/delete, baseline comparison token từ detail, version lock và
biên nhận request UUID được commit cùng nháp trong migration 0004. Gửi trùng payload không
nhân đôi nháp; version cũ hoặc baseline đổi trả 409. Grants/owner/upstream được kiểm tra lại.

/work-orders mở editor từ số WO, cho sửa lịch/PIC/duration và target có chủ đích (khóa PM/CFT),
preview trước/sau, reset, lưu/mở/cập nhật/xóa nháp một WO. Lỗi lưu giữ sửa; retry cùng nội dung
sử dụng lại request UUID. Giá trị duration và ngày khác cách viết nhưng cùng giá trị không tạo edit.

Kiểm tra phiên xóa bảng retrieve, ẩn editor rồi đọc lại WO/nháp trước hiện lại. Lỗi tạm thời giữ sửa
ở trạng thái ẩn; mất quyền/phiên xóa dữ liệu. Baseline đổi khóa lưu và hiển thị giá trị hiện tại.
Bảo vệ đổi scope/filter và liên kết; Back của browser chưa có blocker trong SPA.

131 backend + 46 frontend tests, lint/format/typecheck/build và Alembic upgrade/schema check qua.
PostgreSQL tests dùng HTTP Maximo giả; test đồng thời dùng transaction riêng đã xác minh một nháp
cho duplicate create và một cập nhật cho hai request cùng version. Không phải E2E/Maximo live.
Không thêm runtime dependency. Xem [hướng dẫn nháp](drafts.md) và [database tests](database-tests.md).

## Thu thập Maximo test — 2026-10-01

Chủ dự án cung cấp http://bd-maxdev.biendongpoc.vn và xác nhận môi trường test.
Chủ dự án xác nhận Onshore test, context path /maximo, không cần VPN và server chưa cài chứng chỉ.
Credential và OSLC contract còn chờ xác nhận; chủ dự án đã chọn HTTP riêng cho test.
DNS từ Windows phân giải được; HEAD HTTP root trả 403; HTTPS lỗi xác minh chứng chỉ.
Chưa kiểm tra từ Ubuntu hoặc gọi OSLC/authentication; chưa gửi credential hoặc ghi Maximo.
Chi tiết trong [checklist tích hợp](integration-intake.md).


## HTTP chỉ cho Maximo test — 2026-10-01

Chủ dự án cho phép HTTP riêng cho Onshore test. Maximo registry có allow_http_for_test=false
mặc định; HTTP cần opt-in true, DB connection environment=test và ứng dụng không ở production.
Guard chung áp cho list/detail/PIC và các API nháp trước/sau network I/O. Production startup
và runtime từ chối HTTP; không đổi yêu cầu HTTPS của Entra hoặc TLS verification của HTTPX.

107 fast + 40 PostgreSQL tests qua (147 tổng), Ruff lint/format qua. Tests mới kiểm tra opt-in,
production config/metadata, reclassification khi đang retrieve, HTTP detail/PIC/nháp và paging
không đổi origin/scheme. Frontend không đổi; không chạy lại frontend tests cho thay đổi này.
Không thêm dependency hoặc migration. Chưa gửi API key tới server test thật; OSLC contract,
credentials/grants/timezone và đường mạng Ubuntu còn pending.
