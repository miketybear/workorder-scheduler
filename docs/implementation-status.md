# Trạng thái triển khai — foundation

Cập nhật: 2026-10-09. Chưa phải ứng dụng nghiệp vụ hoàn chỉnh.

## Đã triển khai

- Khởi tạo Git và ignore secrets/cache/dependencies; đã có commits và remote GitHub.
- Backend FastAPI app factory, settings bắt buộc, live/readiness và session/logout endpoints dùng session DB và CSRF.
- Policy grants theo connection/discipline; session và draft service đọc grants từ DB.
- Validation payload allowlist, target intent, PM/CFT, ngày có timezone, PIC và duration.
- Models/migrations cho identity, grants, sessions, drafts, upload batches/items và audit; không seed credential.
- P7 có API preview, native TEST sender và trạng thái từng WO theo owner/scope;
  immutable source, durable receipt/reservation, intent-before-send, native `_rowstamp`,
  read-back/unknown reconciliation và confirmed-only exact-version finalizer.
  UI gửi nháp đã lưu, tra cứu receipt, continue tối đa 10 pending WO và đối chiếu unknown;
  không gửi lại unknown. Explicit opt-in tám mã type hiện có trên Onshore test
  trong development/test; PM/CFT cấm target, nhóm còn lại cần explicit target intent.
  Production/staging/Offshore vẫn khóa. Worker/lease và history đầy đủ còn pending.
  PM browser ngày09/10 đã qua ba request204: đổi lịch/duration25→21, restore cặp ngày,
  rồi duration-only25. Read-only audit19events xác nhận original all6 exact,
  ba nguồn finalized, zero reservations và bốn nháp cũ nguyên vẹn.
  Backend641 tests/4 known warnings và frontend187 tests/typecheck/lint/build qua.
  Review độc lập ba P2 về nullable origin, interrupted receipt recovery và semantic
  equality đã sửa, main kiểm tra code và regression tests. Mốc tiếp theo đã qua
  browser PM nhóm H14286978/H14288340, giữ baseline gốc riêng và restore exact26/24h;
  CFT H14302007:6→6.25→6h duration-only giữ null lịch/PIC và target gốc.
  Backend644 tests/4 known warnings và Ruff qua sau gate CFT; không đổi frontend.
  Chủ dự án chốt nghiệm thu theo hai nhóm quy tắc target, thay browser từng type;
  Gate chung tám mã TEST đã triển khai: cả hai target fields có32 ca API qua;
  main full backend694 passed/4 known warnings, Ruff/diff-check qua ngày09/10.
  Backend local đã nạp lại/readiness200; không live write mới trong bước này.
  Nhóm hỗn hợp PM/CFT/REC đã qua browser:7requests204/43events, original all6exact
  từng WO sau restore, zero reservations, bốn nháp cũ giữ nguyên. BatchPlanner có
  per-row targets với explicit intent và PM/CFT khóa; frontend190 tests/checks qua.
  Retrieve nhiều trang test dừng an toàn vì nextPage mang host production; theo chủ
  dự án test dùng DB sao chép production. Chưa kiểm chứng pagination production;
  không bỏ URL guard hoặc sửa cấu hình server trong mốc gate này.
  [Phạm vi và API](upload-workflow.md); bằng chứng kiểm tra P7 ghi ở [TODO](todos.md).
- React overview và bảng demo giả lập: sửa ngày, khóa target PM/CFT, preview và reset.
- Dockerfiles và Compose phát triển local, migration service, DB volume và healthchecks.
- uv.lock, package-lock.json, scripts lint/test/typecheck/build và tài liệu chạy local.
- [CI GitHub Actions](ci.md) cho push/PR/thủ công: backend fast, PostgreSQL migrations
  và integration, frontend lint/typecheck/test/build; action SHA được khóa, không cần
  Entra/Maximo secrets. Python 3.12.14, uv 0.11.9 và Node 26.0.0 giữ baseline đã kiểm tra.
  Actionlint 1.7.12 qua; workflow dd9cae6 đã push. Run 37590200157: frontend Ubuntu success,
  hai backend fail tại uv Python download. Working tree sửa dùng setup-python SHA pinned
  cho 3.12.14; corrected GitHub run sau push còn pending. Linux container suite đã qua.
