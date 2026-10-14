# Rà soát deployment và backup/restore — 2026-10-09

Phạm vi: rà source/configuration và bằng chứng đã ghi trong repo; lập công việc
còn thiếu cùng tiêu chí nghiệm thu. Không triển khai server, không backup/restore
DB đang vận hành và không gửi thay đổi tới Maximo trong lượt này.

## Kết luận và bằng chứng

Chưa đủ điều kiện rollout production. Có nền tảng container local và diễn tập
restore synthetic; còn thiếu cấu hình staging, HTTPS, backup vận hành và runbook
phục hồi. Read-only staging và production upload là hai cổng nghiệm thu riêng:
sender hiện chỉ cho phép contract Onshore test trong app development/test.

- [Compose](../compose.yaml) có DB volume, healthchecks DB/backend, restart policy
  cho các service dài hạn và thứ tự DB → migrate → backend → web. Chỉ publish
  `127.0.0.1:8080`; DB/backend không publish host port.
- [Backend image](../backend/Dockerfile) dùng lockfile và UID 10001; [web image](../frontend/Dockerfile)
  dùng clean npm install/build. Base images đã pin digest. Đây không phải bằng
  chứng vulnerability scan hoặc release image ứng dụng đã được quản lý.
- [Settings](../backend/app/config.py) yêu cầu Entra ở staging/production, chặn
  test write contract tại hai môi trường này, production chặn HTTP Maximo.
- [Proxy](../frontend/nginx.conf) log path thay vì query; backend tắt access log.
  Cần kiểm tra thêm proxy ngoài cùng và error logs khi có HTTPS.
- [Readiness](../backend/app/main.py) chỉ kiểm tra DB/schema revision
  `0008_admin_authority`; không kiểm tra Entra, Maximo hoặc đầy đủ quyền runtime.
- [Container checks](container-checks.md) ghi build/smoke Linux local ngày 07/10.
  [DB operations](database-operations.md) ghi diễn tập ngày 08/10: 17 bảng/32 hàng
  synthetic, schema/ACL/audit/recovery khớp. Không chạy lại hai diễn tập này.
- Lượt rà soát này chạy `docker compose --env-file .env.example -f compose.yaml
  config --quiet` với ba biến DB giả trong process: qua. Không đọc `.env` thật,
  không khởi động container; kết quả chỉ chứng minh Compose parse/interpolate.

## Thiếu sót và tiêu chí nghiệm thu

P0 là điều kiện trước rollout tương ứng; P1 là tăng khả năng vận hành. Mỗi hàng
ghi rõ cổng read-only hoặc upload khi cần, không đánh đồng hai cổng này.

