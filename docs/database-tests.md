# PostgreSQL integration tests

Đã kiểm tra lại ngày 2026-10-01 với PostgreSQL 17 trong Docker Desktop.
Không dùng database chung hoặc production. `compose.test.yaml` chỉ mở loopback port 55432,
lưu dữ liệu tạm trong RAM; dừng/recreate container có thể làm mất dữ liệu test.

1. Tạo `.cache/postgres-test.env` ở root với `WOS_TEST_DB_PASSWORD=<mật khẩu test riêng>`.
2. Tạo `backend/.env.integration` với `WOS_ENVIRONMENT=test` và
   `WOS_DATABASE_URL=postgresql+psycopg://scheduler_test:<mật khẩu đã URL-encode>@127.0.0.1:55432/scheduler_test`.
   Hai file được ignore; không đưa secret vào Git.
3. Chạy từ root:

```sh
docker compose -f compose.test.yaml --env-file .cache/postgres-test.env up -d --wait
```

4. Chạy từ `backend/`:

```sh
uv run --env-file .env.integration alembic upgrade head
uv run --env-file .env.integration alembic check
uv run pytest --run-db-tests -p no:cacheprovider --tb=short
```

Tests chỉ chấp nhận environment test, host 127.0.0.1, port 55432 và DB scheduler_test.
Biến môi trường có ưu tiên hơn file; không chạy trong terminal đang đặt cấu hình production.
Các tests dùng transaction/savepoint và rollback dữ liệu synthetic sau mỗi trường hợp.
Tests dùng SelectorEventLoop để psycopg async hoạt động trên Windows.

Đã kiểm tra upgrade từ DB trống, downgrade về base, upgrade lại và `alembic check`
không phát hiện lệch giữa model/schema. Downgrade xóa bảng: chỉ thực hiện trên DB test trống.
Vòng migration này không phải kiểm thử backup/restore, tải đồng thời hay độ bền qua
mất điện/restart DB. Diễn tập backup/restore riêng dùng hai database mới với dữ liệu
synthetic: xem [quy trình DB](database-operations.md#diễn-tập-cô-lập-bằng-dữ-liệu-synthetic).

Session API đọc grants mới mỗi request; logout kiểm tra CSRF rồi xóa session.
Session chỉ lưu hash của token; Secure cookie cần HTTPS. Callback Entra tạo session sau xác thực; xem [cấu hình SSO](entra-setup.md).

Draft service nhận snapshot từ reader tin cậy phía server, kiểm tra quyền và discipline
hiện tại trước khi trả dữ liệu nháp. API/UI lưu/mở/cập nhật/xóa/list nháp đã nối; reader dùng HTTP giả trong tests.
Migration 0004 lưu biên nhận chống gửi trùng, cùng transaction với thay đổi nháp.
Kiểm thử đồng thời dùng các connection/transaction PostgreSQL riêng, commit để kiểm tra lock waiting,
rồi xóa đúng các bản ghi synthetic của test; không dùng dữ liệu ngoài database test riêng.

Upload persistence commit state + audit intent trước khi trả quyền điều khiển cho caller;
caller tương lai phải kiểm tra lại scope/revision trước khi gửi Maximo. Recovery chỉ đổi
sending bị bỏ dở thành unknown, không gửi lại. Chỉ chạy recovery sau khi xác nhận worker
cũ đã dừng; chưa có worker lease hoặc bộ đối soát Maximo.

Audit trigger chặn UPDATE/DELETE/TRUNCATE, kể cả trên bảng rỗng. DB owner vẫn có thể
gỡ trigger; dùng [provisioning roles và retention](database-operations.md) để tách
runtime/migration owner. Áp dụng trên staging và restore còn cần IT nghiệm thu.

2026-10-07: test_db_roles tạo DB/owner/runtime tạm trong infrastructure đã guard,
chạy chính SQL provisioning và đăng nhập runtime thật để kiểm thử quyền DML và
các lệnh bị cấm. Test ưu tiên `psql` trên PATH; Windows local fallback chỉ container
test `wos-tests-db-1`. CI đảm bảo PostgreSQL client có mặt; không dùng tên container
Windows làm điều kiện bắt buộc trên runner Ubuntu. Password chỉ vào child environment,
không command arguments/logs; DB/roles tạm được dọn sau test.

2026-10-08: [mốc đầu P7](upload-workflow.md) thêm 29 PostgreSQL tests; toàn bộ backend
406 tests qua. Các ca concurrent duplicate/reservation/send dùng UUID schema tạm
trong đúng DB test đã guard, connection độc lập và commit thật; xác minh intent
visible trước fake transport và audit append-only. Schema tạm được dọn sau test;
không migrate DB app hoặc gọi Maximo thật. Finalizer kiểm tra exact source/full
selection/all confirmed; app chưa nối sender/worker/finalizer thật.
