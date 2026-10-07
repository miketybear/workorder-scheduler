# Lập lịch và quản lý nháp

Cập nhật: 2026-10-07. Đã kiểm thử với HTTP Maximo giả và PostgreSQL 17 test;
đã xác minh Entra và đọc WO/PIC Onshore E&I local, chưa nghiệm thu UAT đầy đủ.
Nháp một hoặc nhiều WO được hỗ trợ, tối đa 200 WO mỗi nhóm; chưa ghi Maximo.

## Sử dụng `/work-orders`

1. Đăng nhập Entra; phạm vi tự nhận theo tài khoản. Chọn kết nối đã cấu hình trong Settings
   nếu tài khoản có nhiều kết nối, sau đó retrieve theo khoảng ngày.
2. Bấm số WO để mở phần lập lịch. Backend lấy lại detail/PIC và kiểm tra WO còn trong scope.
3. Chọn Scheduled Start bằng date/time picker, sửa PIC và Duration (giờ). Scheduled Finish
   chỉ đọc, tự tính từ Start + Duration khi đổi Start hoặc Duration, cả đơn lẻ và nhóm.
   Dùng giờ liên tục, chưa áp lịch ca/ngày làm việc. Mở WO hoặc chỉ sửa PIC không tự viết lại lịch gốc.
   Ngày serialize ISO có offset theo múi giờ kết nối (ẩn nhãn), không theo timezone trình duyệt.
   Chưa hỗ trợ xóa giá trị thành null.
4. Chọn ngày trên Target Start/Finish tự bật Change Target; PM/CFT luôn bị khóa.
   Bỏ chọn Change Target phục hồi target gốc.
5. Xem trường đã sửa và bảng trước/sau; Reset bỏ thay đổi về baseline đã mở.
6. Lưu nháp trên server. Dòng WO giữ marker phiên bản và giá trị kế hoạch sau khi đóng panel;
   bấm WO để mở, cập nhật hoặc xóa nháp của mình. WO có nhiều nháp yêu cầu chọn rõ kế hoạch.

Màn hình xem/sửa WO đơn lẻ nằm giữa viewport theo cả hai trục, rộng tối đa 1320px.
Chiều cao giới hạn theo màn hình, cuộn bên trong phần nội dung; header và nút hành động
luôn giữ trong panel. Các section thông tin WO, lịch/phân công, ngày mục tiêu và đối chiếu
giữ bố cục cạnh nhau trên desktop, thích ứng khi viewport hẹp.
Panel lập lịch nhóm căn giữa viewport theo cả hai trục, chiếm 95% chiều rộng và 95%
chiều cao màn hình ở mọi breakpoint; nội dung/bảng cuộn bên trong panel.
Trong bảng nhóm, Thông tin bổ sung mở thành hàng phụ ngang toàn bảng, chia ba nhóm:
Priority/Onshore PIC/% Complete, ngày mục tiêu và ngày thực tế. Không lặp lại thông tin
WO/công việc và các ô lịch/PIC/duration đã có trên dòng; discipline nằm ở header chung.
Chỉ một hàng thông tin mở mỗi lần; mở/đóng không retrieve lại hoặc bỏ chỉnh sửa.
Khi mở panel đơn lẻ/nhóm hoặc chọn nháp, khóa cuộn trang và bảng WO nền, giữ vị trí
cuộn của cả hai. Cuộn tại đầu/cuối panel không truyền xuống nền. Đóng panel, chuyển
route, ẩn nội dung vì xác minh quyền lỗi hoặc hết phiên sẽ gỡ khóa; giữ khoảng trống
scrollbar để tránh bảng/panel nhảy ngang khi mở/đóng.

Nháp được lưu trong PostgreSQL: `draft` lưu owner/connection/version, `draft_item` lưu định danh WO,
baseline và changes dạng JSONB. Đóng panel không gọi DELETE hoặc xóa bản ghi. Sửa chưa lưu
chỉ nằm trong RAM và có xác nhận trước khi bỏ. Bảng danh sách lấy dữ liệu Maximo; bấm số WO
mở baseline hiện tại nếu chưa có nháp; WO có nháp mở đúng draft_id để phục hồi đề xuất đã lưu.

