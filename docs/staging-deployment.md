# Staging: deploy, upgrade và rollback

Cập nhật: 2026-10-10. Đây là cấu hình mẫu và quy trình cho Ubuntu, chưa là bằng
chứng triển khai trên server. Dùng [Compose staging](../compose.staging.yaml)
độc lập, không merge với Compose local. Chỉ read và nháp; staging không mở upload.

## Cấu hình và contract

- Hai release images backend/web phải dùng immutable `@sha256:` references; giữ
  cặp images, Git revision, schema revision và compatibility của mỗi release.
  Template không build/pull tự động và không tự publish image.
- nginx là TLS ingress trực tiếp trên 443 với [config riêng](../deployment/staging/nginx.conf).
  Không có HTTP listener; không thêm TLS proxy khác trước nó khi chưa review chain.
  Backend chạy `--no-proxy-headers`; callback HTTPS lấy từ Settings, không từ Host.
  Proxy thay X-Forwarded headers, loại Forwarded; header không quyết định identity/scope.
- `WOS_READ_DRAFT_REQUEST_TIMEOUT_SECONDS` mặc định180s, giới hạn1..300s là một
  deadline chung cho WO list/detail và draft/batch handlers: validation, PERSON,
  crew, đọc WO tuần tự/song song, rechecks và DB. Hết hạn hủy phần xử lý đang await,
  drain batch tasks và trả504/no-store. Budget của từng reader không gia hạn deadline.
  `proxy_read_timeout=310s` là timeout giữa các lần đọc nginx; chừa khoảng đệm trước
  proxy timeout. Cancellation/DB cleanup là cooperative và có thể kéo dài thêm;
  phải đo trên Ubuntu, không coi310s là bảo đảm cứng cho cleanup hoặc socket gửi response.
  Connect timeout5s, send timeout30s; không retry upstream. Auth/session và remote
  upload handlers không thuộc deadline này.
  Upload vẫn khóa; không dùng timeout này làm bằng chứng upload recovery production.
- DB không publish cổng; volume tên riêng theo project staging. Chỉ port 443 được
  publish. IT phải xác minh firewall/Docker networking trên Ubuntu thực tế.
- Runtime và migration dùng hai env files riêng theo mẫu
  [runtime](../deployment/staging/runtime.env.example) và
  [migration](../deployment/staging/migration.env.example). Compose hỗ trợ
  `env_file.format: raw` là điều kiện dùng mẫu này; chạy config với đúng bản Compose
  trước deploy. Không đặt dấu nháy bao quanh giá trị trong raw files; JSON registry
  viết trực tiếp trên một dòng. Password trong DSN phải URL-encode.
- Env files là secret delivery tạm do operator quản lý, không phải secret manager:
  Docker administrators có thể xem container environment. Lưu file ngoài checkout,
  thư mục 700/file 600, không đưa secret vào CLI/history/reports. Backend không nhận
  owner DSN; migration không nhận Maximo keys. Compose ép environment=staging.
- DBA password dùng file secret `/run/secrets/db_password`. Thay file không tự đổi
  password role của DB đã khởi tạo. Rotation phải có bước ALTER ROLE qua DBA và
  cập nhật credential đồng bộ, rồi kiểm tra kết nối.
- Certificate fullchain/key mount read-only. Built-in CA trust dùng cho Entra/Maximo;
  endpoint private CA cần cấu hình mount và `WOS_MAXIMO_CA_BUNDLE` được review thêm.
  Không dùng `verify=False`. HTTPS Maximo được khuyến nghị cho staging; HTTP test
  cần đúng connection environment=test và opt-in theo chính sách hiện có.
- Access log chỉ path/status/time, không query/headers/body; nginx error log tắt
  vì có thể chứa request credentials. Đổi lại phải có health/uptime monitoring,
  kiểm tra `nginx -t` và cảnh báo exit/unhealthy. Docker log có rotation.
  Readiness chỉ chứng minh DB/schema, không chứng minh quyền DB hoặc integration.

## Chuẩn bị release và server

1. IT cung cấp Ubuntu, DNS/TLS/CA, network routes, Entra app/callback và secrets.
   Operator ghi người chịu trách nhiệm, window, release images, schema mục tiêu,
   trạng thái backup và cách quay về. Không rollout nếu backup chưa đủ điều kiện.
2. Build backend/web từ cùng Git revision bằng Dockerfiles/lockfiles hiện có,
   chạy checks và scan được triage, đưa images vào registry được duyệt. Ghi digest
   của image ứng dụng; base digest không thay cho digest release.
