# Thu thập thông tin tích hợp

Cập nhật: 2026-10-07. Onshore test đã xác minh GET WO/PERSON/crew E&I và nháp nội bộ
trên Windows local; write contract, scopes khác/Offshore và đường mạng Ubuntu còn pending.
Đối soát đầy đủ: [checklist 1–6](checklist-review.md). Các mốc theo ngày bên dưới là lịch sử.

## Thông tin tối thiểu để bắt đầu Maximo test

| Thông tin | Người cung cấp | Trạng thái |
|---|---|---|
| Host, context path, hệ thống và môi trường test | Chủ dự án | Onshore test: `http://bd-maxdev.biendongpoc.vn/maximo`; xác nhận ngày 2026-10-01 |
| OSLC object structure/API URL và quyền expose thực tế | IT/Maximo admin | GET oslcmxwodetail/mxpersongroup/mxperson Onshore E&I qua ngày 02/10; metadata đầy đủ/systemid và write contract chưa xác minh |
| Đầu mối cấp integration account/API key test; phương thức authentication | IT/Maximo admin | Key do chủ dự án nhập server-side; GET live thành công 02/10; account chuyên dụng/quyền tối thiểu/vòng đời key chưa đối chiếu IT |
| Kênh bàn giao secret và secret reference để cấu hình server | IT | Key local nằm trong .env ignore, DB có secret_reference; quy trình bàn giao/rotation và secret manager staging chưa chốt |
| Discipline codes, crew groups và PIC mapping | Maximo admin/planner | Có DECK/DNC/RES/MECH/PROD/E&I và mapping Onshore; live 25 PIC E&I_N qua 02/10; scope khác chưa kiểm chứng |
| Timezone nghiệp vụ, quy tắc giờ mặc định và khoảng lọc cuối ngày | Planner | Asia/Ho_Chi_Minh, offset và mốc cuối loại trừ đã dùng live; giờ mặc định/clear/null write semantics chưa chốt |
| Site, WOID và WONUM của WO test được chỉ định; loại CM/PM/CFT cần kiểm tra | Planner/Maximo admin | Chưa cung cấp |
| Quyền được cấp: đọc trước; WO nào được phép ghi và trường nào được thay đổi | Chủ dự án/Maximo admin | Read và Planner nháp Onshore E&I đã xác minh; chưa có WO/ủy quyền ghi Maximo test được chỉ định |
| Ubuntu test, routing, DNS, TLS và CA nội bộ | IT/chủ dự án | Chủ dự án xác nhận không cần VPN, server test chưa cài chứng chỉ; đường mạng từ Ubuntu chưa xác minh |

Onshore và Offshore là hai hệ thống độc lập. Ghi riêng URL, scope, account và kết quả
cho từng connection; test trên một hệ thống không chứng minh hệ thống còn lại tương thích.
Không lấy credential từ workbook; không gửi API key/client secret trong chat hoặc commit.

## Kiểm tra sơ bộ host — 2026-10-01

Kiểm tra không dùng credential, không theo redirect, chỉ DNS và HEAD đường dẫn gốc:

- DNS của bd-maxdev.biendongpoc.vn phân giải được trên máy Windows hiện tại.
- `http://bd-maxdev.biendongpoc.vn/` trả HTTP 403 cho HEAD.
- `https://bd-maxdev.biendongpoc.vn/` thất bại khi xác minh chứng chỉ TLS.

403 tại đường dẫn gốc không chứng minh OSLC API thiếu quyền hoặc credential sai;
chưa gửi credential hay gọi object structure. Lỗi TLS cần IT xác nhận URL HTTPS đúng,
chứng chỉ/chain và CA nội bộ. Chủ dự án xác nhận server test chưa cài chứng chỉ.
Chủ dự án đã chọn cho phép HTTP riêng cho test ngày 2026-10-01, sau khi được thông báo
API key không mã hóa khi truyền qua HTTP. Connector yêu cầu bật allow_http_for_test=true
cho entry registry và connection trong DB phải có environment=test. Cấu hình ứng dụng
production từ chối HTTP; HTTPS vẫn xác minh chứng chỉ. Chưa có credential test và chưa gửi
credential tới server thật. Chi tiết cấu hình trong [Maximo reader](maximo-reader.md).
Chưa cung cấp URL production và chưa có kiểm thử trên production.

## Entra và quyền người dùng

Thu thập tenant ID, client ID, hostname HTTPS của ứng dụng, callback URI đã đăng ký,
nhóm/người được đăng nhập và danh sách planner với tenant/object ID, connection, discipline,
capability read/write. Credential Entra được bàn giao riêng qua kênh quản lý secret.
Xem [Entra setup](entra-setup.md). Entra assignment không tự cấp quyền WO.

