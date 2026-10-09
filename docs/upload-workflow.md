# P7 — Upload từ nháp đã lưu

Cập nhật: 2026-10-09. Mốc đầu dùng Maximo giả để kiểm chứng orchestration;
Onshore test CM đã qua conditional/field harness. Native TEST sender đã tích hợp;
browser upload/restore CM, PM đơn/nhóm, CFT duration-only và mixed PM/CFT/REC đã qua.
Sender TEST dùng chung cho tám mã type hiện có; Offshore/production vẫn khóa.

Bảy non-CM types đã qua operator field contract ngày09/10, gồm schedule/PIC/
fraction và target được phép, exact original restore, audit84 intent/results.
Đây chưa phải app upload qua browser. PM date-only update tự đổi estdur25→21;
exact restore cần gửi duration riêng sau date restore (gửi cùng request vẫn21).
Preview/readback khi Maximo tính lại duration đã xử lý theo mốc dưới. Chủ dự án chốt
nghiệm thu theo hai nhóm target, không browser từng mã type. PM/CFT target luôn cấm.
Chi tiết và phạm vi: [field contract](maximo-write-contract.md).

## PM: ngày lịch và duration Maximo tính lại — 2026-10-09

Sender hiện hỗ trợ CM/PM/CFT/REC/OVERHAUL/MoD/General/Routine dưới cùng explicit
opt-in Onshore TEST trong app development/test. Production và Offshore vẫn khóa.
Domain contract tám mã hiện có được dùng chung; mã không được hỗ trợ vẫn fail closed.
PM/CFT target bị cấm ở backend; nhóm còn lại cần explicit change_target trong proposal.

| Nhóm quy tắc | Target date | Điều kiện upload chung |
| --- | --- | --- |
| PM/CFT | Luôn cấm đổi | Actor/current scope, native revision, audit intent, saved version và valid fields |
| CM/REC/OVERHAUL/MoD/General/Routine | Cho phép khi explicit intent | Cùng sender/guards; không mở gate riêng từng mã |

Quyết định chủ dự án2026-10-09 thay yêu cầu nghiệm thu browser từng type bằng tests
tự động mọi mã và một nhóm hỗn hợp PM/CFT/WO được đổi target. Nhóm hỗn hợp đã qua
browser ngày09/10; PM duration read-back/unknown guards giữ.

## Nhóm hỗn hợp PM/CFT/REC — 2026-10-09

BatchPlanner hỗ trợ Target Start/Finish từng dòng, tự lưu explicit intent;
PM/CFT khóa hai ô target. Không áp target hàng loạt. Nhập lại ngày baseline hoặc
Reset Target gỡ thay đổi/intent; Undo giữ đúng trạng thái trước thao tác.
Review phát hiện và đã sửa P2 về target no-op làm cả batch bị từ chối;
frontend190 tests/typecheck/lint/build qua, main kiểm chứng trên browser.

Forward batch `1bcf571d-c65a-463c-839b-849ff2386480` gồm ba WO E&I TEST:

| WO | Thay đổi | Restore |
| --- | --- | --- |
| PM P13469691/BD1/536549 | Datepair Oct30 07:30→Oct31 08:30; Maximo duration25→21 | Original datepair Oct30 06:30→Oct31 17:30, rồi duration-only25 |
| CFT H14302007/BD1/2488922 | Duration6→6.25; lịch/PICnull giữ nguyên | Duration-only6 |
| REC P13469038/BD1/535211 | Target Start Oct1 10:38→11:38, explicit intent | Target Start10:38, explicit intent |

Sau restore, read-only audit cả ba WO khớp sáu trường original;7unique requests204,
7durable intents,4batches,43events, tất cả confirmed/source finalized, zero reservations.
Chỉ REC có target outbound hai chiều; PM/CFT không target/PIC. Bốn nháp cũ/năm
members giữ nguyên. Reopen PM không còn restore-origin section sau exact readback.
Evidence `.cache/mixed-target-{before,forward,final}.json` và
`mixed-target-{pm,rec,cft}-restored.png`. Đây là một mixedgroup E&I Onshore TEST;
không chứng minh mọi WO/discipline/production. Production/Offshore vẫn khóa.

## Receipt và khôi phục PM

