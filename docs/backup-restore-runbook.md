# Runbook backup và restore

Cập nhật: 2026-10-10. Người thực hiện: backup operator/DBA/restore owner được IT chỉ định.
Chuẩn bị theo [policy chưa duyệt](backup-policy.md); chưa có quyền bật timer hoặc
restore DB vận hành từ task này. Lệnh dưới là Bash trên Ubuntu, không chứa secrets.

## Trước backup

1. Ghi approval reference, expected source identity, schema revision và release digests;
   chốt lịch/RPO/RTO/destination/retention/key custody theo policy. Kiểm tra đủ
   PostgreSQL17 psql/pg_dump/pg_restore, Python3.11 trở lên, OpenSSL có CMS GCM và findmnt.
2. DBA cấp backup principal đọc toàn bộ bảng/sequences cần dump; không dùng runtime
   DSN hay phát thêm quyền mutation/audit cho job. Kiểm tra backup thực bằng login
   principal này, đặc biệt quyền tất cả bảng mới sau migration.
3. Cấu hình libpq service/passfile private ngoài repo, file600/thư mục700.
   Network service phải trỏ đúng connection đích; dùng TLS verify-full/CA khi đi
   qua network không phải local trusted transport. Không copy credential vào CLI.
4. Xác minh destination mount/source và failure domain, public recipient cert/fingerprint,
   đủ disk local/temp/offsite. Private key chỉ restore custodian giữ. Cập nhật
   expected revision/release/config có kiểm soát sau mỗi deploy; không migration
   đồng thời với backup. Không chỉnh expected identity để cho job pass khi trỏ sai DB.
5. Chạy job thủ công với private config đã duyệt, kiểm tra exit status và complete set.
   Trước migration, dừng web/backend và đợi quiesce theo [staging runbook](staging-deployment.md).
   Backup định kỳ có thể snapshot online; đó không phải snapshot đồng bộ với Maximo.

Hướng dẫn cài service/timer/config và command cụ thể được liên kết ở phần job phía dưới.
Job chưa duyệt phải fail closed; thất bại không được xóa bản cũ hoặc mở rollout.

## Job và mẫu cấu hình Ubuntu

Files: [backup_job.py](../deployment/backup/backup_job.py),
[config JSON](../deployment/backup/config.json.example),
[service file](../deployment/backup/pg_service.conf.example),
[passfile](../deployment/backup/pgpass.example),
[systemd service](../deployment/backup/wos-backup.service.example),
[timer chưa có lịch](../deployment/backup/wos-backup.timer.example).

Operator tạo account `wos-backup` riêng; cài job read-only ở
`/opt/workorder-scheduler/deployment/backup/backup_job.py`. Chuẩn bị
`/etc/wos-backup` private và work directory `/var/lib/wos-backup` thuộc account,
mode700; config/service/passfile600. Kho `/mnt/wos-backup` phải là mount được duyệt,
root directory private cho account. Thư mục mountpoint bên dưới khi chưa mount phải
thuộc root và không cho account backup ghi, để mất mount không rơi về disk local.
Sample service yêu cầu mount này và chỉ cho
ghi work/destination. Nếu IT chọn paths khác, đổi đồng bộ JSON và systemd
RequiresMountsFor/ReadWritePaths/ExecStart; không thêm quyền ghi rộng để né sandbox.

Điền `approval` với decision reference, owner, RPO/RTO (giây), schedule/retention
references và offsite approval. `release_reference` ghi cặp image digests/Git
revision trong approved release inventory. `expected` phải khớp DB/server IP/port/
major17/schema revision; `recipient_sha256` là SHA256 certificate DER, hex64 không
dấu hai chấm, không phải checksum file PEM. `expected_mount_source` lấy mount/source
đã IT xác minh, không lấy một cách máy móc từ local disk để bỏ qua offsite requirement.

```sh
python3 /opt/workorder-scheduler/deployment/backup/backup_job.py \
  --config /etc/wos-backup/config.json
```

