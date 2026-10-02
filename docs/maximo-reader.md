# Maximo reader — mốc chỉ đọc

Đã có `GET /api/work-orders`, kiểm thử HTTP giả cùng PostgreSQL thật. Onshore test đã đọc
WO và crew E&I live ngày 2026-10-02; các hệ thống/phạm vi khác chưa được kiểm chứng.
đã nối bảng chỉ đọc /work-orders ngày 2026-09-30; API detail/PIC và draft được bổ sung 2026-09-30; chưa có upload. VBA chỉ được đọc tĩnh;
không chạy macro, không lấy hoặc tái sử dụng key trong workbook.

## Hợp đồng API web

Cần session Entra hợp lệ và grant read/write đúng connection + discipline. Bốn query params:

- `connection_id`: UUID cấu hình trong DB, không phải hostname.
- `discipline`: chọn trong grants được cấp, kiểm tra lại trên server.
- `target_from`: thời điểm ISO 8601 có offset, bao gồm mốc đầu.
- `target_before`: thời điểm ISO 8601 có offset, không bao gồm mốc cuối.

Giao diện `/work-orders` dùng bộ chọn lịch cho hai mốc Target Finish. Ngày được chuyển thành
00:00 có offset theo timezone connection từ session API, không phụ thuộc timezone trình duyệt.
Để lấy hết một ngày, chọn mốc "Target Finish trước" là ngày kế tiếp. API vẫn nhận ISO có offset.

Khoảng tối đa 366 ngày. Ví dụ muốn lấy hết 30/09 thì mốc cuối là 01/10 00:00 với offset
nghiệp vụ đã xác nhận. API không đoán timezone hoặc tự chuyển ngày trống thành hôm nay.
Không nhận raw OSLC, host, next-page URL hoặc tham số thừa/trùng từ browser.

Response gồm connection_id, discipline, count và items. Mỗi item có siteid + workorderid;
kết hợp connection_id tạo identity đầy đủ. count chỉ là số item được xác minh, không dùng
totalCount do upstream gửi. Mọi trang phải thành công trước khi trả kết quả. Không cache WO.
Quyền/session và cấu hình connection được kiểm tra lại sau khi lấy hết các trang.

Sau retrieve, bảng có tìm kiếm theo WO/mô tả/Tag Name và lọc status trong tập đã tải.
Số hiển thị/tổng giúp phân biệt lọc bảng với khoảng ngày retrieve. Gõ tìm kiếm không gọi
Maximo; đổi connection/ngày hoặc retrieve lại xóa bộ lọc và dữ liệu cũ.

## Cấu hình server

MaximoConnection trong DB lưu `base_url` là application context, ví dụ
`https://<test-host>/maximo`; chưa có API quản trị cấu hình. `enabled` và AccessGrant
quyết định khả năng truy cập. Registry runtime dưới đây phải dùng đúng UUID của DB.
Collection URL phải khớp base_url + `/oslc/os/oslcmxwodetail`.
Connection có `person_login_domain` lấy grant read từ `mxperson.ct_discipline`, theo
[hợp đồng PERSON](person-access.md); không dùng discipline client gửi làm bằng chứng quyền.

Trong môi trường backend hoặc backend/.env (Git ignore), đặt `WOS_MAXIMO` là JSON object:

```text
WOS_MAXIMO={"<connection UUID>":{"collection_url":"https://<test-host>/maximo/oslc/os/oslcmxwodetail","api_key":"<secret>","open_statuses":["APPR","SCHED","WMATL","WMAT","DFAPPR"]}}
```

Đây là mẫu cấu trúc, không phải cấu hình dùng được. UUID, hostname, API key và status domain
phải được cung cấp/xác minh cho từng hệ thống. Registry runtime giữ credential; bảng DB
chỉ giữ metadata/secret_reference, không chứa key. Hiện resolver dùng UUID trong WOS_MAXIMO;
secret_reference dành cho tích hợp secret manager sau này. Registry rỗng không bật kết nối nào.
Kết nối được cấp quyền nhưng thiếu registry trả 503; không tự chuyển sang host khác.

Các giới hạn mặc định mỗi connection: page_size=200, max_pages=50, max_rows=5000,
max_page_bytes=4000000, timeout_seconds=15 mỗi thao tác mạng, retrieval_timeout_seconds=120
cho toàn lần lấy dữ liệu. Có thể đặt trong object cấu hình, có validation giới hạn.

