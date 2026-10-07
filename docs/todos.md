# TODO — Work Order Scheduler

Cập nhật: 2026-10-07.

## Cách sử dụng

- [x] là đã hoàn thành trong phạm vi ghi ngay tại mục và có bằng chứng; [ ] là còn việc
  hoặc chưa đủ bằng chứng nghiệm thu. Mục gộp được tách để không che phần đã làm/chưa làm.
- Mỗi nhóm có phụ thuộc và tiêu chí nghiệm thu. Hoàn thành mã chưa đồng nghĩa hoàn thành UAT.
- Ghi ngày, bằng chứng kiểm tra và hạn chế khi đánh dấu hoàn thành.
- P0: cần cho bản đầu; P1: mở rộng sau khi luồng chính ổn định.
- Không lưu hostname production chưa được cung cấp, API key hay client secret trong file này.
- Các ghi nhận theo ngày là lịch sử tại thời điểm đó, không phải trạng thái hiện tại.
  Mục 1–6 đã đối soát ngày 2026-10-07; xem [đối soát từng mục và kế hoạch](checklist-review.md).

## 0. Bootstrap tài liệu — hoàn thành

- [x] Chốt frontend/backend riêng, khoảng 10 người dùng, Ubuntu có Docker.
- [x] Chốt Maximo 7.6.1.3; phân biệt hai hệ thống Onshore/Offshore.
- [x] Chốt Entra SSO + integration account; lịch sử người thao tác lưu trên web.
- [x] Chốt planner chỉ được xem/sửa discipline được cấp quyền.
- [x] Chốt các trường cập nhật giống VBA và quy tắc target PM/CFT.
- [x] Hoàn thiện AGENTS.md gốc và hướng dẫn backend/frontend.
- [x] Hoàn thiện architecture.md và README cho dự án.
- [x] Tạo backlog có phụ thuộc và tiêu chí nghiệm thu.

Bằng chứng: các quyết định trong trao đổi với chủ dự án và tài liệu cùng repository.
Trạng thái tại thời điểm bootstrap: chỉ có tài liệu. Foundation được triển khai sau đó;
xem [bằng chứng kiểm tra](implementation-status.md). Chưa có kết nối Maximo thật.

## 0.1. Cấu hình agent Codex — hoàn thành 2026-10-07

- [x] Thiết lập native project config: Main GPT-6.1 Sol / Medium; ba custom agent
      frontend GPT-6 Luna / Medium, backend GPT-6.1 Sol / Medium,
      reviewer GPT-6 Astra / High; tối đa ba sub-agent đồng thời.
- [x] Bổ sung routing vào AGENTS.md: task nhỏ Main tự làm; substantial FE/BE giao
      theo phạm vi, FE+BE độc lập chạy song song; kiến trúc, bug khó/lặp lại và
      final large review giao reviewer. Reviewer mặc định review-only/read-only.
- [x] Thêm [hướng dẫn sử dụng](codex-agents.md) và liên kết trong README.

Bằng chứng: Python tomllib parse đủ bốn TOML và kiểm tra đúng role/model/effort;
Codex CLI 0.160.1 app-server strict config + config/read nạp project trusted,
xác nhận Main Sol/medium và agents enabled/max concurrent = 3. model/list có đủ
ba model và effort tương ứng; debug prompt-input xác nhận AGENTS routing mới
được nạp. Đã kiểm tra liên kết local, placeholder và git diff --check.
Phạm vi là cấu hình/tài liệu; không chạy lượt model/sub-agent live hay suite ứng dụng.
Danh mục model không chứng minh một lượt gọi model thành công. Chat đang chạy giữ
model/effort riêng; dùng chat mới trong project và chọn Sol/Medium khi cần.

## 1. P0 — Thu thập cấu hình và kiểm chứng hợp đồng Maximo

Phụ thuộc: chủ dự án/IT cung cấp thông tin. Có thể làm scaffolding và mock song song về tiến độ.

- [x] Chuẩn bị [checklist thu thập thông tin tích hợp](integration-intake.md) và yêu cầu thông tin
      khởi đầu từ chủ dự án (2026-10-01); Onshore read-only đã xác minh sau đó ngày 2026-10-02.

- [x] Nhận base host `http://bd-maxdev.biendongpoc.vn`, xác nhận môi trường test (2026-10-01).
- [x] Xác nhận context path `/maximo`, test đại diện Onshore, không cần VPN (2026-10-01).
- [x] Xác minh GET Onshore test `oslcmxwodetail`, `mxpersongroup` và `mxperson`
      (2026-10-02): WO list/detail, 25 PIC E&I_N và PERSON discipline; chưa xác minh write contract.
- [ ] Nhận URL/object structures Offshore test và kiểm chứng riêng; không suy rộng từ Onshore.
- [x] Chủ dự án chọn HTTP riêng cho test (2026-10-01); opt-in trong registry, chỉ DB connection test,
      ứng dụng production không dùng HTTP. HTTPS/Entra vẫn yêu cầu TLS hợp lệ.
- [x] Kiểm tra sơ bộ không credential từ Windows: DNS phân giải, HEAD HTTP root trả 403,
      HTTPS lỗi xác minh chứng chỉ (2026-10-01); xem [bằng chứng/giới hạn](integration-intake.md).
- [ ] Xác nhận routing từ Ubuntu tới test Maximo, DNS, TLS và CA nội bộ.
- [x] Nhận/nạp API key test do chủ dự án nhập vào `.env` server-side được ignore;
      GET WO/PERSON/crew thật thành công (2026-10-02), không lấy key từ workbook/source.
- [ ] Xác nhận tài khoản tích hợp chuyên dụng, chủ sở hữu key, quyền tối thiểu và vòng đời key với IT.
- [ ] Chốt kênh bàn giao/rotation secret và secret manager cho staging/production.
- [x] Xác minh đọc field WO/detail và relationship `persongroupteam/respparty` trên
      Onshore E&I (2026-10-02); lỗi status serialization/crew child đã được xử lý và kiểm thử.
- [ ] Đối chiếu metadata đầy đủ, nhất là `lochierarchy.systemid` còn thiếu trong mẫu live,
      và relationship/field ở các discipline/hệ thống khác.
- [x] Xác minh identity đọc Onshore: connection UUID + siteid + workorderid; mở detail
      P13457392/BD1 và nháp live (2026-10-02). WONUM không dùng làm khóa toàn cục.
- [ ] Xác minh resource href dùng cho mutation và orgid/contract write; reader hiện không lấy hai field này.
- [ ] Xác minh status domain APPR/SCHED/WMATL/WMAT/DFAPPR trên từng hệ thống.
- [ ] Kiểm tra parent!="*" và istask=0 có đúng tập WO cần lấy.
- [ ] Xác định giới hạn page size, next-page links, sort và tổng số bản ghi.
- [x] Nhận 6 discipline codes/timezone và mapping crew Onshore từ chủ dự án;
      E&I → E&I_N đã đọc 25 PIC live (2026-10-02).
- [ ] Kiểm chứng crew/PIC live cho MECH/RES/DECK/PROD/DNC và Offshore, chưa coi mapping tham chiếu là nghiệm thu.
- [ ] Xác minh các field optional, null, độ dài PIC, đơn vị/độ chính xác estdur.
- [x] Chốt timezone Onshore `Asia/Ho_Chi_Minh`; date input có offset, lọc từ bao gồm
      đến mốc cuối loại trừ; retrieve tháng 10 được 117 WO (2026-10-07). Xem [reader](maximo-reader.md).
- [ ] Chốt giờ mặc định, clear date/PIC/null và đơn vị/độ chính xác duration cho write contract;
      UI hiện không hỗ trợ clear thành null, Finish tính bằng giờ liên tục chưa phải lịch ca.
- [ ] Kiểm chứng POST + x-method-override: PATCH bằng WO test được chỉ định.
- [ ] Kiểm chứng ETag/If-Match hoặc cơ chế conditional update được hỗ trợ.
- [x] Ghi nhận lỗi live HTTP 400/BMXAA8744E do status list và xử lý redaction lỗi upstream;
      HTTP mock tests bao phủ lỗi authentication/authorization/validation (2026-10-02/07).
- [ ] Thu thập thêm lỗi hợp đồng thực tế đã redaction cho từng hệ thống; không tạo lỗi ghi trên WO chưa chỉ định.
- [x] Có field-mapping từ VBA và fixtures synthetic inline trong tests; không chứa workbook keys.
- [ ] Bổ sung fixtures đã redaction lấy từ response live cùng metadata/contract đã đối chiếu.

Nghiệm thu: có hợp đồng request/response đã kiểm chứng, identity WO, quy tắc ngày và phạm vi
quyền API rõ ràng. Không dùng hostname giả để đánh dấu hoàn thành.

## 2. P0 — Khởi tạo mã nguồn và công cụ

Phụ thuộc: tài liệu đã hoàn thiện. Không cần credential thật.

- [x] Khởi tạo Git và .gitignore nếu chủ dự án tiếp tục triển khai trong thư mục hiện tại;
      hoàn thành git init ngày 2026-09-25; đã có commits và remote GitHub, main đồng bộ origin/main
      sau push commit 82900f3 ngày 2026-10-01.
- [x] Pin Python 3.12.14, Node 26.0.0, uv 0.11.9; dependency lockfiles và local checks
      qua (2026-10-07), CI dùng cùng baseline. Đây là bằng chứng tương thích local.
- [x] Pin verified manifest digests Python/uv/Node/nginx/PostgreSQL trong Dockerfiles,
      Compose/test và CI; build backend/web Linux, health/readiness/nginx config qua (2026-10-07).
      Frozen clean sync + 244 backend tests/migration round-trip trên Linux qua;
      [phạm vi](container-checks.md) chưa thay full Compose/Ubuntu staging.
- [ ] Đánh giá/nâng security patch runtime/dependency lifecycle, scan OS/Python images,
      SBOM và chính sách refresh digest; baseline Python 3.12.14 hiện được giữ để sửa CI.
- [x] Scaffold backend theo backend/AGENTS.md; pyproject.toml, uv.lock và app factory.
- [x] Scaffold React/Vite/TypeScript strict; package.json và package-lock.json.
- [x] Thiết lập settings tập trung, kiểm tra cấu hình và .env.example không có secret.
- [x] Tạo health/readiness endpoints; không đưa thông tin credential vào response.
- [x] Thiết lập Ruff, pytest, typecheck, frontend lint/test/build scripts.
- [x] Thêm workflow GitHub Actions cho backend/frontend và PostgreSQL migrations/tests
      (2026-10-07); actionlint và kiểm tra tương đương local qua. Kết quả runner đã đọc;
      xem [CI](ci.md) và bằng chứng cuối checklist.
- [x] CI đã commit/push trong `dd9cae6`; GitHub connector xác nhận commit tồn tại
      (đối soát 2026-10-07), local main khớp origin/main.
- [x] Đọc run/job logs 37590200157: frontend Ubuntu success; hai backend jobs failure tại
      uv Python download. Sửa dùng setup-python SHA pinned, giữ 3.12.14/uv 0.11.9 (2026-10-07).
- [ ] Commit/push bản sửa và xác minh cả ba job success trên GitHub Ubuntu runner.
- [x] Ghi lệnh chạy local và các kiểm tra thật sự chạy được vào README.

Nghiệm thu: môi trường sạch cài bằng lockfile và chạy frontend/backend với dữ liệu mock;
thiếu config bắt buộc phải báo rõ, không tự dùng endpoint production.

Bằng chứng 2026-09-25: backend và frontend chạy local; lockfiles đã tạo; lint/typecheck,
unit/UI tests và frontend build đã qua. Image digest và PostgreSQL runtime chưa xác minh.

## 3. P0 — Database và migration

Phụ thuộc: 2; refinement từ 1.

- [x] Tạo model/migration User, AccessGrant và MaximoConnection (2026-09-25).
- [x] Triển khai lưu Session hash/expiry và logout với CSRF (2026-09-29).
- [x] Nối Session với callback MSAL + JWT validation; local tenant login/callback thật
      qua ngày 2026-10-02. MFA/Conditional Access/staging vẫn chờ nghiệm thu ở mục 4.
- [x] Thiết kế Draft/DraftItem với owner, scope, baseline, revision và proposed changes (2026-09-29).
- [x] Schema UploadBatch/UploadItem/AuditEvent, item UUID và unique idempotency theo actor.
- [x] Submit nháp đơn/nhóm kiểm tra request hash, actor + request_id, version và durable
      receipts (0004); duplicate/concurrency tests PostgreSQL qua (2026-10-07).
- [ ] Upload orchestrator kiểm tra request hash khi submit lặp, liên kết retry attempts
      và correlation logs; schema/state service chưa phải remote upload orchestrator.
- [x] Đặt unique/index theo connection + site + workorderid; không dùng WONUM làm khóa toàn cục.
- [x] DB lưu connection metadata/base_url/timezone/enabled/secret_reference; API key
      ở registry server-side, không nằm trong business tables. Onshore connection có audit
      đã dùng live (2026-10-02); secret manager resolver theo reference còn chưa triển khai.
- [x] Tạo/review migration 0001_identity; sinh PostgreSQL SQL offline thành công (2026-09-25).
- [x] Áp dụng migrations tới 0007; upgrade/check/downgrade/upgrade/check trên DB tạm
      và 100 PostgreSQL tests qua (2026-10-07). DB ứng dụng không bị downgrade.
- [x] State machine sending/unknown và hàm chuyển sending quá hạn thành unknown.
- [ ] Nối recovery vào worker lifecycle/lease và kiểm thử crash khi gửi Maximo thật.
- [ ] Xác định retention cho draft, session và audit cùng IT/chủ dự án.
- [x] Trigger append-only chặn UPDATE/DELETE/TRUNCATE ở audit_event/authorization_event;
      PostgreSQL tests qua (2026-10-07).
- [x] Triển khai provisioning runtime/migration owner và test đặc quyền trên DB mới
      riêng (2026-10-07): runtime không DDL/TEMP/TRUNCATE/gỡ audit/nâng admin hoặc xóa receipts/uploads.
- [ ] IT áp role/DSN tách biệt và nghiệm thu trên staging; owner vẫn có thể gỡ bảo vệ,
      không dùng owner credentials cho backend. Compose đã tách DSN, chưa provision staging.

