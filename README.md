# Work Order Scheduler

Ứng dụng web nội bộ thay thế luồng lập lịch trong WorkOrderScheduler_v4.2.xlsm:
retrieve WO từ Maximo, chỉnh sửa kế hoạch, xem thay đổi và upload kết quả.

**Trạng thái:** đã có backend FastAPI, frontend React, migrations và Compose
cho phát triển local. Bảng `/demo` dùng dữ liệu hoàn toàn giả lập, cho sửa ngày và xem before/after.
Đã có lưu session, dịch vụ nội bộ lưu nháp và trạng thái upload/audit trên PostgreSQL.
Đã xác minh Entra login/callback local và GET PERSON/WO list/detail/crew Onshore test E&I;
nháp đơn live đã kiểm tra. Conditional/field contract và browser upload/restore CM
Onshore test đã nghiệm thu ngày 2026-10-08; PM browser upload/restore ngày và duration
đã qua ngày 2026-10-09; PM nhóm hai WO và CFT duration-only đã upload/restore exact.
Theo quyết định chủ dự án ngày2026-10-09, nghiệm thu chức năng theo hai nhóm target;
không yêu cầu browser upload/restore riêng từng mã WO type. Nhóm hỗn hợp PM/CFT/REC
đã upload/restore exact sáu trường gốc:7requests204/43audit events, nháp cũ nguyên vẹn.
Quyền read có thể lấy từ [PERSON.ct_discipline](docs/person-access.md) theo Entra login đã xác thực.
Route /work-orders đã nối API danh sách/chi tiết và nháp; bấm số WO để sửa lịch, PIC, duration,
xem before/after và lưu/mở/cập nhật/xóa nháp một hoặc nhiều WO (tối đa 200).
Bảng gọn 7 cột có panel đầy đủ thông tin WO; chọn nhóm để áp lịch/PIC/duration,
Undo, sửa ô và dán vùng Excel. System, site và WOID không hiển thị; site/WOID vẫn
thuộc định danh phía backend. Giữ workspace trong RAM khi đổi route; quay lại tab chỉ
kiểm tra phiên/quyền, không tự tải lại WO. Có thời điểm cập nhật, nhãn dữ liệu cũ sau
5 phút và nút Cập nhật giữ bộ lọc/phần sửa. Chọn Scheduled Start;
Scheduled Finish chỉ đọc, tự tính khi đổi Start hoặc Duration (giờ), cả đơn lẻ và nhóm.
Target Start/Finish có date/time picker; chọn ngày tự bật Change Target, PM/CFT bị khóa.
Múi giờ kết nối vẫn dùng để tính ngày nhưng không hiện nhãn; dán Excel theo 3 cột Start, PIC, Duration.
/demo vẫn dùng dữ liệu giả. P7 có preview, sender native `_rowstamp`, durable receipt,
audit trước gửi, trạng thái từng WO, continue tối đa 10 WO và read-only reconcile.
Upload dùng chung sender cho tám mã type hiện có trên Onshore test, chỉ khi opt-in
trong app development/test. PM/CFT cấm target; CM/REC/OVERHAUL/MoD/General/Routine
chỉ đổi target khi có intent rõ ràng. Production/staging và Offshore vẫn khóa.
Browser đã upload duration
5→6→5 và xác nhận read-back/hoàn tất đúng nháp. PM đổi lịch có Maximo recalc25→21;
restore ngày rồi duration-only trả đúng sáu trường gốc/25h. PM nhóm giữ original
riêng từng WO, restore exact26/24h; CFT6→6.25→6h giữ lịch null và khóa target.
Retrieve nhiều trang trên test bị chặn vì next-page mang host production. Chủ dự án
xác nhận test dùng DB sao chép production; không yêu cầu sửa server trong mốc này.
Production pagination chưa được kiểm chứng; URL guard vẫn giữ.
History đầy đủ và worker/lease còn pending.

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
- [Đối soát checklist 1–6 và kế hoạch tiếp theo](docs/checklist-review.md)
- [Trạng thái và bằng chứng kiểm tra](docs/implementation-status.md)
- [Lý do chọn dependency](docs/dependencies.md)
- [CI trên GitHub Actions](docs/ci.md)
- [Kiểm tra container và Linux](docs/container-checks.md)
- [Nhóm 100/200 WO và phím/focus](docs/large-batch-keyboard-tests.md)
- [Quản trị Planner và bootstrap admin](docs/planner-access.md)
- [Quyền DB và retention](docs/database-operations.md)
- [Hồ sơ nghiệm thu cùng IT](docs/it-acceptance.md)
- [Write contract và ETag trước upload](docs/maximo-write-contract.md)
- [P7: luồng upload từ nháp và cổng write contract](docs/upload-workflow.md)
- [Lập lịch và quản lý nháp](docs/drafts.md)
- [Hướng dẫn chung cho coding agent](AGENTS.md)
- [Cấu hình Main và ba sub-agent Codex](docs/codex-agents.md)
- [Backend](backend/AGENTS.md) / [Frontend](frontend/AGENTS.md)