| ID / ưu tiên | Phát hiện và công việc cần làm | Tiêu chí nghiệm thu | Phụ thuộc |
| --- | --- | --- | --- |
| D1 / P0 | Compose cố định `development`, chỉ truyền DSN vào backend; chưa truyền Entra/Maximo/CA. `.env` của host không tự vào container; Dockerfile không copy `.env`. Chuẩn bị cấu hình staging riêng, secrets server-side và provisioning connection/grants. | Stack khởi động với environment đúng; thiếu cấu hình bắt buộc fail closed; SSO/session và scoped read/draft qua; backend không nhận DSN owner; không có secret trong image/frontend/log/bằng chứng. | Có thể chuẩn bị mẫu ngay; IT cấp secret references, scope và Entra callback. |
| D2 / P0 | Chưa có TLS ingress/DNS/certificate. Nginx nội bộ ghi `X-Forwarded-Proto=$scheme` (HTTP); thêm TLS proxy phía trước cần thiết kế lại chain và trusted proxies. | Chỉ ingress cần thiết mở ra mạng; browser tin cậy TLS; callback đúng HTTPS; cookie Secure/HttpOnly và CSRF qua; không tin forwarded headers từ client tùy ý; kiểm tra cả access/error logs không lộ callback credentials. | IT chốt hostname, TLS termination, CA, firewall và routing. |
| D3 / P0 | Nginx `proxy_read_timeout 30s`; app cho retrieve/batch tối đa mặc định 120s, cấu hình tới 300s. JSON request có thể không trả dữ liệu trong khoảng này. Thiết kế timeout end-to-end cho read và upload riêng. | Qua toàn bộ proxy stack, ca read hợp lệ trên 30s trả kết quả; ca hết budget báo lỗi rõ. Upload mất response không tự resend; còn receipt/state để tra cứu. Không chỉ tăng timeout mà bỏ budget. | Chuẩn bị fake upstream tests được ngay; đo độ trễ thực trên Ubuntu sau. |
| D4 / P0 | Migrate tự chạy khi lên stack nhưng không provision roles/grants. Bảng mới không tự được write grants; readiness không phát hiện thiếu grants. Chưa có runbook upgrade/rollback. | DB mới: tạo roles → migration owner upgrade → DBA apply grants → runtime smoke. Upgrade có backup, quyền migrate độc quyền, ghi revision/image và xử lý failure; quay lại chỉ dùng schema tương thích hoặc restore có kế hoạch đối soát. Runtime login thật bị từ chối DDL/audit mutation/admin escalation. | Mẫu/runbook làm ngay; DBA và DB staging cần IT. |
| D5 / P0 upload | `write_enabled` trong sender chỉ cho contract test; recovery `recover_stale_sends` là hàm nội bộ yêu cầu ownership đã giải quyết. Chưa có worker/lease vận hành và startup recovery được nghiệm thu. | Read-only staging giữ write disabled. Trước mở upload production phải có contract được xác minh, quy trình ownership/recovery, restart trong lúc send được kiểm chứng, unknown khóa WO và reconcile trước bước tiếp. Không đổi sang development để mở upload trên staging/production. | Backend milestone và hợp đồng hệ thống đích; không thuộc lượt rà soát cấu hình này. |
| B1 / P0 | `backup_restore_rehearsal.py` chỉ nhận test server cố định, tạo nguồn/đích UUID và xóa archive sau diễn tập; không phải công cụ backup DB vận hành. Chưa có job backup, nơi lưu, retention hay cảnh báo. | Chốt RPO/RTO/người chịu trách nhiệm; job backup DB đúng lịch, ghi revision/checksum/kết quả không chứa secrets; mã hóa, phân quyền, bản ngoài máy chủ, rotation và cảnh báo job lỗi được thử. Backup phương pháp nào phải có bằng chứng phục hồi nhất quán, không coi copy volume đang chạy là restore đã kiểm chứng. | Mẫu công cụ/job có thể chuẩn bị; IT chốt kho lưu, quyền, lịch, retention, RPO/RTO. |
| B2 / P0 | Diễn tập cùng cluster không khôi phục roles/password/secret manager. Chưa có inventory cấu hình và release cần phục hồi. | Restore sang cluster cô lập mới: provision roles từ nguồn được quản lý, restore schema/data/owners/ACL và database-level grants; khôi phục đúng app image/config/CA/secret references; login runtime thật và scoped APIs qua. Có thứ tự và người thực hiện trong runbook. | IT cung cấp secret channel, máy/cluster đích và quyền DBA. |
| B3 / P0 upload | Backup cũ có thể mất receipts/audit của upload đã hoàn tất trên Maximo sau thời điểm dump. Restore Scheduler không hoàn tác Maximo; guard unknown chỉ bảo vệ các hàng còn trong backup. | Trước mở writes sau restore: cô lập sender, xác định khoảng mất dữ liệu, đối soát với nguồn bằng chứng Maximo/audit độc lập và lưu quyết định operator. Không tự continue pending hoặc gửi request mới cho WO chưa đối soát. Ca Maximo đã đổi nhưng receipt không nằm trong backup phải được diễn tập. | Có thể viết quy trình/ca synthetic ngay; IT chốt nguồn đối soát và quyền đọc evidence. |
| B4 / P0 | Backup chứa login sessions và auth flows; chưa chốt chính sách khi phục hồi. | Runbook quy định vô hiệu hóa session/flow phục hồi trước mở ingress, yêu cầu đăng nhập lại và kiểm tra cookie/callback cũ bị từ chối; xử lý có bằng chứng counts, không log token/flow payload. Chính sách được người chịu trách nhiệm duyệt. | Chủ dự án/IT duyệt; thực hiện trên DB restore cô lập. |
| O1 / P0 | Chưa có nghiệm thu restart host/DB/network, khoảng 10 phiên và theo dõi backup/disk/upstream/unknown. Healthcheck không tự restart container chỉ vì unhealthy. | Reboot và lỗi DB/network phục hồi có kiểm soát; cảnh báo được nhận khi disk/backup/readiness lỗi; 10 phiên khác scope không lộ chéo dữ liệu; session/draft không mất do restart process; diễn tập restore đo được RPO/RTO thực tế. | Chuẩn bị checklist ngay; server/monitoring/operator cần IT. |
| O2 / P1 | Base digest có nhưng chưa có release image ứng dụng, lifecycle refresh/scan và logging/resource limits được chốt. | Release có immutable image identifier, schema compatibility và cách quay về; scan được triage, lịch vá có owner; log rotation/resource budgets phù hợp với phép đo tải. | Quy trình release làm ngay; capacity và monitoring của Ubuntu cần IT. |

