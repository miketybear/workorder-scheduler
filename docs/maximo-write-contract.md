# Write contract và ETag trước upload

Cập nhật: 2026-10-09. Trạng thái: **single-resource GET và audited conditional probe
đã chạy Onshore test; JSON `_rowstamp` qua fresh/stale/concurrency/restore;
advertised ETag `0` bị từ chối; app upload CM Onshore test đã qua đơn/nhóm/restore.
Bảy type còn lại đã qua conditional-duration và schedule/PIC/allowed-target probes,
exact restore; sender TEST hiện dùng chung tám mã theo hai nhóm target. Browser CM,
PM đơn/nhóm, CFT duration và nhóm hỗn hợp PM/CFT/REC đã upload/restore exact**.
Chủ dự án đã cho phép dùng Onshore test để nối và thử mọi phần cần thiết, không hỏi
lại WO/field/window/restore. Quyền này chỉ áp dụng test; mỗi request vẫn cần actor,
current PERSON/Planner/scope và audit trước gửi. Các hệ thống khác chưa được nghiệm thu.

## Conditional-duration theo WO type — 2026-10-08

Inventory scoped E&I, root/open status, Target Finish tháng10/2026:117 WO;
CM25/PM70/CFT11/OVERHAUL4/General3/REC2/MoD1/Routine1. Type case được giữ nguyên.
Operator-only native-body probe chọn một WO không có nháp hoặc active reservation
cho mỗi type ngoài CM; reader/app defaults vẫn CM. Non-CM harness chỉ gửi estdur
và native `_rowstamp`, không dùng header fallback, không đổi type/status/PIC/ngày.

| Type | WO / BD1 WOID | Duration gốc/restore | Audit item confirmed |
| --- | --- | --- | --- |
| PM | P13469691 / 536549 | 25.0 | 730e8255-7fa0-4eae-809e-624050485c7c |
| CFT | H14302007 / 2488922 | 6.0 | 69bac03d-3701-410e-88ca-77b7ab88102f |
| REC | P13469038 / 535211 | 235.0 | 907ca70a-b475-4aeb-886d-be9ce0e86485 |
| OVERHAUL | P13468596 / 534327 | 80.0 | e6a0894c-ac20-444b-bf82-9a5311f3198a |
| MoD | P13439902 / 325283 | 80.0 | 97b8f1da-d916-4dc7-882d-40c8c5b65851 |
| General | P13457667 / 471931 | 10.5 | 7578902f-0dc1-4cb6-864f-2425980054ab |
| Routine | H14306831 / 2498570 | 50.0 | 2c41af6c-9b1b-49aa-bf83-0bac4d4b4389 |

Mỗi loại đạt: wrong-token no-op412/current no-op204/fresh+1h204/stale no-op412/
same-token +2h hoặc+3h chỉ một204 và một412/restore204. Readback khớp winner theo
label/transactionid, không suy từ thứ tự response. Cả7 bản ghi cuối có sáu fields
bằng exact original. Thời gian UTC16:17:56–16:18:36 (23:17–23:18+07).
Audit độc lập ghi7 items confirmed,203events,49transaction IDs riêng; mỗi POST
có durable contract_intent và contract_result cùng actor. Không còn reservation;
ba nháp đơn và nháp nhóm cũ giữ nguyên version/membership.

531 backend tests qua gồm7 typed PostgreSQL intent/reservation cases và7 app
non-CM rejection cases; Ruff qua. Main review các boundary/default/CLI/payload,
không thay API/schema/dependencies/config hoặc mở rộng sender. Browser PM/CFT
khóa Change Target và cả hai target dates; backend probe/domain tests chặn target
trước audit/network. Không thực hiện live PM/CFT target mutation.

Evidence local sanitized: `.cache/p7-types-initial.json`,
`.cache/p7-types-{type}-result.json`, `.cache/p7-types-audit.json`.
**Giới hạn:** đây là conditional-duration proof trên7 WO đại diện, không phải
positive proof cho schedule/PIC/allowed targets của mọi type, mọi WO hoặc discipline.
Schedule đủ non-null hiện có PM/REC/General; PIC non-null có MoD, các
type còn lại cần guarded exact-null restoration riêng. App upload non-CM vẫn khóa
đến khi coverage từng field và browser UAT đủ; PM/CFT target luôn cấm.

