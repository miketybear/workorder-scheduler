# Work Order Scheduler

Ứng dụng web nội bộ thay thế luồng lập lịch trong WorkOrderScheduler_v4.2.xlsm:
retrieve WO từ Maximo, chỉnh sửa kế hoạch, xem thay đổi và upload kết quả.

**Trạng thái:** đã có backend FastAPI, frontend React, migrations và Compose
cho phát triển local. Bảng `/demo` dùng dữ liệu hoàn toàn giả lập, cho sửa ngày và xem before/after.
Đã có lưu session, dịch vụ nội bộ lưu nháp và trạng thái upload/audit trên PostgreSQL.
Đã có luồng Entra, giao diện phiên đăng nhập và API đọc WO có scope; chưa xác minh tenant/Maximo thật.
Route /work-orders đã nối API danh sách/chi tiết và nháp; bấm số WO để sửa lịch, PIC, duration,
xem before/after và lưu/mở/cập nhật/xóa nháp một WO. /demo vẫn dùng dữ liệu giả. Upload Maximo chưa triển khai.

## Phạm vi đã chốt

- Khoảng 10 người dùng đồng thời; frontend và backend riêng.
- React + TypeScript, Python + FastAPI, PostgreSQL.
- Ubuntu có Docker; triển khai dự kiến bằng Docker Compose qua HTTPS.
- Đăng nhập Entra ID SSO; backend sử dụng tài khoản tích hợp Maximo.
- Maximo 7.6.1.3; Onshore và Offshore là hai hệ thống độc lập.
- Planner chỉ xem và sửa WO của discipline được cấp quyền trong từng hệ thống.
- Cập nhật Scheduled Start/Finish, PIC, Estimated Duration và Target Start/Finish theo lựa chọn.
- Giữ quy tắc VBA: không đổi target của PM/CFT.
- Lưu người thao tác thực tế và lịch sử trước/sau trên web; Maximo nhận tài khoản tích hợp.

## Tài liệu

- [Kiến trúc và quy tắc nghiệp vụ](docs/architecture.md)
- [Danh sách công việc chi tiết](docs/todos.md)
- [Trạng thái và bằng chứng kiểm tra](docs/implementation-status.md)
- [Lý do chọn dependency](docs/dependencies.md)
- [Lập lịch và quản lý nháp](docs/drafts.md)
- [Hướng dẫn chung cho coding agent](AGENTS.md)
- [Backend](backend/AGENTS.md) / [Frontend](frontend/AGENTS.md)

## Thông tin cần bổ sung khi tích hợp

Hostname test do chủ dự án cung cấp; cấu hình Entra app registration; tài khoản tích hợp
và quyền object structure; ánh xạ người dùng/discipline/hệ thống; DNS và chứng chỉ HTTPS.
Bàn giao credential qua kênh quản lý secret, không đưa vào tài liệu hoặc mã nguồn.

## Chạy local không cần Maximo

Yêu cầu: Python 3.12 (đã kiểm tra 3.12.14), uv, Node.js 26.0.0 và npm.
Các lệnh dưới chạy từ thư mục dự án trong terminal tương ứng.

Backend:

```sh
cd backend
uv sync --frozen
```

Sao chép `backend/.env.example` thành `backend/.env`; cấu hình `WOS_ENVIRONMENT` và
`WOS_DATABASE_URL`. Có thể dùng URL PostgreSQL local giả lập để xem giao diện/health live,
nhưng readiness sẽ trả 503 nếu DB chưa chạy hoặc chưa migrate. Không có endpoint nghiệp vụ
nào được mở bằng cấu hình giả này.

```sh
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

Frontend, trong terminal khác:

```sh
cd frontend
npm ci
npm run dev
```

Mở `http://127.0.0.1:5173`. Vite proxy `/api` tới backend local. Mở `/demo` để thử
chỉnh ngày, preview và reset. Thay đổi demo mất khi rời trang/tải lại, không lưu lên server.

## Chạy nền tảng bằng Docker Compose

Compose hiện **chỉ dành cho local**, mở HTTP trên `127.0.0.1:8080`; chưa phải triển khai
production HTTPS. Database/backend không expose port ra host.

1. Docker daemon phải đang chạy.
2. Sao chép `.env.example` ở root thành `.env`.
3. Đặt `POSTGRES_PASSWORD` và `WOS_DATABASE_URL` với cùng mật khẩu. Host DB là `db`.
   URL-encode ký tự đặc biệt trong phần password của URL; không commit `.env`.
4. Chạy:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Service `migrate` chạy Alembic trước backend; readiness yêu cầu schema đúng revision.
Database lưu trong volume `postgres_data`. Không xóa volume để xử lý lỗi cấu hình.
Migration online đã kiểm tra trên PostgreSQL 17 test riêng; full application image builds chưa xác minh.

## Kiểm tra

Từ `backend/`:

```sh
uv run ruff check .
uv run ruff format --check .
uv run pytest -m "not integration"
```

Khi cấu hình PostgreSQL test đã sẵn sàng:

```sh
uv run alembic upgrade head
```

`uv run alembic upgrade head --sql` chỉ sinh SQL offline, không chứng minh migration đã chạy.

Từ `frontend/`:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`/api/health/live` kiểm tra tiến trình; `/api/health/ready` chỉ kiểm tra DB/schema, không chứng
minh Entra/Maximo hoạt động. `/api/auth/session` yêu cầu session DB hợp lệ;
session được cấp qua callback Entra đã xác thực; không có tài khoản demo bypass. Logout yêu cầu CSRF token.

HTTPS, xác minh SSO/Maximo thật, upload/history và hướng dẫn vận hành production
được theo dõi riêng trong backlog.

Kiểm thử PostgreSQL riêng: xem [hướng dẫn database test](docs/database-tests.md).

Cấu hình và giới hạn đăng nhập: [Entra SSO](docs/entra-setup.md).

Connector chỉ đọc và mapping VBA: [Maximo reader](docs/maximo-reader.md).

Mở `/work-orders` để retrieve theo quyền sau khi cấu hình Entra, grants và Maximo.
Nhập mốc đầu/cuối ISO có offset, ví dụ `2026-09-01T00:00:00+07:00` và
`2026-10-01T00:00:00+07:00` (chỉ dùng offset đã xác nhận). Bấm số WO để mở phần lập lịch; chỉ grant write được sửa/lưu/xóa nháp. Xem [hướng dẫn nháp](docs/drafts.md).
Bảng danh sách được xóa khi kiểm tra lại phiên; nội dung sửa được giữ nếu quyền và WO vẫn được xác minh.
Không dùng session giả để truy cập route này.
