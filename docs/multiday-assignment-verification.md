# Xác minh assignment nhiều ngày — Maximo chuẩn

Ngày: 2026-10-12. Phạm vi: Onshore Test, BDSCHED_WO, E&I; app development.
Thông tin sử dụng được chủ dự án cập nhật ngày2026-10-13: chỉ dùng tab
Assignments trong Work Order Tracking; không có Graphical Assignment addon.
Thông tin trả lời trước về việc dùng Assignment Manager đã được thay thế;
chưa kết luận ứng dụng Assignment Manager có được cài đặt/cấp quyền hay không.

Cập nhật14/10: create theo ngày/GET recovery đã được thử với sibling giữ nguyên,
targeted localref cleanup giữ ID; MERGEchildDelete vẫn không hiệu lực và direct
conditionalDELETE chưa verified. [Bằng chứng mới/contract](daily-assignment-contract.md).
Các kết quả/lỗi cleanup12/10 dưới đây giữ nguyên làm bằng chứng lịch sử.

## Kết quả đã xác minh

- Schema assignment có `scheduledate` (Scheduled Start), `finishdate` (Scheduled
  Finish), `laborhrs` (DURATION), `parentassignid`, `workdate`, `startdate`.
  Metadata hiện diện không chứng minh từng field writable hoặc action split.
- Đọc117WO gốc tháng10 trong scope, bao gồm task relations. Assignment có thể
  xuất hiện ở cả parent/task; phải khử trùng bằng connection+assignmentid.
- Assignment370815 trên task20/P13439902 có79h:01/09/2023 15:33 đến04/09/2023
  22:33, đúng79h elapsed. Assignment1968812 trên task10/H14306788 có15h:
  01/10/2026 00:00 đến15:00 cùng ngày. Đây là dữ liệu có sẵn, không sửa.
- Probe ghi có audit riêng trên dòng thử đã released1968934/task10/H14306907:
  HAIDQ,03/10/2026 06:30+07,20h. POST override PATCH + `patchtype: MERGE`,
  root/child rowstamp. Read-back ASSIGNED, finishdate04/10/2026 02:30+07;
  task schedstart/schedfinish cùng khoảng.20h elapsed, không tự chia ca/ngày.
  Hai assignment trước/sau giữ nguyên identities; sibling không đổi.
- Restore có audit riêng: dòng về WAITASGN/null labor/ngày/5h; cả startdate,
  workdate,parentassignid,finishdate và lịch task/WO bằng baseline; target dates
  giữ nguyên. Không tạo reservation local, không thay đổi bốn phân công gốc.
  Probe là kiểm tra semantics Test tạm thời, không bỏ giới hạn630phút của Planner.

[Schema/dữ liệu đọc](evidence/multiday-read-2026-10-12.json),
[probe và restore](evidence/multiday-direct-write-2026-10-12.json),
[kiểm tra cuối](evidence/multiday-cleanup-2026-10-12.json).

## Kết luận thiết kế

Đường API đang dùng không tự thực hiện hành vi Assign Labor của Assignment
Manager. Không có addon không đồng nghĩa không có chức năng chia phân công
trong Assignment Manager chuẩn; hành vi trên màn hình chuẩn chưa nghiệm thu.

Không thể đồng bộ lịch local7,5+10,5+2h bằng cách gửi một assignment20h rồi
tuyên bố Maximo cũng hiểu lịch nghỉ giữa ca đó. `finishdate` hiện trả ra thời
gian liên tục; chưa kiểm tra explicit finishdate khác elapsed hoặc tác động
calendar/shift/available-hours trên Assignment Manager.

Hướng ưu tiên cần xác minh tiếp là nhiều dòng assignment chuẩn, mỗi dòng một
đoạn người/ngày: cập nhật giờ dòng gốc và thêm các dòng còn lại qua object
structure, giữ tổng giờ/quantity/craft/task. Đây là contract CRUD assignment
chuẩn cần thử riêng, không phụ thuộc Graphical Assignment addon. Việc recovery
trước đã chứng minh Maximo có thể tạo child row, chưa chứng nhận việc chia giờ
và lifecycle nhiều dòng cho chức năng Planner.

Nếu giữ một assignment gốc và chia lịch chỉ local, phải công khai rằng Maximo
không nhận chi tiết từng ngày. Không dùng baseline khớp tổng giờ để suy mọi
đoạn đã synced; cần mapping/baseline bền vững và đối soát khi upstream thay đổi.