Receipt confirmed PM đổi lịch trả `restore_source.before` từ immutable audit,
gồm worktype và sáu trường gốc, kể cả giá trị null. UI giữ original đầu tiên theo
principal/connection/discipline/site/WO trong App memory. Receipt recovery cũng
đọc fresh detail trước khi giữ/clear original; logout hoặc đổi scope xóa App memory.
Full reload chưa có giao diện nạp lại lịch sử original, nhưng audit server vẫn giữ.

Hai nút restore chỉ chuẩn bị proposal, không tự ghi Maximo: restore cặp ngày gốc
trước (không gửi estdur), rồi restore duration riêng khi ngày gốc đã khớp. Mỗi
phase cần lưu nháp, preview và upload bình thường. Original ngày null chưa được
clear qua app; nút restore bị khóa. PIC/target/type drift cũng khóa restore.
Ngày cùng instant khác offset và duration tương đương được so theo giá trị.

Preview nháp và upload cảnh báo khi ngày lịch PM thực sự đổi; không dự đoán
duration từ calendar chưa biết. API preview trả `warnings` cho từng WO, mã
`pm_duration_recalculation` chỉ khi PM ready có schedstart/schedfinish thay đổi.

Sau request có kết quả thành công đã biết, readback được xác nhận với duration
Maximo tính lại chỉ khi nháp không đổi estdur và tất cả trường khác khớp chính xác.
Audit lưu expected/actual, toàn bộ baseline thực tế và revision trước confirmed.
Receipt trả `duration_result` để UI hiển thị duration thực tế. Finalize/reconcile
so sánh lại baseline thực tế đã lưu, không chấp nhận một duration khác về sau.

Nếu nháp đổi estdur nhưng Maximo trả giá trị khác, kết quả vẫn unknown, giữ nháp
và reservation; UI hiển thị expected/actual. Không tự gửi thêm duration POST.
Timeout/unknown không được suy ra thành công chỉ từ ngày đúng và duration khác;
reconcile vẫn yêu cầu expected exact hoặc actual snapshot đã được xác nhận/audit.
Khi reconcile sau mismatch đạt expected exact, receipt bỏ cảnh báo mismatch cũ;
lịch sử audit vẫn giữ nguyên. Gate sender non-CM chưa được mở bởi thay đổi này.

Main verification: backend629 tests/4 known warnings, frontend181 tests/typecheck/
lint/build qua. Independent review không có P1; local finish-only warning P2 đã sửa.
Browser real PM P13469691 trên Onshore test/E&I hiển thị warning đúng; nháp riêng
a043956f-4fce-4fbf-9237-95ba6240aac4 v1 giữ để xem, Maximo exact original25h,
zero reservations và source drafts cũ giữ nguyên. Evidence local:
`.cache/pm-duration-preview-browser.jpg`, `pm-duration-browser-audit.json`.
Ở mốc preview/readback này chưa gửi PM app mutation; nghiệm thu tiếp theo bên dưới
đã mở sender CM/PM dưới opt-in TEST và xác minh PM đơn thật.

## Browser PM upload và exact restore — 2026-10-09

Onshore test/E&I, P13469691/BD1/536549, cả ba phase qua browser lưu nháp → preview
→ upload → fresh read-back; không operator write hoặc retry thêm.

| Phase | Actual outbound keys | Kết quả | Batch |
| --- | --- | --- | --- |
| Đổi lịch 30/10 07:30 → 31/10 08:30 +07 | schedstart, schedfinish | 204, confirmed; Maximo25→21h | 3b635cb9-2b3c-492c-9097-7a5a80784a09 |
| Restore lịch 30/10 06:30 → 31/10 17:30 +07 | schedstart, schedfinish | 204, confirmed; duration21h | 7c57ec44-ecea-49dc-8e1e-4c3a8201c286 |
| Restore duration gốc | estdur | 204, confirmed;25h, all6 original exact | 631f4983-d59e-44d9-978d-810309239444 |

Read-only audit độc lập19events/3unique transactions: mỗi phase một durable intent,
conditional request/result204, native rowstamp mới, source finalized và zero active
reservations. Phase đầu lưu pinned duration-result expected25/actual21/full baseline.
PIC null và targets không outbound/không đổi; bốn nháp cũ/năm members giữ chính xác
version, baseline và proposals. Nháp scratch a043956f-4fce-4fbf-9237-95ba6240aac4
được finalized đúng version, hai nháp restore mới cũng finalized. Reopen PM sau phase
cuối không còn region restore hoặc marker nháp; bảng fresh hiển thị original25h.