## Field contract bảy non-CM types — 2026-10-09

Phép thử operator-only Onshore test/E&I chạy tuần tự trên cùng bảy WO đại diện,
UTC02:23:03–02:27:16. Ngày lịch tăng1:07:13, PIC chuyển ANHTQ1, duration tăng0.25;
target tăng1:07:13 chỉ với explicit intent ở năm type được phép. Mỗi ca positive
được readback, rồi restore toàn bộ sáu trường gốc trước ca tiếp theo.

| Type | WO | Schedule / PIC / fraction | Target | Confirmed field item |
| --- | --- | --- | --- | --- |
| PM | P13469691 | Qua / exact restore | Cấm, không gửi | 1dd9b752-4957-4414-8e3b-0cddd4fd7d47 |
| CFT | H14302007 | Qua / exact restore | Cấm, không gửi | 81b85f2d-bb69-4346-9d95-21e9d9dbaf9b |
| REC | P13469038 | Qua / exact restore | Qua / exact restore | 7067ab92-c60e-4229-9380-099418610bf6 |
| OVERHAUL | P13468596 | Qua / exact restore | Qua / exact restore | 54fdd2ea-8488-4048-843d-ae5041aa5d71 |
| MoD | P13439902 | Qua / exact restore | Qua / exact restore | 72cc3d8c-5969-4ee7-85fb-3d1bca2c1368 |
| General | P13457667 | Qua / exact restore | Qua / exact restore | 4d0468cf-8b40-495d-94f8-64fb8413cb72 |
| Routine | H14306831 | Qua / exact restore | Qua / exact restore | 4c92485a-d32e-420b-a739-32304a3ccf4f |

CFT/OVERHAUL/MoD/Routine đã set ngày thật rồi restore exact original null pair;
PIC null được set rồi clear exact ở sáu type. MoD có PIC gốc SONNA ngoài crew hiện
tại: no-op gốc và restore SONNA đều204, ngoại lệ chỉ dành exact immutable original
trong operator harness. Không mở API tùy ý clear null hay gán PIC ngoài crew.

PM có side effect được đo: date-only request áp dụng ngày đúng nhưng estdur25→21;
restore ngày giữ21. Request chứa cả ngày gốc và estdur25 cũng vẫn readback21.
Item đầu dd6df59c-86ce-4cc8-ada5-05734214c754 dừng unknown; recovery hai phase
có plan/intent riêng, fresh rowstamp và exact readback đã trả đủ sáu trường gốc,
release thành failed/reconciled, giữ lịch sử. Phase duration-only không lặp request
ngày trước. Forward plan sau đó ghi actual duration và restore duration riêng sau
date restore; PM mới confirmed. Sáu type khác không đổi duration khi đổi ngày.
Chưa xác định server rule/calendar/config từ log; không suy nguyên nhân chỉ từ readback.

Audit độc lập:7 confirmed items,448 events,84 unique transaction IDs,84 durable
intent và84 matching results;7 wrong-token no-op412,77 request còn lại204.
Tất cả actor đúng, sáu trường cuối bằng initial originals; zero active reservations;
bốn source drafts cũ giữ version/membership. Main full backend616 tests qua
(4 known warnings), Ruff qua; focused field review trước live không còn P1.
Evidence: `.cache/p7-fields-types-initial.json`, `p7-fields-types-{type}-result.json`,
`p7-fields-types-audit.json`, `p7-fields-pm-restored-audit.json` và `p7-fields-full-tests.txt`.

