# Workflow BD_WO và đề xuất Route đến Tech PIC

Cập nhật: 2026-10-23. Trạng thái: **đã route thử thành công một WO trên Onshore test bằng REST**
(mục "Kết quả thử route", cuối tài liệu). Ứng dụng chưa có code workflow; thiết kế tính năng ở
[workflow-route-design.md](workflow-route-design.md). Tài liệu tham chiếu:
[IBM REST API – Workflow](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/workflow/workflow/).

## API IBM (bản chung, chưa nghiệm thu đủ trên 7.6.1.3)

| Việc | Request |
| --- | --- |
| Khởi động workflow | `POST /oslc/os/<os>/{rest id}?action=workflow:<TÊN>` + `x-method-override: PATCH` |
| Việc chờ của **tài khoản đang gọi** | `GET /oslc/os/mxapiwfassignment` |
| Hoàn thành việc | `POST /oslc/os/mxapiwfassignment/{id}?action=wsmethod:completeAssignment`, body `{"memo","accepted"}` |
| Chọn ở input node | `POST <Location trả về>`, body `{"actionid","memo"}`; không gọi thì workflow đứng ở bước trước |
| Interaction node | `POST <Location>`, body `{"interactioncomplete": 1}` |

## Đã kiểm chứng trên Onshore test (GET, 2026-10-19)

