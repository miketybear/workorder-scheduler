# TODO — Work Order Scheduler

Cập nhật: 2026-10-29. Chỉ chứa việc **còn mở**. Việc xong thì xóa khỏi đây và ghi một mục có ngày,
phạm vi và bằng chứng ở đầu [changelog.md](changelog.md). Số dòng `(Lxxxx)` trỏ tới ngữ cảnh trong [todos-archive-2026-10-29.md](todos-archive-2026-10-29.md).

Mỗi mục ghi đang chờ ai: `[sẵn sàng]`, `[chủ dự án]`, `[IT]`, `[Maximo admin]`, `[sự kiện thật]`.

## 1. Làm được ngay

- [ ] Ctrl+D điền xuống thiếu cột nếu chưa Enter ô đang sửa (agy báo, chưa tái hiện) — `WorkOrders.tsx`. (L67)
- [ ] Biên nhận rota còn hiện lý do "Import is cancelled or already activated" khi không kích hoạt lại được; cần thông báo rõ. (L1524)
- [ ] Hiệu năng `assignment-timeline` B2: song song hóa có giới hạn các lần đọc WO/PERSON, giữ thứ tự kiểm tra quyền, không cache số tải. (L204)
- [ ] Tiến độ có số giây cho lần tải nguội (~15–30 giây) và đo lần tải nguội (cần xóa cache backend/Maximo). (L210, L551, L561)
- [ ] Endpoint gộp tóm tắt task cho backlog Resource timeline (backend). (L551)
- [ ] Ổn định test PoC synthetic timeout nếu còn tái diễn trong full suite. (L1258)
- [ ] Nghiệm thu keyboard-only toàn ứng dụng, screen reader/zoom/high contrast và trình duyệt khác. (L2458)
- [ ] Đánh giá security patch dependency/runtime, scan image, SBOM và chính sách refresh digest. (L2223)
- [ ] Log có correlation ID (liên kết request hash, retry attempt và log); theo dõi lỗi upstream, upload unknown và dung lượng DB. (L2610)
- [ ] Runbook deploy/update/rollback, xoay credential và xử lý upload chưa rõ kết quả. (L2611)
- [ ] Worker/lease và phục hồi tự động khi backend crash giữa lúc gửi Maximo; hiện chỉ có đối soát đọc. (L2268, L3701)

- [ ] Đối chiếu metadata `lochierarchy.systemid` và thêm fixtures đã redaction từ response live Onshore test. (L2183, L2203, L2205)

### Tính năng P1 còn lại của workbook

- [ ] Scheduled WO: lọc theo schedule, status và scope. (L2626)
- [ ] Summary of Crew Worksheet: tổng hợp theo người trong phạm vi được phép. (L2628)
- [ ] Lịch sử upload/audit (Phase 2): màn hình/API, filter/paging, before/after đúng scope. (L2550, L2382)
- [ ] Đánh giá lịch/Gantt nếu planner cần. (L2632)

### Kiểm thử còn thiếu (synthetic, không cần Maximo thật)

- [ ] Cùng WONUM/workorderid ở hai connection và nhiều site. (L2566)
- [ ] Hai planner sửa cùng WO; người sửa trực tiếp trên Maximo giữa preview và gửi. (L2568)
- [ ] Mixed batch, timeout trước/sau gửi, submit lặp và restart recovery. (L2570)

## 2. Chờ chủ dự án