Bảng giữ bảy cột nghiệp vụ. Marker Nháp/Nháp nhóm và phiên bản nằm dưới số WO;
lọc Nháp chọn tất cả/có/chưa có trên các WO đã tải. Schedule, Target, PIC và Duration
hiển thị kế hoạch được chọn với nhãn Nháp ở ô có changes; Status luôn từ Maximo.
Maximo baseline vẫn giữ riêng để đối chiếu. Nếu baseline đã đổi, bảng giữ giá trị Maximo
và hiện Cần đối chiếu; nếu có nhiều nháp mà chưa chọn, không tự lấy nháp mới nhất.
Mở nháp nhóm phục hồi toàn bộ nhóm gốc, kể cả khi chỉ bấm một thành viên.
Lập lịch nhóm trên WO đã có cùng nháp nhóm mở lại nhóm đó; trộn nháp cũ và WO chưa có nháp
yêu cầu mở kế hoạch cũ hoặc lọc Chưa có nháp trước khi tạo nhóm mới.

Nguồn WO → WO có nháp trong phạm vi dùng cùng bảng, không phụ thuộc khoảng ngày Retrieve.
Mỗi trang lấy tối đa 20 nháp và toàn bộ thành viên đã kiểm tra quyền hiện tại;
WO trùng identity được gộp thành một dòng với lựa chọn nháp. Không có khu vực Danh sách nháp riêng.
Hai nguồn giữ snapshot riêng trong RAM: bảng, bộ lọc, dòng chọn, lựa chọn nháp, thời điểm
lấy dữ liệu và query/trang. Chuyển Maximo → nháp → Maximo không xóa kết quả Retrieve
hoặc tải lại bảng; trở về nháp giữ trang đang xem. Cập nhật đọc lại đúng nguồn/query/trang.
Lưu/xóa nháp cập nhật cả snapshot đang ẩn. Đổi khoảng ngày chỉ hủy kết quả Maximo cho
khoảng cũ; nguồn nháp không phụ thuộc ngày và vẫn giữ. Khi chưa Retrieve, nguồn Maximo
hiện hướng dẫn chọn ngày/tải bảng. Đổi nguồn có xác nhận nếu phải bỏ sửa chưa lưu.
Hết phiên hoặc đổi identity/quyền/kết nối xóa cả hai snapshot; không phục hồi chéo phạm vi.

Grant read chỉ được xem; grant write mới được tạo/cập nhật/xóa. Maximo chưa nhận mutation.
API luôn kiểm tra owner, grants và discipline hiện tại; UI không thay thế phân quyền backend.

Workspace WO nằm trong RAM của ứng dụng, giữ component khi đi sang Settings/Tổng quan
hoặc dùng Back/Forward nội bộ: bảng, query, bộ lọc, dòng chọn, panel và phần sửa chưa lưu
vẫn giữ; vị trí cuộn được khôi phục. Đổi phạm vi, query Retrieve hoặc mở WO/nháp khác vẫn
hỏi trước khi bỏ sửa. Lưu hệ thống khác trong Settings hỏi xác nhận nếu có sửa chưa lưu.
Tải lại/đóng tab dùng beforeunload; F5 hoặc đóng ứng dụng mất nội dung chưa lưu trong RAM,
nháp đã lưu trên PostgreSQL không bị mất. Không lưu WO vào localStorage/sessionStorage.

Không có timer tải lại bảng. Khi tab thực sự trở lại visible hoặc route WO được mở lại,
chỉ xác minh session/quyền, gộp các yêu cầu đang chạy; window blur/focus không kích hoạt
request. Phiên/quyền giữ nguyên thì dùng bảng hiện có, không đọc lại detail/nháp/nhóm/list.
Không hủy request lưu đang chạy chỉ vì đổi tab. Trong lúc xác minh giữ snapshot đã được
cho phép trước đó; xác minh lỗi thì ẩn nội dung và cho Kiểm tra lại phiên, hết phiên hoặc
đổi identity/grants/connection thì xóa dữ liệu và phản hồi cũ.