- Carbon Gray 10 / Gray 100 cho sáng/tối, nút chuyển trên header và lưu preference.
  IBM Plex Sans 400/500/600 được phục vụ nội bộ cùng giấy phép OFL; màu chữ, tag,
  các ô nháp và native date picker theo theme. Chuyển theme không remount bảng/panel.
  Component styles đã thay lớp cũ: shell đen 48px, spacing 16/24px, input viền dưới,
  nút 40px, table 14/18 và tags. Panel WO đơn lẻ căn giữa viewport cả hai trục,
  rộng tối đa 1320px, chiều cao giới hạn theo viewport; thông tin Maximo
  và các section chỉnh sửa đặt cạnh nhau trên desktop; header/footer cố định, phần ngày
  Maximo/thực tế mở theo yêu cầu. Màn hình nhỏ ưu tiên form rồi thông tin tham chiếu.
- Bảng WO 7 cột và panel đủ 17 field nghiệp vụ theo mapping hiện có;
  System/Site/WOID không hiển thị, định danh nội bộ vẫn giữ.
- WO tự dùng phạm vi tài khoản; không còn selector Hệ thống/Discipline. Trang /settings
  hiển thị URL đã cấu hình và lưu connection cho từng tài khoản trong PostgreSQL
  (migration 0007). Một grant duy nhất dùng tự động; nhiều kết nối chọn một lần trong
  Settings. Discipline lấy từ quyền server, không lựa chọn khi một kết nối có nhiều discipline.
  Preference hết quyền không được dùng để truy cập WO. Local Onshore test / E&I save/readback
  preference và đọc 3 WO có nháp đã xác minh; 106 frontend / 236 backend tests qua.
- Chọn Scheduled Start, Finish chỉ đọc và tự tính theo duration giờ khi sửa Start/Duration;
  Target date/time pickers tự bật intent, PM/CFT khóa. Nhãn múi giờ ẩn, tính ngày vẫn theo
  múi giờ kết nối. Dán Excel 3 cột Start/PIC/Duration; không tự refresh theo timer.
- Đóng panel giữ nháp trong PostgreSQL, có marker/lọc ngay trên bảng WO và mở đúng nháp;
  giữ workspace trong RAM qua route. Tab trở về visible chỉ xác minh phiên/quyền,
  không refetch WO; blur/focus không gọi request. Có thời điểm cập nhật, nhãn cũ sau
  5 phút và Cập nhật thủ công giữ edits, đối chiếu baseline/PIC/phiên bản mới hơn.
  Hai nguồn Maximo/nháp giữ snapshot riêng trong RAM; đổi nguồn giữ bảng/query/trang,
  bộ lọc/dòng chọn/thời điểm cập nhật, lưu/xóa nháp cập nhật cả bảng đang ẩn.
  Khóa cuộn trang và bảng WO nền khi panel đơn lẻ/nhóm mở, chặn scroll chaining;
  đóng/ẩn panel hoặc chuyển route gỡ khóa và giữ vị trí cuộn.
  138 frontend tests, lint/typecheck/build qua ngày 2026-10-07; backend không đổi.
  Browser Onshore test/E&I: Retrieve 117 WO tháng 10, sang nguồn 3 WO có nháp rồi quay
  về vẫn đủ 117 WO, cùng timestamp/bộ lọc/dòng chọn; không ghi/xóa nháp hay Maximo.
  Bảng hiển thị kế hoạch đã lưu với nhãn Nháp ở ô thay đổi,
  giữ riêng baseline và status Maximo. Nháp cạnh tranh có lựa chọn rõ; baseline cũ cần đối chiếu.
  Nguồn WO có nháp trong phạm vi dùng cùng bảng, truy cập được nháp ngoài khoảng Retrieve.
  API WO list lấy markers scoped/owned bằng một SQL query, không thêm per-draft Maximo reads.