Giới hạn: coverage bảy WO đại diện E&I trên Onshore test, chưa phải mọi WO/discipline.
App sender hiện hỗ trợ tám mã type đã có contract dưới explicit opt-in Onshore TEST
development/test; không còn gate riêng theo từng mã CM/PM/CFT so với nhóm còn lại.
PM browser upload/restore đơn ngày09/10 đã confirmed ba request204 và exact all6
original; PM nhóm và CFT duration-only đã qua mốc browser tiếp theo. Chủ dự án chốt
không nghiệm thu browser từng mã: tests mọi type và nhóm hỗn hợp theo quy tắc target.
Nhóm hỗn hợp PM/CFT/REC đã qua browser với7requests204/43events và exact all6original
sau restore từng WO; đây là một nhóm E&I Onshore TEST. Preview/readback PM và
restore hai phase ghi ở [upload workflow](upload-workflow.md). Các gate còn lại
giữ production/Offshore khóa; PM/CFT target luôn cấm, nhóm còn lại cần explicit intent.
Evidence `.cache/pm-browser-final-audit.json`,
`pm-group-cft-final-audit.json`. Khi Retrieve nhiều trang, Onshore TEST trả nextPage
sang host khác configured origin: backend từ chối `Unsafe paging response`, không
gửi request theo host được quảng bá. Monthly windows dùng trong UAT đã qua; xem
`.cache/pm-group-cft-read-diagnostic.json`. Chủ dự án xác nhận test dùng DB sao chép
production, nên đây là giới hạn test; chưa kiểm chứng production paging. Không sửa
cấu hình server hoặc bỏ guard trong bước gate theo hai nhóm.

## Đối chiếu IBM REST API Guide — 2026-10-08

Nguồn chính do chủ dự án chỉ định:
[Overview](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/overview/overview/).
IBM mô tả REST/JSON có từ7.6.0.2 và dùng cùng code base với OSLC REST APIs.
Do đó guide phù hợp làm reference cho7.6.1.3; không phải mọi tính năng trong guide
cập nhật hiện nay đều đã được xác minh trên bản cài Onshore. Overview khuyến nghị
`lean=1` trên mọi request, kể cả failover/load balancing; readers/probe hiện làm đúng.

| Nội dung | Tài liệu IBM | Đối chiếu mã và evidence |
| --- | --- | --- |
| Update bản ghi | [Create/update](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/create_and_update/): POST member URI, x-method-override PATCH | Harness dùng đúng method/header, JSON và lean1; live204/readback qua |
| Resource ID | Create/update: REST ID được sinh từ primary-key values, không phải MBO unique ID | Lấy resource ID từ href đã validate; không ghép workorderid vào URI hoặc dùng WONUM làm định danh duy nhất |
| Revision | [Selecting](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/selecting/): mỗi object có _rowstamp để xử lý dirty updates | Guide xác nhận mục đích; JSON placement và fresh/stale/pair/restore được chứng minh bằng live probe, không suy luận If-Match từ guide |
| Null representation | Selecting: mặc định bỏ thuộc tính null; _dropnulls=0 yêu cầu hiện null | GET thiếu selected field có thể là null; không đồng nghĩa payload update thiếu field sẽ clear. Write null/clear vẫn pending |
| Credentials | [API keys](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/authentication/apikey/): khuyến nghị apikey header, quyền theo Maximo user của key | Credential giữ server-side/header; Entra actor/scope và audit do app bổ sung, không giả định key đại diện mỗi planner |
| Duplicate requests | [Duplicate requests](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/duplicaterequests/): transactionid trùng trả409; retention mặc định5 phút, có thể đổi | Probe gửi UUID riêng mỗi intent. Chưa live thử duplicate409/retention; không thay durable app receipts hoặc cho phép blind retry khi unknown |
| Child collections | Create/update: PATCH child array có semantics thay thế; MERGE giữ/ghép children | Probe chỉ gửi root estdur và _rowstamp, không gửi snapshot/child arrays. Sender schedule phải giữ allowlist root fields |

Không có điểm method/lean/API-key/resource URI nào cần sửa thêm trong probe hiện tại.
Không đổi endpoint thành `/api`, object structure, server configuration hoặc bật gate
chỉ vì ví dụ trong guide. Verified write contract vẫn là configured Onshore test bên dưới;
không gọi thêm mutation trong lượt đối chiếu tài liệu này.

