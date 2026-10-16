# Phân bổ nhiều ngày trên Resource timeline

Cập nhật: 2026-10-15. Lưu phân bổ tạo kế hoạch nội bộ. Gửi Maximo là thao tác
riêng qua [preview và đồng bộ kế hoạch](daily-plan-uploads.md), chỉ trên Test
khi contract được bật.

## Sử dụng

Kéo hoặc chọn WO vào ô người/ngày, giữ các task cần phân công và assignment
WAITASGN. [Bảng phân bổ tự động](automatic-task-allocation.md) thay các nút
Phân bổ nhiều ngày riêng từng task: giữ nhiều task, xếp theo Task ID vào ngày
còn capacity, tự tải thêm ngày và kéo qua tháng khi cần. Tổng giờ lấy theo
dòng assignment được chọn, không nhân thêm quantity. Bỏ ngày nghỉ đã xác minh;
tải chưa đầy đủ chặn lưu. Planner có thể đổi ngày bắt đầu và sửa giờ từng ô.

Giới hạn mỗi người/ngày là min(capacity rota,630phút), trừ tải Maximo và
mọi reservation local cùng labor/connection. Chỉ lưu khi đủ tổng giờ và từng
ngày hợp lệ; backend kiểm tra độc lập, lưu tất cả đoạn hoặc không đoạn nào.
UI tự mở rộng ngày qua nhiều tháng, tối đa366ngày, một người và mỗi nguồn
assignment có một kế hoạch. Khi cần thêm ngày ngoài tháng đang xem, tự
tải từng lô tối đa31ngày cho đúng nhân lực,
kiểm tra roster, laborcode, craft và phiên bản pool nhất quán trước đề xuất.
Capacity bổ sung không thay roster/backlog của tháng đang hiển thị. Đổi người,
khoảng ngày hoặc rời rồi mở lại màn hình sẽ vô hiệu hóa cache; request cũ bị hủy.
Khóa tổng giờ/task/assignment trong lúc tải. Lỗi mạng giữ workspace nhưng chặn
lưu; lỗi 401/403/404 của scope hoặc thay identity/quyền sẽ ẩn dữ liệu cũ.

Mỗi ngày có thẻ task riêng; biểu tượng hai lớp nhận diện task nhiều ngày.
Kéo thẻ sang ngày khác cùng người để mở dialog chuyển riêng đoạn đó, sửa giờ
hoặc xóa từng đoạn. Có thể chọn dời toàn task thay vì chỉ chuyển một đoạn.
Kéo sang người khác chuyển toàn bộ kế hoạch, kể cả ngày ngoài tháng đang xem;
một kế hoạch vẫn chỉ có một người nhận. Nút Chuyển task cung cấp cùng luồng
cho bàn phím hoặc thiết bị cảm ứng.
Không cho hai đoạn cùng kế hoạch trùng ngày. Tổng các đoạn đang giữ chỗ không
vượt tổng ban đầu; giảm/xóa đoạn có thể để kế hoạch thiếu giờ, chưa tự bù lại.
Xóa hết đoạn giải phóng nguồn assignment cho kế hoạch mới; giữ audit lịch sử.

## Chuyển toàn task local

Chỉ kế hoạch local được chuyển. Preview hiển thị đầy đủ phân bổ trước/sau và
capacity người đích. Mặc định ngày của đoạn đang kéo chuyển đến ngày thả;
các đoạn còn lại dịch cùng số ngày, giữ giờ từng đoạn. Nếu gặp ngày nghỉ,
thiếu rota hoặc thiếu capacity, không đổi dữ liệu. Người dùng có thể chọn
Phân bổ lại từ ngày thả để xếp lại tổng giờ còn giữ chỗ theo capacity đã
xác minh, tối đa366ngày; đọc tải Maximo từng lô31ngày và dừng khi đã đủ giờ.
Không tự khôi phục phần giờ đã xóa trước đó hoặc thay đổi nhu cầu gốc.

Xác nhận chuyển lưu header người/laborcode và tất cả đoạn trong cùng một
transaction, có version, UUID và audit; lỗi bất kỳ thì rollback toàn bộ.
Tải ô nguồn/đích được cập nhật cùng kết quả. Hủy/Esc trước khi gửi không thay
đổi kế hoạch. Mất phản hồi giữ mã yêu cầu để đọc biên nhận, không tự gửi lại.
Upload preview/batch cũ phải kiểm tra lại vì phiên bản plan đã đổi.
Không gọi API ghi Maximo; synced/unknown vẫn khóa chuyển.