Cập nhật lần cuối là thời điểm lấy đầy đủ bảng. Sau 5 phút chỉ hiện nhãn Dữ liệu có thể đã
thay đổi; nút Cập nhật xác minh quyền và đọc lại cùng query/page, giữ bộ lọc/dòng chọn còn
tồn tại. Panel giữ changes và đối chiếu lại baseline/PIC/phiên bản. Baseline hoặc phiên
bản mới hơn làm khóa lưu; dữ liệu mới không ghi đè edits. Lỗi upstream khi cập nhật giữ
snapshot đã xác minh và cho thử lại. Lưu/xóa nháp cập nhật marker đúng dòng, không retrieve
lại cả bảng. Backend luôn kiểm tra quyền/baseline/version trước thao tác ghi.

## Hợp đồng API

`GET /api/work-orders/detail` nhận connection_id, site_id, workorder_id, discipline;
trả item, baseline, baseline_token, allowed_pics và revision=null.

`POST /api/drafts` nhận các trường identity trên, changes, baseline_token và request_id (UUID).
`PUT /api/drafts/{draft_id}` nhận cùng payload và version (số nguyên dương).
Các mutation yêu cầu session và header X-CSRF-Token. changes theo allowlist ScheduleChanges;
target yêu cầu change_target=true, PM/CFT bị từ chối; PIC và thứ tự ngày được kiểm tra server-side.
Baseline lưu trong DB chỉ lấy từ reader server, không lấy nội dung baseline từ browser.

baseline_token là SHA-256 của identity, discipline, baseline và revision do server trả.
Nó dùng so sánh trạng thái lúc mở với trạng thái server đọc lại lúc lưu; không cấp quyền và
không phải ETag/If-Match của Maximo. Baseline khác hoặc version nháp cũ trả 409 và không lưu.
Cập nhật nháp không tự thay baseline cũ; nháp có baseline đã đổi phải được đối chiếu rồi tạo mới.
Kiểm tra này không khóa trạng thái Maximo giữa lúc đọc và lúc commit nháp.

request_id được lưu trong draft_submission, unique theo actor + request_id, cùng transaction
với thay đổi nháp. Gửi lại cùng payload trả cùng draft_id/version mà không tạo/cập nhật lần hai;
dùng cùng request_id cho payload khác trả 409. Quyền và upstream vẫn được kiểm tra khi gửi lại.
Biên nhận còn giữ sau khi xóa nháp; gửi lại request cũ không làm nháp đã xóa xuất hiện lại.
Hai yêu cầu cập nhật cùng version dùng khóa dòng PostgreSQL; chỉ một yêu cầu được cập nhật.

`GET /api/drafts?connection_id=...&discipline=...&offset=0` lấy tối đa 20 nháp của owner
mỗi trang, kiểm tra grants và WO hiện tại trước khi trả số WO/site. next_offset=null là hết trang.
Nháp không còn eligible/scope không được trả nội dung; lỗi upstream không trả dữ liệu cache.
Danh sách này không phải snapshot ổn định khi nháp được tạo/xóa giữa các lần lấy trang.

Thêm `include_items=true` để trả các WO/changes đã được kiểm tra cho nguồn bảng nháp;
response có connection_id/discipline và thời điểm updated_at của nháp. Nhóm có discipline khác
phạm vi đang chọn không được đưa vào trang này. Đây vẫn là bounded live restore cho từng nháp,
không phải cache lịch sử; monthly-load UAT và độ trễ của các trang nhiều nhóm còn cần xác minh.