- Nháp nhóm tối đa 200 WO: áp lịch/PIC/duration, sửa ô, Undo/reset, dán vùng Excel,
  panel căn giữa viewport theo hai trục, chiếm 95% chiều rộng và 95% chiều cao màn hình;
  hàng thông tin bổ sung chỉ giữ 7 field chưa có trên dòng, chia 3 nhóm ngang toàn bảng,
  mở một WO mỗi lần, giữ edits và không refetch khi mở/đóng. Browser nhóm 3 WO E&I
  đã xác minh phần bổ sung cao 140px tại viewport 1164×884.
  preview, save/update/restore/delete; backend recheck scope và baseline từng WO,
  lưu toàn nhóm trong một transaction và deduplicate bằng receipt bền vững.
  Local browser đã đọc và preview nhóm 4 WO E&I; 4 WO này thiếu systemid.
  Nhóm 100/200 WO synthetic và Chromium desktop 1600×1000 đã qua ngày 2026-10-07:
  group/row/paste/Undo/preview/save/reopen, atomic DB persistence và lỗi scope/baseline/version.
  Tab containment, opener return, chooser transition/focus sau Save và Settings radio keys qua;
  version409 khóa lưu và giữ edits. [Phạm vi/số đo](large-batch-keyboard-tests.md).
  Monthly-load live, 10 planner và accessibility toàn luồng còn pending;
  upload CM Onshore test đã triển khai trong phạm vi P7 bên trên.

## Bằng chứng kiểm tra

- 2026-10-09: operator field harness đã chuẩn bị cho7 non-CM types với immutable
  payload plan, null schedule-pair/PIC exact restore và original-PIC ngoài crew
  no-op preflight. Diagnostic field combination và unplanned duration-mode payload
  bị chặn; duration JSON numeric/bounds/exact serialization kiểm tra trước intent.
  Full backend616 tests/Ruff qua, focused review không còn P1. Live field preflight
  ban đầu bị Entra session hết hạn. Login503 sau đó được xác định do backend local
  sandbox proxy refused10061; restart owned backend ngoài sandbox trả login303/ready200,
  browser SSO/callback thành công đúng actor/scope. Không đổi credential/TLS/grants.
  Bảy type đã qua live schedule/PIC/fraction/allowed-target và exact six-field restore;
  audit84 intent/results,448 events,7 confirmed, zero reservations, nháp cũ giữ nguyên.
  PM/CFT không gửi target. PM date update tự đổi duration25→21; restore duration
  riêng sau date restore trả25, lịch sử stopped probe/recovery được giữ lại.
  Các type khác không đổi duration qua date requests; app non-CM gate vẫn khóa,
  semantics date/duration đã được xử lý theo mốc dưới; cần browser UAT trước khi mở gate.
- 2026-10-09 PM preview/readback: cảnh báo khi start hoặc finish thực sự đổi (kể cả
  duration edit kéo theo finish). Known200/204 với date changes nhưng không đổi estdur
  chỉ confirmed khi tất cả trường khác exact; audit pin actual baseline/revision và
  receipt hiển thị expected→actual. Explicit duration mismatch/timeout giữ unknown;
  không tự POST thêm. Finalize/reconcile không chấp nhận duration drift sau pin.
  Backend629 tests, FE181 tests/typecheck/lint/build qua; focused review P2 local
  finish-only warning đã sửa. Browser Onshore test PM preview đã qua, WO unchanged;
  ở mốc này nháp kiểm chứng riêng được giữ để xem và gate còn CM-only. Mốc browser
  PM đơn sau đó đã finalized nháp này và restore all6 exact (coverage hiện tại bên trên).
- 2026-10-08 conditional-duration theo7 non-CM types: PM/CFT/REC/OVERHAUL/MoD/
  General/Routine đều qua wrong/current/fresh/stale/same-token pair/restore live;
  49POST,7items confirmed/203events. Read-only audit xác nhận7 exact baseline,
  không active reservation và nháp cũ giữ nguyên. Full backend531 tests/Ruff qua,
  PM/CFT browser target khóa và backend trước-network rejection tests qua.
  App gate vẫn CM: date/PIC/allowed target positive proof theo từng type còn pending.
  [WO/item/coverage](maximo-write-contract.md).
- Mốc native sender/browser UAT ngày 2026-10-08: full backend 500 tests qua gồm
  PostgreSQL, frontend 175 tests qua, lint/typecheck/build qua. Sau sửa toolbar receipt
  còn sót, 60 WorkOrders tests/typecheck/lint qua; browser restore kiểm tra không còn nút
  khôi phục thừa. Independent Sol/high review không có P1; các P2 đã sửa và main xác minh.
  Live field probe P13463520 confirmed 59 events, duration phân số/ngày/PIC/CM target
  và restore exact. Browser P13467327/BD1/531789 upload duration 5→6 rồi 6→5,
  từng lần confirmed/source finalized; receipt lookup chỉ đọc. Nháp cũ giữ nguyên.
  Browser nhóm hai CM sau đó upload và restore P13467496 (11→12→11) và P13467932
  (10.5→11.5→10.5), UI confirmed2/2 cả hai lượt và bỏ đúng nháp nguồn.
  [Hồ sơ hiện tại](upload-workflow.md). Không suy rộng sang PM/CFT/Offshore/production,
  null-clear UI, crash lease hoặc 10 planner live.
