# Quyền DB và retention

Cập nhật: 2026-10-07. Công cụ trong repo dành cho DB scheduler riêng; quyền/retention
trên staging cần IT duyệt và kiểm tra. Không chạy provisioning trên database chung.

## Tách người sở hữu schema và ứng dụng

`backend/sql/provision_roles.sql` dùng psql variables `owner_role` và `runtime_role`.
IT tạo hai LOGIN role riêng, không membership cho runtime, đặt password qua kênh
quản lý secret. Role migration sở hữu tables/sequences sau Alembic; runtime không sở
hữu database/schema/functions và không có quyền CREATE, TRUNCATE, TRIGGER hoặc role admin.

Runtime đọc cấu hình connection; được ghi đúng bảng nghiệp vụ cần cho API. Audit là
SELECT/INSERT, receipts không DELETE. `app_user.is_admin` và admin authority audit
chỉ operator/migration owner được thay đổi; backend không được tự bootstrap admin.
INSERT user mới dùng server default admin=false; UPDATE runtime chỉ tên/login locator,
không active/tid/oid/admin. Điều này không biến runtime DB credential thành quyền operator.

Quyền sửa/xóa object gắn với ownership trong PostgreSQL; chỉ REVOKE trên bảng không
loại được quyền owner. Xem [PostgreSQL 17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html).
Đối chiếu schema owner, function owner và role memberships cùng IT ngoài grants bảng.

Trình tự trên DB riêng mới:

1. DBA tạo database và hai role; grant CONNECT và schema USAGE/CREATE cho migration
   owner. Schema public phải thuộc DBA/migration owner, tuyệt đối không thuộc runtime.
   DBA không đặt runtime vào role khác. Không đưa password vào command line/lịch sử.
2. Nạp DSN migration owner vào Settings trong shell riêng; `uv run alembic upgrade head`
   từ backend. Không migrate bằng runtime hoặc superuser làm mọi table owner.
3. DBA chạy từ backend bằng service/password channel đã cấu hình riêng:

   ```sh
   psql -X -v ON_ERROR_STOP=1 -v owner_role=wos_owner -v runtime_role=wos_runtime -f sql/provision_roles.sql
   ```

4. Xác minh runtime không sở hữu object/membership, không CREATE schema/table/temp,
   ALTER/DROP table/trigger, UPDATE/DELETE/TRUNCATE audit hoặc nâng is_admin; kiểm tra
   login/session/PERSON/Planner/draft với DSN runtime. Migration owner vẫn upgrade được.
5. Mỗi migration mới phải review/reapply grants; bảng mới không tự được quyền write.
   DB hiện hữu khác owner phải có kế hoạch chuyển ownership riêng có backup; script
   fail khi tables/sequences sai owner, không tự sửa ownership hàng loạt.

Compose local đã tách `WOS_MIGRATION_DATABASE_URL` cho service migrate và
`WOS_DATABASE_URL` cho backend. `POSTGRES_PASSWORD` chỉ cho DB administrator. Hai
DSN đều được map vào Settings `WOS_DATABASE_URL` của từng process; backend không nhận
DSN migration. Compose chưa tự tạo role/provision và chưa cấu hình staging HTTPS/SSO.
Khởi tạo DB/role qua DBA trước khi chạy cả stack; không trỏ cả hai DSN vào admin role.

## Chính sách retention cần IT chốt

| Dữ liệu | Hiện tại / có thể dọn | Quyết định còn cần |
| --- | --- | --- |
| Login flow | Có expires_at; chỉ dọn đã hết hạn, không lưu token exchange/flow nội dung trong report | Tần suất cleanup/giám sát và backup chứa PKCE/nonce |
| Login session | Phiên cố định 8 giờ; chỉ dọn đã hết hạn, không gia hạn | Tần suất cleanup, emergency revoke và thời gian lưu backup |
| Draft/draft item | Giữ đến người dùng xóa theo API scoped/version; không tự purge theo tuổi | Tuổi nháp, thông báo trước xóa, restore/replay horizon |
| Draft submission receipts | Giữ; receipt còn cần chặn gửi trùng dù draft bị xóa | Replay horizon phải khớp hợp đồng client; hết hạn request cũ trước khi purge receipt |
| Upload batch/item | Giữ mọi state; pending/sending/unknown giữ recovery và khóa WO | Reconciliation/hold, liên kết retry, archive và durable dedup horizon |
| Audit/authorization/admin authority events | Append-only; runtime không sửa/xóa | Retention/archive, người được đọc, legal hold và purge đặc quyền được duyệt |
| Backup/log | Chưa có chính sách backup staging đã duyệt | RPO/RTO, encryption/access, offsite, thời hạn, rotation và restore diễn tập |

Không mặc định chọn 30/90/365 ngày cho dữ liệu nghiệp vụ. Cleanup expired auth là
công việc kỹ thuật theo expires_at, không thay quyết định retention của draft/audit.
Không xóa receipt để mở lại request cũ hoặc xóa unknown để bỏ khóa WO.

Các bước vận hành trước cleanup: dry-run số flow/session hết hạn, duyệt lịch chạy,
execute theo expires_at bằng công cụ, kiểm tra số đã xóa và chứng minh flow/session còn
hạn không thay đổi. Báo cáo chỉ ghi counts/cutoff, không identity/token/flow payload.
Từ backend dùng `uv run python cleanup_auth.py` cho dry-run, thêm `--execute` chỉ sau
khi duyệt lịch/cutoff và kiểm tra đúng DB. Local dry-run 07/10 có 6 session hết hạn,
0 flow hết hạn; không xóa hàng nào, chưa bật lịch tự động hay execute cleanup thật.

## Backup và restore trước rollout

IT ghi RPO/RTO, DB/volume/secret references cần phục hồi, người có quyền đọc backup,
window và thời hạn lưu. Thử restore vào DB cô lập cùng schema revision và grants;
chứng minh drafts/receipts/audit còn nguyên, unknown không tự retry, token session và
auth flow trong backup được xử lý theo chính sách. Kết quả quyền DB trên database test
không thay bằng chứng restore hoặc áp dụng trên Ubuntu staging.
