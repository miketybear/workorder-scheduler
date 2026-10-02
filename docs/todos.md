# TODO — Work Order Scheduler

Cập nhật: 2026-10-02.

## Cách sử dụng

- [x] là đã hoàn thành và có bằng chứng; [ ] là chưa làm, kể cả khi thiết kế đã mô tả.
- Mỗi nhóm có phụ thuộc và tiêu chí nghiệm thu. Hoàn thành mã chưa đồng nghĩa hoàn thành UAT.
- Ghi ngày, bằng chứng kiểm tra và hạn chế khi đánh dấu hoàn thành.
- P0: cần cho bản đầu; P1: mở rộng sau khi luồng chính ổn định.
- Không lưu hostname production chưa được cung cấp, API key hay client secret trong file này.

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

## 1. P0 — Thu thập cấu hình và kiểm chứng hợp đồng Maximo

Phụ thuộc: chủ dự án/IT cung cấp thông tin. Có thể làm scaffolding và mock song song về tiến độ.

- [x] Chuẩn bị [checklist thu thập thông tin tích hợp](integration-intake.md) và yêu cầu thông tin
      khởi đầu từ chủ dự án (2026-10-01). Đã nhận host test; chưa nhận credential/API URL đầy đủ.

- [x] Nhận base host `http://bd-maxdev.biendongpoc.vn`, xác nhận môi trường test (2026-10-01).
- [x] Xác nhận context path `/maximo`, test đại diện Onshore, không cần VPN (2026-10-01).
- [ ] Xác minh OSLC API URL/object structures thực tế; chưa có thông tin Offshore test.
- [x] Chủ dự án chọn HTTP riêng cho test (2026-10-01); opt-in trong registry, chỉ DB connection test,
      ứng dụng production không dùng HTTP. HTTPS/Entra vẫn yêu cầu TLS hợp lệ.
- [x] Kiểm tra sơ bộ không credential từ Windows: DNS phân giải, HEAD HTTP root trả 403,
      HTTPS lỗi xác minh chứng chỉ (2026-10-01); xem [bằng chứng/giới hạn](integration-intake.md).
- [ ] Xác nhận routing từ Ubuntu tới test Maximo, DNS, TLS và CA nội bộ.
- [ ] Cấp tài khoản tích hợp test, API key và quyền tối thiểu cho WO/person group.
- [ ] Bàn giao secret qua kênh bảo mật; không tái sử dụng key trong workbook vào mã nguồn.
- [ ] Xác minh object structure oslcmxwodetail và mxpersongroup, các field/relationship được expose.
- [ ] Xác minh resource href, workorderid, siteid, orgid và cách định danh bản ghi.
- [ ] Xác minh status domain APPR/SCHED/WMATL/WMAT/DFAPPR trên từng hệ thống.
- [ ] Kiểm tra parent!="*" và istask=0 có đúng tập WO cần lấy.
- [ ] Xác định giới hạn page size, next-page links, sort và tổng số bản ghi.
- [ ] Xác nhận discipline codes, crew groups và ánh xạ PIC hợp lệ.
- [ ] Xác minh các field optional, null, độ dài PIC, đơn vị/độ chính xác estdur.
- [ ] Chốt timezone nghiệp vụ, ngày/giờ mặc định, clear date/PIC và khoảng lọc cuối ngày.
- [ ] Kiểm chứng POST + x-method-override: PATCH bằng WO test được chỉ định.
- [ ] Kiểm chứng ETag/If-Match hoặc cơ chế conditional update được hỗ trợ.
- [ ] Ghi nhận lỗi authentication/authorization/validation thường gặp, có redaction.
- [ ] Tạo fixtures đã khử thông tin nhạy cảm và field-mapping document từ kết quả kiểm chứng.

Nghiệm thu: có hợp đồng request/response đã kiểm chứng, identity WO, quy tắc ngày và phạm vi
quyền API rõ ràng. Không dùng hostname giả để đánh dấu hoàn thành.

## 2. P0 — Khởi tạo mã nguồn và công cụ

Phụ thuộc: tài liệu đã hoàn thiện. Không cần credential thật.

- [x] Khởi tạo Git và .gitignore nếu chủ dự án tiếp tục triển khai trong thư mục hiện tại;
      hoàn thành git init ngày 2026-09-25; đã có commits và remote GitHub, main đồng bộ origin/main
      sau push commit 82900f3 ngày 2026-10-01.
- [ ] Chọn/pin Python, Node.js, PostgreSQL và dependency versions tương thích, còn được hỗ trợ.
- [x] Scaffold backend theo backend/AGENTS.md; pyproject.toml, uv.lock và app factory.
- [x] Scaffold React/Vite/TypeScript strict; package.json và package-lock.json.
- [x] Thiết lập settings tập trung, kiểm tra cấu hình và .env.example không có secret.
- [x] Tạo health/readiness endpoints; không đưa thông tin credential vào response.
- [x] Thiết lập Ruff, pytest, typecheck, frontend lint/test/build scripts.
- [ ] Thêm kiểm tra tự động trong CI khi đã chọn nơi quản lý mã nguồn.
- [x] Ghi lệnh chạy local và các kiểm tra thật sự chạy được vào README.

Nghiệm thu: môi trường sạch cài bằng lockfile và chạy frontend/backend với dữ liệu mock;
thiếu config bắt buộc phải báo rõ, không tự dùng endpoint production.

Bằng chứng 2026-09-25: backend và frontend chạy local; lockfiles đã tạo; lint/typecheck,
unit/UI tests và frontend build đã qua. Image digest và PostgreSQL runtime chưa xác minh.

## 3. P0 — Database và migration