Chạy dưới account `wos-backup` sau khi config/policy được duyệt; lệnh không chứa
credential. Sample config chưa điền phải fail trước dump. Sau manual verification,
IT có thể install service và `systemctl start wos-backup.service`; chỉ sửa/install
timer khi lịch approved. Mẫu timer cố ý có OnCalendar chưa hợp lệ và không có Install
section, không bật nó nguyên trạng. Xác minh unit bằng systemd-analyze trên Ubuntu.
OnFailure notification/freshness monitoring do IT tích hợp trước khi bật định kỳ;
service template một mình chưa gửi alert và không đáp ứng monitoring acceptance.

**Transport còn cần IT:** Compose hiện không publish DB port và chưa cấu hình
PostgreSQL TLS. Job systemd chạy trên host không tự resolve hostname Docker `db`.
IT phải cung cấp route/private DB hostname/TLS/CA phù hợp cho service file, hoặc
review runner trong network riêng với trusted local transport. Không mở5432 ra
public, cấp Docker socket cho backup principal hay tắt TLS trên network không tin cậy.
Expected IP/port là giá trị server trả, có thể khác port publish/NAT phía client.

Output set: `database.dump.cms`, `metadata.json.cms`, `manifest.json`, `COMPLETE`.
Chỉ hai file `.cms` chứa dump/source/schema/release details. Manifest plaintext
chỉ opaque run ID/times/cipher/encrypted hashes; không public WO/credential payload.
Backup directory publish hoàn chỉnh sau encryption; `.wos-incomplete-...`/partial directories
không được coi là complete backup. Không có chức năng retention-delete tự động.

## Khi backup lỗi hoặc temp còn lại

Operator kiểm tra source/mount/permissions/cert/space/client versions và giai đoạn
thất bại. Không paste stderr/secret files vào ticket. Giữ trạng thái failure tới
khi có backup complete mới đáp ứng freshness; lỗi cấu hình không cho phép fallback
backup sang disk trên cùng máy hoặc bỏ encryption.

Sau crash/power loss, xác minh không có process/lock backup đang chạy trước khi
quarantine thư mục temp của đúng run. Temp có thể chứa WO/auth payload. Xóa chỉ
temp đã xác minh thuộc job; không xóa theo glob toàn bộ thư mục kho backup, không
xóa archive complete hoặc DB volume để xử lý lỗi. Dùng encrypted local disk theo policy.

## Restore: cô lập trước, mở dịch vụ sau

### 1. Đóng ingress và khóa ghi

Restore owner mở incident `DR-...`, ghi thời điểm sự cố, backup được chọn và người
duyệt. Dừng web/backend và mọi sender/worker cũ; thu hồi outbound Maximo write tại
network/credential level nếu có thể. Đảm bảo host cũ không tự restart gửi writes.
Staging luôn khóa upload; giữ environment staging và không thêm test write contract.

Giữ nguyên DB/volume hỏng để điều tra. Chuẩn bị cluster/host cô lập, không kết nối
Maximo write, không publish ingress, không có job continue/retry. Tạo DB mới tên
`wos_restore_<12 hex ngẫu nhiên>`; không restore đè DB `scheduler` hoặc dùng `--clean`.

### 2. Chọn và xác minh backup

Chọn complete set từ kho tin cậy, xác minh run ID, inventory hashes, timestamp,
certificate fingerprint/provenance và decrypted metadata expected source/schema/releases.
Nếu checksum/cipher/authentication lỗi thì dừng và thử bản được duyệt khác; không
bỏ verify hay ép sử dụng file partial. Metadata `started_at` là mốc trước khi job
mở snapshot, dùng bảo thủ để tính tuổi dữ liệu/RPO và bắt đầu khoảng đối soát.
Snapshot ID không phải timestamp. Ghi completion riêng; không lấy finished_at/mtime
làm mốc dữ liệu còn giữ được. IT phải kiểm tra đồng bộ clock UTC giữa các hệ thống.

Custodian đưa encrypted set và khóa qua kênh quản lý vào restore host. Decrypt trong
thư mục700/file600 trên storage mã hóa, giữ private-key password trong protected
passfile/channel, không argv hoặc shell history. `openssl cms -decrypt` phải thành công
trước `pg_restore`; output lỗi có thể là plaintext một phần nên phải quarantine/xóa.
Không restore trực tiếp từ stream chưa kiểm chứng authentication.

Sau kiểm tra trusted-set manifest hashes, custodian decrypt từng file. Giá trị biến
chỉ là paths private đã provision; `key_pass_file` chứa password khóa trong protected
file, không chứa secret trực tiếp trên CLI:

