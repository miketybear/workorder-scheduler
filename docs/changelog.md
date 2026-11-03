# Changelog — Work Order Scheduler

Việc đã xong kèm bằng chứng, mới nhất ở trên. Lịch sử trước 2026-10-29 ở [todos-archive-2026-10-29.md](todos-archive-2026-10-29.md).

## Xóa tất cả phân công của một WO — 2026-11-03

- [x] Panel kế hoạch task có mục "Xóa tất cả phân công của WO…", xem trước số task, số giờ, người rồi xác nhận. Xóa trong một giao dịch, có ghi vết; kế hoạch đã gửi Maximo được giữ nguyên toàn bộ; danh sách thay đổi thì từ chối. Không ghi gì lên Maximo.
- Bằng chứng: test PostgreSQL cho xóa, giữ task đã gửi, gửi lại cùng yêu cầu, danh sách cũ, CSRF; frontend vitest và `tsc`.
- Giới hạn: chỉ mở được từ panel của kế hoạch task; chưa thử trên giao diện.

## Thông báo sau khi phân công nói rõ đã lưu gì — 2026-11-03

- [x] Backlog mặc định bật chip Sẵn sàng khi mở trang.
- [x] Thông báo ngắn "Đã lưu phân công cho <người>" ở góc trên bên phải, tự ẩn sau 3 giây, dừng đếm khi rê chuột. Nút gửi không còn hiện "Tiếp tục gửi kế hoạch (0/0)" khi đợt gửi chưa có kế hoạch nào.
- Bằng chứng: frontend vitest và `tsc`. Giới hạn: chưa xem trên giao diện.

## Trang tải rota dễ hiểu hơn — 2026-11-03

- [x] Có dòng cố định "Rota đang dùng" lấy từ lần kích hoạt mới nhất của nhóm nhân lực (`active_since` trong danh sách import); mỗi lần tải lên có nhãn trạng thái; bỏ số phiên kỹ thuật và huy hiệu mâu thuẫn.
- [x] Hộp xác nhận nêu ảnh hưởng tới Resource Timeline và cách quay lại; báo rõ khi file trùng rota đang dùng. Sau tải lên có thông báo nổi bật và tự cuộn tới phần xem trước. Nút tải lên có gợi ý khi chưa đủ điều kiện.
- [x] Đổi chữ khỏi thuật ngữ kỹ thuật, Material Controller không còn khung đỏ, có chú giải mã ngày, bỏ chữ "trống" lặp lại, có trạng thái đang tải.
- [x] Bản đã hủy không còn hiện và không mở được trên trang; dữ liệu vẫn giữ trong database.
- [x] Trang chia 3 bước Chọn file, Kiểm tra, Kích hoạt; lỗi chặn khóa bước 3. Bảng tháng mặc định chỉ hiện người cần xem, mỗi người một dòng, cao tối đa 60% màn hình, cột tên và tiêu đề cố định.
- Bằng chứng: frontend vitest và `tsc`; test rota backend với PostgreSQL, gồm `active_since`.
- Giới hạn: chưa xem trên giao diện. Kích hoạt có phạm vi ngày, nên bản cũ có thể vẫn áp dụng ngoài phạm vi của bản mới nhất.

## Panel + WO chặn WO chưa đủ điều kiện — 2026-11-03

- [x] Panel Phân công WO hiện lý do bằng khung cảnh báo nổi bật và làm mờ, khóa Xác nhận lưu khi WO thiếu lịch/PIC trên Maximo hoặc ngày đang chọn nằm ngoài lịch WO. Lỗi lưu giờ hiện ngay trong panel thay vì bị che phía sau.
- [x] Thẻ Backlog không còn nói hai lần phần thiếu lịch/PIC.
- [x] Làm mới timeline thành nút icon có tooltip; nút gửi rút gọn thành Gửi kế hoạch kèm icon (Renew, Upload của Carbon), tooltip và tên trợ năng vẫn nói rõ Maximo.
- [x] Bộ lọc Backlog thành chip có trạng thái và số đếm: Chưa phân đủ, Đã phân đủ, Sẵn sàng, Thiếu lịch/PIC. Bấm lại để tắt lọc; bỏ nút Tất cả. Backend lọc trên toàn bộ danh sách qua `readiness`.
- [x] Backlog sắp xếp như bảng Work orders: ưu tiên cao trước, lịch sớm trước (chưa có lịch xếp sau), rồi số WO.
- Bằng chứng: frontend vitest và `tsc`.
- Giới hạn: chưa thử trên staging. Chưa có test riêng cho trường hợp ngày ngoài lịch ở panel. Kế hoạch tự chia nhiều ngày chỉ kiểm tra ngày bắt đầu ở panel; ngày sau vượt lịch do backend từ chối.

