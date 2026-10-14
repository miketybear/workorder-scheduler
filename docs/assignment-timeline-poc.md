# PoC monthly assignment timeline

Ngày: 2026-10-11. Route: `/assignment-demo`. Xem
[kiến trúc và policy rota](assignment-resource-timeline.md) để phân biệt PoC với
thiết kế dịch vụ reservation và actual assignment Maximo.

## Phạm vi

PoC dùng React/TypeScript, native HTML table/form và CSS Modules, không thêm
timeline dependency. Dữ liệu nhân sự và WO hoàn toàn giả lập, không sao chép tên,
identity hay lịch cá nhân từ workbook. Số lượng theo phân tích mẫu:87source rows,
87resources gồm61TECH,16SUP/ASST_SUP,8Control RM Engineer (P&P) và
2Material Controller (MECH),5craft,200synthetic WOs theo policy mới nhất.

TECH, SUP và Assistant SUP nằm trong mục riêng của từng craft. SUP/Assistant SUP
có budget theo ngày giống TECH để planner chọn hỗ trợ khi thiếu người. Bỏ qua
blank; Control RM Engineer/Material Controller có mục riêng và capacity theo
rota trong craft tương ứng. Một người/ngày có tối
đa630phút, cộng tải xuyên WO/site/connection trong synthetic pool.

PoC phân bổ labor-hours nội bộ, không thay PIC, estdur, target/status hoặc các
trường WO. Không có server persistence, upload/import file, grant policy, current
upstream recheck hoặc Maximo LABOR reader. Khi triển khai reader chỉ đưa vào
pool labor đã map đúng người trong rota, không auto-enroll theo status ACTIVE. Synthetic remaining chỉ tính tải trong
PoC. Rota giả minh họa working/off/blank; không đại diện ca thật hoặc xác định
hai công việc có trùng giờ trong ca hay không.

Nháp giữ trong React memory khi đổi tháng/filter hoặc đi sang route khác rồi
quay lại; reload hoặc đóng tab mất nháp. Route giả lập không yêu cầu đăng nhập;
không cấp quyền WO thật. API `/work-orders` và upload hiện có giữ nguyên policy.

## Cách chạy và nghiệm thu

Từ thư mục frontend chạy `npm run dev`, mở `/assignment-demo` trên địa chỉ Vite
đang phục vụ. Chạy riêng PoC không cần backend; shell ứng dụng vẫn có các panel
phiên/quyền hiện có và chúng có thể kiểm tra API khi truy cập trang nghiệp vụ.

1. Chọn tháng11/2026, kiểm tra5craft và TECH/SUP/Assistant SUP trong mỗi craft.
   Thu gọn role để xem tổng quan; cuộn ngang giữ cột người và header ngày.
2. Chọn WO, người cùng craft, ngày working và nhập giờ. Thử6h cộng4.5h trên cùng
   người/ngày ở hai WO; tổng phải10.5h. Thử thêm giờ hoặc6h cộng5h phải bị chặn.
3. Chọn SUP/Assistant SUP cùng craft để hỗ trợ. Kiểm tra load nhóm hỗ trợ và
   tổng craft; không cộng giờ người đó vào TECH lần nữa.
4. Thử off/blank, craft mismatch, zero/negative/fractional-minute hours. Khi
   thay đổi không hợp lệ, allocation đã có phải giữ nguyên.
5. Sửa/chuyển/xóa allocation, xem preview và undo/reset. Đổi tháng/filter rồi
   quay lại phải giữ allocations ngoài cửa sổ tháng và tính đúng load hiện tại.
6. Chuyển sang Settings rồi quay lại timeline, kiểm tra month/nháp còn nguyên.
   Hai WO có cùng WONUM ở site/connection khác phải có identity và load riêng.

## Giới hạn nghiệm thu

Model thuần client kiểm tra tổng minutes, identity và atomic edit trong một
workspace. Điều này không chứng minh khả năng chống race giữa hai planner,
idempotency server, import activation, revoke grants hay tải Maximo bên ngoài.
Các chức năng đó cần API/database tests khi triển khai dịch vụ reservation.

Native table là baseline PoC trước benchmark/chọn thư viện; chưa kết luận
FullCalendar/Bryntum cần hay không, chưa mua license. Browser QA xác minh layout
và thao tác mẫu; không thay representative performance benchmark hoặc Ubuntu
staging/10-browser acceptance.

## Kiểm chứng — 2026-10-11

- Policy mới:87synthetic resources, Control RM Engineer→P&P8 và Material
  Controller→MECH2 có role riêng. Targeted timeline/App suite4files/15tests qua,
  typecheck/lint qua. Model regression xác minh hai role được phân công cùng
  craft, budget630phút và chặn phút thứ631. Rota-to-LABOR inclusion gate mới
  là contract kiến trúc, chưa có importer/backend reader thực hiện gate này.
- Frontend full suite:21test files,233tests qua; lint, TypeScript và production
  build qua. Model/UI tests kiểm tra630phút,6h+4.5h/6h+5h, SUP/ASST_SUP,
  multisite shared budget, blank/off/absent roster, invalid dates/minutes/craft,
  seeded allocation validity, duplicate IDs, leap years và atomic day move.
- Preview test nhận diện chuyển tháng dù tổng giờ không đổi. UI regression
  kiểm tra decimal1.15giờ, một phút không bị native-input underflow, undo/reset
  và reset thoát edit mode. App route test
  kiểm tra Settings → timeline giữ tháng đã chọn.
- Main browser QA qua IAB local Vite:5craft render, lọc E&I, riêng TECH/SUP/
  Assistant SUP; SUP4h sau đó sửa3.5h và Assistant SUP1h trên working Sunday;
  thêm2h vào TECH đã có9h bị chặn, dữ liệu9h còn nguyên; xóa/undo Assistant SUP
  khôi phục1h; month keyboard chuyển December31ngày rồi quay November giữ load.
  Sticky table/header và allocation edit/delete buttons đã xem trên screenshot.
- Vite local phục vụ PoC tại127.0.0.1:5174 trong phiên thực hiện. Đường dẫn thử
  là `/assignment-demo`; không coi localhost dev server là deployment. Không
  cần backend để thao tác synthetic timeline, không gọi LABOR/ASSIGNMENT Maximo.

Chưa có kéo thả/resize, auto split nhiều ngày, import staging hoặc save server.
Chưa benchmark performance đại diện, verify mọi viewport/theme hoặc server
race/revision/authorization. Các mục này tiếp tục theo backlog, không đóng bởi
233frontend tests hoặc kiểm tra thao tác mẫu trong một browser.
