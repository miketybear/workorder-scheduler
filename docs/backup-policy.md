# Policy backup — bản chuẩn bị, chưa duyệt vận hành

Cập nhật: 2026-10-10. Áp dụng database Scheduler riêng; Maximo là hệ thống dữ liệu
WO authoritative và có quy trình backup riêng của IT. Tài liệu này chuẩn bị cho
staging/production, không tự đặt lịch hay thời hạn lưu dữ liệu nghiệp vụ.

## Quyết định cần phê duyệt

| Quyết định | Trạng thái / người cần chốt | Điều kiện để bật job |
| --- | --- | --- |
| RPO: mất tối đa bao lâu dữ liệu | Chưa duyệt; chủ dự án và IT | Ghi số phút/giờ, bao gồm các lần job lỗi và khoảng trễ chuyển bản ra ngoài server. |
| RTO: phục hồi dịch vụ trong bao lâu | Chưa duyệt; chủ dự án và restore owner | Bao gồm lấy khóa, tải/decrypt, restore/grants, đối soát Maximo và nghiệm thu. |
| Lịch chạy / window / timezone | Chưa duyệt; operator | Lịch đáp ứng RPO đo được; không chạy trùng migration; timer ghi rõ timezone. |
| Nơi lưu ngoài máy chủ / offsite | Chưa duyệt; IT storage | Kho riêng failure domain, mount/source được kiểm tra, quyền truy cập và cảnh báo mất mount. |
| Thời hạn giữ backup và rotation | Chưa duyệt; chủ dự án/IT | Chính sách backup tách retention nghiệp vụ; không tự xóa audit/receipts/uploads trong DB. |
| Backup operator / restore owner / người duyệt | Chưa chỉ định đầy đủ | Ghi người thay thế, incident channel, khả năng lấy backup và khóa khi server mất. |
| Recipient cert / private key / rotation | Chưa cấp; IT security | Public cert/fingerprint được xác minh; private key ngoài backup host, quyền riêng và diễn tập lấy khóa. |
| Session sau restore | Đề xuất vô hiệu hóa tất cả login sessions/flows trong DB restore cô lập | IT/chủ dự án duyệt đề xuất; đăng nhập lại bắt buộc trước mở ingress. |
| Provenance / quyền sửa backup | Chưa nghiệm thu kho lưu | Repository ACL/immutability hoặc kiểm soát tương đương; checksum không chứng minh ai tạo backup. |

Owner ghi quyết định/giá trị/ngày/approval reference trong hồ sơ IT được quản lý.
Mẫu job giữ approval false và timer chưa có lịch chạy thật. Không đổi flag để né
quyết định còn thiếu. RPO/RTO là mục tiêu được nghiệm thu, không suy từ job exit0.

## Dữ liệu và tài sản phục hồi

Backup DB đầy đủ gồm schema/revision, draft/items, submissions/receipts,
upload batch/items mọi state, audit/authorization/admin events, users/grants,
PERSON bindings, connection registry, account preferences và auth sessions/flows.
Auth payloads nhạy cảm được giữ trong encrypted backup và xử lý khi restore.

Inventory ngoài DB phải giữ riêng trong kho operator/secret manager:

- Cặp backend/web release digests, Git revision và schema compatibility.
- Compose/nginx/cấu hình public, DNS/certificate full chain, CA bundle và mount layout.
- Roles/ownership/ACL/database-level grants; role passwords lấy từ secret channel,
  không đưa password hash vào báo cáo hoặc manifest plaintext.
- Entra/Maximo credentials, DBA/runtime/owner secret references và cách rotation;
  job DB không copy các private env files vào backup set.
- Recipient certificate, fingerprint và danh mục private keys có thể decrypt bản cũ.

`pg_dump` chỉ backup một database, không tự backup cluster roles; phải chuẩn bị
role/secret recovery riêng. Archive custom format giữ owners/ACL và restore cần các
roles tương ứng. [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

## Contract của job

Job dùng PostgreSQL17 clients và snapshot nhất quán: kiểm tra identity/revision
và dump theo cùng exported snapshot. Không lọc bỏ audit hoặc receipts, không
restore, không ghi Maximo và không tự thay schema. Đừng dùng copy volume đang chạy
thay thế backup đã được chứng minh phục hồi.

Credential đi qua private libpq service/passfile, không password trên argv/log.
Temp plaintext chỉ ở thư mục operator riêng; xóa temp do chính run tạo sau success
hoặc lỗi xử lý thông thường. Power loss/SIGKILL có thể để lại temp: runbook có bước
quarantine/dọn sau xác minh; file deletion không bảo đảm secure erase trên SSD.

Dump và metadata được mã hóa CMS AES-256-GCM với public recipient certificate.
Không có private decrypt key trên backup job host. Binary không hỗ trợ cipher là
fail, không fallback xuống plaintext/cipher khác. [OpenSSL CMS](https://docs.openssl.org/3.0/man1/openssl-cms/)

Chỉ publish backup set khi dump, encryption, hashes và metadata hoàn tất. Set đang
ghi/không complete không được dùng restore. Checksum kiểm tra corruption; GCM kiểm
tra integrity khi decrypt, nhưng public-key encryption không chứng minh nguồn tạo.
Restore vẫn phải xác minh trusted repository/certificate và approval reference.
Mount/source check chứng minh đích filesystem được chọn; offsite thật cần IT nghiệm thu.

Job không xóa backup cũ. Sau duyệt retention, operator phải kiểm tra bản mới còn
restore được, bản trước còn trong window và keys chưa bị hủy trước khi rotation.
Không purge receipts/unknown hay history trong DB để giảm dung lượng backup.

## Monitoring và nghiệm thu

- Alert khi job fail, không có complete set mới trong RPO, mount mất/đổi, disk gần
  đầy, recipient cert hết hạn, backup size bất thường hoặc restore drill fail.
- Log chỉ run ID, giai đoạn, status, thời gian và sizes/checksum không chứa secrets;
  không forwarding raw stderr/DSN/auth payload. Lỗi cần xác minh trong kênh operator riêng.
- Exit0 chỉ xác nhận job hoàn tất; giám sát freshness cần nguồn độc lập vì timer
  bị tắt hoặc service không chạy sẽ không phát sinh một failure event.
- Trước bật job thật: duyệt policy/config, test backup/decrypt/restore cluster mới,
  runtime login/grants, auth invalidation, Maximo-gap reconciliation, RPO/RTO và
  mô phỏng job lỗi/alert. Synthetic drill không thay nghiệm thu Ubuntu hay dữ liệu thật.

Xem [runbook backup/restore](backup-restore-runbook.md),
[DB operations](database-operations.md) và [staging deploy](staging-deployment.md).
