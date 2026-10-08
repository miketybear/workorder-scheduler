# P7 — Upload từ nháp đã lưu

Cập nhật: 2026-10-08. Mốc đầu dùng Maximo giả để kiểm chứng orchestration;
conditional write Onshore/Offshore chưa được nghiệm thu. Không bật upload thật.

## Phạm vi và ranh giới

Upload phải xuất phát từ nháp thuộc tài khoản đang đăng nhập, với phiên bản cụ thể
và danh sách thành viên được chọn. Browser không cung cấp baseline, actor, quyền,
endpoint Maximo hoặc payload ghi tùy ý. Backend dựng changes từ nháp và WO hiện tại.
Định danh thành viên luôn có connection, site và workorder ID.

Preview đọc lại WO/PIC, kiểm tra quyền Planner, baseline, loại WO và các giá trị;
preview không tạo audit intent gửi hoặc ghi Maximo. Preview không bảo đảm rằng
WO/quyền sẽ giữ nguyên đến lúc submit/send; mỗi bước phải kiểm tra lại.

Submit cần CSRF, phiên đăng nhập hợp lệ, đúng version, idempotency key và thành viên
không trùng. Cùng key/cùng nội dung trả cùng batch; cùng key/khác nội dung bị từ chối.
Những WO đang pending/sending/unknown không được tạo attempt cạnh tranh trong app.
Khóa nội bộ không bảo vệ trước người sửa trực tiếp trên Maximo: cần conditional write.

Audit phải lưu nguồn draft/version/member và snapshot before/changes trước gửi.
Nguồn vẫn truy vết được sau khi nháp bị xóa. State + audit intent commit xong mới
được chuyển quyền điều khiển sang transport; lỗi DB trước intent không được gửi.

## Kết quả và phục hồi

- `pending`: đã lưu batch, chưa gửi.
- `sending`: intent đã commit, có thể đang ghi upstream.
- `confirmed`: read-back khớp các trường đã gửi sau normalization đã chốt.
- `failed`: đã xác định không ghi thành công; không suy từ timeout sau gửi.
- `conflict`: baseline/revision hoặc conditional precondition không còn phù hợp.
- `unknown`: có thể đã ghi nhưng chưa đủ bằng chứng xác nhận.

Batch tổng hợp kết quả từng dòng; một dòng confirmed không làm cả batch thành công.
Timeout/mất mạng sau send, read-back không khớp hoặc không đọc được, và DB mất kết
quả sau upstream write cần đối soát. Không tự resend unknown. Recovery sending cũ
chỉ chạy sau khi xác nhận worker cũ không còn quyền sở hữu; mốc này chưa bật worker.

Theo quyết định retention, receipts/upload/audit không purge theo tuổi. Finalizer
chỉ được xóa nháp nếu toàn bộ thành viên của đúng phiên bản nguồn đã confirmed và
nháp không bị chỉnh sửa tiếp. Partial selection, partial success, conflict, unknown
hoặc nháp mới hơn phải giữ. Không đánh đồng HTTP success với read-back confirmed.

## Hợp đồng API của mốc đầu

Các POST yêu cầu cookie phiên và `X-CSRF-Token`; responses dùng `Cache-Control:
no-store`. Không nhận connection/discipline/actor/payload ghi tùy ý từ client.

| Endpoint | Request | Vai trò |
| --- | --- | --- |
| `POST /api/drafts/{draft_id}/upload-preview` | `version`, `items: [{site_id, workorder_id}]` | Preview đúng nháp/version, 1–200 thành viên không trùng; đọc lại upstream và quyền |
| `POST /api/drafts/{draft_id}/uploads` | Thêm `request_id` UUID và `preview_hash` SHA-256 | Cổng submit; mốc đầu trả 409 `write_contract_unverified`, không tạo batch hoặc gọi writer |
| `GET /api/uploads/{batch_id}` | Batch UUID | Trạng thái batch thuộc actor; kiểm tra lại scope và discipline hiện tại trước trả |