Phụ thuộc: 2; refinement từ 1.

- [x] Tạo model/migration User, AccessGrant và MaximoConnection (2026-09-25).
- [x] Triển khai lưu Session hash/expiry và logout với CSRF (2026-09-29).
- [x] Nối Session với callback MSAL + JWT validation (2026-09-29); chờ kiểm thử tenant thật.
- [x] Thiết kế Draft/DraftItem với owner, scope, baseline, revision và proposed changes (2026-09-29).
- [x] Schema UploadBatch/UploadItem/AuditEvent, item UUID và unique idempotency theo actor.
- [ ] Orchestrator kiểm tra request hash khi submit lặp; liên kết retry attempts và correlation logs.
- [x] Đặt unique/index theo connection + site + workorderid; không dùng WONUM làm khóa toàn cục.
- [ ] Lưu connection config và secret reference; không lưu secret dạng rõ trong business tables.
- [x] Tạo/review migration 0001_identity; sinh PostgreSQL SQL offline thành công (2026-09-25).
- [x] Áp dụng migrations 0001/0002 và kiểm thử constraints trên PostgreSQL 17 test (2026-09-29).
- [x] State machine sending/unknown và hàm chuyển sending quá hạn thành unknown.
- [ ] Nối recovery vào worker lifecycle/lease và kiểm thử crash khi gửi Maximo thật.
- [ ] Xác định retention cho draft, session và audit cùng IT/chủ dự án.
- [ ] Thiết kế quyền DB để người dùng ứng dụng không sửa/xóa lịch sử audit.

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

- [ ] Nhận tenant ID, client ID, phương thức credential, callback/logout URI và nhóm được truy cập.
- [ ] Đăng ký ứng dụng single-tenant và cấu hình quyền đăng nhập với IT.
- [x] Triển khai login/callback/logout bằng MSAL + PyJWT; state/nonce/PKCE và JWT validation.
- [ ] Xác minh login thật, MFA/Conditional Access và TLS/proxy với IT.
- [x] Session server-side, expiry, Secure/HttpOnly cookie và CSRF logout (2026-09-29).
- [ ] Áp CSRF cho mọi API mutation nghiệp vụ khi triển khai.
- [x] Ánh xạ identity theo tenant ID + object ID; user mới không có WO grants/admin.
- [ ] Xây quyền Viewer/Planner/Admin và scoped grants theo connection + discipline.
- [ ] Thiết lập đường cấp admin đầu tiên có kiểm soát; admin không tự được xem mọi WO.
- [ ] Nhận danh sách planner và grants thực tế cho từng hệ thống.
- [ ] Áp policy dùng chung cho list/detail/draft/history/upload/status/count.
- [ ] Từ chối ID ngoài scope mà không lộ sự tồn tại hoặc nội dung.
- [ ] Xử lý thu hồi quyền, đổi discipline WO và cache/session đang tồn tại.
- [ ] Ghi audit khi thay đổi grants.
- [ ] Kiểm thử phiên hết hạn, sai tenant, giả mạo scope, guessed IDs và revoked grants.

Nghiệm thu: planner discipline A không đọc hoặc sửa dữ liệu B qua UI, direct API, draft,
history hay upload; quyền Onshore không tự cấp quyền Offshore.

## 5. P0 — Connector và retrieve WO

Phụ thuộc: 1, 2, 4; có thể phát triển trước bằng fixtures.

- [x] Registry runtime theo connection UUID, timeout riêng; metadata/nhãn từ DB.
- [ ] Cấu hình registry/grants thật và UI quản trị có audit.
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
- [ ] Lấy danh sách crew/PIC theo cấu hình discipline.
- [x] Xử lý upstream unavailable/API key hết hiệu lực, không trả stale data ngoài quyền.
- [ ] Đối chiếu tập WO web/VBA với cùng hệ thống, bộ lọc và thời điểm trên test.

Nghiệm thu: kết quả đủ trang và đúng scope; hai hệ thống có WO trùng số vẫn tách biệt;
lỗi upstream không bị hiển thị thành danh sách rỗng thành công.

## 6. P0 — Bảng lập lịch và lưu nháp

Phụ thuộc: 3, 4, 5; có thể dựng UI với fixture trước.

- [ ] Tạo layout desktop, nhãn hệ thống/môi trường, trạng thái phiên và bộ lọc có quyền.
- [ ] Chọn cách dựng bảng sau thử nghiệm keyboard editing/paste và số lượng WO thực tế.
- [ ] Hiển thị các cột tương đương bảng Work Order Scheduler của workbook.
- [x] Cho sửa schedstart/schedfinish/assignedtechname/estdur trong editor từng WO (2026-10-01).
- [x] Cho chọn đổi target; khóa PM/CFT và giải thích tại editor (2026-10-01).
- [ ] Áp cùng ngày cho nhiều dòng được chọn; vẫn validate từng WO.
- [x] Hiển thị trường đã sửa, reset về baseline và before/after preview trong editor từng WO (2026-10-01).
- [ ] Thiết kế date input/display theo timezone nghiệp vụ đã xác minh.
- [x] Lưu/khôi phục draft một WO theo owner + scope; không chia sẻ giữa người dùng (2026-10-01).
- [x] Bảo vệ edits khi đổi filter/hệ thống; không hiển thị nhầm dữ liệu connection cũ (2026-10-01).
- [x] Validate cả frontend và backend; backend là nguồn quyết định (2026-10-01).
- [ ] Kiểm thử bàn phím, focus, nhãn control và trạng thái loading/empty/error.

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
- [ ] Commit/push và xác minh HEAD bằng origin/main; không force push.