## Thông tin cần bổ sung khi tích hợp

Đã nhận host Onshore test và chọn HTTP riêng cho test; xem [checklist tích hợp](docs/integration-intake.md).
App registration/callback local và API key test đã dùng thành công. Còn cần IT đối chiếu
tenant policy, tài khoản tích hợp/quyền tối thiểu, metadata/write contract và các scope
khác; staging DNS/HTTPS, Ubuntu routing và roster planner chưa nghiệm thu.
Bàn giao credential qua kênh quản lý secret, không đưa vào tài liệu hoặc mã nguồn.

## Chạy local không cần Maximo

Yêu cầu: Python 3.12.14, uv 0.11.9, Node.js 26.0.0 và npm.
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

`/work-orders` tự nhận phạm vi tài khoản đăng nhập. Nếu chỉ có một phạm vi hợp lệ,
không cần chọn hệ thống/discipline. Trang `/settings` cho chọn trong các kết nối/URL
đã cấu hình và đã được cấp quyền; lựa chọn lưu riêng cho tài khoản trên PostgreSQL,
dùng lại ở các lần đăng nhập sau. Discipline luôn lấy từ quyền server. Xem
[Settings tài khoản](docs/account-settings.md); chạy migration tới head trước khi dùng API mới.

## Chạy nền tảng bằng Docker Compose

Compose hiện **chỉ dành cho local**, mở HTTP trên `127.0.0.1:8080`; chưa phải triển khai
production HTTPS. Database/backend không expose port ra host.

1. Docker daemon phải đang chạy.
2. Sao chép `.env.example` ở root thành `.env`.
3. Đặt `POSTGRES_PASSWORD` cho DB administrator; tạo migration owner và runtime role
   riêng theo [quy trình DB](docs/database-operations.md). Nạp DSN owner vào
   `WOS_MIGRATION_DATABASE_URL`, DSN runtime vào `WOS_DATABASE_URL`; host DB là `db`.
   Provision roles/grants trước khi chạy toàn stack; Compose không tự tạo các role này.
   URL-encode ký tự đặc biệt trong password; không commit `.env`.
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

[Workflow CI](.github/workflows/ci.yml) chạy các kiểm tra backend/frontend và migration
round-trip trên PostgreSQL test riêng cho mỗi push/PR. Xem [phạm vi và giới hạn](docs/ci.md).

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

Diễn tập backup/restore trên DB mới với dữ liệu synthetic:
[quy trình và giới hạn](docs/database-operations.md#diễn-tập-cô-lập-bằng-dữ-liệu-synthetic).

Cấu hình và giới hạn đăng nhập: [Entra SSO](docs/entra-setup.md).
Kiểm thử HTTPS/Entra trên máy Windows: [hướng dẫn local](docs/entra-local-windows.md).

Connector chỉ đọc và mapping VBA: [Maximo reader](docs/maximo-reader.md).

Mở `/work-orders` để retrieve theo quyền sau khi cấu hình Entra, grants và Maximo.
Nhập mốc đầu/cuối ISO có offset, ví dụ `2026-09-01T00:00:00+07:00` và
`2026-10-01T00:00:00+07:00` (chỉ dùng offset đã xác nhận). Bấm số WO để mở phần lập lịch; chỉ grant write được sửa/lưu/xóa nháp. Xem [hướng dẫn nháp](docs/drafts.md).
Bảng và phần sửa được giữ khi phiên/quyền không đổi; đổi tài khoản/quyền/hệ thống hoặc
hết phiên xóa workspace. Lỗi xác minh quyền ẩn nội dung đến khi kiểm tra lại thành công.
Không dùng session giả để truy cập route này.

Cấp/thu hồi Planner có audit và điều kiện PERSON: [hướng dẫn Planner](docs/planner-access.md).
