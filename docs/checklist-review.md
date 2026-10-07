# Đối soát checklist 1–6 và kế hoạch tiếp theo

Cập nhật: 2026-10-07. Đối chiếu toàn bộ **99 checkbox gốc** trong mục 1–6 của
[todos.md](todos.md): trước đối soát có 55 mục đã tick, 44 mục chưa tick. Trong 99 mục
có 14 ghi nhận lịch sử Entra/PERSON, được giữ theo thời điểm xảy ra.

Trong **44 mục gốc chưa tick**: **12 đã làm**, **21 một phần**, **9 chưa đủ kiểm chứng**,
**2 chưa triển khai**. Các phần đủ bằng chứng được tick/tách trong todos; kế hoạch ở cuối tài liệu.

Phạm vi: đọc mã hiện tại, migrations/tests, ghi nhận live và metadata commit GitHub;
không gọi Maximo/Entra, không đọc secrets, không thay grant hoặc dữ liệu nghiệp vụ.
Task này chỉ sửa tài liệu nên không chạy lại application suite. Bằng chứng test gần nhất
là lần chạy 2026-10-07 ở task CI: **136 fast + 100 PostgreSQL backend**, **138 frontend/12 files**,
Ruff/ESLint/TypeScript/build và migrations round-trip trên DB tạm đều qua.
Bằng chứng live được ghi nhận ngày 02–07/10, không phải lần đo live mới của task đối soát.