Nghiệm thu: migration áp dụng được trên DB trống; constraints và state transitions có test;
audit tách khỏi log kỹ thuật và không chứa credential.

## 4. P0 — Entra SSO và phân quyền

- [x] Bắt đầu checklist thu thập Entra (2026-10-02) tại [Entra setup](entra-setup.md):
      đối chiếu config/backend auth hiện có và tài liệu Microsoft về app/redirect URI.
      Đã phân biệt Client ID, user Object ID, credential server-side và HTTPS callback.
      Kiểm tra liên kết nội bộ và diff; chỉ thay đổi tài liệu, không chạy application tests.
      Chưa nhận tenant/client ID, hostname, credential hoặc tài khoản test; chưa kiểm thử live.
- [x] Chủ dự án xác nhận chưa có app registration (2026-10-02); bổ sung hướng dẫn tạo
      app test single-tenant và lấy hai ID trong Entra setup, đối chiếu Microsoft Learn.
      Kiểm tra diff/link nội bộ; chưa tạo app trên tenant, chưa nhận ID và chưa chạy live login.
- [x] Ghi nhận chủ dự án báo đã tạo app registration (2026-10-02).
      Bằng chứng: xác nhận trong trao đổi; chưa đối chiếu portal, nhận hai ID hoặc xác minh
      single-tenant/Web/callback. Kiểm tra diff tài liệu qua; chưa chạy live login.
- [x] Nhận Tenant ID và Application (client) ID từ chủ dự án (2026-10-02), ghi trong
      [Entra setup](entra-setup.md); kiểm tra định dạng UUID và diff tài liệu qua.
      Chủ dự án xác nhận chưa có tên miền HTTPS; chưa chọn local/staging, nhận credential,
      đối chiếu tenant/app thật hoặc kiểm thử login. Mục intake tổng thể vẫn chưa hoàn tất.
- [x] Chuẩn bị Entra Windows local HTTPS (2026-10-02): cert localhost 30 ngày tin cậy
      Current User, Vite loopback 5173, proxy API và callback log redaction; không thêm dependency.
      PostgreSQL development riêng 55433 có volume/image digest, backend Windows SelectorEventLoop.
      HTTPS frontend/API live/ready 200 với trust verification, migration/schema check qua;
      frontend typecheck/lint, Ruff launcher và diff/link tài liệu qua. Ignore secret/PFX đã xác nhận.
      Hướng dẫn: [Windows local](entra-local-windows.md). Chưa có credential hoặc browser live login;
      callback/assignment/MFA trên Entra và WO grants còn pending.
- [x] Bật Entra config local và restart backend (2026-10-02): secret do chủ dự án nhập
      trong `.env`, bỏ comment bốn trường sau khi kiểm tra IDs/callback; không in credential.
      Readiness 200, login_available=true; MSAL discovery tenant thật qua, HTTPS login 303
      tới đúng tenant/callback với PKCE và flow cookie Secure/HttpOnly. Kiểm tra diff/link qua.
      Backend cần mạng ngoài sandbox; không tắt TLS. Chưa xác minh client secret bằng token
      exchange, browser MFA/callback/session, assignment hoặc WO grants; live login vẫn pending.
- [x] Xác minh Entra login/callback/session live cơ bản trên Windows local (2026-10-02):
      chủ dự án báo browser login thành công; đọc DB riêng xác nhận một user đúng tenant,
      active, một session còn hạn, không admin và không WO grants. Không đọc/in token/secret.
      Cập nhật tài liệu trạng thái; diff/link qua. Chưa kiểm thử logout/expiry, chính sách
      tenant/MFA hoặc staging; không đánh dấu nghiệm thu Entra tổng thể hoàn tất.
- [x] Ghi nhận logout/login lại local được chủ dự án xác nhận đúng (2026-10-02).
      Đọc DB hiện tại: một session còn hạn, không WO grants và chưa có Maximo connection.
      Chuẩn bị intake connection/discipline/capability cho tài khoản test; diff/link qua.
      Chưa cấp quyền hoặc gọi Maximo; cookie cũ/expiry/Conditional Access chưa kiểm chứng riêng.
- [x] Chốt phạm vi khởi đầu Onshore test + chỉ xem (`read`) với chủ dự án (2026-10-02).
      Ghi trong integration intake, đối chiếu field discipline `bdpocdiscipline` theo reader;
      diff/link tài liệu qua. Chưa nhận mã discipline/timezone/API key hoặc xác minh OSLC URL;
      chưa tạo connection/grant hoặc gọi Maximo thật.
- [x] Nhận danh mục discipline từ ảnh Value/Description và xác nhận timezone
      `Asia/Ho_Chi_Minh`, chủ dự án có API key test (2026-10-02).
      Chuẩn bị registry Onshore test được comment/empty key trong `.env` Git ignore;
      không sửa Entra credential, không thêm dependency. Diff/link và ignore qua.
      Chưa chọn discipline của tài khoản, chưa nạp key hoặc tạo connection/grants;
      collection/status domain vẫn là tham chiếu, chưa kiểm thử API Maximo live.
- [x] Kiểm tra lại `.env` theo phản hồi chủ dự án (2026-10-02): dòng Maximo không còn
      trên đĩa; thêm lại registry comment với UUID đã chuẩn bị và key rỗng, xác minh dòng 10.
      Giữ nguyên cấu hình Entra; mở editor tại dòng 10. Diff tài liệu và Git ignore qua.
      Chưa bật registry, nhận key hoặc cấp grants.
- [x] Chủ dự án nhập API key test và bật dòng WOS_MAXIMO (2026-10-02).
      Settings validation qua: đúng URL Onshore test, key không rỗng, HTTP opt-in và
      development, Entra config còn đủ; không in key. Diff tài liệu qua.
      Chưa restart backend nạp registry, chưa chốt discipline/tạo connection/grants,
      chưa xác minh API key bằng request Maximo thật.
- [x] Quyền Onshore test từ PERSON theo yêu cầu chủ dự án (2026-10-02): signed Entra
      preferred_username bỏ domain `biendongpoc.vn` để lookup mxperson.ct_discipline;
      tenant/object ID vẫn là identity, binding unique theo connection; read-only và audit.
      Recheck nguồn quyền trước/sau WO/detail/draft, revoke/fail closed khi lookup lỗi/null;
      không nhận personid/discipline quyền từ browser. Migration 0005 + connection local có audit.
      186 backend tests (129 fast + 57 PostgreSQL), Ruff lint/format, migration/schema check ở
      DB test và local SSO qua; restart backend, HTTPS readiness 200; diff/link qua.
      GET mxperson thật 200: duongvq→E&I; nhatnh→NHATNH, ct_discipline trống. API key đã
      được dùng chỉ server-side trong GET, không mutation. Không thêm dependency.
      Cần Maximo điền ct_discipline của NHATNH và re-login để lưu signed locator;
      chưa cấp grant, chưa WO retrieve/browser E2E, chưa kiểm thử tải hoặc quản trị remap.
      Hướng dẫn: [PERSON access](person-access.md).
- [x] Kiểm chứng login → PERSON → quyền E&I trên giao diện (2026-10-02): chủ dự án
      cập nhật NHATNH.ct_discipline=E&I và re-login; đọc DB local xác nhận signed login
      nhatnh@biendongpoc.vn, binding nhatnh, đúng một E&I/read grant, không admin và audit
      connection_created/person_binding/person_grants. Diff/link tài liệu qua.
      Chưa WO retrieve thật, status/date/crew contract hoặc E2E nháp/upload; không chạy lại
      suite vì chỉ ghi nhận kết quả live và thay đổi tài liệu.

Phụ thuộc: 2, 3; app registration từ IT.

- [x] Nhận tenant/client ID, client secret server-side và callback HTTPS localhost;
      login/callback/session thật qua (2026-10-02). Logout hiện chỉ kết thúc phiên ứng dụng.
- [ ] Chốt nhóm/người được đăng nhập, expiry/rotation credential và URI logout/staging với IT.
- [x] Chủ dự án đã tạo app registration và cấu hình callback local hoạt động (2026-10-02).
- [ ] Đối chiếu single-tenant/Web, assignment và chính sách tenant trên portal cùng IT.
- [x] Triển khai login/callback/logout bằng MSAL + PyJWT; state/nonce/PKCE và JWT validation.
- [x] Xác minh login/callback/session thật và local HTTPS tin cậy; chủ dự án xác nhận
      logout/login lại (2026-10-02).
- [ ] Nghiệm thu MFA/Conditional Access, blocked account, cookie cũ/expiry live và TLS/proxy staging với IT.
- [x] Session server-side, expiry, Secure/HttpOnly cookie và CSRF logout (2026-09-29).
- [x] CSRF cho mọi API mutation hiện có: logout, nháp đơn/nhóm, delete, Planner admin,
      Settings; backend/frontend tests qua (2026-10-07). Upload tương lai phải áp cùng policy.
- [x] Ánh xạ identity theo tenant ID + object ID; user mới không có WO grants/admin.
- [x] Viewer read/Planner write/Admin configuration theo policy server; PlannerPermission
      intersect PERSON discipline (0006), không nhận role/discipline quyền từ client.
- [x] Admin không bypass WO grants; test admin không grant bị từ chối (2026-10-07).
- [x] Bootstrap first-admin có dry-run/execute, stable identity/tenant, serialize và audit
      append-only 0008; chủ dự án chọn bản thân và cấp local có audit (2026-10-07), không thêm WO grants.
- [ ] IT duyệt operator/authority workflow và nghiệm thu bootstrap trên staging.
- [x] Một identity chủ dự án có Planner Onshore test/E&I, cấp/thu hồi live có audit (2026-10-02).
- [ ] Nhận/duyệt roster planner/grants cho các người dùng, discipline và hệ thống còn lại.
- [x] Shared checks session/PERSON/configured connection/grants cho list/detail/PIC,
      nháp đơn/nhóm, markers và counts hiện có; kiểm tra lại sau I/O/trước lưu.
- [ ] Áp policy đúng scope cho history/upload/job status khi xây các API này; hiện chưa có endpoint.
- [x] Guessed IDs/out-of-scope/owner mismatch bị từ chối không trả nội dung WO/nháp;
      backend PostgreSQL + HTTP mocks qua (2026-10-07).
- [x] Thu hồi grant/PERSON đổi discipline/WO chuyển scope được recheck fail closed;
      UI xóa cache theo actor/scope hoặc ẩn nội dung khi xác minh lỗi; tests qua (2026-10-07).
- [x] Authorization audit cho connection/PERSON binding/grants và Planner changes;
      actor/before/after/reason/source cùng transaction, append-only (0005/0006).
- [x] Tests synthetic phiên hết hạn, sai tenant, scope giả, guessed IDs, revoked grants
      và revocation giữa network I/O qua (2026-10-07); không thay nghiệm thu tenant live.

Nghiệm thu: planner discipline A không đọc hoặc sửa dữ liệu B qua UI, direct API, draft,
history hay upload; quyền Onshore không tự cấp quyền Offshore.

## 5. P0 — Connector và retrieve WO

Phụ thuộc: 1, 2, 4; có thể phát triển trước bằng fixtures.

- [x] Registry runtime theo connection UUID, timeout riêng; metadata/nhãn từ DB.
- [x] Registry/grants thật Onshore test/E&I, connection audit, Planner API/CLI có audit;
      Settings chọn connection đã được cấp quyền (2026-10-02/06).
- [x] UI `/admin` xem roster/connection đã cấu hình và cấp/thu hồi scoped Planner
      có audit/CSRF/session recheck; synthetic tests qua (2026-10-07).
- [ ] UI cấu hình connection/identity lifecycle và mở rộng registry/scopes ngoài Onshore E&I;
      Planner UI không sửa URL/secret/authority hoặc tạo roster chưa duyệt.
- [x] Cài HTTP client với header API key, TLS verification và log đã redaction.
- [x] Áp scope server-side; encode filter values, không nối raw query từ người dùng.
- [x] Map trường VBA: progress, discipline, wonum, description, worktype, location, system,
      dates, status, priority, lead, PIC, duration và workorder ID.
- [x] Lấy siteid/workorderid và kiểm tra identity khi phân trang.
- [ ] Lấy và xác minh revision/ETag cần cho cập nhật an toàn.
- [x] Xử lý optional values và lỗi response có kiểm soát.
- [x] Lấy đủ các trang; chỉ theo links thuộc trusted connection.
- [x] Filter target date có offset, status domain cấu hình và discipline được cấp quyền.
- [x] Tìm kiếm WO/mô tả/Tag Name và lọc status trong tập WO đã tải (2026-10-02);
      timezone/range Onshore test đã xác nhận, server search/paging UI chưa triển khai.
- [x] Lấy crew/PIC theo mapping server; đọc đủ child pages với bounds/identity checks,
      25 PIC E&I_N live và synthetic tests qua (2026-10-02/07).
- [ ] Nghiệm thu crew/PIC các discipline khác/Offshore và child paging lớn trên test.
- [x] Xử lý upstream unavailable/API key hết hiệu lực, không trả stale data ngoài quyền.
- [ ] Đối chiếu tập WO web/VBA với cùng hệ thống, bộ lọc và thời điểm trên test.

Nghiệm thu: kết quả đủ trang và đúng scope; hai hệ thống có WO trùng số vẫn tách biệt;
lỗi upstream không bị hiển thị thành danh sách rỗng thành công.

## 6. P0 — Bảng lập lịch và lưu nháp

Phụ thuộc: 3, 4, 5; có thể dựng UI với fixture trước.

- [x] Layout desktop bảng gọn/panel đơn/nhóm, nhãn scope/system/environment, phiên,
      bộ lọc từ grant server; viewport desktop/hẹp đã kiểm tra live (2026-10-05/07).
- [x] Chọn native HTML table + panel theo thiết kế chủ dự án duyệt; sửa ô/paste/Undo,
      synthetic chọn/lọc 100 WO và live retrieve 117 WO (2026-10-05/07).