3. Copy ba mẫu env ra thư mục operator ngoài repo. Điền
   [Compose inputs](../deployment/staging/compose.env.example) với absolute paths,
   approved images và hai private env files. Hai role `wos_owner` và `wos_runtime`
   phải khác DBA `scheduler_dba`. Điền Entra đủ cho cả hai Settings processes.
4. Điền runtime Maximo registry bằng connection UUID đã provision trong DB:
   collection URL, statuses, crew groups, PERSON domain và key được cấp. Không
   thêm `conditional_write_contract`. `WOS_MAXIMO={}` chỉ dùng để kiểm tra startup,
   không đủ để nghiệm thu WO. Cấp scope theo [PERSON](person-access.md) và
   [Planner](planner-access.md), không cấp WO access mặc định cho admin.
5. Certificate phải khớp hostname và full chain được browser tin cậy; callback
   đúng `https://<approved-host>/api/auth/callback`, không dùng localhost giả trên server.

Các lệnh dưới dành cho Bash ở repo root trên Ubuntu. `staging_inputs` trỏ tới file
Compose inputs đã chuẩn bị, không chứa secret trực tiếp. Không chạy `config` không
có `--quiet` vì rendered output có thể chứa secrets từ env files.

```sh
staging_inputs=/absolute/operator/path/compose.env
docker compose --env-file "$staging_inputs" -f compose.staging.yaml config --quiet
docker compose --env-file "$staging_inputs" -f compose.staging.yaml --profile tools pull
```

## Deploy lần đầu

1. Operator độc quyền deployment: chỉ một người/process migrate; khóa bảo trì
   ở quy trình vận hành. Không đồng thời chạy hai runbook trên cùng project/DB.
2. Chỉ khởi động DB:

   ```sh
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml up -d --wait --wait-timeout 120 db
   ```

3. DBA qua kênh psql/service-password được IT quản lý tạo hai LOGIN roles và
   chuẩn bị ownership/schema CONNECT/USAGE/CREATE cho migration owner theo
   [DB operations](database-operations.md). DB trong template tên `scheduler`;
   không migrate bằng DBA. Không nhận password bằng argv và không cấp runtime membership.
4. Chạy migration một lần; lỗi là dừng, chưa khởi động backend/web:

   ```sh
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml --profile tools run --rm migrate
   ```

5. DBA dùng psql client PostgreSQL 17 qua kênh riêng trên DB đích, chạy
   `backend/sql/provision_roles.sql` với `owner_role=wos_owner`,
   `runtime_role=wos_runtime`. Script phải thành công; đọc revision và đối chiếu
   owners/ACL. Chạy lại bước grants sau mỗi migration. Container runtime không
   có operator tools; không copy DBA credential vào backend để chạy script.
6. Xác minh login runtime thật, DDL/admin escalation/audit mutation bị từ chối;
   provision approved connections, bootstrap admin theo công cụ operator đã có.
   Chỉ đánh dấu grants xong khi runtime đã kiểm tra, không suy từ readiness.
7. Khởi động ứng dụng:

   ```sh
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml up -d --wait --wait-timeout 120 backend web
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml exec -T web nginx -t
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml ps
   ```

8. Nghiệm thu từ browser/mạng người dùng: certificate, health/live và health/ready,
   Entra login/logout/callback, Secure/HttpOnly session + CSRF, scoped list/detail,
   lưu/mở nháp và thu hồi quyền. Đăng nhập tenant sai/no grant bị từ chối. Upload
   disabled; không dùng Entra/Maximo giả để đánh dấu live acceptance.
9. Chạy request read giả chậm trên 30s qua proxy và ca app budget hết hạn trước
   khi ký nghiệm thu D3. Kiểm tra log với callback query/Cookie/Authorization giả;
   chỉ lưu bằng chứng đã redaction. Restart host/DB và 10 phiên thuộc O1, vẫn pending.

Timeout khi lưu nháp không tự chứng minh chưa commit: deadline có thể đến sát commit
hoặc response bị mất. UI giữ phần sửa và request ID; người dùng kiểm tra nháp/trạng thái
và retry cùng ID với cùng nội dung để dùng durable receipt. Transaction chưa commit
phải rollback; không tạo request ID mới chỉ để vượt timeout và không tự retry upload.
Các transaction nháp/batch và PERSON sync dùng session/direct transaction contexts
để tránh sessionmaker wrapper tạo commit worker tách khỏi handler khi bị cancel.
Nếu COMMIT đã tới DB trước cancellation, outcome vẫn phải đối soát qua receipt;
không coi cancellation của coroutine là bằng chứng DB chưa commit.