## Field contract Onshore test — 2026-10-08

Audited operator harness `--field-contract` trên P13463520/BD1/523961, item
`05bdf081-83c4-4c28-b850-2adc738bcf5f`, đã qua và khôi phục exact original baseline.
Wrong-token no-op412; mười request kế tiếp204, mỗi request dùng native JSON rowstamp
vừa đọc và có committed intent trước gửi. Một reservation giữ xuyên suốt phép thử.
UTC15:15:12.325307–15:15:16.778519 (22:15 Onshore), 59 audit events;
complete audit `a3135f14-8f28-4ef5-bbb5-f670fa870f64`. Rowstamp ban đầu3624646778,
sau positive/restore lần lượt3624701606/1610 (duration),1614/1618 (schedule),
1622/1626 (PIC),1630/1636 (target); các suffix cùng prefix362470.

| Ca thử | Payload / read-back | Khôi phục |
| --- | --- | --- |
| Fractional duration | estdur20→20.25 giờ, đọc lại chính xác, không bị scale0 metadata làm tròn |20.0 exact |
| Schedule dates | schedstart/schedfinish cùng +1h7m13s, offset+07; đọc lại19:13:13 đúng từng instant |18:06:00 exact |
| PIC | ANHTQ1 thuộc crew E&I hiện tại, đọc lại đúng | original null exact; null no-op đã được thử trước positive |
| CM target | targstartdate/targcompdate cùng +1h7m13s với explicit target intent, đọc lại đúng | original dates exact |

Sau từng ca khôi phục, toàn bộ baseline so sánh đúng, gồm các trường không gửi.
Null chỉ được thử/cho phép trong harness để khôi phục đúng PIC ban đầu; app vẫn từ
chối explicit clear. Chưa thử null dates, empty PIC, subsecond hoặc mọi min/max/length;
không coi một fractional case là bằng chứng mọi precision đều được chấp nhận.
PM/CFT target bị domain validation chặn trước intent/network trong synthetic tests;
không đổi target PM/CFT live. Các connection/discipline/WO type khác chưa nghiệm thu.
Sender ứng dụng đang tích hợp, không coi field harness là upload từ nháp trên browser.

## Probe ghi có audit ngày 08/10

[Harness](../backend/probe_write_contract.py) chỉ chạy configured Onshore/test trong
ứng dụng non-production, có active Entra-derived session, PERSON và scoped Planner.
Một reservation WO giữ xuyên suốt phép thử; từng POST có intent commit trước network.
Token sai dùng no-op duration hiện tại, không thử unconditional. Unknown giữ reservation;
`--reconcile-item` chỉ đọc remote và chỉ giải phóng `unknown` khi baseline nguyên trạng.
Không reconcile `sending` khi request còn có thể chạy; standard draft reconcile không
dùng cho probe vì probe có audit riêng thay vì `prepared` của draft.

P13463520/BD1/523961: If-Match `9223372036854775807` no-op trả 412 `BMXAA8229W`;
If-Match `0` với đề xuất estdur 20.25 cũng trả 412 cùng mã. GET đọc lại estdur 20.0
và toàn bộ baseline nguyên trạng, rowstamp 3235810749. Item
`17b1bd50-5301-41ea-8d70-21546b3df0d4` kết thúc `failed`, không giữ reservation.
Không có cập nhật WO thành công; không chạy stale/pair/restore khi token hiện tại bị từ chối.
Đây là bằng chứng ETag quảng bá không dùng được trong representation này, không phải
bằng chứng endpoint không hỗ trợ mọi conditional token.

Probe thứ hai chọn rõ `--token-source rowstamp_candidate`, không thay advertised ETag
và không nối vào sender ứng dụng. Sai sentinel no-op trả412; exact single-resource
rowstamp `3235810749` no-op cũng trả412 `BMXAA8229W`. Item
`3942d1c2-9f4d-4dab-bfed-4fb388ee5529` failed; GET baseline vẫn nguyên estdur20.0.
Không chạy positive/stale/pair/restore sau support no-op bị từ chối. Không có thay đổi
WO thành công trong cả hai probe. ETag0 và raw rowstamp-as-If-Match đều chưa dùng được;
không tự suy luận quoting, dùng revision nháp hoặc fallback unconditional.