- `mxapiwfprocess` đọc được. `BD_WO` rev 27 (wfprocessid 5350, active, "Work Order - Reassign
  on Tech PIC", sửa lần cuối 2026-10-15 bởi MAXADMIN), 98 node.
- `mxapiwfassignment` với tài khoản tích hợp trả 0 bản ghi: tài khoản này không có việc nào.
- `mxapiwodetail` có quan hệ `rel.wfassignment` và `rel.wftransaction` (không có `wfinstance`).
  Dùng được để đọc trạng thái workflow của từng WO trước và sau khi gửi.
- `ASSIGNEDTO` không cho truy vấn trong `oslc.where` (BMXAA4184E), nhưng đọc được trong `select`.
- `mxapirole`/`mxrole` không tồn tại; định nghĩa role `WO ASS` chưa đọc được.

## Đường đi từ node 20 đến technician

| Node | Loại | Nội dung |
| --- | --- | --- |
| 20 | TASK `DISPSUP` | role `WO DISPSUP`; việc giao cho tài khoản chung theo discipline (ví dụ `ENISUP`, `MECHSUP`) |
| 101 | INPUT | 427 "Route to Tech PIC for execution" (WO APPR); 431 Modify Plan; 428 Route to Onshore PIC; 432 Defer |
| 51 | CONDITION | `status in (APPR, WSCHED, SCHED, WMAT, WPCOND, CPLAN, WMATL)`; sai → interaction 52 → về 20 |
| 22 | CONDITION | `SCHEDSTART` và `SCHEDFINISH` khác null; sai → interaction 27 → về 20 |
| 43 | CONDITION | `ASSIGNEDTO` và `ASSIGNEDDATE` khác null; sai → interaction 44 → về 20 |
| 34 | TASK `TECH` | action 65 đặt WO SCHED; role `WO ASS`; điều kiện tạo việc `:&APPNAME&='PLUSGWO'` |

Bằng chứng thật: 6 WO SCHED gần nhất có việc ACTIVE ở node 34 với
`assigncode = assignedto = assignedtechname`. P13470861 có chuỗi giao dịch đúng như trên:
ACCEPT 426 ở node 20, WFACTION 427 ở node 101, rồi TRUE ở 51/22/43. Người thực hiện là
`DECKFMHSE`, tài khoản chung chứ không phải tài khoản cá nhân.

## Nhánh PM có status SCHED sẵn

PM sinh ra đã ở SCHED nên không đi qua node 20 mà đi theo nhánh khác:

| Node | Loại | Nội dung |
| --- | --- | --- |
| 1 → 3 | START → CONDITION | không phải WAPPR → node 68 |
| 68 | CONDITION | `STATUS IN (WPLAN, SCHED, WMATL)`; đúng → action 279 chạy `DIVESTDUR` rồi sang 40; sai → STOP |
| 40 | TASK `DISPSUP` | role `WO DISPSUP` (ví dụ `ENISUP`); action 436 → INPUT 106 |
| 106 | INPUT | **437** "Route to Tech PIC for execution"; 439 Modify Plan; 441 Onshore PIC; 438 Defer |
| 53 → 45 → 46 | CONDITION | status (có SCHED) → `SCHEDSTART/SCHEDFINISH` → `ASSIGNEDTO/ASSIGNEDDATE`; sai → interaction 54/48/47 → về 40 |
| 34 | TASK `TECH` | action 70 (WO SCHED); role `WO ASS`; cùng điều kiện `&APPNAME&` |

Bằng chứng (GET, 2026-10-19), 200 PM SCHED mới nhất ở BD1:

| Trạng thái workflow | Số WO | PIC / ASSIGNEDTO / ASSIGNEDDATE |
| --- | --- | --- |
| Đã route, đang ở node 34 | 25 | đủ cả ba |
| Đang chờ ở node 40 | 22 | chưa có PIC |
| Không có workflow | 153 | chưa có PIC; 133 WO đã có lịch |

- WO có workflow được khởi động bởi người dùng hệ thống `WORKFLOW` vào khoảng 02:00, cùng phút với
  `reportdate`, tức là lúc sinh WO.
- Chủ dự án xác nhận ngày 2026-10-22: chỉ WO cha có workflow assignment. Mẫu mới 200 PM SCHED cùng
  ngày khớp hoàn toàn: 52/52 WO cha có workflow ACTIVE, 148/148 WO con chưa từng có workflow. Ứng
  dụng chỉ đọc WO cha (`parent!="*"`), nên mọi WO trong danh sách đều có thể route theo workflow.
- H14288340: ENISUP ACCEPT 436 ở node 40, WFACTION 437 ở node 106, rồi TRUE ở 53/45/46. WO đã ở
  SCHED vẫn đi qua action `WO SCHED` của bước 46 → 34 mà không lỗi.
- Action `DIVESTDUR` (script "DIVIDED EST DUR WHEN WORKORDER IS GENERATED", trạng thái **Draft**)
  gọi stored procedure `divestdurchildren(wonum)` bằng SQL trực tiếp để chia estdur cho các WO con,
  không qua Maximo và không đổi `_rowstamp`. Nếu ứng dụng tự khởi động BD_WO cho PM, action này
  có thể chạy (khi script active), sửa estdur của task con mà nháp và kiểm tra phiên bản của ứng
  dụng không thấy.

Hệ quả cho route PM: giống CM, nhưng ở node 40 và action **437** (không phải node 20/427). Ứng
dụng không cần và không nên tự khởi động BD_WO. WO cha không có việc ACTIVE thì báo lỗi, không route.

## Tài khoản route theo position

Chủ dự án xác nhận ngày 2026-10-22: việc ở node 20/40 chỉ thuộc 4–5 tài khoản position. Dữ liệu GET
cùng ngày (928 WO cha mở ở BD1) cho thấy ánh xạ 1:1 với `bdpocdiscipline`:

| Discipline | Tài khoản | Node 20 | Node 40 |
| --- | --- | --- | --- |
| E&I | `ENISUP` | 120 | 250 |
| MECH | `MECHSUP` | 108 | 159 |
| PROD | `FIELDPRODSUP` | 3 | 44 |
| RES | `RES` | 0 | 9 |
| DECK | `DECKFMHSE` | 2 | 17 |

Đề xuất: **mỗi tài khoản position có một API key Maximo, lưu ở server** theo cùng cách với
`api_key` của tài khoản tích hợp (cấu hình theo kết nối và discipline). Key chỉ dùng cho
`completeAssignment` và lựa chọn ở input node; mọi lần đọc và ghi trường vẫn dùng tài khoản tích hợp.
Server chọn key theo discipline của grant hiện hành và discipline của WO, không bao giờ theo dữ liệu
trình duyệt gửi lên.

Không nên làm màn hình để Planner nhập mật khẩu Maximo của tài khoản chung, vì:
- Mật khẩu chung sẽ đi qua ứng dụng; Onshore test chỉ có HTTP, nên `maxauth` sẽ bị gửi dạng rõ.
- Ứng dụng phải giữ phiên Maximo (cookie) cho từng người, xử lý hết hạn và đăng nhập lại.
- Nhập mật khẩu không chứng minh thêm điều gì: ai biết mật khẩu chung đều nhập được, còn quyền đã do
  grant của Entra và PERSON quyết định.

Cấu hình (đã có trong `app/config.py`, chưa có code dùng): trong `backend/.env`, mỗi kết nối một dòng

```text
WOS_MAXIMO__<connection-uuid>__WORKFLOW_ROUTE_ACCOUNTS={"E&I":{"personid":"ENISUP","api_key":"..."}}
```

Key là `SecretStr`, không hiện trong log hay repr. Cấu hình chỉ được chấp nhận khi
`WOS_ENVIRONMENT` là development/test; staging/production từ chối khi khởi động.

Kiểm tra chỉ đọc bằng key ENISUP test (2026-10-23):

| Request | Kết quả |
| --- | --- |
| Nạp cấu hình `workflow_route_accounts["E&I"]` | đạt, `personid=ENISUP` |
| `GET /oslc/whoami` | 200, `personid=ENISUP`, defaultSite BD1 |
| `GET mxapiwodetail` và `BDSCHED_WO` với `rel.wfassignment` (P13467327) | 200; thấy việc 1645243, ACTIVE, node 20, rev 27, `assigncode=ENISUP` |
| `GET mxapiwfassignment` | **400 BMXAA0024E: "The action READ is not allowed on object WFASSIGNMENT"** |

Chủ dự án xác nhận ngày 2026-10-23: object structure dùng cho workflow assignment là
**`BDWF_ASGN`**, không phải `MXAPIWFASSIGNMENT`. **(Đã thay thế cùng ngày: sau khi cấp quyền,
`MXAPIWFASSIGNMENT` là object structure đúng cho phần ghi; xem "Kết quả thử route".)** Đọc bằng key ENISUP:

| Request | Kết quả |
| --- | --- |
| `GET BDWF_ASGN` | 200; 440 việc ACTIVE của ENISUP. BD_WO rev 27: 248 ở node 40, 111 ở node 20, 18 ở node 30, 15 ở node 9, 2 ở node 6. Còn việc của rev cũ 25/26/18 và các workflow khác (SR, BD_MSR, HSE_ACT_TR, AUDITWF) |
| `GET BDWF_ASGN?oslc.where=wfassignmentid=1645243` | 200; P13467327 (ownerid 531789), node 20, rev 27, `origperson=ENISUP`, `app=PLUSGWO`; một action 426 → node 101 |
| `GET <wfaction>/e3mwfinput` (đã đổi về host test) | 200; INPUT 101, wfinputid 5672 |

Hệ quả cho thiết kế:
- Chỉ chấp nhận việc có `processname=BD_WO`, đúng rev đã cấu hình, `ownertable=WORKORDER`,
  `ownerid` bằng workorderid của WO, `nodeid` là 20 hoặc 40. Bỏ qua việc của rev cũ và workflow khác.
- Việc có `app=PLUSGWO`, nên cần thử xem điều kiện `&APPNAME&` ở node 34 có đạt khi route qua REST.
- Các link `localref`/`*_collectionref` trong phản hồi dùng host công bố `maximo.biendongpoc.vn`.
  Phải đổi về kết nối đã cấu hình bằng logic hiện có (`paging_origin_aliases`) trước khi gọi, và
  không bao giờ gửi key tới host trong link.

**Sự cố 2026-10-23:** một lệnh khảo sát đã gọi thẳng `wfinput_collectionref` mà không đổi host, nên
key ENISUP test bị gửi một lần tới `https://maximo.biendongpoc.vn` (GET, chỉ đọc). Host đó trả
BMXAA9549E (token không hợp lệ), tức đây là một Maximo khác với hệ thống test. Cần xoay key ENISUP test.

Ghi nhận người thực hiện: Maximo ghi tài khoản position (ví dụ `ENISUP`). Audit của ứng dụng ghi
người dùng Entra; memo gửi Maximo ghi tên Planner. Nên thêm quyền "route" riêng trong Planner
permissions (migration 0006) thay vì mặc định mọi Planner có quyền sửa đều route được. Nhiều Planner
cùng discipline dùng chung một tài khoản, nên ứng dụng phải giữ khóa theo WO khi route (giống
reservation khi upload).

## Kết quả thử route (Onshore test, 2026-10-23)

Các lần thử ghi, theo thứ tự. Mọi lần đọc lại dùng API key; các lần ghi dùng phiên `maxauth` của
ENISUP do chủ dự án tự nhập trong terminal (mật khẩu không vào log, doc hay file).

| # | Cách gọi | Kết quả |
| --- | --- | --- |
| 1 | `BDWF_ASGN`, API key, `completeAssignment` không có `x-method-override` | 500 `BMXAA1649E` (null pointer). Việc không đổi |
| 2 | Như 1 nhưng có `x-method-override: PATCH` (đúng tài liệu IBM) | 200, input node 101 với 4 lựa chọn, header `Location` |
| 3 | `POST Location` chọn 427/437, API key | 400 `oslc#invlaidwfinstid` |
| 4 | Như 3, `maxauth` cùng một phiên | Vẫn `invlaidwfinstid`; `GET Location` 500; `x-method-override`, `actionid` dạng chuỗi, đường dẫn viết hoa, `…/bdwf_asgn/<id>` đều thất bại |
| 5 | `MXAPIWFASSIGNMENT` (sau khi admin cấp quyền cho nhóm của ENISUP), `maxauth` | `Location` = `…/oslc/wf/mxapiwfassignment_<n>` trên host test; chọn 437 chạy, nhưng node 34 không tạo việc (`BMXAA4473E` ở lần POST đầu, 200 ở lần có `x-method-override`) |
| 6 | Như 5 trên H14323938 (PM, đủ điều kiện lịch/`ASSIGNEDTO`) | Y hệt: qua node 53/45/46 rồi mất việc |
| 7 | Như 5 sau khi admin **bỏ điều kiện** của dòng assignment ở node 34 | **Thành công** (P13461222): chọn 437 trả 200 ngay lần đầu, việc ACTIVE mới ở node 34 cho `ASSIGNEDTO` (VIETLV) |

Kết luận kỹ thuật:

- **Object structure phải là `MXAPIWFASSIGNMENT`.** `BDWF_ASGN` (tên tự đặt có gạch dưới) hoàn thành
  được việc nhưng không tìm lại được instance ở input node (`invlaidwfinstid`). Các link của
  `MXAPIWFASSIGNMENT` trỏ đúng host test, không cần đổi host; vẫn phải kiểm tra host trước mọi lần gửi.
- **API key không giữ phiên HTTP**: Maximo cấp `JSESSIONID` mới ở mỗi request kể cả khi gửi lại cookie, nên
  trạng thái "đang chờ chọn ở input node" mất. **`maxauth` (base64 `user:password`) giữ phiên**: cookie
  chỉ cấp một lần, các request sau tái dùng. Phần ghi phải đi trong một phiên `maxauth`; phần đọc dùng API key.
- Hai bước trong **cùng một phiên**: (1) `POST <href>?action=wsmethod:completeAssignment` với header
  `x-method-override: PATCH`, body `{"memo","accepted":true}`; (2) `POST <header Location>` với
  `{"actionid","memo"}`. Chọn lựa chọn theo **tên** ("Route to Tech PIC for execution"): action id là
  427 ở node 20 và 437 ở node 40. `GET` vào `Location` luôn trả 500 (không hỗ trợ), không cần gọi.
- **Điều kiện `:&APPNAME&='PLUSGWO'` của dòng assignment ở node 34 làm hỏng route qua REST** (không có
  ngữ cảnh ứng dụng): workflow đi qua node 53/45/46 rồi node 34 không tạo assignment, Maximo báo
  `BMXAA4473E` ("task TECH không có người sở hữu"), và WO **mất khỏi hàng đợi, không còn việc nào**. Chủ dự án
  bỏ điều kiện này (sửa tại chỗ rev 27 lúc 2026-10-23 15:31, MAXADMIN) thì route chạy đúng. Role `WO ASS`
  chính là `:ASSIGNEDTO` của WO (chủ dự án xác nhận).
- Dấu vết giao dịch của lần thành công (`rel.wftransaction`): `WFASSIGNCOMP` node 40, `ACCEPT` 436,
  `WFACTION` 437 ở node 106, `TRUE` ở node 53, 45, 46, và việc mới ở node 34 (`wfassignmentid` 431636,
  `roleid` WO ASS, `assigncode` = `ASSIGNEDTO`). Readback thành công = một việc ACTIVE ở node 34 có
  `assigncode` bằng `ASSIGNEDTO`.
- Trạng thái dở dang cần admin xử lý (khởi động lại workflow BD_WO): **P13457863** và **H14323938** (route
  khi điều kiện node 34 còn ở bản cũ). Ứng dụng không tự khôi phục được trạng thái này, nên thiết kế
  phải kiểm tra định nghĩa node 34 trước khi route và báo "mất việc" rõ ràng nếu readback không thấy việc mới.
- Dữ liệu điều kiện: WO sạch để route phải có status trong danh sách, `SCHEDSTART`/`SCHEDFINISH`,
  `ASSIGNEDTO` và `ASSIGNEDDATE` (thiếu một trong hai cuối thì rơi vào interaction 44/47 và quay lại).
  Trong 225 PM SCHED ở node 40, chưa có PM nào có PIC; `ASSIGNEDTO` chỉ được đặt khi có người gán, và
  `assignedtechname` không tự sinh `ASSIGNEDTO` trong mọi trường hợp (P13468983: PIC có, `ASSIGNEDTO` trống).

## Điểm chặn và câu hỏi mở

1. **Tài khoản thực hiện.** Đã chốt (2026-10-23): phần ghi (route) dùng phiên `maxauth` của tài khoản
   position do Planner nhập; phần đọc/kiểm tra dùng API key của tài khoản position lưu ở server. Key ENISUP
   test đã có; còn 4 tài khoản khác (MECHSUP, FIELDPRODSUP, RES, DECKFMHSE) chưa thử. Cần cấp `MXAPIWFASSIGNMENT`
   cho nhóm bảo mật của từng tài khoản. (Mục này ghi hướng ban đầu bằng API key, nay đã thay.)
2. **`ASSIGNEDTO`/`ASSIGNEDDATE`.** *(Vẫn mở: ghi `ASSIGNEDTO` qua ứng dụng chưa thử.)* Chủ dự án xác nhận ngày 2026-10-23: **`ASSIGNEDTO` là trường
   cần ghi**, và role `WO ASS` dùng nó để giao việc cho người đó. Ứng dụng hiện ghi
   `assignedtechname` (`app/maximo/sender.py`), không ghi `ASSIGNEDTO`. Có WO đã có `assignedtechname`
   nhưng thiếu `ASSIGNEDTO` (P13468026, P13469762). Cần thử trên một WO test: ghi `ASSIGNEDTO` qua
   `BDSCHED_WO` có được phép không, có tự điền `ASSIGNEDDATE` và `assignedtechname` không. Nếu
   thiếu một trong hai trường, route sẽ rơi vào interaction 44/47 và quay về node 20/40.
3. **`&APPNAME&`.** *Đã xác nhận và xử lý (2026-10-23).* Qua REST điều kiện này sai nên node 34 không tạo
   việc; chủ dự án bỏ điều kiện ở rev 27 thì route chạy. Còn lại: khi đổi rev hoặc khôi phục điều kiện,
   ứng dụng phải phát hiện và khóa tính năng (xem thiết kế).
4. **Interaction node 52/27/44.** Chưa gặp trên test (các WO thử đều đủ điều kiện). Ứng dụng phải kiểm tra
   điều kiện trước khi route để tránh vào interaction, và nếu gặp thì dừng, báo lý do, không tự
   gửi `interactioncomplete`.
5. Đây là loại ghi mới ngoài sáu trường được phép trong AGENTS.md; cần chủ dự án duyệt.

## Hợp đồng đề xuất (chưa triển khai)

1. Chỉ cho WO đã đồng bộ lịch/PIC thành công; kiểm tra lại quyền, discipline và trạng thái ngay
   trước khi gửi.
2. Đọc `rel.wfassignment`: phải có đúng một việc ACTIVE, `processname=BD_WO`, đúng rev đã cấu
   hình, `nodeid` là 20 (chọn 427) hoặc 40 (chọn 437); đọc lại `assignedto`, `assigneddate`,
   `schedstart`, `schedfinish`. Không có workflow (nhiều PM) → không route, báo "chưa có workflow".
3. Ghi audit intent bền vững, sau đó `completeAssignment` (accepted=true) rồi chọn action theo node.
4. Đọc lại: thành công khi có việc ACTIVE ở node 34 với `assigncode` bằng PIC và status SCHED.
   Mọi kết quả khác, hoặc timeout, ghi là chưa rõ và không gửi lại; xử lý dựa trên readback.
5. Tên quy trình, rev, node và action id cấu hình theo từng kết nối; đổi rev thì khóa tính năng.