## Resource timeline chỉ phân công WO đã có lịch và PIC — 2026-11-02

- [x] Backend chặn tạo, chuyển, thêm ngày và gửi task (đơn lẻ, theo ngày, hàng loạt) khi Maximo thiếu `schedstart`, `schedfinish` hoặc `assignedto`, hoặc ngày phân công nằm ngoài lịch WO (so theo ngày ở múi giờ connection, tính cả hai đầu). Đọc giá trị hiện tại trên Maximo nên WO xếp lịch trực tiếp trên Maximo vẫn hợp lệ.
- [x] Phân công cũ lệch lịch vẫn sửa giờ, chuyển vào lịch hoặc xóa được; chỉ chặn gửi. PIC ngoài nhóm được giao chỉ cảnh báo, vì PIC là người điều phối.
- [x] Backlog hiện lý do và không cho kéo WO thiếu lịch/PIC; ngày ngoài lịch mờ đi khi đang đặt WO. Bỏ gợi ý "Đặt ... làm PIC" và luồng điền sẵn PIC.
- Bằng chứng: backend 1492 test pass trước khi thêm 4 mode `outside_schedule`; xem commit cho lần chạy cuối. Frontend vitest và `tsc`.
- Giới hạn: chưa có test tích hợp riêng cho gửi đơn lẻ, lần kiểm tra ngay trước khi gửi và lý do `outside_wo_schedule` của gửi hàng loạt. Chưa thử trên staging. Lần chạy test đầu treo 38 phút, chưa xác định nguyên nhân; sau khi bỏ session DB lồng trong transaction thì không tái diễn.

## Thông báo sau upload rõ nghĩa — 2026-11-02

- [x] Upload xong xóa thông báo "Đã lưu nháp", đổi câu thành "Đã upload N WO lên Maximo và đọc lại khớp"; dòng thông báo không còn nền sáng trên giao diện tối.

## Lỗi upload rota nêu rõ nguyên nhân — 2026-11-02

- [x] Sai tên sheet: báo tên đã nhập và các sheet có trong file. UI hiện lý do server trả cho mọi lỗi 422, bỏ câu "kết quả chưa rõ" vì 422 là từ chối chắc chắn. Các lỗi cấu trúc file khác vẫn là tiếng Anh. Chưa deploy.

## Tạo resource pool trên staging — 2026-11-02

- [x] Pool "Onshore test" (`BDPOC`) có audit `pool_provision`. Chưa có rota; chưa mở Resource Timeline bằng phiên thật.

## Home thành danh sách việc cần làm — 2026-11-02

- [x] `GET /api/home/summary`: tổng WO mở, thiếu lịch, thiếu PIC, quá Target theo scope được cấp; nháp, upload và route chưa rõ kết quả của chính user. Kiểm tra quyền trước và sau khi đọc Maximo.
- [x] Home hiện metric và danh sách việc xếp theo độ khẩn; Maximo lỗi thì báo chưa đọc được, không hiện số 0.
- Giới hạn: số trong tháng hiện tại nên WO quá hạn từ tháng trước chưa tính; link chỉ mở WO Scheduler, chưa áp bộ lọc; chưa đo thời gian tải.

## Căn giữa số trang ở pager bảng WO — 2026-11-02

- [x] `.pageButton` căn giữa nội dung cả hai chiều. Chỉ sửa CSS; chưa xem trên trình duyệt, chưa deploy.

