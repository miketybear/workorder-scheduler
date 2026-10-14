# Preview rota trước khi kích hoạt

Ngày: 2026-10-11. Route thử nghiệm: `/rota-staging-demo`.

Luồng upload và lưu dữ liệu thật đã có riêng tại `/rota-imports`:
[hướng dẫn staging thật](rota-live-staging.md). Tài liệu này mô tả prototype.
Liên quan: [kiến trúc timeline](assignment-resource-timeline.md),
[PoC timeline](assignment-timeline-poc.md).

## Phạm vi bước này

Màn hình tương tác mô phỏng staging để kiểm tra quy trình planner đã đồng ý:
đọc nguồn → đối chiếu LABOR → sửa mapping → xem lỗi/diff → hủy hoặc kích hoạt.
Chỉ dùng tên, mã labor và lịch giả lập; không sao chép dữ liệu cá nhân từ rota.
Chọn mẫu kiểm tra thay cho upload file thật. Không có request LABOR, parser
Excel/ODS, lưu PostgreSQL hoặc thay đổi Maximo trong màn hình này.

Phiên bản đang dùng trong màn hình preview là mẫu trong bộ nhớ riêng; thao tác
kích hoạt không đổi roster của `/assignment-demo`. Khi reload, cả staged revision
và simulated active revision trở về mẫu. Phần upload/lưu DB/kích hoạt thật cần
backend và contract quyền resource pool riêng, không dùng route demo để cấp quyền.

## Planner kiểm tra gì

- Nguồn: tên file mẫu, sheet, revision và coverage. Craft, chức danh, tên và
  mã ngày chỉ đọc, cùng row/cell provenance để tìm lỗi trong file nguồn.
- Mapping: người trong rota → LABOR theo connection/org/laborcode. Có thể chọn
  lại candidate cho người đó; tên normalize dùng tìm ứng viên, không làm khóa.
- Lỗi: không có candidate, ambiguous/duplicate binding, inactive hoặc craft
  không phù hợp; lỗi ngày/mã/chức danh cần sửa nguồn rồi upload lại.
- Thay đổi: người thêm/bỏ và thay đổi craft/chức danh/capacity theo ngày trong
  coverage, so với revision đang dùng; mapping-only changes cũng xuất hiện.
  Giao diện hiển thị ô trống =0giờ, working =10,5giờ; summary và diff dùng giờ. Sample dùng person ID giả ổn định cho diff,
  tên chỉ dùng tìm candidate; số dòng Excel không phải identity.

LABOR không có tên tương ứng trong rota chỉ xuất hiện ở danh sách loại khỏi pool,
không được chọn để bổ sung nhân sự ngoài rota dù ACTIVE. Người rota chưa match
được LABOR vẫn ở staging, chưa có allocation được kích hoạt.

Control RM Engineer thuộc P&P, Material Controller thuộc MECH; giữ chức danh
riêng và tính capacity theo rota. TECH/SUP/ASST_SUP vẫn được tính theo policy.
Nhiều rate rows cùng default craft cần gộp theo craft, không đếm đôi người.

## Các hành động

1. **Chọn mapping:** chỉ sửa liên kết LABOR, không sửa nguồn. Kết quả kiểm tra
   và diff được tính lại, không ảnh hưởng phiên bản đang dùng.
2. **Upload lại mẫu:** mô phỏng file đã sửa. Mapping phải được đối chiếu lại;
   không giữ binding cũ nếu identity/craft/candidate không còn phù hợp.
3. **Hủy import:** bỏ staged preview, giữ phiên bản đang dùng.
4. **Xác nhận và kích hoạt mô phỏng:** chỉ cho phép khi lỗi chặn đã được xử lý.
   Nếu có người bị bỏ, tổng capacity giảm hoặc mapping hiện hành thay đổi,
   planner đánh dấu đã xem diff. Đổi mapping làm xác nhận trước hết hiệu lực.
   Hiển thị trạng thái rõ đây là thay đổi trong bộ nhớ, không phải lưu DB hay
   cập nhật Maximo.

## Ranh giới backend khi triển khai thật

Backend nhận file giới hạn kích thước/coverage, parse ngoài event loop và lưu
raw source/provenance bất biến theo revision. Chỉ lưu field cần thiết cho rota;
không đọc passport/DOB/training. LABOR đọc từ configured connection, giới hạn
response/paging và fail closed với link khác trusted origin.

Mỗi sửa mapping có actor/version; server xác minh labor thuộc candidate set
và pool/connection được phép, không tin danh sách lỗi/capacity do client gửi.
Kích hoạt cần transaction/version check, revalidation, audit và kiểm tra các
reservation bị giảm capacity. Lịch hiện hành không đổi nếu activation thất bại.
Mapping hoặc staged revision không tự tạo access grant WO và không ghi Maximo.

Không tự áp dụng full replacement vì file có đủ ngày; phạm vi thay thế phải
được khai báo và preview. Người bị bỏ khỏi coverage mới không bị xóa identity
hay lịch sử. Snapshot LABOR và rota ở thời điểm khác nhau không phải đọc atomic.

## Kiểm tra và giới hạn

Frontend23testfiles/246tests qua; lint/typecheck/production build qua. Có11tests
riêng staging cho candidate, Đ/diacritics, outside-rota exclusion, duplicate
binding, default-craft deduplication, known working/off/blank, invalid date/code,
stable-ID/person/day diff, cancel/reupload/activation và invalidated confirmation.
App route test kiểm tra Settings→Preview giữ staged selection.

Một review độc lập Sol/high cho milestone này phát hiện stale risk confirmation
và UI code capacity không khớp model; đã sửa, có regression test và main browser
QA. Không dùng lại Astra review kiến trúc cho review thường lệ này.

Browser IAB local: ambiguous mapping→chọn LABOR, outside LABOR không vào dropdown;
missing LABOR→Thử upload lại tạo preview mới; remap sau checkbox→kích hoạt bị chặn;
confirm→activate6mappings revisionR04 trong bộ nhớ; invalidsource NH4→blocked;
Cancel giữ revisionR04; Control RM Engineer/P&P và Material Controller/MECH render
đúng, code1=630/caseAL=0. Tab local được giữ để thử, không phải deployment.
[TODO](todos.md) ghi scope và dependency còn mở.

Model/UI demo tests không chứng minh authorization, DB transaction, parser ODS,
revoke grants, conflict giữa planners hoặc durability. Các yêu cầu đó còn mở
đến khi importer/backend và integration tests được triển khai.