- [x] Kiểm thử synthetic nhóm 100/200 WO: sửa nhóm/ngoại lệ, paste lỗi/hợp lệ, Undo/reset,
      preview/lưu/mở lại và stale/version/revoked/delayed responses (2026-10-07).
      Chromium local có số đo thao tác; [bằng chứng/phạm vi](large-batch-keyboard-tests.md).
- [ ] Nghiệm thu monthly-load live, độ trễ Maximo và 10 planner; chưa có performance SLO
      được chốt. Chưa cần thêm grid dependency theo kiểm tra synthetic hiện có.
- [x] Dữ liệu nghiệp vụ tương đương workbook được map vào bảng 7 cột + panel 17 field
      theo thiết kế đã duyệt; discipline ở scope, System ID/WOID giữ nội bộ, không tái tạo 21 cột nguyên mẫu.
- [x] Sửa Start/PIC/Duration; Finish read-only tính Start + giờ duration khi Start/Duration
      thay đổi, editor đơn và nhóm (2026-10-05/07). Không tự viết lại lịch khi chỉ sửa PIC.
- [x] Cho chọn đổi target; khóa PM/CFT và giải thích tại editor (2026-10-01).
- [x] Áp Scheduled Start/PIC/Duration cho dòng chọn, giữ ngoại lệ từng WO/Undo/paste;
      server validate từng WO và lưu toàn nhóm trong một transaction (2026-10-05/07).
- [x] Modified fields/reset/before-after preview đơn và nhóm; cần preview trước lưu nhóm.
- [x] Date input/display/serialization theo timezone connection đã chốt Onshore;
      tests offset/calendar/fractional duration/cross-midnight qua (2026-10-07).
- [x] Lưu/restore/update/delete nháp đơn/nhóm theo owner + scope, tối đa 200 WO;
      baseline/version/duplicate receipt kiểm tra trên server, nháp không ghi Maximo.
- [x] Bảo vệ edits khi đổi filter/hệ thống; không hiển thị nhầm dữ liệu connection cũ (2026-10-01).
- [x] Validate cả frontend và backend; backend là nguồn quyết định (2026-10-01).
- [x] Controls có labels/status/alert và panel focus/Escape; UI tests labels,
      loading/empty/error, giữ edits khi lỗi và session rechecks qua (2026-10-07).
- [x] Chromium synthetic xác minh Tab/Shift+Tab/Enter/Escape/Space, vòng Tab và focus return
      cho panel đơn/nhóm/chooser; giữ edits qua Settings, radio ArrowDown/Tab/Enter qua.
      Sửa focus sau Save và khóa lưu sau version conflict; 151 frontend tests qua (2026-10-07).
- [ ] Nghiệm thu keyboard-only toàn ứng dụng, screen reader/zoom/high contrast và browser khác;
      các mốc focus trong harness không thay thế toàn bộ accessibility UAT.

Nghiệm thu: thao tác giống bảng Excel, nháp không thay đổi Maximo; khôi phục nháp không vượt
scope hiện tại; preview phản ánh chính xác payload sẽ gửi.

## 7. P0 — Upload, audit và phục hồi

Phụ thuộc: 1, 3, 4, 5, 6.

- [ ] Tạo endpoint preview/submit với allowlist field và typed validation.
- [ ] Re-read từng WO; kiểm tra scope, worktype, baseline và revision trước write.
- [ ] Chặn target PM/CFT ngay cả khi gửi request thủ công.
- [ ] Kiểm chứng PIC, duration, date order và clear semantics theo hợp đồng đã chốt.
- [ ] Gửi chỉ các thay đổi được chọn; không ghi đè trường không chỉnh sửa.
- [ ] Tạo durable audit intent trước request; DB lỗi thì không gửi write.
- [ ] Dùng conditional update đã kiểm chứng; nếu không có, ghi hạn chế/race và chốt phương án
      trước production, không gọi read-before-write là bảo đảm nguyên tử.
- [ ] Deduplicate submit lặp, khóa/tuần tự hóa WO trong ứng dụng và giới hạn request song song.
- [ ] Xử lý kết quả từng WO: confirmed, failed, conflict, unknown; batch có thể thành công một phần.
- [ ] Read-back và normalize kết quả sau upstream success.
- [ ] Đối soát timeout/mất mạng sau send; không blind retry.
- [ ] Phục hồi attempt khi backend restart hoặc DB lưu kết quả thất bại sau upstream write.
- [ ] Cho retry có kiểm tra lại đối với lỗi đã xác định; giữ liên kết các attempts trong audit.
- [ ] Xây màn hình tiến độ/kết quả upload và lịch sử before/after đúng scope.
- [ ] Redact response lỗi và log; tránh lộ WO ngoài quyền qua thông báo.

Nghiệm thu: không có upload thiếu actor/audit intent; mixed batch có kết quả đúng từng dòng;
double-click/restart không gây gửi lại mù; unknown luôn phân biệt với failed/confirmed.

## 8. P0 — Kiểm thử tổng thể và UAT

Phụ thuộc: 4–7; test Maximo và users theo discipline.

- [ ] Unit tests cho PM/CFT, allowlist, duration và ngày/giờ.
- [ ] Integration tests cho grants, các scoped endpoints và migration trên PostgreSQL.
- [ ] Contract tests cho pagination, null fields, Maximo errors và payload serialization.
- [ ] Test timezone UTC+07 theo cấu hình được xác nhận, cuối ngày/tháng và ngày không hợp lệ.
- [ ] Test cùng WONUM/workorderid ở hai connection và các site.
- [ ] Test WO đổi discipline, user bị thu hồi quyền khi đang giữ draft.
- [ ] Test stale baseline/ETag; hai planner sửa cùng WO; người sửa trực tiếp trên Maximo.
- [ ] Test CSRF, session expiry, sai tenant và client giả mạo field/scope.
- [ ] Test mixed batch, timeout trước/sau send, duplicate submission và restart recovery.
- [ ] Kiểm tra frontend build/log/fixtures không có key hoặc token.
- [ ] Chạy E2E login → retrieve → draft → preview → upload → read-back → history.
- [ ] Kiểm thử khoảng 10 phiên đồng thời; ghi số WO, batch size và latency thực đo.
- [ ] Cùng planner đối chiếu các trường cập nhật với VBA trên WO test được chỉ định.
- [ ] Chủ dự án nghiệm thu kết quả và các hạn chế còn lại; ghi biên bản UAT.

Nghiệm thu: các invariants trong architecture.md có bằng chứng kiểm thử; mọi sai lệch so với
VBA đã giải thích, đặc biệt bộ lọc ngày, PIC và target.

## 9. P0 — Docker, staging và vận hành production

Phụ thuộc: 2–8; DNS/TLS, credentials và chính sách vận hành từ IT.

- [ ] Tạo Dockerfiles và Compose cho frontend/reverse proxy, backend và PostgreSQL.
- [ ] Pin images, healthchecks, restart policy và persistent database volume.
- [ ] Chỉ expose HTTPS proxy; DB/backend không mở trực tiếp ra mạng ngoài nếu không cần.
- [ ] Cấu hình DNS/certificate/CA và kiểm tra đường mạng browser/server → Entra/Maximo.
- [ ] Tách cấu hình/secret test và production; không có fallback sang production.
- [ ] Thực hiện migration một cách có kiểm soát khi deploy.
- [ ] Xây backup theo retention đã chốt; thực hành restore và ghi bằng chứng.
- [ ] Log có correlation ID, theo dõi lỗi upstream, unknown attempts và dung lượng DB.
- [ ] Viết runbook deploy/update/rollback, credential rotation và xử lý upload chưa rõ kết quả.
- [ ] Chuẩn bị integration accounts riêng cho hệ thống đích và grants người dùng.
- [ ] Xem xét thay key workbook khi chuyển đổi; phối hợp thời điểm để không làm gián đoạn Excel.
- [ ] Triển khai staging, nghiệm thu xong mới xác nhận thời điểm chuyển production.
- [ ] Deploy production theo quyết định rollout của chủ dự án; kiểm tra read-only trước,
      sau đó upload một WO được chọn và theo dõi.
- [ ] Bàn giao hướng dẫn planner/admin và đầu mối hỗ trợ.

Nghiệm thu: có HTTPS, backup khôi phục được, secret tách môi trường, UAT hoàn tất và runbook
thực hiện được. Kế hoạch này không đồng nghĩa đã deploy hoặc được phép ghi production ngay.

## 10. P1 — Chức năng còn lại của workbook

Phụ thuộc: bản đầu ổn định; chốt phạm vi với chủ dự án.

- [ ] Scheduled WO: filter theo schedule, status và scope.
- [ ] Crew Worksheet: giờ theo WO/PIC; đối chiếu công thức và header nhân sự.
- [ ] Summary of Crew Worksheet: tổng hợp theo người trong phạm vi được phép.
- [ ] In Progress/Completed: actual hours và planning efficiency; xử lý estdur=0.
- [ ] Chốt định nghĩa compliance trước khi tái tạo chỉ số của Excel.
- [ ] Export Excel/CSV có scope và bảo vệ nội dung công thức khi mở trong spreadsheet.
- [ ] Đánh giá lịch/Gantt nếu planner cần; không đưa vào bản đầu mặc định.

## Thứ tự bắt đầu

1. Hoàn thành scaffolding, DB và mock contracts (2–3) trong khi thu thập mục 1 và Entra.
2. Làm SSO/scope và connector read-only (4–5).
3. Hoàn thiện bảng và nháp (6).
4. Upload có audit/conflict/recovery (7).
5. Kiểm thử/UAT và triển khai có kiểm soát (8–9).

Mục 2 đã có nền tảng; mục 3 đã có migration session/draft/upload/audit và PostgreSQL tests.
Bảng /demo là preview tạm với dữ liệu giả, không đánh dấu mục 6 hay 7 là hoàn thành.
PostgreSQL test riêng đã chạy trong Docker; full application Compose chưa build/run.

Cập nhật preview 2026-09-25: đã đối chiếu 21 cột Excel, thêm PIC/duration, Upload? và
Change Target?, preview theo dòng chọn. Mục 6 vẫn chưa hoàn thành vì chưa có dữ liệu thật/lưu nháp.

Bằng chứng 2026-09-29: 35 backend tests qua, trong đó 5 PostgreSQL scenarios kiểm tra
session/logout/CSRF, revoked grants, admin không bypass, draft owner và discipline đổi,
connection/site identity, duplicate upload, sending recovery và audit append-only.
Migration upgrade/downgrade/upgrade + schema check qua. Không thay thế UAT hoặc Maximo tests.
Xem [hướng dẫn kiểm thử](database-tests.md) và [trạng thái](implementation-status.md).

SSO 2026-09-29: đã có UI login/logout/session, schema flow một lần, cookie binding và expiry.
60 backend + 8 frontend tests qua; lint/typecheck/build qua. Tests không gọi tenant thật.
Xem [entra-setup.md](entra-setup.md); login chưa bật vì chưa có app registration/HTTPS.

Reader 2026-09-29: các mục connector đã tích được kiểm tra với HTTP giả và PostgreSQL thật,
không phải bằng chứng tương thích Maximo nội bộ. 109 backend tests và Ruff qua.
Chưa nối UI, crew/detail, revision hoặc upload. Xem [Maximo reader](maximo-reader.md).

## Giao diện retrieve — 2026-09-30

- [x] Route /work-orders gọi API thật theo session/grants; chỉ đọc.
- [x] Hiển thị hệ thống/môi trường/discipline, 21 cột Excel và Site.
- [x] Bộ chọn lịch cho hai ô lọc Target Finish (2026-10-02); chuyển ngày thành ISO có offset
      lúc 00:00 theo timezone connection do backend cung cấp, không dùng timezone trình duyệt.
- [x] Hủy request và bỏ phản hồi cũ khi đổi scope/filter, rời trang hoặc kiểm tra lại phiên.
- [x] Phân biệt loading, empty, error, chưa đăng nhập và chưa có quyền.
- [x] 18 frontend tests, typecheck, lint và production build qua.
- [ ] Kiểm thử live login/retrieve và desktop UI với dữ liệu Maximo test.
- [x] API chi tiết WO, crew/PIC với synthetic tests (2026-09-30).
- [ ] Revision/ETag đã xác minh trên Maximo test.

Bảng chỉ giữ dữ liệu trong RAM; kiểm tra lại phiên mỗi phút khi không đang retrieve,
khi quay lại cửa sổ và khi tab hiện lại. Hiện xóa bảng khi kiểm tra lại để tránh giữ scope cũ;
người dùng cần retrieve lại. Các kiểm thử frontend dùng mock, không thay thế kiểm thử backend.

## Detail/PIC/draft API — 2026-09-30

- [x] Scoped detail theo connection/site/WO; kiểm tra status/task/parent hiện tại.
- [x] Crew group mapping server-side và đọc PIC theo respparty; chặn response sai/incomplete.
- [x] POST draft có CSRF/write grant và baseline/PIC lấy từ server.
- [x] GET draft owner-only; kiểm tra scope hiện tại, báo baseline đổi và thay đổi không hợp lệ.
- [x] 129 backend tests, Ruff lint/format qua; PostgreSQL test đã chạy.
- [ ] Xác minh crew relationship, child paging và field identity trên Maximo test.
- [x] Thêm precondition stale-edit và UI chỉnh sửa/lưu/mở nháp một WO (2026-10-01).
- [x] List/update/delete draft, version checks và durable duplicate submission (2026-10-01).
- [ ] Revision/ETag và điều kiện upload đã xác minh trên Maximo test.

API nháp đã nối UI ngày 2026-10-01; không có mutation Maximo. Xem [hợp đồng nháp](drafts.md) cho giới hạn.


## Hoàn thiện nháp và editor — 2026-10-01