## Route: lưu đăng nhập position mã hóa, bỏ API key position, popup — 2026-11-02

- [x] Chủ dự án chốt: Maximo production chấp nhận `maxauth`, tool chạy nội bộ, production dùng HTTPS. `maxauth` lưu mã hóa Fernet
      (migration 0018, `WOS_WORKFLOW_ROUTE_CREDENTIAL_KEY`) theo Entra user + kết nối + discipline; giữ qua logout/khởi động lại;
      xóa khi Maximo trả 401, user quên, revoke Planner hoặc mất quyền ghi; có audit lưu/xóa, không ghi giá trị.
- [x] Đọc việc position bằng `maxauth`, `workflow_route_accounts` chỉ còn `personid`. 401 không gửi lại cho WO kế tiếp.
- [x] Popup `RouteLogin` sau khi tải WO, cho phép bỏ qua; `RoutePanel` hỏi lại khi chưa có đăng nhập.
- Dependency: khai trực tiếp `cryptography` (đã có sẵn qua `pyjwt[crypto]`): mã hóa chuẩn không tự viết được; chỉ dùng ở credential store; không thêm gói mới.
- Bằng chứng: backend `--run-db-tests` 1479 passed, ruff sạch; frontend typecheck, lint, vitest 612/612. Maximo là mock.
- Deploy staging `1627d28`: migration head 0018, grants runtime đã kiểm tra, `/api/health/ready` 200, `workflow_route_accounts` E&I = ENISUP.
- Giới hạn: chưa thử với Maximo thật; preview N WO tạo tối đa N lần đăng nhập `maxauth` (chưa đo tải phiên Maximo); khóa mất thì phải đăng nhập lại.

## Mở toàn bộ chức năng trên staging cho user testing — 2026-11-02

- [x] Chủ dự án đổi thỏa thuận ban đầu: staging được ghi Maximo. `WRITE_APP_ENVIRONMENTS` thêm `staging`;
      vẫn đòi contract tường minh và connection enabled/onshore/test. Production bị từ chối; probe giữ dev/test.

## Deploy staging `wos.biendongpoc.vn` — 2026-10-30

- [x] Ubuntu `wos.biendongpoc.vn`: source `1f88dd9` ở `~/wos-staging/src-1f88dd9` (`current` symlink),
      image `wos-backend`/`wos-web:1f88dd9` build trên server; secrets ở `~/wos-staging/private` (700/600).
- [x] Host nginx `sites-enabled/wos` (10.17.31.187:443, cert `*-0926`) re-encrypt tới web `127.0.0.1:9443`.
- [x] Role `wos_owner`/`wos_runtime` tách DBA; migration head `0017`; `provision_roles.sql` (runtime đọc 36/36 bảng).
- [x] Kết nối Onshore test `aab45085-…` đăng ký bằng `app.maximo.provision` (audit `connection_created`);
      admin đầu tiên bằng `bootstrap_admin` (audit `first_admin_bootstrap`, 0 WO grant).
- Bằng chứng: db/backend/web healthy; HTTPS `/` và `/api/health/ready` 200; login 303 tới Entra tenant;
      chủ dự án đăng nhập Entra và thấy danh sách WO E&I qua PERSON. Server ra được `bd-maxdev` (HTTP test).
- Giới hạn: upload tắt (bỏ `assignment_write_contract`); image tag local, chưa registry digest; chưa backup;
      chưa nghiệm thu 10 planner.

## `base_url` cho connection và lệnh `app.maximo.provision` — 2026-10-30

- [x] Connection trong `WOS_MAXIMO` có thể khai `base_url`; backend ghép `/oslc/os/BDSCHED_WO` rồi
      chạy kiểm tra URL cũ. Khai cả `base_url` lẫn `collection_url` bị từ chối; `collection_url` cũ vẫn hợp lệ.
- [x] `python -m app.maximo.provision` (owner DSN, chạy qua service `migrate`) tạo row
      `maximo_connection` kèm audit `connection_created` theo actor Entra đã đăng nhập; có dry-run,
      idempotent khi trùng, từ chối khác giá trị, trùng system/environment, HTTP ngoài test, timezone lạ.