HTTPS luôn xác minh TLS. HTTP chỉ cho connection test đã opt-in; xem phần dưới.
Nếu dùng CA nội bộ, đặt `WOS_MAXIMO_CA_BUNDLE` trỏ tới PEM bundle
được IT cấp và mount read-only. Không dùng verify=False. Không đọc proxy/CA từ biến môi trường
ngầm của HTTPX; mạng phải truy cập trực tiếp hoặc bổ sung proxy rõ ràng sau này.
Mỗi lần retrieve có HTTP client/cookie jar riêng để không lẫn session giữa connections.
Compose hiện chưa truyền registry/CA; bổ sung secret injection khi dựng môi trường test.

## Mapping đối chiếu VBA

Tên trường đã đọc từ macro của WorkOrderScheduler_v4.2.xlsm; object structure test vẫn cần
xác minh expose đúng các trường. Dùng lean JSON và explicit oslc.select.

| Cột Excel | Trường response web / Maximo |
|---|---|
| % Complete | wolo10, giữ thang 0–100; Excel chia 100 để format phần trăm |
| Discipline | bdpocdiscipline |
| Work Order | wonum |
| Description | description |
| Work Type | worktype |
| Tag Name | location |
| System ID | lochierarchy.systemid → systemid |
| Scheduled Start / Finish | schedstart / schedfinish |
| Actual Start / Finish | actstart / actfinish |
| Status | status, giữ nguyên mã |
| Priority | wopriority_description và wopriority |
| Onshore PIC | lead |
| Assigned PIC | assignedtechname |
| Est. Duration | estdur |
| Target Start / Finish | targstartdate / targcompdate |
| WOID | workorderid, chuẩn hóa chuỗi |
| Upload? / Change Target? | Trạng thái lựa chọn trên web, không phải trường Maximo |

Thêm siteid/istask/parent để xác minh identity và bộ lọc. Decimal serialize dạng chuỗi để
giữ độ chính xác. Null optional giữ null, không đoán thành 0. Thiếu identity/discipline/status,
ngày không có offset hoặc dữ liệu sai cấu trúc làm thất bại cả lần retrieve.
lochierarchy chấp nhận object hoặc list tối đa một phần tử; nhiều System ID báo lỗi.

## Kiểm soát phân trang và phạm vi

OSLC filter do server tạo: discipline chính xác, status trong domain cấu hình, istask=0,
parent!="*" và khoảng targcompdate. Mỗi WO trả về được kiểm tra lại các điều kiện này.
Discipline/status chỉ nhận mã chữ, số, khoảng trắng, `_`, `&`, `-`; không chấp nhận wildcard
hoặc đoạn query. Bộ mã ngoài tập này cần xác minh và bổ sung hợp đồng escaping trước khi dùng.

Theo responseInfo.nextPage (string hoặc href), chỉ cùng origin/scheme đã cấu hình và đúng collection path;
không redirect, không nhận query lạ, không cho thay bộ lọc/select/order. Scope được gửi lại trên
mỗi trang. Loop, WO trùng identity hoặc vượt giới hạn trả lỗi 502, không trả partial success.
Không retry tự động. Các lỗi upstream được rút gọn, không đưa body/credential vào response.

Paging thông thường không phải snapshot nguyên tử: Maximo thay đổi giữa trang có thể gây
thiếu dòng dù đã chặn trùng. Cần kiểm chứng stable paging và tải thực tế trên test trước UAT.
Reader detail và crew PIC đã triển khai với fixtures; revision/ETag và kiểm chứng Maximo thật còn nằm trong backlog.

Tham khảo hợp đồng tổng quát của IBM: [filtering](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/filtering/)
và [paging](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/sort_and_paging/).
Tài liệu này không chứng minh cấu hình riêng của hai hệ thống Maximo 7.6.1.3 đã tương thích.

## Chi tiết WO, PIC và bản nháp — 2026-09-30

- `GET /api/work-orders/detail`: connection_id, site_id, workorder_id, discipline.
  Kiểm tra scope trước/sau retrieval; trả item, allowed_pics và revision=null.
  WO phải còn thuộc status mở, không là task/child. Không dùng collection ETag làm revision WO.