- Harness operator-only Onshore test ngày08/10: committed intent từng POST, current
  Entra/PERSON/Planner, một WO reservation và scoped read-only probe reconciliation.
  ETag0 và raw rowstamp-as-header bị412 BMXAA8229W; sau sửa representation,
  JSON `_rowstamp` qua wrong412/current204/fresh204/stale412/pair204+412/restore204
  trên P13463520. Đọc lại khôi phục exact baseline20.0, audit confirmed29events.
  Full backend453 tests trước classification cuối;148 targeted tests gồm10PG sau
  sửa và Ruff lint/format qua. Upload ứng dụng giữ khóa; date/PIC/target còn chờ thử.
  [Bằng chứng và giới hạn](maximo-write-contract.md).
- Mốc UI preview P7 ngày 2026-10-08: 167 frontend tests/16 files, ESLint, TypeScript
  và production build qua. Main review parser/contract, conflict rows và abort/lifecycle;
  tests dùng React/HTTP mocks. Browser live Onshore test/E&I sau đó qua nháp đơn v2
  và fixture nhóm hai CM v1: current/proposal, upload khóa, unsaved edit hủy preview;
  save/reopen nhóm đúng v1. Ba nháp cũ giữ nguyên; fixture nhóm còn lưu để xem.
  Route-away/late response chưa nghiệm thu browser; UI upload/history chưa có.
  Backend không đổi trong mốc UI, không chạy lại backend suite đã qua bên dưới.
- Mốc đầu P7 ngày 2026-10-08: full backend 406 tests qua, trong đó 38 tests P7
  (9 fast + 29 PostgreSQL); concurrent submit/reservation/send và intent visibility
  có independent connections/real commits trên schema synthetic tạm. Ruff qua;
  reviewer Sol/high không có P1/critical, P2 status scheduling/PIC đã sửa và
  regression qua. Schema/dependencies/frontend không đổi; không gọi writer thật.
  [API, command và giới hạn](upload-workflow.md).
- Backend: 244 tests qua ngày 2026-10-07 (136 fast + 108 PostgreSQL integration scenarios),
  trên Windows và Docker Linux Python 3.12.14 với PostgreSQL tạm riêng;
  suite không gọi Maximo/Entra thật. Test lịch nhóm dùng SelectorEventLoop như các test
  PostgreSQL khác để tương thích psycopg trên Windows.
- Frontend: 151 tests/14 files (UI + API boundary, 2026-10-07); clean npm ci, TypeScript,
  ESLint và Vite production build qua. Vá transitive dev source-map-js 1.2.2; npm audit 0 advisories.
- Ruff lint/format qua.
- Alembic upgrade từ DB trống, downgrade về base và upgrade lại qua trên PostgreSQL 17 test; schema/model không lệch.
- `docker compose config --quiet` qua với credential giả chỉ để validate cấu hình.
- Backend/web Docker builds từ pinned manifest digests qua; backend live/readiness trả ok,
  nginx -t qua. Frozen Linux sync và migration round-trip/schema checks qua;
  [container checks](container-checks.md). Không phải full Compose staging/HTTPS.
- Trình duyệt local hiển thị overview, backend liveness và bảng demo; sửa DEMO-001 Finish
  từ 2026-09-29 sang 2026-10-01 hiển thị đúng before/after, Upload vẫn bị khóa.

Validation dùng Python 3.12.14 và Node.js 26.0.0 trên Windows. Có cảnh báo deprecation của
Starlette TestClient khi dùng HTTPX; tests vẫn qua, cần theo dõi khi nâng bộ test client.
Kiểm tra UI đã thực hiện trong panel trình duyệt hẹp; chưa thay thế kiểm thử desktop đầy đủ.

## Chưa xác minh / chưa triển khai

- Docker Desktop, PostgreSQL test, application image builds và manifest digests đã xác minh local.
- Image scan/lifecycle/security patch, backup/restore, full Compose/Ubuntu staging chưa xác minh.
- Entra local và Onshore test đã cấu hình; đọc WO list/detail và 25 PIC E&I_N thành công,
  grant E&I chỉ xem từ PERSON và timezone Asia/Ho_Chi_Minh đã xác nhận. Offshore chưa kiểm chứng.