`GET /api/work-orders` bổ sung markers theo owner + connection + discipline + site + WOID,
chỉ cho các WO trong kết quả Maximo vừa xác minh. Một SQL query lấy markers cho cả bảng;
không gọi detail/PIC riêng mỗi nháp. Marker chỉ chứa changes của WO đó, phiên bản,
updated_at, baseline_changed và loại đơn/nhóm; không trả identity hay tổng số thành viên nhóm.
Khi mở nhóm, restore hiện có kiểm tra lại toàn bộ thành viên. Dữ liệu Maximo trong response
không bị ghi đè bởi changes; việc trình bày kế hoạch nằm ở frontend và ghi nhãn rõ.

`GET /api/drafts/{draft_id}` trả version và items với baseline gốc, changes, current,
allowed_pics, baseline_changed, changes_valid_now, item và baseline_token hiện tại.
`DELETE /api/drafts/{draft_id}?version=...` kiểm tra owner, CSRF, write scope, WO hiện tại
và version trước xóa; thành công trả 204. Xóa lại nháp không tồn tại trả 404.

Xác nhận xóa nằm ngay trong panel, có nút Hủy xóa; không dùng hộp thoại native gây
blur/focus và kiểm tra phiên giữa thao tác. Xóa thành công đóng panel và bỏ marker của
đúng nháp, giữ bảng WO và bộ lọc. Khi xem nguồn WO có nháp, WO không còn nháp được bỏ
khỏi bảng. Nháp khác của cùng WO vẫn giữ nguyên.

404 của WO/nháp không phải bằng chứng mất đăng nhập. Khi kiểm tra lại panel mà tài nguyên
không còn khả dụng, đóng panel và đọc lại bảng có kiểm tra quyền; bỏ qua phản hồi panel
đã đóng hoặc thay thế. Lỗi quyền khi mở/lưu/xóa sẽ xóa nội dung WO cũ và kiểm tra lại
session server. Chỉ phản hồi session thực sự hết hạn mới hiện yêu cầu đăng nhập.

## Migration và kiểm chứng

Chạy `uv run alembic upgrade head` từ backend trước khi dùng API mới.
Readiness hiện yêu cầu schema `0007_connection_setting`; migration 0006 vẫn lưu quyền Planner.
Không thêm runtime dependency.
Retention/cleanup cho nháp và biên nhận cần được chốt trước vận hành lâu dài.

2026-10-01: 131 backend tests (97 fast + 34 PostgreSQL), 46 frontend tests,
Ruff lint/format, TypeScript, ESLint và Vite production build qua; Alembic upgrade/schema check qua.
Kiểm thử PostgreSQL đồng thời dùng transaction riêng đã xác minh duplicate create và version conflict.
Frontend tests dùng mock để kiểm tra CSRF/request serialization, lỗi lưu, hủy phản hồi cũ,
phiên/quyền đổi, ẩn/khôi phục edits và PM/CFT/ngày/PIC/duration; chưa thay thế browser E2E.

Panel nhóm đã có áp lịch/PIC/duration, sửa từng dòng, Undo và preview trước lưu.
Dán Excel theo 3 cột Start, PIC, Duration; Start dùng YYYY-MM-DDTHH:mm, Finish tự tính,
ô trống giữ nguyên. Bulk target edit chưa mở. Formula Finish thuộc UI; backend vẫn kiểm tra
ngày, duration và quyền nhưng chưa bắt buộc công thức này cho mọi API client.
2026-10-07: nhóm 100/200 WO synthetic đã qua UI tests, PostgreSQL atomic save/restore/update,
replay, lỗi baseline/PIC/version và thu hồi giữa I/O. Browser Chromium có phím/focus,
paste/Undo/preview/save/reopen; phiên bản conflict khóa lưu và giữ edits. Panel quản lý
vòng Tab, focus return và focus sau Save; route ẩn gỡ listener. Xem [bằng chứng](large-batch-keyboard-tests.md).
Không thêm dependency; browser API mocks chưa thay thế E2E policy với backend thật.

Revision/ETag, upload/audit/history, browser E2E rộng và kiểm thử khoảng 10 phiên
vẫn nằm trong [backlog](todos.md).
