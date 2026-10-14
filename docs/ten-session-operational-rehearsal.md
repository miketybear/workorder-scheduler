# Kiểm thử 10 phiên và lỗi vận hành

Ngày: 2026-10-10. Kết quả: các assertions trong rehearsal synthetic đã qua.
Chưa ký nghiệm thu Ubuntu/Maximo/Entra thực tế hoặc capacity production.

## Phạm vi

10 phiên HTTP xác thực độc lập của 10 users dùng database sessions thật, hai Maximo
connections giả lập và PostgreSQL/container backend riêng. Mỗi pha gửi 10 request
song song, chạy 3 vòng: retrieve, detail, lưu nháp đơn, prepare/lưu/mở/cập nhật nhóm
200 WO và danh sách nháp. Thêm một session của user đầu để kiểm tra version race/
duplicate; session này không tăng số client trong các pha tải lên 11.

Các connection có cùng site/WOID/WONUM để kiểm tra identity không bị ghép sai.
Người khác không được mở/sửa nháp thuộc owner khác. Version conflict được thử
bằng hai phiên của cùng identity, vì sản phẩm không cho hai owner sửa cùng nháp.

Không dùng database ứng dụng, đăng nhập Entra thật hoặc Maximo thật; mock chỉ
chấp nhận GET và không gửi remote writes. Không diễn tập backup/restore.

## Môi trường và phương pháp đo

- Linux containers trên Docker Desktop29.6.2/WSL2 của Windows; Docker host16 logical
  CPUs, khoảng15.37GiB RAM. Không đặt CPU/memory limit riêng cho containers.
- Python3.12.14, PostgreSQL17.11, FastAPI0.141.1, Uvicorn0.54.0,
  SQLAlchemy2.0.54, psycopg3.3.6, HTTPX0.28.1; schema migration0008.
- Application source hiện tại chạy bằng `create_app` và Uvicorn qua socket HTTP.
  Migration và commit thật; PostgreSQL/network/container có tên UUID riêng,
  volume riêng giữ dữ liệu khi DB/backend restart. Không dừng shared test DB.
- Maximo `MockTransport`, WO delay5ms, hai PERSON-derived scopes MECH/E&I. Batch
  detail fanout4/request; pool SQLAlchemy mặc định5+10 overflow, pre-ping bật.
- Cookie/CSRF được cấp và lưu thật trong DB, gửi thủ công qua loopback HTTP.
  Đây là kiểm thử API xác thực, không thử Secure-cookie delivery/TLS hay Entra login.
- 10 warmup session requests tuần tự, không tính trong bảng tải. Latency là wall
  time client từ gửi đến nhận đầy đủ response, gồm HTTP/DB/upstream/serialization.
  P50/P95 dùng nearest-rank trên30 mẫu/pha; mẫu nhỏ và upstream synthetic không
  đủ kết luận production SLO. Final run từ08:47:24 đến08:48:46 UTC, khoảng82.1s.

## Thời gian phản hồi dưới tải 10 phiên

Đơn vị giây; mỗi hàng30 requests. Tất cả240 load requests trả status dự kiến.

| Thao tác | P50 | P95 | Max | HTTP |
| --- | ---: | ---: | ---: | --- |
| Retrieve200 WO | 0.272 | 0.412 | 0.413 | 200 |
| Mở detail WO | 0.181 | 0.194 | 0.196 | 200 |
| Lưu nháp đơn | 0.223 | 0.244 | 0.245 | 201 |
| Prepare nhóm200 WO | 0.905 | 1.017 | 1.019 | 200 |
| Lưu nhóm200 WO | 2.296 | 2.651 | 2.652 | 201 |
| Mở lại nhóm200 WO | 2.707 | 2.884 | 2.893 | 200 |
| Cập nhật nhóm200 WO | 2.445 | 2.461 | 2.464 | 200 |
| Danh sách nháp | 6.071 | 9.210 | 9.211 | 200 |

Danh sách nháp tăng theo dữ liệu tích lũy: P95 vòng1=3.153s (mỗi user1nhóm+1đơn),
vòng2=6.091s (2nhóm+2đơn), vòng3=9.211s (3nhóm+3đơn). Các vòng khác có bộ thao tác
giống nhau; danh sách không phải workload cố định qua3 vòng.

## Đúng dữ liệu, cách ly quyền và các ca lỗi