- [x] `bootstrap_admin` và `manage_planner` chuyển vào `app/operators/` để có trong image backend;
      chạy `python -m app.operators.<name>` (staging: qua service `migrate`, owner DSN).
- Bằng chứng: backend `--run-db-tests` 1478 passed; sau khi chuyển CLI, test admin/provision 15 passed; ruff sạch.
- Giới hạn: chưa chạy trên server staging.

## Cấu hình Maximo dùng chung `WOS_MAXIMO_DEFAULTS` — 2026-10-30

- [x] `open_statuses`, `crew_groups`, `person_login_domain` khai một lần trong `WOS_MAXIMO_DEFAULTS`;
      mỗi connection chỉ cần `collection_url` + `api_key`, giá trị riêng của connection đè giá trị chung.
      Defaults không nhận URL, key hay write contract (`extra="forbid"`), giá trị gộp vẫn qua validator cũ.
- Bằng chứng: `tests/test_maximo_defaults.py` (5 test); backend 914 passed, ruff sạch.
- Giới hạn: chưa kiểm tra trên server staging; `backend/.env` local không đổi (cấu hình cũ vẫn hợp lệ).

## Biên nhận rota không còn hiện lý do "already activated" — 2026-10-30

- [x] Khi đã có biên nhận kích hoạt, `RotaActivation` ẩn khối "Chưa thể kích hoạt" (lý do từ backend
      "Import is cancelled or already activated" làm biên nhận thành công trông như lỗi). Backend giữ nguyên.
- [x] Test mới `shows an existing receipt without the "already activated" blocking reason` (fail trước sửa, đạt sau).
      Typecheck, lint đạt; `vitest --maxWorkers=2` 609/609, 47/47 file. Chưa thử trên trình duyệt với roster thật.

## Ctrl+D điền xuống khi ô ngày chưa Enter — 2026-10-30

- [x] Tái hiện lỗi agy báo: ô Scheduled Start giữ chữ đang gõ cho tới Enter/blur, nên Ctrl+D không điền gì (Duration và PIC
      không bị vì lưu ngay khi đổi). Sửa: `DateTimeInput` commit chữ đang gõ khi nhấn Ctrl/Cmd+D, và `fillDown` đọc giá trị
      nguồn trong updater của `setInline` để thấy giá trị vừa commit cùng lần nhấn.
- [x] Test mới `fills a typed Scheduled Start down with Ctrl+D before it is committed with Enter` (fail trước sửa, đạt sau).
      Typecheck, lint đạt; `vitest --maxWorkers=2` 608/608, 47/47 file. Chưa thử trên trình duyệt với dữ liệu live.

## Đối chiếu nhóm "có thể đã xong" trong todos — 2026-10-29

- [x] Đóng sau khi đối chiếu code/test: preview/submit allowlist, chặn target PM/CFT, chỉ gửi trường đã đổi, read-back,
      dedupe/khóa WO (`uq_active_upload_wo`), redaction lỗi upstream, href/orgid mutation, test PM/CFT/allowlist/paging/null.
      Bằng chứng: `test_pm_cft_targets_rejected_before_audit_or_outbound`, `test_only_changed_fields_sent_and_offsets_preserved`,
      `test_send_requires_durable_intent_and_readback_no_resend`, `test_concurrent_duplicate_reservation_and_send_have_real_commits`,
      `test_upstream_errors_redacted_and_not_retried`, `test_target_lowercase_structure_preserves_resource_and_rejects_unsafe_href`.
      `pytest -k` nhóm này: 87 passed, 70 skipped (DB tests cần `--run-db-tests`).
- [x] Rota importer staging, LABOR reader (`app/maximo/labor.py`), activation (`app/rota/activation.py`) và assignment ledger
      (`app/assignments/`) đã có; nghiệm thu dữ liệu thật vẫn chờ Maximo admin (todos mục 4).
- Còn mở, chuyển vào todos: correlation log, `lochierarchy.systemid` + fixtures live, bảng mã rota, UI connection thứ hai.
