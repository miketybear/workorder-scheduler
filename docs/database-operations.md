# Quyền DB và retention

Cập nhật: 2026-10-08. Công cụ trong repo dành cho DB scheduler riêng; quyền DB và
backup staging cần IT kiểm tra. Retention nghiệp vụ đã chốt bên dưới.
Không chạy provisioning trên database chung.

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

## Retention do chủ dự án chốt ngày 08/10

| Dữ liệu | Hiện tại / có thể dọn | Quyết định còn cần |
| --- | --- | --- |
| Login flow | Có expires_at; chỉ dọn đã hết hạn, không lưu token exchange/flow nội dung trong report | Tần suất cleanup/giám sát và backup chứa PKCE/nonce |
| Login session | Phiên cố định 8 giờ; chỉ dọn đã hết hạn, không gia hạn | Tần suất cleanup, emergency revoke và thời gian lưu backup |
| Draft/draft item | Không purge theo tuổi; tự xóa sau toàn bộ upload confirmed bằng read-back | Finalizer chưa có; phải liên kết đúng draft/version/members, giữ partial/conflict/unknown hoặc nháp sửa tiếp. Chủ động bỏ nháp scoped/version vẫn có |
| Draft submission receipts | Giữ; receipt còn cần chặn gửi trùng dù draft bị xóa | Giữ receipts kể cả khi nháp bị xóa; không bật purge |
| Upload batch/item | Giữ mọi state; pending/sending/unknown giữ recovery và khóa WO | Giữ upload history và khóa recovery; không bật purge |
| Audit/authorization/admin authority events | Append-only; runtime không sửa/xóa | Giữ audit append-only; quyền đọc và backup/restore do IT vận hành |
| Backup/log | Chưa có chính sách backup staging đã duyệt | RPO/RTO, encryption/access, offsite, thời hạn, rotation và restore diễn tập |

Chủ dự án chốt giữ nguyên dữ liệu nghiệp vụ và tự xóa nháp sau upload thành công.
HTTP 2xx chưa đủ: phải read-back toàn bộ items, lưu outcomes/audit bền vững,
khóa/đối chiếu version nháp trước xóa. Upload/finalizer chưa triển khai.
Không chọn 30/90/365 ngày cho dữ liệu nghiệp vụ. Cleanup expired auth là
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

## Diễn tập cô lập bằng dữ liệu synthetic

Từ `backend/`, cấu hình `.env.integration` theo [database tests](database-tests.md).
Chạy với PostgreSQL client cùng major version trên PATH:

```sh
uv run python backup_restore_rehearsal.py
```

Windows local có thể dùng binaries trong container test đã có:

```sh
uv run python backup_restore_rehearsal.py --docker-container wos-tests-db-1
```

Công cụ chỉ nhận cấu hình test `127.0.0.1:55432/scheduler_test`, tạo hai DB với
UUID riêng và dữ liệu giả lập; `scheduler_test` chỉ là điểm kết nối quản trị.
Không dump DB ứng dụng hoặc nhận tên DB nguồn/đích tùy ý. Với Docker, kiểm tra port
mapping của container trước khi chạy client. Không in DSN/password hoặc lưu backup
nghiệp vụ thật. DB/roles/archive tạm được dọn sau diễn tập.

Luồng kiểm tra gồm migrate nguồn tới head, seed nháp/receipt/upload/audit/quyền/phiên,
provision runtime, dump custom format và restore sang DB mới. Đối chiếu toàn bộ dữ
liệu, revision schema, owners/ACL, triggers append-only và các quyền runtime được
thử (đọc/sửa nháp, từ chối DDL/nâng admin/xóa receipt-upload/sửa audit); provision
lại quyền ở cấp database đích. Sau restore, recovery chỉ đổi sending bị bỏ dở thành
unknown và thêm audit; không có sender Maximo trong công cụ.

Archive giữ owners/ACL của các object. Role là object cấp cluster nên phải được
chuẩn bị riêng khi restore sang cluster khác; diễn tập cùng cluster không xác minh
phục hồi role/password từ secret manager. Xem tài liệu PostgreSQL 17 về
[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) và
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
Đây là kiểm chứng logic phục hồi, chưa nghiệm thu backup Ubuntu staging, RPO/RTO,
offsite/encryption/retention, disaster recovery khác cluster hoặc hiệu năng dữ liệu thật.

Kiểm chứng local ngày 08/10/2026: PostgreSQL 17 Docker, revision
`0008_admin_authority`, 17 bảng và 32 hàng synthetic đối chiếu nguyên vẹn sau restore.
Schema snapshot so constraints/indexes/columns (cả độ dài/precision)/triggers/functions,
table/function/schema owners/ACL và default privileges; chuẩn hóa riêng biểu diễn
cast varchar-array tương đương khi PostgreSQL
reparse SQL restore. Runtime role được thử bằng `SET ROLE`, chưa phải login runtime
trên DB staging. Recovery đổi đúng một sending cũ thành unknown, lần hai không đổi
thêm; unknown từ chối sending/confirmed khi chưa reconcile, unique index giữ khóa WO.
Recovery và reconciled transition chạy dưới runtime `SET ROLE`, kiểm tra current_user
trước recovery và sau rollback; confirmed reconciliation có audit outcome. Đã sửa
`FOR UPDATE OF upload_item` trong [upload persistence](../backend/app/audit/uploads.py)
để không đòi UPDATE privilege trên upload_batch khi join đọc actor. Không mở thêm quyền DB.
Lần Main chạy cuối: archive 48.174 bytes, SHA-256
`7082019d19aa870ea4ae24a1fa97bdd8fcb53a413c8041a6430b83cb8e83d818`,
cleanup complete. Archive synthetic được xóa; checksum nhận diện đúng lần diễn tập,
không phải một backup production được lưu. Toàn bộ 368 backend tests (234 fast +
134 PostgreSQL), Ruff lint/format và actionlint qua. Native client transport chưa
chạy local; Docker transport PostgreSQL 17 đã chạy. GitHub runner sau push còn pending.