Kiểm chứng mã: 439 backend tests qua (full suite gồm PostgreSQL, Windows/Docker
rehearsal), Ruff qua; riêng suite probe 127 tests gồm9 PostgreSQL qua. PG probe dùng
UUID schemas/synthetic actors, commit visibility bằng connection độc lập, reservation
và authority denial; không phải runtime/staging acceptance hay crash process thật.
Không thêm dependency/migration, không bật upload app hoặc đổi cấu hình server Maximo.

### Sửa representation và kiểm chứng JSON rowstamp — 08/10

Hợp đồng đã kiểm chứng trên cùng resource là POST override PATCH với `_rowstamp`
nguyên giá trị từ single-resource GET trong JSON, không gửi If-Match trong chế độ
`rowstamp_body_candidate` được chọn rõ. Đây là điều kiện phiên bản thay thế đã thử,
không phải fallback unconditional hoặc dùng revision nháp. Tài liệu chính thức
[IBM Selecting](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/selecting/)
xác nhận `_rowstamp` của từng object dùng xử lý dirty updates; vị trí JSON và hành vi
thực tế được chứng minh bằng phép thử bên dưới, không suy luận từ ETag `0`.

Item `38f274be-2eee-4d47-873d-eb3bdf6c6657`: wrong-token no-op412;
current-token no-op204; fresh update204; stale-token no-op412; hai request đồng thời
cùng token trả204/412; conditional restore204. GET xác nhận toàn bộ baseline ban đầu
đã khôi phục, estdur20.0, không thay PIC/ngày. Mỗi POST có intent commit trước gửi;
reservation giữ xuyên suốt và giải phóng sau verified restore. App vẫn chưa có sender.

Thời gian UTC10:39:24.800112–10:39:26.817909 ngày08/10 (17:39 Onshore).
Rowstamp `3235810749` → `3624646770` khi estdur20→21 → `3624646774` khi pair
winner ghi22 (request23 bị từ chối) → `3624646778` khi restore20. ETag vẫn `0`.
29 audit events: intent1/probe1/observation11/contract_intent7/contract_result7/
readback1/confirmed1; final readback audit `a8830683-2c2b-4206-b19e-b1c7d797f6d5`.
Ví dụ business mutation đã qua (API key không ghi vào tài liệu):

```http
POST /maximo/oslc/os/oslcmxwodetail/_QkQxL1AxMzQ2MzUyMA--?lean=1
x-method-override: PATCH
Content-Type: application/json
Accept: application/json

{"estdur":21.0,"_rowstamp":"3235810749"}
```

Full backend453 tests qua trước sửa classification cuối; sau sửa148 targeted tests
qua, gồm10 PostgreSQL. Ruff lint/format qua. Không thêm dependency/migration.

Sửa thêm bộ nhận diện conflict trong harness: body412 phải có BMXAA8229W và không
chỉ rõ child MBO; body400/409 phải chỉ rõ WORKORDER. Response412 không có tên MBO
không còn bị nhận nhầm là thiếu bằng chứng conflict. Không coi negative412 riêng lẻ
là contract đạt: current-token/readback/stale/pair/restore vẫn bắt buộc. Probe trước
đó item `8b150a2c-6a05-445c-82c8-dc8c84808c59` dừng tại negative vì parser quá chặt;
baseline nguyên trạng, failed/reservation released, không có positive request.

### Chẩn đoán read-only và phạm vi còn lại