## Upgrade có kiểm soát

1. Ghi release trước/mới, schema trước/mới, compatibility và rollback decision.
   Chốt window; ngừng nhận request mới ở web, đợi request đang xử lý kết thúc,
   sau đó mới dừng backend. Hai lệnh stop bên dưới chạy tuần tự, giữ DB hoạt động.
   Nếu request không kết thúc trước shutdown budget, ghi sự cố; không coi
   pending/unknown là thành công và không tự gửi lại.

   ```sh
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml stop web
   docker compose --env-file "$staging_inputs" -f compose.staging.yaml stop backend
   ```

2. Backup DB ở trạng thái đã quiesce bằng quy trình được IT duyệt; xác minh
   backup có thể restore, inventory roles/config/image/secret references.
   Đây là điều kiện vận hành; [job/policy/runbook backup](backup-restore-runbook.md)
   đã có bản chuẩn bị, chưa được duyệt/bật trên Ubuntu.
3. Pull images mới bằng inputs release mới, migrate một lần; reapply grants,
   kiểm tra schema/runtime rights. Không mở web khi migrate/grants thất bại.
4. Khởi động backend/web với inputs mới, kiểm tra nginx/readiness, SSO/scoped
   read/draft smoke rồi mở lại người dùng. Ghi revision, digest, thời gian và kết quả.

## Thời gian chờ và restart có kiểm soát

| Tầng | Cấu hình staging | Mục đích |
| --- | --- | --- |
| Request WO/nháp | Mặc định180s, tối đa300s | Deadline chung cho handler và rechecks/DB |
| nginx proxy | `proxy_read_timeout 310s` | Chờ phản hồi, không retry upstream |
| Uvicorn | `--timeout-graceful-shutdown 320` | Dừng nhận kết nối mới, chờ request đang chạy |
| nginx workers | `worker_shutdown_timeout 320s`, SIGQUIT | Drain request trước khi worker đóng |
| Docker backend/web | `stop_grace_period: 330s` | Chừa10s sau drain trước forced kill |

Khoảng đệm là cấu hình vận hành, không bảo đảm cứng: deadline request và cleanup
cooperative có thể kéo dài; Uvicorn lifespan shutdown còn chạy sau drain. Proxy
read timeout đo khoảng chờ giữa các lần đọc, không phải tổng thời gian request.
Auth/session và remote upload không thuộc deadline WO/nháp; upload staging vẫn khóa.
Nếu hết320s, request có thể bị cancel/đứt response; nếu process còn chạy ở330s,
Docker có thể SIGKILL. Phải đối soát receipt bằng request ID, không suy chưa commit.

Khi chỉ restart ứng dụng, không cần migration hoặc dừng DB:

```sh
docker compose --env-file "$staging_inputs" -f compose.staging.yaml stop web
docker compose --env-file "$staging_inputs" -f compose.staging.yaml stop backend
docker compose --env-file "$staging_inputs" -f compose.staging.yaml up -d --wait --wait-timeout 120 backend web
docker compose --env-file "$staging_inputs" -f compose.staging.yaml exec -T web nginx -t
docker compose --env-file "$staging_inputs" -f compose.staging.yaml ps
```

Lệnh stop dùng budget trong Compose, không override `-t` với thời gian ngắn hơn.
Mỗi service có330s riêng; hai lệnh tuần tự có thể cần gần660s nếu đều hết budget.
Tránh `restart backend` riêng khi web còn nhận traffic trong window bảo trì.
Không dùng `kill`, `down -v` hoặc stop DB thay cho quy trình này. Khi container
backend/web cũ đã được tạo từ cấu hình trước, áp dụng Compose mới trong window
được kiểm soát; sửa YAML không tự đổi stop budget của container đang tồn tại.

Bước1 chuẩn hóa cấu hình đã hoàn tất. Kiểm thử bước2 với request đang lưu và
receipt được ghi trong phần runtime bên dưới; rehearsal trước dùng grace5s
không thay cho lần thử320/330s hoặc nghiệm thu Ubuntu.

Kiểm chứng cấu hình local ngày10/10: Compose render với synthetic inputs xác nhận
backend/web stop330s và signals TERM/QUIT; image backend local-check hỗ trợ flag
graceful320s; image web local-check chạy `nginx -t` thành công với config mới và
certificate giả. Script `.cache/check_shutdown_config.py`; temporary containers
`--rm` và fixture env/certificate được dọn. Không khởi động stack staging, không
restart dịch vụ đang chạy hoặc thử request đang lưu trong bước này.