## Thứ tự thực hiện

1. Chuẩn bị D1–D4: cấu hình staging mẫu, HTTPS/proxy contract, timeout verification
   và runbook provisioning/deploy/upgrade/rollback. Không tự điền hostname hay secret.
2. Chuẩn bị B1–B4: inventory backup, mẫu policy và runbook phục hồi có write freeze,
   session invalidation và đối soát khoảng dữ liệu mất. Chốt đầu vào IT trước bật job thật.
3. Trên Ubuntu staging: chạy read-only acceptance, fault/restart và restore sang
   cluster mới, đo RPO/RTO. Sau đó đánh giá D5 riêng trước kế hoạch upload production.

## Đầu vào cần chủ dự án/IT

- Ubuntu access, capacity/disk, hostname/DNS, certificate/CA, firewall và outbound routes.
- Entra tenant/app/callback/policies, secret delivery, approved Maximo connections và scopes.
- DBA/operator/restore owner; kho backup ngoài server, mã hóa/quyền truy cập, lịch và retention.
- RPO/RTO được duyệt và nguồn evidence độc lập để đối soát Maximo khi backup đã cũ.

Rà soát hoàn tất khi findings được ghi có acceptance criteria và dependencies;
deployment/backup thực tế chỉ hoàn tất khi các cổng trên có bằng chứng vận hành.

## Tiến độ chuẩn bị sau rà soát — 2026-10-09

Đã thêm [Compose staging](../compose.staging.yaml), TLS nginx/env examples và
[runbook deploy/upgrade/rollback](staging-deployment.md) cho phần chuẩn bị D1–D4.
Migration thủ công trước grants/startup; runtime tách owner DSN; staging khóa upload.
Các findings trên ghi trạng thái lúc rà ban đầu. Cấu hình mẫu không đóng nghiệm thu
Ubuntu/SSO/Maximo, DB roles thực tế, backup/rollback hoặc application timeout budget.

Sau đó đã thêm deadline chung cho WO list/detail và local draft/batch handlers:
`WOS_READ_DRAFT_REQUEST_TIMEOUT_SECONDS` mặc định180s/range1..300, timeout504/no-store,
batch child tasks được drain trước đóng client. D3 có kiểm chứng code/synthetic proxy
và PostgreSQL; nghiệm thu Ubuntu/upstream thật và cleanup overhead vẫn pending.
Remote upload/auth/session không bị áp deadline này. Commit/response race dùng durable
receipt/request ID cũ, không suy từ504 rằng giao dịch chắc chắn chưa commit.

## Chuẩn bị backup/restore — 2026-10-10

Đã chuẩn bị [policy](backup-policy.md), [job và cấu hình mẫu Ubuntu](../deployment/backup/backup_job.py)
và [runbook restore](backup-restore-runbook.md) cho B1–B4. Policy/RPO/RTO/lịch/kho lưu
vẫn chờ duyệt; job mẫu giữ approval false, timer chưa có lịch hợp lệ. Runbook có
write freeze, DB restore mới cô lập, phục hồi roles/secrets riêng, auth invalidation
và đối soát Maximo kể cả writes không còn receipt trong backup.

Đây là phần chuẩn bị công cụ/quy trình; B1–B4 vẫn cần nghiệm thu vận hành, kho/khóa,
monitoring, restore cluster mới và RPO/RTO trên hạ tầng IT. Compose chưa có DB TLS/
route cho host job; đầu vào này phải được giải quyết trước backup thực tế.