Backend641 tests/4 known warnings; frontend187 tests/typecheck/lint/build qua.
Independent review ba P2 đã sửa: receipt nullable origin, scoped first-origin recovery
sau gián đoạn, semantic date/duration equality. Main đọc fixes và kiểm tra regressions.
Explicit-duration mismatch/timeout guard có synthetic/PostgreSQL coverage, chưa tạo
unknown PM cố ý trên live browser. Ở mốc đơn này PM nhóm và sáu type khác còn pending;
coverage nhóm/CFT mới được ghi ở mốc tiếp theo bên dưới.
Evidence `.cache/pm-browser-before-audit.json`, `pm-browser-final-audit.json`,
`pm-browser-{upload-preview,positive,dates-restored,restored}.jpg`.

## Browser PM nhóm và CFT duration — 2026-10-09

September E&I nhóm hai PM có lịch gốc đầy đủ, PIC gốc khác nhau. Batch chung
`0104725f-5e51-474d-80cb-ee5bfb701b04` xác nhận cả hai WO, finalized đúng hai source
members. Chỉ ngày lịch outbound; duration và PIC không đổi. Receipt giữ original
riêng từng WO, không dùng baseline của một WO để restore WO khác.

| WO/site/WOID | Đổi lịch nhóm (+07) | Restore gốc (+07) | Duration/PIC cuối |
| --- | --- | --- | --- |
| H14286978/BD1/2458816 | 16/09 07:30 → 17/09 09:30 | 16/09 06:30 → 30/09 18:30 |26h/null|
| H14288340/BD1/2461540 | 01/09 07:30 → 02/09 07:30 | 01/09 06:30 → 15/09 18:30 |24h/NGOCNH|

Mỗi restore ngày gốc đi qua browser save/preview/upload riêng. PM1 finalized và
clear origin trong khi PM2 vẫn giữ origin riêng; sau PM2 cả hai all6 exact và
không còn restore region/marker nháp. Maximo lần này không đổi duration, nên
không gửi thêm duration POST. Không suy mọi PM sẽ có cùng side effect.

CFT H14302007/BD1/2488922 có lịch/PICnull: browser duration-only6→6.25→6h,
batch forward`3f2253c1-8934-4e97-b3c1-7a9b6cc1588d` và restore
`cbe3db99-5f7a-4c9d-9074-6ad2b32d4258`, đều204/confirmed/source finalized.
Targets vẫn bị khóa UI/backend; không ngày/PIC/target outbound. All6 original exact.
CFT app schedule/PIC/group chưa live UAT; null clear/restore không được hỗ trợ.

Read-only audit độc lập: sáu item, sáu unique transactions, sáu durable intents và
conditional results204,36events; bốn datepair PM requests và hai duration CFT requests,
không extra POST/reservation. Bốn nháp cũ/năm members giữ version/baseline/proposals.
Backend644 tests/4 known warnings và Ruff qua; frontend không đổi (mốc trước187tests).
Không migration/dependency/config mới. Ở mốc nghiệm thu này gate chỉ CM/PM/CFT;
quyết định hai nhóm target phía trên mở chung tám mã trên Onshore TEST.
Production và Offshore vẫn khóa.

Retrieve nhiều trang còn pending: ba tháng có338WO nhưng nextPage Maximo quảng bá
host https://maximo.biendongpoc.vn khác TEST origin http://bd-maxdev.biendongpoc.vn.
Reader chặn `Unsafe paging response`, không gọi host đó. Monthly166/117WO đã qua.
Evidence `.cache/pm-group-cft-{before-audit,final-audit,read-diagnostic}.json`,
`pm-group-{first,second}-restored.jpg`, `cft-browser-{positive,restored}.jpg`,
`pm-group-cft-backend-verified-tests.txt`. Không đọc log/config server Maximo.

## Browser UAT và audit — 2026-10-08

