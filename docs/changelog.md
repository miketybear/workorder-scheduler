# Changelog — Work Order Scheduler

Việc đã xong kèm bằng chứng, mới nhất ở trên. Lịch sử trước 2026-10-29 ở [todos-archive-2026-10-29.md](todos-archive-2026-10-29.md).

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