Schema tại cùng configured `/maximo/oslc/jsonschemas/oslcmxwodetail` trả root
`WORKORDER`; identity và sáu schedule fields persistent, `_rowstamp` type string,
estdur type DURATION/number/scale0. Metadata không chứng minh plumbing rowstamp của
MBO/view/DB hoặc write rounding. Route schema theo
[IBM JSON schema documentation](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/jsonschema/jsonschema/).
Conditional GET cùng resource với If-None-Match raw/quoted0 và raw/quoted rowstamp
đều200/ETag0, không304. Chỉ là observed behavior, không kết luận nguyên nhân server.
Workspace không có quyền đọc server logs/configuration. Logs của quản trị Maximo
có thể giải thích ETag0/header rejection, nhưng không còn là điều kiện bắt buộc để
tiến tiếp trên Onshore test: body revision precondition đã qua thực nghiệm. Chưa kết
luận nguyên nhân server/proxy và không đổi settings hoặc tự gửi IT. Giữ upload khóa
đến khi field normalization/rounding/date/PIC/null/target và sender ứng dụng được
kiểm chứng. Kết quả này chỉ áp dụng configured Onshore test/resource đã thử.

Thời điểm intent commit UTC ngày2026-10-08; `transactionid` gửi nguyên attempt UUID.
Giờ Onshore UTC+07 tương ứng16:11 và16:14. Mọi response đều412/BMXAA8229W.

| UTC | transactionid | Label / source | If-Match |
| --- | --- | --- | --- |
| 09:11:17.469610 | `88952e5a-4dcd-4b72-bb92-b054e83527da` | wrong_token / advertised_etag | 9223372036854775807 |
| 09:11:17.820759 | `d3393371-04e8-4f0a-b3cc-6d3380ea9e62` | fresh_token / advertised_etag | 0 |
| 09:14:57.155295 | `41482875-bdf9-466b-82bb-500529e67e83` | wrong_token / rowstamp_candidate | 9223372036854775807 |
| 09:14:57.435240 | `8c008a3c-367e-4b6f-8ba4-b001b003de70` | candidate_support_noop / rowstamp_candidate | 3235810749 |

Hai dòng đầu thuộc item17b1bd50-5301-41ea-8d70-21546b3df0d4; source được xác định
từ chế độ mặc định đã chạy, chưa có field token_source riêng trong intent ban đầu.
Hai dòng cuối thuộc item3942d1c2-9f4d-4dab-bfed-4fb388ee5529 và lưu source trong audit.
Mỗi item11 append-only events:2 contract_intent,2 contract_result,4 contract_observation,
1 contract_probe,1 intent transition,1 failed. GET baseline_exact_original=true,
không có probe active/unknown; không retry các requests này.

## Bằng chứng GET Onshore test ngày 08/10

Chủ dự án cho phép chọn WO trong danh sách tải sẵn trên server test. GET tháng 10
trả 117 WO E&I, có 7 CM phù hợp probe; chọn P13463520, site BD1, WOID 523961,
orgid BDPOC, CM/WMATL, connection `aab45085-e84f-4273-82d2-960b1f26c3da`.
PERSON hiện tại và quyền scoped Planner đã được recheck trước/sau probe.

[Probe GET](../backend/probe_contract.py) chỉ chạy development/test với connection
DB test đã cấu hình, kiểm tra stable identity/binding/grant/Planner và bounded GET.
Href quảng bá origin `https://maximo.biendongpoc.vn`; không theo origin này và không
gửi key sang đó. Chỉ lấy resource ID hợp lệ rồi GET trên origin test đã cấu hình:
`/maximo/oslc/os/oslcmxwodetail/_QkQxL1AxMzQ2MzUyMA--`.

Single-resource trả 200, ETag nguyên văn `0`, collection không có ETag. Các GET
`lean=1`, SELECT `*`, SELECT fields + `_rowstamp`, và `etag=true` đều trả ETag `0`;
JSON `_rowstamp` là `3235810749`, không có Last-Modified. Probe phân loại token
`numeric_candidate`, `strong_etag=null`; không tự thêm quotes hoặc thay bằng rowstamp.
Baseline: estdur 20.0, PIC null; schedstart/targstartdate 01/10 18:06 +07,
schedfinish/targcompdate 31/10 18:06 +07. Chưa thay bất kỳ giá trị nào.