- Entra login/callback thật đã xác minh trên Windows local; logout/expiry, chính sách tenant và staging còn pending. Đã có scoped API list WO; đã có detail/create/restore draft; chưa có history, upload Maximo hoặc đối soát upstream.
- Draft đã có API/UI tạo/list/mở/cập nhật/xóa theo owner, stale-edit/version checks và duplicate receipts; audit vẫn là dịch vụ nội bộ. Recovery chỉ chuyển sending cũ sang unknown.
- Có provisioning DB runtime/migration owner và Compose tách DSN; áp dụng trên staging
  còn chờ IT. Chưa kiểm thử worker concurrency hay crash durability.
- Chưa có E2E với backend nghiệp vụ, kiểm thử 10 phiên hay triển khai production;
  CI cũ frontend Ubuntu qua, backend chưa tới tests vì download lỗi; lần chạy bản sửa còn pending.

## Bước tiếp theo

Đối soát toàn bộ mục 1–6 ngày 2026-10-07: xem [99 mục và kế hoạch có phụ thuộc](checklist-review.md).
Trong 44 checkbox gốc chưa tick: 12 đã làm, 21 một phần, 9 chưa đủ kiểm chứng, 2 chưa triển khai.
Checkbox hiện tại đã tách theo phạm vi; không dùng số checkbox mới để so tỷ lệ với bản cũ.

1. Kiểm thử tác vụ nhóm 100–200 WO và keyboard-only/focus; sửa/paste/Undo/preview đã có implementation.
2. Xác minh ba job CI đã push, clean Ubuntu/images/runtime versions; local checks không thay runner results.
3. Nghiệm thu admin/UI và DB roles trên staging, roster và retention theo
   [hồ sơ IT](it-acceptance.md); công cụ bootstrap/Planner/expired-auth cleanup đã có.
4. Đối chiếu metadata/read contract/web-VBA, mở rộng scopes và tenant/staging policy.
5. Chốt WO test/write contract/ETag trước upload orchestration, audit/read-back/unknown recovery.

## Planner và nháp live — 2026-10-02

Migration 0006 lưu permission Planner theo user/connection/discipline, intersect với PERSON;
API admin có CSRF và CLI vận hành DB có audit before/after/reason/source. Không tự cấp admin.
Thu hồi hạ effective grant ngay; user lock serialize với PERSON sync và bước lưu/xóa cuối.
Restore không giữ draft lock trong network I/O và kiểm tra lại version trước trả dữ liệu.

210 backend tests, 52 frontend tests, Ruff lint/format, TypeScript/ESLint/build qua.
Migration và schema check qua trên DB test riêng và local SSO. Browser thật tạo, mở lại,
cập nhật nháp P13457392/BD1 tới v2, thu hồi Planner khóa editor và cấp lại scope E&I.
API lifecycle delete, expired session, PERSON đổi scope, baseline conflict, PM/CFT và
revocation trong network I/O qua PostgreSQL + mocks. Browser live delete đã xác minh sau
xác nhận của chủ dự án: nháp P13457392/BD1 v2 biến mất khỏi danh sách, DB không còn DraftItem
của WO đó; hai nháp khác vẫn còn. Không gọi mutation Maximo. [Vận hành Planner](planner-access.md).

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

Không còn timer refresh 60 giây. Khi quay lại cửa sổ, kiểm tra phiên giữ bộ lọc và bảng,
ẩn editor rồi đọc lại WO/nháp trước hiện lại. Lỗi tạm thời giữ sửa
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


## Admin và IT readiness — 2026-10-07

Admin roster GET/Planner UI `/admin`, bootstrap first-admin có audit 0008 và DB role
provisioning/expired-auth cleanup đã triển khai. Chủ dự án chọn bản thân; local upgrade
0007→0008, exact identity dry-run/execute và audit read-back qua, không thêm WO grants.
254 backend/160 frontend tests và các kiểm tra code/build qua; quyền runtime được thử
trên DB/roles tạm. Staging provisioning/UI/tenant/roster/read contract vẫn pending;
[chi tiết và giới hạn](todos.md), [hồ sơ IT](it-acceptance.md).
Write contract/ETag mới có giao thức nghiệm thu, chưa có bằng chứng live và chưa mở upload.