## Phần chưa xác minh và thứ tự tiếp theo

1. Create/update chia ngày đã thử ở mục dưới. Ưu tiên điều tra delete child/
   rollback bảo toàn identity trên BDSCHED_WO (child relation SHOWASSIGNMENT),
   chưa mở remote create/delete cho Planner. Không lặp ghi với outcomeunknown.
2. Nếu cần đối chiếu UI, dùng tab Assignments trong Work Order Tracking đang
   được chủ dự án sử dụng; không yêu cầu thao tác Assignment Manager. Đây là
   đối chiếu tùy chọn, không là điều kiện bắt buộc để xác minh API.
3. Sau contract vòng đời được xác nhận mới triển khai multi-day timeline; chỉ đếm giờ
   từng đoạn và tải mọi assignment có khoảng thời gian giao với ngày đang xem.

Không thay đổi mã ứng dụng/schema, không deploy hoặc commit/push trong lượt
xác minh này. Script operator tạm trong .cache; intent/audit được lưu bền vững
trước từng outbound mutation. Không blind retry.

## Probe API chia20h thành hai ngày

Ngày12/10/2026, chủ dự án yêu cầu thử API trực tiếp; không cần đối chiếu UI.
Chọn P13465911/task10, planned E&I20h/quantity1, assignment537275 WAITASGN20h.
Audit anchor riêng cóstate released,630phút dùng chỉ để gắn durable intent,
không tạo reservation hoặc thay đổi grant. Actor lấy từ phiên nghiệm thu trước,
recheck explicitPlanner/PERSON/WO trước mỗi ghi; baseline lưu trước outbound.

Một MERGE request cập nhật537275 thành10,5h choHAIDQ vào03/10/2026 06:30;
thêm child `_action: Add`, cùngcraft/skilllevel/wplaborid/orgid,9,5h vào04/10
06:30 và `parentassignid:537275`. Maximo cấp ID2001464. Read-back:

| Assignment | Ngày | Giờ | Kết thúc | Trạng thái |
| --- | --- | --- | --- | --- |
| 537275 | 03/10 06:30 | 10,5 | 03/10 17:00 | ASSIGNED |
| 2001464 | 04/10 06:30 | 9,5 | 04/10 16:00 | ASSIGNED |

Tổng20h, load630/570phút từng ngày; stale root/child request trảconflict,
không tạo duplicate. Các bước này chứng minh create/update với cấu hìnhTest
hiện tại; task nguồn chỉ một dòng trước probe, không tuyên bố đã thử preservation
nhiều sibling cho create lần này (MERGE update quantity2 được thử riêng trước).

Cleanup không đạt bảo toàn identity: MERGE update dòng gốc vềbaseline20h đã
thành công nhưng `_action: Delete` cho2001464 không xóa dù không nhận lỗi.
Intent giữunknown do partial outcome. Sau read-back xác định rõ collection chỉ
hai dòng đã biết, operator dùng complete baseline PATCH để bỏ đúng child thử;
Maximo xóa/tái tạo dòng gốc thành2001466 thay537275. Đây là lỗi chọn cách cleanup
quá mạnh, không được đưa thành rollback của ứng dụng. Không tuyên bố restoreID
hoặc coiHTTP204 là thành công đầy đủ. Nguyên nhân Delete không hiệu lực chưa rõ.

Cuối cùng task chỉ có một WAITASGN20h/null labor/ngày, cùngcraft/skilllevel/
wplaborid/orgid/parentassignid baseline; lịch WO/task và target đúngbaseline;
planned vẫn20h/quantity1. Child thử đã hết, tảiHAIDQ hai ngày0;4reservation gốc
240phút/versions giữ nguyên. Audit anchor released; các outcome partial hoặc
identitychanged giữunknown và có event ghi nhận replacement537275→2001466.

[Bằng chứng create/conflict/cleanup](evidence/daily-assignment-api-2026-10-12.json).
Chưa mở public create/delete; bước tiếp là kiểm tra writable child/delete rule
và phương án rollback giữidentity, không cần Graphical Assignment addon.

## Tài liệu đối chiếu

- [IBM APAR IJ08062](https://www.ibm.com/support/pages/apar/IJ08062):
  Assignment Manager dùng cả scheduledate/finishdate và workperiod khi tính
  availability. APAR của version cũ, không chứng minh lỗi tồn tại ở Test hiện tại.