API POST `/api/resource-pools/{pool_id}/assignment-plans/{plan_id}/move-preview`
nhận connection/discipline, expected_plan_version, anchor_allocation_id,
target_person_id, target_date và mode shift/reallocate. Response chứa toàn bộ
old_items, segments mới và capacity. POST cùng base `/move` thêm request_id
và đúng segments đã xem; server tính lại và từ chối nếu preview đã thay đổi.
GET `/api/assignment-submissions/{request_id}` phục hồi kết quả theo actor và
scope hiện tại. Không cần migration; runtime cần UPDATE(person_id,laborcode)
trên assignment_plan theo [provision_roles.sql](../backend/sql/provision_roles.sql).

Kiểm chứng 15/10/2026:106 PostgreSQL và399 frontend tests đạt; lint/typecheck/
build đạt (advisory chunk>500KB giữ nguyên). Hai findingP2 focus/scroll modal
được sửa và kiểm thử busy/unknown/cleanup. Live Task20 P13468351 chuyển local
CHANLD→MINHNC→CHANLD giữ0,5h01/10+9,5h02/10, nguồn và nhu cầu giữ nguyên,
các kế hoạch khác giữ nguyên; parent/tasks Maximo trước/sau bằng nhau.
Browser live dùng nút Chuyển task, pointer drag đã có integration test tự động.
[Bằng chứng](evidence/plan-move-live-2026-10-15.json).

## API và lưu trữ

- POST `/api/resource-pools/{pool_id}/task-plans`: identity connection/site/WO/
  discipline/person/task/assignment, total_minutes/request_id và
  segments `[{date,minutes}]`. Ngày không trùng, từng đoạn1–630phút, tổng đúng
  total_minutes, tối đa366đoạn và span366ngày. Trả `{request_id,plan_id,items}`.
- GET `/api/assignment-submissions/{request_id}` trả `{result:{request_id,
  plan_id,items}}`; POST và recovery dùng cùng immutable UUID/context.
- Allocation trả `plan_id`/`plan_total_minutes` từ header. PATCH/DELETE cũ áp
  version, scope, capacity và invariant tổng/person/date của group.
- Migration0013 thêm assignment_plan/header demand cố định và nullableplan_id;
  unique active source và unique ngày trong group. Legacy single-day giữ unique
  reserved source riêng; connection/pool locks ngăn mixed/group duplicate.
- plan_id giữ cả khi chỉ một đoạn còn lại. Legacy upload từ chối đoạn cóplan_id;
  API plan upload gửi toàn kế hoạch còn đủ nhu cầu gốc, lưu ID từng ngày.
  Kế hoạch synced/unknown khóa chỉnh/xóa nội bộ. Không tự xóa assignment remote.

Scope Planner/connection/discipline/PERSON/pool recheck sau I/O; task/assignment
WAITASGN và current WO eligibility đọc lại sau tải capacity trước lưu. Groupedit
cũng kiểm tra baseline nguồn; release local vẫn được nếu nguồn đã đổi/mất,
miễn quyền WO/pool còn đúng. Receipt không trả dữ liệu ngoài quyền hiện tại.

## Tải ngoài ứng dụng

Hai query AND tương thích OSLC đọc assignment bắt đầu trong khoảng và các dòng
bắt đầu trước nhưng finishdate giao với khoảng; khử trùng đầy đủ. Thử OR trực
tiếp bị Onshore Test từ chối nên không sử dụng. Assignment remote qua nhiều
ngày chưa có lịch chi tiết đã xác minh sẽ làm tải fail closed; không suy chia
rota hay coi ngày kế tiếp trống. Lịch dài đọc theo chunks tối đa31ngày.
Không có transaction chung với Maximo: fresh reads giảm stale state, không
bảo đảm snapshot nguyên tử của hệ thống ngoài.

## Nghiệm thu — 2026-10-13