Tài khoản Entra Planner E&I trên Onshore test, WO P13467327/BD1/531789 (CM/APPR).
Nháp riêng chỉ đổi estdur 5→6; preview khớp, app POST thành công và đọc lại 6.0.
GET receipt lookup xác nhận kết quả mà không tạo POST mới. Nháp khôi phục mới đổi
6→5; app POST và đọc lại 5.0, UI bỏ đúng marker/receipt của nháp đã hoàn tất.

| Lần | Source draft v1 | Batch | Upload item / transactionid |
| --- | --- | --- | --- |
| 5→6 | 46f80ccf-cdc8-4274-9beb-ff2de84e5b05 | aa4b4dcd-ce8f-4492-aea6-5f517b610f83 | 2ee2e793-dd66-4712-84bf-f72156560b5f |
| 6→5 | 748259a2-33d3-499f-993d-1ca63d4323fe | c3ab6704-cff8-4790-9443-1ef38176012a | 20af719f-7bdf-44d6-a042-bf578d84fa6c |

Mỗi item có đúng sáu audit events: prepared, intent, conditional_request,
conditional_response, confirmed, source_finalized; cả hai HTTP204, không error.
Thời điểm request/finalized UTC lần đầu15:46:47.317795/15:46:48.126226,
lần restore15:48:46.262619/15:48:47.035408 (22:46–22:48 tại Onshore).
Nháp nguồn có source_revision null từ API cũ, fresh revision được pin đúng trước gửi:
2899906265→3624707930→3624708330; ETag vẫn0. Read-only audit sau restore xác nhận
toàn bộ sáu fields bằng UploadItem.before đầu: estdur5.0, PIC/schedstart/schedfinish
null, target01/10/2026 và31/10/2026 16:55+07. Hai source drafts đã finalized;
ba nháp đơn cũ v2/v1/v1 và nhóm hai WO v1 giữ nguyên.

Full backend500 tests qua, frontend175 tests qua cùng lint/typecheck/build;
minor toolbar fix sau UAT đầu qua60 WorkOrders tests/typecheck/lint và browser restore.
Independent review không có P1; P2 đã sửa/main xác minh. Nhóm lớn/partial/unknown,
10 planner, crash lease và WO types khác chưa nghiệm thu live. Recovery receipt
trên UI hiện giữ trong RAM theo principal/scope; không tồn tại qua reload/logout.

## Browser nhóm upload/restore — 2026-10-08

Fixture mới gồm hai CM/APPR E&I chưa có nháp hoặc active reservation:
P13467496/BD1/532127 và P13467932/BD1/532999. Ghi baseline read-only riêng trước gửi;
PIC/schedstart/schedfinish null ở cả hai, target01/10→31/10 lần lượt14:05 và13:19+07.
Chỉ đổi duration11→12 và10.5→11.5 trong nháp nhóm v1. Preview current/proposal khớp;
app upload xác nhận2/2, panel đóng và bảng nhận12.0/11.5, marker nguồn được bỏ.

Tạo nháp nhóm v1 mới từ baseline đã đọc lại, chỉ đổi12→11 và11.5→10.5.
Preview khôi phục khớp; app upload xác nhận2/2, bảng về11.0/10.5, panel đóng và
không còn recovery button cho nhóm. Các nháp cũ được giữ nguyên.

| Lượt | Source group v1 | Batch |
| --- | --- | --- |
| Upload | 5fc0f6c7-da47-404b-8cd9-2b1a206b44b7 | 1bd36f04-63ee-484f-af9e-3f7cee883b32 |
| Restore | c2cb3259-e300-46e3-9b81-f58ea00424db | e6f5dab7-ceaf-4710-9066-94168361733c |

Read-only audit sau restore: cả4 POST HTTP204/error null và4 items confirmed;
mỗi item có6 events (prepared/intent/conditional_request/conditional_response/
confirmed/source_finalized). Mỗi nhóm finalized trong một transaction sau khi cả
hai confirmed; hai source drafts đã xóa, không còn active reservation. Native
rowstamp P13467496:2900321275→3624709750→3624710026;
P13467932:3225289005→3624709754→3624710030. Cả sáu fields bằng exact original;
ba nháp đơn cũ v1/v1/v2 và nhóm cũ v1 hai WO vẫn tồn tại.
Evidence local được giữ ở `.cache/p7-group-upload-initial.json`,
`.cache/p7-group-upload-audit.json` và `.cache/p7-group-upload-restored.jpg`;
không chứa credential và không được commit.

