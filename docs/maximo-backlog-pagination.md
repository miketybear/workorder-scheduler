# Phân trang Backlog và cache metadata Maximo

Cập nhật: 2026-10-13. Áp dụng Resource timeline; bảng Work Orders giữ API hiện có.

Backend lấy đầy đủ metadata WO theo kết nối, discipline và khoảng ngày rồi giữ
bản chụp trong bộ nhớ 120 giây. Tìm WO/site/mô tả và lọc Backlog/Completed trên
bản chụp này, trả tối đa 20 WO mỗi trang với tổng kết quả chính xác của bản chụp.
Browser chỉ giữ trang hiện tại và WO đang chọn. Task/assignment tải riêng khi cần;
không tải task của toàn tháng để dựng danh sách.

`GET /api/work-orders/page` nhận connection_id, discipline, target_from,
target_before, view, search, cursor; `refresh=true` chỉ dùng khi không có cursor.
Phản hồi gồm items/count, page_size=20, total_count, has_more/next_cursor,
view/search, filter_revision, snapshot_id và expires_at. Trang có Sau luôn đủ20WO.
Ưu tiên giảm dần, sau đó site và workorderid để thứ tự ổn định.

## Cache, tìm kiếm và làm mới

Cache dùng chung trong một process theo kết nối/cấu hình/discipline/ngày, không
chứa quyền người dùng. Các request đồng thời cùng phạm vi dùng chung một lần
lấy metadata. Mặc định tối đa8entry, tổng20.000row/32MiB; giới hạn reader Maximo,
byte và deadline vẫn áp dụng. Restart process xóa cache; nhiều worker có cache riêng.
TTL hết hạn hoặc nút Làm mới timeline dựng bản chụp mới. Search/đổi trang/view
không ép tải lại toàn bộ metadata. Làm mới rõ ràng cũng tải lại roster theo UI hiện có.

Mỗi request kiểm tra quyền/cấu hình và mỗi trang trả về kiểm tra lại phạm vi
20WO bằng một truy vấn Maximo nhỏ, kể cả lần đầu dựng snapshot. Đây vẫn là
network read; không khẳng định đổi trang hoàn toàn không gọi Maximo. Guard thất
bại loại bỏ đúng thế hệ cache và không trả dữ liệu ngoài nhóm. Cursor gắn user,
query, membership và thế hệ snapshot; cursor hết hạn/đổi thế hệ trả409 để UI về
trang đầu. Cursor không phải bằng chứng cấp quyền.401/403/404 xóa workspace.

Completed dùng task snapshot còn TTL và ledger theo connection/site/WO/discipline,
mọi ngày/pool. Thiếu/hết hạn/hỗn hợp discipline vẫn Backlog, không suy từ estdur.
Tổng là số WO khớp trong metadata snapshot và index Completed hiện tại, không
phải số Maximo WO đã hoàn tất trạng thái nghiệp vụ.

## Tính mới và giới hạn

Onshore Test không hỗ trợ OR/NOT composite query đã thử, nên search trên backend
tránh quét lại các trang Maximo cho mỗi lần gõ. Lần dựng cache vẫn theo nextPage
nguồn và kiểm tra totalCount nếu Maximo cung cấp: từ chối count sai/đổi giữa lượt,
thiếu nextPage khi chưa đủ count, trùng WO hoặc link khác phạm vi. Không công bố
snapshot thiếu dữ liệu là danh sách đầy đủ.

Maximo không có atomic snapshot đã xác minh cho lượt đọc nhiều trang. Metadata
mô tả/priority có thể cũ tối đa TTL; guard chỉ xác minh phạm vi của trang được trả.
WO mới hoặc vừa chuyển nhóm có thể cần Làm mới để xuất hiện. Quyền được recheck
mỗi lượt; thao tác ghi vẫn đọc kiểm tra dữ liệu hiện tại độc lập với cache.

## Kiểm chứng

- 119tests backend liên quan, gồm PostgreSQL quyền/revocation và count/cache/cursor.
  Ruff đạt. Review độc lập phát hiện guard trang đầu và count thiếu; đã sửa,
  recheck P1 đạt, gồm race không xóa thế hệ cache thay thế.
- 366tests frontend;92API/timeline; typecheck/lint/build đạt. Build còn warning
  chunk553,80kB đã có từ trước.
- Live Onshore Test: trang1–4 đều20WO/tổng117. H14307245 lấy từ trang4 được
  search toàn snapshot trả1/1 và không có Sau. Scope guard IN được hệ thống nhận.
  Không lưu phân công hoặc ghi Maximo trong nghiệm thu.
- Synthetic tests kiểm tra singleflight/TTL/refresh, search ngoài60WO và không
  reload roster khi đổi trang. Chưa đo tải thực tế nhiều worker hoặc tháng lớn.

[Ảnh tìm kiếm toàn danh sách](evidence/metadata-snapshot-2026-10-13.png).

Đo tải hai phiên API ngày13/10 đã hoàn tất:166WO Maximo thật và5.000WO giả lập,
shared cache/request budgets đạt. [Số đo và giới hạn](metadata-cache-load-verification.md).