- [ ] `[chủ dự án]` Chốt định nghĩa compliance trước khi tái tạo chỉ số Excel. (L2630)
- [ ] `[chủ dự án]` Quy trình cập nhật Target hàng loạt cho WO lớn vượt Target Finish theo quy tắc ca. (L314)
- [ ] `[chủ dự án]` Duyệt thử ghi rồi khôi phục `schedfinish` nhiều ngày cho CM trên Maximo test. (L312)
- [ ] `[chủ dự án]` Quy tắc chia ngày cho planned nhiều giờ/quantity>1 (ví dụ 70h/quantity 3). (L1325)
- [ ] `[chủ dự án]` Chốt giờ mặc định, cho phép xóa ngày/PIC thành null, độ chính xác duration. (L2197)
- [ ] `[chủ dự án]` Tài khoản, quyền và WO/roster mẫu cho các discipline khác (MECH/RES/DECK/PROD/DNC). (L1328, L2379)
- [ ] `[chủ dự án]` Chốt bảng mã rota (đặc biệt F/AF), mapping position còn lại, craft alias, P&P/PROD. (L1968, L1946)
- [ ] `[chủ dự án]` Bật required checks/branch protection trên GitHub nếu muốn. (L3404)
- [ ] `[chủ dự án]` Nghiệm thu UX timeline: chọn WO/người/ngày/giờ, ngữ nghĩa PIC vs assignment thực. (L1900, L2008)
- [ ] `[chủ dự án]` Upload từng loại WO non-CM trên trình duyệt trước khi mở gate. (L3727)
- [ ] `[chủ dự án]` Đối chiếu kết quả web với VBA trên cùng WO test. (L2421, L2578)
- Đã quyết hoãn: tách logic ghi ResourceTimeline sang hook (2026-10-29; quy trình khi cần ở changelog L601).
- Hoãn: chuyển editor 1 WO sang drawer. (L620)

## 3. Chờ IT / hạ tầng

- [ ] `[IT]` Ubuntu staging: routing tới Maximo, DNS/TLS/CA nội bộ, HTTPS ingress, Entra redirect. (L2176, L2592, L2601)
- [ ] `[IT]` Tách cấu hình/secret test và production; secret manager. (L2603, L3498)
- [ ] `[IT]` DB roles/DSN tách biệt trên staging, backup RPO/RTO/offsite/encryption và diễn tập restore. (L2274, L2608, L3563)
- [ ] `[IT]` Entra: nhóm được đăng nhập, single-tenant/assignment, MFA/Conditional Access, blocked account, logout URI. (L2361–L2367)
- [ ] `[IT]` Tài khoản tích hợp riêng, chủ sở hữu key, quyền tối thiểu, vòng đời key. (L2179, L2612)
- [ ] `[IT]` API key route cho MECHSUP, FIELDPRODSUP và các position còn lại. (L237)
- [ ] `[IT]` Retention/cleanup cho draft_submission và nháp. (L2708)
- [ ] `[IT]` Duyệt operator/bootstrap workflow trên staging. (L2377)
- [ ] `[IT]` UI cấu hình connection/identity ngoài Onshore E&I khi có connection thứ hai. (L2404)
- [ ] `[IT]` Offshore: URL/object structure test, kiểm chứng riêng, không suy từ Onshore. (L2171)
- [ ] Sau staging: nghiệm thu 10 planner với SLO, E2E đầy đủ tới history, bàn giao hướng dẫn, rồi mới chốt production. (L2437, L2572, L2576, L2614, L2617)

## 4. Chờ Maximo admin

- [ ] `[Maximo admin]` Sửa 14 dòng LABOR/craft trên Test, rồi refresh snapshot và nghiệm thu activation rota dữ liệu thật. (L1683, L1711)
- [ ] `[Maximo admin]` Contract tạo/tách/xóa assignment và rollback giữ identity; đến lúc đó upload nhiều ngày vẫn khóa. (L1279, L1358)
- [ ] `[Maximo admin]` Khởi động lại workflow BD_WO cho 2 WO test dở dang. (L227)

## 5. Chờ sự kiện thật (kiểm tra live khi xảy ra)

- [ ] Chip `upload_pending` và thông báo 409 khi có ca thật; không tạo giả. (L23)
- [ ] Ảnh Entra: tài khoản không có ảnh hiện chữ cái đầu; ảnh đổi khi đăng nhập người khác (cần tài khoản thứ hai). (L37)
- [ ] Hai Planner thật cùng làm: notice/reload, conflict, snapshot hết hạn, WO nhiều discipline. (L1145)
- [ ] Lưu batch nhiều task trên UI theo lịch Planner thực tế; pool/rota hợp lệ biên 6h+4,5h. (L1169, L1605)
- [ ] Crew/PIC và child paging lớn ở discipline khác/Offshore. (L2193, L2419, L2687)
