# Đánh giá phân công theo task — 2026-10-12

Đã kiểm tra read-only trên Onshore Test, WO P13465570, object structure
`BDSCHED_WO`. Chưa đổi cấu hình runtime, schema ledger hoặc giao diện; không
gửi POST/PATCH/DELETE đến Maximo. [Bằng chứng](evidence/task-assignment-contract-2026-10-12.json).

## Dữ liệu thực tế

WO gốc: BD1 / workorderid 528213, discipline E&I, trạng thái APPR.

| Task | Workorder ID task | Mô tả | Craft | Quantity | Giờ | Assignment ID |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 528227 | Prepare PTW, WO | E&I | 1 | 0,5 | 535771 |
| 20 | 528229 | Replace, function test | E&I | 1 | 9 | 535777 |
| 30 | 528231 | Finish job, close PTW, WO | E&I | 1 | 1 | 535783 |

Cả ba assignment có status WAITASGN; laborcode và scheduledate không có trong
response. Maximo mặc định bỏ thuộc tính null, vì vậy mapper cần xử lý missing
và null. Tổng planned labor của mẫu là 10,5 giờ; không suy demand từ estdur.
Quantity đều bằng 1, chưa chứng minh cách quy đổi nhu cầu cho quantity > 1.

Call mẫu trả `woactivitytask`, `showplanlabor`, `showassignment` ở dạng array,
không dùng chuỗi `rel.` làm tên thuộc tính JSON. SHOWASSIGNMENT ở WO gốc trả
lại cùng ba assignment ở các task. Khử trùng bằng connection + assignmentid;
không cộng cả WO-level và task-level.

## Object structure và giới hạn ghi

- Call mẫu và call mở rộng các trường reader hiện tại đều HTTP 200. Một WO
  này parse được bằng model WorkOrder hiện tại; chưa kiểm chứng toàn bộ danh
  sách, paging, saved queries, href hoặc sender sau chuyển object structure.
- Config validator và configured_connection hiện hard-code
  `/oslc/os/oslcmxwodetail`. Đổi riêng URL trong .env sẽ bị từ chối. Cần cấu hình
  object structure đã allowlist theo connection, giữ kiểm tra origin/path và
  cập nhật reader, paging, contract probe, sender cùng các tests liên quan.
- JSON schema BDSCHED_WO có `assignment` (relation SHOWASSIGNMENT) và
  `woactivity` (relation WOACTIVITYTASK); task có child `wplabor`.
- Đọc child `assignment` trả rowstamp cho cả ba dòng; root có href/rowstamp.
  Đọc `rel.SHOWASSIGNMENT` không trả rowstamp trong probe này.
- Schema child assignment không expose taskid; đọc child assignment không
  trả taskid dù select yêu cầu. Task mapping lấy từ relation và join theo
  assignmentid. Không giả định có thể ghi taskid qua child payload hiện tại.
- Có khả năng cập nhật assignment hiện hữu qua child `assignment`, nhưng
  quyền ghi, MERGE/upsert/delete semantics, rowstamp conflict và side effects
  chưa được nghiệm thu. `rel.*` đọc được không chứng minh payload đó ghi được.
- Trước triển khai upload assignment cần bổ sung rõ allowlist nghiệp vụ:
  hiện outbound write policy chỉ cho các trường lịch/PIC/duration của WO.
  Không mở rộng sender hiện tại để gửi tùy ý nested JSON.

## Luồng giao diện đề xuất

Giữ Resource timeline người × ngày và backlog theo PoC. Lazy-load task và
assignment khi chọn/kéo một WO, không tải nested data cho toàn bộ backlog.

1. Kéo WO vào người/ngày mở dialog với danh sách task, craft, planned hours,
   assignment hiện có và remaining capacity. Chọn một hoặc nhiều task;
   laborcode lấy từ binding roster, không nhập tên để đoán laborcode.
2. Có thể phân toàn bộ ba task cho một người nếu ngày đó còn đủ 10,5 giờ,
   hoặc chia task cho người/ngày khác. Không tự ghi đè assignment đã có labor.