- Thêm `crew_groups` trong mỗi cấu hình WOS_MAXIMO, ví dụ `{"MECH":"CREW-MECH"}`.
  Chưa cấu hình thì detail vẫn trả WO với `pics_configured=false`, danh sách PIC rỗng và
  giao diện khóa sửa/lưu; các thao tác draft vẫn yêu cầu crew. Nhóm do server quyết định.
  URL crew được suy ra cùng connection: `/oslc/os/mxpersongroup`.
  Đọc `persongroupteam[].respparty` theo VBA; kiểm tra đúng persongroup và dữ liệu member.
  Khi có collectionref, đọc collection child đầy đủ bằng reader có giới hạn, không dùng
  danh sách inline làm bằng chứng đầy đủ. Chỉ dùng path resource/relationship đã kiểm tra
  dưới mxpersongroup để dựng URL trên origin cấu hình; không gửi credential tới hostname
  quảng bá trong response. Child identity kiểm tra bằng localref; nextPage vẫn phải cùng
  origin/path và không được thay query. Paging lớn vẫn cần kiểm chứng riêng trên test.

Mapping Onshore theo công thức Excel do chủ dự án cung cấp ngày 2026-10-02:
MECH → MECH_N, RES → RES_N, DECK → DECK_N, PROD → PROD_N, E&I → E&I_N.
DNC dùng nhánh còn lại E&I_N của công thức. Không cấu hình wildcard `*`/ALL làm scope WO.
Đã đọc 25 PIC E&I_N trên Onshore test; không thực thi macro hoặc lấy credential từ Excel.
- `POST /api/drafts`: JSON gồm connection_id, site_id, workorder_id, discipline, changes.
  Yêu cầu session, CSRF và grant write. changes theo allowlist ScheduleChanges; không nhận
  baseline hoặc roles từ browser. Server lấy lại WO/PIC, kiểm tra ngày, PM/CFT và duration,
  rồi lưu một WO trong một draft. Không lưu nháp rỗng/không có thay đổi.
- `GET /api/drafts/{draft_id}`: chỉ owner; kiểm tra grants và WO/PIC hiện tại trước khi trả
  baseline, changes, current, allowed_pics, baseline_changed và changes_valid_now.
  Không tự thay baseline cũ bằng dữ liệu mới. Reader lỗi hoặc mất scope không trả nội dung nháp.

Giới hạn ở mốc 2026-09-30: chưa có UI/stale-edit/deduplication. Các phần này đã bổ sung ngày
2026-10-01; xem [hợp đồng nháp hiện tại](drafts.md). Revision/conditional upload vẫn chưa có.
Scope read-before-save không phải khóa nguyên tử với Maximo. Mở nháp có thể bị từ chối nếu WO đã đóng.

Kiểm thử synthetic HTTP + PostgreSQL: 129 backend tests qua; chưa xác minh hợp đồng Maximo
thật. Không thêm runtime dependency hoặc migration trong mốc này.


## HTTP riêng cho Onshore test — 2026-10-01

Chủ dự án xác nhận Onshore test dùng http://bd-maxdev.biendongpoc.vn/maximo, không VPN,
chưa cài chứng chỉ, và cho phép HTTP riêng cho test. API key truyền qua HTTP không được mã hóa.
Tùy chọn mặc định tắt; không tự đổi HTTPS thành HTTP hoặc tắt kiểm tra chứng chỉ HTTPS.

Mỗi entry trong WOS_MAXIMO cần đặt `"allow_http_for_test": true` (boolean JSON) khi collection_url
là HTTP. Collection URL dự kiến theo reader là
http://bd-maxdev.biendongpoc.vn/maximo/oslc/os/oslcmxwodetail; endpoint này chưa được xác minh live.
Entry vẫn keyed theo connection UUID trong DB, dùng API key nhập trực tiếp ở cấu hình server
được ignore/secret injection. Không dán API key vào chat hoặc tài liệu.

Trước khi gửi bất kỳ request nào, list/detail/PIC/draft đều kiểm tra DB connection có environment=test
và URL khớp registry. Các bước kiểm tra lại sau network I/O cũng áp cùng policy. Nếu connection
chuyển thành production hoặc opt-in bị tắt, trả 503 mà không gửi credential tới endpoint bị chặn.
WOS_ENVIRONMENT=production từ chối registry HTTP ngay khi khởi động, đồng thời có runtime guard.
Ứng dụng development/test/staging có thể đọc connection test đã opt-in; staging vẫn cần Entra.
Connection production luôn cần HTTPS. HTTPS và Entra callback/session tiếp tục yêu cầu TLS hợp lệ.

Paging phải giữ cùng origin, scheme và collection path, kể cả HTTP test; redirect không được theo.
Không thêm runtime dependency/migration. Kiểm thử chỉ dùng maximo.invalid/HTTP mocks và PostgreSQL
test riêng; chưa có credential hoặc kiểm chứng OSLC API thật. Mọi bước live còn lại trong TODO.
