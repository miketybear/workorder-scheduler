# Write contract và ETag trước upload

Cập nhật: 2026-10-07. Trạng thái: **chưa chốt, chưa kiểm chứng live, upload chưa triển khai**.
Các bước dưới là giao thức nghiệm thu để IT/Maximo admin và planner duyệt cho từng
connection. Không có WO được chỉ định hoặc quyền ghi cụ thể thì chỉ thu thập metadata/GET.

## Phân biệt revision nháp và revision Maximo

[Detail reader](../backend/app/maximo/detail.py) hiện đọc filtered collection và
`current_snapshot` cố ý đặt revision `None`. SELECT chưa lấy orgid/resource href;
baseline token/hash và version nháp chỉ bảo vệ lưu nháp. Không dùng collection ETag,
timestamp hoặc baseline hash làm If-Match của một WO.

IBM mô tả If-Match/ETag cho conditional update và stale token trả 412 trong
[HTTP headers](https://www.ibm.com/docs/en/max-it/cd?topic=transactions-http-headers),
cùng POST `x-method-override: PATCH` trong
[partial update](https://www.ibm.com/docs/en/max-it/cd?topic=resources-partial-update-oslc-resource).
Đây là tài liệu sản phẩm IBM hiện có để thiết kế ca thử, không phải bằng chứng
Maximo 7.6.1.3 của Onshore/Offshore hỗ trợ cùng hợp đồng.

## Các giá trị phải chốt

| Hạng mục | Hợp đồng cần ghi / bằng chứng | Hiện tại |
| --- | --- | --- |
| Identity và endpoint | Connection UUID + siteid + workorderid; orgid, resource href và single-resource GET đã đối chiếu; href không đổi origin/host/secret destination | Identity read Onshore qua; href/orgid write chưa lấy |
| Quyền và WO thử | CM/PM/CFT cụ thể, fields được đổi, người duyệt, thời gian thử, actor độc lập tạo conflict, rollback owner | Chưa có danh sách/quyền ghi |
| Method/headers | POST override PATCH hay phương thức thực tế; Content-Type/Accept, representation/lean parameters, PATCHTYPE nếu cần; không gửi child arrays chưa duyệt | Hành vi VBA là tham chiếu, chưa thử write |
| Revision | Nguồn per-record token/ETag của resource GET, quoting/weak marker, chính xác header If-Match và phạm vi token theo representation | `None` trong snapshot hiện tại |
| Dates | Offset/timezone, precision, giờ mặc định, DST nếu có; schedfinish tính giờ liên tục hay ca; write/read-back normalization | Onshore timezone Asia/Ho_Chi_Minh; giờ liên tục ở UI |
| Null/clear | Missing nghĩa không đổi; null/empty/date/PIC clear được chấp nhận hay từ chối riêng từng field | Explicit clear bị từ chối hiện tại |
| PIC/duration | Membership/group, giới hạn tên PIC, estdur đơn vị/min/max/scale/rounding và kiểu JSON | PIC E&I GET qua; write bounds/rounding chưa chốt |
| Allowlist/target | schedstart/schedfinish/assignedtechname/estdur; targstartdate/targcompdate chỉ khi explicit intent, cấm PM/CFT; không status/discipline/arbitrary fields | Backend nháp đã validate; remote chưa thử |
| Response/errors | Success code/body, validation/auth/conflict codes, redacted error fixtures; read-back và timeout semantics | Read errors có mock/live; write chưa có |

## Giao thức thử conditional update

Thực hiện thủ công có kiểm soát hoặc bằng harness được review sau khi WO/quyền ghi
đã chỉ định. Mọi mutation, kể cả khôi phục, cần durable audit intent trước request,
actor đã xác thực/đối chiếu, connection/site/WOID, before/changes và attempt ID.
Nếu chưa có đường audit đó thì dừng ở GET/metadata; không dùng curl tạm để bỏ qua audit.

1. GET đúng resource test, đối chiếu identity/discipline/current access. Lưu snapshot
   redacted và token A nguyên giá trị kể cả dấu ngoặc kép/weak marker; không tự dựng token.
2. Đổi một giá trị đã duyệt với A. Ghi request headers/body không secret, response code,
   token nếu có; GET lại để xác nhận normalized values và token mới B. Success HTTP
   một mình không đủ để xác nhận dữ liệu ghi.
3. Actor khác cập nhật cùng WO trong trường đã duyệt, tạo revision mới C. Gửi thay đổi
   khác với token cũ A/B. Phải bị từ chối vì stale precondition; GET lại chứng minh giá
   trị của actor khác còn nguyên và mutation stale không được áp.
4. Thử hai request concurrent dùng cùng revision theo window đã duyệt: tối đa một thay
   đổi được chấp nhận; còn lại conflict. Ghi cả intent/outcome/read-back.
5. Đối chiếu hành vi thiếu If-Match và wildcard với IT. Sender tương lai phải từ chối
   locally khi thiếu revision, không gửi `If-Match: *`; không coi upstream cho phép
   unconditional request là đáp ứng điều kiện an toàn của ứng dụng.
6. Chạy CM schedule/PIC/duration/date precision và null/clear được duyệt. PM/CFT target
   bị từ chối ở app trước gửi; kiểm tra không có outbound mutation cho trường bị cấm.
7. Khôi phục đúng giá trị được duyệt bằng revision mới; nếu conflict/timeout thì dừng,
   đọc đối soát, không resend hoặc ép overwrite. Timeout sau gửi là unknown.

Kết quả mỗi ca ghi connection/system/environment, WO identity/worktype, thời điểm,
actor/người duyệt, method/representation, exact token, expected/actual status,
before/after đã redaction và read-back. Token có giá trị opaque, không suy luận semantics
từ một lần token trông giống số hoặc từ header của collection.

## Cổng trước triển khai sender

- [ ] IT duyệt WOs/fields/write window và đường audit cho harness.
- [ ] Single-resource href/orgid/identity và token được xác minh cho từng connection.
- [ ] Current-token success, stale-token rejection không đổi giá trị và concurrency qua.
- [ ] Date/null/PIC/duration/target/error hợp đồng có evidence và fixtures đã redaction.
- [ ] DB runtime không sửa/xóa audit hoặc gỡ trigger; giữ receipts và unknown outcomes.
- [ ] Tenant/roster/staging và quyền integration account đã nghiệm thu đúng scope.

Nếu conditional update không được hỗ trợ, ghi rõ race giữa read và write, giữ cổng
upload đóng và đưa phương án cho chủ dự án/IT quyết định lại. Không tự fallback sang
unconditional write. Sau contract mới triển khai intent-before-send, dedup, serialize,
read-back, partial outcomes/unknown reconciliation và scoped history/status.