### Phương pháp kiểm thử shutdown runtime — bước2

[Harness](../backend/tests/operational_rehearsal/shutdown.py) tạo PostgreSQL17/Uvicorn/
nginx riêng trên Docker Desktop, cùng nginx config staging và stop signals/budgets
330s. App source/runner/Compose/nginx và image IDs được ghi hash trong evidence.
Session DB được seed; client gửi Cookie/CSRF thủ công, upstream chỉ GET giả lập.
TLS certificate giả được client tin cậy riêng, vẫn verify certificate/hostname.
Không dừng shared DB hoặc deployment thật; không thử Entra/browser/Maximo thật.

Mỗi lần lưu có200WO cùng connection/site/discipline, sửa `estdur` từ8 sang9:

- A: nhận request qua HTTPS, giữ trước commit rồi stop web bằng SIGQUIT. Kết nối
  mới bị từ chối; mở barrier cho request cũ lưu xong, stop backend bằng SIGTERM,
  restart và replay cùng ID qua TLS. Xác minh1draft/200items/1receipt, không tạo trùng.
- B: giữ trước commit và stop backend; deadline180s trả504, active reads về0 và
  4reads bị hủy; không tăng draft/item/receipt. Sau restart gửi cùng ID lưu một lần
  rồi replay không tăng rows. Reader fixture300s thay default120s để cô lập outer180s.
- C: commit nháp/receipt xong rồi giữ response ngoài handler deadline; stop backend
  chờ grace320s hết. Response lỗi không làm mất commit; restart và replay cùng ID
  phải trả đúng receipt, giữ1draft/200items/1receipt và nội dung sửa đúng.

A kiểm tra quy trình stop web→backend qua TLS; B/C cố ý gọi thẳng backend để thử
fault boundary (proxy310s sẽ can thiệp vào ca C). Restore/replay sau restart đi qua
TLS. Không suy các ca này đã thử proxy310s hoặc nginxworker320s ở đúng biên, hay
forced Docker SIGKILL330s. Cần nghiệm thu các giới hạn và tài nguyên Ubuntu riêng.

### Kết quả runtime — 2026-10-10

| Ca | Kết quả client/dữ liệu | Thời gian stop | Sau restart |
| --- | --- | --- | --- |
| A: stop web rồi backend | 201; 1nháp/200WO/1receipt; từ chối kết nối mới | Web3.284s, backend1.101s; exit0 | TLS replay đúng receipt, không tăng rows |
| B: giữ trước commit | 504 ở179.935s; rollback, active0/cancelled4 | Backend180.810s; exit0 | Cùng ID lưu một lần; replay không tăng rows |
| C: commit rồi giữ response | 500 ở320.199s; 1nháp/200WO/1receipt đã commit | Backend321.031s; exit0, chưa tới Docker330s | TLS replay đúng receipt; đúng WO/scope/changes/version, không tăng rows |

Đã hoàn tất ba ca qua **hai lượt chạy**, không tuyên bố full harness qua một lượt.
Lượt đầu `8c666e95f7684751bcb8d782979a921b` hoàn tất A/B, dừng ở assertion log của C:
helper Docker chỉ lấy stdout, trong khi Uvicorn ghi stderr. Đã sửa capture cả hai
streams, thêm regression và chạy lại C riêng với320s thật; lượt
`c92084c7db154002b78ab9320dfbbc88` qua từ commit đến restart/replay/cleanup.
Không sửa app/schema hoặc cấu hình staging giữa hai lượt; source/config hashes khớp.

Một reviewer Sol/high không có P1, một P2 về việc chỉ kiểm tra số dòng restore:
đã thêm kiểm tra exact200WO keys, connection/discipline, draft/version và từng
changes với duration chuẩn hóa. Main kiểm tra helper/negative tests và kiểm tra
API restore cả3nháp qua một process thay thế trong lượt đầu; C chạy lại dùng
assertions đầy đủ qua TLS sau restart. Quan sát SQL riêng của lượt đầu ghi dữ
liệu sau A/B restart và C commit; không dùng quan sát đó làm bằng chứng C đã replay.
28guard/assertion tests qua, Ruff lint/format và docs links/diffcheck qua.

