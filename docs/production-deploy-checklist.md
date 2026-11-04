# Checklist Maximo trước khi deploy production

Ngày 2026-11-04 chủ dự án restore bản production sang Onshore test. Các sai lệch dưới đây đọc được ngay sau
restore, nên nhiều khả năng production cũng đang như vậy. Chúng chưa được đọc trực tiếp trên production.
Kiểm tra lại từng mục trên production trước khi mở app cho người dùng.

## Cấu hình Maximo cần có

- [ ] **Workflow `BD_WO`:** có đúng một revision active, và dòng role `WO ASS` ở node 34 không có điều kiện.
  - Trên bản restore: revision 26, điều kiện `:&APPNAME&='PLUSGWO'`. Bản đã nghiệm thu là revision 27, không có điều kiện.
  - Nếu sai: app khóa route và hiện chip "Workflow rev cũ, khóa route". Không nới kiểm tra trong app, vì điều kiện này làm WO mất assignment khi route qua REST ([workflow-route-design.md](workflow-route-design.md), mục 5.1).
- [ ] **Lựa chọn route:** node 20 có action 427 và node 40 có action 437, cùng ghi "Route to Tech PIC for execution". Revision mới có thể đổi các id này; nếu đổi thì cập nhật cấu hình `workflow_route`.
- [ ] **`PERSON.ct_discipline`:** mọi Planner đều có giá trị đúng.
  - Trên bản restore: `NHATNH` bị trống, `TRUNGNT` là E&I. Chủ dự án đã điền lại cho `NHATNH` trên test.
  - Nếu trống: đăng nhập vẫn thành công nhưng /settings không có kết nối nào để chọn, và không có lỗi nào được báo.
- [ ] **Tài khoản PERSON:** mọi tài khoản cần dùng đều tồn tại và ACTIVE. Tài khoản chỉ tạo trên test sẽ không có.
  - Trên bản restore: không còn `eisupv`. Cần rà cả tài khoản vị trí dùng cho route.

## Dữ liệu của app

- [ ] Production dùng database riêng, không mang draft, phân công hay lịch sử upload của staging sang: các bản ghi đó trỏ tới dữ liệu Maximo trước restore.
- [ ] Cấp Planner permission cho từng người trên kết nối production. Quyền trên staging không có hiệu lực ở đó.

## Sau khi deploy

- [ ] Mỗi Planner đăng nhập, thấy đúng kết nối và discipline ở /settings.
- [ ] Màn route không hiện chip khóa.
- [ ] Theo dõi `authorization_event`: lần `person_grants` có `after` rỗng là dấu hiệu mất quyền. Lý do `person_lookup_unavailable` nghĩa là Maximo không đọc được, và quyền sẽ tự cấp lại khi Maximo chạy lại và PERSON còn discipline.