| Ca | Kết quả quan sát và kiểm chứng |
| --- | --- |
| Người cùng scope mở/sửa nháp owner khác | GET và PUT404; trạng thái nháp không đổi. Wrong connection/discipline và guessed draft ID cũng404. |
| WO upstream chuyển discipline | Reader trả502 scope rejection; không trả WO ngoài quyền. Đây là lỗi cố ý gây ra, không phải lỗi tải ngoài dự kiến. |
| Hai phiên cùng owner sửa version cũ | Một200/version mới, một409; không ghi đè bằng update thua. |
| Hai request cùng ID/nội dung | Hai201 trả cùng receipt/result; đúng1 persisted receipt. Sau restart replay trả kết quả cũ, counts không tăng. |
| Deadline1s khi batch bị giữ ở upstream | 504; hủy4 active children, active về0, không có draft/items/receipt mới. |
| Dừng PostgreSQL riêng | Session API503; khi DB lên lại, cùng backend/session trả200, pool tự kết nối lại. |
| Thay process/container backend | Session còn dùng được; mở lại nhóm đúng version2 và200items. |
| SIGTERM với request đang xử lý, grace5s | Request được drain trả201, process exit0; sau restart đọc được nháp và1receipt. |
| SIGTERM khi request bị giữ quá grace5s | Client500 sau khoảng5.97s; trong ca này draft/items/receipt không tăng. Không coi500 nói chung là bằng chứng chưa commit. |
| DB đã commit, response bị giữ rồi SIGKILL | Xác minh1receipt đã commit trước kill; client RemoteProtocolError. Sau restart replay cùng request ID trả đúng kết quả, không có thêm rows. |

270 request responses được đo, gồm240 load/10warmup/20 kiểm tra; không có status
ngoài expectation. Hai ca shutdown/response-loss đặc biệt được ghi riêng trong
report và không nằm trong bộ270 response samples. Kết thúc trước cleanup có
63drafts/6033items/94receipts. Timeout trước persistence và response-loss sau commit
là hai ca riêng; không suy từ mất response rằng nháp chưa lưu.

## Điểm cần xử lý trước staging

1. **Ưu tiên danh sách nháp:** khoảng9.2s với3 nhóm200WO/user dù WO mock chỉ5ms.
   `list_drafts` lần lượt gọi `restore_data` cho từng nháp; mỗi nhóm re-read tất cả
   WO trước trả summary, kể cả `include_items=false`. Cần thiết kế giảm work/read
   lặp với bounded concurrency và giữ đầy đủ scope/current-discipline checks.
   Đã xử lý trong task tiếp theo cùng ngày; xem phần tối ưu bên dưới. Các số đo
   phía trên và JSON baseline được giữ nguyên để so sánh.
2. **Chốt shutdown contract:** grace5s cố ý ngắn gây500; request có thể không nhận
   kết quả dù DB đã commit trong một ca khác. Giữ receipt/request ID và explicit
   status/replay. Runbook staging dùng `stop -t330`; Compose chưa đặt
   `stop_grace_period`, nên phải thống nhất lệnh vận hành/container stop budget
   và graceful deadline trước staging, không coi rehearsal5s chứng minh330s.
   Bước1 cấu hình sau rehearsal đã hoàn tất ngày10/10 theo runbook staging;
   bước2 runtime synthetic với budget180/320/330s đã qua các ca drain/deadline/
   response-loss và replay; nghiệm thu Ubuntu vẫn pending, xem runbook staging.
3. **Nghiệm thu môi trường thật:** đo lại trên Ubuntu với tài nguyên được giới hạn,
   HTTPS/proxy/Entra/PERSON/Maximo thật và latency upstream; kiểm tra monitoring khi
   DB503/readiness lỗi. Cần IT cấp hạ tầng, routing/TLS và test roster.

## Bằng chứng và cách chạy lại

[JSON evidence](evidence/ten-session-2026-10-10.json) giữ samples/phases/results đã
loại credential/payload; source run ID `ab0a0f5f9fe14b0982b75eaaf7ca7dc3`.
[Orchestrator](../backend/tests/operational_rehearsal/rehearse.py),
[test runner](../backend/tests/operational_rehearsal/runner.py) và
[isolation guard tests](../backend/tests/operational_rehearsal/test_guard.py).

Chuẩn bị Docker Desktop Linux, ports loopback55439/58039 còn trống. Image backend
được build từ lock hiện tại; runner bind source read-only, `_env_file=None`,
database contract chỉ cho `pg:5432/rehearsal_<run UUID>`/synthetic hosts. Từ root:

```powershell
docker build -t workorder-scheduler-backend:local-check backend
```

Từ backend:

```powershell
uv run python tests/operational_rehearsal/rehearse.py
uv run pytest tests/operational_rehearsal/test_guard.py -q -p no:cacheprovider
```

Job tạo rồi dọn đúng UUID containers/network/volume/private session config; CLI
exit khác0 nếu assertions lỗi hoặc cleanup không xác minh được. Final run cleanup
được kiểm tra riêng bằng Docker CLI thành công; Main cũng kiểm tra prefix rehearsal
không còn container/network. Report gốc dùng tag postgres17-alpine, version thực
17.11 ở trên; script hiện pin digest cho lần chạy sau. Sau final run chỉ sửa phần
CLI cleanup/exit/metadata/aggregate, không đổi các scenario đã chạy.

Một reviewer Sol/high tìm5P2 trong harness, không cóP1: guard seed tùy ý, owner
test khác scope, thiếu after-commit replay, sai expected moved-WO status và cleanup
claim không kiểm chứng. Đã sửa; Main rà các fixes, chạy lại6 guard tests và kiểm tra
evidence/cleanup. Ruff check/format qua, không gọi review thứ hai.

## Giới hạn nghiệm thu