Không thay đổi code/config trong lượt nghiệm thu này; dùng live browser, DB audit
và read-back độc lập. Không chạy lại application suite vì không sửa code.
Nhóm lớn hơn10, partial/conflict/unknown hiện chỉ có synthetic evidence.

## Phạm vi và ranh giới

Upload phải xuất phát từ nháp thuộc tài khoản đang đăng nhập, với phiên bản cụ thể
và danh sách thành viên được chọn. Browser không cung cấp baseline, actor, quyền,
endpoint Maximo hoặc payload ghi tùy ý. Backend dựng changes từ nháp và WO hiện tại.
Định danh thành viên luôn có connection, site và workorder ID.

Preview đọc lại WO/PIC, kiểm tra quyền Planner, baseline, loại WO và các giá trị;
preview không tạo audit intent gửi hoặc ghi Maximo. Preview không bảo đảm rằng
WO/quyền sẽ giữ nguyên đến lúc submit/send; mỗi bước phải kiểm tra lại.

Submit cần CSRF, phiên đăng nhập hợp lệ, đúng version, idempotency key và thành viên
không trùng. Cùng key/cùng nội dung trả cùng batch; cùng key/khác nội dung bị từ chối.
Những WO đang pending/sending/unknown không được tạo attempt cạnh tranh trong app.
Khóa nội bộ không bảo vệ trước người sửa trực tiếp trên Maximo: cần conditional write.

Audit phải lưu nguồn draft/version/member và snapshot before/changes trước gửi.
Nguồn vẫn truy vết được sau khi nháp bị xóa. State + audit intent commit xong mới
được chuyển quyền điều khiển sang transport; lỗi DB trước intent không được gửi.

## Kết quả và phục hồi

- `pending`: đã lưu batch, chưa gửi.
- `sending`: intent đã commit, có thể đang ghi upstream.
- `confirmed`: read-back khớp các trường đã gửi sau normalization đã chốt.
- `failed`: đã xác định không ghi thành công; không suy từ timeout sau gửi.
- `conflict`: baseline/revision hoặc conditional precondition không còn phù hợp.
- `unknown`: có thể đã ghi nhưng chưa đủ bằng chứng xác nhận.

Batch tổng hợp kết quả từng dòng; một dòng confirmed không làm cả batch thành công.
Timeout/mất mạng sau send, read-back không khớp hoặc không đọc được, và DB mất kết
quả sau upstream write cần đối soát. Không tự resend unknown. Recovery sending cũ
chỉ chạy sau khi xác nhận worker cũ không còn quyền sở hữu; mốc này chưa bật worker.

Theo quyết định retention, receipts/upload/audit không purge theo tuổi. Finalizer
chỉ được xóa nháp nếu toàn bộ thành viên của đúng phiên bản nguồn đã confirmed và
nháp không bị chỉnh sửa tiếp. Partial selection, partial success, conflict, unknown
hoặc nháp mới hơn phải giữ. Không đánh đồng HTTP success với read-back confirmed.

## Hợp đồng API của mốc đầu

Các POST yêu cầu cookie phiên và `X-CSRF-Token`; responses dùng `Cache-Control:
no-store`. Không nhận connection/discipline/actor/payload ghi tùy ý từ client.

| Endpoint | Request | Vai trò |
| --- | --- | --- |
| `POST /api/drafts/{draft_id}/upload-preview` | `version`, `items: [{site_id, workorder_id}]` | Preview đúng nháp/version, 1–200 thành viên không trùng; đọc lại upstream và quyền |
| `POST /api/drafts/{draft_id}/uploads` | Thêm `request_id` UUID và `preview_hash` SHA-256 | Chỉ explicit verified Onshore TEST với tám mã được hỗ trợ; tạo durable batch/intent, xử lý tối đa10 pending; ngoài phạm vi trả409 gate |
| `GET /api/uploads/{batch_id}` | Batch UUID | Trạng thái batch thuộc actor; kiểm tra lại scope và discipline hiện tại trước trả |
| `GET /api/uploads/by-request/{request_id}` | UUID của yêu cầu submit | Owned receipt lookup chỉ đọc; gọi lại được khi source đã finalized; không tạo batch hoặc ghi Maximo |
| `POST /api/uploads/{batch_id}/continue` | `{}` + CSRF | Explicit tối đa10 pending; không gửi lại sending/unknown/terminal |
| `POST /api/uploads/{batch_id}/reconcile` | `{}` + CSRF | Chỉ đọc remote unknown, không gửi lại; giữ reservation nếu chưa đối soát được |

