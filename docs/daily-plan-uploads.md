# Đồng bộ kế hoạch phân công theo ngày

Cập nhật: 2026-10-14. Phạm vi API nền: từng kế hoạch của một task, trên kết nối
Maximo Test đã bật contract. [Luồng hàng loạt theo tháng](bulk-plan-uploads.md)
điều phối các kế hoạch này bằng một preview và một lần xác nhận.

Sau khi lưu phân bổ nội bộ, mở một phân công trên timeline và chọn **Xem trước
đồng bộ**. Preview hiển thị WO, task, người, ngày, giờ bắt đầu/kết thúc và tổng
giờ của toàn kế hoạch, kể cả các đoạn ngoài tháng đang xem. Chọn **Gửi kế hoạch
lên Maximo** để gửi sau khi kiểm tra preview. Preview hết hạn sau 120 giây;
**Chỉnh giờ / Tạo preview mới** tạo lại với dữ liệu hiện tại.

Ngày đầu cập nhật assignment nguồn; các ngày tiếp theo tạo assignment mới.
`assignment_id` nội bộ giữ ID nguồn, còn `remote_assignment_id` lưu ID Maximo
thực tế của từng đoạn. Chỉ ghi mapping khi đọc lại xác nhận duy nhất từng dòng
và các assignment có sẵn được bảo vệ không thay đổi. Tổng tải dùng mapping này
để tránh cộng hai lần giờ đã đồng bộ với giờ đọc từ Maximo.

Mỗi yêu cầu gửi có UUID và intent bền vững trước khi gọi Maximo. Mất phản hồi
hoặc kết quả không đầy đủ giữ trạng thái chưa rõ và khóa toàn kế hoạch. Nút
đối soát chỉ đọc Maximo, không gửi lại Add. Khi tải lại trang, API tìm biên nhận
của người đã gửi; người khác vẫn thấy kế hoạch bị khóa nhưng không nhận biên
nhận riêng của người gửi. Kế hoạch đã xác nhận đồng bộ không sửa/xóa qua editor
nội bộ. Lỗi trước khi gửi cho phép tạo preview mới; lỗi sau intent chỉ được mở
lại khi đọc xác minh toàn baseline chưa thay đổi.

API cùng origin, phân quyền theo connection/discipline/pool và kiểm tra quyền
Planner hiện tại; POST yêu cầu CSRF:

| Method | Route | Mục đích |
| --- | --- | --- |
| GET | `/api/assignment-plans/{id}/upload-preview?start_time=06:30` | Preview toàn kế hoạch |
| POST | `/api/assignment-plans/{id}/upload` | Gửi một lần với request UUID, plan version, preview token |
| GET | `/api/assignment-plans/{id}/upload-status` | Tìm biên nhận hiện tại sau tải lại |
| GET | `/api/assignment-plan-upload-submissions/{request_id}` | Tìm kết quả yêu cầu mất phản hồi |
| GET | `/api/assignment-plan-uploads/{attempt_id}` | Đọc biên nhận |
| POST | `/api/assignment-plan-uploads/{attempt_id}/reconcile` | Đối soát chỉ đọc |

Các response trên không được cache. Frontend cập nhật phân công và tải những
ngày liên quan; không tải lại toàn danh sách backlog sau gửi.

Migration `0015_daily_plan_uploads` bổ sung mapping, phiên bản/trạng thái plan,
preview và intent/receipt ledger. Runtime không được sửa intent hoặc xóa preview.
Mặc định contract tắt. Để bật Test cần đồng thời môi trường ứng dụng development/test,
kết nối Onshore Test, contract ghi assignment đã xác minh, contract đọc task load
và `assignment_daily_write_contract=native_daily_assignment_rowstamp_test`.

Giới hạn còn lại: chưa mở sửa/xóa assignment đã gửi, rollback tự động, gửi
nhiều task trong một request Maximo hoặc production. Conditional DELETE cần xác minh riêng; xem
[contract tạo dòng theo ngày](daily-assignment-contract.md).

Kiểm chứng tích hợp và cập nhật local được ghi tại [TODO](todos.md).

Ngày 15/10/2026, thẻ kế hoạch đã đồng bộ mở bảng chi tiết chỉ đọc thay cho
form sửa bị khóa. Bảng có WO/task, người/laborcode, site/kết nối, từng ngày,
giờ, Assignment ID và trạng thái. Giờ bắt đầu lấy từ assignment Maximo mới
đọc, khớp đúng task và ID mapping; kết thúc dự kiến tính từ giờ bắt đầu và
labor_hours, không phải finishdate lưu trên Maximo. Timestamp thiếu timezone
không được suy đoán giờ. Biên nhận đầy đủ bổ sung ngày ngoài tháng khi người
xem có quyền; thiếu biên nhận vẫn giữ trạng thái synced, báo độ phủ hiện có.
Các nút sửa/xóa/gửi lại không xuất hiện trong chi tiết confirmed; luồng đối
soát unknown giữ nguyên. [Bằng chứng UI](evidence/synced-details-ui-2026-10-15.json).

Trong ô timeline hẹp, thẻ chỉ giữ task, WONUM và số giờ; trạng thái đồng bộ
và kế hoạch nhiều ngày dùng biểu tượng với chú giải chung, không lặp câu
thông báo trên từng thẻ. Tooltip mô tả đầy đủ xuất hiện sau 2 giây hover,
hoặc ngay khi focus bằng bàn phím. Chọn tooltip thay chữ chạy ngang để mô
tả đứng yên, đọc trọn câu và không làm các thẻ chuyển động đồng thời.
Bấm thẻ vẫn mở chi tiết; đây cũng là cách xem trên thiết bị cảm ứng.

Xem trước đồng bộ khóa sửa/lưu để giữ nội dung preview nhất quán, nhưng
vẫn cho Hủy hoặc Esc đóng panel mà không xóa kế hoạch đã lưu. Muốn sửa/lưu
thì chọn Chỉnh giờ / Tạo preview mới để bỏ preview trước. Đang xử lý yêu cầu
hoặc kết quả upload chưa rõ vẫn khóa đóng và yêu cầu đối soát.
