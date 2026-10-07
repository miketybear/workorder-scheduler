# Settings hệ thống theo tài khoản

Cập nhật 2026-10-07. Trang `/settings` chọn kết nối Maximo đã cấu hình và được cấp quyền,
theo lựa chọn được chủ dự án xác nhận; không sửa trực tiếp URL tích hợp hoặc credential.

Màn hình WO không còn selector Hệ thống/Discipline. Một grant duy nhất dùng tự động.
Nếu tài khoản có nhiều kết nối, chọn một lần và bấm **Lưu hệ thống** trong Settings.
Các URL chỉ hiện tại đây; WO hiện nhãn hệ thống, môi trường và discipline đang dùng.

Migration `0007_connection_setting` tạo `user_connection_setting`, khóa theo `app_user.id`,
lưu connection ID trên PostgreSQL. Danh tính Entra vẫn được gắn qua tenant/object ID.
Preference dùng chung giữa các phiên đăng nhập của cùng tài khoản; không lưu vào browser
storage và không thay đổi permission Planner/PERSON. Một kết nối có nhiều discipline
không được chọn mặc định bằng thứ tự mảng; cần quản trị viên sửa quyền.

`GET /api/settings/connection` trả session, grants hiện tại, preference hợp lệ và các URL
đã đăng ký trong phạm vi đó. `PUT /api/settings/connection` chỉ nhận `connection_id`,
yêu cầu session và CSRF, đồng bộ PERSON/current grants rồi xác minh registry/TLS policy.
Không nhận user ID, discipline, URL, role hoặc host từ payload. Admin không có grant cũng
không được chọn kết nối cho WO. Hết quyền hoặc kết nối bị tắt thì preference không có hiệu lực.

`/api/auth/session` thêm `preferred_connection_id`. Frontend chỉ dùng preference khớp một
grant hiện tại; khi preference/grants/identity đổi, hủy yêu cầu cũ và xóa dữ liệu phạm vi trước.
Đi sang Settings giữ workspace và phần sửa nháp trong RAM; khi Lưu hệ thống khác mới hỏi
trước khi bỏ sửa chưa lưu. Settings kiểm tra lại khi tab trở về visible, không reset lựa
chọn đang sửa và không hủy save chỉ vì đổi tab; blur/focus không gọi lại dữ liệu.

Đã nâng migration trên DB ứng dụng local và DB test cô lập. 236 backend tests với PostgreSQL,
106 frontend tests, Ruff/lint/typecheck/build qua. Browser thật xác nhận lưu Onshore test / E&I,
mở lại Settings đọc preference rồi tải 3 WO có nháp qua phạm vi tự nhận. Không sửa nháp hoặc
ghi Maximo. Broader scopes/multiple live connections, monthly-load UAT và deployment Ubuntu
vẫn pending; kết quả nhiều kết nối hiện được kiểm tra bằng HTTP/PostgreSQL synthetic tests.
