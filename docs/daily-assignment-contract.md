# Assignment theo ngày và đối soát lỗi

Ngày: 2026-10-14. Phạm vi xác minh: Onshore Test BDSCHED_WO.
Chưa bật đồng bộ kế hoạch tự động trên API Planner.

## Contract cần đạt

Ngày đầu dùng assignment nguồn hiện hữu, giữ nguyên assignmentid. Các ngày
tiếp theo tạo dòng chuẩn mới trong cùng task bằng MERGE; tổng giờ đúng nhu cầu
nguồn và từng ngày không vượt rota/10,5h sau trừ tải hiện có. Không nhân quantity
thêm lần nữa. Planned labor, các assignment nguồn khác và target dates được giữ.
Mỗi đoạn cần mapping ngày → assignmentid để đọc tải và đối soát không tính trùng.

## Xác minh xóa dòng thử

Read-only metadata đã chỉ ra child localref riêng và href dạng anchored
`http://childkey#…`. Href được dùng làm selector bên trong payload MERGE,
không làm HTTP destination. Localref được kiểm tra path/identity rồi rebased
về host Onshore Test đã cấu hình; không theo hostname khác do Maximo quảng bá.
GET không trả ETag nên chưa coi rowstamp là HTTP If-Match token.

Protocol đã được review độc lập: baseline đầy đủ và durable audit trước ghi;
thêm đúng một child thử WAITASGN0,5h không labor/ngày; xác định child mới bằng
read-back; thử delete-only MERGE có root rowstamp cũ và child href/stamp hiện tại.
Chỉ khi conflict rõ ràng và tất cả dòng nguyên vẹn mới dùng bản hiện tại xóa child.
Chỉ child được tạo bởi probe được xóa. Không dùng collection REPLACE.

### Kết quả stage1

Trên P13465911/task10, assignment gốc2001466 WAITASGN20h: Add tạo child thử
2001468 WAITASGN0,5h/null labor/ngày, không đặt parentassignid=gốc. Phiên bản
root cũ trong delete-only MERGE bị từ chối và danh sách giữ nguyên. Phiên bản
hiện tại được chấp nhận nhưng child vẫn còn, kể cả khi chọn bằng href được trả.
Nguyên nhân server bỏ qua child Delete chưa được xác định; không coi204 là xóa.

Một intent cleanup riêng DELETE đúng localref được quan sát của2001468 trên
host Test trả204. Read-back chỉ còn2001466, giữ các trường assignment đã đối
chiếu, parentassignid, lịch task/parent/target, planned labor và reservation local.
Không dùng REPLACE; không tái tạo sourceID. Child GET không có ETag, nên token
If-Match rowstamp ở cleanup chỉ là candidate, conditionalDELETE vẫn UNVERIFIED.
Chưa bật publicDelete hoặc tự động compensation. FreshMERGEDelete intent cũ vẫn
unknown theo kết quả ban đầu; cleanup có biên nhận riêng confirmed.

[Stage1 read-back](evidence/daily-child-delete-stage1-2026-10-14-run2.json),
[cleanup đúng child](evidence/daily-child-localref-cleanup-2026-10-14.json).
Lượt đầu lỗi đăng ký FK trước outbound, đã rollback local, không ghi Maximo;
không chạy lại một intent chưa rõ kết quả.

## Xử lý lỗi

- Lỗi quyền/source/capacity trước intent: chưa gửi; không đổi Maximo.
- Maximo báo conflict: đọc lại xác minh, giữ kế hoạch để người dùng điều chỉnh.
- Mất phản hồi hoặc kết quả một phần: giữ intent/mapping và trạng thái chưa rõ;
  chỉ GET đối soát, không gửi lại Add và không rollback cả collection.
- Chỉ xác nhận khi read-back khớp từng đoạn và toàn bộ sibling baseline.
  Thiếu/trùng/không rõ quyền sở hữu child phải giữ chưa rõ; HTTP204 chưa đủ.
- Mỗi task có kết quả riêng; không hoàn tác các task đã thành công khi task
  khác lỗi. Thay đổi sau khi đồng bộ cần contract riêng, không giả làm sửa local.

## Tài liệu và giới hạn

[IBM create/update/delete child](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/create_and_update/).
[Bằng chứng trước và lỗi cleanup đổi ID](multiday-assignment-verification.md).
## Chia ngày và recovery đã xác minh

H14306907/task10 hiện có hai slot WAITASGN5h, planned5h/quantity2. Một MERGE
cập nhật source1968934 thành HAIDQ2,5h03/10/2026 06:30 và tạo2001470 với
HAIDQ2,5h04/10/2026 06:30, không đặt parentassignid=gốc. Sibling2001462 giữ
nguyên các trường được bảo vệ và rowstamp. Tổng task vẫn10h, nhu cầu source5h.

Handler được báo unknown sau một lần gửi thực tế accepted để mô phỏng mất
phản hồi; GET đối soát khớp và lưu mapping1968934/ngày03,2001470/ngày04 trong
event/intent ledger. Không gửi Add lại. Đây là mô phỏng trạng thái handler,
không phải fault injection làm đứt mạng thật. Probe stale root có child stamp
hiện tại bị conflict, danh sách/phiên bản nguyên vẹn và không tạo duplicate.

Cleanup operator có intent riêng: DELETE đúng localref child2001470, đọc lại,
sau đó sparse MERGE khôi phục source1968934 với phiên bản hiện tại. Cuối cùng
chỉ1968934/2001462 WAITASGN5h/null labor/ngày; ID gốc và sibling rowstamp giữ,
lịch/target/planned/reservation local như baseline, tải HAIDQ hai ngày0/0.
Không dùng replacement; không có trial còn giữ tải. Có4outbound ở stage2.

[Read-back, mapping và cleanup](evidence/daily-plan-stage2-contract-2026-10-14.json).

## Mã và kiểm tra

[daily_plan_sender.py](../backend/app/maximo/daily_plan_sender.py) là module
operator/Test, chưa nối public route. Builder1–366ngày giữ sourceID ngày đầu,
Add các ngày tiếp; kiểm tra630phút, một labor, ngày duy nhất/timezone/span,
giờ kết thúc không tràn ngày và tổng khớp source. Full-select reader xử lý
nullable omission tại boundary, từ chối dữ liệu thiếu/identity hoặc stamp đổi.
Reconciler chỉ đọc, xác nhận unique mapping và sibling protectedfields/stamps;
mapping đã lưu mà ID đổi hoặc rounding làm giờ không khớp vẫnunknown.
Sender gọi một MERGE; không retry hoặc rollback tự động.

35tests module mới;122tests liên quan gồm30PostgreSQL đạt, Ruff đạt. Lượt
PostgreSQL đầu30fail do schema test RAM mất sau Docker restart; nạp migration
hiện có vào guarded127.0.0.1:55432/scheduler_test rồi122pass. Không migrate
database ứng dụng, không thêm dependency/migration/schema feature. Independent
protocol review và một focusedP1 recheck đạt cho guard claims/noREPLACE.

Create/GET recovery đã đạt Test, còn conditionalDELETE chưa đạt. Public plan
upload tiếp tục khóa vì chưa có ledger/mapping/lifecycle tích hợp API Planner
và tính tải theo child mới. Bước tiếp là nối durable mapping và preview gửi vào
API/UI, giữ unknown chỉ đối soát và không dùng automaticDelete compensation.
