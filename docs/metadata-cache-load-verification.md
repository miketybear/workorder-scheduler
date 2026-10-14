# Đo tải metadata và hai phiên Planner

Ngày: 2026-10-13. Đo đọc danh sách WO; không lưu phân công hoặc ghi Maximo.

## Phương pháp

Backend được đo từ lúc gửi request đến khi nhận đầy đủ JSON. Hai phiên API
độc lập có user, cookie và quyền Planner trong database test riêng; credentials
Maximo chỉ ở backend. Đây là nghiệm thu HTTP/session của ứng dụng, không phải
hai lần đăng nhập Entra thật hoặc đo proxy HTTPS trên Ubuntu.

Mỗi cặp request bắt đầu đồng thời. Cold cache phải dùng chung một bản chụp;
warm page và search phải không tải lại metadata. Đếm riêng request metadata,
guard kiểm tra phạm vi và PERSON. Task/assignment không thuộc bài đo này.
Các số đo ít mẫu được báo median/max, không suy thành production SLO.
Chạy actual FastAPI route qua HTTPX ASGITransport với PostgreSQL thật ở
database scheduler_test đã được guard; schema UUID riêng được dọn sau chạy.
Phần đo này không qua socket Uvicorn/proxy/browser. Live app DB chỉ được đọc
để xác minh operator đã có quyền; PERSON kiểm tra trước/sau mỗi pha. Hai user
giả lập có quyền trong schema test; không thử Entra callback hoặc PERSON mapping
cho các user giả lập. Local Windows, Python3.12.14, 16logical CPU, không đặt quota.

## Hai phiên API với Maximo thật

Khảo sát bốn tháng bằng một request count tối đa1row/tháng: tháng9=166,
tháng10=117, tháng11=55, tháng12=77. Chọn tháng9, nhiều nhất trong bốn tháng
được khảo sát; không khẳng định đây là tháng lớn nhất toàn hệ thống.

Hai phiên cùng scope E&I bắt đầu đồng thời. Ba cặp cold, năm cặp warm page2,
năm cặp warm search theo WONUM; tổng26response. Median tính trên6mẫu cold
và10mẫu mỗi pha warm.

| Thao tác | Min (ms) | Median (ms) | Max (ms) | Đọc metadata / cặp |
| --- | ---: | ---: | ---: | ---: |
| Cache rỗng, trang1 | 315,64 | 322,54 | 383,11 | 1 |
| Cache còn hiệu lực, trang2 | 81,50 | 86,46 | 96,28 | 0 |
| Cache còn hiệu lực, search | 60,47 | 64,69 | 70,96 | 0 |

Tất cả26response200; các cặp cùng snapshot; page1/page2 đủ20WO, tổng166;
search số WO đã chọn trả1/1. Mỗi cặp có2scope guard. Tổng3metadata/26guard,
chứng minh hai phiên không tải trùng bộ metadata khi cache rỗng. PERSON8 và
4monthly count probe được đo đếm riêng, nằm ngoài timing response ở bảng.
Không gọi task/assignment, không ghi Maximo và không thay quyền/session live DB.

## Quy mô5.000 WO giả lập

Cùng API/auth/PostgreSQL, thay upstream bằng MockTransport,25trang200WO.
Không có network delay; các thời gian này chỉ phản ánh xử lý trong ứng dụng,
không dùng để dự đoán tốc độ Maximo thật với5.000WO.

| Thao tác | Min (ms) | Median (ms) | Max (ms) |
| --- | ---: | ---: | ---: |
| Cache rỗng | 98,47 | 118,09 | 129,99 |
| Trang2 dùng cache | 21,45 | 22,80 | 25,34 |
| Search dùng cache | 25,65 | 28,15 | 32,58 |

26response200; page20/tổng5.000/search1; shared snapshot đạt. Mỗi cặp cold
chỉ25metadata thay vì50; warm không đọc metadata. Tổng75metadata/26guard.

[JSON đã xác minh, gồm raw samples](evidence/metadata-paging-two-session-2026-10-13-verified.json).
[Harness](../backend/tests/operational_rehearsal/metadata_benchmark.py).
Từ backend:

```powershell
.venv/Scripts/python.exe -m tests.operational_rehearsal.metadata_benchmark --output ../docs/evidence/<ten-moi>.json
```

Phải có cấu hình test hiện có và quyền
schema trong guarded integration DB. Harness từ chối ghi đè evidence và không
cho gửi upstream khác GET. Pilot evidence không dùng làm kết quả nghiệm thu.

## Giao diện tháng 10

Onshore Test E&I, 117 WO. Một mẫu mỗi thao tác, đo từ hành động đến khi thẻ
WO đầu tiên dự kiến xuất hiện. Thời gian gồm overhead tự động hóa trình duyệt;
không chờ toàn bộ task summaries của các thẻ.

| Thao tác | Giây |
| --- | ---: |
| Làm mới timeline đến WO đầu tiên | 1,823 |
| Trang kế tiếp khi cache còn hiệu lực | 0,840 |
| Tìm kiếm dùng cache, gồm debounce | 1,363 |

[Mẫu UI](evidence/metadata-ui-latency-2026-10-13.json).
[Màn hình sau phép đo](evidence/metadata-load-ui-2026-10-13.png).
Harness guardtests4pass và Ruff đạt; không còn schema metadata_bench_* sau chạy.

## Giới hạn nghiệm thu

Cache chỉ dùng chung trong một process; nhiều worker có cache riêng. Maximo
vẫn được đọc để kiểm tra phạm vi từng trang. Kết quả local không đại diện cho
Ubuntu, reverse proxy, nhiều người dùng hơn hoặc thời gian đăng nhập Entra.
Nghiệm thu hai tài khoản Planner thật cần hai tài khoản đã được cấp phạm vi
hợp lệ; không mở rộng quyền để tạo tải thử.
User xác nhận chưa có hai tài khoản thật và chọn hai phiên API test trước.
Phạm vi được chọn này đã hoàn tất; bước tiếp theo là đo qua HTTPS/proxy Ubuntu
khi hạ tầng được cấp và nghiệm thu Entra khi có hai tài khoản Planner hợp lệ.