- [x] Baseline token từ detail và so sánh fresh WO khi tạo/cập nhật nháp; stale edit trả 409.
- [x] API list/update/delete; owner + grants + upstream checks, version lock và CSRF.
- [x] Durable receipts cho duplicate create/update; giữ receipt sau xóa, không tạo lại nháp đã xóa.
- [x] Kiểm thử PostgreSQL đồng thời: create trùng thành một nháp, update cùng version chỉ một thành công.
- [x] UI editor một WO, PIC crew, lịch/duration, target có intent, PM/CFT lock và before/after/reset.
- [x] Lưu/mở/cập nhật/xóa nháp từ /work-orders; lỗi lưu giữ edits và retry cùng request ID.
- [x] Bảo vệ đổi filter/system; recheck session + WO trước hiện lại edits; mất quyền/phiên xóa dữ liệu.
- [x] Chặn ngày lịch không tồn tại và nhận diện duration/offset khác cách viết nhưng cùng giá trị.
- [x] 131 backend tests, 46 frontend tests, Ruff/TypeScript/ESLint/build và Alembic schema check qua.
- [ ] Browser E2E và kiểm chứng Maximo/Entra thật.
- [ ] Chặn navigation Back trong SPA; sửa/paste/áp ngày nhiều dòng và nháp nhiều WO.
- [ ] Chốt retention/cleanup cho draft_submission và nháp với IT.

Không đánh dấu mục 6 hoặc UAT hoàn tất: UI hiện dùng editor từng WO, chưa phải grid chỉnh sửa
nhiều dòng. Không có remote mutation; baseline token không thay thế conditional write của Maximo.
Hợp đồng và hướng dẫn: [drafts.md](drafts.md).

## Theo dõi hoàn tất task — 2026-10-01

- [x] Commit/push phần hoàn thiện nháp và kiểm thử lên origin/main: 82900f3;
      đã xác minh HEAD bằng origin/main và working tree sạch sau push.
- [x] Ghi quy tắc bắt buộc cập nhật docs/todos.md sau mỗi task hoàn tất trong AGENTS.md;
      cập nhật ngày, phạm vi, bằng chứng kiểm tra và giới hạn; kèm TODO trong commit của task.

Kiểm tra thay đổi tài liệu: liên kết nội bộ và git diff --check qua; không cần chạy lại application tests.


## HTTP riêng cho Maximo test — 2026-10-01

- [x] Ghi nhận Onshore test /maximo, không VPN, chưa cài chứng chỉ; chủ dự án cho phép HTTP cho test.
- [x] Thêm allow_http_for_test mặc định false; HTTP cần opt-in boolean trong registry.
- [x] Guard chung cho list/detail/PIC/draft: URL khớp metadata, connection test, ứng dụng không production.
- [x] Chặn HTTP khi connection/app production; kiểm tra lại metadata sau retrieve; giữ HTTPS/Entra/TLS rules.
- [x] 107 fast + 40 PostgreSQL tests qua (147 tổng), Ruff lint/format qua; không thêm dependency/migration.
- [ ] Nhận credential/API key test qua kênh bảo mật, grants/timezone/crew và WO được chỉ định.
- [ ] Kiểm chứng OSLC authentication/object structures và hợp đồng thật; routing từ Ubuntu.

HTTP opt-in không chứng minh API thật đã hoạt động. Kiểm tra mạng hiện mới DNS/HEAD root từ
Windows; không gửi credential hoặc mutation. Xem [thu thập thông tin](integration-intake.md)
và [cấu hình reader](maximo-reader.md).

## Bộ chọn lịch Target Finish — 2026-10-02

- [x] Hai ô Target Finish từ/trước dùng date input với nút mở lịch của trình duyệt.
- [x] Session API trả timezone connection; ngày chọn chuyển thành midnight có offset tương ứng.
- [x] Giữ khoảng lọc bao gồm ngày đầu, loại trừ 00:00 ngày cuối; hướng dẫn chọn ngày kế tiếp
      để lấy trọn ngày cuối mong muốn.
- [x] 49 frontend tests, TypeScript, ESLint và build qua; 5 PostgreSQL session tests và Ruff qua.
      Có kiểm thử UTC+07, offset 45 phút, DST, ngày không tồn tại và midnight không duy nhất.
- [x] Kiểm tra browser Windows local: cả hai ô hiển thị biểu tượng lịch và accessibility
      có nút Show date picker; quyền Onshore test E&I vẫn xuất hiện.

Không thêm dependency. Chưa kiểm chứng retrieve WO thật hoặc upload Maximo trong task này.

## Sửa lỗi query status khi retrieve — 2026-10-02

- [x] Xác định Onshore test trả HTTP 400/BMXAA8744E vì khoảng trắng sau dấu phẩy
      trong danh sách `status in [...]`; serialize danh sách gọn, giữ nguyên các điều kiện scope.
- [x] GET live với E&I từ 01/09/2026 đến trước 03/09/2026 qua reader trả một WO,
      đã kiểm tra scope và mapping; không có mutation Maximo.
- [x] 39 reader tests và Ruff qua; thêm assertion cho cú pháp status không có khoảng trắng.
- [x] Backend localhost đã restart; browser hiển thị 3 WO E&I cho khoảng từ 01/09/2026
      đến trước 30/09/2026 do người dùng chọn, không còn lỗi retrieve.

Kết quả chỉ chứng minh khoảng lọc này trên Onshore test; paging lớn, detail/PIC và uploads
vẫn cần kiểm chứng riêng.

## Sửa mở chi tiết WO và đọc crew/PIC — 2026-10-02

- [x] Xác định detail WO đọc được nhưng crew_groups chưa cấu hình; thêm mapping Onshore
      theo công thức Excel do chủ dự án cung cấp, E&I → E&I_N (các mã khác xem maximo-reader.md).
- [x] Detail thiếu mapping vẫn xem WO, trả pics_configured=false và khóa editor; draft
      operations vẫn bắt buộc xác minh crew, không thay đổi quyền read thành write.
- [x] Đọc collection child PIC có bounds/paging và identity localref; dựng URL từ path
      kiểm tra trên origin test, không gửi credential tới hostname khác được Maximo quảng bá.
- [x] Live E&I_N trả 25 PIC; browser mở P13457392/BD1 hiển thị ngày/duration/PIC,
      các control sửa/lưu vẫn disabled với quyền read.
- [x] 70 backend tests (reader/detail + PostgreSQL draft), 50 frontend tests qua;
      Ruff, TypeScript, ESLint và build qua. Không thêm dependency hoặc migration.

Chưa kiểm chứng crew các discipline khác, child paging lớn, lưu nháp live hoặc uploads.

## Tìm kiếm và lọc bảng WO — 2026-10-02

- [x] Tìm không phân biệt hoa/thường theo WONUM, mô tả hoặc Tag Name trong tập đã retrieve.
- [x] Lọc status từ dữ liệu đã tải, kết hợp với tìm kiếm; hiển thị số WO hiển thị/tổng đã tải.
- [x] Xóa bộ lọc để hiện lại toàn bộ; phân biệt không khớp bộ lọc với retrieve rỗng.
- [x] Đổi connection/ngày hoặc retrieve lại xóa bộ lọc và dữ liệu cũ; không mở rộng scope,
      không gọi thêm API khi gõ tìm kiếm và không làm mất nội dung editor khi lọc bảng.
- [x] Hiển thị rõ quyền Chỉ xem hoặc Có thể chỉnh sửa và lưu nháp theo grant hiện tại.
- [x] 52 frontend tests, TypeScript, ESLint và production build qua; không thêm dependency.
- [x] Browser local Onshore test: tìm `hvac` kết hợp status WMATL hiển thị đúng WO
      P13464295 trong tập 3 WO E&I đã tải; giữ nhãn Chỉ xem.

Bộ lọc chỉ áp dụng cho tập dữ liệu đã lấy thành công, không tìm toàn bộ Maximo.
Không thay đổi quyền tài khoản hoặc gọi mutation Maximo.

## Chuẩn bị commit/push các thay đổi local — 2026-10-02

- [x] Gom Entra HTTPS Windows, PERSON-derived read grants/audit/migration 0005,
      sửa OSLC status, đọc crew child/PIC, lịch Target Finish và lọc bảng WO.
- [x] Full backend suite 194 tests và Ruff lint/format qua; frontend 52 tests,
      TypeScript/ESLint/build qua. Các kiểm chứng live chỉ đọc Onshore test E&I.
- [x] Xác minh .env/credential DB/PFX được ignore; scan candidate source không chứa
      secret Entra, API key, password DB hoặc password PFX đang dùng.
- [x] Commit triển khai `4239159` đã push origin/main; xác minh HEAD bằng origin/main,
      không force push. GitHub connector xác nhận repository thuộc tài khoản đang kết nối.
      Ghi nhận kết quả trong commit tài liệu tiếp theo.

## Quyền Planner có audit và nháp live — 2026-10-02

- [x] Migration 0006: permission Planner riêng theo user + connection + discipline;
      PERSON quyết định scope hiện tại, chỉ cấp write khi permission khớp, không tự cấp admin.
- [x] API admin PUT /api/admin/planner-permissions có session/CSRF; CLI quản trị DB dùng
      tenant/object ID và lý do bắt buộc. Audit before/after/actor/target/source cùng transaction.
- [x] Thu hồi hạ grant về read ngay; user row lock chung với PERSON sync và final draft write.
      Không giữ draft lock trong network I/O; restore kiểm tra version lại để tránh dữ liệu trộn.
- [x] PostgreSQL + HTTP mock: admin/CSRF/scope, lifecycle draft, revoke giữa đọc WO,
      PERSON đổi discipline, expiry, stale baseline, PM/CFT. Full backend 210 tests qua.
- [x] Frontend 52 tests, TypeScript/ESLint/build; Ruff lint/format; migration/schema check
      trên DB test riêng và local SSO qua. Không thêm dependency.
- [x] Cấp Planner Onshore test/E&I cho identity chủ dự án đã đăng nhập, có audit;
      browser lưu nháp P13457392/BD1 với lịch/PIC/duration, mở lại đúng và cập nhật v2.
- [x] Thu hồi Planner live: browser chuyển Chỉ xem, editor và lưu bị khóa; đã cấp lại E&I.
- [x] Xóa nháp kiểm thử P13457392/BD1 v2 trên browser sau xác nhận của chủ dự án
      (2026-10-02). Danh sách không còn nháp này; truy vấn DB chỉ đọc xác nhận 0 DraftItem
      cho WO đó, hai nháp P13468351/P13468282 vẫn còn. Không gọi mutation Maximo.
      Cập nhật tài liệu, kiểm tra link và diff; không chạy lại application tests vì không sửa mã.

Chỉ GET Maximo; nháp nằm trong DB nội bộ. Scope live mới Onshore E&I; expiry/conflict/PM/CFT
dùng automated tests, chưa sửa dữ liệu Maximo để tạo lỗi giả. Chưa nghiệm thu tải 10 người,
Offshore, UI quản trị/bootstrap admin, upload hoặc ETag/conditional update. Không commit/push
trong task này. Hướng dẫn: [Planner access](planner-access.md).

## Đánh giá UI/UX danh sách WO — 2026-10-02

- [x] Xem browser local với khoảng Target Finish hiện tại (01/10 đến trước 30/10/2026),
      retrieve thành công 4 WO; đối chiếu WorkOrders.tsx, API columns và stylesheet.
      Bảng hiện có 22 cột, min-width 2950px; panel trình duyệt hẹp chỉ thấy vài cột đầu.
- [x] Đề xuất bảng mặc định 7 cột theo tác vụ: WO + Site/Type, công việc + Tag Name,
      Status + Priority, Scheduled Start/Finish, Target Finish, Assigned PIC, Est. Duration.
      Đưa discipline lên nhãn scope; Actual/System ID/WOID/Target Start/lead/progress vào chi tiết.
      Upload?/Change Target? thuộc luồng thao tác khi đã triển khai, không chiếm cột placeholder.
- [x] Tạo minh họa tương tác dữ liệu mẫu: bảng gọn + panel chi tiết và dòng mở rộng;
      đề xuất panel cho desktop, màn hình chi tiết cho viewport hẹp, cột tùy chọn khi cần.
      Kiểm tra cú pháp minh họa và diff tài liệu; không sửa app hoặc chạy lại application tests.
- [x] Triển khai bảng gọn và panel (2026-10-05); ngày theo timezone connection,
      bảo vệ nháp khi đổi WO/scope, focus panel và Escape đóng qua xác nhận bỏ sửa.
      Kiểm tra browser hẹp; nghiệm thu desktop/usability đầy đủ còn chờ.

Đề xuất này đã được triển khai ngày 2026-10-05; xem bằng chứng và giới hạn bên dưới.

## Đề xuất lập lịch hàng loạt — 2026-10-02

- [x] Chủ dự án chọn bảng gọn + panel; yêu cầu phương án scheduled/assign PIC cho hàng
      trăm WO mỗi tháng. Đối chiếu SAP Fiori mass editing: chọn nhiều dòng, sửa trong panel,
      giữ nguyên các trường không chủ động thay đổi; đây là đề xuất, chưa triển khai.
- [x] Đề xuất lọc theo tuần/thiết bị/chưa lập lịch/chưa PIC, chọn nhóm WO và panel áp lịch/PIC
      cho nhiều dòng; chỉnh ô trực tiếp và bàn phím cho các WO có giá trị khác nhau.
      Preview từng WO, undo trước lưu, nháp nhiều WO; chọn tất cả chỉ trong tập kết quả đã tải.
- [x] Triển khai backend/UI nháp nhiều WO (2026-10-05); validate scope,
      crew/PIC, ngày và baseline/version riêng từng WO, hiển thị lỗi theo dòng.
- [x] Kiểm thử synthetic 100/200 WO, sửa nhóm/ngoại lệ, paste/Undo/preview/save/restore,
      thu hồi quyền/stale/version/delayed responses và phím/focus Chromium (2026-10-07);
      [bằng chứng](large-batch-keyboard-tests.md). Upload/reconciliation vẫn là task riêng.