Lượt đầu đã dọn containers/network/files nhưng thư mục UUID rỗng trên Windows/
OneDrive bị chặn xóa; raw report giữ cleanup unverified. Main xác minh thư mục
rỗng đúng workspace rồi xóa, kiểm tra không còn containers/network và không có
volume nào tạo trong time window lượt đầu. Harness hiện clear thuộc tính read-only
của đúng thư mục rỗng trước rmdir trên Windows; lượt C cuối xác minh cleanup đầy đủ
containers/network/volume/private files. Không dùng recursive delete.

[Evidence](evidence/shutdown-180-320-330-2026-10-10.json) giữ nguyên raw report lỗi
đầu, report C cuối, đối chiếu nội dung và xác minh cleanup bổ sung. Certificate/
session credentials không có trong evidence. Không deploy/migrate hệ thống thật,
live Maximo write/Entra login, backup/restore hoặc mở historyphase2 trong task.
Nghiệm thu Ubuntu với TLS/routing/Maximo/Entra thật và resource limits vẫn cần IT.

## Rollback và lỗi triển khai

- Nếu migration chưa chạy hoặc chưa đổi schema và bản cũ còn tương thích: giữ
  DB volume, trỏ inputs về đúng cặp images/config trước, khởi động và smoke lại.
- Nếu schema đã thay đổi: chỉ chạy bản cũ khi đã có bằng chứng compatibility;
  readiness của bản cũ có thể yêu cầu revision cũ nên không sửa/bypass check.
  Ưu tiên forward fix có kiểm chứng. Không tự `alembic downgrade` trên DB nghiệp vụ.
- Nếu cần restore: giữ ingress đóng, dùng runbook backup/restore được duyệt trên
  DB cô lập trước; kiểm tra schema/grants/data/session policy. Đối soát mọi Maximo
  thay đổi sau thời điểm backup trước mở writes; backup không hoàn tác Maximo.
  Dùng [runbook restore](backup-restore-runbook.md); RPO/RTO và B1–B4 cần IT duyệt/
  nghiệm thu thực tế, không tự suy từ synthetic tests.
- Tuyệt đối không `down -v`, xóa volume hay reinitialize DB để sửa cấu hình.
  Nếu container chạy nhưng unhealthy: chẩn đoán cấu hình/schema/quyền/network,
  không coi restart policy là cơ chế tự sửa lỗi hoặc retry upload.

## Bằng chứng và giới hạn

Mẫu này hoàn thiện phần chuẩn bị D1–D4; nghiệm thu Ubuntu/SSO/Maximo/timeout qua
toàn stack, backup thật và rollback có dữ liệu vẫn phải chạy trên staging được IT cấp.
Upload production, worker/lease/recovery, automated backup và monitoring chưa được mở.
Theo dõi [findings](deployment-readiness-review.md) và [TODO](todos.md).

Kiểm chứng local ngày09/10: Compose5.3.1 parse/role isolation/manual migration/ports
và missing-input failure qua; actual backend container giữ nguyên `$` trong raw secret,
Settings staging khởi tạo bằng identity giả. Settings hiện có từ chối thiếu Entra và
test write contract tại staging. nginx `-t`, TLS với certificate synthetic được client
tin cậy, SPA route, forwarded-header overwrite và log redaction markers qua; request
fake chậm33.0s trả200. Dùng images local-check hiện có, không build release mới, không
chạy app DB/Entra/Maximo thật. Containers/networks thử đã dọn; script/fixtures synthetic
trong `.cache/check_staging_template.py` và `.cache/staging-check-*` bị ignore.
Lần kiểm tra cấu hình ban đầu chưa thử deadline app hết hạn, multi-step request
trên310s hoặc shutdown đang có request; kiểm tra deadline bổ sung ghi bên dưới.

Kiểm chứng bổ sung deadline ngày09/10: source `ReadDraftDeadlineRoute` mới được mount
vào backend container thử, handler giả có hai bước sleep0.6s dùng budget chung1s.
Qua nginx/TLS, request trả504 JSON/no-store, nginx ghi thời gian xử lý khoảng1s;
probe xác nhận một request đã hủy, không hoàn tất hay tự retry; request nhanh trả200.
Client Windows đo3.05s gồm độ trễ resolve localhost, không coi đó là budget backend.
Script `.cache/check_deadline_proxy.py`, `.cache/deadline_asgi.py`; resources thử đã dọn.
Backend tests riêng bao phủ endpoint thực và PostgreSQL synthetic cancellation/rollback;
không coi handler giả là nghiệm thu endpoint upstream thật hoặc Ubuntu.