Bảng 99 hàng bên dưới là snapshot của lần đối soát ban đầu. Tiến triển sau đối soát:
ưu tiên 1 synthetic/bàn phím đã qua; ưu tiên 2 đã đọc CI failure và sửa local, pin/build
images/Linux tests qua. Xem [cập nhật tiếp](#tiến-triển-sau-đối-soát) và todos hiện tại;
không thay các số thống kê lịch sử bằng checkbox mới tách.

## Cách đọc

- “Đã làm”: đủ bằng chứng trong phạm vi ghi ở hàng đó; code/mock tests không tự chứng minh live.
- “Một phần”: mục gốc gộp phần đã làm và phần còn thiếu; đã tách checkbox trong todos.
- “Chưa triển khai”: còn thiếu mã/quy trình; “Chưa xác minh”: thiếu kiểm chứng/đầu vào,
  dù đã có implementation hay giả định tham chiếu.
- Cột “Cũ” là checkbox trước đối soát. Mã như 4.15 là vị trí gốc, không phải line number
  sau khi tách checkbox. Các mục mới tách không dùng để so tỷ lệ hoàn thành với 99 mục gốc.

## Những phần đã làm nhưng checklist chưa phản ánh

- Mục 1: GET WO/PERSON/crew Onshore E&I, API key server-side, identity đọc, timezone,
  25 PIC E&I_N và lỗi query live đã có. Các yêu cầu đầy đủ về Offshore, metadata, quyền
  tối thiểu và write contract vẫn giữ mở.
- Mục 2: Python/Node/uv và lockfiles đã pin, CI đã có; lifecycle/image digests và lần chạy
  GitHub/Linux đầu chưa qua.
- Mục 3: connection metadata/secret_reference đã lưu; request hash/receipts nháp và
  append-only audit đã có. Upload orchestration/worker lease còn thiếu; runtime DB role
  có provisioning sau đối soát, áp dụng staging còn chờ IT.
- Mục 4: CSRF mutations hiện có, Viewer/Planner/Admin behavior, scope/owner isolation,
  revoke/cache clearing, grant audit và tests authorization đã có. Bootstrap admin/UI
  roster đầy đủ, tenant policy rộng và history/upload APIs còn thiếu; admin bootstrap/UI
  có implementation sau đối soát nhưng staging chưa nghiệm thu.
- Mục 5: crew/PIC reader và live E&I đã có; registry/grants thật đã dùng. Chưa có UI
  quản trị, ETag hoặc đối chiếu web/VBA.
- Mục 6: layout desktop, native table/panels, dữ liệu nghiệp vụ, áp lịch nhóm,
  timezone, nháp nhóm/paste/Undo/preview đã có. Keyboard-only/a11y và tác vụ nhóm lớn
  chưa đủ bằng chứng nghiệm thu.

## 1. Hợp đồng Maximo

Nguồn đối chiếu: [Intake](integration-intake.md), [reader/mapping](maximo-reader.md), [Planner live](planner-access.md), [detail.py](../backend/app/maximo/detail.py), [reader.py](../backend/app/maximo/reader.py), [reader tests](../backend/tests/test_maximo.py).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 1.1 | Chuẩn bị [checklist thu thập thông tin tích hợp](integration-intake.md) và yêu cầu thông tin | [x] | **Đã làm.** Có integration-intake; trạng thái đầu ngày 01/10 đã được cập nhật bằng bằng chứng đọc live ngày 02/10. |
| 1.2 | Nhận base host `http://bd-maxdev.biendongpoc.vn`, xác nhận môi trường test (2026-10-01). | [x] | **Đã làm.** Chủ dự án cung cấp host Onshore test; GET reader thật đã qua. |
| 1.3 | Xác nhận context path `/maximo`, test đại diện Onshore, không cần VPN (2026-10-01). | [x] | **Đã làm.** Context /maximo và không cần VPN được chủ dự án xác nhận; Ubuntu chưa kiểm tra. |
| 1.4 | Xác minh OSLC API URL/object structures thực tế; chưa có thông tin Offshore test. | [ ] | **Một phần.** Onshore WO/PERSON/crew GET đã qua; URL và hợp đồng Offshore chưa có. Tách checkbox theo hệ thống. |
| 1.5 | Chủ dự án chọn HTTP riêng cho test (2026-10-01); opt-in trong registry, chỉ DB connection test, | [x] | **Đã làm.** config.py và connections.py yêu cầu opt-in HTTP, DB environment=test, ứng dụng non-production; test_transport.py. |
| 1.6 | Kiểm tra sơ bộ không credential từ Windows: DNS phân giải, HEAD HTTP root trả 403, | [x] | **Đã làm.** Bằng chứng DNS/HEAD/TLS Windows ngày 01/10 còn hợp lệ trong phạm vi lịch sử, không chứng minh Ubuntu. |
| 1.7 | Xác nhận routing từ Ubuntu tới test Maximo, DNS, TLS và CA nội bộ. | [ ] | **Chưa xác minh.** Chưa có bằng chứng chạy từ Ubuntu hoặc CA/proxy staging. |
| 1.8 | Cấp tài khoản tích hợp test, API key và quyền tối thiểu cho WO/person group. | [ ] | **Một phần.** API key do chủ dự án nhập server-side và đọc WO/PERSON/crew thành công; chưa xác nhận account chuyên dụng/quyền tối thiểu/vòng đời key. |
| 1.9 | Bàn giao secret qua kênh bảo mật; không tái sử dụng key trong workbook vào mã nguồn. | [ ] | **Một phần.** Key được giữ trong .env ignore, không lấy từ workbook; chưa có quy trình bàn giao/rotation/secret manager được IT chốt. |
| 1.10 | Xác minh object structure oslcmxwodetail và mxpersongroup, các field/relationship được expose. | [ ] | **Một phần.** oslcmxwodetail và persongroupteam/respparty đọc được cho E&I; metadata đầy đủ/systemid và các scope khác chưa nghiệm thu. |
| 1.11 | Xác minh resource href, workorderid, siteid, orgid và cách định danh bản ghi. | [ ] | **Một phần.** Identity đọc connection/siteid/workorderid đã dùng live; SELECT không có orgid hoặc resource href WO cho write. |
| 1.12 | Xác minh status domain APPR/SCHED/WMATL/WMAT/DFAPPR trên từng hệ thống. | [ ] | **Chưa xác minh.** Configured statuses và lỗi serialization đã sửa; chưa đối chiếu domain thực tế đủ từng mã/từng hệ thống. |
| 1.13 | Kiểm tra parent!="*" và istask=0 có đúng tập WO cần lấy. | [ ] | **Chưa xác minh.** Query có parent!="*", istask=0 và reader validate từng dòng; chưa so tập WO với nguồn độc lập để nghiệm thu ngữ nghĩa. |
| 1.14 | Xác định giới hạn page size, next-page links, sort và tổng số bản ghi. | [ ] | **Chưa xác minh.** Bounds, sort, trusted next links có synthetic tests; chưa kiểm chứng giới hạn/paging lớn/stable snapshot upstream. |
| 1.15 | Xác nhận discipline codes, crew groups và ánh xạ PIC hợp lệ. | [ ] | **Một phần.** Có 6 discipline codes và mapping crew từ chủ dự án; live chỉ 25 PIC E&I_N. Tách phần còn lại. |
| 1.16 | Xác minh các field optional, null, độ dài PIC, đơn vị/độ chính xác estdur. | [ ] | **Chưa xác minh.** Schema xử lý null/Decimal và PIC bounds là hợp đồng ứng dụng; chưa đối chiếu metadata field length/nullability/duration upstream. |
| 1.17 | Chốt timezone nghiệp vụ, ngày/giờ mặc định, clear date/PIC và khoảng lọc cuối ngày. | [ ] | **Một phần.** Timezone Asia/Ho_Chi_Minh và khoảng ngày bao gồm/loại trừ đã dùng live; giờ mặc định/clear/null và write semantics chưa chốt. |
| 1.18 | Kiểm chứng POST + x-method-override: PATCH bằng WO test được chỉ định. | [ ] | **Chưa xác minh.** Chưa có WO được chỉ định hoặc bằng chứng PATCH override; không có remote writer trong mã. |
| 1.19 | Kiểm chứng ETag/If-Match hoặc cơ chế conditional update được hỗ trợ. | [ ] | **Chưa xác minh.** Detail trả revision=null; baseline_token là comparison hash, không phải ETag Maximo. |
| 1.20 | Ghi nhận lỗi authentication/authorization/validation thường gặp, có redaction. | [ ] | **Một phần.** Lỗi 400/BMXAA8744E live đã ghi; các lỗi 401/403/validation redaction có mocks, chưa đủ bảng lỗi live từng hệ thống. |
| 1.21 | Tạo fixtures đã khử thông tin nhạy cảm và field-mapping document từ kết quả kiểm chứng. | [ ] | **Một phần.** Field mapping từ VBA và inline fixtures synthetic có; chưa có bộ fixtures redacted từ hợp đồng live đầy đủ. |

## 2. Mã nguồn và công cụ

Nguồn đối chiếu: [CI](ci.md), [pyproject](../backend/pyproject.toml), [Python pin](../backend/.python-version), [Node pin](../frontend/.node-version), [Compose](../compose.yaml), [main.py](../backend/app/main.py).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 2.1 | Khởi tạo Git và .gitignore nếu chủ dự án tiếp tục triển khai trong thư mục hiện tại; | [x] | **Đã làm.** Git có remote GitHub và commits; HEAD hiện dd9cae6, local main khớp origin/main. Không đổi mô tả commit/push lịch sử thành trạng thái HEAD mới. |
| 2.2 | Chọn/pin Python, Node.js, PostgreSQL và dependency versions tương thích, còn được hỗ trợ. | [ ] | **Một phần.** Python 3.12.14/Node 26.0.0/uv 0.11.9 và lockfiles đã pin; PostgreSQL 17-alpine chưa digest, chưa đánh giá lifecycle/clean Ubuntu. |
| 2.3 | Scaffold backend theo backend/AGENTS.md; pyproject.toml, uv.lock và app factory. | [x] | **Đã làm.** backend/app, app factory, pyproject.toml, uv.lock tồn tại; fast suite qua. |
| 2.4 | Scaffold React/Vite/TypeScript strict; package.json và package-lock.json. | [x] | **Đã làm.** React/Vite/TypeScript strict, package.json/package-lock.json và nguồn frontend tồn tại. |
| 2.5 | Thiết lập settings tập trung, kiểm tra cấu hình và .env.example không có secret. | [x] | **Đã làm.** Settings tập trung, required config validation và examples không secret; test_app.py/test_transport.py. |
| 2.6 | Tạo health/readiness endpoints; không đưa thông tin credential vào response. | [x] | **Đã làm.** main.py live/ready; ready kiểm tra revision 0007, lỗi DB được rút gọn. |
| 2.7 | Thiết lập Ruff, pytest, typecheck, frontend lint/test/build scripts. | [x] | **Đã làm.** Ruff/pytest scripts và frontend typecheck/lint/test/build đã chạy; số tests xem mốc bằng chứng bên dưới. |
| 2.8 | Thêm workflow GitHub Actions cho backend/frontend và PostgreSQL migrations/tests | [x] | **Đã làm.** ci.yml có 3 job, action SHA pin và actionlint qua; GitHub connector xác nhận commit dd9cae6 đã có trên remote. Chưa có đủ bằng chứng kết quả runner; combined statuses rỗng không đại diện Actions check-runs. |
| 2.9 | Ghi lệnh chạy local và các kiểm tra thật sự chạy được vào README. | [x] | **Đã làm.** README, database-tests, entra-local-windows và ci.md có lệnh/phạm vi kiểm chứng. |

## 3. Database và migration

Nguồn đối chiếu: [models](../backend/app/db/models.py), [0002](../backend/migrations/versions/0002_workflow.py), [0005](../backend/migrations/versions/0005_person_access.py), [draft routes](../backend/app/scheduling/routes.py), [upload states](../backend/app/audit/uploads.py), [database tests](database-tests.md).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 3.1 | Tạo model/migration User, AccessGrant và MaximoConnection (2026-09-25). | [x] | **Đã làm.** models.py + migrations 0001 có User/AccessGrant/MaximoConnection. |
| 3.2 | Triển khai lưu Session hash/expiry và logout với CSRF (2026-09-29). | [x] | **Đã làm.** sessions.py lưu token/CSRF hash + expiry; test_postgres.py kiểm tra session/logout. |
| 3.3 | Nối Session với callback MSAL + JWT validation (2026-09-29); chờ kiểm thử tenant thật. | [x] | **Đã làm.** entra.py + migration 0003; local login/callback thật đã qua 02/10, chú thích chờ login trong checklist đã lỗi thời. |
| 3.4 | Thiết kế Draft/DraftItem với owner, scope, baseline, revision và proposed changes (2026-09-29). | [x] | **Đã làm.** models.py/drafts.py/routes.py lưu owner/scope/baseline/revision/proposals; 0004 thêm receipts. |
| 3.5 | Schema UploadBatch/UploadItem/AuditEvent, item UUID và unique idempotency theo actor. | [x] | **Đã làm.** 0002 có UploadBatch/UploadItem/AuditEvent, UUID/uniqueness; chỉ schema và dịch vụ nội bộ. |
| 3.6 | Orchestrator kiểm tra request hash khi submit lặp; liên kết retry attempts và correlation logs. | [ ] | **Một phần.** request hash/dedup nháp đơn/nhóm có và tests concurrency qua; upload orchestration/retry links/correlation logs chưa có. |
| 3.7 | Đặt unique/index theo connection + site + workorderid; không dùng WONUM làm khóa toàn cục. | [x] | **Đã làm.** Unique/index và active upload index giữ connection + site + WOID; test_postgres.py kiểm tra connection/site isolation. |
| 3.8 | Lưu connection config và secret reference; không lưu secret dạng rõ trong business tables. | [ ] | **Đã làm.** MaximoConnection lưu metadata/secret_reference; registry server-side giữ key. Reference chưa được resolve bằng secret manager. |
| 3.9 | Tạo/review migration 0001_identity; sinh PostgreSQL SQL offline thành công (2026-09-25). | [x] | **Đã làm.** 0001 đã review và offline SQL; hiện thêm bằng chứng online round-trip tới head. |
| 3.10 | Áp dụng migrations 0001/0002 và kiểm thử constraints trên PostgreSQL 17 test (2026-09-29). | [x] | **Đã làm.** Không chỉ 0001/0002: 0001–0007 đã qua migrations/schema check trên DB tạm ngày 07/10. |
| 3.11 | State machine sending/unknown và hàm chuyển sending quá hạn thành unknown. | [x] | **Đã làm.** audit/uploads.py có transitions + recover_stale_sends; unknown không được tự retry, tests state/PostgreSQL qua. |
| 3.12 | Nối recovery vào worker lifecycle/lease và kiểm thử crash khi gửi Maximo thật. | [ ] | **Chưa triển khai.** main.py lifespan chưa có worker/lease/reconciliation; chưa có live send/crash recovery. |
| 3.13 | Xác định retention cho draft, session và audit cùng IT/chủ dự án. | [ ] | **Một phần sau đối soát.** Có cleanup dry-run/execute chỉ expired auth; retention draft/receipts/audit và backup vẫn cần IT duyệt. |
| 3.14 | Thiết kế quyền DB để người dùng ứng dụng không sửa/xóa lịch sử audit. | [ ] | **Một phần sau đối soát.** Có SQL runtime/owner, privileges tests DB/roles tạm và Compose tách DSN; IT chưa áp staging, owner còn có thể gỡ trigger. |

## 4. Entra SSO và phân quyền

Nguồn đối chiếu: [Entra](entra-setup.md), [PERSON](person-access.md), [Planner](planner-access.md), [sessions](../backend/app/auth/sessions.py), [Planner tests](../backend/tests/test_planner_postgres.py), [Entra tests](../backend/tests/test_entra_postgres.py), [WO UI tests](../frontend/src/scheduling/WorkOrders.test.tsx).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 4.1 | Bắt đầu checklist thu thập Entra (2026-10-02) tại [Entra setup](entra-setup.md): | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.2 | Chủ dự án xác nhận chưa có app registration (2026-10-02); bổ sung hướng dẫn tạo | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.3 | Ghi nhận chủ dự án báo đã tạo app registration (2026-10-02). | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.4 | Nhận Tenant ID và Application (client) ID từ chủ dự án (2026-10-02), ghi trong | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.5 | Chuẩn bị Entra Windows local HTTPS (2026-10-02): cert localhost 30 ngày tin cậy | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.6 | Bật Entra config local và restart backend (2026-10-02): secret do chủ dự án nhập | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.7 | Xác minh Entra login/callback/session live cơ bản trên Windows local (2026-10-02): | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.8 | Ghi nhận logout/login lại local được chủ dự án xác nhận đúng (2026-10-02). | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.9 | Chốt phạm vi khởi đầu Onshore test + chỉ xem (`read`) với chủ dự án (2026-10-02). | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.10 | Nhận danh mục discipline từ ảnh Value/Description và xác nhận timezone | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.11 | Kiểm tra lại `.env` theo phản hồi chủ dự án (2026-10-02): dòng Maximo không còn | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.12 | Chủ dự án nhập API key test và bật dòng WOS_MAXIMO (2026-10-02). | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.13 | Quyền Onshore test từ PERSON theo yêu cầu chủ dự án (2026-10-02): signed Entra | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.14 | Kiểm chứng login → PERSON → quyền E&I trên giao diện (2026-10-02): chủ dự án | [x] | **Mốc lịch sử.** Ghi nhận intake/triển khai từng bước ngày 02/10; giữ [x] theo sự kiện đã xảy ra. Các câu “chưa…” ở mốc cũ không dùng làm trạng thái hiện tại; xem checklist tổng đã đối soát ngay dưới lịch sử và các tài liệu Entra/PERSON. |
| 4.15 | Nhận tenant ID, client ID, phương thức credential, callback/logout URI và nhóm được truy cập. | [ ] | **Một phần.** IDs, client secret và HTTPS callback localhost đã có; nhóm đăng nhập, credential expiry/rotation/logout/staging còn thiếu. |
| 4.16 | Đăng ký ứng dụng single-tenant và cấu hình quyền đăng nhập với IT. | [ ] | **Một phần.** App registration và callback hoạt động đã được chủ dự án xác nhận; portal single-tenant/Web/assignment chưa đối chiếu IT. |
| 4.17 | Triển khai login/callback/logout bằng MSAL + PyJWT; state/nonce/PKCE và JWT validation. | [x] | **Đã làm.** entra.py: MSAL flow + PyJWT issuer/audience/tid/oid; test_entra.py/test_entra_postgres.py. |
| 4.18 | Xác minh login thật, MFA/Conditional Access và TLS/proxy với IT. | [ ] | **Một phần.** Local login/session/logout và HTTPS qua; MFA/Conditional Access/cookie expiry live/TLS proxy staging chưa nghiệm thu. |
| 4.19 | Session server-side, expiry, Secure/HttpOnly cookie và CSRF logout (2026-09-29). | [x] | **Đã làm.** sessions.py server-side session + Secure/HttpOnly/CSRF logout; expiry synthetic có tests. |
| 4.20 | Áp CSRF cho mọi API mutation nghiệp vụ khi triển khai. | [ ] | **Đã làm.** CSRF cho toàn bộ mutations hiện có: logout, drafts/batches/delete, admin Planner, settings; CLI đặc quyền không phải browser endpoint. |
| 4.21 | Ánh xạ identity theo tenant ID + object ID; user mới không có WO grants/admin. | [x] | **Đã làm.** Stable tid/oid identity, new user không grants/admin; tests callback new/tenant/disabled. |
| 4.22 | Xây quyền Viewer/Planner/Admin và scoped grants theo connection + discipline. | [ ] | **Đã làm.** policy.py, PlannerPermission, PERSON-derived effective grants và is_admin; read/write/admin hành vi đã có, không cần cột role dạng enum. |
| 4.23 | Thiết lập đường cấp admin đầu tiên có kiểm soát; admin không tự được xem mọi WO. | [ ] | **Đã triển khai sau đối soát.** bootstrap_admin.py dry-run/execute, stable identity/configured tenant, serialized first-admin-only, global immutable audit 0008 và không cấp WO grant; staging operator cần IT chốt. |
| 4.24 | Nhận danh sách planner và grants thực tế cho từng hệ thống. | [ ] | **Một phần.** Một identity Onshore E&I Planner đã được duyệt/cấp/thu hồi live; chưa có roster khoảng 10 người/các hệ thống còn lại. |
| 4.25 | Áp policy dùng chung cho list/detail/draft/history/upload/status/count. | [ ] | **Một phần.** Session/PERSON/connection/scope checks dùng chung cho API hiện có; history/upload/job status chưa có API để áp policy. |
| 4.26 | Từ chối ID ngoài scope mà không lộ sự tồn tại hoặc nội dung. | [ ] | **Đã làm.** Scope/owner checks dùng generic 404 và không trả WO/draft ngoài quyền; test_maximo_postgres/test_draft_api/test_batch_api. |
| 4.27 | Xử lý thu hồi quyền, đổi discipline WO và cache/session đang tồn tại. | [ ] | **Đã làm.** PERSON/grant/current WO recheck, revoke giữa I/O, UI clear/hidden workspace; PostgreSQL + UI tests và revoke Planner live. |
| 4.28 | Ghi audit khi thay đổi grants. | [ ] | **Đã làm.** AuthorizationEvent 0005/0006; Planner audit before/after/reason/source cùng transaction; test_person_access_postgres/test_planner_postgres. |
| 4.29 | Kiểm thử phiên hết hạn, sai tenant, giả mạo scope, guessed IDs và revoked grants. | [ ] | **Đã làm.** Synthetic expiry/wrong tenant/forged scope/guessed IDs/revocation đã chạy. Live tenant policy rộng là mục riêng chưa hoàn thành. |

## 5. Connector và retrieve

Nguồn đối chiếu: [reader contract](maximo-reader.md), [reader](../backend/app/maximo/reader.py), [detail/PIC](../backend/app/maximo/detail.py), [list routes](../backend/app/maximo/routes.py), [scope tests](../backend/tests/test_maximo_postgres.py).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 5.1 | Registry runtime theo connection UUID, timeout riêng; metadata/nhãn từ DB. | [x] | **Đã làm.** config.py + configured_connection; registry keyed UUID và metadata từ DB. |
| 5.2 | Cấu hình registry/grants thật và UI quản trị có audit. | [ ] | **Một phần sau đối soát.** Registry/grant/Planner Onshore E&I live đã có; admin UI quản lý Planner và roster có tests. UI đổi registry/URL/secret và scopes khác vẫn pending. |
| 5.3 | Cài HTTP client với header API key, TLS verification và log đã redaction. | [x] | **Đã làm.** main.py HTTPX với TLS verification, trust_env=False/no redirects; reader rút gọn lỗi. |
| 5.4 | Áp scope server-side; encode filter values, không nối raw query từ người dùng. | [x] | **Đã làm.** reader query_parameters + routes allowlist, mandatory discipline/grants; raw query/client arbitrary host bị từ chối. |
| 5.5 | Map trường VBA: progress, discipline, wonum, description, worktype, location, system, | [x] | **Đã làm.** SELECT/WorkOrder + frontend columns map dữ liệu workbook; systemid live thiếu là giới hạn contract còn mở ở mục 1. |
| 5.6 | Lấy siteid/workorderid và kiểm tra identity khi phân trang. | [x] | **Đã làm.** reader/detail kiểm tra siteid/workorderid; duplicate identity/repeated pages bị chặn. |
| 5.7 | Lấy và xác minh revision/ETag cần cho cập nhật an toàn. | [ ] | **Chưa xác minh.** Revision vẫn null; chưa lấy/validate per-record ETag hoặc conditional update. |
| 5.8 | Xử lý optional values và lỗi response có kiểm soát. | [x] | **Đã làm.** WorkOrder model/Decimal/optional null, map errors fail toàn request; test_maximo.py/test_detail.py. |
| 5.9 | Lấy đủ các trang; chỉ theo links thuộc trusted connection. | [x] | **Đã làm.** read_collection/next_page_url bounds + trusted links + scope reapply; đầy đủ theo hợp đồng giả lập, paging lớn live chưa nghiệm thu. |
| 5.10 | Filter target date có offset, status domain cấu hình và discipline được cấp quyền. | [x] | **Đã làm.** AwareDatetime + target_from >=, target_before <, configured statuses/grants; reader/routes/tests dates. |
| 5.11 | Tìm kiếm WO/mô tả/Tag Name và lọc status trong tập WO đã tải (2026-10-02); | [x] | **Đã làm.** WorkOrders search/status client-side trong tập đã tải; không phải server search. RAM snapshots giữ filter khi chuyển nguồn theo hành vi mới. |
| 5.12 | Lấy danh sách crew/PIC theo cấu hình discipline. | [ ] | **Đã làm.** read_pics theo group server, child relation paging/bounds; 25 PIC E&I_N live. Scope khác cần kiểm chứng riêng. |
| 5.13 | Xử lý upstream unavailable/API key hết hiệu lực, không trả stale data ngoài quyền. | [x] | **Đã làm.** Upstream lỗi trả fail-closed/sanitized; session/access error clear hoặc hide cache, refresh lỗi còn giữ snapshot đã xác minh theo chính sách RAM hiện tại. |
| 5.14 | Đối chiếu tập WO web/VBA với cùng hệ thống, bộ lọc và thời điểm trên test. | [ ] | **Chưa xác minh.** Không có đối chiếu workbook và web cùng connection/filter/timepoint; retrieve 117 WO không thay so tập. |

## 6. Bảng lập lịch và nháp

Nguồn đối chiếu: [Drafts](drafts.md), [WorkOrders](../frontend/src/scheduling/WorkOrders.tsx), [BatchPlanner](../frontend/src/scheduling/BatchPlanner.tsx), [group tests](../frontend/src/scheduling/BatchPlanner.test.tsx), [dates tests](../frontend/src/api/dates.test.ts), [batch API tests](../backend/tests/test_batch_api.py).

| Mã gốc | Mục gốc | Cũ | Kết quả đối soát / bằng chứng và phần thiếu |
| --- | --- | --- | --- |
| 6.1 | Tạo layout desktop, nhãn hệ thống/môi trường, trạng thái phiên và bộ lọc có quyền. | [ ] | **Đã làm.** WorkOrders/App/Settings + CSS; nhãn system/environment/capability/session, responsive panels. Browser desktop/hẹp có bằng chứng. |
| 6.2 | Chọn cách dựng bảng sau thử nghiệm keyboard editing/paste và số lượng WO thực tế. | [ ] | **Một phần.** Native table/panel đã được chọn/duyệt, paste/Undo có tests, 100 WO selection và 117 WO retrieve; keyboard workflow/100–200-row editing benchmark chưa qua. |
| 6.3 | Hiển thị các cột tương đương bảng Work Order Scheduler của workbook. | [ ] | **Đã làm.** Mapping dữ liệu có; thiết kế được duyệt là 7 cột + 17 field chi tiết, không giữ 21 cột nguyên mẫu. Technical identity/systemid ẩn có chủ đích. |
| 6.4 | Cho sửa schedstart/schedfinish/assignedtechname/estdur trong editor từng WO (2026-10-01). | [x] | **Đã làm.** Start/PIC/duration đơn và nhóm; Finish đã chuyển read-only derived theo yêu cầu chủ dự án, không còn sửa độc lập. |
| 6.5 | Cho chọn đổi target; khóa PM/CFT và giải thích tại editor (2026-10-01). | [x] | **Đã làm.** Target pickers set intent, PM/CFT frontend lock + backend reject; target nhóm vẫn chưa mở. |
| 6.6 | Áp cùng ngày cho nhiều dòng được chọn; vẫn validate từng WO. | [ ] | **Đã làm.** BatchPlanner apply group start/PIC/duration + per-row exceptions; batches.py validate từng WO và atomic save. |
| 6.7 | Hiển thị trường đã sửa, reset về baseline và before/after preview trong editor từng WO (2026-10-01). | [x] | **Đã làm.** Modified fields/reset/Undo/before-after cho cả đơn/nhóm, preview trước save nhóm; UI tests. |
| 6.8 | Thiết kế date input/display theo timezone nghiệp vụ đã xác minh. | [ ] | **Đã làm.** dates.ts/DatePickers use connection timezone; Asia/Ho_Chi_Minh đã chốt, offsets/invalid times/cross-midnight tests. |
| 6.9 | Lưu/khôi phục draft một WO theo owner + scope; không chia sẻ giữa người dùng (2026-10-01). | [x] | **Đã làm.** Draft đơn/nhóm owner/scope/baseline/version/receipts tới 200 WO; live đơn create/restore/update/delete đã xác minh. |
| 6.10 | Bảo vệ edits khi đổi filter/hệ thống; không hiển thị nhầm dữ liệu connection cũ (2026-10-01). | [x] | **Đã làm.** Workspace RAM qua routes/tab/source, dirty guards; identity/grants/preference change clears snapshots; UI regression tests. |
| 6.11 | Validate cả frontend và backend; backend là nguồn quyết định (2026-10-01). | [x] | **Đã làm.** changes.py/batches/routes là quyết định server; UI sàng lọc input không thay auth; PM/CFT/PIC/date/duration tests. |
| 6.12 | Kiểm thử bàn phím, focus, nhãn control và trạng thái loading/empty/error. | [ ] | **Một phần.** Labels/role status/alert/focus/Escape có mã và tests một phần; chưa có browser keyboard-only Tab/Shift+Tab/Enter, focus return/containment/full a11y. |

## Kế hoạch làm tiếp theo

Đây là kế hoạch sau đối soát, chưa đánh dấu các việc dưới đây đã triển khai.
Ưu tiên 1–2 có thể làm ngay với mã/test fixture hiện có; 3–6 cần đầu vào hoặc quyết định
được ghi rõ. Không mở remote upload chỉ vì draft baseline/hash tests đã qua.

| Thứ tự | Việc cụ thể | Phụ thuộc / đầu vào | Tiêu chí hoàn thành |
| --- | --- | --- | --- |
| 1 | Kiểm thử tác vụ nhóm 100–200 WO: apply group, exceptions, paste hợp lệ/lỗi từng dòng, Undo/reset, preview/save/reopen, stale/version/revoked grants và delayed responses; keyboard-only toàn luồng đơn/nhóm/chooser/Settings | Fixture synthetic; giữ giới hạn 200, dùng backend PostgreSQL tests; browser test không ghi Maximo | Có ca bao phủ nguyên tác vụ nhóm lớn và Tab/Shift+Tab/Enter/Escape/focus return; lỗi không bỏ edits hoặc lộ scope; ghi số WO/batch size và thời gian đo; sửa lỗi tìm được trước tick |
| 2 | Xác minh CI đã push và môi trường sạch; đánh giá support lifecycle, pin image digests và thử application images | Workflow dd9cae6 đã có trên GitHub; cần job results/quyền truy cập runner, Docker/network; giữ stack trừ khi có lý do được ghi | Ba job GitHub Ubuntu qua từ lockfiles; clean install/build, migration round-trip; ghi phiên bản/digest và bằng chứng, không chỉ actionlint/local suite |
| 3 | Thiết kế và triển khai bootstrap admin + UI quản trị Planner/connection cần thiết | Chủ dự án/IT chỉ định trusted operator/admin đầu tiên, roster tenant/object IDs, connection/discipline/capability; không dùng email làm proof | Bootstrap có reason/audit/đường vận hành rõ; admin không tự có WO access; mutations CSRF, allowlisted config và tests guessed IDs/revocation; UI Settings vẫn chỉ chọn connection |
| 4 | Tách DB runtime role và migration owner; retention/cleanup/secret reference resolver | IT/chủ dự án chốt quyền DB, thời hạn session/draft/receipts/audit, yêu cầu backup và cách giữ/rotation secret | Runtime không DDL/gỡ triggers/sửa/xóa audit; migration owner upgrade được; test privileges trên DB mới; cleanup theo policy không phá receipts/recovery, tài liệu secret không chứa giá trị |
| 5 | Hoàn tất hợp đồng read Onshore, mở rộng discipline và chuẩn bị Offshore | Maximo admin/planner cung cấp metadata/status domain/sample WO, crew scopes, snapshot workbook cùng thời điểm; Offshore URL/account riêng; IT cung cấp Ubuntu routing | Đối chiếu đủ identity/read fields/systemid, parent/task, nullability/duration bounds, status domain và paging; fixtures live đã redaction; so tập web/VBA cùng filter/timepoint; ghi rõ scopes thực sự qua |
| 6 | Nghiệm thu Entra/tenant trên staging và nhiều tài khoản | IT đối chiếu portal single-tenant/Web/assignment, MFA/Conditional Access; HTTPS staging/callback/logout; roster đã duyệt | Login allow/deny, wrong tenant, disabled account, logout/cookie cũ/expiry, nhiều scopes và thu hồi live có bằng chứng; local login không thay thế staging policy |
| 7 | Khóa write contract trước chuyển sang mục 7 Upload | WO CM/PM/CFT test được chỉ định + quyền ghi; resource href/orgid, ETag/If-Match/PATCH override, clear/null/time/duration/PIC contract được chốt | Conditional update và stale-write conflict được chứng minh trên test; nếu không hỗ trợ phải chốt giới hạn/race với chủ dự án; sau đó mới triển khai durable intent/dedup/serialize/read-back/unknown reconciliation và history/status đúng scope |

Trình tự phụ thuộc: **1 → 2** có thể triển khai ở phạm vi local/CI; **3/4/5/6** chuẩn bị
cùng tiến độ khi có đầu vào tương ứng; **7** chỉ thực hiện sau write contract và policy/DB
đủ điều kiện. Nghiệm thu 10 phiên và rollout Ubuntu vẫn thuộc mục 8–9, không đánh dấu
hoàn thành trong lần đối soát này.

## Tiến triển sau đối soát

2026-10-07: ưu tiên 1 hoàn tất trong phạm vi synthetic — 100/200 WO group/row/paste/
Undo/preview/save/restore; PostgreSQL atomic failures/revocation/replay/version; Chromium
phím/focus đơn/nhóm/chooser/Settings. 244 backend và 151 frontend tests qua.
Full keyboard-only, screen reader và monthly-load/10 planner live vẫn mở;
[bằng chứng](large-batch-keyboard-tests.md). Reviewer xác nhận đã sửa finding P3 opener cũ.

Ưu tiên 2: đọc run 37590200157 cho 9e4cf58, frontend Ubuntu success; backend jobs fail
tại uv python install do catalog thiếu 3.12.14 Linux. Working tree dùng setup-python
v7.0.0 SHA pinned, giữ baseline; actionlint, Linux frozen sync/244 tests/migrations,
backend/web builds và health/nginx config qua. Khóa manifest digests, vá riêng transitive
dev source-map-js 1.2.2; npm audit0. Corrected GitHub run cần commit/push; lifecycle/
security patch review, image scans và staging còn mở. [CI](ci.md), [containers](container-checks.md).

Đầu vào ưu tiên 3–7 vẫn theo bảng kế hoạch: trusted admin/roster tid/oid và grant scopes,
retention/DB quyền, Maximo read/Offshore contract, tenant/staging và WO test/write contract.
Không lấy kết quả synthetic hoặc Linux local làm bằng chứng các nghiệm thu live này.

## Sửa các mô tả lỗi thời

- Các dòng “chưa nhận API key/chưa gọi WO/crew/chưa có grants” ở intake, reader và Entra
  được cập nhật thành trạng thái hiện tại Onshore E&I; các checkpoint lịch sử giữ theo ngày.
- Header README ghi chưa retrieve WO thật được sửa theo bằng chứng Onshore test đã có.
- Mục 6 ghi Finish chỉnh sửa độc lập được đổi thành Finish suy ra theo hành vi đã duyệt.
- Mục 3 ghi chỉ migrations 0001/0002 được cập nhật tới 0007; không suy rộng thành production.
- CI đã commit/push [dd9cae6](https://github.com/miketybear/workorder-scheduler/commit/dd9cae6d00a7aa99d955e05d3dcee3725cc294ae),
  được GitHub connector xác nhận trong task này; ghi “chưa push” đã lỗi thời.
  Combined status trả danh sách rỗng, không có Actions job results; không suy ra workflow chưa chạy hoặc đã qua.
- Không tick các mục chỉ có code/mocks khi yêu cầu gốc là kiểm chứng live hoặc UAT.



2026-10-07 sau đối soát: bootstrap/UI Planner/roster synthetic và SQL tách DB roles có
implementation/tests; admin local đã cấp theo lựa chọn chủ dự án, không thêm WO grants.
254 backend/160 frontend tests qua, 0008 roundtrip/schema check trên DB tạm; runtime
privileges dùng DB/roles tạm thực. Retention business/secret resolver, roster/IT/staging,
read đầy đủ và write/ETag live giữ mở. [Hồ sơ nghiệm thu](it-acceptance.md) và
[write gate](maximo-write-contract.md) là đầu vào trước upload, không phải hợp đồng đã duyệt.