Nguồn thiết kế: [SAP Fiori Mass Editing](https://www.sap.com/design-system/fiori-design-web/v1-84/foundations/best-practices/global-patterns/object-handling/mass-editing).
Ở bước đề xuất ngày 2026-10-02 chỉ cập nhật backlog và kiểm tra liên kết nội bộ.
Triển khai tiếp ngày 2026-10-05 được ghi bên dưới. Chưa có dữ liệu ca làm/khả dụng
để tự động phân bổ PIC hoặc kết luận quá tải.

## Bảng gọn và lập lịch nhóm — triển khai 2026-10-05

- [x] Bảng mặc định 7 cột, cột bổ sung tùy chọn; chi tiết/nháp một WO trong panel.
- [x] Thay nhãn site bằng system rút gọn: HT-98-MISC-SYSTEM → HT-98;
      MT1-61-INSTR-AIR-SYS → MT-61. Site/WOID/connection vẫn giữ trong định danh;
      không suy đoán system từ tag khi dữ liệu Maximo thiếu.
- [x] Lọc system, chưa có lịch/PIC; chọn tất cả chỉ trong kết quả đã tải và lọc.
      Kiểm thử danh sách synthetic 100 WO, lọc 20 WO và xác minh đúng tập được chọn.
- [x] Panel nhóm áp Scheduled Start/Finish, PIC, duration; ô không chọn giữ nguyên;
      sửa riêng từng dòng, Undo/reset, dán 4 cột Excel và preview trước khi lưu.
- [x] API prepare/save/update/restore nhóm tối đa 200 WO, tối đa 4 detail GET đồng thời;
      một lần đọc crew mỗi nhóm, recheck scope sau I/O và trước transaction lưu.
- [x] Một transaction lưu toàn nhóm hoặc không lưu; lỗi từng WO, baseline/version,
      durable request receipt chống gửi trùng; mở/cập nhật/xóa nháp nhóm theo owner.
      Xóa nháp dùng version và xác nhận riêng; Maximo giữ nguyên.
- [x] 222 backend tests qua (HTTP mocks + PostgreSQL), 61 frontend tests qua;
      Ruff, ESLint, TypeScript và production build qua. Không thêm dependency.
- [x] Browser HTTPS local đăng nhập lại với chủ dự án, đọc 4 WO E&I thật trong
      khoảng 01/10 đến trước 30/10/2026; mở panel nhóm, lấy crew, áp PIC vào preview.
      Không lưu thử lên các nháp thật hoặc ghi Maximo trong lần kiểm tra này.

Giới hạn: 4 WO live chưa trả systemid nên hiện “Chưa có system”; cần kiểm chứng
relationship/metadata Maximo cho dữ liệu system thật. Chưa nghiệm thu 100+ WO live,
10 planner đồng thời hoặc desktop rộng đầy đủ. Nháp đã lưu giữ nguyên tập WO;
muốn bỏ một WO khỏi nhóm đã lưu thì tạo nhóm mới. Bulk target edit chưa mở;
target vẫn qua editor từng WO có intent và PM/CFT lock. Upload/reconciliation,
tự động phân bổ theo capacity và ca làm vẫn là các task riêng. Không commit/push.

## Sửa mất kết quả retrieve và giữ bảng gọn + panel — 2026-10-05

- [x] Xác định refresh phiên mỗi 60 giây/focus luôn gọi setRows(null), làm mất
      kết quả retrieve dù vẫn còn quyền. Vite log cũng ghi Fast Refresh invalidation
      do export dataColumns cùng React component; đã chuyển helper sang presentation.ts.
- [x] Giữ ngày lọc, phạm vi, tìm kiếm và các lựa chọn còn hợp lệ; sau auth recheck
      đọc lại danh sách bằng cùng query trước khi hiện. WO biến mất bị bỏ chọn.
      Lỗi tạm thời giữ dữ liệu/nháp ẩn để retry; đổi identity/grants hoặc hết phiên
      vẫn xóa dữ liệu. Không dùng browser storage để lưu WO.
- [x] Giữ bảng 7 cột, đưa Target Start/Finish chung một cột; không bật bảng dài.
      Panel đơn/nhóm có 17 field nghiệp vụ hiện có trong ánh xạ Excel, gồm actual
      dates, discipline, onshore PIC, tiến độ và toàn bộ schedule/target.
- [x] Bỏ System và bộ lọc System, ẩn Site/WOID trong danh sách, panel và nhãn nháp.
      Connection/site/WOID vẫn giữ trong API, selection keys và preconditions;
      WOID tiếp tục là định danh cho luồng ghi Maximo sau này.
- [x] 65 frontend tests qua, gồm timer 60 giây, focus, giữ bộ lọc/lựa chọn/nháp,
      retry, WO biến mất và đủ field trong panel; TypeScript, ESLint và build qua.
      Backend/frontend log không có error/traceback, liveness và DB-schema readiness trả ok.
- [x] Browser live: retrieve 4 WO E&I, tìm/chọn P13468351 và mở panel đủ field;
      quan sát qua hơn 60 giây vẫn giữ scope, ngày lọc, tìm kiếm và lựa chọn.
      Không ghi Maximo hoặc thay đổi nháp thật. Console có lỗi import HMR tạm thời
      lúc chuyển helper giữa file; sau khi chuyển xong không phát sinh lỗi mới.

Ghi chú: file Excel gốc không nằm trong workspace; đối chiếu field theo API mapping
đã có, chưa chứng nhận toàn bộ workbook. Upload/Change Target là thao tác, không phải
field dữ liệu Maximo; upload vẫn chưa triển khai, target intent/PM/CFT guard vẫn giữ.
Các mục System ở bước trước là lịch sử và đã được yêu cầu mới thay thế. Không commit/push.

## Bỏ timer refresh và thêm date picker đơn lẻ — 2026-10-05

- [x] Bỏ interval 60 giây của /work-orders theo yêu cầu. Khi đang làm việc trên trang
      không tự gọi auth/list hoặc ẩn giao diện theo timer. Vẫn kiểm tra phiên khi mở
      trang/quay lại cửa sổ và backend vẫn kiểm tra scope/baseline trước khi lưu.
- [x] Scheduled Start/Finish và Target Start/Finish của editor đơn lẻ dùng native
      datetime-local picker; hiển thị timezone của kết nối, serialize offset-aware
      qua zonedDateTime. Preview ngày giờ dùng định dạng đọc được.
- [x] Target vẫn cần Change Target intent và bị khóa cho PM/CFT; không hỗ trợ clear
      ngày. PIC, duration, reset, version và retry receipt giữ nguyên luồng.
- [x] 66 frontend tests qua, TypeScript/ESLint/build qua. Regression clock 3 phút
      không có auth/list refresh; date picker chuyển instant UTC sang giờ nghiệp vụ,
      ngày chọn lưu +07:00; date ordering, target intent và PM/CFT tests vẫn qua.
- [x] Browser local với WO P13468351: bốn input ngày là date/time picker; bấm
      calendar Scheduled Finish mở native calendar và time lists. Không sửa/lưu
      nháp thật hoặc ghi Maximo trong bước xác minh.

Các đoạn nói timer 60 giây ở bước trước là lịch sử, đã được thay thế bởi yêu cầu mới.
Không thêm dependency, không ghi Maximo và không commit/push.

## Picker Target và Finish tự tính — 2026-10-05

- [x] Ẩn nhãn múi giờ trong phần lập lịch đơn lẻ/nhóm và phần bảo vệ nháp;
      vẫn hiển thị/serialize ngày theo múi giờ kết nối, không dùng múi giờ browser.
- [x] Target Start/Finish dùng native date/time picker trực tiếp trên WO hợp lệ;
      người dùng chọn ngày tự đặt change_target=true. Bỏ chọn intent trả target gốc;
      PM/CFT và các guard quyền/baseline/PIC vẫn khóa chỉnh sửa tương ứng.
- [x] Scheduled Finish chỉ đọc, tính Start + Est. Duration (giờ liên tục) khi đổi
      Start hoặc Duration, cả editor đơn lẻ, sửa nhóm và từng dòng; dán Excel đổi
      thành 3 cột Start/PIC/Duration. Chỉ sửa PIC hoặc mở WO không tự viết lại lịch gốc.
- [x] 71 frontend tests qua, ESLint/TypeScript và production build qua. Kiểm thử
      gồm giờ lẻ, duration zero, qua ngày, thiếu/âm duration, group có duration khác nhau,
      sửa ngoại lệ/Undo, paste atomic và explicit target intent/PM/CFT.
- [x] Browser HTTPS local với P13465570: Target Start mở native calendar/time lists;
      Start 21/10/2026 08:00 + 10.5 giờ ra Finish 18:30, đổi duration 12 ra 20:00;
      sửa Target Finish tự bật intent. Đã reset các giá trị thử về baseline, không lưu nháp.

Giới hạn: formula Finish được áp trong UI; backend chưa bắt buộc formula cho mọi API client.
Chưa có lịch ca/ngày làm việc hoặc bulk target. Không thêm dependency, không ghi Maximo,
không commit/push. Các mục trước nói chọn Finish, hiện timezone hoặc dán 4 cột là lịch sử,
đã được yêu cầu mới này thay thế.

## Đóng panel, nháp đã lưu và focus recheck — 2026-10-06

- [x] Kiểm tra luồng đóng: chỉ unmount panel, không gọi DELETE. Nháp lưu PostgreSQL
      trong draft/draft_item, baseline và changes JSONB; bảng/list WO lấy Maximo,
      mở số WO lấy baseline còn mở draft_id mới phục hồi changes.
- [x] Browser live mở P13465570 v1 từ Danh sách nháp: lịch 08/10/2026 09:07–19:37,
      PIC DUONGVQ vẫn còn. Đóng panel không xóa nháp. Lần kiểm tra này không tái hiện
      full-page reload; mã cũ gọi auth/list và ẩn UI trên mọi window focus.
- [x] Thêm thông báo/nút Mở lại nháp đã lưu, giữ sau đóng panel đơn lẻ hoặc nhóm;
      đồng bộ metadata/version sau save/restore và bỏ shortcut khi xóa/đổi scope/quyền.
      Nháp và dữ liệu Maximo được ghi nhãn riêng, không overlay thay baseline.
- [x] Focus chỉ recheck sau window blur/tab hidden; focus đơn lẻ không auth/retrieve.
      Visibility/focus cùng một lần quay lại không gọi trùng; vẫn recheck backend khi lưu.
- [x] 75 frontend tests qua, TypeScript/ESLint/build qua; close/reopen giữ changes,
      close không delete/refresh, chưa lưu có discard guard, nhóm mở đúng API,
      grant change xóa shortcut và nội dung cũ; visibility/focus gọi một lượt.
- [x] Browser sau sửa: mở lại P13465570 v1 rồi đóng, giữ 5 WO, ngày lọc và Danh sách nháp;
      thông báo v1/nút mở lại vẫn hiện. Không sửa/lưu/xóa nháp thật hoặc ghi Maximo.

Giới hạn: shortcut là metadata tạm thời, bị xóa khi kiểm tra lại phiên thực sự;
nháp vẫn mở lại từ Danh sách nháp trong scope được cấp. Không tự lưu edits chưa bấm Lưu nháp.
Backend không đổi trong task này; không chạy lại suite backend, không thêm dependency/commit/push.

## Nháp tích hợp với bảng WO — nghiên cứu UI/UX 2026-10-06

- [x] Đối chiếu SAP Fiori Draft Handling (editing status trên dòng đối tượng và lọc
      own draft) cùng Carbon Data Table (toolbar, row/batch actions, disclosure).
      Chỉ tham khảo cách thể hiện; không áp cơ chế auto-save/lock của SAP vào ứng dụng.
- [x] Đề xuất ba hướng thay khu vực Danh sách nháp riêng: nháp ngay trên WO với
      marker/lọc và panel; hai chế độ WO Maximo/Kế hoạch của tôi dùng cùng bảng;
      gom WO theo từng nháp đơn/nhóm để tiếp tục thao tác hàng tháng.
- [x] Dựng ba bản minh họa tương tác dữ liệu synthetic, giữ bảy cột nghiệp vụ và
      Site/WOID/System ẩn. Lọc nháp, mở/đóng panel, chuyển chế độ và mở nhóm đã
      kiểm tra trên browser; kiểm tra DOM/script qua cho badge sau save/reopen,
      finish theo duration và selection đúng thành viên nhóm. Không gọi API thật.
- [x] Đã triển khai phương án 1 trong mục tiếp theo: scoped index theo connection/site/WOID,
      chọn rõ khi WO thuộc nhiều nháp, mở đúng draft_id/version và nguyên tập nháp nhóm,
      recheck quyền/baseline. Marker không gọi restore riêng từng WO; đọc có giới hạn
      và hủy stale responses.
- [x] Triển khai cập nhật dòng/marker sau save, close, restore, delete; chỉ ô có
      changes mới hiện nhãn nháp, status Maximo không bị thay. Có lối truy cập nháp
      ngoài khoảng Retrieve, không âm thầm gộp vào các WO đã tải hoặc sai scope.

Khuyến nghị: marker/lọc ngay trong bảng cho luồng chính, cân nhắc chế độ Kế hoạch của tôi
để tìm nháp ngoài kết quả Retrieve. Chưa thay giao diện production/local app trong bước
đề xuất; không xóa nháp, không ghi Maximo, không thêm dependency hoặc commit/push.
Nguồn: [SAP Fiori Draft Handling](https://www.sap.com/design-system/fiori-design-web/v1-148/foundations/best-practices/global-patterns/object-handling/draft-handling),
[Carbon Data Table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines).

## Nháp ngay trên WO và bản duyệt Carbon — 2026-10-06

- [x] Triển khai phương án 1: bỏ Danh sách nháp/thông báo shortcut riêng; giữ bảy cột,
      marker đơn/nhóm/phiên bản dưới số WO, filter có/chưa có nháp và counts cho các WO đã tải.
      Các ô schedule/target/PIC/duration hiển thị kế hoạch được chọn với nhãn Nháp;
      baseline giữ riêng, status Maximo không đổi. Baseline stale không overlay và cần đối chiếu.
- [x] WO có nhiều nháp mở chooser rõ phiên bản/thời điểm; mở đúng ID và nguyên nhóm gốc.
      Save/restore/delete đồng bộ cả thành viên nhóm; close giữ marker/giá trị, không retrieve/delete.
      Chọn các WO của cùng nhóm mở lại nhóm; tránh tạo nhóm mới âm thầm trên nháp cũ.
- [x] Nguồn WO có nháp trong phạm vi dùng chung bảng và pagination 20 nháp/trang,
      mở được nháp ngoài khoảng Retrieve. Scope/session đổi hoặc response trễ không lẫn dữ liệu.
- [x] API WO list lấy marker bằng một SQL query, chỉ owner/scope/identity vừa được Maximo xác minh;
      không gọi restore/detail/PIC riêng từng nháp để tô bảng. Chỉ trả đề xuất cho WO được phép,
      không trả identity/count các thành viên khác; group restore vẫn recheck toàn nhóm.
- [x] 226 backend tests và 91 frontend tests qua; Ruff lint/format, ESLint/TypeScript/build qua.
      Có kiểm thử owner/connection/discipline/site collision, grant revoked trong I/O, moved WO,
      stale baseline, một upstream list cho marker, multiple drafts, delete giữ nháp khác,
      filter, same-table ngoài range/pagination/session recheck và hủy response cũ.
- [x] Browser live Onshore E&I: 5 WO, 3 WO có nháp, restore P13468282 v1 giữ DUNGDT/duration 12,
      đóng panel giữ dữ liệu; P13465570 có hai v1 và chooser thời điểm khác nhau.
      Nguồn WO có nháp hiển thị 3 WO trong cùng bảng; chooser nhận focus và Escape đóng.
      Chỉ đọc/khôi phục nháp thật để kiểm tra, không sửa/lưu/xóa hoặc ghi Maximo.
- [x] Dựng bản duyệt màu/font Carbon riêng với Gray 10/White/Gray 100, palette token/hex,
      IBM Plex Sans, mẫu tiếng Việt và bảng WO/panel synthetic. Theme/filter/save/close/finish
      đã kiểm tra DOM và browser; viewport 320/1024 không tràn ngang ngoài vùng bảng.
      Chưa áp palette/font này vào ứng dụng thật.
- [x] Người dùng duyệt Gray 10 và Gray 100 cho sáng/tối vào 2026-10-06; triển khai
      trong mục tiếp theo. Bảng 14/18, label 12/16, heading 28/36 theo productive typography.

Giới hạn: nguồn bảng nháp recheck live toàn bộ thành viên của tối đa 20 nháp mỗi trang;
độ trễ hàng trăm WO, 10 phiên đồng thời và UAT rộng chưa đo. Nháp của owner đang đăng nhập,
không phải kế hoạch chung của tất cả planner. Upload/ETag/history vẫn pending.
Không thêm runtime dependency, không commit/push. Bước này chỉ duyệt màu/font;
palette được áp dụng ở task tiếp theo sau khi người dùng chọn theme.
Nguồn: [Carbon color tokens](https://www.carbondesignsystem.com/building-blocks/foundations/color/tokens),
[Carbon theme values](https://carbon-elements.netlify.app/themes/examples/preview/),
[Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets).

## Carbon light/dark và sửa màu chữ Gray 10 — 2026-10-06

- [x] Áp dụng Gray 10 (sáng) / Gray 100 (tối), bỏ White khỏi preview. Nút chuyển
      trên header có switch label/state và lưu duy nhất preference theme trong localStorage.
      Default sáng; preference không hợp lệ hoặc storage bị chặn không ngăn dùng ứng dụng.
- [x] Màu chữ chính/phụ, field, layer, tags, highlights, lỗi và nút theo theme;
      primary button giữ chữ trắng trên Blue 60. Native date/time picker theo color-scheme.
      Preview cố định color inheritance trong root để headings/cells không nhận chữ sáng
      từ host khi chọn Gray 10.
- [x] IBM Plex Sans 400/500/600 self-hosted từ IBM/plex revision ghi trong
      frontend/public/fonts/SOURCE.txt; giữ giấy phép SIL OFL. Không thêm runtime dependency
      hoặc gọi dịch vụ font bên ngoài từ ứng dụng thật. Kiểm tra browser font đã load.
- [x] 92 frontend tests qua, ESLint/TypeScript và production build qua; test app chuyển
      hai theme khi panel có edit chưa lưu giữ input và không gọi thêm auth/retrieve/detail.
- [x] Browser live Onshore: 3 WO có nháp giữ nguyên qua chuyển sáng/tối; restore P13468282
      rồi đổi theme bằng bàn phím giữ duration 12 và date values. Close giữ nháp trên bảng.
      Computed styles: sáng text #161616/#525252, tối #f4f4f4/#c6c6c6; bảng, panel và date
      field đúng theme. Chỉ đọc nháp, không sửa/lưu/xóa dữ liệu thật hoặc ghi Maximo.
- [x] Preview DOM/script theme/filter/finish/save/close qua; browser xác nhận h1/h2/h3,
      type sample, headers/cells và controls dùng đúng màu ở cả hai theme.

Giới hạn: đây là áp dụng palette/typography Carbon bằng CSS và native controls,
không chuyển toàn bộ component sang thư viện Carbon React. Backend không đổi, không
chạy lại suite backend trong task này. Không commit/push; UAT monthly-load vẫn pending.
Nguồn: [Carbon color tokens](https://www.carbondesignsystem.com/building-blocks/foundations/color/tokens),
[IBM Plex](https://github.com/IBM/plex).

## Xác nhận áp dụng giao diện đã duyệt — 2026-10-06

- [x] Người dùng xác nhận giao diện đạt yêu cầu và cho áp dụng. Đối chiếu source và
      trang /work-orders thật: Gray 10/Gray 100, IBM Plex Sans nội bộ và switch đã tích hợp
      trong frontend ứng dụng, không còn là thay đổi chỉ trong preview.
- [x] Kiểm tra browser sau session recheck: nguồn nháp giữ 3 WO; chuyển tối rồi sáng
      chỉ đổi theme, rows/markers/PIC/duration giữ nguyên. Lưu ảnh bản chạy thật.

Không cần thay mã thêm vì bản đã duyệt đã được tích hợp ở task trước; giữ bằng chứng
92 frontend tests, lint/typecheck/build đã qua của task đó, không chạy lại suite không đổi.

## Sửa độ khớp style/font với bản Carbon đã duyệt — 2026-10-06

- [x] Xác nhận phản hồi: bản trước đổi palette và một phần typography nhưng còn style cũ
      của header, spacing, inputs, table và panel. Thay bộ component styles thống nhất,
      loại các rules cũ/overrides chồng nhau; header đen 48px, spacing 16/24, nút vuông 40px,
      fields nền theo theme và viền dưới, bảng 14/18, tags/marker pill.
- [x] Chuyển font-face sang fonts.css toàn ứng dụng, preload Regular; explicit IBM Plex
      Sans cho headings, body, labels, table và controls. Bỏ weight 700 giả lập/cỡ chữ cũ;
      body 14/20, table/controls 14/18, label 12/16, heading 28/36 và 20/28.
- [x] Xác minh font file Regular được localhost phục vụ HTTP 200, font/woff2, 63020 bytes;
      đọc name table WOFF2 của cả ba assets xác nhận IBM Plex Sans/Medm/SmBld.
      Browser có 3 font faces và regular/600 ready; computed typography đúng trên title,
      table, buttons và fields. Không chỉ dựa vào tên font-family được khai báo.
- [x] Panel gọn 440px dưới header để nút theme luôn dùng được; form hiện trước,
      17 field Maximo vẫn trong disclosure. Kiểm thử mở disclosure xác nhận đầy đủ dữ liệu.
- [x] 92 frontend tests qua sau cập nhật disclosure test; lint/typecheck/build qua.
      Browser live Onshore 3 WO, restore P13468282 duration 12, sáng/tối giữ panel/giá trị;
      viewport 320px không tràn ngang ngoài bảng, field vẫn nằm trong panel. Lưu ảnh bảng
      và panel thật hai theme; không sửa/lưu/xóa nháp thật hoặc ghi Maximo.

Giới hạn: component styles được áp trên native controls theo bản duyệt; không thêm Carbon
React library hoặc runtime dependency. Backend không đổi, không chạy lại suite backend.
UAT hàng trăm WO và 10 phiên vẫn pending; không commit/push.
Nguồn: [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets).

## Mở rộng màn hình WO đơn lẻ và chia section — 2026-10-06

- [x] Thay panel 440px bằng khung rộng tối đa 1320px theo viewport. Desktop đặt thông tin
      WO bên trái, Lịch và phân công / Ngày mục tiêu / Đối chiếu Maximo-Nháp bên phải;
      các date/PIC/duration controls dùng hai cột. Header Đóng và footer Lưu/Reset/Xóa
      nằm ngoài vùng cuộn nội dung, luôn tiếp cận được.
- [x] Giữ đủ 17 field nghiệp vụ: thông tin chung hiện sẵn, sáu ngày Maximo/thực tế trong
      disclosure riêng. Site/WOID/System tiếp tục ẩn khỏi UI; identity API giữ nguyên.
      Màn hình nhỏ xếp form trước thông tin tham chiếu, thứ tự keyboard theo DOM tương ứng.
- [x] Giữ date picker, finish tự tính, target intent và khóa PM/CFT; giữ save/restore/delete,
      kiểm tra session/PIC/baseline và phiên bản nháp. Thêm kiểm thử footer bị khóa khi
      read-only, session recheck hoặc chưa cấu hình crew sau khi tách khỏi fieldset.
- [x] 95 frontend tests / 9 files, lint và TypeScript/build qua. Browser live restore
      P13468282 v1: Gray 10/100 giữ DUNGDT và duration 12; viewport mặc định 1149x884 có
      panel rộng 1101px, body content = client height 680px nên form và hai dòng đối chiếu
      vừa khung không cuộn. Mở disclosure kiểm tra sáu field ngày; 320px form không tràn
      ngang và footer vẫn nhìn thấy. Reset viewport, để panel Gray 10 mở cho người dùng.

Giới hạn: khi mở thêm ngày tham chiếu, nhiều thay đổi hoặc viewport thấp, chỉ nội dung
panel cần cuộn; header/footer giữ cố định. Không thêm dependency; không sửa/lưu/xóa nháp
thật hoặc ghi Maximo trong kiểm tra UI. Backend không đổi, không chạy lại backend suite;
UAT hàng trăm WO / 10 phiên vẫn pending. Không commit/push.

## Tự nhận phạm vi tài khoản và Settings hệ thống — 2026-10-06

- [x] Chủ dự án xác nhận chọn kết nối/URL đã cấu hình và lưu cho tài khoản. Bỏ selector
      Hệ thống/Discipline trên WO; scope duy nhất tự dùng khi login, hoặc dùng preference
      server khớp grant hiện tại. Giữ nhãn system/environment/discipline, không chọn nhóm.
- [x] Trang /settings riêng và link từ header/WO: hiện các URL đã cấu hình thuộc quyền
      tài khoản, radio chọn kết nối và Lưu hệ thống; không chỉnh URL/credential. Giữ guard
      nháp chưa lưu khi đi sang Settings; kiểm tra session khi quay lại từ blur/hidden.
- [x] Migration 0007 user_connection_setting lưu connection per app_user trên PostgreSQL;
      GET/PUT /api/settings/connection và session preferred_connection_id. PUT có CSRF,
      PERSON/current grant recheck, payload allowlist và configured_connection policy.
      Không nhận user/URL/discipline từ client; admin không grant không được chọn WO scope.
- [x] Không tự chọn bằng thứ tự mảng khi có nhiều discipline/kết nối; nhiều kết nối chọn
      một lần ở Settings, ambiguous discipline cần quản trị viên. Preference hết quyền
      không tạo WO access. Khi context đổi, hủy request cũ và xóa bảng/panel phạm vi cũ.
- [x] Nâng migration trên DB ứng dụng local và DB test cô lập; restart đúng backend dev
      để nạp API mới. 236 backend tests qua với Windows Selector loop và PostgreSQL test;
      106 frontend tests/12 files, Ruff, lint và TypeScript/build qua.
- [x] Browser live: tự nhận Onshore test/E&I; lưu preference cho tài khoản hiện tại,
      mở lại Settings xác nhận lựa chọn đọc từ server, quay về WO tải 3 WO có nháp
      mà không chọn phạm vi. Lưu ảnh WO/Settings thật; giữ /work-orders mở.

Giới hạn: chỉ một kết nối live đã được xác minh; nhiều kết nối được kiểm tra synthetic.
Không sửa/lưu/xóa nháp hoặc ghi Maximo. Không thêm dependency, không commit/push;
monthly-load/10 phiên và triển khai Ubuntu vẫn pending. Chi tiết: [Settings](account-settings.md).

## Sửa mất đăng nhập giả sau xóa nháp — 2026-10-07

- [x] Xác định lỗi frontend: DELETE nháp trả 204, session vẫn trả 200, nhưng lần kiểm tra
      sau mở lại ID đã xóa trả 404 và bị xử lý như mất phiên. Xác nhận native còn tạo
      blur/focus, có thể kích hoạt recheck và hủy request xóa đang chạy.
- [x] Chuyển xác nhận xóa WO đơn lẻ vào panel với nút xác nhận/hủy; khóa nút trong lúc
      xóa. Xóa thành công chỉ cập nhật marker nháp và đóng panel, giữ bảng/query/bộ lọc.
- [x] Xóa tham chiếu panel ngay khi đóng/chuyển; bỏ qua phản hồi recheck của panel cũ.
      404 hiện tại đóng panel và đọc lại bảng có kiểm tra quyền, không đặt session null.
      Các lỗi quyền mở/lưu/xóa/list hủy nội dung WO cũ và kiểm tra session server; phiên
      thật hết hạn mới yêu cầu login, account mất grant vẫn đăng nhập nhưng không có WO.
- [x] 114 frontend tests / 12 files, lint và TypeScript/build qua. Hồi quy bao gồm xóa
      thành công giữ bảng/bộ lọc, giữ nháp khác cùng WO, nháp bị xóa ở tab khác, phản hồi
      panel cũ thành công/404, xóa bị 404/401/403 và conflict phiên bản 409.
- [x] Browser live: phiên hiện tại tự nhận Onshore test/E&I và retrieve 5 WO; mở nháp
      có sẵn, kiểm tra xác nhận ngay trong panel, lưu ảnh và Hủy xóa/Đóng nháp vẫn giữ
      bảng cùng trạng thái đăng nhập. Giữ /work-orders mở cho người dùng.

Giới hạn: thao tác DELETE thành công và các race được xác minh bằng frontend mocks;
không xóa nháp thật trong kiểm tra browser, không ghi Maximo. Backend không đổi,
không chạy lại backend suite; monthly-load/10 phiên và browser E2E rộng vẫn pending.
Không thêm dependency, không commit/push. Chi tiết: [Nháp](drafts.md).

## Khảo sát tải lại dữ liệu khi điều hướng / quay lại tab — 2026-10-07

- [x] Kiểm tra mã: WorkOrders blur/focus và visibilitychange kích hoạt kiểm tra session,
      ẩn toàn bộ nội dung, đọc lại WO/nháp đang mở rồi retrieve lại cùng bảng. BatchPlanner
      đọc lại nhóm khi suspended kết thúc. Điều hướng route gỡ WorkOrders, làm mất state
      trong component. Overview SessionPanel và Settings có luồng refocus riêng.
- [x] Xác minh session_info còn sync_person_access qua Maximo; không coi request session
      là chỉ đọc cookie/PostgreSQL. Không có timer định kỳ reload bảng trong mã hiện tại;
      full navigation được dùng cho đăng xuất, còn route nội bộ dùng React Router.
- [x] Đề xuất giữ workspace trong bộ nhớ ứng dụng qua route; tách xác minh phiên/quyền
      khỏi tải WO; giữ cache bảng theo actor/connection/discipline/query, có tuổi dữ liệu,
      nút cập nhật và kiểm tra lại có giới hạn. Dữ liệu mới không ghi đè edits chưa lưu;
      đổi identity/scope, logout hoặc mất quyền phải hủy cache và phản hồi cũ. Duy trì
      kiểm tra quyền/baseline/version tại backend trước thao tác lưu/xóa/upload.
- [x] Triển khai chính sách giữ workspace / cập nhật dữ liệu sau khi chủ dự án chốt;
      xem bằng chứng và giới hạn ở mục triển khai bên dưới (2026-10-07).

Bằng chứng: đọc App.tsx, WorkOrders.tsx, DraftEditor.tsx, BatchPlanner.tsx,
SessionPanel.tsx, Settings.tsx, API client và backend auth/session/person access.
Đối chiếu [React state lifecycle](https://react.dev/learn/preserving-and-resetting-state)
và [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
Giới hạn: đây là khảo sát và đề xuất, chưa thay đổi mã ứng dụng; chưa đo waterfall/độ trễ
trên browser hoặc chạy lại suite vì không có thay đổi hành vi.

## Giữ workspace và giảm tải lại WO — 2026-10-07

- [x] Giữ WorkOrders mounted trong App theo active route; không lấy dữ liệu khi chưa mở
      WO. Giữ bảng/query/page/bộ lọc/dòng chọn, editor đơn/nhóm và phần sửa trong RAM qua
      Settings/Tổng quan; khôi phục vị trí cuộn. Không dùng browser storage cho WO/nháp.
- [x] Tách session verification khỏi WO refresh: chỉ visibilitychange sang visible hoặc
      mở lại route WO kiểm tra quyền; bỏ blur/focus ở WO, Overview session và Settings.
      Gộp session checks đang chạy; không tải lại list/detail/nháp/nhóm khi quyền giữ nguyên
      và không hủy save chỉ vì chuyển tab. Lỗi xác minh ẩn nội dung để kiểm tra lại;
      identity/grants/preference đổi hoặc hết phiên xóa workspace/phản hồi cũ.
- [x] Hiện thời điểm Cập nhật lần cuối, sau 5 phút chỉ báo dữ liệu có thể đã thay đổi.
      Cập nhật thủ công đọc lại cùng query/page, giữ bộ lọc/selection còn tồn tại và edits;
      đối chiếu baseline/PIC/phiên bản mới hơn, không ghi đè edits. Lỗi upstream giữ bảng
      có quyền đã xác minh. Lưu/xóa nháp tiếp tục cập nhật marker tại đúng dòng.
- [x] Đi sang Settings không bỏ edits; Lưu hệ thống khác có guard bỏ sửa chưa lưu.
      Settings không reset lựa chọn chưa lưu vì focus/tab return và không hủy save đang chạy.
- [x] 124 frontend tests/12 files, ESLint, TypeScript và production build qua. Kiểm thử
      route/state/scroll, auth dedupe, blur không request, visible return không refetch,
      tuổi dữ liệu 5 phút, explicit update, nhóm giữ edits, save không hủy khi đổi tab,
      expired session giữa refresh, đổi scope và đối chiếu phiên bản nháp mới hơn;
      phản hồi bảng cũ không ghi đè marker/giá trị của nháp vừa lưu đồng thời.
- [x] Browser live Onshore test/E&I: nguồn nháp tải 3 WO, lọc/chọn 1 WO, đi Settings và
      quay lại vẫn giữ bảng/bộ lọc/selection và cùng thời điểm cập nhật. Lưu ảnh bằng chứng,
      xóa bộ lọc thử và để bảng đầy đủ mở lại; không ghi/xóa nháp hay thay đổi Maximo.

Giới hạn: cache chỉ sống trong vòng đời ứng dụng/tab; F5 mất phần chưa lưu trong RAM,
nháp server vẫn giữ. Session verification hiện vẫn đọc PERSON Maximo; chưa đo độ trễ
waterfall/10 phiên. Tab visibility/timer/race xác minh bằng tests synthetic; browser live
xác minh điều hướng Settings. Backend không đổi, không chạy lại backend suite. Không thêm
dependency, không commit/push. Hành vi hiện tại: [Nháp](drafts.md).

## Sửa mất bảng khi đổi nguồn Maximo / nháp — 2026-10-07

- [x] Xác định reset dùng chung đã xóa rows/query Maximo khi mở nháp và khi quay về.
      Giữ hai snapshot riêng trong RAM cho cùng tài khoản/phạm vi: rows, query/trang,
      bộ lọc, dòng chọn, lựa chọn kế hoạch và thời điểm cập nhật. Chuyển nguồn đã tải
      không gọi API lại; Cập nhật thủ công dùng đúng query/page được khôi phục.
- [x] Lưu/cập nhật/xóa nháp cập nhật marker/giá trị ở cả snapshot đang ẩn; xóa nháp
      giữ WO baseline trong nguồn Maximo, loại WO hết nháp khỏi nguồn nháp. Đổi nguồn
      giữ guard sửa chưa lưu; lỗi tải nháp giữ bảng Maximo và cho tải lại nguồn bị lỗi.
- [x] Đổi ngày chỉ hủy snapshot Maximo cũ; chưa Retrieve hiện hướng dẫn rõ. Hết phiên,
      đổi actor/grants/kết nối hoặc access denied xóa cả hai snapshot, hủy response cũ.
      Tuổi dữ liệu vẫn theo thời điểm gốc, kể cả hai nguồn có timestamp giống nhau.
- [x] 133 frontend tests/12 files, ESLint, TypeScript và production build qua. Thêm
      9 regression tests cho đổi nguồn, query/page refresh, timestamp/tuổi dữ liệu,
      save/delete đồng bộ bảng ẩn, scope isolation, lỗi upstream, guard edits và đổi ngày.
- [x] Browser live Onshore test/E&I: Retrieve 117 WO từ 01/10 đến trước 01/11/2026,
      lọc/chọn P13465570, sang nguồn 3 WO có nháp, quay về vẫn đủ 117 WO trong snapshot,
      giữ filter/selection và thời điểm 10:43:12. Lưu ảnh wo-source-restored.png.

Giới hạn: cache chỉ trong RAM, F5 vẫn cần Retrieve lại; nháp PostgreSQL không mất.
Lưu/xóa và đổi scope xác minh bằng mocks, browser live chỉ đọc và chuyển nguồn;
backend không đổi, không chạy lại backend suite. Không thêm dependency.

## Căn giữa màn hình WO đơn lẻ — 2026-10-07

- [x] Thay vị trí neo phải/dưới bằng căn giữa viewport theo hai trục; giữ chiều rộng
      tối đa 1320px, giới hạn chiều cao 900px và theo dynamic viewport. Giữ section
      dữ liệu, cuộn nội dung và header/footer hiện có; màn hình hẹp vẫn căn giữa có lề.
- [x] ESLint, TypeScript và production build qua. Browser live mở nháp P13431393,
      kiểm tra desktop 1600×1000 (panel 1320×888), viewport 760×884 và kích thước mặc định
      1164×884: tâm panel trùng tâm vùng viewport khả dụng, không tràn ngang ở 760px.
      Reset viewport override, giữ màn hình WO mở và lưu ảnh wo-centered.png.

Giới hạn: chỉ đổi CSS vị trí/kích thước panel WO đơn lẻ; không thay logic nghiệp vụ/API,
      không chạy lại suite 133 tests đã qua ở task trước và không thêm test CSS mô phỏng.
      Không ghi/xóa nháp hay thay đổi Maximo khi kiểm tra giao diện.

## Căn giữa màn hình lập lịch nhóm — 2026-10-07

- [x] Căn panel nhóm giữa viewport theo cả hai trục như màn hình WO đơn lẻ; giữ rộng
      tối đa 1160px, chiều cao tối đa 900px và theo dynamic viewport. Màn hình hẹp có
      lề, nội dung và bảng cuộn trong panel; giữ controls lập lịch nhóm hiện có.
- [x] ESLint, TypeScript và production build qua. Browser Onshore test/E&I mở nhóm
      P13439902/P13457667: tâm panel trùng tâm vùng viewport khả dụng tại 1164×884,
      1600×1000 (panel 1160×888) và 760×884; không tràn ngang panel ở 760px.
      Khôi phục viewport mặc định, lưu ảnh wo-batch-centered.png và giữ panel nhóm mở.

Giới hạn: chỉ đổi CSS, không thay logic nhóm/API, không chạy lại suite ứng dụng cho
      thay đổi vị trí này. Kiểm tra live chỉ prepare/đọc hai WO, không lưu/xóa nháp hay ghi Maximo.

## Kích thước panel nhóm 80% màn hình — 2026-10-07

- [x] Panel nhóm dùng width 80%, height 80dvh, giữ căn giữa hai trục; bỏ giới hạn
      1160px/900px và override chiều rộng ở breakpoint hẹp. Bảng/nội dung cuộn trong panel.
- [x] ESLint, TypeScript và production build qua. Browser live nhóm 2 WO: viewport
      mặc định 1164×884 đo panel xấp xỉ 80% chiều rộng khả dụng và 80% chiều cao,
      tâm sai lệch 0px; 760×884 vẫn giữ cùng tỉ lệ, không tràn ngang panel. Khôi phục
      viewport mặc định và lưu ảnh wo-batch-80-percent.png.

Giới hạn: chỉ CSS, không thay API/logic nhóm; không chạy lại suite cho thay đổi kích thước.
      Không sửa/lưu/xóa dữ liệu khi kiểm tra live.

## Khóa cuộn nền khi mở màn hình lập lịch — 2026-10-07

- [x] Khóa cuộn html/body và bảng WO có scrollbar riêng khi panel đơn lẻ, nhóm hoặc
      chooser hiển thị. Giữ scroll offsets; ổn định gutter tránh nhảy ngang. Chặn
      overscroll từ panel/editorBody; bảng trong panel vẫn cuộn ngang độc lập.
- [x] Cleanup khóa khi đóng, hidden route, xác minh quyền thất bại/hết phiên hoặc
      unmount. Giữ edits khi sang Settings và khôi phục khóa khi quay lại editor.
- [x] 136 frontend tests/12 files, ESLint, TypeScript và production build qua. Thêm
      3 lifecycle tests: đóng/unmount đơn lẻ và nhóm, sang Settings/quay lại và hết phiên.
- [x] Browser Onshore test/E&I: nhóm 3 WO cuộn tới đáy panel (280px); wheel ngoài
      panel và tại đáy không đổi pageY=296/tableY=1866; đóng nhóm giữ nguyên offsets.
      Đơn lẻ P13431393 cuộn editorBody tới đáy (71px); cuộn tiếp/nền giữ pageY=395,
      tableY=0; đóng gỡ khóa và giữ vị trí. Không ghi/xóa nháp/Maximo. Lưu ảnh
      wo-panel-scroll-locked.png, để panel nhóm mở cho chủ dự án xem.

Giới hạn: kiểm tra wheel trực tiếp trên browser desktop; chưa thử thiết bị cảm ứng thật.
      Backend không đổi, không chạy lại backend suite. Không thêm dependency.

## Mở rộng panel nhóm lên 95% — 2026-10-07

- [x] Panel nhóm rộng 95% viewport, giữ cao 80dvh, căn giữa và khóa cuộn nền.
      Tài liệu hành vi hiện tại được cập nhật; không đổi màn hình WO đơn lẻ.
- [x] ESLint, TypeScript và production build qua. Browser nhóm 3 WO tại 1164×884:
      panel 1091.55×707.19px, tương ứng 95% vùng chiều rộng khả dụng / 80% chiều cao;
      nền vẫn overflow hidden. Lưu ảnh wo-batch-95-percent.png, giữ panel mở.

Giới hạn: chỉ CSS, không đổi API/logic; không chạy lại suite cho thay đổi chiều rộng.
      Kiểm tra live chỉ prepare/đọc, không lưu/xóa nháp hay ghi Maximo.

## Panel nhóm 95% cả hai chiều — 2026-10-07

- [x] Tăng height panel nhóm từ 80dvh lên 95dvh, giữ width 95%, căn giữa và khóa cuộn nền.
      Tài liệu hành vi hiện tại cập nhật đồng bộ.
- [x] ESLint, TypeScript và production build qua. Browser nhóm 3 WO tại 1164×884 đo
      panel 1091.55×839.80px, xấp xỉ 95% cả hai chiều, tâm sai lệch 0px; nền vẫn khóa cuộn.
      Lưu ảnh wo-batch-95-both.png và giữ panel mở.

Giới hạn: chỉ đổi CSS chiều cao; không chạy lại suite cho chỉnh kích thước, không thay
      API/logic hay sửa/lưu/xóa dữ liệu trong kiểm tra live.

## Rút gọn thông tin WO trong lịch nhóm — 2026-10-07

- [x] Bỏ thông tin lặp trong phần mở rộng: WO, description, type, tag, status,
      schedule, assigned PIC và duration đã có trên dòng; discipline nằm ở header nhóm.
      Giữ 7 field bổ sung: Priority, Onshore PIC, % Complete, Target Start/Finish,
      Actual Start/Finish; ngày vẫn hiển thị theo timezone của kết nối.
- [x] Chuyển phần mở rộng khỏi ô hẹp sang hàng phụ ngang toàn bảng, chia 3 nhóm,
      dùng màu/font Carbon hiện có. Nút có aria-expanded/controls; chỉ mở một WO mỗi lần.
      Mở/đóng không gọi retrieve hay reset chỉnh sửa. Không đổi panel WO đơn lẻ.
- [x] 138 frontend tests/12 files, ESLint, TypeScript và production build qua.
      Hai tests mới xác minh trường bổ sung/không lặp, định dạng ngày, mở một hàng,
      giữ edits và không gọi prepare lại. Git diff --check qua.
- [x] Browser Onshore test/E&I nhóm 3 WO: P13439902 hiển thị đủ 7 field trên 3 nhóm,
      phần bổ sung rộng 1026.55px/cao 140px ở viewport 1164×884; chuyển mở WO khác
      đóng phần trước. Lưu ảnh wo-batch-compact-details.png và giữ panel mở để xem.

Giới hạn: chỉ kiểm tra desktop browser; bảng nhóm giữ cuộn ngang ở màn hình hẹp.
      Không thêm dependency, không đổi backend hoặc chạy lại backend suite;
      kiểm tra live không lưu/xóa nháp hay ghi Maximo.

## Chuẩn bị commit toàn bộ thay đổi — 2026-10-07

- [x] Gom phạm vi đã duyệt: Planner permission (migration 0006), Settings kết nối
      theo tài khoản (0007), draft batches/markers, bảng WO tích hợp nháp, cache/phiên,
      Carbon Gray 10/100 và IBM Plex Sans, date pickers/derived finish, panel đơn/nhóm
      căn giữa/khóa cuộn nền, thông tin bổ sung gọn và tài liệu liên quan.
- [x] Chạy toàn bộ backend: 236 tests qua (136 fast + 100 PostgreSQL), Ruff check/format qua.
      Sửa test_batch_api dùng SelectorEventLoop: 12 ca trước đó lỗi do event loop mặc định
      Windows không tương thích psycopg; chạy lại toàn suite thành công.
- [x] Frontend hiện tại đã qua 138 tests/12 files, ESLint, TypeScript và production build.
      Git diff --check qua; không thêm dependency runtime, giữ giấy phép/nguồn font.
      Các file .env, log, cache, build và dependency directories được ignore.

Giới hạn: PostgreSQL dùng scheduler_test cô lập; Maximo/Entra giả trong suite.
      Kết quả này không xác nhận remote upload hay UAT nhiều người dùng; không ghi Maximo.

## CI cho backend/frontend và PostgreSQL — 2026-10-07

Checkpoint ban đầu trước khi đọc Actions logs; kết quả runner và bản sửa tiếp được ghi
trong mục “Nhóm 100/200 WO, keyboard/focus và CI/container” bên dưới.

- [x] Thêm `.github/workflows/ci.yml` cho push, pull request và chạy thủ công; ba job
      độc lập trên Ubuntu 24.04: backend fast, PostgreSQL migration/integration, frontend.
      Dùng lockfile frozen/npm ci, token chỉ đọc, checkout không lưu credential,
      concurrency cancellation và timeout. Checkout/setup-uv/setup-node khóa SHA release
      chính thức; không thêm dependency runtime hoặc nạp secret Entra/Maximo vào CI.
- [x] Khóa `.python-version` từ 3.12 thành 3.12.14 khớp Dockerfile/local đã kiểm tra;
      CI dùng uv 0.11.9 và Node 26.0.0 hiện có. Không nâng package/lockfile.
      Mục đánh giá/pin toàn bộ runtime/image vẫn chưa hoàn thành, PostgreSQL còn tag 17-alpine.
- [x] `actionlint` 1.7.12 qua. Backend 236 tests qua: 136 fast và 100 PostgreSQL;
      Ruff lint/format qua. Frontend 138 tests/12 files, ESLint, TypeScript/build qua.
      `uv sync --frozen` qua với môi trường local hiện có.
- [x] Upgrade/check/downgrade base/upgrade/check qua trên database tạm mới tạo từ
      PostgreSQL test riêng; hai lần schema check không lệch. Xóa đúng database tạm sau
      kiểm tra; không downgrade DB ứng dụng hoặc database test đang chứa dữ liệu.
      Tài liệu CI/README/status cập nhật; diff và liên kết nội bộ qua.
- [x] Đối soát 2026-10-07: CI commit `dd9cae6` tồn tại trên GitHub; local main khớp origin/main.
- [ ] Xác minh cả ba job success trên GitHub Ubuntu sau bản sửa setup-python;
      run trước sửa đã đọc: frontend success, hai backend failure. Xem cập nhật tiếp bên dưới.
- [ ] Cấu hình required checks/branch protection nếu chủ dự án chọn chính sách merge này.

Giới hạn: kiểm chứng thực thi hiện trên Windows local với PostgreSQL 17 trong Docker;
      chưa chứng minh Linux clean install hoặc GitHub Actions thành công. Không commit/push,
      không đổi repository settings, không gọi Maximo/Entra thật hoặc ghi dữ liệu nghiệp vụ.
      UAT 10 phiên, ETag/conditional update và remote upload vẫn pending.
      Hướng dẫn/phạm vi: [CI](ci.md).

## Đối soát toàn bộ checklist 1–6 — 2026-10-07

- [x] Đối chiếu 99 checkbox gốc (55 đã tick, 44 chưa tick) với mã, migrations, tests và
      ghi nhận live trong repo. Trong 44 mục chưa tick: 12 đã làm, 21 một phần,
      9 chưa đủ kiểm chứng, 2 chưa triển khai; bảng từng mục ở [đối soát](checklist-review.md).
- [x] Tick phần đã có bằng chứng, tách các mục gộp implementation/local live với UAT,
      scopes khác/Offshore và write contract; cập nhật CSRF/Planner/audit/PIC/nháp nhóm,
      timezone/Finish suy ra và migrations tới 0007. Không dùng mocks để tick yêu cầu live.
- [x] Đối chiếu Git hiện tại và GitHub connector: CI đã commit/push trong dd9cae6;
      combined commit statuses rỗng không chứng minh Actions chưa chạy hoặc đã thành công.
      Vì chưa có job results, kết quả runner vẫn pending; task đối soát không commit/push thêm.
- [x] Lập kế hoạch có phụ thuộc/tiêu chí nghiệm thu: nhóm lớn/keyboard, CI/images,
      admin/roster, runtime DB role/retention, read contract/scopes, tenant/staging và write contract.
      Đồng bộ README/intake/Entra/reader/status/CI; diff, links và coverage 99 hàng qua.

Giới hạn: chỉ sửa tài liệu, không chạy lại application tests; dùng bằng chứng 2026-10-07
      ở task CI (236 backend + 138 frontend, lint/typecheck/build, migrations DB tạm).
      Không gọi Maximo/Entra hoặc thay credential/grants/dữ liệu; live evidence từ các
      task trước, không phải kiểm chứng mới. Mục 7–10 giữ nguyên phạm vi.

## Nhóm 100/200 WO, keyboard/focus và CI/container — 2026-10-07

- [x] Hoàn tất phần synthetic của ưu tiên 1 trong đối soát: 100/200 WO group apply,
      row exceptions, Reset/Undo, paste CRLF hợp lệ/lỗi cuối nhóm, preview/save/reopen;
      stale baseline/version, invalid PIC, thu hồi grant giữa I/O và delayed response.
      PostgreSQL kiểm tra không có Draft/DraftItem/receipt một phần khi lỗi, replay/update/owner.
- [x] Sửa vòng Tab/Shift+Tab, focus khi mở/đóng/chooser→editor và sau Save disabled;
      giữ focus đúng khi thay panel bằng WO khác, gỡ listeners khi route ẩn và giữ edits.
      Version409 nhóm khóa lưu lại cho tới mở lại đối chiếu; không xóa edits.
- [x] Reviewer GPT-6 Astra/high rà soát read-only theo AGENTS mới: không có finding
      blocking/policy/API; finding P3 focus trả về WO cũ đã sửa và reviewer xác nhận.
- [x] 244 backend tests (136 fast + 108 PostgreSQL) qua trên Windows và Docker Linux;
      Ruff lint/format qua. Frontend clean npm ci, 151 tests/14 files, lint/typecheck/build qua.
      Chromium 154, viewport 1600×1000: native phím/focus/paste/Undo/preview/save/reopen,
      giữ edits Settings và radio ArrowDown/Tab/Enter qua; 27 synthetic API calls, không errors.
      [Bằng chứng và số đo](large-batch-keyboard-tests.md); không gọi Maximo/Entra thật.
- [x] Đọc Actions runs 37588420363/37590200157 và job logs run mới nhất: frontend Ubuntu
      success, hai backend fail vì uv0.11.9 thiếu Python3.12.14 Linux download. Setup-python
      v7.0.0 khóa SHA xác minh, đọc Python pin; frozen sync cấm download để dùng đúng binary.
- [x] Khóa base image digests đã xác minh; backend/web builds qua. Backend UID10001,
      live/readiness DB-schema-only trả ok; nginx -t qua. Migration upgrade/check/downgrade/
      upgrade/check và 244 tests qua trên PostgreSQL tạm Linux riêng, không publish host port.
- [x] Vá riêng source-map-js transitive dev 1.2.1 → 1.2.2 theo GHSA-68fv-2mgg-jv7q;
      package.json không đổi, không thêm dependency runtime. Clean install/build và npm audit
      0 advisories qua. [Container/CI evidence](container-checks.md), [CI](ci.md).
- [ ] Commit/push bản sửa rồi xác minh corrected GitHub Ubuntu run; hiện chưa có run cho working tree này.
- [ ] Monthly-load/10 planner live, toàn bộ keyboard-only/accessibility UAT, runtime lifecycle/
      security patch review và image scans, full staging Compose/HTTPS còn pending.

Giới hạn: browser APIs hoàn toàn giả; PostgreSQL là test infrastructure cô lập. Không ghi
      Maximo, thay credential/grants thật, deploy, commit/push hoặc đổi repository settings.
      Container tạm được dọn, images local-check giữ local. Các thay đổi AGENTS/README/.codex
      và docs/codex-agents.md từ chat khác được giữ nguyên. Ưu tiên tiếp: CI run sau push;
      sau đó bootstrap/admin UI và roster tid/oid được duyệt, DB roles/retention, read scopes/
      tenant staging và write contract theo [kế hoạch](checklist-review.md).


## Admin, DB roles và hồ sơ IT/write contract — 2026-10-07

- [x] GET admin roster đúng configured tenant/PERSON connections, current authority,
      no-store và không trả host/secret; PUT Planner kiểm tra crew discipline khi cấp,
      cho revoke assignment cũ. `/admin` phân biệt assignment và quyền DB gần nhất;
      session/identity recheck, CSRF, fail-closed và delayed read/error reconciliation.
- [x] Bootstrap first-admin dry-run/execute, exact tid/oid/active user, transaction lock,
      authority + global append-only audit 0008; user mới default admin=false. Chủ dự án
      chọn bản thân; local DB Entra 55433 additive 0007→0008 + Alembic check qua,
      preview đối chiếu rồi execute cho identity đã login. Đọc lại admin=true, đúng một
      authority audit; một WO grant/một Planner assignment vẫn nguyên như trước.
- [x] Provisioning roles trên DB riêng mới: runtime không sở hữu DB/schema/function,
      không membership/DDL/TEMP/TRUNCATE/nâng admin/gỡ hoặc sửa/xóa audit. Có test login
      runtime thật, unsafe ownership/prior ACL/default grants/future objects; không xóa
      receipts/uploads. Compose tách owner/runtime DSNs; CI đảm bảo psql test client.
- [x] Cleanup chỉ expired auth flow/session, dry-run mặc định, execute opt-in; tests giữ
      các phiên/flows còn hạn. Local dry-run thấy 6 session/0 flow hết hạn, không xóa.
      Không chọn thời hạn hoặc purge nháp/receipts/audit khi chưa được IT duyệt.
- [x] Chuẩn bị [hồ sơ IT](it-acceptance.md), roster mẫu, read/tenant/staging acceptance,
      [DB/retention runbook](database-operations.md) và [write contract](maximo-write-contract.md).
      Ghi single-resource href/orgid/token, exact ETag, stale/concurrent rejection,
      read-back, dates/null/PIC/duration/target và durable intent trước mọi test mutation.
      Collection ETag/baseline hash không được coi là revision WO; upload vẫn chưa có.
- [x] Kiểm chứng: 254 backend tests (136 fast + 118 PostgreSQL) qua; Ruff lint/format;
      0008 isolated downgrade/upgrade và Alembic drift clean. Role test cuối qua sau
      native psql portability + SQL cleanup. Frontend 160 tests/16 files, lint/typecheck/
      production build qua. Reviewer Astra/high rà soát và xác nhận sửa các blockers
      schema/function ownership, default privileges và admin refresh/auth failure.
      Compose config với DSNs synthetic, actionlint và links/placeholders/diff checks qua.
- [ ] IT phê duyệt roster khoảng 10 người, operator/staging, DB provisioning thật và
      thời hạn retention/replay/backup/restore; secret manager/reference resolver chưa có.
- [ ] Nghiệm thu read đầy đủ các discipline/Offshore, web/workbook cùng snapshot,
      Ubuntu routing, tenant portal/MFA/assignment/guest và HTTPS staging.
- [ ] Chỉ định WO CM/PM/CFT + quyền ghi test; xác minh write contract/ETag live trước
      sender/upload. Không tick các mục live từ synthetic evidence.

Giới hạn: không gọi mutation Maximo hoặc gửi email IT, không deploy/commit/push.
Thay đổi dữ liệu thật chỉ là additive migration/admin bootstrap local được chủ dự án
chọn; không thay WO/Planner grants, không chạy role provisioning hoặc cleanup execute
trên DB thật. Không có browser live admin test hoặc corrected GitHub runner cho working tree.
Các thay đổi batch/CI/agent có sẵn được giữ nguyên; các mốc tests Linux trước là lịch sử,
không phải Linux rerun cho admin mới.