Preview hash ràng buộc nội dung preview, gồm write rowstamp vừa đọc; không phải quyền
truy cập hoặc bằng chứng bản thân hash có conditional write. Backend quyết định gate:
`send_enabled=true, gate=null` chỉ explicit contract Onshore/test với tám mã được hỗ trợ và appdev/test;
các item conflict/invalid vẫn hiển thị và chặn submit, không biến thành lỗi parser.
Per-connection config `conditional_write_contract="native_rowstamp_test"` mặc định
null, không tự bật từ URL/ETag; staging/production không chấp nhận opt-in này.

Preview trả `draft_id`, `version`, `preview_hash`, `send_enabled`, `gate` và từng
thành viên với `site_id`, `workorder_id`, `code`, `before` của trường thay đổi cùng
`changes`. Trạng thái batch trả counts theo state và từng item có identity,
`updated_at`, source draft/version/member và boolean `source_finalized`; không trả
cached before/changes. Receipt lookup không thấy batch trả404 `receipt_not_found`,
chỉ là quan sát hiện tại, không chứng minh request đang in-flight sẽ không commit.

Schema upload/audit đã có. Source draft UUID/version/member và before/changes được
ghi trong audit `prepared` append-only để giữ nguồn sau khi nháp bị xóa; không cần
foreign key đến nháp còn tồn tại. Audit còn giữ hash toàn bộ thành viên nháp và cờ
full selection. Finalizer nội bộ kiểm tra version/hash/full selection/all confirmed
và read-back hiện tại, ghi `source_finalized` cùng transaction xóa nháp. Finalizer
được nối sau execute/reconcile; partial/unknown/conflict/newer source giữ nguyên nháp.
Nháp legacy revisionNone giữ immutable source revision riêng; chuẩn bị upload đòi
exact current baseline và pin native rowstamp vào preview/intent, không sửa nguồn nháp.
Duplicate request kiểm tra owned receipt trước owned_draft, trả cùng batch ngay cả
sau finalize, không tự tiếp tục hoặc gửi lại. Không có fire-and-forget worker/task.
Crash/abandoned sending vẫn cần operator xác nhận process ownership rồi recovery
thành unknown; UI/endpoint không tự giải phóng sending khi POST có thể còn chạy.

## Đối chiếu upload trong giao diện nháp

Trong panel nháp đơn hoặc nháp nhóm đã lưu, chọn **Đối chiếu với Maximo trước
upload** hoặc **Đối chiếu nhóm với Maximo trước upload**. Preview chỉ dùng phiên
bản nháp đã lưu; nếu đang sửa chưa lưu thì nút đối chiếu bị khóa. Nhóm đối chiếu
toàn bộ thành viên nháp đã lưu ở mốc này.

Backend đọc lại WO/PIC và quyền, rồi trả các trường trước/sau hợp lệ hoặc kết quả
xung đột/không hợp lệ của từng WO. UI hiển thị WONUM, connection/system/environment
từ grant đã xác minh, và ngày theo timezone kết nối. Không hiển thị ID nội bộ,
preview hash hoặc token. Preview không thay đổi Maximo, không tạo upload batch.

Upload khả dụng chỉ khi backend mở gate, nháp đã lưu/current và mọi item ready.
UI gọi submit/continue và hiển thị counts/kết quả từng WO; không polling/refetch tự
động. Sửa/Undo/reset/đổi source/scope hủy read preview; kết quả yêu cầu ghi chưa rõ
không phải preview và phải giữ UUID để tra cứu, không tạo UUID mới rồi gửi lại.
Refresh finalized chỉ scoped identities, đúng source version và guard sau I/O;
không đóng editor khác hoặc áp response cũ sau đổi quyền/connection.

Lỗi tạm thời giữ dữ liệu nháp; có thể ẩn rồi mở đối chiếu để thử lại. Lỗi phiên/
quyền chuyển về luồng kiểm tra quyền hiện có và không giữ preview đang hiển thị.

## Điều kiện chuyển sang sender thật