```sh
openssl cms -decrypt -binary -inform DER -in "$backup_set/metadata.json.cms" \
  -recip "$recipient_cert" -inkey "$recipient_key" -passin "file:$key_pass_file" \
  -out "$restore_dir/metadata.json"
openssl cms -decrypt -binary -inform DER -in "$backup_set/database.dump.cms" \
  -recip "$recipient_cert" -inkey "$recipient_key" -passin "file:$key_pass_file" \
  -out "$restore_dir/database.dump"
```

Kiểm tra exit status của từng lệnh; không chạy lệnh sau nếu lệnh trước fail.
Tạo `restore_dir` private trước khi decrypt; không paste decrypted metadata vào ticket.

### 3. Chuẩn bị roles và phục hồi archive

DBA tái tạo đúng roles/ownership với password từ secret manager; runtime không có
owner/membership/superuser/DDL quyền. Khôi phục cluster/database-level settings
và grants theo inventory riêng; đừng giả định dump tự tạo roles.

Lệnh dùng libpq service alias riêng cho **DB restore mới**; operator đối chiếu
`current_database()`, `inet_server_addr()`, `inet_server_port()` trước chạy. Hai
biến dưới chỉ là tên alias đã provision, không DSN/password:

```sh
restore_service=wos_isolated_restore
restore_dir=/absolute/protected/restore-case-directory
psql -X --no-password --dbname="service=$restore_service" -v ON_ERROR_STOP=1 \
  -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
pg_restore --no-password --exit-on-error --single-transaction \
  --dbname="service=$restore_service" "$restore_dir/database.dump"
```

Đặt `PGSERVICEFILE`/`PGPASSFILE` từ secret channel riêng, chưa mở backend. Không dùng
`--no-owner`/`--no-acl` để bỏ lỗi quyền. Đích phải empty và trusted source: archive
có thể thực thi DDL/function khi restore. Nếu restore fail, giữ ingress đóng;
DB mới chưa đạt nghiệm thu không được promote. Archive lớn có thể cần restore
strategy riêng được DBA review, không tự bỏ atomic/error checks.
[PostgreSQL17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)

### 4. Kiểm tra dữ liệu, quyền và vô hiệu hóa auth

1. Đối chiếu schema revision và bảng/columns/indexes/constraints/functions/triggers/
   owners/ACL với baseline. Chạy lại `backend/sql/provision_roles.sql` bởi DBA với
   owner/runtime đúng; kiểm tra database-level CONNECT/TEMP grants riêng.
2. Đối chiếu counts và nội dung theo evidence trong encrypted inventory: drafts,
   receipts, upload states, audit, bindings/grants/preferences. Không tạo mới schema
   bằng migration trước khi xác minh đúng revision được restore; app image phải khớp.
3. Theo chính sách session được duyệt, chạy
   [auth invalidation](../deployment/backup/invalidate_restored_auth.sql) chỉ trên DB
   mới cô lập. Script yêu cầu expected DB đúng tên restore và case reference; xóa
   toàn bộ restored sessions/flows trong transaction, không chạm nháp/receipts/audit.

   ```sh
   psql -X --no-password --dbname="service=$restore_service" -v ON_ERROR_STOP=1 \
     -v expected_database="$restore_database" -v restore_case="$restore_case" \
     -f deployment/backup/invalidate_restored_auth.sql
   ```

   `restore_database` lấy tên DB mới đã DBA kiểm tra; `restore_case` là incident
   `DR-...` đã duyệt. Ghi counts và operator action trong incident log riêng;
   không ghi token/flow/user payload. Cookie/callback trước restore phải bị từ chối.
4. Login runtime thật thử quyền: từ chối DDL/nâng admin/sửa-xóa audit/xóa receipts,
   và cho phép scoped draft APIs. Kiểm tra authority/grants hiện tại với nguồn
   Entra/PERSON/Planner được quản lý; quyền trong backup có thể đã lỗi thời.

### 5. Đối soát khoảng Maximo sau snapshot

Restore Scheduler không hoàn tác Maximo. Upload sau snapshot có thể đã thành công
nhưng receipt/audit không có trong backup. Do đó không chỉ kiểm tra rows `unknown`:

- Xác định khoảng từ snapshot tới khi sender/host cũ được cô lập. Lấy evidence
  independent Maximo audit/integration logs/incident records bằng quyền read được cấp.
- Đối chiếu connection/site/WOID, actor/request/attempt nếu có, before/after/revision;
  không ghép bằng WONUM đơn lẻ. Phân biệt còn `pending`, bỏ dở `sending`, `unknown`
  và writes hoàn toàn không nằm trong DB restore.
- Giữ WO chưa đối soát bị khóa ghi ở quy trình/network. Hàm recovery hiện có chỉ
  đổi abandoned sending thành unknown/audit sau khi ownership đã được giải quyết;
  không tự chạy sender, không trực tiếp SQL đổi unknown thành confirmed hoặc xóa
  receipt/lock. Operator dùng reconcile có audit theo [upload workflow](upload-workflow.md).
- Nếu thiếu evidence để biết outcome thì vẫn unknown/chưa được phép ghi. Không suy
  từ HTTP2xx cũ hoặc hiện tại giống before rằng chưa từng upload; thay đổi sau đó có
  thể do người khác. Ghi quyết định và các WO chưa giải quyết trong incident.

Upload production vẫn chưa mở trong ứng dụng; runbook này không cấp quyền bật nó.
Nếu chưa có hệ thống đối soát đầy đủ, chỉ có thể mở phạm vi read/draft được nghiệm
thu và giữ mọi Maximo writes bị chặn ngoài ứng dụng theo kế hoạch IT.

### 6. Nghiệm thu và cutover

Restore owner ghi schema/image digests, data/grants/auth checks, Maximo gap, backup
timestamp, RPO thực và elapsed RTO. Chỉ cutover khi mọi gate cần thiết có người duyệt.
Đổi runtime/migration service refs sang DB mới có kiểm soát; proxy/SSO callback và
cert/CA không đổi ngầm. Khởi động backend/web với image/schema tương thích, read-only
smoke trước, thử login mới và expired cookies; kiểm tra discipline isolation.

Giữ old host/sender bị cô lập, tránh hai stack cùng ghi; restart policies và timer
phải được kiểm tra sau cutover. Dọn plaintext/private-key material theo policy và
ghi counts/hashes an toàn, không giữ secret trong ticket. Khôi phục lịch backup
chỉ sau phê duyệt và bảo đảm job trỏ đúng DB mới/revision/release/destination.

## Checklist diễn tập

Diễn tập có cases: wrong source/missing approval/lost mount/dump fail/encrypt fail,
backup complete và decrypt/restore cluster mới, role/ACL/runtime login, auth reset,
upload sau snapshot không có receipt, unknown không tự retry, crash temp cleanup,
key rotation/bản cũ decrypt và RPO/RTO đo được. Đánh dấu chỉ các ca có evidence.
Job synthetic rehearsal cũ trong [DB operations](database-operations.md) không phải
job vận hành và không đủ để ký cả checklist này.

### Kiểm tra công cụ bằng dữ liệu giả lập

[Unit tests](../deployment/backup/tests/test_backup_job.py) chạy bằng stdlib;
Linux kiểm tra thêm file permissions, flock và subprocess cancellation:

```sh
python3 -m unittest discover -s deployment/backup/tests -p 'test_backup_job.py'
```

[Rehearsal mới](../deployment/backup/tests/run_rehearsal.py) dùng clients thật,
CMS encryption/decryption và DB source/restore tạm do chính run tạo. Chỉ chạy khi
hạ tầng test `scheduler_test` tại loopback55432/container `wos-tests-db-1` đã được
chuẩn bị theo DB operations; guard từ chối host/database tùy ý. Không dùng DSN DB
ứng dụng. Build image CLI thử từ repo root, rồi chạy bằng môi trường backend test:

```sh
docker build -f deployment/backup/tests/Dockerfile.synthetic \
  -t wos-backup-synthetic:local .
cd backend
uv run python ../deployment/backup/tests/run_rehearsal.py
```

Rehearsal kiểm tra snapshot vẫn giữ dữ liệu trước mutation concurrent, encrypted
inventory/counts, restore schema/data, ciphertext corruption, wrong source và auth
invalidation guards. Chạy cùng cluster test không chứng minh disaster recovery sang
cluster khác, offsite, TLS transport, runtime login hay Maximo-gap reconciliation.