Đây là tải API qua Uvicorn/PostgreSQL thật với upstream giả lập; không phải 10
browser rendering/MFA/SSO sessions hay số đo Maximo/Ubuntu staging. Chưa có SLO
được chủ dự án chốt, nên số đo không tự chứng minh đáp ứng capacity production.
Roles/password/TLS/CA và tài nguyên staging thật vẫn cần IT nghiệm thu riêng.

Ràng buộc Schedule trong Target vẫn chỉ nằm trên UI theo quyết định chủ dự án;
bộ thử này không bổ sung rule backend hoặc mở lịch sử upload phase 2.
Không thử remote upload/write throughput, lease/recovery worker, browser UI rendering,
mất điện host hoặc lịch chạy kéo dài. Kết quả không đóng những gate này trong TODO.

## Tối ưu danh sách nháp và đo lại — 2026-10-10

API list thay restore tuần tự từng nháp bằng kiểm tra toàn trang. Đọc metadata và
thành viên theo tập, trả DB connection về pool trước network I/O; mỗi key
connection/site/WO được đọc mới một lần trong request, crew một lần và fanout tối đa4.
Kiểm tra grant chung cho tập cùng connection/discipline thay hai SQL queries mỗi
thành viên. Summary không xây expanded payload; `include_items=true` giữ contract.
Mọi thành viên vẫn được kiểm tra upstream, session/grant được kiểm tra lại sau I/O;
nhóm đổi version/membership hoặc không xác minh đủ bị bỏ toàn bộ. Không cache
giữa request, không thay API/schema/dependencies hoặc thêm validation backend.

Một reviewer Sol/high không tìm P1, phát hiện một P2 về việc đọc version và changes
bằng hai SQL statements. Đã sửa thành một joined statement có cùng PostgreSQL
statement snapshot; Main kiểm tra fix và regression interleaving deterministic.
55 PostgreSQL tests liên quan qua các lượt chạy (13 list, marker/draft/batch/deadline),
425 offline tests qua; Ruff check/format qua. Deadline test đổi điểm inject stall
sang reader mới cho list, giữ assertions timeout/cancellation hiện có.

Final-source run `7ea027bd81d2425e877dcc7b2556d907` từ09:05:35 đến09:06:48 UTC,
khoảng73s. Cùng Docker Desktop, phiên bản runtime/PG17.11, cấu hình pool/fanout và
10 users/3 vòng/tập WO200 như baseline. Thêm pha expanded list sau summary mỗi
vòng, xác minh đúng số nháp và số thành viên. Đây là hai lượt đo riêng, không phải
benchmark kiểm soát biến động tài nguyên host; baseline chưa đo expanded list.

| Danh sách nháp | Baseline P95 (s) | Sau tối ưu P95 (s) |
| --- | ---: | ---: |
| Vòng1: 1 nhóm200 +1 đơn/user | 3.153 | 1.016 |
| Vòng2: 2 nhóm200 +2 đơn/user | 6.091 | 1.140 |
| Vòng3: 3 nhóm200 +3 đơn/user | 9.211 | 1.209 |
| Summary, gộp30 samples | 9.210 | 1.207 |
| Expanded, gộp30 samples | Chưa đo | 1.484 |

Summary P95 giảm86.9% (khoảng7.6 lần); expanded max1.525s. 270 load requests
(9 pha ×3 vòng ×10 clients), tổng300 response samples gồm warmup/checks, không
status ngoài kỳ vọng. Cả summary và expanded mỗi loại30 responses200. Các pha
khác P95: retrieve0.415s, open0.269s, save đơn0.351s, prepare2001.077s,
save nhóm2.685s, restore2.902s, update2.652s; các endpoint đó không được tối ưu
trong task này. Tăng số WO **khác nhau** vẫn tăng công việc upstream; test401
distinct keys kiểm tra không bị giới hạn nhầm ở200 và fanout vẫn tối đa4.

Các checks owner/scope/version race/duplicate/deadline/DB outage/restart/SIGTERM/
response loss và replay đều qua lại. Hai fault responses cố ý vẫn ghi riêng ngoài
300 samples. Counts cuối63drafts/6033items/94receipts như baseline; cleanup verified
containers/network/private config, runner dọn owned PG volume. Main xác minh
Docker không còn container/network có prefix rehearsal.
[JSON evidence mới](evidence/ten-session-draft-list-optimized-2026-10-10.json) lưu
samples/thống kê và giữ [baseline](evidence/ten-session-2026-10-10.json) riêng.

Số đo synthetic này chưa chốt production SLO hoặc nghiệm thu10 browser/SSO/TLS/
Maximo thật. Sau task tối ưu, bước1 [shutdown staging](staging-deployment.md#thời-gian-chờ-và-restart-có-kiểm-soát)
đã thống nhất backend/nginx320s và Docker330s, stop web trước backend. Kiểm thử
request đang chạy theo cấu hình mới đã hoàn tất synthetic ở bước2, gồm nhóm200WO
và receipt sau restart. Đo môi trường Ubuntu thật vẫn cần IT cấp routing/TLS/
tài nguyên/test roster; xem [runtime report](staging-deployment.md#kết-quả-runtime--2026-10-10).