Entra login/callback local đã thành công; chủ dự án xác nhận logout/login lại đúng
ngày 2026-10-02. PERSON-derived read và scoped Planner Onshore E&I đã được cấp/kiểm chứng
sau đó cùng ngày. Phạm vi hiện đã xác minh:

| Phạm vi tài khoản kiểm thử | Trạng thái |
| --- | --- |
| Identity | Dùng tenant/object ID backend đã xác thực khi đăng nhập; không yêu cầu email làm khóa quyền |
| Connection | Chủ dự án chọn Onshore test (2026-10-02): `http://bd-maxdev.biendongpoc.vn/maximo` |
| Discipline | Nguồn `mxperson.ct_discipline`; chủ dự án điền E&I cho NHATNH, login lại hiển thị E&I; DB xác nhận grant read (2026-10-02) |
| Capability | Khởi đầu read; sau đó có Planner permission đúng Onshore/E&I intersect PERSON, đã thử cấp/thu hồi và nháp live ngày 02/10 |
| Cấp quyền | PERSON binding/grant và Planner permission có audit; không cấp admin hoặc remote upload |

API URL/key test/timezone và GET WO/PIC trong scope này đã xác minh; metadata đầy đủ,
scope khác và hợp đồng write vẫn cần kiểm chứng. Quyền write cho phép chỉnh sửa/lưu nháp theo API hiện có;
remote upload chưa triển khai.

Danh mục từ ảnh chủ dự án (cột Value dùng làm mã):

| Value | Description |
| --- | --- |
| DECK | Deck Foreman |
| DNC | Drilling and Completion |
| RES | Rotating Equipment Specialist |
| MECH | Mechanic |
| PROD | Production |
| E&I | Electric & Instrument |

Chủ dự án đã nhập key và bỏ comment `WOS_MAXIMO` trong backend `.env` (2026-10-02).
Settings validation xác nhận registry đúng URL test, key không rỗng, HTTP opt-in=true,
ứng dụng development và Entra vẫn cấu hình đầy đủ; không in key. Đã restart backend nạp registry.
UUID `aab45085-e84f-4273-82d2-960b1f26c3da` đã tạo trong DB local với audit,
thêm `person_login_domain=biendongpoc.vn`; xem [PERSON access](person-access.md).
Collection path `/oslc/os/oslcmxwodetail` đã GET live thành công; configured statuses
được dùng trong query nhưng domain từng mã chưa đối chiếu đầy đủ. HTTP test opt-in đã được
chủ dự án cho phép trước đó; chỉ đọc,
không mở cấu hình production. GET mxperson thật đã qua: duongvq có E&I, NHATNH có
ct_discipline ban đầu trống. Chủ dự án cập nhật E&I, đăng nhập lại; DB xác nhận binding
nhatnh và E&I/read cùng audit. Không cấp grants từ ví dụ duongvq. Sau đó WO/detail/crew
E&I đã đọc live và nháp đơn create/restore/update/delete đã kiểm chứng; xem [Planner](planner-access.md).

## Kiểm chứng sau khi nhận thông tin

1. Kiểm tra cấu hình connection và đường mạng/TLS từ server test; xác nhận dùng đúng test system.
2. Kiểm tra read-only authentication và quyền object structures oslcmxwodetail/mxpersongroup.
3. Đối chiếu response đã khử thông tin nhạy cảm: identity connection/site/WOID, href,
   field/relationship, optional/null, status domain, parent/task, PIC và duration.
4. Đối chiếu số lượng WO với workbook ở cùng bộ lọc/thời điểm; kiểm tra paging và giới hạn.
5. Xác nhận timezone, clear semantics và revision/ETag cho WO riêng lẻ.
6. Khi có WO và quyền ghi test được chỉ định, lên kiểm thử conditional update và PATCH override.
   Luồng upload chưa triển khai; chưa có request mutation trong các bước đọc nêu trên.
7. Ghi bằng chứng đã redaction, fixtures, field mapping và các giới hạn vào tài liệu/fixtures;
   chỉ đánh dấu từng mục trong [TODO](todos.md) sau khi có bằng chứng thật.

Trong lúc chờ thông tin, HTTP fixtures và PostgreSQL tests hiện có chỉ chứng minh hành vi
của ứng dụng theo hợp đồng giả lập. Không dùng chúng để đánh dấu Maximo/Entra live hoàn tất.