- P13465911/task10/assignment2001466:20h WAITASGN. UI lập630phút03/10 và
  570phút04/10; tải lại giữ hai đoạn. Nhập11h bị khóa lưu. Kéo đoạn04→05/10,
  lưu, sửa9,5→9h; đoạn03 giữ nguyên. Còn một đoạn vẫn khóa upload/person.
- Xóa hai trial qua UI/API: header vàsegments released, tải03/04/05 trở0.
  Bốn phân công gốc240phút/versions giữ nguyên; source Maximo vẫnWAITASGN20h,
  không labor/ngày; không có upload attempt của plan.
- [Tạo](evidence/multiday-local-created-2026-10-13.json),
  [kéo](evidence/multiday-local-moved-2026-10-13.json),
  [sửa](evidence/multiday-local-edited-2026-10-13.json),
  [dọn cuối](evidence/multiday-local-final-2026-10-13.json).
- [Preview](evidence/multiday-preview-2026-10-13.png),
  [chặn vượt](evidence/multiday-over-capacity-2026-10-13.png),
  [đoạn cuối local-only](evidence/multiday-last-segment-2026-10-13.png).
- Local backup0013/Alembiccheck/runtime grants và fingerprints giữ dữ liệu cũ
  [đã qua](evidence/multiday-local-development-2026-10-12.json). Không remote
  migration/deploy, không thay đổi Maximo trong lượt triển khai này.
- Reviewer tìm P1 UUID request và P2 freshness/hard-budget: main đã sửa,
  thêm regressions. Review cuối không còn P1/P2. Tests riêng hai request đồng
  thời dùng schema UUID/transaction độc lập: cùngUUID cùngreceipt, khácUUID
  cùngsource chỉ1plan/2segments. Fixture sharedconnection ban đầu cho503 không
  chứng minh race sản phẩm; đã đổi fixture và dọn schemas thử.
- Kiểm tra cuối:622backend offline/Ruff qua;60tests tập trung gồm22PG qua.
  Frontend306tests full qua, thêm2edge tests hardbudget/loadincomplete qua;
  TypeScript/lint/build và33tests API/UI tập trung đã qua theo các lượt cuối.
  Build giữ cảnh báo chunk519,60kB;3backend warnings cũ. Không thêm dependency.

## Nghiệm thu qua tháng — 2026-10-13

- UI cùng nguồn P13465911/task10/assignment2001466, HAIDQ: lập 20h thành
  10,5h ngày31/10 và9,5h ngày01/11. Chuyển tháng11 thấy đúng đoạn ngày01;
  nhập11h khóa lưu. Chuyển đoạn sang02/11 và sửa9h giữ đoạn31/10 nguyên.
- Xóa hai đoạn thử qua UI: header/segments released; tải31/10,01/11,02/11
  về0. Bốn phân công gốc giữ nguyên, nguồn Maximo vẫn WAITASGN20h/null
  labor/ngày, không có plan upload attempt. Không sửa schema hoặc ghi Maximo.
- [Tạo](evidence/cross-month-local-created-2026-10-13.json),
  [chuyển và sửa](evidence/cross-month-local-edited-2026-10-13.json),
  [đối soát cuối](evidence/cross-month-local-final-2026-10-13.json),
  [chặn11h](evidence/cross-month-over-capacity-2026-10-13.png),
  [timeline sau dọn](evidence/cross-month-final-timeline-2026-10-13.png).
- 45 tests frontend API/timeline đạt, gồm range hoàn toàn tháng sau, lô32ngày,
  lỗi lô sau, cancellation, deactivate/reactivate và thu hồi quyền401/403/404.
  11 PostgreSQL tests đạt, gồm lifecycle cross-month; Ruff/typecheck/lint/build qua.
  Full frontend:319/320 đạt; một test PoC synthetic cũ timeout15s, chạy riêng
  vẫn timeout; không báo full suite xanh. Build cảnh báo chunk524,82kB.
- Review và một recheck tập trung: P1 scope invalidation đã sửa; không còn
  finding trong phạm vi recheck. Không thêm dependency/commit/push/deploy.

Đợt phân bổ tự động đã xử lý timeout test PoC, full325tests qua. Tiếp theo:
nghiệm thu lưu preview nhiều task. Bổ sung14/10: đồng bộ từng kế hoạch Test
có preview/mapping và recovery; sửa/xóa đã gửi vẫn cần contract riêng.