IBM có ví dụ If-Match số trong partial update bên dưới. Tài liệu
[concurrent updates](https://www.ibm.com/docs/en/control-desk/7.6.1?topic=methods-concurrent-updates-resources)
nói về rowstamp của REST business-object/object-structure resources; chưa chứng minh
OSLC endpoint đang dùng chấp nhận `_rowstamp` làm If-Match. ETag `0` không tự chứng
minh conditional update có hoặc không có. Body `_rowstamp` sau đó đã qua success,
stale rejection, concurrent update và restore/read-back; xem bằng chứng ở trên.
Không fallback unconditional và không coi kết quả Onshore test áp dụng mọi connection.

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
| Identity và endpoint | Connection UUID + siteid + workorderid; orgid, resource href và single-resource GET đã đối chiếu; credential destination phải giữ configured origin | Onshore test CM GET/href/orgid qua 08/10; không theo advertised origin khác |
| Quyền và WO thử | CM/PM/CFT cụ thể, fields được đổi, actor, window, conflict và restore | Chủ dự án cho phép mọi thử cần thiết trên Onshore test; operator field proof bảy type, browser CM/PM đơn/PM nhóm/CFT duration đã chạy; exact restore và actor audit xác nhận |
| Method/headers | POST override PATCH, Content-Type/Accept, lean representation; không child arrays | Onshore test JSON `_rowstamp` + estdur qua204/readback; app chưa nối |
| Revision | Exact source/header/body và phạm vi token theo representation | ETag0 và rowstamp-as-header bị412; native JSON rowstamp qua fresh/stale/pair/restore; snapshot app vẫn `None` |
| Dates | Offset/timezone, precision, giờ mặc định, DST nếu có; schedfinish tính giờ liên tục hay ca; write/read-back normalization | Onshore timezone Asia/Ho_Chi_Minh; giờ liên tục ở UI |
| Null/clear | Missing nghĩa không đổi; null/empty/date/PIC clear được chấp nhận hay từ chối riêng từng field | Explicit clear bị từ chối hiện tại |
| PIC/duration | Membership/group, giới hạn tên PIC, estdur đơn vị/min/max/scale/rounding và kiểu JSON | PIC E&I GET qua; write bounds/rounding chưa chốt |
| Allowlist/target | schedstart/schedfinish/assignedtechname/estdur; targstartdate/targcompdate chỉ khi explicit intent, cấm PM/CFT; không status/discipline/arbitrary fields | Backend nháp đã validate; remote chưa thử |
| Response/errors | Success code/body, validation/auth/conflict codes, redacted errors; read-back/timeout | Live204 và412 BMXAA8229W, readback/restore qua; timeout remote chưa thử |

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

- [x] Chủ dự án cho phép mọi thử nghiệm cần thiết trên Onshore test 08/10;
      harness CM duration có durable audit, no-op negative, conditional restore/recovery.
- [ ] Single-resource href/orgid/identity và token được xác minh cho từng connection.
- [x] Onshore test CM duration: current-token success, stale-token rejection không đổi
      giá trị, same-token concurrency và exact-baseline restore qua08/10; connection khác chưa thử.
- [ ] Date/null/PIC/duration/target/error hợp đồng có evidence và fixtures đã redaction.
- [ ] DB runtime không sửa/xóa audit hoặc gỡ trigger; giữ receipts và unknown outcomes.
- [ ] Tenant/PERSON/Planner/staging và quyền integration account nghiệm thu đúng scope.

Nếu conditional update không được hỗ trợ, ghi rõ race giữa read và write, giữ cổng
upload đóng và đưa phương án cho chủ dự án/IT quyết định lại. Không tự fallback sang
unconditional write. Orchestration/audit/dedup/read-back có thể được triển khai và
kiểm thử với transport giả trước contract; xem [mốc P7](upload-workflow.md).
Chỉ nối sender thật sau khi contract được kiểm chứng. Preview/submit gate và tests
synthetic không được dùng làm bằng chứng conditional write hoặc quyền ghi live.