Theo [write contract](maximo-write-contract.md), phải kiểm chứng riêng từng connection:

1. Exact resource identity/origin và token của single-resource GET; method/headers,
   fields, date/null/PIC/duration và representation được chốt.
2. Mutation với token hiện tại thành công, read-back đúng và token tiến lên; token
   cũ bị từ chối mà không đổi dữ liệu; hai request cùng revision không cùng ghi đè.
3. Mỗi mutation, kể cả restore, có authenticated actor và durable intent; lỗi/
   timeout xử lý theo kết quả thật, không fallback unconditional.

GET hiện có ETag `0` không dùng được làm If-Match; ngày08/10 harness đã chứng minh
JSON `_rowstamp` nguyên giá trị từ đúng resource qua fresh/stale/concurrency/restore
trên Onshore test CM duration. Hash nháp không phải revision Maximo. Fields/date/PIC/
null/target và sender app còn phải kiểm chứng; không bật gate chỉ từ duration probe.
Ngày 08/10 chủ dự án đã cho phép dùng Onshore test
để nối và thử mọi phần cần thiết, không hỏi lại về WO/field/window/restore.
Phần còn phải xác minh là hành vi kỹ thuật của endpoint, không phải xin thêm quyền
thử test. Harness phải có audit trước gửi, phép thử token sai dùng no-op, read-back
và restore có điều kiện; không mở upload chỉ từ lời cho phép hoặc GET.

Tests với transport giả không chứng minh write contract, tenant policy, vận hành
runtime DB/staging, độ bền crash thực tế hoặc UAT. UI tiến độ/lịch sử và E2E
upload thật là các phần tiếp theo sau API và hợp đồng ghi.

## Bằng chứng kiểm tra mốc đầu

Ngày 2026-10-08: 38 tests P7 (9 fast, 29 PostgreSQL) và full backend 406 tests qua;
Ruff lint/format qua. Một review Sol/high không có P1/critical; P2 status bị phụ
thuộc scheduling eligibility/crew đã sửa và Main kiểm tra regression. Status vẫn
đọc được khi WO đóng hoặc crew lỗi, nhưng current scope/discipline phải hợp lệ.

Các ca concurrency/intent visibility dùng connection độc lập và commit thật trong
UUID schema tạm trên DB synthetic đã guard; dùng model constraints và audit trigger
append-only hiện có, cleanup schema sau test. Không gọi Maximo/Entra thật. Test khác
dùng rollback/savepoints để giữ DB test sạch; cancellation/recovery là mô phỏng,
không phải crash process/worker hoặc mất điện thực tế.

Lệnh full suite từ backend (cần quyền Windows temp ACL và Docker cho tests vận hành
đã có; `.env.integration` theo [runbook DB](database-tests.md)):

```powershell
uv --cache-dir .uv-cache run --no-sync pytest --run-db-tests -p no:cacheprovider --basetemp .cache/p7-final-pytest --tb=short
```

Không thêm dependency hoặc migration; schema hiện tại đủ cho mốc này. Retry tạo
attempt mới và liên kết attempts, correlation logs, worker ownership/lease và
history before/after API/UI chưa được triển khai ở mốc đầu.

Mốc UI preview ngày 2026-10-08: 167 frontend tests/16 files, ESLint, TypeScript và
production build qua. Main rà soát response contract (bao gồm conflict empty rows/
scientific Decimal), context/lifecycle, abort và late responses. UI tests dùng React/
HTTP mocks. Sau đó Main nghiệm thu browser với nháp đơn P13469545 v2 và nháp nhóm
fixture P13462775/P13465570 v1 trên Onshore test/E&I: đọc lại Maximo, before/proposal,
upload khóa, sửa chưa lưu hủy preview và khóa đối chiếu. Nhóm lưu/mở lại từ server
đúng v1; giữ ba nháp ban đầu. Fixture nhóm vẫn lưu để xem nghiệm thu; chỉ sửa PIC
trong nháp, không upload Maximo. Ảnh local: `.cache/p7-group-preview.jpg`.
Các ca route-away/late response vẫn là bằng chứng automated, chưa nghiệm thu browser.
Không thêm dependency hoặc deploy. Harness ghi thử riêng có phạm vi và evidence ở
[write contract](maximo-write-contract.md), không phải writer của ứng dụng.
