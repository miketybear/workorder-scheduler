# Changelog — Work Order Scheduler

Việc đã xong kèm bằng chứng, mới nhất ở trên. Lịch sử trước 2026-10-29 ở [todos-archive-2026-10-29.md](todos-archive-2026-10-29.md).

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