Preview hash ràng buộc nội dung preview; không phải quyền truy cập, upstream revision
hoặc bằng chứng có conditional write. `send_enabled: false` giúp client diễn đạt
trạng thái hiện tại; việc giữ cổng đóng do backend quyết định.

Preview trả `draft_id`, `version`, `preview_hash`, `send_enabled`, `gate` và từng
thành viên với `site_id`, `workorder_id`, `code`, `before` của trường thay đổi cùng
`changes`. Trạng thái batch trả counts theo state và từng item có identity,
`updated_at`, source draft/version/member; không trả cached before/changes.

Schema upload/audit đã có. Source draft UUID/version/member và before/changes được
ghi trong audit `prepared` append-only để giữ nguồn sau khi nháp bị xóa; không cần
foreign key đến nháp còn tồn tại. Audit còn giữ hash toàn bộ thành viên nháp và cờ
full selection. Finalizer nội bộ kiểm tra version/hash/full selection/all confirmed
và read-back hiện tại, ghi `source_finalized` cùng transaction xóa nháp. Chưa nối
finalizer vào endpoint hoặc worker; không tự xóa nháp trong ứng dụng ở mốc này.
Orchestrator mốc đầu là dịch vụ nội bộ được test với transport giả, không phải
endpoint cho client bỏ qua cổng write contract.

## Điều kiện chuyển sang sender thật

Theo [write contract](maximo-write-contract.md), phải kiểm chứng riêng từng connection:

1. Exact resource identity/origin và token của single-resource GET; method/headers,
   fields, date/null/PIC/duration và representation được chốt.
2. Mutation với token hiện tại thành công, read-back đúng và token tiến lên; token
   cũ bị từ chối mà không đổi dữ liệu; hai request cùng revision không cùng ghi đè.
3. Mỗi mutation, kể cả restore, có authenticated actor và durable intent; lỗi/
   timeout xử lý theo kết quả thật, không fallback unconditional.

GET hiện có ETag `0` chưa đáp ứng các điều kiện này; rowstamp và hash nháp không
tự động trở thành If-Match. Cần chủ dự án/IT chốt field/value được đổi, cửa sổ thử,
người tạo conflict độc lập và người khôi phục. WO CM được chọn trong probe GET
chỉ là ứng viên; không tự xem việc chọn WO là đã chốt mọi mutation.

Tests với transport giả không chứng minh write contract, tenant policy, vận hành
runtime DB/staging, độ bền crash thực tế hoặc UAT. UI tiến độ/lịch sử và E2E
upload thật là các phần tiếp theo sau API và hợp đồng ghi.

## Bằng chứng kiểm tra mốc đầu

Ngày 2026-10-08: 38 tests P7 (9 fast, 29 PostgreSQL) và full backend 406 tests qua;
Ruff lint/format qua. Một review Sol/high không có P1/critical; P2 status bị phụ
thuộc scheduling eligibility/crew đã sửa và Main kiểm tra regression. Status vẫn
đọc được khi WO đóng hoặc crew lỗi, nhưng current scope/discipline phải hợp lệ.

Các ca concurrency/intent visibility dùng connection độc lập và commit thật trong
UUID schema tạm trên DB synthetic đã guard; dùng model constraints và audit trigger
append-only hiện có, cleanup schema sau test. Không gọi Maximo/Entra thật. Test khác
dùng rollback/savepoints để giữ DB test sạch; cancellation/recovery là mô phỏng,
không phải crash process/worker hoặc mất điện thực tế.

Lệnh full suite từ backend (cần quyền Windows temp ACL và Docker cho tests vận hành
đã có; `.env.integration` theo [runbook DB](database-tests.md)):

```powershell
uv --cache-dir .uv-cache run --no-sync pytest --run-db-tests -p no:cacheprovider --basetemp .cache/p7-final-pytest --tb=short
```

Không thêm dependency hoặc migration; schema hiện tại đủ cho mốc này. Retry tạo
attempt mới và liên kết attempts, correlation logs, worker ownership/lease và
history before/after API/UI chưa được triển khai ở mốc đầu.