3. Lưu kế hoạch task nội bộ trước; timeline hiện task/giờ, có thể gộp theo WO
   rồi mở chi tiết. Kéo một task chuyển riêng task đó; kéo nhóm chỉ chuyển
   cả nhóm khi người dùng chọn rõ và toàn bộ nhóm qua validation.
4. Với mẫu WAITASGN, giữ assignment ID để đề xuất điền laborcode/ngày vào dòng
   hiện hữu, tránh tạo duplicate. Thêm dòng, tách nhiều người/ngày và xóa
   assignment trên Maximo cần contract riêng đã kiểm chứng.

Dialog dùng nhãn Task, Nhân lực, Chức danh, Ngày, Giờ; các workorderid,
assignmentid, rowstamp chỉ nằm trong API/ledger. Person/title vẫn phục vụ
phân biệt tên trùng. WO không có task cần lựa chọn phân công cấp WO rõ ràng.

## Capacity, identity và phân quyền

Ledger hiện tại chưa có task identity hoặc upstream assignment ID; cần migration
và contract mới lưu WO gốc + workorder ID task + taskid + assignmentid/baseline,
giữ actor, version, receipts. Không tự gán phân bổ WO cũ vào một task; cần thao
tác chuyển/split rõ ràng. Một request nhiều task phải validate tổng phút và
lưu nguyên tử dưới khóa capacity, không gửi ba mutation độc lập rồi thành công
một phần mà UI báo toàn bộ đã lưu.

Tải người/ngày là assignment Maximo có laborcode/ngày thuộc các trạng thái tính
tải đã xác minh, cộng reservation nội bộ chưa phản ánh trên Maximo. Bản sao đã
đồng bộ chỉ tính một lần. WAITASGN chưa có labor/date là nhu cầu chờ phân công,
không là giờ đã tiêu hao của một người.

Load task của một WO không đủ chặn vượt 10,5 giờ: cần lấy tải assignment của
labor/ngày trên mọi WO/site liên quan trong cùng connection/pool, kể cả WO
ngoài backlog hoặc discipline đang xem. Backend chỉ trả aggregate ngoài scope,
không lộ WO/người khác. Khi upstream load chưa xác minh đầy đủ, không tuyên bố
capacity tổng đã an toàn hoặc cho upload dựa trên load cục bộ.

Planner vẫn cần grant của connection/discipline WO gốc; task phải thuộc đúng WO
và site; task/assignment craft và roster phải nằm trong nhóm được cấp quyền.
Validate lại parent/task/current assignment trước mutation. scheduledate là
datetime có timezone; timeline ngày chưa đủ xác định giờ bắt đầu ca, không
tự dùng targstartdate làm giờ bắt đầu mọi task.

## Thứ tự triển khai

1. Sẵn sàng: reader BDSCHED_WO và API task read-only scoped; dialog chọn task
   trên timeline, migration/ledger task và phân công nội bộ. Tests cho guessed
   task/assignment IDs, mixed crafts, revoked grants, sum capacity, atomic batch,
   legacy allocations, missing/null, duplicate relations và unknown receipts.
2. Tiếp theo: đọc tổng tải Maximo theo labor/ngày, đối soát cùng ledger; xác minh
   trạng thái tính tải, quantity > 1, phân nhiều ngày/người và giờ bắt đầu ca.
3. Upload: cần contract write Test có object/field mapping, quyền integration,
   conditional conflict, read-back và audit cho create/update/release; thử trên
   dữ liệu disposable được xác định. Chưa có bằng chứng write cho BDSCHED_WO.

Nguồn: [IBM — selecting](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/selecting/),
[JSON schema](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/jsonschema/jsonschema/),
[child updates](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/create_and_update/).
IBM cũng mô tả assignment có thể cập nhật schedstart/schedfinish của WO trong
Assignment Manager; cần nghiệm thu side effect của đường ghi thực tế tại Test:
[IBM support](https://www.ibm.com/support/pages/scheduled-start-date-work-order-gets-updated-assignment-labour).
