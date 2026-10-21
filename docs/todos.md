# TODO — Work Order Scheduler

Cập nhật: 2026-10-19.

## Đề xuất chưa làm — cập nhật 2026-10-19

### A. PIC và khoảng ngày lịch của WO trên backlog và timeline (đề xuất mới)

- [x] **A1. Thẻ WO hiện PIC và khoảng lịch.** *(2026-10-19: xong cả backlog và timeline.)* Thẻ backlog và thẻ phân công/tooltip trên timeline hiện
      `assignedtechname` (hoặc "Chưa có PIC") và `schedstart → schedfinish`.
      - Backlog: dữ liệu đã có sẵn trong trang WO (`/work-orders/page` trả `schedstart`, `schedfinish`,
        `assignedtechname`), chỉ cần hiển thị.
      - Timeline: `work_orders` của `assignment-timeline` chỉ có `wonum/description/status/eligible`. Backend
        đã đọc đủ WO bằng `read_detail` (có `schedstart`, `schedfinish`, `assignedtechname`) nên thêm 3 trường
        vào payload là thay đổi cộng thêm, không thêm lời gọi Maximo. Cần agent backend và test hợp đồng API.
      - Định dạng ngày theo múi giờ nghiệp vụ của kết nối (không dùng múi giờ trình duyệt).
- [x] **A2. Cảnh báo (không chặn).** *(2026-10-19: xong.)* Hiện huy hiệu cảnh báo trên thẻ WO, ô phân công và hộp thoại phân
      công, kèm lý do; không bao giờ chặn lưu hay gửi.
      - Cảnh báo 1: một phân công/đoạn kế hoạch của WO có ngày nằm ngoài `[schedstart, schedfinish]`.
        Quy tắc biên: so theo ngày trong múi giờ nghiệp vụ; WO thiếu `schedstart` hoặc `schedfinish` thì
        không cảnh báo mà hiện "WO chưa có lịch".
      - Cảnh báo 2: PIC của WO không nằm trong số người đang được giao WO đó (xét cả phân công nội bộ và
        đã đồng bộ).
      - Cần chốt: cách so khớp PIC với nhân sự. `assignedtechname` trong dữ liệu thật trông giống mã nhân
        công (ví dụ `HAIDQ`) và timeline có `laborcode`; phải xác minh trên Maximo test trước khi so khớp,
        không so bằng tên hiển thị.
- [x] **A3. Gợi ý PIC khi WO chưa có PIC.** *(2026-10-19: xong.)* Nút "Đặt X làm PIC" trên thẻ/hộp thoại, X là người được giao
      đầu tiên (đề xuất: theo ngày phân công sớm nhất, hòa thì theo tên; cần xác nhận quy tắc).
      - Nút **không ghi Maximo**: chuyển sang trang Work orders, mở nháp của WO đó với `assignedtechname` đã
        điền sẵn (nháp theo cơ chế hiện có: baseline, phiên bản, kiểm tra quyền). Planner xem lại rồi lưu
        nháp; gửi lên Maximo vẫn qua luồng upload có đối chiếu.
      - Chỉ bật khi X nằm trong danh sách PIC hợp lệ của discipline (`allowed_pics` từ crew group); nếu
        không, vô hiệu hóa kèm lý do. Người dùng chỉ đọc không thấy nút.
      - Cần chốt: tạo nháp ngay hay chỉ mở editor đã điền sẵn chưa lưu (đề xuất: mở editor đã điền sẵn để
        người dùng chủ động bấm "Lưu nháp").
      - Rủi ro: WO có nhiều người được giao nhưng PIC trống có thể không muốn lấy người đầu tiên; đây chỉ
        là gợi ý, luôn cần người xác nhận.
- **Quyết định của chủ dự án (2026-10-19):** `assignedtechname` là mã PERSON, trùng với `laborcode`, nên so khớp PIC
  với nhân sự theo mã là đúng (A2). A3: "người được giao đầu tiên" = phân công sớm nhất (hòa thì theo tên),
  và nút mở editor đã điền sẵn PIC chưa lưu để người dùng chủ động bấm "Lưu nháp".
- **A1 backlog đã làm (2026-10-19):** thẻ backlog hiện `PIC <mã>` hoặc "Chưa có PIC" (màu cam) và khoảng lịch
  `dd/MM → dd/MM` theo múi giờ nghiệp vụ (thêm năm khi khác năm hiện tại) hoặc "Chưa có lịch"; tooltip có
  `schedstart → schedfinish` đầy đủ; aria-label của thẻ gồm PIC và lịch. `scheduleRange` ở
  `timelineHelpers.ts`, 5 test mới (helper và thẻ). Xem ảnh trên dữ liệu thật (117 WO tháng 10, nhiều WO
  chưa có PIC/lịch).
- Thứ tự đề xuất: A1 (backlog trước, dữ liệu sẵn) → A1 timeline (cần backend) → A2 → A3.
  Tiêu chí hoàn thành: test hiển thị, test quy tắc cảnh báo (biên ngày, thiếu lịch, múi giờ), test nút A3
  không gọi API ghi Maximo; xem ảnh trên dữ liệu thật.

- **Làm xong 2026-10-19:**
  - Backend: `work_orders[]` của `assignment-timeline` có thêm `schedstart`, `schedfinish`, `assignedtechname`
    (nullable, serialise `model_dump(mode="json")` như các route WO khác; không thêm lời gọi Maximo). Test
    `test_assignments_postgres.py` (4 passed với `--run-db-tests`), ruff sạch; chưa có assert cho
    `assignedtechname=null`. Thay đổi nhỏ và chỉ cộng thêm nên không dùng review độc lập riêng.
  - Frontend: thẻ backlog và ô phân công hiện cảnh báo (ngoài lịch WO, PIC chưa được giao; so mã
    PERSON/laborcode không phân biệt hoa thường, biên ngày theo múi giờ nghiệp vụ); chú giải có mục cảnh báo.
    Nút "Đặt X làm PIC (tạo nháp)" (X = người được giao sớm nhất, hòa theo tên) chuyển sang trang Work orders
    và mở editor với PIC điền sẵn chưa lưu; không điền khi WO đã có PIC, nháp đã có PIC, PIC không thuộc
    `allowed_pics`, hoặc khác kết nối/discipline. Không gọi API ghi.
  - Giới hạn: cảnh báo chỉ xét phân công trong tháng đang xem; WO nhiều nháp nhóm (batch) không nhận PIC điền
    sẵn; kiểm tra thủ công trên dữ liệu thật (Onshore test) chỉ mở editor, không lưu nháp.
  - Cần restart backend để timeline có 3 trường mới (đã restart bản dev local).

### B. Hiệu năng `assignment-timeline` (backend, kết quả điều tra 2026-10-19)

- [-] **B1. (Không làm — quyết định chủ dự án 2026-10-20: chỉ giảm ~1 giây trên ~2,6 giây, không đáng rủi ro ở đường kiểm tra quá tải; xét lại nếu số người/WO tăng.) Gộp đọc tải phân công bằng `laborcode in ["A","B"]`** (2 truy vấn mỗi lô thay vì 42): đã thử
      trên Maximo test, kết quả giống hệt cách cũ (3/6/21 người, tháng 6 và 10). Giữ nguyên bộ lọc sau,
      chia lô ≤100 mã (URL ≤ ~8k), cú pháp không dấu cách, kiểm tra `totalCount`; không dùng truy vấn
      chồng lấn một lần vì `finishdate` rỗng làm sót tải. Cần agent backend, test, review độc lập.
- [ ] **B2. Song song hóa có giới hạn** các lần đọc WO và kiểm tra PERSON (giữ thứ tự kiểm tra quyền
      trước/sau I/O). Không cache số tải.

### C. Dọn dẹp

- [x] Xóa nhánh `ui/design-tokens` (local và remote) vì đã merge — 2026-10-21.
- [ ] Lần tải nguội (25–30 giây) chưa đo được vì cần xóa cache backend/Maximo.

## Ô ngày giờ 24 giờ và họ tên PIC — 2026-10-20

- [x] Ô ngày giờ trong cửa sổ lập lịch (Scheduled Start, Target Start/Finish; ô nhóm và từng dòng ở editor nhóm)
      dùng một chuẩn 24 giờ (`components/DateTimeInput.tsx`), thay cho `datetime-local` vốn theo ngôn ngữ trình
      duyệt (12 giờ am/pm): ô gõ `dd/mm/yyyy hh:mm` (gõ được mọi phút) và một popup duy nhất có lịch (Thứ 2 là ngày
      đầu tuần), cột giờ 00–23 và cột phút bước 5 (giữ nguyên phút hiện có nếu lệch bước); mỗi lần bấm áp dụng ngay,
      "Xong" hoặc Esc để đóng, phím mũi tên di chuyển trong lịch và cột. Ô giờ bắt đầu kế hoạch/đồng bộ hàng loạt
      dùng `TimeInput24` (hai select, phút bước 5). Giờ mặc định khi mới chọn ngày: 06:30 cho Scheduled Start, 23:59 cho Target Finish, 00:00 cho
      Target Start. Hiển thị chữ vẫn `dd/MM/yyyy, HH:mm` (24 giờ).
- [x] Assigned PIC hiện "MÃ — Họ tên" (select, bảng đối chiếu, thông tin WO, thẻ backlog timeline và nút gợi ý PIC);
      giá trị lưu vẫn là mã PERSON. Backend thêm `pic_names` (additive) vào detail, restore, batch prepare và danh
      sách nháp có `include_items`; đọc `mxperson` bằng một GET nhỏ (~40–90 ms); lỗi đọc thì trả `{}`, không làm hỏng
      response. Tên lấy `displayname`, rỗng thì họ + tên (đúng thứ tự Maximo).
- Chưa có tên cho "Onshore PIC" (`lead`) trừ khi trùng crew; thẻ backlog dùng tên từ roster timeline.
- [x] 454 frontend tests, 718 backend tests (không integration), lint, typecheck, build đạt; kiểm tra trên dữ liệu thật.

## Scheduled Finish theo ca làm việc ngoài biển — 2026-10-20

- [x] Finish = Start + Est. Duration tính theo giờ làm việc (`scheduling/workShift.ts`): cửa sổ 06:30–18:30, tối đa
      10,5 giờ/ngày (đã gồm ăn nghỉ), 7 ngày/tuần, mọi loại WO. Ngày đầu còn min(10,5 giờ, đến 18:30); các ngày
      sau từ 06:30. Áp dụng ở editor một WO và editor nhóm. Không tự tính lại Duration của PM (Maximo có thể tự
      tính lại, luồng upload đã ghi nhận `pm_duration_recalculated`).
- [x] Start ngoài cửa sổ: cảnh báo và hai lựa chọn (giữ nguyên giờ đã chọn, giờ làm việc tính từ đầu ca kế tiếp;
      hoặc dời sang đầu ca gần nhất; hòa lúc 18:30 chọn ngày sau). Editor nhóm có nút áp cho mọi WO bị ảnh hưởng.
- [x] Finish vượt Target Finish: chặn lưu, thông báo yêu cầu cập nhật Target Finish (CM, bật Change Target) hoặc
      rút ngắn Duration/dời Start (PM/CFT).
- [x] 452 frontend tests (8 test `workShift`, các test editor/nhóm cập nhật), lint, typecheck, build đạt. Trên dữ liệu
      thật (WO 300 giờ, Start 20:00 ngày 08/10): Finish 06/11 12:30, vượt Target 31/10 nên chặn lưu; không lưu gì.
- [ ] **Chưa kiểm chứng:** Maximo test có nhận `schedfinish` nhiều ngày cho CM và đọc lại đúng không (hợp đồng ghi
      chỉ mới thử dịch cùng +1h7m13s). Cần một thử nghiệm ghi rồi khôi phục có duyệt riêng.
- [ ] Nhiều WO lớn (ví dụ 300 giờ) sẽ vượt Target Finish theo quy tắc mới; cần quy trình cập nhật Target hàng loạt
      nếu số này nhiều.

## Ô ngày/tháng thống nhất, thanh task nhiều ngày và lỗi lưu nháp — 2026-10-20

- [x] **Trang WO gọn lại: một bảng, "Gửi N WO lên Maximo", cảnh báo đổi khoảng ngày** (frontend, 2026-10-21): bỏ nguồn thứ hai
      "Nháp của tôi" (nút chuyển nguồn, phân trang nháp, snapshot theo nguồn) và nút "Lập lịch nhóm"; còn một bảng WO của
      khoảng ngày, bộ lọc Nháp (tất cả/có/chưa có), nhãn "Nháp" trên dòng (không phân biệt đơn/nhóm), bấm số WO mở panel
      `DraftEditor` (WO thuộc nháp nhóm mở bản Maximo để sửa, nhóm được sửa trong bảng). Ô tick dòng chỉ còn cho Ctrl+D.
      Đổi khoảng ngày khi có dòng có nháp mở hộp thoại `alertdialog` ("Hủy, giữ danh sách" / "Xóa nháp và đổi ngày"):
      xóa tuần tự từng nháp (mỗi nháp nhóm một lần), lỗi xóa giữ hộp thoại và khoảng ngày cũ. Thanh "Gửi N WO lên
      Maximo" (quyền ghi, có WO có nháp; N = số WO có nháp, luôn là tất cả; khóa khi còn sửa ô chưa lưu hoặc đang bận) chạy
      `consolidateDrafts`: dùng nguyên nháp nếu đã đúng một nháp phủ đúng tập WO, ngược lại gộp mọi nháp liên quan
      (kể cả thành viên ngoài bảng; WO nằm ở nhiều nháp lấy bản mới nhất) thành MỘT nháp nhóm mới với baseline mới, bỏ
      trường đã trùng Maximo/PIC không còn hợp lệ và báo WO bị loại, rồi mới xóa các nháp cũ (lỗi xóa chỉ cảnh báo) và mở
      `BatchPlanner sendOnly` (bảng tóm tắt chỉ đọc + phần upload cũ). Giới hạn 200 WO mỗi lần gửi (vượt thì báo thu hẹp
      bằng bộ lọc, không lưu/xóa gì). Chưa kiểm tra thủ công trên trình duyệt với dữ liệu thật; 489 frontend test, lint,
      typecheck đạt.
- [x] **Hộp thoại chi tiết nối với bảng chính** (frontend, 2026-10-21): bấm số WO giờ mang sang `DraftEditor` (prop `seed`) giá trị
      đang hiện trên dòng: ô sửa trực tiếp chưa lưu, và với WO thuộc nháp nhóm là giá trị của nháp nhóm (trước đây mở bản Maximo
      trống). Giá trị này hiện như thay đổi chưa lưu trong hộp thoại; dòng bảng giữ ô chưa lưu cho tới khi hộp thoại lưu nháp
      (`onDraftReady` bỏ các ô trùng giá trị nháp vừa lưu). Lưu từ hộp thoại với WO thuộc nháp nhóm vẫn tạo nháp đơn, được gom lại
      khi bấm "Gửi". Xóa biến `draftsToDiscard` thừa. Kiểm tra thủ công: Duration 7 trong bảng hiện 7 ở hộp thoại; 491 frontend test,
      lint, typecheck đạt.
- [x] **Lỗi 503 khi lưu nháp ("Không hoàn tất yêu cầu")**: role runtime thiếu quyền UPDATE cột `result` của
      `draft_submission` (biên nhận được chèn rỗng rồi cập nhật trong cùng transaction). Thêm
      `GRANT UPDATE (result)` vào `backend/sql/provision_roles.sql`, áp vào DB dev local bằng role owner, và
      `test_db_roles.py` kiểm tra quyền này cùng việc `request_hash` vẫn không sửa được. Chưa rõ vì sao các lần
      lưu trước 10/10 chạy được. Giao diện vẫn hiện thông báo chung cho 503 (chưa đổi).
- [x] **Ô ngày/tháng thống nhất** (`components/DateTimeInput.tsx`): `DateTimeInput` có chế độ `dateOnly`
      (`dd/mm/yyyy`, một lần bấm chọn, `min`/`max`/`isDayDisabled`) và `MonthInput` (`Oct 2026`, nhận cả `10/2026`,
      lưới Jan–Dec). Thay mọi ô gốc `date`/`month`/`datetime-local` ở: khoảng Target Finish trang WO, tháng
      timeline và timeline phân công, ngày bắt đầu task, ngày chuyển plan, ngày rota (khóa ngày không có capacity),
      giờ bắt đầu gửi Maximo, ngày timeline thử nghiệm. Còn ô gốc trong bảng của `DemoScheduler.tsx` (trang demo).
- [x] **Ô ngày timeline yên tĩnh**: ngày không có capacity (gạch chéo) không hiện chữ; ngày làm việc chỉ có
      `đã dùng / capacity h`; dòng "vượt X h"/"chưa xác minh" thành biểu tượng cảnh báo trên cùng hàng. Mã ca và
      giờ còn lại nằm trong tooltip, nên rê chuột không còn làm lệch hàng.
- [x] **Task nhiều ngày là một thanh nối liền** (`timelineHelpers.computeLanes`): mỗi kế hoạch một màu
      (`--task-1..6` trong `tokens.css`, có bản tối) và một làn cố định theo người; ngày liền nhau nối thành
      thanh start/middle/end, tên và biểu tượng trạng thái chỉ ở ngày đầu, ngày nghỉ giữa kế hoạch nối bằng nét đứt.
      Hover một ngày làm sáng cả task, mờ các thẻ khác; bóng khi kéo ghi "Chuyển cả task (N ngày)"; kế hoạch đã
      đồng bộ/chờ đối soát dùng con trỏ thường; thẻ chờ đối soát có nền sọc. Thẻ nằm dưới cột Nhân sự khi cuộn.
      Thẻ không còn bị kéo cao 40px bởi quy tắc nút chung (nguyên nhân lệch hàng).
- [x] Cột Nhân sự thêm "Rota còn X h" (tổng giờ còn lại các ngày có ca trong tháng, không tính ngày vượt giờ;
      "chưa xác minh" nếu có ngày chưa tải xong).
- [x] Điện thoại (dưới 760px): Resource timeline chỉ hiện thống kê tải và chọn tháng; ẩn backlog, lưới và nút gửi
      kế hoạch kèm ghi chú cần màn hình lớn.
- [x] 476 frontend tests, lint, typecheck đạt; kiểm tra thủ công trên dữ liệu thật ở khung rộng/mobile, sáng/tối.
- [x] **Drawer kế hoạch task** (thẻ thuộc kế hoạch nội bộ mở "Kế hoạch task" thay cho "Sửa phân công" một ngày):
      tóm tắt task/người/khoảng ngày/tổng giờ, bảng giờ từng ngày sửa được (tổng phải bằng tổng task; để 0 để bỏ
      một ngày), "Lưu giờ các ngày", "Chuyển task", đồng bộ Maximo, xóa. Bỏ ô Nhân lực/Ngày rota/giờ một ngày cho
      thẻ thuộc kế hoạch (thẻ lẻ giữ panel cũ). Thêm ngày hoặc đổi người vẫn dùng "Chuyển task".
- [x] **Backend `POST /resource-pools/{pool}/assignment-plans/{plan}/segments`** (`assignments/plan_segments.py`):
      thay các ngày của kế hoạch local trong một transaction; `expected_version`, `request_id` + biên nhận
      (`/assignment-submissions/{id}`), kiểm tra capacity và tải Maximo từng ngày, tổng phút phải bằng `demand_minutes`,
      ngày bị bỏ chuyển `released` (role runtime không có DELETE), sự kiện kiểm toán từng dòng đổi, tăng version kế
      hoạch và assignment revision. Từ chối kế hoạch đã đồng bộ/chờ đối soát (409) và yêu cầu không đổi gì (422).
      Không cần đổi quyền DB. 12 test nhanh, 20 test Postgres (DB test cổng 55432), 730 test backend không integration.
- [x] **Drawer kế hoạch task (thiết kế cuối)**: chân drawer chỉ có "Đóng/Hủy thay đổi" và "Lưu thay đổi"; "Đổi người / ngày
      bắt đầu…" và "Xóa cả kế hoạch…" nằm trong menu ⋯ ở đầu panel; nhãn "Chưa lưu" khi có giờ chưa lưu; chú giải màu thanh
      giờ (xanh = task này, xám = task khác, đỏ = vượt rota). Bỏ phần gửi Maximo từng task khỏi kế hoạch chưa gửi (việc gửi
      là gửi cả tháng); khối đồng bộ chỉ còn cho kế hoạch đã gửi hoặc chờ đối soát. Kế hoạch đã đồng bộ: cùng khung, bảng
      4 cột Ngày/Giờ/Lịch Maximo/Trạng thái, một dòng "Đã khớp N ngày với Maximo".
- [x] **Xóa cả kế hoạch**: `POST /resource-pools/{pool}/assignment-plans/{plan}/release` (`assignments/plan_release.py`):
      `expected_version` + `request_id`, mọi ngày chuyển `released` (không xóa cứng), version kế hoạch tăng, sự kiện
      `plan_release` từng dòng, biên nhận, capacity các ngày được trả lại, kế hoạch đã gửi/chờ đối soát bị từ chối (409).
      Giao diện có hộp xác nhận nêu số ngày/giờ và "Maximo không bị thay đổi". 16 test Postgres, 7 test nhanh. Chưa chạy
      xóa thật trên DB dev.
- [x] **Dồn giờ theo ô khi kéo task đi** (`assignments/plan_backfill.py` + `plan_moves.py`): khi một kế hoạch rời một ô
      (nhân sự, ngày), các kế hoạch nội bộ chưa gửi Maximo của cùng nhân sự còn nằm trong ô đó và còn ngày sau (bất kể WO)
      nhận giờ trống của ô và nhả đúng số giờ đó từ các ngày cuối của chính nó; sau đó quy tắc lặp lại trên các ô vừa được
      giải phóng (lan theo ô), chỉ kéo giờ về sớm hơn, tổng giờ giữ nguyên, không task nào kết thúc muộn hơn, task một ngày
      không đổi, task bắt đầu sớm hơn được ưu tiên, ngày chưa xác minh tải bị bỏ qua. `move-preview` trả
      `backfill {enabled, plans[before/after/finish], skipped}`; `move` nhận `backfill_plans`, tự tính lại và so sánh (lệch thì
      409 yêu cầu xem trước lại), áp dụng cùng giao dịch (sự kiện `plan_backfill`, một lần đổi revision) và trả
      `backfill_items`. Giao diện: ô tick "Để các task nhiều ngày còn lại của … lấp chỗ trống vừa trống ra" mặc định bật trong
      hộp thoại chuyển task. Kiểm tra trên dữ liệu thật (WO H14309257, ô 01/11): T10 2h rời đi thì T20 8,5h → 10,5h ở 01/11 và
      3,5h → 1,5h ở 02/11; T30 một ngày không đổi.
- [x] **Chuyển task mặc định xếp lại**: hộp thoại chuyển task mở ở chế độ "xếp lại từ ngày thả theo capacity" (dùng ít ngày nhất),
      ví dụ 3,5h + 6,5h sang ô còn 10,5h thành một ngày 10h; nút "Giữ nguyên giờ và độ lệch ngày" quay lại cách cũ.
- [x] **Màu thanh task theo giai đoạn**: T10 xanh dương, T20 xanh lục, T30 cam đất, T40 tím, T50 hồng, T60 trở lên và task khác
      màu xám (`taskHue`, `--task-0..5` trong `tokens.css`, có bản tối); chú giải trong dấu "?" của timeline.
      Chưa xem lại độ tương phản ở chế độ tối trên màn hình.
- [x] 752 test backend nhanh, 479 test frontend; lint, typecheck đạt.
- [x] **Sửa lịch thẳng trên bảng WO** (`scheduling/inlineEdit.ts`, `inlineSave.ts`, `InlineCells.tsx`, `WorkOrders.tsx`): các ô Lịch dự kiến
      (Scheduled Start có lịch và gõ tay), Assigned PIC (chọn từ crew của discipline; crew đọc một lần khi con trỏ/tiêu điểm
      vào bảng) và Duration là ô nhập trực tiếp; Scheduled Finish tự tính theo ca 06:30–18:30, cảnh báo giờ ngoài ca, dòng
      sai (ví dụ start sau Target Finish, Duration không phải số) bị chặn lưu và ghi chú đỏ trên dòng. Ctrl+D điền giá trị
      xuống các dòng đã tick. Thanh "N WO có thay đổi chưa lưu": "Lưu N nháp" cập nhật nháp có sẵn (đơn hoặc nhóm, dùng rebase
      khi nền đã đổi) và tạo nháp mới (một nhóm nếu từ 2 WO) cho các dòng chưa có nháp; "Hủy thay đổi" bỏ phần chưa lưu. Không ghi
      Maximo. WO có từ 2 nháp chưa chọn thì ô vẫn chỉ đọc. Kiểm tra thật: sửa Duration 25h + start 05/10 06:30 + PIC cho
      P13431393 → finish 07/10 10:30, nháp lưu đúng trong DB, đã xóa nháp thử. Chưa làm: Tab/mũi tên đổi dòng theo kiểu bảng tính, bỏ tab
      "Nháp của tôi" và cột Action, thanh áp dụng nhanh cho dòng đã tick, chip chọn nhanh, dán từ Excel vào bảng.
- [x] **Nháp WO không còn hiện số phiên bản**: đổi "Nháp v1/Nháp phiên bản 1" thành "Nháp đã lưu · thời điểm" và "Nháp · sửa lần cuối …".
      Khóa phiên bản vẫn giữ ở backend để chặn ghi đè khi mở hai tab. Khi nháp vừa được lưu ở nơi khác hoặc Maximo đổi WO, editor và
      nháp nhóm hiện nút "Cập nhật theo bản mới nhất / theo Maximo": lấy giá trị và phiên bản mới, giữ phần đã sửa, bỏ phần đã trùng
      Maximo hoặc PIC không còn hợp lệ, rồi lưu bằng `rebase: true`. Backend: `PUT /drafts/{id}` và `PUT /draft-batches/{id}` nhận
      `rebase` (chỉ cho nháp đã có, POST từ chối); baseline lưu được thay bằng baseline Maximo hiện tại, mọi kiểm tra khác giữ nguyên;
      biên nhận ghi `rebased_from` (băm baseline cũ). Chưa có bảng audit riêng cho thao tác lưu nháp (cần migration nếu muốn).
- Chưa làm với endpoint này: chưa chạy trên dữ liệu thật (chỉ kiểm thử trên DB test); chưa thêm ngày mới hay đổi người
  trong bảng giờ; không có test endpoint không cần Postgres.
- Chưa làm: nét đứt qua ngày nghỉ chỉ có test đơn vị và đã được người dùng tạo thử; thông báo riêng cho lỗi 503;
  ô gốc trong `DemoScheduler.tsx`; chưa có tên cho `lead`.

## UI/UX: tràn ngang trang và hộp thoại batch đã xong — 2026-10-19

- [x] Nguyên nhân trang timeline có thanh cuộn ngang ở khung hẹp: chữ phụ ẩn của ô capacity là phần
      tử `position:absolute` không có phần tử cha định vị nên thoát khỏi vùng cuộn của lưới và làm
      rộng tài liệu (scrollWidth 3366px). Thêm `position:relative` cho lưới và ô capacity: tài liệu
      còn bằng viewport (1148 và 786px).
- [x] Hộp thoại gửi kế hoạch: khi batch đã hoàn tất, form giờ bắt đầu/"Tạo preview mới" thu vào mục
      "Tạo preview mới cho thay đổi chưa gửi" ở cuối; kết quả hiện đầu. Preview hết hạn vẫn hiện form
      ở đầu. 416 frontend tests, lint, build đạt; đã xem ảnh trên dữ liệu thật.

## Gộp request auth/settings trùng — 2026-10-16

- [x] `api/shared.ts`: các lời gọi giống nhau đang chạy cùng lúc dùng chung một request, không cache sau
      khi xong; mỗi caller giữ AbortSignal riêng (hủy không ảnh hưởng người khác); `fresh` bỏ qua chia
      sẻ; `forgetShared()` gọi sau đăng xuất và sau khi lưu kết nối. `getAuthSummary` và
      `getConnectionSettings` dùng lớp này (cùng chữ ký, các component không đổi); kiểm tra trước khi
      ghi trong Resource timeline (`verifyMutationContext`) dùng `fresh`.
- Quyết định: không tạo store/hook phiên mới. Chia sẻ request ở lớp API đạt cùng mục tiêu mà không
  chạm logic xóa dữ liệu khi đổi danh tính/quyền trong WO và timeline.
- [x] 414 frontend tests, lint, typecheck, build đạt. Khi phiên đã hết hạn (401) mở timeline còn 1
      cặp auth và 2 lời gọi settings (trước đó 4 cặp và 4–6). Chưa đo lại với phiên đăng nhập hợp lệ vì
      phiên local đã hết hạn; cần đăng nhập lại.

## Đo thời gian tải Resource timeline (dữ liệu thật) — 2026-10-16

- Mở trang khi server đã có cache (Onshore test, E&I, 21 người, tháng 10): lưới dùng được sau
  ~2,3 giây. Chuỗi: settings/auth (0,14–0,86s, 4 auth + 6 settings) → resource-pools (0,6–0,7s)
  → assignment-timeline (0,8→2,3s, 1,5s ở backend) song song work-orders/page (0,87→1,15s);
  plan-upload-batches 1 lần (0,26s) sau đó. Không có lời gọi `/tasks` nào trong 15 giây đầu.
- "Làm mới timeline": timeline 2,0s, work-orders/page `refresh` 0,63s song song, tổng ~2,2s.
- Kết luận: endpoint gộp tóm tắt task không có cơ sở ở trạng thái warm. Phần lớn thời gian là
  `assignment-timeline` (backend) và chuỗi settings → pools phía trước. Lần tải ~25–30s quan sát
  trước đó là lúc cache backend/tóm tắt WO còn nguội (nhiều `/tasks` ~340ms/WO, 2 song song).
- Lỗi tự gây đã sửa: effect lấy batch mới nhất chạy 7 lần/lần mở trang, nay 1 lần (khóa theo id
  pool thay vì object). Chưa đo được lần tải nguội vì cần xóa cache backend/Maximo.

## UI/UX: nút và hộp thoại gửi kế hoạch tháng lên Maximo — 2026-10-16

- [x] Nút đổi tên "Gửi kế hoạch tháng lên Maximo", nút nhấn (xanh) tách khỏi "Làm mới"; hiện
      huy hiệu "N chưa gửi" (số kế hoạch cục bộ trong tháng), luôn hiện khi có quyền ghi và khóa
      kèm lý do (tooltip) thay vì biến mất; đổi thành "Tiếp tục gửi kế hoạch (x/y)" khi tháng có
      batch dở dang (gọi `getLatestPlanUploadBatch`, lỗi thì bỏ qua).
- [x] Hộp thoại: stepper Giờ bắt đầu → Xem trước → Xác nhận → Kết quả; biểu ngữ môi trường (đỏ khi
      Production); chip tóm tắt lọc bảng theo trạng thái; đếm ngược hết hạn preview; câu tóm tắt
      "Sẽ gửi N kế hoạch (X ngày, Y giờ) lên …"; nhãn ngắn ("Gửi N kế hoạch", "Tiếp tục gửi");
      CSS chuyển sang token (hết hex cứng). Logic tạo/xác nhận/khóa/đối soát không đổi.
- [x] 409 frontend tests, lint, typecheck, build đạt; trên dữ liệu thật: nút ghi "2 chưa gửi", mở
      dialog thấy stepper và biểu ngữ "Onshore test · Test". Không tạo preview/gửi gì.
      Chưa xem bằng mắt bảng, chip và đếm ngược (ảnh chụp khung trình duyệt đứng khung).

## UI/UX: brand, tiêu đề trùng và biểu tượng trạng thái — 2026-10-16

- [x] Brand: "WORKORDER / Scheduler" thành "Work Order Scheduler" (ẩn dưới 900px, chỉ còn logo);
      footer chỉ còn "Onshore + Offshore · Nội bộ". `/work-orders` và `/resource-timeline` bỏ
      tiêu đề lớn (giữ `<h1>` ẩn cho trình đọc màn hình) và link "← Tổng quan"; timeline thêm
      nút ‹ › chuyển tháng, điều khiển dồn một hàng (cùng hàng với chip vai trò từ 1360px).
- [x] Biểu tượng trạng thái SVG (`StatusIcons.tsx`): đã đồng bộ (dấu tích xanh), chờ đối soát
      (đồng hồ đỏ), chưa gửi Maximo (vòng nét đứt, mũi tên lên), nhiều ngày (lịch có mũi tên).
      Chú giải đổi từ "Kế hoạch nội bộ" thành "Chưa gửi Maximo: mới lưu trong ứng dụng" và
      "Chờ đối soát: chưa chắc Maximo đã nhận"; tooltip thẻ dùng "Đã xếp, chưa gửi Maximo".
- [x] 407 frontend tests, lint, typecheck, build đạt; DOM trên dữ liệu thật: 14 biểu tượng, lưới
      cao 594px, đáy 828/862px. Ảnh chụp khung trình duyệt đứng khung nên chưa xem biểu tượng
      bằng mắt; cần xem lại hình dạng 14px trên màn hình thật.

## UI/UX: mở rộng khung làm việc timeline — 2026-10-16

- [x] Sau khi viewport-fit làm khung thấp (lưới 490px/862px), thu gọn phần trên: tiêu đề nhỏ hơn,
      thống kê vai trò thành một hàng chip mỏng (từ 104px còn 50px), bỏ padding trên của trang
      timeline; lưới cao `100dvh - 268px`, backlog `100dvh - 200px`. Đo với dữ liệu thật ở viewport
      1134×862: lưới 594px (trước 490px), đáy lưới và backlog cùng ở ~828px, thanh cuộn ngang
      nằm trong màn hình. Từ 1500px trở lên tiêu đề, chip và điều khiển cùng một hàng.
- [x] 407 frontend tests, lint, build đạt. Chưa xem bằng mắt (ảnh chụp khung trình duyệt đứng khung).

## UI/UX: scroll và thông báo timeline — 2026-10-16

- [x] Scroll: thanh cuộn có thumb tương phản, tối thiểu 40px, theo theme (`tokens.css`); lưới
      timeline cao vừa viewport (`100dvh - 372px`) để thanh cuộn ngang nằm trong màn hình khi
      mở trang; backlog sticky, danh sách WO co theo viewport; cuộn dọc chuyển tiếp lên trang
      (không còn bị chặn), chỉ chặn vuốt ngang. Đo trên dữ liệu thật: đáy lưới 833px/862px.
- [x] Thông báo "đã lưu vào kế hoạch nội bộ…" thành toast góc dưới trái, có nút đóng và tự tắt
      sau 10 giây; không còn ghim trên timeline.
- [x] 407 frontend tests, lint, build đạt. Ảnh chụp khung trình duyệt vẫn đứng khung nên chưa xem
      bằng mắt; cần xem lại độ dễ cầm của thanh cuộn.

## UI/UX ưu tiên 3 và 2: đọc nhanh và điều hướng timeline — 2026-10-16

- [x] Resource timeline: donut thành thanh tải theo vai trò (% + thanh, đỏ khi vượt capacity);
      chú giải thành popover "?"; dòng phụ của ô capacity chỉ hiện khi hover/focus (cảnh báo
      "vượt"/"chưa xác minh" luôn hiện, vẫn đọc được bằng screen reader); nút "Hôm nay", tự cuộn
      tới hôm nay (múi giờ nghiệp vụ) khi mở tháng hiện tại và tô cột hôm nay; ô "Tìm nhân sự"
      lọc theo tên/laborcode, giữ tổng theo vai trò và tự mở nhóm đang thu gọn.
- [x] 406 frontend tests, lint, typecheck, build đạt; kiểm tra trên dữ liệu thật bằng DOM
      (17 TECH, nút Hôm nay đưa cột 16/10 về sát cột nhân sự, thanh tải 2%). Ảnh chụp của khung
      trình duyệt bị đứng khung nên chưa xem bằng mắt; cần xem lại.
- Định dạng ngày giờ: bảng/editor đã dùng 24 giờ vi-VN; `am/pm` chỉ do ô `datetime-local`
  theo locale trình duyệt, nên không đổi trong mã.
- [ ] Chưa làm: tiến độ có số giây cho lần tải lạnh, endpoint gộp tóm tắt task (backend).

## UI/UX ưu tiên 1: `/work-orders` mở là có dữ liệu — 2026-10-16

- [x] Khoảng ngày mặc định là tháng hiện tại theo múi giờ nghiệp vụ (`currentMonthRange`);
      lần đầu cho mỗi tài khoản/kết nối/discipline, trang tự Retrieve một lần (App bật
      `autoRetrieve`; `<App autoRetrieveWorkOrders={false}>` dùng cho test). Đổi ngày hoặc lỗi
      không tự gọi lại, cần bấm Retrieve. Skeleton hiện trong lúc tải lần đầu.
- [x] 405 frontend tests, lint, typecheck, build đạt; xem trực quan với dữ liệu thật: mở trang là
      117 WO tháng 10 hiện sau khoảng 2 giây (server đã có cache), skeleton hiện trước đó.
- [ ] Chưa làm: tiến độ có số giây cho lần tải lạnh (~15 giây), endpoint gộp tóm tắt task cho
      backlog Resource timeline (cần backend).

## UI/UX: kiểm tra với backend thật — 2026-10-16

- [x] Xem Resource timeline (Onshore test, E&I, 17 TECH) và drawer phân công ở dark mode và
      mobile 375px với backend + Entra login local thật; không xác nhận/ghi phân công nào.
- [x] Sửa lỗi phát hiện: header ở 375px rộng 530px (nav + chip + menu) làm cả trang tràn
      ngang; nay nav xuống hàng riêng và menu tài khoản rộng đủ màn hình. Drawer mobile
      full-screen, không tràn ngang, nút hành động nằm trong viewport.
- Ghi chú chạy local trên Windows: dùng `.cache/backend-settings-server.py` (selector loop)
  thay lệnh `uvicorn` trong README vì psycopg async không chạy với ProactorEventLoop; và
  `npm run dev:https` vì redirect URI Entra là `https://localhost:5173`.
- [x] Trang `/work-orders` ở 375px với dữ liệu thật (1 WO Onshore test, chỉ đọc): bảng 980px đổi
      thành thẻ có nhãn (`data-label`), thanh thao tác nổi và editor dialog vừa màn hình, không
      tràn ngang. `/rota-imports` chỉ dùng trên màn hình lớn nên không kiểm tra mobile.

## UI/UX bước 5: Resource timeline (một phần) — 2026-10-16

- [x] Tách helper thuần (ngày, giờ, capacity, gợi ý plan) sang `timelineHelpers.ts` và
      `RoleDonut.tsx`; `ResourceTimeline.tsx` giảm 1092 → 1050 dòng, không đổi hành vi.
- [x] Chữ tối thiểu 11–12px (trước 9–11px), ô lịch 84×72px. 403 tests, lint, typecheck,
      build đạt.
- [x] 2026-10-16 (tiếp): xem trực quan timeline light/dark với dữ liệu giả lập (7 nhân sự,
      tháng 10/2026). Tiêu đề và điều khiển cùng hàng, thống kê vai trò thành dải ngang
      gọn, thẻ WO nền trắng, nút "+ WO" mờ cho đến khi hover, nút chính của hộp thoại dùng
      màu nhấn thay teal. Chỉ CSS, không đổi logic.
- [x] 2026-10-16: hộp thoại phân công (`proposal`) thành drawer phải 640px (980px khi chọn task),
      scrim nhẹ, nút hành động ghim đáy; xem trực quan với dữ liệu giả lập. Dialog chuyển
      plan và đồng bộ hàng loạt vẫn là dialog giữa màn hình.
- [ ] Chưa làm: popover chú giải, và tách tiếp ~1000 dòng JSX còn lại (backlog, lưới,
      dialog phân công) thành component. Cần xem trực quan và test từng bước vì luồng ghi
      phân công/đối soát là phần rủi ro cao.

## UI/UX bước 4: panel và luồng upload — 2026-10-16

- [x] Dialog làm việc (editor 1 WO, nhóm) cùng kích thước, bo nhẹ, có scrim; drawer 520px. Header
      editor/nhóm hiện chip môi trường. Panel đối chiếu có stepper Chỉnh sửa → Đối chiếu → Kết
      quả, banner đích upload (Production đổi màu đỏ kèm cảnh báo ghi Maximo thật) và tóm tắt
      Hoàn tất / Lỗi-xung đột / Cần đối chiếu; danh sách trạng thái từng WO giữ nguyên.
- [x] 403 frontend tests, lint, typecheck, build đạt; xem trực quan editor WO (dữ liệu giả lập).
      Chưa xem trực quan panel upload/batch với dữ liệu thật; logic upload không đổi.
- [ ] Chưa chuyển editor 1 WO sang drawer (layout 2 cột cần rộng); đánh giá lại sau bước 5.

## UI/UX bước 3: thanh công cụ WO — 2026-10-16

- [x] `/work-orders`: một thanh công cụ gồm segmented "WO đã tải | Nháp của tôi", ô tìm kiếm
      luôn hiện, Cập nhật, Bộ lọc (status/lập lịch/nháp) và Bảng gọn/thoáng (lưu localStorage
      như tùy chọn hiển thị). Thanh thao tác nổi chỉ hiện khi có WO được chọn (Lập lịch nhóm /
      Mở nháp nhóm, Bỏ chọn). Cảnh báo dữ liệu cũ thành nhãn riêng.
- [x] 402 frontend tests, lint, typecheck, build đạt; đã xem trực quan light/dark với dữ liệu
      giả lập. Chưa làm: gộp "Nháp" lặp trong ô (giữ để không chỉ dựa vào màu), popover khoảng
      ngày, trạng thái rỗng có nút hành động.

## UI/UX bước 2: shell và điều hướng — 2026-10-16

- [x] Header chỉ còn 3 mục chính (Work orders, Resource timeline, Rota) có trạng thái active
      (`aria-current`); `components/UserMenu.tsx` gom tài khoản/quyền, Cài đặt, Admin, chế độ
      tối, đăng xuất và chip môi trường (Onshore/Offshore · TEST/PROD, luôn hiện). Link demo chỉ
      hiện ở bản dev (`import.meta.env.DEV`); route demo vẫn tồn tại.
- [x] Trang chủ thay hero/tiến độ dự án bằng 3 thẻ vào việc, thẻ phiên đăng nhập và trạng thái
      dịch vụ. Chưa có số liệu dashboard (WO chưa lập lịch, upload lỗi) vì cần API tổng hợp mới.
- [x] 401 frontend tests, lint, typecheck, build đạt. Đã xem trực quan trang chủ, menu và
      trang Rota ở light/dark với phiên giả lập; sửa màu tên tài khoản trong menu. Chưa xem
      trang WO/timeline có dữ liệu thật.

## UI/UX bước 1: hợp nhất design token — 2026-10-16

- [x] Tách token Carbon g10/g100 sang `frontend/src/tokens.css`, thêm token ngữ nghĩa
      (info/warning/danger/success, teal, tooltip, scrim, shadow). RotaImports,
      RotaStagingPreview và ResourceTimeline không còn hex cứng (trừ chữ trắng trên nút
      màu nhấn), nên dark mode áp dụng đồng nhất.
- [x] 399 frontend tests, lint, typecheck và build đạt (chunk advisory cũ còn).
      Chưa kiểm tra trực quan bằng trình duyệt; cần xem hai trang rota ở dark mode.
- [ ] Bước 5 còn lại: drawer phân công và tách tiếp ResourceTimeline (xem mục bước 5).

## Chuyển task local bằng kéo thả — hoàn tất 2026-10-15

- [x] Kéo task local sang ngày khác cùng người mặc định chuyển riêng đoạn;
      có Dời toàn task. Kéo sang người khác chuyển toàn kế hoạch, kể cả ngày
      ngoài tháng. Chuyển task trong editor cung cấp cùng luồng cho bàn phím/
      cảm ứng, gồm cả plan một ngày. Preview trước/sau/capacity và Hủy/Esc;
      chỉ Xác nhận chuyển mới lưu local, không ghi Maximo.
- [x] Shift giữ độ lệch ngày/giờ; thiếu rota/capacity chặn lưu và cho lựa chọn
      phân bổ lại từ ngày thả. Tổng giờ còn giữ chỗ, nhu cầu gốc, nguồn task/
      assignment và ID đoạn được bảo toàn khi shift. Reallocate cập nhật cả
      đoạn thêm/released; không âm thầm bù phần giờ đã xóa trước đó.
- [x] Backend kiểm tra quyền/source/baseline sau I/O, dùng cùng khóa với upload,
      version và UUID/receipt; commit toàn plan hoặc rollback. Preview/batch
      cũ mất hiệu lực. Runtime local chỉ thêm quyền UPDATE(person_id,laborcode)
      trên header; không migration/dependency mới. [Runtime](evidence/plan-move-runtime-2026-10-15.json).
- [x] 106 PostgreSQL tests (35move + plan/daily/bulk + runtime role), 399
      frontend tests, typecheck/lint/build/diffcheck đạt. Review Sol/high có
      2P2 focus/scroll modal; main hoàn tất sửa và test Tab busy/unknown,
      khóa toolbar/scroll, cleanup, UUID hiển thị và beforeunload. Integration
      test kéo thả→reallocate→commit merge đủ source/target/released; mất
      response→GET receipt không POST lần hai. Build còn advisory chunk>500KB.
- [x] Live P13468351 Task20/source547209, plan63888199: CHANLD→MINHNC→CHANLD,
      đúng2đoạn0,5h01/10 +9,5h02/10. Nghiệm thu từ trạng thái mới nhất sau
      pause: planversion3→5,4audit events/2lần chuyển; lịch/người/giờ cuối
      khôi phục đúng, mọi plan/allocation khác giữ nguyên,0upload attempts.
      Maximo parent/tasks snapshots trước/sau bằng nhau. Preview HAIDQ kín
      tải01–02 bị chặn; reallocate03/10=9,5h+04/10=0,5h đúng rồi Hủy.
      Bản preview stale bị từ chối; refresh trước khi thử, không ghi đè thay đổi.
      [Bằng chứng](evidence/plan-move-live-2026-10-15.json),
      [preview](evidence/plan-move-transfer-preview-2026-10-15.jpg),
      [đã chuyển](evidence/plan-move-transferred-2026-10-15.jpg),
      [đã hoàn trả](evidence/plan-move-restored-2026-10-15.jpg).
- Không còn việc bắt buộc của feature. Tiếp theo user nghiệm thu kéo chuột
      thực tế trên máy tính; browser live dùng panel Chuyển task, đường pointer
      drag đã kiểm thử tự động. Không mở chuyển task synced/unknown hoặc tách
      một plan cho nhiều người. Ubuntu staging vẫn phụ thuộc IT/server/TLS/routes.

## Phân tích chuyển task local bằng kéo thả — 2026-10-15

- [x] Đọc luồng FE dropPayload/canEditItem và BE validate_plan_edit/routes:
      hiện hỗ trợ chuyển đoạn local sang ngày khác cùng người, chặn ngày đã
      có đoạn cùng plan; đổi người bị chặn cả FE/BE dù plan chỉ có1ngày.
      Header plan giữ person/laborcode chung, synced/unknown không được sửa.
- Đề xuất tại thời điểm phân tích (đã triển khai ở mục hoàn tất phía trên):
      cùng người mặc định chuyển riêng ngày đang kéo;
      khác người chuyển toàn task/plan nguyên tử, preview tất cả ngày kể cả
      ngoài tháng, giữ tổng giờ/nguồn assignment và audit. Dịch ngày giữ độ
      lệch các đoạn; thiếu capacity/rota thì chặn và đề xuất phân bổ lại từ
      ngày thả, không tự âm thầm đổi lịch. Tách task cho nhiều người ngoài
      phạm vi vì thay invariant plan/upload hiện tại.
- Backend cần API chuyển plan có UUID/version, khóa chung với upload, recheck
      scope/WO/source/rota/tải Maximo; cập nhật header + mọi đoạn trong một
      transaction, trả tải cả ô nguồn/đích. Vô hiệu preview/batch cũ bằng version.
- Lượt phân tích ban đầu chỉ đọc code. Sau khi user duyệt, contract, triển khai,
      kiểm thử và nghiệm thu được ghi tại mục hoàn tất phía trên.

## Thoát panel sau xem trước đồng bộ — 2026-10-15

- [x] Tách khóa sửa/lưu khi có preview khỏi khóa đóng panel khi đang xử lý
      hoặc chưa rõ kết quả upload. Preview xong cho Hủy/Esc đóng, giữ nguyên
      kế hoạch đã lưu; muốn sửa/lưu thì chọn Chỉnh giờ / Tạo preview mới.
      Esc xử lý tại dialog với trạng thái khóa hiện tại.
- [x] 74 focused tests đạt (Hủy, Esc, quay lại sửa, không phát upload/update/
      delete khi thoát); recheck riêng unknown vẫn khóa Hủy/Esc đạt.
      Lint/typecheck/build đạt, còn advisory chunk >500KB đã có.
- [x] Live preview P13468351/Task20, Le Duc Chan, 2ngày/10h: Hủy bật,
      lưu vẫn khóa trong preview, bấm Hủy đóng và mở lại còn nguyên kế hoạch;
      preview lần sau Esc đóng được. Không bấm gửi/lưu/xóa, không ghi Maximo.
      [Hủy đã bật](evidence/plan-preview-cancel-enabled-2026-10-15.jpg),
      [panel đã đóng](evidence/plan-preview-dismissed-2026-10-15.jpg).
- Tiếp theo user mở lại kế hoạch và thử Xem trước → Hủy/Esc; không cần gửi
      batch mới để nghiệm thu lỗi đóng panel.

## Rút gọn thẻ timeline và tooltip task — 2026-10-15

- [x] Thẻ giữ task/WONUM/giờ trên một dòng; dùng ✓ đồng bộ, ! chờ đối soát,
      ◇ kế hoạch nội bộ và biểu tượng hai lớp cho nhiều ngày. Chú giải dùng
      chung, trạng thái đầy đủ giữ trong tên truy cập và tooltip; không dựa
      riêng vào màu, không lặp câu dài hoặc nhãn 1 ngày trong từng ô.
- [x] Tooltip mô tả task/WO/người/ngày/giờ/status sau 2 giây hover, mở ngay
      khi focus bằng bàn phím; Esc đóng. Bấm thẻ vẫn mở chi tiết để dùng
      được trên điện thoại. Không thêm request, dependency hoặc remote write.
- [x] Live UI xác nhận thẻ gọn, biểu tượng và chú giải, tooltip bàn phím
      đọc đủ mô tả Task20 P13469691 ngày02/10, Esc đóng, bấm mở đủ3ngày/21h.
      67 timeline tests, typecheck/lint/build đạt; build còn advisory chunk
      >500KB đã có. Kiểm thử hủy timer khi rời thẻ/cuộn/Esc và focus bàn phím.
      [Ảnh](evidence/timeline-compact-tooltip-2026-10-15.jpg).
- Tiếp theo nghiệm thu cảm giác hover 2 giây trên máy tính; không cần gửi
      batch mới để kiểm chứng thay đổi trình bày này.

## Xem chi tiết phân công sau đồng bộ — 2026-10-15

- [x] Thẻ đã đồng bộ mở bảng chỉ đọc: WO/task, người/laborcode, site,
      kết nối, trạng thái và từng ngày/giờ/Assignment ID. Giờ bắt đầu đọc
      mới từ đúng task và ID đã map; kết thúc dự kiến tính theo số giờ,
      không trình bày như finishdate lưu trên Maximo.
- [x] Nhận đủ phân đoạn từ biên nhận khi có quyền; thiếu biên nhận vẫn giữ
      trạng thái synced và báo độ phủ có thể thiếu ngày. Nhãn 1 ngày/nhiều
      ngày dựa tổng giờ plan. Bỏ form/nút sửa, lưu, xóa và preview đã khóa;
      giữ nguyên luồng local và đối soát unknown.
- [x] Live P13469691 Task10 đủ1ngày/1h; Task20 đủ3ngày/21h, đúng ID,
      giờ bắt đầu và trạng thái. Snapshot đọc trước/sau của cả P13469691
      và P13470381 bằng nhau ở mọi trường, không ghi Maximo.
      70 focused tests (timeline + plan upload), typecheck/lint và build đạt; build còn
      advisory chunk >500KB đã có. [Bằng chứng](evidence/synced-details-ui-2026-10-15.json),
      [ảnh nhiều ngày](evidence/synced-details-multi-day-2026-10-15.jpg).
- Không còn bước bắt buộc cho sửa hiển thị này. Nên nghiệm thu bằng cách
      mở thẻ synced trong timeline; Ubuntu staging vẫn cần IT cung cấp
      server/quyền truy cập/TLS/routes và test roster.

## Nghiệm thu trực tiếp tab Assignments Maximo Test — 2026-10-15

- [x] Dùng tab Maximo Test user đã đăng nhập, Work Order Tracking (Oil) /
      Assignments, BD1. P13470381 có đúng3dòng: Task10 HAIDQ04/10/2026 06:30
      1:00 ASSIGNED; Task20 cùng người/ngày/giờ 5:00 ASSIGNED; Task30 1:00
      WAITASGN/null labor/ngày. Tổng đã phân công6h khớp batchde22845d.
- [x] Tra P13469691 trong cùng UI: đúng5dòng,4ASSIGNED cho HAIDQ: Task10
      01/10 06:30 1:00; Task20 ngày01/02/03 lần lượt9:30/10:30/1:00, đều06:30.
      Task30 vẫn WAITASGN3:00/null labor/ngày, tổng assigned22h, không dòng thừa.
- [x] CraftE&I/SkillOPSTECH và toàn trường parent ScheduledStart/Finish,
      TargetStart/Finish của2WO khớp snapshot API. Mở ViewDetailsTask10 để
      kiểm chứng field người/giờ/status; bảng và detail này không hiển thị
      AssignmentID/Finishdate nên hai trường đó giữ bằng chứng API trước.
- [x] Assertions so từng UIrow/header với APIevidence đạt; ảnh2WO và JSON
      không lưu URLsession/token. Chỉ search/navigation/viewdetails,0mutation,
      không app/schema/dependencychange; không cần chạy lại app test suite.
      Đã trả tab về P13470381/Assignments như lúc user bàn giao.
      [UI evidence](evidence/maximo-assignments-ui-2026-10-15.json),
      [P13470381](evidence/maximo-assignments-P13470381-2026-10-15.jpg),
      [P13469691](evidence/maximo-assignments-P13469691-2026-10-15.jpg).
- Đã khép nghiệm thu tabAssignments cho2batch Test đã gửi; không mở rộng
      production/edit/delete/rollback/capacitystress. Tiếp theo ưu tiên Ubuntu
      staging cùng luồng; bị chặn IT cấp server/quyền truy cập/TLS/routes và
      test roster. Không còn bước bắt buộc của lượt kiểm tra UI này.

## Nghiệm thu sequencing thật: hai mục ready — 2026-10-14

- [x] UI batchde22845d OnshoreTest/E&I: P13470381/HAIDQ Task10=1h,
      Task20=5h ngày04/10,2ready mới/2skipped P13469691 đãsynced. Một confirm,
      tự động2continue200→2confirmed, khôngtimeout/blocked/unknown/retry/repair.
- [x] Timing local ASGI chỉroute/status/time: continue1end16:10:05.144727UTC,
      GETtimelineend16:10:06.913883, continue2start16:10:07.680385; monotonic
      gap0,766s, nooverlap. Intent timestamps trong đúngrequest tương ứng;
      GET sau mục2 cũng200. Observer đãdừng, normal runner khôi phục/ready200.
- [x] API GET/ledger:555221/555225 giữID, ASSIGNED/HAIDQ/scheduledate06:30,
      finishdate07:30/11:30, total6h;2receipts/mapping unique, khôngAdd/duplicate.
      Task30/555229 WAITASGN1h/null labor/ngày/full protected+rowstamp giữ;
      planned cả3task/parentbusiness giữ. P13469691 cũ giữ dữ liệu/tải630/630/60.
- [x] Reload Scheduler latestcompleted2confirmed/2skipped; tảiHAIDQ04/10
      6/10,5h, còn4,5h; effectiveallocated360 không doublecountlocal/remote.
      [Bằng chứng/timing](evidence/bulk-sequence-live-2026-10-14.json),
      [preview](evidence/bulk-sequence-preview-2026-10-14.jpg),
      [ảnh kết quả](evidence/bulk-sequence-confirmed-2026-10-14.jpg),
      [báo cáo](bulk-plan-uploads.md#sequencing-thật-với-hai-mục-sẵn-sàng--2026-10-14).
- Giới hạn: localWindows/Vite/HTTPS/MaximoTest, không faultinjection/stress/
      Ubuntu/production. API đọc theo user chọn, chưa tabAssignments UI. Không
      app/schema/dependencychange hoặc migrations; không chạy lại suite app.
      Dữ liệu Test giữ lại, không cleanup/rollback remote.
- TabAssignments đã nghiệm thu trực tiếp ngày15/10 ở mục đầu; Ubuntu staging
      chờ IT cấp server/TLS/routes/test roster để thử cùng luồng trên hạ tầng triển khai.

## Nghiệm thu bulk Test qua UI gửi và API đối chiếu — 2026-10-14

- [x] User chọn API đọc+bảng đối chiếu khi remote bằng điện thoại, chưa có
      Maximo browser session. Scheduler gửi P13469691/BD1/E&I/HAIDQ:
      Task10 1h,Task20 21h;552343/552349 giữ ngày đầu,2001472/2001474 mới
      ngày02/03. Cả4dòng ASSIGNED, scheduledate/finishdate/laborhrs khớp;
      total22h,2confirmed receipts và mapping duy nhất.
- [x] Lượt đầu batch8c0e8f9b:Task10confirmed,Task20pool locktimeout10s trước
      intent. Source revision giữ, không daily/legacy intent; main dừng đúng
      backend đã hết request, scoped guard và3append-only batch_no_send events
      đóng Task20blocked, giữ UUID/proposal. Không gửi lại unknown.
- [x] Sửa UI chờ receipt/capacity refresh trước mục kế tiếp; SQLAlchemyError
      dùng receipt lookup, không intent→blocked, DB không đọc được→unknown.
      Completed/no unknown có preview mới. Batch4bbe4519:Task10skipped đã
      synced,Task20confirmed; tổng2outbound, không duplicate/rollback.
- [x] API GET đối chiếu sourceID/mapping/finishdate, Task30/552355 WAITASGN3h
      null labor/ngày/rowstamp và cả3planned labor giữ. Parent schedule/estdur/
      targets giữ so snapshot sauTask10/trướcTask20. Effective load630/630/60
      phút, reload Scheduler vẫn đúng/no doublecount, latest batch completed.
- [x]50PG (23bulk+27daily),65frontend liên quan,Ruff/typecheck/lint/build đạt;
      build lần đầu sandbox spawnEPERM, escalation chạy đạt/chunk advisory cũ.
      Main review sửa localized, không gọi reviewer mới/reset milestonebudget.
      [Bảng đối chiếu/giới hạn](bulk-plan-uploads.md#nghiệm-thu-dữ-liệu-test--2026-10-14),
      [initial](evidence/bulk-plan-live-initial-2026-10-14.json),
      [final/audit](evidence/bulk-plan-live-2026-10-14.json),
      [ảnh](evidence/bulk-plan-live-confirmed-2026-10-14.jpg).
- Giới hạn: không trực tiếp tab Assignments; dữ liệu gửi Test giữ lại.
      Chưa live batch nhiều mục ready sau sửa sequencing (deferred frontend
      regression đã đạt); không production/edit/delete/automaticrollback.
- Live batch nhỏ2ready sau sửa đã đạt14/10; tabAssignments trực tiếp đạt15/10
      ở mục đầu. Ubuntu staging chờ IT cấp server/TLS/routes/test roster.

## Đồng bộ hàng loạt trên timeline — 2026-10-14

- [x] Backend gom toàn bộ plan trong pool/discipline có ngày thuộc tháng chọn,
      giữ đủ cross-month segments; batch/confirmation/proposal/UUID bền vững,
      bounded prepare/continue và kết quả riêng từng mục, không gửi lại unknown.
- [x] UI nút chung, preview/kết quả20mục/trang, một xác nhận tự xử lý lần lượt,
      khôi phục batch sau reload và cập nhật đúng ngày, không reload backlog.
- [x] 48PostgreSQL (21bulk+27daily),110offline, runtime-role1 và Ruff đạt:
      scope/CSRF/revocation/duplicates/concurrency/partial/unknown, hai nguồn
      cùng task, kế hoạch qua tháng,21mục/page20/globalselector, deadline504
      và1001mục bị từ chối rõ. Runtime không sửa frozen/proposal/UUID/scope.
      Review và kiểm tra lại finding đã sửa: không còn P1/P2; reviewer không
      chạy được Vitest do sandbox spawn EPERM, main chạy suite riêng.
- [x] Fullfrontend386 đạt với4worker, typecheck/lint/build đạt (chunk advisory
      hiện có). Lượt31worker trước385/386, một test phân trang cũ timeout5s;
      không đổi test/timeout, chạy lại giảm concurrency để tránh tranh CPU.
- [x] Backup/migration0016 local giữ hash tất cả cột cũ; runtime grants và
      Alembiccheck đạt. API mới HTTPSlive/ready200. BrowserP13469691/HAIDQ:
      Task10=1h,Task20=21h, tổng22h/4đoạn; tải ngày630/630/60phút.
      Preview2mục và reload recovery đạt, chưa bấm xác nhận gửi. Dọn4trial
      segments, reserved0/planuploadattempt0, tải UI về0.
      [Luồng/API](bulk-plan-uploads.md),
      [migration](evidence/bulk-plan-development-0016-2026-10-14.json),
      [bằng chứng UI](evidence/bulk-plan-ui-2026-10-14.json),
      [ảnh preview](evidence/bulk-plan-preview-2026-10-14.png).
- Lượt preview này chỉ gửi/recovery bằng mockPG; nghiệm thu gửi Test sau đó
      qua UI/API đọc đã ghi ở mục đầu, tab Assignments trực tiếp còn chờ session.

## API và UI đồng bộ kế hoạch theo ngày — 2026-10-14

- [x] Mapping ID từng ngày tách khỏi assignment nguồn; preview toàn plan,
      durable intent/receipt theo actor/request UUID, gửi một lần và đối soát
      chỉ đọc. Khử trùng tải theo remote ID, khóa toàn plan synced/unknown.
      UI có preview, giờ bắt đầu, gửi, recovery sau tải lại và cập nhật ngày
      liên quan; hỗ trợ kế hoạch qua tháng. [Luồng/API](daily-plan-uploads.md).
- [x] Local migration0015: backup trước nâng cấp, hash toàn cột dữ liệu cũ
      không đổi, không suy mapping cũ, runtime không sửa intent; Alembiccheck đạt.
      [Bằng chứng](evidence/daily-plan-development-0015-2026-10-14.json).
- [x] Sửa hai P1: hai transaction cùng thứ tự User→UUID→pool→connection;
      unknown reservation giữ tải giữa hai phase, recheck PERSON/WO/capacity
      và fingerprint kết nối mới trước một send. P2 editor cập nhật receipt.
      110offline/61PostgreSQL/1runtime-role đạt, Ruffclean; 376frontend,
      typecheck/lint/build đạt (chunk warning hiện có). Independent review
      và một focusedP1 recheck gồm6PG đạt; không mở rộng review tiếp.
- [x] API mới chạy local, health HTTPSproxy live/ready200; bật contract đúng
      Onshore Test. Browser P13469691/Task20/HAIDQ:21h→630+630phút01–02/10,
      preview06:30–17:00; Task10 đổi giờ06:31→07:31. Chưa bấm gửi; cả3đoạn
      trial đã release, reserved0/uploadattempt0 và tải UI về0.
      [Bằng chứng](evidence/daily-plan-sync-ui-2026-10-14.json),
      [ảnh preview](evidence/daily-plan-sync-preview-2026-10-14.png).
- Luồng public daily đã được gửi Test qua bulk ở mục đầu; chưa bấm riêng nút
      editor hoặc đối chiếu tab Assignments trực tiếp. Mock/API đã kiểm tra lost
      response. Nút gửi hàng loạt toàn tháng
      đã bổ sung ở mục trên; remote sửa/xóa/conditionalDELETE là contract riêng.

## Khởi động lại local backend/API — 2026-10-14

- [x] Khởi động backend loopback8000 và ViteHTTPS5173 bằng cấu hình hiện có.
      API health live/ready200; HTTPSproxy ready200 với certificate verification
      dùng cert local hiện có. Ready chỉ xác nhận DB/schema, không kiểm tra Maximo.
- Tiếp theo: tải lại Resource timeline để tiếp tục nghiệm thu; mapping/preview
      đồng bộ nhiều ngày vẫn theo mục contract bên dưới.

## Contract tạo assignment theo ngày và đối soát — 2026-10-14

- [x] TestH14306907/task10:1968934 giữ ID cho03/10 2,5h, Add2001470 cho04/10
      2,5h; sibling2001462 giữ protectedfields/rowstamp, total task10h/source5h.
      Mô phỏng mất phản hồi ở handler sau một send, GETreconcile/persist mapping
      không Addretry; stale root conflict, không duplicate. Cleanup targeted
      ownedchild +sourceMERGErestore giữ originalIDs, lịch/targets/planned/local;
      tải hai ngày về0/0. [Bằng chứng/contract](daily-assignment-contract.md).
- [x] MERGEchildDelete vẫn bị bỏ qua ngay cả observedhref, giữ outcomeunknown.
      DELETEobservedlocalref dọn đúngownedtrial giữIDs; conditionalguard chưa
      verified(noETag), không dùngREPLACE, không bật publicDelete/autorollback.
- [x] Operator/Testmodule builder/fullreader/readonlyreconciler/sendonce +35tests;
      122relatedtests gồm30PG/Ruff đạt, reviewprotocol/focusedP1recheck đạt.
      TestRAMschema mất khiDockerrestart: nạp migration hiện có vào DBtest riêng
      rồi chạy lại; appDB không migrate, không thêm migration/dependency/UI.
- [x] Nối durable childmapping, ledger tải khử trùng và preview Đồng bộ Maximo
      vào API/UI theo mục trên. Create+readonlyrecovery đã có Testproof; không
      dùng automaticrollback/delete cho unknown. ConditionalremoteDelete/edit
      cần xác minh riêng trước mở lifecycle thay đổi đã gửi.

## Làm rõ đồng bộ phân bổ timeline vào Maximo — 2026-10-13

- [x] Kiểm tra code hiện tại: Xác nhận lưu chỉ lưu nội bộ; Completed nghĩa đủ
      giờ phân bổ, không phải đã đồng bộ. Upload assignment chỉ xuất hiện trong
      dialog của legacy task allocation không có plan_id khi contract được bật.
      Luồng tự động hiện tạo plan_id kể cả một đoạn nên không hiện nút upload.
- [x] Đồng bộ hàng loạt kế hoạch tự động đã tích hợp ở mục14/10 với preview
      WO/task/người/ngày, một xác nhận, biên nhận và mapping từng nguồn.
      Không dùng collectionREPLACE/automaticDelete rollback
      hoặc suy đã gửi từ Completed.

## Đo tải metadata với hai phiên Planner API — 2026-10-13

- [x] User chọn hai phiên API test trước vì chưa có hai tài khoản Planner thật.
      Hai identity/cookie/grant độc lập trong schema riêng của guarded scheduler_test;
      Maximo Test GET thật, live DB chỉ đọc, không ghi phân công/Maximo.
- [x] Khảo sát9–12/2026:166/117/55/77WO; chọn9/2026=166, lớn nhất trong4tháng.
      Ba cặp cold +5cặp warm page +5cặp search:26response200; median323/86/65ms.
      Cold mỗi cặp1metadata+2guard; warm0metadata+2guard, shared snapshot đạt.
- [x] Stress5.000WO giả lập:26response200,25sourcepages/cặp cold dùng chung;
      warm không đọc metadata, median118/23/28ms không gồm network delay.
      4harness guardtests/Ruff đạt, schemas test đã dọn. UI117WO một mẫu:
      refresh1,823s/page0,840s/search1,363s gồm debounce và automation overhead.
      [Phương pháp, raw samples và giới hạn](metadata-cache-load-verification.md).
- Tiếp theo: đo qua HTTPS/proxy Ubuntu khi IT cấp hạ tầng; nghiệm thu hai tài
      khoản Entra Planner thật khi có tài khoản được cấp phạm vi hợp lệ.
      Chưa kết luận capacity production từ ASGI/local và upstream giả lập.

## Cache metadata và phân trang WO — 2026-10-13

- [x] Thay bounded scan60WO bằng snapshot metadata đầy đủ theo scope, TTL120giây;
      backend search/filter toàn snapshot, trả20WO và tổng chính xác của snapshot.
      Browser chỉ giữ trang hiện tại/WO chọn; task/assignment vẫn lazy-load.
- [x] Cache bounded8entry/20.000row/32MiB, singleflight, refresh rõ ràng; cursor
      gắn thế hệ/user/query/membership. Mỗi trang có live scope guard nhỏ kể cả
      trang đầu; lỗi guard discard đúng thế hệ. Count thiếu/đổi bị từ chối.
- [x] 119BE liên quan/366FE/92API-timeline/typecheck/lint/build/Ruff đạt.
      Independent review và focused P1 recheck đạt sau sửa guard/count.
      Live trang1–4 đều20/117; search H14307245 ở trang4 trả1/1, không ghi Maximo.
      Build còn warning chunk553,80kB. [Contract/evidence](maximo-backlog-pagination.md).
- Đo tải hai phiên API đã hoàn tất ở mục trên. Nhiều worker có cache riêng;
      cần tài khoản/phạm vi Mech hoặc Deck được cấp hợp lệ để nghiệm thu
      isolation live ngoài E&I.

## Rút gọn đầu danh sách timeline — 2026-10-13

- [x] Bỏ tiêu đề Backlog/tổng WO đầu cột và thanh người/phân công/giới hạn.
      Giữ ba tab, tìm kiếm, phân trang/tổng WO và donut; giải thích còn
      “Completed: đã phân bổ đủ.” Không đổi filter hoặc kiểm tra10,5h.
- [x] 57tests timeline và typecheck đạt. Live897×742 không còn các dòng lặp,
      pagination vẫn1–20/117WO trang1/6; không ghi phân công/Maximo,
      viewport override đã reset.
      [Ảnh giao diện gọn](evidence/timeline-cleanup-2026-10-13.png).
- Tiếp theo: nghiệm thu lọc Completed sau khi WO được phân bổ đủ hoặc giảm giờ
      để đối chiếu chuyển danh sách, theo mục cập nhật phân công nhẹ.

## Chuẩn hóa thẻ task và ngày hiển thị — 2026-10-13

- [x] Checkbox/Task ID cùng hàng, mô tả riêng; hàng Giờ phân công có ô80px
      và đơn vị giờ. Assignment nhỏ bên dưới, viền nhẹ cho thẻ được chọn;
      task ngoài nhóm giữ chỉ đọc và nhiều assignment vẫn chọn rõ dòng nguồn.
- [x] Tiêu đề ngày bảng phân bổ/tóm tắt hiện dd/mm/yyyy; state/API/aria identity
      vẫn ISO, không đổi phân bổ/capacity hoặc payload.
- [x] 57tests timeline/typecheck/lint/build đạt; chunk550,07kB còn warning.
      Live897×742: ba ô giờ đúng80px, previewP13469691 từ02/10 giữ25h
      xếp10,5+10,5+4h. Chưa lưu/ghi Maximo; viewport override đã reset.
      [Ảnh thẻ task mới](evidence/task-card-polish-2026-10-13.png).
- Tiếp theo: nghiệm thu một WO có nhiều assignment WAITASGN để đối chiếu
      dropdown nguồn với thẻ chỉ có một dòng; không cần mở rộng quyền.

## Gộp ngày bắt đầu phân bổ — 2026-10-13

- [x] Phân bổ task chỉ có một Ngày bắt đầu cạnh Nhân lực, bỏ bộ chọn rota
      và ngày bắt đầu lặp trong pane ngày. Tóm tắt/capacity theo ngày đã chọn;
      đổi người giữ ngày bắt đầu. Giữ anchor min/max365 và kiểm tra capacity.
      Sửa phân công/WO không có task giữ Ngày rota. Hướng dẫn còn một câu.
- [x] 57tests timeline/typecheck/lint/build đạt; chunk549,49kB còn warning.
      Test đổi ngày và đổi người giữ anchor,
      các test tải capacity từ ngày ngoài tháng/lưu đúng preview vẫn qua.
      LiveP13469691 đổi01→02/10:25h xếp10,5+10,5+4h ngày02/03/04;
      không lưu/ghi Maximo. Preview hiện ở02/10.
      [Ảnh một ngày bắt đầu](evidence/task-single-start-2026-10-13.png).
- Tiếp theo: nghiệm thu cùng WO bằng Planner Mech/Deck; cần tài khoản có quyền
      discipline tương ứng để đối chiếu task/nhân lực thật.

## Rút gọn thông tin thẻ task — 2026-10-13

- [x] Bỏ dòng planned labor/quantity/số assignment khả dụng ở note1 vì trùng
      thông tin Assignment Maximo ở note2. Giữ ID/mô tả, tổng giờ chỉnh được,
      dòng nguồn assignment và thông báo task hỗn hợp/không có nguồn khả dụng.
      Không đổi cách tính giờ, chọn nguồn hoặc payload.
- [x] LiveP13469691: task20/30/10 chỉ còn nguồn21h/3h/1h ở vùng Assignment;
      preview25h giữ nguyên, chưa lưu.56tests timeline và typecheck đạt.
      [Ảnh thẻ task](evidence/task-card-no-duplicate-2026-10-13.png).
- Tiếp theo: nghiệm thu Planner Mech/Deck theo mục dưới; cần tài khoản có quyền.

## Task chỉ đọc và mở rộng khung ngày — 2026-10-13

- [x] Task ngoài discipline giữ số task và mô tả do API trả, kèm nhãn ngoài
      nhóm; không chọn được, không thêm vào bảng ngày hoặc payload lưu.
      Cách hiển thị này thay thế note chỉ có TaskID ở lần chỉnh trước.
- [x] Một assignment WAITASGN khả dụng tự chọn và hiện thông tin chỉ đọc;
      nhiều dòng vẫn cần chọn nguồn rõ ràng. Không đổi identity nguồn hoặc API.
- [x] Dialog rộng tối đa1200px, task picker khoảng270px, pane ngày chiếm phần
      còn lại và bỏ giới hạn25vh của bảng.56tests timeline/typecheck/lint/build
      đạt; chunk549,74kB còn warning. Live897×742: bảng489×282px hiện đủ
      task10/40/50/60 và tổng ngày; Task20/30 có mô tả nhưng không có điều khiển.
      Preview16h→10,5+5,5h; chưa lưu/ghi Maximo. Viewport override đã reset.
      [Ảnh nghiệm thu](evidence/task-dialog-readonly-expanded-2026-10-13.png).
- Tiếp theo: nghiệm thu cùng WO bằng Planner Mech/Deck; cần tài khoản đã có
      quyền discipline tương ứng để đối chiếu phạm vi task và nhân lực thật.

## Hộp phân công theo discipline và giữ bảng ngày — 2026-10-13

- [x] Bỏ dòng nhóm/tháng; chuyển Làm mới timeline cạnh bộ chọn tháng.
      Nhân lực/Ngày rota cùng hàng. Task picker và bảng ngày là hai vùng
      cuộn riêng; tổng giờ/ngày giữ ở cuối bảng khi cuộn, footer lưu vẫn thấy.
      Màn hình hẹp xếp hai pane theo chiều dọc và giới hạn cuộn độc lập.
- [x] FE đọc/validate safe bool has_out_of_scope_demand từ API hiện có.
      Task chỉ có nhu cầu ngoài nhóm tách thành note TaskID, không cho chọn;
      task hỗn hợp giữ mô tả chung và chỉ chọn labor trong discipline.
      Không suy task ngoài nhóm từ labor trống nếu thiếu marker; không fallback
      phân công WO chung khi WO chỉ có task ngoài nhóm. Payload chỉ gồm task
      phù hợp; backend vẫn lọc craft và recheck quyền như trước.
- [x] 70tests API/timeline, full347frontend/typecheck/lint/build và24backend
      mixedcraft/summary đạt. Chunk548,92kB còn warning.
      LiveP13470485: note20/30 ngoàiE&I, chọn10/40/50/60 tổng16h;
      preview01/10:10,5h,02/10:5,5h. Tại1010×884 tableheight282px,
      person/datecùngy251,7px và nút lưu trongviewport;600px vẫn có bảng.
      Preview chưa lưu/không ghi Maximo; viewportoverride đã reset.
      [Ảnh hộp phân công](evidence/task-dialog-scope-days-2026-10-13.png).
- Tiếp theo: nghiệm thu Planner Mech/Deck bằng tài khoản có quyền discipline
      tương ứng, kết hợp kiểm tra hai phiên Planner ở mục đồng bộ nhẹ.

## Header donut và căn nhãn ưu tiên — 2026-10-13

- [x] Bỏ hai dòng scope/mô tả theo note user; toolbar vẫn giữ discipline/tháng.
      Chuyển summary tháng ở cuối trang thành3donut Technician/Supervisor/
      Assistant Supervisor, panel438px phía trên cạnh bộ chọn tháng.
      Hiện người, tỷ lệ và giờ tải/capacity từ snapshot timeline; role khác
      vẫn trong bảng và có text tổng hợp riêng. Không thêm request/dependency.
- [x] Tải thiếu/0capacity/nhóm không có người không suy0% còn trống;
      tỷ lệ vượt100% giữ số thực, chỉ giới hạn vòng vẽ; 0% không có chấm giả.
      Nhãn ưu tiên cố định cột bên phải, WO heading/grid chiếm toàn card.
- [x] 54tests timeline/typecheck/lint/build đạt; chunk547,86kB còn warning.
      Browser1033/1270px:3donut đúng vùng trên, không overflow;600px xếp gọn,
      splitterẩn. Live17Tech/2Sup/2AsstSup khớp0/2.394h,0/325,5h,0/357h;
      mép phải10prioritybadge cùng284px tại lần kiểm tra. Không ghi phân công
      hoặc Maximo; overrideviewport đã reset sau nghiệm thu.
      [Ảnh1033px](evidence/timeline-donuts-1033-2026-10-13.png).
- Tiếp theo: nghiệm thu hai Planner thật và đối chiếu donut sau cập nhật
      phân công trên phiên khác theo mục đồng bộ nhẹ bên dưới.

## Backlog phân trang, tải summary và thanh kéo — 2026-10-13

- [x] Backlog/Completed/Tất cả phân trang20WO sau tìm kiếm/xếp ưu tiên;
      range/tổng/trang và Trước/Sau, reset khi thay bộ lọc/scope, clamp khi
      danh sách giảm; giữ WO đang chọn, cuộn về đầu khi đổi trang.
- [x] Tự đọc task/summary cho card đang hiện trên trang hiện tại, tối đa2
      request đồng thời. Không eagerload117WO, không reload list; hủy khi
      card rời viewport/trang, đổi scope, ẩn tab hoặc mở editor/đang ghi.
      Chặn stale response/identity sai, giữ summary mới hơn sau mutation;
      lỗi có nút retry riêng, không suy số giờ từ estdur.
- [x] Resource timeline bỏ giới hạn1600px của shell, main rộng100% màn hình.
      Thanh kéo Backlog/khung ngày hỗ trợ chuột và phím trái/phải/Home/End,
      clamp giữ chỗ cho khung ngày; mobile xếp dọc và ẩn thanh kéo.
- [x] 342/342frontend, typecheck/lint/build đạt; chunk546,59kB còn warning.
      Live117WO→6trang, 20card/page; trang2:21–40; main1018px bằng viewport,
      max-width:none. Kéo chuột300→370px và phím300→320px qua.
      P13469440 tự hiện5task/84h, P13469691:3task/25h. Không tạo/sửa/xóa
      phân công hoặc ghi Maximo trong nghiệm thu này.
      [Ảnh phân trang và thanh kéo](evidence/backlog-pagination-splitter-2026-10-13.png).
- Tiếp theo: nghiệm thu hai Planner đồng thời theo mục đồng bộ nhẹ bên dưới.

## Nhãn giờ còn lại trên WO card — 2026-10-13

- [x] Theo note của user, thống nhất dòng “Còn N task · còn X giờ”, bỏ
      thông báo kỹ thuật chưa xác minh trên card. Giữ số liệu đã tải khi
      snapshot hết hạn trong phiên; tooltip nêu cần mở WO để cập nhật.
      Chưa có số liệu hiển thị dấu —, không suy từ estdur. Completed vẫn
      cần snapshot mới theo quy tắc hiện hành, không dùng số cũ để xác nhận.
- [x] 45tests timeline, typecheck và lint đạt; browser P13468351 hiển thị
      “Còn 2 task · còn 20 giờ”, P13431393 “Còn 1 task · còn 300 giờ”.
      Không ghi phân công/Maximo trong lượt chỉnh nhãn.
      [Ảnh](evidence/backlog-remaining-label-2026-10-13.png).
- Tiếp theo: nghiệm thu hai Planner thật theo mục đồng bộ nhẹ bên dưới.

## Đồng bộ nhẹ và Backlog/Completed — 2026-10-13

- [x] Kiểm tra code: refreshAfterMutation/refreshTaskBatch/refreshTaskPlan
      merge receipt rồi setReload, gây tải toàn workspace. Backlog hiện lọc
      danh sách WO theo tìm kiếm, chưa lọc theo nhu cầu task còn lại; giờ trên
      card chỉ cộng reservation của tháng đang xem.
- [x] Mutation trả affected_days, current allocation_updates, WO descriptor,
      summary và revision trước/sau. UI merge ô bị ảnh hưởng, giữ backlog,
      roster và scroll; không reload toàn danh sách sau lưu. Receipt replay
      giữ bằng chứng gốc, metadata hiện tại không hồi sinh chip cũ. Kiểm tra
      revision mỗi30giây hiện thông báo, không tự refresh toàn workspace.
- [x] Tab Backlog/Completed/Tất cả; summary mọi task và mọi ngày/pool liên
      quan, không dựa estdur. TTL tối đa300giây, thiếu/ngoài discipline hoặc
      snapshot cũ giữ WO chưa xác minh ở Backlog. Lazy task read, không gọi
      detail toàn117WO; list summary dùng tối đa2DBqueries. Completed chỉ là
      đủ labor, không thay Maximo status.
- [x] Migration0014/cache quyền tối thiểu; backupdevelopment/upgrade/schema
      và dữ liệu cũ kiểm chứng. Readiness cập nhật0014 và trả200. ReviewerP1
      deadlock nested authsession đã sửa bằng recheck cùng transaction;
      focusedrecheck khôngfinding. 336FE/61BE/37PG +1rolePG đạt;
      lint/typecheck/build/Ruff đạt, còn warningchunk~540kB.
- [x] Live20h→10,5+9,5: Completed ngay; chuyển ngày, giảm0,5h trởBacklog;
      xóa trial giữ dữ liệu gốc tại thời điểm thử, không uploadMaximo.
      WO2task đã có P13468351 cũng được xác minh Completed/WMATL.
- [x] Theo xác nhận user, gửi lại đúng UUID61916eba-edfd-4a37-ab42-04a17151c293
      xóa P13431393/HAIDQ/01-10/1h: receipt/ledger released/version2, còn10,5h.
      Sửa dialog unknown để đóng và truy cập nút đối soát, không mất requestID.
- [Contract và bằng chứng](incremental-assignment-updates.md).
- [ ] Ưu tiên tiếp: nghiệm thu hai Planner thật để đối chiếu notice/reload
      thủ công và conflict; kiểm tra snapshot hết hạn/WO nhiều discipline.
      Upload plan nhiều ngày còn chặn, cần contract delete/rollbackidentity
      của Maximo trước khi mở. Không cần mở upload để nghiệm thu local.

## Phân bổ tự động nhiều task theo rota — 2026-10-13

- [x] Thay thao tác bỏ chọn/lập từng task bằng bảngtask×ngày. Giữ mọi task
      đã chọn, xếpTaskID tăng dần vào budget chungminrota630phút, trừexternal/
      globallocal; tự tải ngày kế tiếp lô31ngày, tối đa366ngày, bỏnghỉ vàqua tháng.
      Chỉnhgiờtừngô; tổngtask/dailybudget phảiđúng trước lưu. Thiếu/incomplete
      load chặnpreview/lưu; chỉnhmanualthiếugiờkhôngtựfetch366ngày vôích.
- [x] API task-plan-batches atomic1–50task, mộttransaction/receiptUUID,
      aggregatetấtcảtask/date, nguồnunique, freshscope/WO/source sauI/O;
      recoveryplans[] vàsingleendpoint tươngthích, planuploadvẫnkhóa.
- [x] ReviewerP2 person/date/cellâm/autofetch/stalefallback đãfix;
      focusedrecheckcuối khôngfinding. 50FE API/timeline,20PG,43offline qua;
      full325FE/typecheck/lint/build/Ruff qua. TestPoCtimeout đãxửlý bằng
      queryDOM hẹp hơn, giữassertions vàtimeout. Buildchunk528,73kBwarning.
- [x] Livepreview P13468351/Chan20h→10+.5 ngày01/10,9.5ngày02;
      đổiHAIDQ trừ2h/ngày đãgiữchỗ;11h bịchặn. Chọn15/10 tựtiếp13/11
      đúngrotalàmviệc. Trảpreview01/10, chưabấmlưu/khôngghiMaximo;
      4reservation gốcvẫnhiểnthị. Backendlocal đãrestart phục vụAPI mới.
- [Contract/bằng chứng](automatic-task-allocation.md).
- [ ] Ưu tiên tiếp: nghiệm thu lưu batch nhiều task trên UI theo lịch Planner
      thực tế. Remoteuploadnhiềungày vẫnbịkhóa; xácminhdelete/rollbackidentity
      trước khi bật. Khôngcòn việc xửlýtimeoutPoC ởcácmục lịch sử bên dưới.

## Giải thích nút lưu bị chặn do tổng giờ task — 2026-10-13

- [x] Dialog hiển thị alert sát nút lưu khi tổng nhiều task vượt giờ còn trống,
      nêu tổng/capacity/ngày, giới hạn10,5h và cách giảm/chuyển ngày/lập từng plan.
      Giữ chặn capacity; không tự đổi selection hoặc lưu dữ liệu của người dùng.
- [x] Browser P13468351/Le Duc Chan/01-10: hai task10h tổng20h, còn10,5h;
      thông báo rõ, chưaPOST. Regression xác nhận alert/nút khóa và alert hết
      khi chọn riêng task plan. 36tests timeline và typecheck qua.
      [Ảnh](evidence/task-batch-save-capacity-2026-10-13.png).
- Tiếp theo: phân hai task sang các ngày còn capacity; các công việc kiểm thử
      PoC và contract upload remote vẫn theo danh mục bên dưới.

## Sửa nút nhiều ngày khi chọn nhiều task — 2026-10-13

- [x] Guard cũ thoát im lặng khi chọn hai task. Nút trên task hiện chọn riêng
      task đó, mở range/preview theo giờ của task và bỏ chọn task khác;
      thêm giải thích cạnh danh sách. Không gộp giờ của các task vào một source.
- [x] Regression chọn hai task rồi bấm task20: preview10h/source riêng,
      task10 bỏ chọn, chưaPOST. 36tests timeline/typecheck/ESLint qua.
      Browser P13468351 task10 mởrange01/10 với10h, task20 bỏ chọn;
      không lưu hoặc ghiMaximo. [Ảnh](evidence/multitask-plan-button-2026-10-13.png).
- Tiếp theo: nghiệm thu chọn khoảng và sửa giờ từng ngày trên preview;
      xử lý test PoC timeout/contract remote theo danh mục bên dưới.

## Thông tin và ưu tiên WO backlog — 2026-10-13

- [x] Mỗi WO hiển thị Worktype và số giờ ước tính từ estdur; bỏ Siteid khỏi
      dòng thông tin. Giữ Siteid trong định danh/scope và tìm kiếm.
      Xếp wopriority giảm dần, thiếu priority cuối; badge số kèm màu:4đỏ,
      3cam,2xanh,1trung tính. Mức4/3 có viền trái rõ; selection vẫn giữ.
- [x] Typecheck và ESLint tập trung qua; browser117WO xếp giảm dần3/2/1,
      estdur/worktype hiển thị đúng, khôngBD1 trong card. Dữ liệu đang xem
      không có priority4. [Ảnh](evidence/backlog-priority-2026-10-13.png).
- Tiếp theo: nghiệm thu mức4 khi có WO trong scope; tiếp tục xử lý test PoC
      timeout và contract remote theo danh mục bên dưới.

## Mở rộng panel phân công — 2026-10-13

- [x] Dialog phân công/sửa rộng tối đa900px thay460px, vùng task tăng55vh;
      giới hạn chiều cao theo viewport và cuộn khi cần. Backlog thu còn220px,
      timeline có thêm chiều ngang; màn hình dưới700px xếp hai panel thành một cột.
      Kiểm tra trực tiếp browser desktop và diff whitespace qua; chỉ CSS,
      không đổi dữ liệu/API. [Ảnh panel](evidence/assignment-panel-wide-2026-10-13.png).
- Tiếp theo: nghiệm thu panel với WO nhiều task; test PoC timeout và contract
      remote delete/rollback vẫn theo danh mục bên dưới.

## Cập nhật màn hình Maximo đang sử dụng — 2026-10-13

- [x] Chủ dự án sửa thông tin: chỉ dùng tab Assignments của Work Order Tracking;
      thay thế trả lời trước về sử dụng Assignment Manager. Đồng bộ biên bản;
      không suy ứng dụng đó đã cài/cấp quyền hay chưa. Không đổi mã ứng dụng.
- Timeline local nhiều ngày không phụ thuộc Assignment Manager; UI chọn range
      qua tháng đã hoàn tất bên dưới. Upload nhiều ngày tiếp tục khóa theo
      kết quả contract API đã kiểm chứng, không theo ứng dụng UI đang dùng.

## Timeline nhiều ngày local và capacity — 2026-10-13

- [x] Giữ bố cục PoC; dialog một task/assignment có Phân bổ nhiều ngày,
      preview front-load theo giờ còn trống, bỏ nghỉ/tải thiếu, chỉnh từng ngày.
      Tổng theo assignment chọn, không nhânqty; chỉlưu khiđủ tổng vàcapacity.
- [x] Atomic task-plans/API/header demand/migration0013; sourceownership,
      immutable request UUID/receipt và local segments bền vững. Backend minrota/
      630phút, external+global local; fresh WO/source/grants/pool sauI/O.
- [x] Thanh từng ngày kéo/sửa/xóa; cùngperson, groupkhôngtrùngngày/tổngkhôngvượt
      demand; xóa hết freesource. plan_id vẫnchặn upload khichỉcòn1đoạn.
- [x] Carry-in finishdate load qua2ANDqueriesOnshoreTest đãread-onlysmoke qua;
      crossdayremote chưa rõ phân bổ failclosed, khônggiảđịnh ngày sautrống.
- [x] Backup0013/Alembiccheck/grants/localfingerprints giữ nguyên dữliệu.
      Live UI20h→10,5+9,5, reload, chặn11h, kéo04→05, sửa9,5→9 vàxóa2trials;
      Maximo20hWAIT khôngđổi/zero planupload;4reservation gốc240phút nguyên.
- [x] Review mới tìm UUID P1/freshness P2 đãfix/regressions; reviewcuốikhôngP1/P2.
      Main thêm2requestconcurrent trueindependenttransactions, cùngUUIDreceipt/
      khácUUIDsamesource1plan qua; không mô phỏng nhiều pool/processproduction.
- [x] Kiểm tra cuối622backend offline/Ruff;60focused gồm22PG qua. Frontend
      full306 +2edge bổ sung qua; TypeScript/lint/build qua, chunk519,60kBwarning
      giữnguyên. Docslinks/diffcheck qua; khôngcommit/push/deploy.
- [Contract và bằng chứng](multiday-local-timeline.md),
      [dọn cuối](evidence/multiday-local-final-2026-10-13.json).
- [x] UI range qua tháng tối đa366ngày; capacity riêng theo lô31ngày,
      kiểm tra person/craft/labor/poolversion, cancellation/cache invalidation.
      Khóa demand khi tải; mất identity/scope401/403/404 ẩn workspace cũ.
- [x] Live20h→10,5h31/10+9,5h01/11; chuyển tháng xem/sửa ngày02 thành9h,
      chặn11h, xóa hai trial; bốn phân công gốc/Maximo nguyên, zero planupload.
      45FE API/timeline và11PG qua; Ruff/typecheck/lint/build qua; review/recheck
      P1scope đãfix. FullFE319/320, test PoC cũ timeout15s cả khi chạy riêng.
- [ ] Ưu tiên sẵn sàng: chẩn đoán/tối ưu test PoC synthetic timeout để full suite
      ổn định. Remote upload nhiều ngày tiếp tục khóa, cần contract delete/rollback
      bảo toàn identity bên dưới trước bật; không cần Graphical Assignment addon.

## Probe API assignment chuẩn chia20h — 2026-10-12

- [x] P13465911/task10 có planned20h/quantity1. Audited Test MERGE cập nhật
      assignment537275 thành10,5h ngày03/10 06:30→17:00; Add tạo2001464 với9,5h
      ngày04/10 06:30→16:00, cùng HAIDQ/E&I/OPSTECH/wplaborid, parentassignid537275.
      Tổng20h; load630/570phút; stale root/child transaction conflict, không dòng trùng.
- [x] Đã đối soát cleanup thật: MERGE `_action: Delete` giữ nguyên dòng mới,
      trong khi update dòng gốc về20h thành công (partial read-back, intentunknown).
      Complete collection PATCH phục hồi business fields và bỏ dòng thử nhưng
      tái tạo assignment gốc với ID2001466 thay537275; không khôi phục nguyênID.
      Không được dùng REPLACE làm rollback/create/delete cho Planner.
- [x] Cuối cùng chỉ một dòng WAITASGN20h/null labor/ngày, planned20h/quantity1;
      lịch WO/task và target giữ baseline, load thử0;4reservation gốc240phút/
      versions giữ nguyên. Audit anchor released, không reservation mới; outcomes
      partial/identitychanged vẫnunknown. Không mởpublic create/delete; không đổi app/schema.
- [Bằng chứng](evidence/daily-assignment-api-2026-10-12.json),
      [biên bản](multiday-assignment-verification.md#probe-api-chia20h-thành-hai-ngày).
- [ ] Ưu tiên tiếp: điều tra contract xóa child trên BDSCHED_WO/SHOWASSIGNMENT
      và cách rollback bảo toàn identity; chỉ thử thêm khi đã biết điều kiện đúng,
      không lặp Delete/REPLACE hoặc coiHTTP204 làxác nhận. Đối chiếu Assign Labor
      UI chỉ optional cho semantics calendar/shift, không điều kiện bắt buộc củaAPI.

## Xác minh assignment nhiều ngày — Maximo chuẩn — 2026-10-12

- [x] Thông tin UI cập nhật13/10: chỉ dùng tab Assignments trong Work Order
      Tracking, không có Graphical addon; trả lời Assignment Manager trước đã thay thế.
      Đọc schema BDSCHED_WO có finishdate/parentassignid và117WO E&I tháng10;
      dữ liệu79h/15h có finishdate đúng elapsed liên tục, không suy lịch rota.
- [x] Probe Test có audit20h trên dòng1968934 đãreleased: API nhận và trả
      03/10 06:30→04/10 02:30, ASSIGNED; không tạo đoạn/dòng mới. MERGE giữ
      sibling. Restore business fields và lịch WO/task/target đúngbaseline;
      không tạo reservation local hoặc thay đổi bốn phân công gốc. Read-back
      thật qua; docs links/diffcheck qua; không đổi app/schema/deploy.
- [Biên bản](multiday-assignment-verification.md),
      [bằng chứng](evidence/multiday-direct-write-2026-10-12.json).
- [x] Đã thử create/update chia20h thành hai ngày ở mục trên. Delete/rollback
      bảo toàn identity chưa đạt; chưa mở create/delete cho Planner.
- [ ] Tùy chọn đối chiếu tab Assignments trong Work Order Tracking khi cần tương đươngUI;
      không là blocker cho API. Không tuyên bố đã nghiệm thu UI hoặc explicit
      finishdate/calendar semantics chỉ từ direct PATCH.

## Quantity > 1 — nghiệm thu hai người và bảo toàn assignment — 2026-10-12

- [x] WO H14306907/task10 E&I: quantity2 tạo hai dòng WAITASGN, mỗi dòng5h.
      Timeline chọn từng dòng riêng; slot đã reserve không được chọn lại.
      Hai public uploads HAIDQ/CHANLD ngày03/10 confirmed; mỗi người300phút,
      không double count; sibling giữ nguyên sau mỗi upload.
- [x] Phát hiện P1 ở lần thử đầu: PATCH mặc định thay collection, xóa sibling
      1968932. Dừng upload, thêm `patchtype: MERGE`, durable full sibling baseline;
      read-back/reconcile thiếu/thêm/đổi sibling giữ unknown, không tự retry.
      Intent cũ đã gửi không có sibling baseline cũng không được xác nhận lại.
- [x] Recovery Test có actor/audit: Maximo tái tạo slot với ID2001462 thay1968932;
      không thể tuyên bố phục hồi nguyên ID. Hai slot đã về WAITASGN/null labor/
      null ngày/5h; lịch WO/task về baseline, target dates giữ nguyên. Bốn trial
      local released; bốn phân công gốc240phút/version1 giữ nguyên.
- [x] Review độc lập mới cho P1: không còn P1 MERGE;38tests tập trung qua.
      P2 duplicate/lost-authority có intent nhưng báo not_sent đã sửa bằng lookup
      mới theo actor/request; regression không lộ receipt ngoài quyền, zeroPOST.
      Main kiểm tra sửa P2;612offline/12taskPG/Ruff qua,3warnings cũ.
- [Bằng chứng cuối](evidence/quantity-final-acceptance-2026-10-12.json),
      [hai upload](evidence/quantity-merge-both-upload-2026-10-12.json),
      [restore](evidence/quantity-merge-restored-2026-10-12.json),
      [ảnh](evidence/quantity-two-people-upload-2026-10-12.png).
- [ ] Sẵn sàng tiếp: nghiệm thu nhiều task trong một WO hoặc nhiều ngày trên
      E&I. Planned70h/quantity3 cần quy tắc chia ngày trước triển khai; chưa bật
      tạo/split assignment, remote edit/delete hoặc production upload.
- [ ] Discipline khác cần chủ dự án cung cấp tài khoản/quyền và WO/roster mẫu;
      Ubuntu deployment tiếp tục chờ IT HTTPS/Entra redirect/routing.

## Task timeline, tải Maximo và upload Test — 2026-10-12

- [x] BDSCHED_WO scoped lazy tasks/assignment, atomic batch và migration0012;
      legacy WO allocations giữ nguyên. Timeline PoC thêm task picking,
      thanh task kéo riêng/người/ngày, sửa/xóa local, không hiển thị ID kỹ thuật.
- [x] Load Maximo qua mọi WO/task/site trong connection, paging đầy đủ/canonical
      origin, khử trùng assignment và ledger synced; fail closed thiếu load.
      External overbook vẫn hiển thị. Capacity khóa connection+pool.
- [x] Durable upload Test-only: intent trước send, root/child rowstamp,
      read-back/receipt/reconcile; unknown giữ request/context, chặn gửi lại.
      Pre-intent rejection not_sent; phải lưu thay đổi local trước upload.
- [x] Live WAITASGN task10: HAIDQ/0,5h, tự ASSIGNED; stale token conflict.
      Restore đúng assignment/lịch task. Browser upload confirmed; remote30
      + local600 =630phút không double count. Parent schedule giữ nguyên.
- [x] Browser batch630phút; chặn11h; kéo task20 03→04/10, sửa9→8h; dọn riêng
     3trials. Giữ4phân công user240phút/version1; Test labor trial đã restore.
- [x] Local backup/owner0012/check/runtime state-only grants qua; isolated
      PG13tests qua gồm atomic/recovery/revoke/upload-edit/release overlaps.
- [x] Backend603offline/Ruff qua (3known warnings); frontend30files/300tests
      với1worker, TypeScript/lint/build/diffcheck qua. Build có cảnh báo chunk
      510,90kB; không thêm dependency hoặc bỏ cảnh báo để che vấn đề.
- [x] Review2P1/2P2 đã xử lý/regression tests; agent credits dừng focused
      independent recheck, Main tự tích hợp và kiểm tra.
- [Contract và bằng chứng](task-assignments.md),
      [UAT cuối](evidence/task-final-acceptance-2026-10-12.json).
- [x] Quantity2/multiple WAITASGN nghiệm thu thêm ở mục trên; discipline khác
      vẫn cần dữ liệu/quyền chủ dự án chọn.
- [ ] Maximo admin/contract: tạo/split assignment mới hoặc sửa/xóa đã gửi cần
      mapping task writable/lifecycle riêng. Sender lịch/PIC WO trên object
      mới cần nghiệm thu lại trước mở write contract đó.
- [ ] Remote deployment cần IT Ubuntu/HTTPS/Entra redirect/routing.

## Cập nhật vòng đời subagent — 2026-10-12

- [x] Thêm Subagent Lifecycle Policy vào [AGENTS.md](../AGENTS.md#subagent-lifecycle-policy)
      và đồng bộ [hướng dẫn Codex](codex-agents.md#subagent-lifecycle-policy): ưu tiên
      dùng lại agent phù hợp, tạo mới khi việc/context cần, reviewer mới cho review
      lớn độc lập, tối đa 3 subagent mở, file ownership riêng, đóng khi hết nhu cầu,
      Main tích hợp/kiểm chứng và chỉ cho phép spawn lồng khi được cho phép rõ ràng.
- [x] Đối chiếu cấu hình hiện có: giới hạn đồng thời đã là 3; giữ routing model/effort
      và review budget, reviewer mới không đặt lại budget. Kiểm tra diff, liên kết
      local và placeholder cho các tài liệu sửa; không đổi mã ứng dụng.
- Giới hạn: không chạy phiên subagent mới để nghiệm thu lifecycle runtime;
      các role native vẫn mặc định cấm tự spawn. Không cần kiểm thử ứng dụng cho
      thay đổi tài liệu này.

## Đánh giá task và assignment BDSCHED_WO — 2026-10-12

- [x] Probe read-only Onshore Test P13465570: call mẫu/expanded/schema/child
      identity HTTP 200. Ba task 10/20/30, 0,5/9/1 giờ, mỗi task một WAITASGN
      chưa laborcode/ngày; cùng assignment xuất hiện ở WO-level và task-level.
- [x] Schema có assignment/woactivity; child assignment có rowstamp, relation
      SHOWASSIGNMENT không trả rowstamp. Child schema không expose taskid;
      mapping task phải join relation bằng assignmentid. Config runtime vẫn
      hard-code object structure cũ; chưa chuyển URL hoặc sửa sender.
- [x] Hoàn tất [đánh giá và lộ trình](task-assignments-assessment.md),
      [bằng chứng](evidence/task-assignment-contract-2026-10-12.json).
      Chỉ đọc; không thay dữ liệu, UI, migration hoặc ghi Maximo. Evidence
      một WO chưa chứng minh paging/contract write/toàn bộ tải labor-ngày.
- [x] Bước 1: reader/API BDSCHED_WO scoped, lazy-load task dialog và ledger
      phân công theo task; giữ timeline PoC, labor binding và audit/receipt.
- [x] Bước 2: tải Maximo theo labor/ngày/khử trùng; status tính bảo thủ,
      chưa suy quantity/shift/multi-day khi chưa nghiệm thu.
- [x] Bước 3: existing WAITASGN child upload Test đã nghiệm thu quyền ghi,
      conflict/side effects/read-back/restore; dòng mới/lifecycle chưa bật.

## Nghiệm thu kéo thả native và sửa focus — 2026-10-12

- [x] Bỏ refetch timeline/WO khi window focus/blur; không hủy proposal khi
      cửa sổ lấy lại focus. Hidden-tab return chỉ recheck session/grants;
      cùng scope giữ dữ liệu, authfail ẩn cache và cho explicit recheck.
- [x] Thay HTML drag bằng Pointer Events, pointer capture và hit-test ô đích;
      có preview kéo, bỏ thả ở ngày nghỉ/ngoài ô, hủy khi scope thay đổi.
- [x] IAB kéo chuột thật: P13457667 → Dao Quang Hai (1B), 03/10/2026 mở đúng
      dialog; lưu 2 giờ, kéo thanh sang 04/10 và xác nhận thành công. Đề xuất
      thêm 9 giờ bị chặn vì tổng 11 > 10,5 giờ. Xóa riêng trial sau nghiệm thu.
- [x] DB read-back: trial released version 3, 3 audit/3 receipts có actor;
      giữ 4 phân công người dùng (240 phút, tất cả version 1). Không ghi Maximo.
- [x] Full frontend 30 files/290 tests qua với 1 worker; 17 tests tập trung qua
      (12 timeline, 3 API, 2 PoC); TypeScript/lint/build và diffcheck qua.
      PoC timeout khi chạy nhiều worker trên máy local; không thay timeout source.
- Bằng chứng: [read-back](evidence/resource-timeline-native-drag-2026-10-12.json),
      [đề xuất 9 giờ sau kéo thanh](evidence/resource-timeline-native-drag-2026-10-12.jpg),
      [timeline sau dọn trial](evidence/resource-timeline-native-drag-cleanup-2026-10-12.jpg).

## Resource timeline thật theo bố cục PoC — 2026-10-12

- [x] Route `/resource-timeline` nối active roster v5/API ledger và scoped WO
      backlog. Đối chiếu source và ảnh PoC `/assignment-demo`: backlog trái
      230–280px, timeline phải, sticky người/ngày, craft + nhóm Technician/
      Supervisor/Assistant Supervisor thu gọn, màu working/off/blank và tổng
      giờ theo craft ở dưới. Không phục hồi panel/table CRUD tại WO.
- [x] Kéo thả WO→người/ngày và thanh→người/ngày mở đề xuất rồi
      xác nhận. Bấm/chọn hỗ trợ bàn phím; dialog nhập giờ, đổi người/ngày,
      sửa/xóa, focus trap/Escape. Giữ một WO trong backlog để phân công nhiều
      người/ngày; không suy demand từ estdur. Giờ đổi thành phút nguyên.
- [x] Endpoint snapshot max31ngày/200WO; đọc lại scope WO từ Maximo, kiểm tra
      revision sau I/O. Planner chỉ nhận resource craft trùng discipline trên
      connection đã cấp quyền, cả CRUD/receipt. Tải toàn pool/người/ngày vẫn
      cộng global, không lộ danh tính WO ngoài scope. Active-rota lọc current
      grants; Admin không bypass quyền WO. Import/staging/activation tổng thể
      chuyển Admin-only để chặn Planner xem nguồn nhân lực nhóm khác.
- [x] Mutation có recheck principal/grants/context, version/CSRF/request UUID;
      unknown response giữ request/body, đối soát trước retry, validation result.
      App giữ component qua navigation, khóa thao tác/navigation khi pending;
      trở lại sau401/identitychange ẩn cache ngay. Reviewer phát hiện P1 cache
      tái hiện khi authfail, Main đã sửa bằng context epoch và regression tests.
- [x] Backend58focused/562offline qua (3known warnings), Ruff qua; bổ sung
      4PG lifecycle/race qua sau final scope test. FE full30files/286tests qua;
      final11focused qua, TypeScript/lint/build qua. Không dependency/migration.
- [x] Browser Entra thật E&I:21resource (17TECH/2SUP/2ASST_SUP),117WO; thêm2h
      03/10, đổi04/10, sửa4h, chặn4+7h, xóa thử. DBreadback released version4,
      4audit +4receipts có actor; giữ2phân công có sẵn (120phút/version1),
      không ghi Maximo. Roster activation receipt giữ nguyên.
- Bằng chứng: [JSON](evidence/resource-timeline-2026-10-12.json),
      [bố cục theo PoC](evidence/resource-timeline-poc-aligned-2026-10-12.jpg),
      [contract và cách dùng](resource-timeline.md).
- Giới hạn review: review độc lập BE chưa tìm finding; phiên FE/reviewer dừng
      do hết credits trước consolidated review. Main đã tích hợp/kiểm tra và
      xử lý P1 có bằng chứng; không tuyên bố full independent review hoàn tất.
- [x] Nghiệm thu kéo chuột native IAB đã đạt sau chuyển sang Pointer Events;
      xem bằng chứng đầu trang. Remote deployment chưa nghiệm thu.

## Hủy giao diện phân bổ dạng bảng — 2026-10-12

- [x] Theo yêu cầu user, hủy panel phân bổ từng WO vì lệch yêu cầu Resource
      timeline. Gỡ nút Phân bổ nhân lực, component/form/table CRUD và các state/
      scroll-lock riêng khỏi WorkOrders; xóa AssignmentPanel và test của panel.
      Giữ chức năng WO/draft hiện có, API/ledger/capacity/audit và roster active;
      không xóa dữ liệu nghiệp vụ, không rollback migrations.
- [x] 84 tests WorkOrders/Resource timeline PoC/App navigation qua;
      TypeScript/lint/diff check qua. Browser xác nhận không còn action/panel
      phân bổ sau khi retrieve117WO. Bản timeline hiện có vẫn dùng dữ liệu giả.
- Bằng chứng: [WO sau khi gỡ panel](evidence/wo-allocation-table-removed-2026-10-12.jpg).
- Quyết định thay thế: các mốc UI panel và UAT bên dưới là lịch sử của phương án
      đã hủy, không chứng minh hoàn thành Resource timeline với dữ liệu thật.
- [x] Đã nối Resource timeline thật theo mốc đầu trang (người × ngày, backlog WO và
      thanh phân công) với active roster v5 và API ledger hiện có; thêm/sửa/xóa
      trực tiếp trên timeline, kiểm tra tổng630phút/người/ngày. Không phục hồi
      bảng/form phân bổ riêng tại WO.

## Nghiệm thu phân công WO trên roster v5 — 2026-10-12

- [x] Browser Entra thật, Onshore Test E&I, retrieve117WO tháng10. Dùng
      Dao Quang Hai(1B), ngày working2026-10-30: WO P13457667 thêm4giờ,
      sửa6giờ; WO P13462960 nhận đúng4,5giờ còn lại. Tổng10,5giờ lưu thành công.
- [x] 6+5giờ trên WO khác: UI báo vượt giờ, khóa Thêm. Kiểm tra tab cũ:
      tabA giữ snapshot6+4giờ và cho sửa6,5; tabB tăng4→4,5 thành công;
      tabA gửi6,5 bị backend từ chối “Daily allocation exceeds active rota
      capacity (630 minutes)”, assignmentA vẫn6giờ/version2.
- [x] Xóa cả2phân công thử bằng UI; PostgreSQL read-back xác nhận released,
      versions3/4, toàn pool0phút reserved; giờ ngày hoàn trả10,5 và giờ tháng
      hoàn trả13.419. Giữ7audit events có actor (2create/3update/2release)
      và7durable receipts; roster v5/biên nhận kích hoạt giữ nguyên.
      Không ghi Maximo, không đổi WO/PIC/draft.
- [x] 13backend offline,4PostgreSQL lifecycle/capacity/race và11frontend
      assignment/API/capacity tests qua; 1known Starlette deprecation warning.
      Diff check qua. Không thay code ứng dụng trong lần nghiệm thu này.
- Bằng chứng: [ledger và UAT](evidence/assignments-acceptance-2026-10-12.json),
      [UI chặn vượt giờ](evidence/assignments-over-capacity-2026-10-12.jpg),
      [backend chặn tab cũ](evidence/assignments-server-capacity-2026-10-12.jpg),
      [hoàn trả giờ](evidence/assignments-cleanup-2026-10-12.jpg).
- Việc sẵn sàng tiếp theo: sửa cảnh báo kích hoạt lại trên biên nhận thành công.
      Remote deployment và assignment Maximo vẫn ngoài phạm vi local UAT.

## Nhãn số người và bản ghi rota — 2026-10-12

- [x] Biên nhận tách “Số người” và “Bản ghi người/ngày”, định dạng số theo
      vi-VN (85 và 31.025). Giải thích mỗi bản ghi là một người trong một ngày,
      gồm ngày làm việc/nghỉ/ô trống, không phải ngày công. Không đổi dữ liệu.
- [x] 6 existing activation UI tests qua; browser xác nhận biên nhận hiện hành
      hiển thị đúng nhãn và giải thích. Diff check qua.
- Bằng chứng: [ảnh nhãn mới](evidence/rota-receipt-labels-2026-10-12.jpg).
- Tiếp theo: nghiệm thu phân công WO trên roster active; cảnh báo kích hoạt lại
      ở biên nhận đã lưu vẫn là mục sửa UI riêng được ghi bên dưới.

## Kích hoạt rota v5 và nhãn Person / Position — 2026-10-12

- [x] Đổi nhãn mapped row/candidate và hướng dẫn từ tên field database sang
      Person / Position. Giữ nguyên API và logic đối chiếu; 24 focused frontend
      tests qua, browser xác nhận Person HUNGNM / Position Production Technician.
- [x] Upload lại đúng `1-POB-Plan-Q4-2026.ods`, sheet ROTA_2026, qua phiên Entra
      hiện hành vào Onshore Test pool. Source policy `rota-2026-10-12-v5`,
      85 người/85 mapped/0 blockers; loại 2 Material Controller.
- [x] Xem diff trước kích hoạt: 85 thêm/0 gỡ/0 đổi, 31.025 người-ngày,
      0 → 154.696,5 giờ, phạm vi 2026-01-01 đến trước 2027-01-01.
      Theo yêu cầu user, xác nhận và kích hoạt; đọc lại biên nhận server lúc
      10:31:26, ID `09f30419-cd09-4446-b81b-565e12b6f49a`, cùng tổng/người/ngày.
      Chỉ tạo roster nội bộ; chưa tạo phân công WO hoặc ghi Maximo.
- Bằng chứng: [biên nhận](evidence/rota-v5-activation-2026-10-12.json),
      [giao diện](evidence/rota-v5-activation-2026-10-12.jpg).
- [x] Đã nghiệm thu thêm/sửa/xóa phân công WO trên roster vừa kích hoạt,
      gồm tổng giờ nhiều WO và chặn vượt 10,5 giờ/người/ngày.
- [ ] UI biên nhận hiện còn hiển thị lý do không thể kích hoạt lại
      “Import is cancelled or already activated”; biên nhận thành công vẫn đúng.
      Cần bỏ cảnh báo này khi đã có biên nhận để tránh nhầm là kích hoạt lỗi.

## Loại Material Controller và đối chiếu PERSON.title — 2026-10-12

- [x] Theo xác nhận mới: Material Controller không tính Labor/headcount/giờ/
      capacity và không được phân công. Policy `rota-2026-10-12-v5` loại position
      trước validation ngày/enrollment; Control RM Engineer vẫn được tính.
      Preview source v3/v4 cũ lọc2MC theo policy hiện tại, không sửa source đã lưu.
      Roster active cũ không đưa MC vào capacity/selector/tổng, nhưng giữ lịch sử
      và reservation cũ để xem/xóa; replacement diff vẫn đọc projection gốc.
- [x] LABOR request `person{displayname,title}`; title nullable/bounded200chars,
      kiểu sai bị từ chối. Hiển thị PERSON.title cùng PERSONID trên mapped row
      và mỗi candidate. Khi trùng tên, chỉ map nếu đúng1title khớp chính xác
      position nguồn sau chuẩn hóa case/whitespace; thiếu/trùngtitle vẫn chặn,
      không chọn theo craft/role chung hoặc tên gần giống. Singleton giữ hành vi
      cũ, trừ title Material Controller không đủ điều kiện. Mapping API/refresh/
      activation dùng cùng eligibility; không thêm schema/dependency/WO grants.
- [x] Browser Entra thật refresh newest stage thànhv8; snapshot149LABOR với
      147title có giá trị, storedmapping85, preview85people/85mapped/0LABORerrors,
      gross154.696,5giờ (giảm3.780giờ). Row95NguyenHoaiGiang và96NguyenManhHung
      MaterialController chỉ hiện ở mục loại trừ; row34NguyenManhHung(3A) vẫn
      ProductionTechnician/HUNGNM, PERSON.title=ProductionTechnician.
      Audit refresh có authenticatedactor/version8; sourcepolicyv3/87rows bất biến,
      zeroactivation/assignment/Maximowrites. Backend reload/readiness giữ0011.
- [x] Backend112focusedoffline/41PostgreSQL qua; sau P2fix thêm31activation/
      assignment checks qua, gồm legacyMC active bị loại ở read projection,
      create409 và legacy release vẫn hoạt động. Main full559offline/3knownwarnings
      qua. Frontend24focused vàfull30files/285tests qua; lint/typecheck/build qua.
      Một focusedreview Sol/high khôngP1; P2legacyactive read đã sửa, Main xem
      filters/coverage, không gọi recheck. Diffcheck/local links qua.
- Bằng chứng: [JSON](evidence/rota-title-policy-2026-10-12.json),
      [browser preview](evidence/rota-title-policy-2026-10-12.jpg).
- [x] Đã thực hiện trong task kích hoạt v5 phía trên: upload lại cùng file rồi xem
      activation diff; v3/v4 cũ không được relabel hoặc activate dù LABOR đã hết
      lỗi. Chưa activate roster/phân công/live upload WO trong task này. Các14
      LABOR blockers lịch sử đã hết trong snapshot mới; không còn là việc chờ IT.

## Phân bổ nhân lực WO theo rota — 2026-10-11–12

- Phạm vi: reservation chung nội bộ, thêm/sửa/xóa theo người × ngày × WO;
      tổng 630phút/người/ngày trên mọi WO/site trong pool. Không thay PIC,
      estdur hoặc ghi ASSIGNMENT Maximo; số giờ còn lại là local-only.
- [x] API/ledger migration0011, audit và submission receipts; cùng khóa pool với
      activation. Kiểm tra quyền WO riêng với pool, CSRF, current discipline,
      version và rota working-day; off/blank/missing không được phân công.
      Replacement rota phải giữ đủ giờ và craft/role/labor binding đã reserve.
- [x] Backend47focused tests qua:12validation,3PostgreSQL lifecycle/race,
      7app/readiness và25rota activation (14pure/11PG). Hai planner và
      activation/reservation dùng transaction riêng với barrier cùng khóa pool.
      Closed WO vẫn đọc/xóa reservation được; thêm/sửa yêu cầu WO eligible.
      Regression PIC upstream lỗi không chặn phân bổ; no PIC request.
      Test DB guarded upgrade0011/Alembic check qua; runtime-role test1pass
      xác nhận INSERT/UPDATE allocation, INSERT-only audit/biên nhận.
      Main full534offline tests qua/3knownwarnings trước fix PIC, focused47
      sau fix qua; Ruff qua. Lượt full đầu gặp quyền Windows temp ở9backup
      cases; rerun20backup rồi full với quyền phù hợp đều qua, không đổi code.
- [x] UI tại từng WO trong `/work-orders`, chọn active rota person/ngày, xem tải
      dùng chung, thêm/sửa/xóa; không dùng dữ liệu PoC để lưu kế hoạch thật.
      Giữ bảng7cột, action dưới WONUM; chọn tháng, giữ craft/role theo từng ngày
      dù API có nhiều metadata rows cùng person UUID. Giờ là phút nguyên, UI
      không làm tròn input âm thầm; native step any tránh lỗi floating step.
- [x] Frontend30files/282tests qua, gồm80focused UI/API/capacity/WorkOrders.
      CRUD→refresh capacity, readonlyWO/writepool, cross-WOload, duplicate UUID
      effective role, unknown add/delete, same-ID retry, navigation/reload lỗi,
      conflict retry unlock và scope reset có regression. Lint/TypeScript/build
      qua. Vite cần process-spawn escalation trong sandbox Windows; không đổi
      dependencies. Main diffcheck/local docs links qua.
- [x] Một independent Sol/high review: khôngP1; P2 PIC coupling đã sửa và có
      PostgreSQL regression noPICrequests. Hai P2 frontend về stale allocation
      context và definitive retry lock đã sửa; Main kiểm tra fixes với tests
      đổiWO/connection và409retry, không gọi review thứ hai. Session/principal,
      snapshot key và response identity/version được kiểm tra; pending receipts
      giữ riêng để không hiển thị dữ liệu cũ dưới identity/scope mới.
- Giới hạn: migration0011 chỉ áp dụng designated test DB; chưa migrate/restart
      ứng dụng development thật ở milestone code; bước1 đã áp dụng bên dưới.
      Chưa browser UAT, Maximo Test roster activation,
      remote deployment hoặc ASSIGNMENT writes. Không commit/push. Toàn bộ test
      WO/LABOR trong milestone này là synthetic; capability còn lại local-only.
- [x] Áp dụng0011/grants ở development: hoàn tất ở bước1 bên dưới.
- [ ] Nghiệm thu browser với một
      pool/rota Test hợp lệ, gồm6h+4,5h đạt biên và thêm1phút bị chặn, edit/delete
      trả lại giờ, hai planner cùng người/ngày. Không activate staging còn lỗi.
- Phụ thuộc nghiệm thu dữ liệu thật: Maximo admin xử lý14dòng LABOR/craft,
      reupload policy hiện tại và refresh/activate roster hợp lệ. Chưa dùng
      staging thật để reserve hoặc ghi Maximo. Binding qua nhiều connection,
      requirements/skill và external ASSIGNMENT vẫn chưa triển khai.

Hướng dẫn: [phân bổ nhân lực WO](workforce-allocations.md).

## Bật phân bổ tại development — bước1 — 2026-10-12

- [x] Xác minh đúng development DB `scheduler_entra_local`, loopback55433,
      schema0010 và backend chưa chạy. Local trước đó dùng DB superuser;
      tạo LOGIN riêng `wos_local_owner` và `wos_local_runtime`, không membership.
      Giữ DB administrator riêng; chuyển28tables/schema functions sang owner
      sau snapshot0010 và bản cấu hình recovery trong thư mục private/Gitignored.
- [x] Migration owner upgrade0011/Alembic check qua; chạy đúng provisioning SQL
      hiện có bằng DB admin. Runtime khôngsuperuser/createdb/createrole/bypassrls,
      khôngownobjects/schema/functions, khôngCREATEpublic. Allocation SELECT/
      INSERT/UPDATE; audit/receipt SELECT/INSERT, khôngUPDATE/DELETE/TRUNCATE.
      Runtime login thật qua SQL zero-row FORUPDATE user/session và UPDATE
      allocation;6negative SQL privilege checks bị từ chối đúng expectation.
- [x] `.env` local chuyển sang runtime; `.env.migration.local` riêng cho schema
      owner, giữ nguyên Entra/Maximo settings. Environment files/recovery folder
      giới hạn Windows user/SYSTEM/Administrators và Gitignored; khônginsecret.
      Không thay passwords/config của DB administrator hoặc PostgreSQL Test55432.
- [x] Fingerprint/count mọi bảng nghiệp vụ trước/sau migration/grants bằng nhau.
      Giữ2rota imports/4drafts/0activation;3bảng assignment mới đều0rows. Không
      sửa WO/draft/rota, activate roster, gọi Maximo write hoặc deploy remote.
- [x] Khởi động backend SelectorEventLoop và frontend HTTPS localhost trong
      background hidden. Backend live/ready200, frontend HTTPS200/proxyready200
      với certificate verification; Entra configuration200/login_available=true.
      Readiness chỉDB/schema, chưa authenticated browser UAT. Khôngcommit/push.
- Bằng chứng: [development0011](evidence/assignments-development-2026-10-12.json).
- Tiếp theo: nghiệm thu UI theo630phút/người/ngày với rota Test hợp lệ; roster
      thật còn chờ Maximo admin sửa14LABOR/craft rồi reupload/refresh trước activate.

## Kích hoạt rota từ staging — 2026-10-11

- [x] Implement activation-preview, explicit full-replacement confirmation và
      activate API/UI tại `/rota-imports`; diff người thêm/bớt/đổi, craft/role,
      code/hours, tổng số ngày và tối đa 20 ngày chi tiết mỗi người (ghi rõ sample).
      Không gọi Maximo khi xem diff/kích hoạt. Giờ public và DB là giờ.
- [x] Migration0010 tạo pool state/version, stable person UUID theo pool/PERSONID,
      immutable activation receipt/snapshot và materialized daily capacity.
      Thay toàn bộ pool trong coverage kể cả người vắng khỏi file, giữ ngoài
      coverage; blank/off 0 giờ và working 10,5 giờ. Source/LABOR lỗi chặn toàn
      import; không loại âm thầm, không kích hoạt một phần hoặc override craft.
- [x] Backend độc lập kiểm tra company-only/current parser policy, unique exact
      LABOR identity, connection/org, craft/role, coverage/date/code/hour trước
      khi kích hoạt. Tenant/session/Planner/Admin/pool authority/CSRF/no-store.
      Activated import và revision/audit bất biến; pool registry/grants vẫn
      operator-only. Advisory transaction lock theo pool serialize replacement.
- [x] Guarded test DB và local development DB upgrade0010/Alembic check qua;
      staging thật không được kích hoạt. Backend focused103tests qua gồm actual
      PostgreSQL hai planner/kết nối riêng một winner, rollback, removed-person,
      outside coverage, stableUUID, replay receipt sau revision mới và runtime
      role thực thi API không có UPDATE pool. Runtime provisioning test riêng
      qua; Ruff/checkformat qua. Không thêm dependency.
- [x] Một focused independent Sol/high review cho milestone: không backend
      P1/P2; sửa hai P2 UI về unknown outcome retry và stale staged preview sau
      navigation cùng regression. GET receipt tự reload stage; unknown khóa
      POST/checkbox cho đến GET reconciliation. Main review và xác minh fixes.
- [x] Frontend full27files/270tests, lint/typecheck/build qua. Full run dùng
      `--testTimeout=15000` sau timeout5s của AppAssignmentDemo trong lượt chạy
      agent (file đó pass khi rerun riêng). Targeted cuối19tests qua, bao gồm
      receipt poolversion baseline+1, nullable coverage khi source lỗi, ack reset,
      read-only/activated guards, unknown recovery và navigation state reload.
      Diffcheck và links docs mới qua; không browser/live Maximo nghiệm thu ở bước này.
- Giới hạn: nghiệm thu bằng dữ liệu giả lập và DB local, chưa Maximo Test/Ubuntu;
      snapshot được lưu không bảo đảm trạng thái LABOR upstream hiện tại.
      Mẫu thật vẫn 14 lỗi và policy cũ cần reupload, chưa activate roster thật.
      Giới hạn ledger của milestone0010 đã được xử lý ở mốc0011 phía trên.
- [x] Assignment ledger/API trên active daily capacity, cùng pool lock,
      phân quyền WO và tổng tải/ngày đã triển khai/kiểm tra trong mốc0011.
      Resource timeline với dữ liệu thật vẫn chưa triển khai; panel từng WO
      đã hủy theo yêu cầu user ngày12/10, xem quyết định đầu trang.
- [ ] Phụ thuộc Maximo admin/access: sửa 14 dòng LABOR/craft trên Test, upload
      revision current-policy và refresh để nghiệm thu activation dữ liệu thật.

Hướng dẫn và giới hạn: [kích hoạt rota](rota-activation.md).

## Preview báo lỗi để Maximo admin xử lý — 2026-10-11

- [x] Theo xác nhận chủ dự án: uploader chỉ upload và xem lỗi; không chọn
      LABOR, tạo alias hoặc override craft. Preview có bảng lỗi riêng trước lịch
      với dòng/tên/chức danh, craft rota và tất cả LABOR candidates gồm mã,
      PERSONID, organization, tên và default crafts; nêu nguyên nhân/hướng xử lý.
      Missing LABOR, ambiguous, thiếu/nhiều default craft, lệch craft và duplicate
      identity đều được báo. Upload được lưu staging dù còn lỗi LABOR/craft.
- [x] Sau khi Maximo admin sửa trên server Maximo, planner dùng Làm mới LABOR.
      Backend đọc REST và tính lại mọi binding tự động, chỉ nhận identity duy
      nhất/craft khớp; newly fixed row được map, newly ambiguous/craft-conflicting
      row mất binding. REST lỗi giữ snapshot/mapping cũ và báo chưa đầy đủ.
      Không ghi Maximo. API mapping cũ giữ cho lịch sử, UI không sử dụng.
- [x] Backend 61 fast parser/LABOR tests và 10 PostgreSQL tests qua; kiểm tra
      hồi phục sau đổi tên/craft và xử lý ambiguity, restore bền vững; Ruff qua.
- [x] Frontend 14 focused UI/API tests qua, lint/typecheck/build qua. Kiểm tra
      upload có lỗi vẫn lưu, candidate details, refresh sau admin fix, stale
      A→B→A, cancelled/read-only, 409 reload và REST/network failure. Snapshot
      cũ được giữ nhưng lỗi cũ không hiển thị như trạng thái Maximo hiện tại;
      HTTP200 có labor_error không báo làm mới thành công. Main review/diffcheck qua.
- Giới hạn: chưa admin sửa dữ liệu thật trên Maximo; 14 dòng live vẫn còn lỗi.
      Chưa activation hoặc assignment ledger, không biến dòng lỗi thành resource
      dùng được và không loại âm thầm khỏi source staging.
- [ ] Ưu tiên 1 — phụ thuộc Maximo admin: xử lý 14 dòng trên server rồi refresh
      snapshot để xác minh lỗi hết. Uploader không cần quyết định alias/craft.
- [ ] Ưu tiên 2 — sẵn sàng triển khai: activation với coverage/diff/version và
      conflict checks, sau đó nối roster đã xác minh sang assignment ledger.

## Rota chỉ lấy nhân lực công ty và báo cáo 14 dòng — 2026-10-11

- [x] Đối chiếu 14 dòng chưa map trong PostgreSQL staging với cột C Company
      của ODS mẫu: cả 87 người hiện tại đều ghi `BD POC`, gồm cả 14 dòng.
      Kết quả chính xác: 6 không có exact-name candidate trong snapshot LABOR,
      1 trùng hai LABOR (Ta Xuan Nam: NAMT/NAMTX), 7 lệch craft. Không dùng
      thiếu LABOR hoặc lệch craft làm bằng chứng người đó là nhà thầu.
- [x] Theo xác nhận mới của chủ dự án, parser policy v4 chỉ giữ Company
      BD POC/BDPOC (chuẩn hóa hoa/thường/khoảng trắng). Công ty khác loại trước
      role/day validation, mapping và capacity, kể cả có LABOR ACTIVE trùng tên.
      Company trống/formula không enroll, báo lỗi C[row] để sửa/reupload.
      Chỉ lưu company của nhân lực được nhận và số dòng loại; không thêm dependency.
- [x] Main parse v4 trên ODS thật và đối chiếu snapshot đã lưu: vẫn 87 người,
      73 mapped/14 blockers, không lỗi nguồn, không có dòng công ty khác trong
      năm craft. Evidence aggregate: `docs/evidence/rota-company-policy-2026-10-11.json`.
- [x] Backend 68 focused tests qua (58 parser/LABOR, 10 PostgreSQL), Ruff
      check/format qua. Tests ODS/XLSX xác minh Company trống/formula,
      nhà thầu có LABOR trùng tên vẫn bị loại khỏi mapping/headcount/giờ;
      PostgreSQL restore giữ đúng kết quả. Frontend không đổi, DTO additive.
- Giới hạn: phiên PostgreSQL v3 giữ nguyên lịch sử; v4 áp dụng upload mới.
      Kiểm tra này đọc snapshot LABOR đã lưu, không thực hiện REST mới hoặc
      sửa staging/Maximo; chưa activation. Dựa vào Company trong file nguồn,
      chưa có xác minh độc lập tình trạng hợp đồng lao động.
- Yêu cầu xử lý 14 dòng đã được thay bằng policy báo lỗi cho Maximo admin
      ở mục phía trên; uploader không chọn identity hoặc chốt alias/craft.
- [ ] Sau mapping: upload revision v4, triển khai activation và assignment ledger
      với coverage/diff/version/conflict checks như milestone kế tiếp.

## Upload rota → PostgreSQL staging → LABOR REST thật — 2026-10-11

- [x] `/rota-imports` upload native XLSX/ODS tối đa8MB, đọc nguồn bounded, giữ
      ô trống0giờ/working10,5giờ; source validation, mapping, restore/list,
      refresh LABOR và cancel nối API/PostgreSQL. Chưa activation hoặc Maximo write.
- [x] Migration0009 áp dụng DB test cô lập và local Entra; source/cancelled stage
      bất biến, audit append-only, optimistic version/CSRF/no-store, runtime không
      sửa pool/grants/audit. Schema/model Alembic check qua; không thêm dependency.
- [x] Theo xác nhận chủ dự án: Admin và Planner của pool connection được xử lý
      chung5craft rota; WO discipline không mở rộng. Backend kiểm tra server role,
      tenant/session/account/pool/config trước/sau REST; optional audited grant.
- [x] Một independent Sol/high review cho milestone. Sửa mất manual mapping khi
      REST lỗi, reload409, stale response A→B→A, gap header, UTF16/entity và binding
      mất candidate sau rename LABOR. Main xác minh fixes và runtime grants.
- [x] Browser Entra thật upload ODS mẫu, LABOR Onshore Test/BDPOC147ACTIVE;
      PostgreSQL read-back source87×365, không lỗi nguồn/REST, audit có actor;
      reload mở lại policyv3, xem tháng10 capacity giờ. Hậu tố1A–9B chuẩn hóa đúng,
      tên trùng không auto-map:73mapped/14blocking;66LABOR ngoài exact-name roster
      bỏ qua. Evidence aggregate không tên/credential trong
      `docs/evidence/rota-live-read-2026-10-11.json`.
- [x] Full frontend25files/257tests, lint/typecheck/build qua. Backend fast suite
      trước fix hậu tố463tests qua; targeted cuối parser/LABOR/PG54tests qua và
      runtime-role PG riêng qua. Ruff/checkformat/diffcheck và Alembic check qua.
      Native XLSX kiểm tra bằng fixture; chưa live workbook XLSX khác template.
- Giới hạn: local development mới được xác minh; không Ubuntu/remote deployment,
      không activation/ledger.14dòng còn6không exactname và8craft/candidate khác;
      gross capacity158.476,5giờ cả năm chưa phải capacity verified để assignment.
- [x] Báo cáo14dòng chưa map; theo xác nhận mới, hiển thị đầy đủ lỗi trong
      preview để Maximo admin sửa dữ liệu trên server, uploader không map thủ công.
- [ ] Ưu tiên2 sau mapping: activation với coverage/diff/version, kiểm tra conflict
      và nối roster đã xác nhận sang resource timeline/assignment ledger.
- [ ] Remote nghiệm thu phụ thuộc IT: Ubuntu/HTTPS/Entra redirect/routing được
      duyệt; localhost không dùng từ iPhone từ xa.

Hướng dẫn: [staging thật](rota-live-staging.md). Các mục prototype dưới đây là
lịch sử trước milestone này, không còn phản ánh trạng thái importer hiện tại.

## Preview rota hiển thị giờ — 2026-10-11

- [x] Theo yêu cầu chủ dự án, đổi toàn bộ capacity trên staging preview sang
      giờ: working10,5giờ, blank/off0giờ; tổng capacity và per-date before/after
      diff chuyển đơn vị đúng, định dạng vi-VN. Timeline đã hiển thị giờ.
      Không đổi đơn vị tính nội bộ hoặc quy tắc budget/person/day.
- [x] Staging2files/11tests qua, lint/typecheck/build qua; browser xác minh
      code1/W=10,5giờ, AL/blank=0giờ; screenshot cập nhật. Diffcheck qua.
- Luồng importer/LABOR/PostgreSQL đã hoàn thành ở milestone phía trên.

## Staging preview rota tương tác — 2026-10-11

- [x] Theo flow planner đã đồng ý, frontend sub-agent xây riêng
      `frontend/src/rotaStaging`; Main tích hợp `/rota-staging-demo`, nav link và
      giữ workspace khi đi Settings rồi quay lại. Không thêm dependency.
- [x] Synthetic sample source/coverage/revision, readonly name/craft/position/
      date/code, LABOR composite candidate selection, unmatched/ambiguous/
      duplicate/craft/active/default-craft blockers. Outside-rota LABOR không
      thể tự vào pool; nhiều default rows cùng craft gộp, không tăng headcount.
      Control RM Engineer→P&P, Material Controller→MECH và SUP/ASST_SUP giữ riêng.
- [x] Source validation ngày Gregorian/mã known/blank, raw row/date errors;
      person-ID based added/removed/role/craft/date-capacity/mapping diff.
      Hủy bỏ stage giữ active revision; thử reupload reset mapping; simulated
      activation chỉ đổi local active roster/bindings/revision, không ghi DB.
- [x] Một independent review Sol/high cho milestone: sửa stale confirmation
      sau remap và renderer W-only không khớp model1/AL; regression và main QA
      xác minh. Full frontend23files/246tests qua; lint/typecheck/build qua;
      docs links/diffcheck qua. Backend không đổi, không chạy backend tests.
- [x] Browser IAB: ambiguous resolve, missing LABOR→sample reupload, remap làm
      checkbox hết hiệu lực, activation6mappingsR04, invalid NH4 blocked, cancel
      giữ activeR04; code1=630/AL=0; source specialroles đúng. Tab và screenshot
      preview giữ cho user thử. [Hướng dẫn](rota-staging-preview.md).
- Giới hạn: bước này là UX prototype chọn samples; chưa upload Excel/ODS, live
      LABOR reader, API/DB/pool grants/activation locking/reservation conflict,
      không nối activation sang assignment-demo. Reload mất local state; tests
      client không chứng minh persistence hoặc authorization thật.
- [ ] Ưu tiên sẵn sàng: nghiệm thu flow preview/mapping/diff trên UI; triển khai
      importer backend+PostgreSQL staging và bounded LABOR reader theo contract.
      Resource-pool grants, coverage full replacement/patch và matching aliases
      thực tế cần chốt trước khi kích hoạt roster dùng chung.

## Policy rota thay thế loại trừ trước — 2026-10-11

- [x] Chủ dự án đổi xác nhận: Control RM Engineer thuộc P&P và Material
      Controller thuộc MECH như section/count rota; cả hai tính capacity ngày
      working630phút, blank vẫn0. Policy này thay quyết định EXCLUDED cũ bên dưới.
      Giữ chức danh riêng; SUP/ASST_SUP hỗ trợ và shared person/day budget giữ nguyên.
- [x] Chỉ labor đã map đúng người có tên trong rota vào pool; ACTIVE không đủ
      chứng minh đang làm việc. Labor ngoài rota không có capacity/allocation;
      unmatched/ambiguous để ngoài pool, resolve staging, không map tên gần giống.
- [x] Architecture và PoC docs cập nhật. PoC thêm8Control RM Engineer/P&P và
      2Material Controller/MECH,87synthetic resources; role rows/summary/craft
      totals và editor dùng cùng630phút budget, không gán họ thành TECH.
      Targeted4testfiles/15tests qua, typecheck/lint qua; diff check qua.
- Giới hạn: dữ liệu vẫn synthetic; chưa importer, LABOR reader hoặc real-name
      matching gate trên backend. Parser/seed attachment không sửa, còn policy
      EXCLUDED cũ và phải được cập nhật khi triển khai importer.
- [ ] Ưu tiên sẵn sàng: staging map người trong rota với LABOR REST, review
      unmatched/ambiguous/craft mismatch; không auto-enroll139Maximo labor.

## LABOR REST Onshore Test — 2026-10-11

- [x] Đối chiếu tên hai labor bất thường với cột Name toàn sheet ROTA_2026
      trong ODS mẫu: không có exact normalized match cho cả hai tên. Các tên
      gần giống thuộc người khác; không tự gán craft/identity theo tên gần giống.
      Roster ACTIVE Maximo không tự thành pool technician: chỉ đưa vào sau khi
      map được người/role hợp lệ trong rota, áp dụng EXCLUDED đã chốt.
- [x] GET kiểm tra lại theo yêu cầu xác định labor bất thường:147ACTIVE/BDPOC,
      HTTP200/1page; trả mã/person/name và craft rows của2trường hợp cho chủ dự án.
      Một trường hợp không có LABORCRAFTRATE rows, trường hợp còn lại có2default
      rows cùng RES cùng2non-default rows. Chưa sửa dữ liệu; evidence aggregate
      giữ không chứa mã/tên cá nhân. Cần kiểm tra skill/rate trước khi kết luận
      hai default rows là bản ghi dư phải xóa.
- [x] Theo yêu cầu chủ dự án, gọi GET `/maximo/oslc/os/mxlabor` theo comment
      `maximo_labor.sql` với credential/configured connection hiện có; HTTP200.
      Bổ sung orgid/status và xác minh filter ACTIVE/BDPOC:147records,
      pageSize200/totalCount147/totalPages1, không có nextPage. Không ghi Maximo,
      không truy vấn trực tiếp Maximo DB; chỉ đọc internal DB connection metadata.
- [x] Nested PERSON/LABORCRAFTRATE arrays, defaultcraft boolean; không thiếu
      laborcode/personid/displayname, không duplicate org/labor. Năm craft139labor:
      E&I54/MECH27/RES7/P&P39/DECK12;7ngoài scope CRANE/HSE,1thiếu default.
      Một labor có2default rows cùng RES, cần deduplicate craft trước khi map.
- [x] Mẫu5records quảng bá nextPage khác TEST origin; không theo link đó.
      [Evidence chỉ aggregate](evidence/onshore-labor-read-2026-10-11.json),
      architecture cập nhật; documentation/evidence-only, chưa thêm runtime reader.
- [ ] Sẵn sàng: LABOR bounded reader + staging person mapping từ rota, xử lý
      thiếu/default trùng và foreign-origin pagination; giữ capacity theo rota.
      Chưa xác minh Offshore, requirements/ASSIGNMENT GET hoặc write contract.
      Các contract này còn cần metadata/quyền và designated test scope từ IT.

## PoC resource timeline tháng — 2026-10-11

- [x] Frontend sub-agent xây scope riêng `frontend/src/assignmentTimeline`;
      Main tích hợp route `/assignment-demo`, nav link và giữ workspace sau
      lần mở đầu khi chuyển trang. Native React table/form + CSS Modules,
      không thêm dependency, không đổi backend/schema/Maximo write allowlist.
- [x] Năm craft,77eligible synthetic people từ87source-count/10EXCLUDED,
      200synthetic WOs; TECH/SUP/Assistant SUP hiển thị riêng theo craft/ngày,
      monthly totals/load/remaining, role collapse, search/craft filter và
      backlog giới hạn30kết quả. Pool theo người, không chia site/connection;
      dữ liệu chỉ mô phỏng số lượng, không copy workbook names/rota cá nhân.
- [x] Form add/edit/move/delete minutes; chặn blank/off/invalid date/resource,
      craft mismatch, nonpositive/fractional minutes, oversupply và630phút
      tổng/người/ngày. Composite WO identity; undo/reset và before/after từng
      allocation, kể cả khác tháng/tổng giờ không đổi. SUP/ASST_SUP hỗ trợ cùng
      budget, không sửa PIC/estdur/target/status WO, không save/upload/import.
- [x] Main review sửa preview aggregate-only, reset/undo giữ edit ID cũ và CSS
      edit/delete buttons bị chồng và native-input min làm một phút underflow;
      bổ sung regression tests, working Sunday, seeded validity, invalid boundary
      và atomic day move. Full frontend21files/233tests qua, lint/typecheck/build
      qua, docs links/diffcheck qua.
- [x] Browser local IAB:render5craft, E&I filter, SUP4h→3.5h/Assistant SUP1h,
      TECH9h+2h rejection giữ9h, delete/undo khôi phục1h; keyboard month→December
      31ngày→November giữ support load. Screenshot layout và tab PoC được giữ.
      [Hướng dẫn và evidence](assignment-timeline-poc.md).
- Giới hạn: PoC synthetic/client memory; reload mất nháp, chưa REST/import/
      server persistence/authorization/concurrency, actual assignment hoặc
      drag/resize/auto split. Chưa representative benchmark/10browser Ubuntu;
      không dùng prototype tests để đóng backend reservation hoặc Maximo UAT.
- [ ] Ưu tiên: user thử flow chọn WO/người/ngày/giờ và SUP hỗ trợ, chốt UX;
      sau đó importer staging/native ODS regression + person mapping và ledger
      contract. LABOR Onshore GET đã có evidence bên trên; paging an toàn và
      roster mapping chưa triển khai, Offshore còn cần Maximo admin; full
      replacement policy và role mapping còn lại theo mục architecture.

## Xác nhận policy rota — 2026-10-11

- [x] Chủ dự án xác nhận SUP/Assistant SUP từng craft tính capacity theo rota
      trong mục riêng và được phân công hỗ trợ khi thiếu nhân lực. TECH/SUP/
      ASST_SUP hiển thị riêng; mỗi người tối đa630phút/ngày working, load dùng
      chung person/day ledger, không đếm đôi và không tự đổi role/quyền WO.
      Cập nhật kiến trúc/summary; không thêm workflow approval cho từng lần chọn.
- [x] Chủ dự án xác nhận bỏ qua ô rota trống: không tạo capacity/allocation từ
      ô đó, giữ identity và các ngày có mã hợp lệ. Control Room Engineer (alias
      Control RM Engineer trong mẫu) và Material Controller EXCLUDED khỏi
      capacity/danh sách phân công; chỉ đổi khi chủ dự án xác nhận lại.
- [x] Cập nhật kiến trúc và backlog; phân biệt blank trong coverage với thiếu
      người/ngày/coverage hoặc unknown code. Mẫu87người gồm10EXCLUDED đã chốt;
      77TECH/SUP/ASST_SUP theo seed không phải headcount làm việc mỗi ngày.
      Main kiểm tra links/consistency/whitespace; documentation-only, chưa đổi
      parser/schema/UI hoặc nạpDB. Native ODS và LABOR REST vẫn chưa kiểm chứng.
- Tiếp theo sẵn sàng: PoC/import staging áp dụng policy đã xác nhận. Mapping
      position còn lại và full replacement vẫn cần chốt; REST binding
      còn cần metadata/quyền Maximo admin.

## Đối chiếu rota ODS mẫu — 2026-10-11

- [x] Đọc attachment POB Plan Q4 2026.ods trực tiếp OpenDocument ZIP/XML bằng
      bundled Python, chỉ đọc; xác minh hai sheet, ROTA H4:NH4 đủ365 ngày2026,
      date uniqueness/continuity, năm section và87 người/31755 person-day cells.
      Q4 có92 ngày/8004 cells; không trùng normalized name/unknown code/position
      theo policy attachment; numeric/string codes, không formula trong rota cells.
- [x] Bổ sung [đối chiếu workbook trong kiến trúc](assignment-resource-timeline.md#11-đối-chiếu-workbook-rota-mẫu--2026-10-11):
      61TECH/16SUP-ASST_SUP/10EXCLUDED theo seed đề xuất, gross TECH capacity
      tháng10/11/12, ba row trống toànQ4 và weekday row typed dates1900.
      Main kiểm tra source counts, calendar boundaries, local link và whitespace.
- Giới hạn: blank và hai position EXCLUDED đã được user xác nhận ở mục trên;
      WORK_CODES/role còn lại theo đề xuất và user10.5h, chưa xác minh LABOR REST
      mapping/tải ngoài. Chưa chạy native
      parser với pandas ODF engine vì bundled runtime thiếuodfpy; không cài thêm,
      sửa file mẫu, nạp DB, thêm UI/API hoặc gọi Maximo. Không lưu thông tin cá nhân.
- [x] Chốt bỏ qua blank (đặc biệt rows38/65/71), loại Control RM Engineer và
      Material Controller theo xác nhận chủ dự án2026-10-11.
- [x] Chốt SUP/ASST_SUP tính capacity riêng và hỗ trợ khi thiếu nhân lực theo
      xác nhận chủ dự án2026-10-11; không coi là TECH hoặc capacity đếm thêm lần hai.
- [ ] Chốt mapping position còn lại và snapshot replacement; sau đó làm importer
      staging + PoC tháng từ87source rows, loại10EXCLUDED khỏi assignment rows.
      Native ODS parser regression và REST binding là kiểm chứng implementation
      riêng; LABOR metadata/quyền còn cần Maximo admin theo backlog bên dưới.

## Kiến trúc assignment timeline theo rota — 2026-10-11

- [x] Đọc năm file đính kèm rota_parser.py, maximo_labor.sql,
      position_role_seed.sql, README.md và schema.sql; đối chiếu code reader,
      WO allowlist, elapsed duration, identity/grants và TODO timeline hiện có.
      User yêu cầu explicit Astra: một review độc lập Astra/high, read-only,
      scope identity/capacity/import/concurrency/quyền và semantics assignment.
- [x] Lưu [kiến trúc đề xuất](assignment-resource-timeline.md): năm craft,
      tháng/ngày, một người/một craft, pool không chia giàn/site; 630 phút/ngày,
      person UUID + labor binding connection/org, rota revision staging/activate,
      reservation ledger dùng chung và scenario draft không chiếm đôi capacity.
      Tách PIC/estdur/labor allocation; ghi assignment Maximo là contract riêng.
- [x] Ghi các lỗi thiết kế trong attachment: name_key/trùng tên, unknown code
      thành off, removed people giữ lịch cũ, hard-code policy, thiếu connection/
      workorderid/org namespace và concurrency/version/unknown recovery.
      Đối chiếu tài liệu IBM REST/Assignment Manager và FullCalendar/Bryntum
      chính thức; Main kiểm tra Markdown links nội bộ và diff whitespace.
- [ ] Chốt bảng mã (đặc biệt F/AF), mapping position còn lại, craft alias và
      P&P/PROD mapping, coverage full replacement, quyền resource summary theo
      pool/craft và mục tiêu phân bổ nội bộ hay actual ASSIGNMENT outbound.
- [ ] PoC tháng bằng dữ liệu giả theo contract daily minutes; benchmark timeline
      adapter/license, keyboard, two-planner race, month clipping, capacity
      reduction và multi-site cùng người. Chưa chọn/cài dependency.
- [ ] Xác minh LABOR/PERSON/CRAFT/org/defaultcraft/paging bằng REST trên TEST;
      requirement/external assignment reads trước tuyên bố remaining toàn bộ.
      Actual assignment writes còn cần metadata/quyền/conditional create-change-
      cancel contract, audit/reconciliation và UAT riêng với Maximo admin/IT.
- Giới hạn: chỉ thiết kế/documentation, chưa chạy parser với Excel thật,
      chưa thêm UI/API/migration/assignment allowlist hoặc gọi Maximo live.
      Capacity theo ngày chống vượt budget, chưa chống trùng interval trong ca;
      chưa đọc đủ external assignment phải báo local-only/incomplete.
- Tiếp theo ưu tiên cho feature này: chốt contract + PoC synthetic; metadata
      REST và business policy còn cần chủ dự án/Maximo admin. Ubuntu staging/
      10 browser/SLO vẫn chờ IT; backup/restore và history phase2 còn tạm gác.

## Đề xuất resource timeline và backlog — 2026-10-10

- [x] Nghiên cứu thiết kế màn hình chính backlog + timeline theo PIC/nhân sự/crew,
      heatmap craft × ngày và phân tầng cảnh báo; đối chiếu reader/detail,
      allowlist thay đổi, elapsed duration, quyền và trạng thái upload hiện có.
      Đề xuất React/TypeScript + FastAPI/PostgreSQL, reuse draft/audit/upload,
      tách work event/resource/allocation và calendar/requirement/constraint.
- [x] Đối chiếu tài liệu chính thức IBM Assignment Manager 7.6.1.2,
      FullCalendar resource timeline/external dragging/license, Bryntum
      Scheduler/Pro. FullCalendar Premium là ứng viên MVP; Bryntum là ứng viên
      nếu cần multi-assignment/calendar/dependency sâu. Chưa chọn/mua/cài thư viện.
- [x] Mockup hội thoại bằng dữ liệu giả: backlog, timeline, ngoài ca, capacity,
      chọn/kéo WO, gán nháp, cảnh báo craft/trùng lịch/ngoài ca, preview và undo.
      Main kiểm tra JavaScript syntax và DOM bằng jsdom: render ban đầu, craft
      filter, craft/overlap rejection, gán nháp, preview và undo qua.
      Mockup không nằm trong ứng dụng và không gọi Maximo; không có resize thật,
      persist backend, viewport screenshot hoặc benchmark/browser UAT.
- Quyết định đề xuất: giai đoạn đầu chỉ ánh xạ PIC vào assignedtechname; không
      gọi đây là Maximo labor assignment. Giữ estdur là elapsed hours và Finish
      tính từ Start; không tự đổi sang working hours hoặc suy labor-hours từ estdur.
      Heatmap thiếu planned labor/calendar phải báo thiếu dữ liệu; không giả
      định crew PIC từ mxpersongroup là actual crew/craft/skill/calendar.
- [ ] Chốt ngữ nghĩa PIC hay actual assignment, trạng thái APPR/WSCH theo synonym
      domain từng connection, backlog chưa/thiếu phân công, calendar/timezone,
      planned labor units và nguồn permit/downtime; cần chủ dự án/Maximo admin.
      Xác minh read-only LABOR/craft/skill/crew/shift/availability/object structure
      trên TEST trước mở API/resource capacity hoặc ghi assignment mới.
- [ ] PoC frontend với dữ liệu giả và adapter timeline: chọn thư viện/phiên bản/
      license sau đo dữ liệu đại diện; kiểm chứng keyboard, resize, ngày/tuần,
      undo, multi-resource identity, scope reset và bảo toàn nháp/bảng hiện có.
- [ ] Triển khai timeline PIC dùng contract/draft/upload hiện có sau chốt UX;
      thêm retrieval theo schedule overlap (không chỉ target finish), unscheduled
      backlog và read completeness. Không thay status/target theo thao tác kéo.
- [ ] Giai đoạn sau: requirements/allocations/calendars/capacity/conflicts có
      nguồn + revision + completeness; không đếm đôi crew/person hoặc worker
      nhiều craft; không lộ WO ngoài scope. Actual assignment writes cần quyết
      định mở allowlist, contract probe, migration/audit/recovery và UAT riêng.
- Giới hạn: đây là phân tích/thiết kế, chưa thay màn hình chính, schema, API,
      dependency hoặc write permissions. Bằng chứng upload 12 CM hiện có không
      chứng minh actual labor assignment, calendar/capacity hoặc timeline mới.
- Tiếp theo sẵn sàng: nghiệm thu mockup và PoC dữ liệu giả. Phụ thuộc IT/Maximo:
      metadata và quyền đọc resource/calendar/planned labor/constraints trên TEST;
      Ubuntu staging/10 browser/SLO vẫn theo các mục nghiệm thu hiện có.

## Upload toàn bộ nháp nhóm — 2026-10-10

- [x] Một lần bấm cho nháp nhóm tối đa200 WO: tự gửi các đợt tuần tự tối đa10,
      cùng request/batch; tiến độ confirmed/total, dừng sau đợt đang gửi và tiếp
      tục phần pending khi trạng thái an toàn. Không gom nhiều nháp riêng.
- [x] Kiểm chứng timeout/ambiguous outcome, context/scope/navigation changes,
      double click, failed/conflict/unknown/sending/no progress, final refresh
      và regression UI/API hiện có. Không đổi backend/schema/dependency/gates.
- Bằng chứng: 12 behavioral tests mới, gồm200 WO/20 đợt, dừng và tra cứu trước
      resume; full frontend218 tests/17files, TypeScript/ESLint/production build
      qua. Main chạy lại12 tests mới qua (Vitest cần quyền spawn ngoài sandbox
      Windows; lần đầu EPERM chưa chạy tests). Một review Sol/high phát hiện P1
      context-abort dùng receipt cũ; đã chặn resume cho đến GET thành công, có
      regression và một focused recheck xác nhận sửa. Docs/diffcheck qua; xem
      [thao tác upload nhóm](upload-workflow.md#upload-toàn-bộ-nháp-nhóm--2026-10-10).
- Giới hạn nghiệm thu: tests frontend với API giả không chứng minh upload200 WO
      trên Maximo thật; staging/production/Offshore vẫn khóa. Historyphase2 và
      backup/restore tiếp tục tạm gác.
- Tiếp theo: nghiệm thu thao tác một lần bấm, dừng/tiếp tục và kết quả trên
      Onshore TEST bằng danh sách WO được chuẩn bị cho UAT; không lấy tests giả
      thay cho bằng chứng thay đổi Maximo thật.

## Nghiệm thu upload toàn bộ nhóm — Onshore TEST — 2026-10-10

- [x] Browser/Entra thật, E&I/Onshore TEST: retrieve117 WO tháng10, chọn12 CM
      không trùng nháp/reservation, baseline bất biến trước gửi. Một lần bấm gửi
      tự động10+2; UI12confirmed, panel đóng/bảng fresh. Chỉ Duration mỗi WO+.25h.
- [x] Dừng live ở10confirmed/2pending, nháp v1/full12members giữ lại; hai pending
      chưa intent/request và Duration gốc. Kiểm tra trạng thái rồi resume chỉ2 WO,
      cùng batch/request và đúng một conditional write/item; không gửi trùng.
      Watcher DB read-only báo lúc batchprepared để bấm pause; lần thử pause trước
      đó đến sau khi upload hoàn tất được ghi là chưa kiểm chứng, không gọi là lỗi.
- [x] Final read-back độc lập: cả12 WO đúng sáu trường original, năm trường ngoài
      Duration không đổi xuyên suốt, rowstamp tiến lên;48items/4batches đều204/
      confirmed/finalized,0reservation/0nháp thử còn lại. Bốn nháp cũ/năm members
      nguyên vẹn. Watchers kết thúc, dịch vụ local giữ; không deploy/migrate/grant.
- [x] Sửa nhãn preview vẫn nói Maximo chưa thay đổi khi request đang gửi; ẩn
      preview trước gửi khi đã có requestID, hiện đang xử lý upload/kiểm tra kết
      quả và chỉ báo recovery chưa rõ khi không còn busy. Regression deferred
      submit bổ sung; full frontend219tests/17files, lint/TypeScript/build qua.
      Đây là sửa thông báo sau UAT, không đổi orchestration/backend/gates.
- Bằng chứng: [báo cáo](upload-workflow.md#nghiệm-thu-upload-toàn-bộ-nhóm-trên-onshore-test--2026-10-10),
      [evidence](evidence/onshore-upload-all-uat-2026-10-10.json); audit và ảnh local
      `.cache/upload-all-uat-*`. Prepared→finalized12.02/13.00/13.42s cho ba lượt
      không dừng; lượt pause105.71s gồm thời gian người thao tác. Timestamps DB
      không được xem là latency HTTP/API. Main docs/evidence/diffcheck qua.
- Giới hạn:12 CM/duration-only/một tài khoản; chưa live200 WO/10browser/Ubuntu,
      fault injection timeout/unknown hoặc recovery sau đóng browser. Backup DB
      và historyphase2 vẫn tạm gác; restore giá trị WO thử không phải restore DB.
- Tiếp theo sẵn sàng: tăng quy mô nhóm UAT để đo response thực và chốt SLO; chưa
      dùng mốc12 WO này để đóng capacity200. Ubuntu staging cần IT cấp server/
      DNS/TLS/routing/tài nguyên/test roster trước nghiệm thu môi trường đích.

## Cách sử dụng

- [x] là đã hoàn thành trong phạm vi ghi ngay tại mục và có bằng chứng; [ ] là còn việc
  hoặc chưa đủ bằng chứng nghiệm thu. Mục gộp được tách để không che phần đã làm/chưa làm.
- Mỗi nhóm có phụ thuộc và tiêu chí nghiệm thu. Hoàn thành mã chưa đồng nghĩa hoàn thành UAT.
- Ghi ngày, bằng chứng kiểm tra và hạn chế khi đánh dấu hoàn thành.
- P0: cần cho bản đầu; P1: mở rộng sau khi luồng chính ổn định.
- Không lưu hostname production chưa được cung cấp, API key hay client secret trong file này.
- Các ghi nhận theo ngày là lịch sử tại thời điểm đó, không phải trạng thái hiện tại.
  Mục 1–6 đã đối soát ngày 2026-10-07; xem [đối soát từng mục và kế hoạch](checklist-review.md).

## 0. Bootstrap tài liệu — hoàn thành

- [x] Chốt frontend/backend riêng, khoảng 10 người dùng, Ubuntu có Docker.
- [x] Chốt Maximo 7.6.1.3; phân biệt hai hệ thống Onshore/Offshore.
- [x] Chốt Entra SSO + integration account; lịch sử người thao tác lưu trên web.
- [x] Chốt planner chỉ được xem/sửa discipline được cấp quyền.
- [x] Chốt các trường cập nhật giống VBA và quy tắc target PM/CFT.
- [x] Hoàn thiện AGENTS.md gốc và hướng dẫn backend/frontend.
- [x] Hoàn thiện architecture.md và README cho dự án.
- [x] Tạo backlog có phụ thuộc và tiêu chí nghiệm thu.

Bằng chứng: các quyết định trong trao đổi với chủ dự án và tài liệu cùng repository.
Trạng thái tại thời điểm bootstrap: chỉ có tài liệu. Foundation được triển khai sau đó;
xem [bằng chứng kiểm tra](implementation-status.md). Chưa có kết nối Maximo thật.

## 0.1. Cấu hình agent Codex — hoàn thành 2026-10-07

- [x] Thiết lập native project config: Main GPT-6.1 Sol / Medium; ba custom agent
      frontend GPT-6 Luna / Medium, backend GPT-6.1 Sol / Medium,
      reviewer GPT-6 Astra / High; tối đa ba sub-agent đồng thời.
- [x] Bổ sung routing vào AGENTS.md: task nhỏ Main tự làm; substantial FE/BE giao
      theo phạm vi, FE+BE độc lập chạy song song; kiến trúc, bug khó/lặp lại và
      final large review giao reviewer. Reviewer mặc định review-only/read-only.
- [x] Thêm [hướng dẫn sử dụng](codex-agents.md) và liên kết trong README.

Bằng chứng: Python tomllib parse đủ bốn TOML và kiểm tra đúng role/model/effort;
Codex CLI 0.160.1 app-server strict config + config/read nạp project trusted,
xác nhận Main Sol/medium và agents enabled/max concurrent = 3. model/list có đủ
ba model và effort tương ứng; debug prompt-input xác nhận AGENTS routing mới
được nạp. Đã kiểm tra liên kết local, placeholder và git diff --check.
Phạm vi là cấu hình/tài liệu; không chạy lượt model/sub-agent live hay suite ứng dụng.
Danh mục model không chứng minh một lượt gọi model thành công. Chat đang chạy giữ
model/effort riêng; dùng chat mới trong project và chọn Sol/Medium khi cần.

## 0.2. Giảm chi phí review agent — hoàn thành 2026-10-08

- [x] Theo lựa chọn chủ dự án: reviewer mặc định Sol/High; Main vẫn Sol/Medium,
      frontend Luna/Medium và backend Sol/Medium. Reviewer tiếp tục review-only.
- [x] Main tự review thay đổi nhỏ/thường; không gọi readiness reviewer theo mỗi chat,
      lượt, status/TODO/tài liệu hoặc lần chạy test. Review độc lập chỉ khi có giá trị.
- [x] Mỗi tính năng/mốc mặc định một review độc lập và tối đa một recheck lỗi P1/
      nghiêm trọng. Nâng mức Sol/xhigh hoặc Astra/high cần vấn đề chưa giải quyết
      cụ thể hoặc yêu cầu rõ; không đặt lại giới hạn khi đổi chat và không review lại
      bằng chứng không đổi. Vượt giới hạn chỉ cho yêu cầu rõ hoặc vấn đề P1 mới.
- [x] Ghi cách nâng mức với generic/default spawn vì native reviewer cố định Sol/high;
      không thêm role và không tiếp tục phiên Astra/high cũ cho review thường.

Bằng chứng: parse TOML đúng model/effort/read-only; đối chiếu routing trong AGENTS.md,
reviewer.toml và hướng dẫn; kiểm tra liên kết local và git diff --check. Model/effort
Sol high/xhigh và Astra high đã được đối chiếu với tài liệu OpenAI và native catalog.
Không chạy model/sub-agent live hoặc suite ứng dụng cho thay đổi cấu hình/tài liệu.
Giới hạn số lượt là hướng dẫn orchestration, không phải quota cưỡng chế của runtime.
Sub-agent đã tồn tại vẫn giữ model/effort cũ; cần phiên reviewer Sol/high mới.

## 0.3. Main luôn đề xuất bước tiếp theo — hoàn thành 2026-10-08

- [x] Bổ sung AGENTS.md: sau mỗi task hoàn thành, Main luôn kết thúc bằng 1–3 bước
      cụ thể theo ưu tiên/phụ thuộc, dựa trên TODO và trạng thái đã kiểm chứng.
      Nêu việc nên làm đầu tiên/kết quả mong đợi và bước cần đầu vào từ chủ dự án/IT.
- [x] Đồng bộ hướng dẫn sử dụng; nếu không còn việc bắt buộc, đề xuất kiểm tra/
      nghiệm thu phù hợp. Không bỏ dở task để chuyển việc bắt buộc thành đề xuất.

Bằng chứng: đối chiếu quy tắc giữa AGENTS.md và hướng dẫn; kiểm tra liên kết local,
không có placeholder/trailing whitespace, git diff --check. Chỉ sửa hướng dẫn/
tài liệu; không đổi model/effort và không chạy lượt model hoặc suite ứng dụng.

## 1. P0 — Thu thập cấu hình và kiểm chứng hợp đồng Maximo

Phụ thuộc: chủ dự án/IT cung cấp thông tin. Có thể làm scaffolding và mock song song về tiến độ.

- [x] Chuẩn bị [checklist thu thập thông tin tích hợp](integration-intake.md) và yêu cầu thông tin
      khởi đầu từ chủ dự án (2026-10-01); Onshore read-only đã xác minh sau đó ngày 2026-10-02.

- [x] Nhận base host `http://bd-maxdev.biendongpoc.vn`, xác nhận môi trường test (2026-10-01).
- [x] Xác nhận context path `/maximo`, test đại diện Onshore, không cần VPN (2026-10-01).
- [x] Xác minh GET Onshore test `oslcmxwodetail`, `mxpersongroup` và `mxperson`
      (2026-10-02): WO list/detail, 25 PIC E&I_N và PERSON discipline; chưa xác minh write contract.
- [ ] Nhận URL/object structures Offshore test và kiểm chứng riêng; không suy rộng từ Onshore.
- [x] Chủ dự án chọn HTTP riêng cho test (2026-10-01); opt-in trong registry, chỉ DB connection test,
      ứng dụng production không dùng HTTP. HTTPS/Entra vẫn yêu cầu TLS hợp lệ.
- [x] Kiểm tra sơ bộ không credential từ Windows: DNS phân giải, HEAD HTTP root trả 403,
      HTTPS lỗi xác minh chứng chỉ (2026-10-01); xem [bằng chứng/giới hạn](integration-intake.md).
- [ ] Xác nhận routing từ Ubuntu tới test Maximo, DNS, TLS và CA nội bộ.
- [x] Nhận/nạp API key test do chủ dự án nhập vào `.env` server-side được ignore;
      GET WO/PERSON/crew thật thành công (2026-10-02), không lấy key từ workbook/source.
- [ ] Xác nhận tài khoản tích hợp chuyên dụng, chủ sở hữu key, quyền tối thiểu và vòng đời key với IT.
- [ ] Chốt kênh bàn giao/rotation secret và secret manager cho staging/production.
- [x] Xác minh đọc field WO/detail và relationship `persongroupteam/respparty` trên
      Onshore E&I (2026-10-02); lỗi status serialization/crew child đã được xử lý và kiểm thử.
- [ ] Đối chiếu metadata đầy đủ, nhất là `lochierarchy.systemid` còn thiếu trong mẫu live,
      và relationship/field ở các discipline/hệ thống khác.
- [x] Xác minh identity đọc Onshore: connection UUID + siteid + workorderid; mở detail
      P13457392/BD1 và nháp live (2026-10-02). WONUM không dùng làm khóa toàn cục.
- [ ] Xác minh resource href dùng cho mutation và orgid/contract write; reader hiện không lấy hai field này.
- [ ] Xác minh status domain APPR/SCHED/WMATL/WMAT/DFAPPR trên từng hệ thống.
- [ ] Kiểm tra parent!="*" và istask=0 có đúng tập WO cần lấy.
- [ ] Xác định giới hạn page size, next-page links, sort và tổng số bản ghi.
- [x] Nhận 6 discipline codes/timezone và mapping crew Onshore từ chủ dự án;
      E&I → E&I_N đã đọc 25 PIC live (2026-10-02).
- [ ] Kiểm chứng crew/PIC live cho MECH/RES/DECK/PROD/DNC và Offshore, chưa coi mapping tham chiếu là nghiệm thu.
- [ ] Xác minh các field optional, null, độ dài PIC, đơn vị/độ chính xác estdur.
- [x] Chốt timezone Onshore `Asia/Ho_Chi_Minh`; date input có offset, lọc từ bao gồm
      đến mốc cuối loại trừ; retrieve tháng 10 được 117 WO (2026-10-07). Xem [reader](maximo-reader.md).
- [ ] Chốt giờ mặc định, clear date/PIC/null và đơn vị/độ chính xác duration cho write contract;
      UI hiện không hỗ trợ clear thành null, Finish tính bằng giờ liên tục chưa phải lịch ca.
- [ ] Kiểm chứng POST + x-method-override: PATCH bằng WO test được chỉ định.
- [ ] Kiểm chứng ETag/If-Match hoặc cơ chế conditional update được hỗ trợ.
- [x] Ghi nhận lỗi live HTTP 400/BMXAA8744E do status list và xử lý redaction lỗi upstream;
      HTTP mock tests bao phủ lỗi authentication/authorization/validation (2026-10-02/07).
- [ ] Thu thập thêm lỗi hợp đồng thực tế đã redaction cho từng hệ thống; không tạo lỗi ghi trên WO chưa chỉ định.
- [x] Có field-mapping từ VBA và fixtures synthetic inline trong tests; không chứa workbook keys.
- [ ] Bổ sung fixtures đã redaction lấy từ response live cùng metadata/contract đã đối chiếu.

Nghiệm thu: có hợp đồng request/response đã kiểm chứng, identity WO, quy tắc ngày và phạm vi
quyền API rõ ràng. Không dùng hostname giả để đánh dấu hoàn thành.

## 2. P0 — Khởi tạo mã nguồn và công cụ

Phụ thuộc: tài liệu đã hoàn thiện. Không cần credential thật.

- [x] Khởi tạo Git và .gitignore nếu chủ dự án tiếp tục triển khai trong thư mục hiện tại;
      hoàn thành git init ngày 2026-09-25; đã có commits và remote GitHub, main đồng bộ origin/main
      sau push commit 82900f3 ngày 2026-10-01.
- [x] Pin Python 3.12.14, Node 26.0.0, uv 0.11.9; dependency lockfiles và local checks
      qua (2026-10-07), CI dùng cùng baseline. Đây là bằng chứng tương thích local.
- [x] Pin verified manifest digests Python/uv/Node/nginx/PostgreSQL trong Dockerfiles,
      Compose/test và CI; build backend/web Linux, health/readiness/nginx config qua (2026-10-07).
      Frozen clean sync + 244 backend tests/migration round-trip trên Linux qua;
      [phạm vi](container-checks.md) chưa thay full Compose/Ubuntu staging.
- [ ] Đánh giá/nâng security patch runtime/dependency lifecycle, scan OS/Python images,
      SBOM và chính sách refresh digest; baseline Python 3.12.14 hiện được giữ để sửa CI.
- [x] Scaffold backend theo backend/AGENTS.md; pyproject.toml, uv.lock và app factory.
- [x] Scaffold React/Vite/TypeScript strict; package.json và package-lock.json.
- [x] Thiết lập settings tập trung, kiểm tra cấu hình và .env.example không có secret.
- [x] Tạo health/readiness endpoints; không đưa thông tin credential vào response.
- [x] Thiết lập Ruff, pytest, typecheck, frontend lint/test/build scripts.
- [x] Thêm workflow GitHub Actions cho backend/frontend và PostgreSQL migrations/tests
      (2026-10-07); actionlint và kiểm tra tương đương local qua. Kết quả runner đã đọc;
      xem [CI](ci.md) và bằng chứng cuối checklist.
- [x] CI đã commit/push trong `dd9cae6`; GitHub connector xác nhận commit tồn tại
      (đối soát 2026-10-07), local main khớp origin/main.
- [x] Đọc run/job logs 37590200157: frontend Ubuntu success; hai backend jobs failure tại
      uv Python download. Sửa dùng setup-python SHA pinned, giữ 3.12.14/uv 0.11.9 (2026-10-07).
- [ ] Commit/push bản sửa và xác minh cả ba job success trên GitHub Ubuntu runner.
- [x] Ghi lệnh chạy local và các kiểm tra thật sự chạy được vào README.

Nghiệm thu: môi trường sạch cài bằng lockfile và chạy frontend/backend với dữ liệu mock;
thiếu config bắt buộc phải báo rõ, không tự dùng endpoint production.

Bằng chứng 2026-09-25: backend và frontend chạy local; lockfiles đã tạo; lint/typecheck,
unit/UI tests và frontend build đã qua. Image digest và PostgreSQL runtime chưa xác minh.

## 3. P0 — Database và migration

Phụ thuộc: 2; refinement từ 1.

- [x] Tạo model/migration User, AccessGrant và MaximoConnection (2026-09-25).
- [x] Triển khai lưu Session hash/expiry và logout với CSRF (2026-09-29).
- [x] Nối Session với callback MSAL + JWT validation; local tenant login/callback thật
      qua ngày 2026-10-02. MFA/Conditional Access/staging vẫn chờ nghiệm thu ở mục 4.
- [x] Thiết kế Draft/DraftItem với owner, scope, baseline, revision và proposed changes (2026-09-29).
- [x] Schema UploadBatch/UploadItem/AuditEvent, item UUID và unique idempotency theo actor.
- [x] Submit nháp đơn/nhóm kiểm tra request hash, actor + request_id, version và durable
      receipts (0004); duplicate/concurrency tests PostgreSQL qua (2026-10-07).
- [ ] Upload orchestrator kiểm tra request hash khi submit lặp, liên kết retry attempts
      và correlation logs; schema/state service chưa phải remote upload orchestrator.
- [x] Đặt unique/index theo connection + site + workorderid; không dùng WONUM làm khóa toàn cục.
- [x] DB lưu connection metadata/base_url/timezone/enabled/secret_reference; API key
      ở registry server-side, không nằm trong business tables. Onshore connection có audit
      đã dùng live (2026-10-02); secret manager resolver theo reference còn chưa triển khai.
- [x] Tạo/review migration 0001_identity; sinh PostgreSQL SQL offline thành công (2026-09-25).
- [x] Áp dụng migrations tới 0007; upgrade/check/downgrade/upgrade/check trên DB tạm
      và 100 PostgreSQL tests qua (2026-10-07). DB ứng dụng không bị downgrade.
- [x] State machine sending/unknown và hàm chuyển sending quá hạn thành unknown.
- [ ] Nối recovery vào worker lifecycle/lease và kiểm thử crash khi gửi Maximo thật.
- [ ] Xác định retention cho draft, session và audit cùng IT/chủ dự án.
- [x] Trigger append-only chặn UPDATE/DELETE/TRUNCATE ở audit_event/authorization_event;
      PostgreSQL tests qua (2026-10-07).
- [x] Triển khai provisioning runtime/migration owner và test đặc quyền trên DB mới
      riêng (2026-10-07): runtime không DDL/TEMP/TRUNCATE/gỡ audit/nâng admin hoặc xóa receipts/uploads.
- [ ] IT áp role/DSN tách biệt và nghiệm thu trên staging; owner vẫn có thể gỡ bảo vệ,
      không dùng owner credentials cho backend. Compose đã tách DSN, chưa provision staging.

Nghiệm thu: migration áp dụng được trên DB trống; constraints và state transitions có test;
audit tách khỏi log kỹ thuật và không chứa credential.

## 4. P0 — Entra SSO và phân quyền

- [x] Bắt đầu checklist thu thập Entra (2026-10-02) tại [Entra setup](entra-setup.md):
      đối chiếu config/backend auth hiện có và tài liệu Microsoft về app/redirect URI.
      Đã phân biệt Client ID, user Object ID, credential server-side và HTTPS callback.
      Kiểm tra liên kết nội bộ và diff; chỉ thay đổi tài liệu, không chạy application tests.
      Chưa nhận tenant/client ID, hostname, credential hoặc tài khoản test; chưa kiểm thử live.
- [x] Chủ dự án xác nhận chưa có app registration (2026-10-02); bổ sung hướng dẫn tạo
      app test single-tenant và lấy hai ID trong Entra setup, đối chiếu Microsoft Learn.
      Kiểm tra diff/link nội bộ; chưa tạo app trên tenant, chưa nhận ID và chưa chạy live login.
- [x] Ghi nhận chủ dự án báo đã tạo app registration (2026-10-02).
      Bằng chứng: xác nhận trong trao đổi; chưa đối chiếu portal, nhận hai ID hoặc xác minh
      single-tenant/Web/callback. Kiểm tra diff tài liệu qua; chưa chạy live login.
- [x] Nhận Tenant ID và Application (client) ID từ chủ dự án (2026-10-02), ghi trong
      [Entra setup](entra-setup.md); kiểm tra định dạng UUID và diff tài liệu qua.
      Chủ dự án xác nhận chưa có tên miền HTTPS; chưa chọn local/staging, nhận credential,
      đối chiếu tenant/app thật hoặc kiểm thử login. Mục intake tổng thể vẫn chưa hoàn tất.
- [x] Chuẩn bị Entra Windows local HTTPS (2026-10-02): cert localhost 30 ngày tin cậy
      Current User, Vite loopback 5173, proxy API và callback log redaction; không thêm dependency.
      PostgreSQL development riêng 55433 có volume/image digest, backend Windows SelectorEventLoop.
      HTTPS frontend/API live/ready 200 với trust verification, migration/schema check qua;
      frontend typecheck/lint, Ruff launcher và diff/link tài liệu qua. Ignore secret/PFX đã xác nhận.
      Hướng dẫn: [Windows local](entra-local-windows.md). Chưa có credential hoặc browser live login;
      callback/assignment/MFA trên Entra và WO grants còn pending.
- [x] Bật Entra config local và restart backend (2026-10-02): secret do chủ dự án nhập
      trong `.env`, bỏ comment bốn trường sau khi kiểm tra IDs/callback; không in credential.
      Readiness 200, login_available=true; MSAL discovery tenant thật qua, HTTPS login 303
      tới đúng tenant/callback với PKCE và flow cookie Secure/HttpOnly. Kiểm tra diff/link qua.
      Backend cần mạng ngoài sandbox; không tắt TLS. Chưa xác minh client secret bằng token
      exchange, browser MFA/callback/session, assignment hoặc WO grants; live login vẫn pending.
- [x] Xác minh Entra login/callback/session live cơ bản trên Windows local (2026-10-02):
      chủ dự án báo browser login thành công; đọc DB riêng xác nhận một user đúng tenant,
      active, một session còn hạn, không admin và không WO grants. Không đọc/in token/secret.
      Cập nhật tài liệu trạng thái; diff/link qua. Chưa kiểm thử logout/expiry, chính sách
      tenant/MFA hoặc staging; không đánh dấu nghiệm thu Entra tổng thể hoàn tất.
- [x] Ghi nhận logout/login lại local được chủ dự án xác nhận đúng (2026-10-02).
      Đọc DB hiện tại: một session còn hạn, không WO grants và chưa có Maximo connection.
      Chuẩn bị intake connection/discipline/capability cho tài khoản test; diff/link qua.
      Chưa cấp quyền hoặc gọi Maximo; cookie cũ/expiry/Conditional Access chưa kiểm chứng riêng.
- [x] Chốt phạm vi khởi đầu Onshore test + chỉ xem (`read`) với chủ dự án (2026-10-02).
      Ghi trong integration intake, đối chiếu field discipline `bdpocdiscipline` theo reader;
      diff/link tài liệu qua. Chưa nhận mã discipline/timezone/API key hoặc xác minh OSLC URL;
      chưa tạo connection/grant hoặc gọi Maximo thật.
- [x] Nhận danh mục discipline từ ảnh Value/Description và xác nhận timezone
      `Asia/Ho_Chi_Minh`, chủ dự án có API key test (2026-10-02).
      Chuẩn bị registry Onshore test được comment/empty key trong `.env` Git ignore;
      không sửa Entra credential, không thêm dependency. Diff/link và ignore qua.
      Chưa chọn discipline của tài khoản, chưa nạp key hoặc tạo connection/grants;
      collection/status domain vẫn là tham chiếu, chưa kiểm thử API Maximo live.
- [x] Kiểm tra lại `.env` theo phản hồi chủ dự án (2026-10-02): dòng Maximo không còn
      trên đĩa; thêm lại registry comment với UUID đã chuẩn bị và key rỗng, xác minh dòng 10.
      Giữ nguyên cấu hình Entra; mở editor tại dòng 10. Diff tài liệu và Git ignore qua.
      Chưa bật registry, nhận key hoặc cấp grants.
- [x] Chủ dự án nhập API key test và bật dòng WOS_MAXIMO (2026-10-02).
      Settings validation qua: đúng URL Onshore test, key không rỗng, HTTP opt-in và
      development, Entra config còn đủ; không in key. Diff tài liệu qua.
      Chưa restart backend nạp registry, chưa chốt discipline/tạo connection/grants,
      chưa xác minh API key bằng request Maximo thật.
- [x] Quyền Onshore test từ PERSON theo yêu cầu chủ dự án (2026-10-02): signed Entra
      preferred_username bỏ domain `biendongpoc.vn` để lookup mxperson.ct_discipline;
      tenant/object ID vẫn là identity, binding unique theo connection; read-only và audit.
      Recheck nguồn quyền trước/sau WO/detail/draft, revoke/fail closed khi lookup lỗi/null;
      không nhận personid/discipline quyền từ browser. Migration 0005 + connection local có audit.
      186 backend tests (129 fast + 57 PostgreSQL), Ruff lint/format, migration/schema check ở
      DB test và local SSO qua; restart backend, HTTPS readiness 200; diff/link qua.
      GET mxperson thật 200: duongvq→E&I; nhatnh→NHATNH, ct_discipline trống. API key đã
      được dùng chỉ server-side trong GET, không mutation. Không thêm dependency.
      Cần Maximo điền ct_discipline của NHATNH và re-login để lưu signed locator;
      chưa cấp grant, chưa WO retrieve/browser E2E, chưa kiểm thử tải hoặc quản trị remap.
      Hướng dẫn: [PERSON access](person-access.md).
- [x] Kiểm chứng login → PERSON → quyền E&I trên giao diện (2026-10-02): chủ dự án
      cập nhật NHATNH.ct_discipline=E&I và re-login; đọc DB local xác nhận signed login
      nhatnh@biendongpoc.vn, binding nhatnh, đúng một E&I/read grant, không admin và audit
      connection_created/person_binding/person_grants. Diff/link tài liệu qua.
      Chưa WO retrieve thật, status/date/crew contract hoặc E2E nháp/upload; không chạy lại
      suite vì chỉ ghi nhận kết quả live và thay đổi tài liệu.

Phụ thuộc: 2, 3; app registration từ IT.

- [x] Nhận tenant/client ID, client secret server-side và callback HTTPS localhost;
      login/callback/session thật qua (2026-10-02). Logout hiện chỉ kết thúc phiên ứng dụng.
- [ ] Chốt nhóm/người được đăng nhập, expiry/rotation credential và URI logout/staging với IT.
- [x] Chủ dự án đã tạo app registration và cấu hình callback local hoạt động (2026-10-02).
- [ ] Đối chiếu single-tenant/Web, assignment và chính sách tenant trên portal cùng IT.
- [x] Triển khai login/callback/logout bằng MSAL + PyJWT; state/nonce/PKCE và JWT validation.
- [x] Xác minh login/callback/session thật và local HTTPS tin cậy; chủ dự án xác nhận
      logout/login lại (2026-10-02).
- [ ] Nghiệm thu MFA/Conditional Access, blocked account, cookie cũ/expiry live và TLS/proxy staging với IT.
- [x] Session server-side, expiry, Secure/HttpOnly cookie và CSRF logout (2026-09-29).
- [x] CSRF cho mọi API mutation hiện có: logout, nháp đơn/nhóm, delete, Planner admin,
      Settings; backend/frontend tests qua (2026-10-07). Upload tương lai phải áp cùng policy.
- [x] Ánh xạ identity theo tenant ID + object ID; user mới không có WO grants/admin.
- [x] Viewer read/Planner write/Admin configuration theo policy server; PlannerPermission
      intersect PERSON discipline (0006), không nhận role/discipline quyền từ client.
- [x] Admin không bypass WO grants; test admin không grant bị từ chối (2026-10-07).
- [x] Bootstrap first-admin có dry-run/execute, stable identity/tenant, serialize và audit
      append-only 0008; chủ dự án chọn bản thân và cấp local có audit (2026-10-07), không thêm WO grants.
- [ ] IT duyệt operator/authority workflow và nghiệm thu bootstrap trên staging.
- [x] Một identity chủ dự án có Planner Onshore test/E&I, cấp/thu hồi live có audit (2026-10-02).
- [ ] Nhận/duyệt roster planner/grants cho các người dùng, discipline và hệ thống còn lại.
- [x] Shared checks session/PERSON/configured connection/grants cho list/detail/PIC,
      nháp đơn/nhóm, markers và counts hiện có; kiểm tra lại sau I/O/trước lưu.
- [ ] Áp policy đúng scope cho history/upload/job status khi xây các API này; hiện chưa có endpoint.
- [x] Guessed IDs/out-of-scope/owner mismatch bị từ chối không trả nội dung WO/nháp;
      backend PostgreSQL + HTTP mocks qua (2026-10-07).
- [x] Thu hồi grant/PERSON đổi discipline/WO chuyển scope được recheck fail closed;
      UI xóa cache theo actor/scope hoặc ẩn nội dung khi xác minh lỗi; tests qua (2026-10-07).
- [x] Authorization audit cho connection/PERSON binding/grants và Planner changes;
      actor/before/after/reason/source cùng transaction, append-only (0005/0006).
- [x] Tests synthetic phiên hết hạn, sai tenant, scope giả, guessed IDs, revoked grants
      và revocation giữa network I/O qua (2026-10-07); không thay nghiệm thu tenant live.

Nghiệm thu: planner discipline A không đọc hoặc sửa dữ liệu B qua UI, direct API, draft,
history hay upload; quyền Onshore không tự cấp quyền Offshore.

## 5. P0 — Connector và retrieve WO

Phụ thuộc: 1, 2, 4; có thể phát triển trước bằng fixtures.

- [x] Registry runtime theo connection UUID, timeout riêng; metadata/nhãn từ DB.
- [x] Registry/grants thật Onshore test/E&I, connection audit, Planner API/CLI có audit;
      Settings chọn connection đã được cấp quyền (2026-10-02/06).
- [x] UI `/admin` xem roster/connection đã cấu hình và cấp/thu hồi scoped Planner
      có audit/CSRF/session recheck; synthetic tests qua (2026-10-07).
- [ ] UI cấu hình connection/identity lifecycle và mở rộng registry/scopes ngoài Onshore E&I;
      Planner UI không sửa URL/secret/authority hoặc tạo roster chưa duyệt.
- [x] Cài HTTP client với header API key, TLS verification và log đã redaction.
- [x] Áp scope server-side; encode filter values, không nối raw query từ người dùng.
- [x] Map trường VBA: progress, discipline, wonum, description, worktype, location, system,
      dates, status, priority, lead, PIC, duration và workorder ID.
- [x] Lấy siteid/workorderid và kiểm tra identity khi phân trang.
- [ ] Lấy và xác minh revision/ETag cần cho cập nhật an toàn.
- [x] Xử lý optional values và lỗi response có kiểm soát.
- [x] Lấy đủ các trang; chỉ theo links thuộc trusted connection.
- [x] Filter target date có offset, status domain cấu hình và discipline được cấp quyền.
- [x] Tìm kiếm WO/mô tả/Tag Name và lọc status trong tập WO đã tải (2026-10-02);
      timezone/range Onshore test đã xác nhận, server search/paging UI chưa triển khai.
- [x] Lấy crew/PIC theo mapping server; đọc đủ child pages với bounds/identity checks,
      25 PIC E&I_N live và synthetic tests qua (2026-10-02/07).
- [ ] Nghiệm thu crew/PIC các discipline khác/Offshore và child paging lớn trên test.
- [x] Xử lý upstream unavailable/API key hết hiệu lực, không trả stale data ngoài quyền.
- [ ] Đối chiếu tập WO web/VBA với cùng hệ thống, bộ lọc và thời điểm trên test.

Nghiệm thu: kết quả đủ trang và đúng scope; hai hệ thống có WO trùng số vẫn tách biệt;
lỗi upstream không bị hiển thị thành danh sách rỗng thành công.

## 6. P0 — Bảng lập lịch và lưu nháp

Phụ thuộc: 3, 4, 5; có thể dựng UI với fixture trước.

- [x] Layout desktop bảng gọn/panel đơn/nhóm, nhãn scope/system/environment, phiên,
      bộ lọc từ grant server; viewport desktop/hẹp đã kiểm tra live (2026-10-05/07).
- [x] Chọn native HTML table + panel theo thiết kế chủ dự án duyệt; sửa ô/paste/Undo,
      synthetic chọn/lọc 100 WO và live retrieve 117 WO (2026-10-05/07).
- [x] Kiểm thử synthetic nhóm 100/200 WO: sửa nhóm/ngoại lệ, paste lỗi/hợp lệ, Undo/reset,
      preview/lưu/mở lại và stale/version/revoked/delayed responses (2026-10-07).
      Chromium local có số đo thao tác; [bằng chứng/phạm vi](large-batch-keyboard-tests.md).
- [ ] Nghiệm thu monthly-load live, độ trễ Maximo và 10 planner; chưa có performance SLO
      được chốt. Chưa cần thêm grid dependency theo kiểm tra synthetic hiện có.
- [x] Dữ liệu nghiệp vụ tương đương workbook được map vào bảng 7 cột + panel 17 field
      theo thiết kế đã duyệt; discipline ở scope, System ID/WOID giữ nội bộ, không tái tạo 21 cột nguyên mẫu.
- [x] Sửa Start/PIC/Duration; Finish read-only tính Start + giờ duration khi Start/Duration
      thay đổi, editor đơn và nhóm (2026-10-05/07). Không tự viết lại lịch khi chỉ sửa PIC.
- [x] Cho chọn đổi target; khóa PM/CFT và giải thích tại editor (2026-10-01).
- [x] Áp Scheduled Start/PIC/Duration cho dòng chọn, giữ ngoại lệ từng WO/Undo/paste;
      server validate từng WO và lưu toàn nhóm trong một transaction (2026-10-05/07).
- [x] Modified fields/reset/before-after preview đơn và nhóm; cần preview trước lưu nhóm.
- [x] Date input/display/serialization theo timezone connection đã chốt Onshore;
      tests offset/calendar/fractional duration/cross-midnight qua (2026-10-07).
- [x] Lưu/restore/update/delete nháp đơn/nhóm theo owner + scope, tối đa 200 WO;
      baseline/version/duplicate receipt kiểm tra trên server, nháp không ghi Maximo.
- [x] Bảo vệ edits khi đổi filter/hệ thống; không hiển thị nhầm dữ liệu connection cũ (2026-10-01).
- [x] Validate cả frontend và backend; backend là nguồn quyết định (2026-10-01).
- [x] Controls có labels/status/alert và panel focus/Escape; UI tests labels,
      loading/empty/error, giữ edits khi lỗi và session rechecks qua (2026-10-07).
- [x] Chromium synthetic xác minh Tab/Shift+Tab/Enter/Escape/Space, vòng Tab và focus return
      cho panel đơn/nhóm/chooser; giữ edits qua Settings, radio ArrowDown/Tab/Enter qua.
      Sửa focus sau Save và khóa lưu sau version conflict; 151 frontend tests qua (2026-10-07).
- [ ] Nghiệm thu keyboard-only toàn ứng dụng, screen reader/zoom/high contrast và browser khác;
      các mốc focus trong harness không thay thế toàn bộ accessibility UAT.

Nghiệm thu: thao tác giống bảng Excel, nháp không thay đổi Maximo; khôi phục nháp không vượt
scope hiện tại; preview phản ánh chính xác payload sẽ gửi.

## 7. P0 — Upload, audit và phục hồi

Phụ thuộc: 1, 3, 4, 5, 6.

Đánh giá sẵn sàng 2026-10-08: có thể bắt đầu thiết kế API, orchestration/audit,
source draft/version linkage, recovery và tests với Maximo giả; chưa mở sender thật.
Bằng chứng hiện có: nháp đơn/nhóm và quyền scoped, audit/state persistence, diễn tập
backup/restore synthetic đã kiểm chứng. GET Onshore test trả ETag `0`; conditional
write, token advance/stale rejection/concurrency và write/read-back semantics chưa
được chứng minh; xem [write contract](maximo-write-contract.md). Đây là đánh giá
phụ thuộc từ mã/tài liệu hiện tại, không phải kiểm thử mới hoặc hoàn thành P7.

Mốc đầu P7 triển khai ngày 2026-10-08: API preview/submit gate/status và dịch vụ
orchestration nội bộ có tests synthetic; [hợp đồng và giới hạn](upload-workflow.md).
Các checkbox end-to-end bên dưới vẫn mở vì chưa có sender/conditional contract thật,
worker lifecycle hoặc UI tiến độ/history. UI preview được bổ sung trong mốc tiếp
ngày 2026-10-08; không dùng evidence mock để tick remote upload.

- [x] Preview từ nháp owned/scoped, version và 1–200 thành viên chọn; đọc lại WO/PIC,
      dựng before/changes bằng allowlist server, kiểm tra baseline/PM/CFT/intent/date/PIC.
- [x] Submit API xác minh CSRF/source/preview hash rồi trả 409 write_contract_unverified;
      không tạo batch hoặc gọi writer. Status API kiểm tra owner và current WO scope.
- [x] Dịch vụ nội bộ với transport giả: hash/idempotency, unique reservation WO,
      prepared source draft/version/member + immutable before/changes/membership hash,
      commit intent trước send, per-item results, read-back và explicit reconciliation.
- [x] Finalizer nội bộ chỉ xóa nguồn unchanged/full selection/all confirmed sau
      read-back; partial/unknown/conflict/nháp mới hơn giữ lại, thêm audit source_finalized.
      Chưa nối finalizer vào app hoặc worker; không tự xóa nháp thật.

Bằng chứng mốc đầu: 38 tests P7 (9 fast + 29 PostgreSQL) qua; full backend 406 tests
qua ngày 2026-10-08 trên Python 3.12.14/Windows với PostgreSQL test riêng. Concurrent
duplicate/overlapping actors/send và intent visibility dùng connection độc lập,
commit thật trong UUID schema tạm có constraints/audit trigger, đã dọn sau test.
Bao phủ DB intent failure không send, cancellation→recovery unknown, normalized
date/Decimal read-back, mixed outcomes và finalizer/replay sau xóa nguồn.
Reviewer Sol/high một lượt không có P1/critical; P2 status dùng reader scheduling
đã sửa, Main kiểm tra code và regression WO đóng/crew unavailable/current scope.
Ruff lint/format, docs links/placeholders và git diff --check qua. Full suite sandbox
ban đầu vướng Windows temp ACL/Docker pipe ở tests cũ; chạy lại với quyền phù hợp
thì toàn bộ qua. Không thêm dependency/migration, không đổi frontend, không gọi
Maximo/Entra thật, migrate DB app, deploy, commit hoặc push. Conditional write,
transport thật, worker lease/retry attempt links/correlation logs, UI upload/history,
crash durability live và nghiệm thu staging vẫn mở.

Mốc UI preview tiếp tục ngày 2026-10-08:

- [x] Nháp đơn/nhóm đã lưu có nút đối chiếu trước upload gọi API scoped với đúng
      version và danh sách thành viên; khóa khi có sửa chưa lưu/blocked/suspended.
      Nhóm dùng toàn bộ thành viên đã lưu; không thêm chọn subset riêng cho upload.
- [x] Hiển thị WONUM, trước/sau từng trường và kết quả xung đột/không hợp lệ kể cả
      khi backend không trả changed fields; context dùng connection/system/environment
      từ grant. Ngày theo timezone kết nối, giữ quyết định ẩn nhãn timezone/ID/hash.
- [x] Parser kiểm tra phiên bản/hash/gate false, exact member set/unique identity,
      allowlist, aware dates và finite nonnegative duration (kể cả scientific Decimal).
      Request dùng cookie/CSRF hiện có; không gọi submit hoặc tạo batch giả.
- [x] Preview unmount/abort khi edits/Undo/reset/save/delete/busy, đổi scope/version/
      baseline/PIC/verification context, suspend/hide/đóng panel; late response bỏ qua.
      Route-away chỉ hủy preview, không đổi behavior mutation/cache workspace hiện có.
      Recoverable error giữ nháp; 401/403/404 gọi luồng kiểm tra quyền hiện có.
- [x] Frontend 167 tests/16 files, ESLint, TypeScript và production build qua;
      Main rà API contract, conflict-empty rows, lifecycle/abort và integration props.
      Sau chỉnh wording sản phẩm, Main chạy lại 33 tests editor đơn/nhóm và typecheck
      qua; Vite tests cần quyền child-process Windows, không phải lỗi ứng dụng.
      Docs links/placeholders/diff check qua; không thêm dependency hoặc đổi backend.

Giới hạn UI: tests dùng React/HTTP mocks, chưa kiểm chứng browser/live preview mới,
keyboard/a11y toàn luồng hoặc nhóm 200-WO live. Upload luôn khóa; chưa có sender,
UI tiến độ/kết quả/history, submit live hoặc E2E ghi Maximo. Không gọi Maximo/Entra
thật, thay nháp thật, deploy, commit hoặc push trong mốc UI này. Không chạy lại
406 backend tests đã qua vì backend không đổi; bằng chứng backend ở mốc trên.

- [ ] Tạo endpoint preview/submit với allowlist field và typed validation.
- [ ] Re-read từng WO; kiểm tra scope, worktype, baseline và revision trước write.
- [ ] Chặn target PM/CFT ngay cả khi gửi request thủ công.
- [ ] Kiểm chứng PIC, duration, date order và clear semantics theo hợp đồng đã chốt.
- [ ] Gửi chỉ các thay đổi được chọn; không ghi đè trường không chỉnh sửa.
- [ ] Tạo durable audit intent trước request; DB lỗi thì không gửi write.
- [ ] Dùng conditional update đã kiểm chứng; nếu không có, ghi hạn chế/race và chốt phương án
      trước production, không gọi read-before-write là bảo đảm nguyên tử.
- [ ] Deduplicate submit lặp, khóa/tuần tự hóa WO trong ứng dụng và giới hạn request song song.
- [ ] Xử lý kết quả từng WO: confirmed, failed, conflict, unknown; batch có thể thành công một phần.
- [ ] Read-back và normalize kết quả sau upstream success.
- [ ] Đối soát timeout/mất mạng sau send; không blind retry.
- [ ] Phục hồi attempt khi backend restart hoặc DB lưu kết quả thất bại sau upstream write.
- [ ] Cho retry có kiểm tra lại đối với lỗi đã xác định; giữ liên kết các attempts trong audit.
- [x] Màn hình tiến độ/kết quả từng batch đã có (mốc P7 ngày 2026-10-08).
- [ ] **Phase 2 — theo quyết định 2026-10-10:** màn hình/API lịch sử upload/audit
      tổng thể, filters/paging và before/after đúng scope. Ưu tiên hiện tại là
      hoàn thiện chức năng lập lịch chính; chưa triển khai phần lịch sử ở phase 1.
- [ ] Redact response lỗi và log; tránh lộ WO ngoài quyền qua thông báo.

Nghiệm thu: không có upload thiếu actor/audit intent; mixed batch có kết quả đúng từng dòng;
double-click/restart không gây gửi lại mù; unknown luôn phân biệt với failed/confirmed.

## 8. P0 — Kiểm thử tổng thể và UAT

Phụ thuộc: 4–7; test Maximo và users theo discipline.

- [ ] Unit tests cho PM/CFT, allowlist, duration và ngày/giờ.
- [ ] Integration tests cho grants, các scoped endpoints và migration trên PostgreSQL.
- [ ] Contract tests cho pagination, null fields, Maximo errors và payload serialization.
- [ ] Test timezone UTC+07 theo cấu hình được xác nhận, cuối ngày/tháng và ngày không hợp lệ.
- [ ] Test cùng WONUM/workorderid ở hai connection và các site.
- [ ] Test WO đổi discipline, user bị thu hồi quyền khi đang giữ draft.
- [ ] Test stale baseline/ETag; hai planner sửa cùng WO; người sửa trực tiếp trên Maximo.
- [ ] Test CSRF, session expiry, sai tenant và client giả mạo field/scope.
- [ ] Test mixed batch, timeout trước/sau send, duplicate submission và restart recovery.
- [ ] Kiểm tra frontend build/log/fixtures không có key hoặc token.
- [ ] Chạy E2E login → retrieve → draft → preview → upload → read-back → history.
- [x] Kiểm thử synthetic10 phiên API đồng thời, nháp/nhóm200WO, latency và lỗi
      vận hành thật qua Linux Uvicorn/PostgreSQL (2026-10-10):
      [báo cáo và giới hạn](ten-session-operational-rehearsal.md).
- [ ] Nghiệm thu10 planner/browser với Entra/Maximo/Ubuntu staging thực và SLO
      được duyệt; synthetic API không thay kiểm thử này.
- [ ] Cùng planner đối chiếu các trường cập nhật với VBA trên WO test được chỉ định.
- [ ] Chủ dự án nghiệm thu kết quả và các hạn chế còn lại; ghi biên bản UAT.

Nghiệm thu: các invariants trong architecture.md có bằng chứng kiểm thử; mọi sai lệch so với
VBA đã giải thích, đặc biệt bộ lọc ngày, PIC và target.

## 9. P0 — Docker, staging và vận hành production

Phụ thuộc: 2–8; DNS/TLS, credentials và chính sách vận hành từ IT.

- [x] Dockerfiles và Compose local cho frontend/reverse proxy, backend và PostgreSQL;
      build/smoke Linux có bằng chứng ngày 07/10; đối chiếu source ngày 09/10.
- [x] Base images pin digest, DB/backend healthchecks, restart policy service dài hạn
      và persistent DB volume trong Compose local; chưa nghiệm thu Ubuntu staging.
- [ ] Hoàn thiện cấu hình staging/production, HTTPS ingress và release images ứng dụng.
- [x] Chuẩn bị mẫu staging/HTTPS/env riêng và runbook deploy/upgrade/rollback
      (2026-10-09); [phạm vi và giới hạn](staging-deployment.md). Chưa deploy Ubuntu.
- [x] Deadline chung WO read/local draft handlers, cancellation/drain và rollback
      synthetic PostgreSQL (2026-10-09); timeout504/no-store và UI giữ phần sửa/
      request ID. Nghiệm thu Ubuntu/upstream thật còn mở.
- [x] Rà cấu hình/công cụ deployment và backup/restore trong repo (2026-10-09):
      [findings, tiêu chí nghiệm thu và phụ thuộc IT](deployment-readiness-review.md).
      Compose config qua với biến DB giả; không deploy hay chạy backup DB vận hành.
- [ ] Chỉ expose HTTPS proxy; DB/backend không mở trực tiếp ra mạng ngoài nếu không cần.
- [ ] Cấu hình DNS/certificate/CA và kiểm tra đường mạng browser/server → Entra/Maximo.
- [ ] Tách cấu hình/secret test và production; không có fallback sang production.
- [ ] Thực hiện migration một cách có kiểm soát khi deploy.
- [x] Diễn tập backup/restore PostgreSQL cô lập bằng dữ liệu synthetic, kiểm tra
      nháp/receipts/audit/schema/ACL và unknown recovery (2026-10-08);
      [phạm vi và bằng chứng](database-operations.md#diễn-tập-cô-lập-bằng-dữ-liệu-synthetic).
- [ ] Chốt và triển khai backup staging: RPO/RTO, encryption/offsite/retention,
      roles/secret recovery và diễn tập restore trên hạ tầng Ubuntu thật.
- [ ] Log có correlation ID, theo dõi lỗi upstream, unknown attempts và dung lượng DB.
- [ ] Viết runbook deploy/update/rollback, credential rotation và xử lý upload chưa rõ kết quả.
- [ ] Chuẩn bị integration accounts riêng cho hệ thống đích và grants người dùng.
- [ ] Xem xét thay key workbook khi chuyển đổi; phối hợp thời điểm để không làm gián đoạn Excel.
- [ ] Triển khai staging, nghiệm thu xong mới xác nhận thời điểm chuyển production.
- [ ] Deploy production theo quyết định rollout của chủ dự án; kiểm tra read-only trước,
      sau đó upload một WO được chọn và theo dõi.
- [ ] Bàn giao hướng dẫn planner/admin và đầu mối hỗ trợ.

Nghiệm thu: có HTTPS, backup khôi phục được, secret tách môi trường, UAT hoàn tất và runbook
thực hiện được. Kế hoạch này không đồng nghĩa đã deploy hoặc được phép ghi production ngay.

## 10. P1 — Chức năng còn lại của workbook

Phụ thuộc: bản đầu ổn định; chốt phạm vi với chủ dự án.

- [ ] Scheduled WO: filter theo schedule, status và scope.
- [ ] Crew Worksheet: giờ theo WO/PIC; đối chiếu công thức và header nhân sự.
- [ ] Summary of Crew Worksheet: tổng hợp theo người trong phạm vi được phép.
- [ ] In Progress/Completed: actual hours và planning efficiency; xử lý estdur=0.
- [ ] Chốt định nghĩa compliance trước khi tái tạo chỉ số của Excel.
- [ ] Export Excel/CSV có scope và bảo vệ nội dung công thức khi mở trong spreadsheet.
- [ ] Đánh giá lịch/Gantt nếu planner cần; không đưa vào bản đầu mặc định.

## Thứ tự bắt đầu

1. Hoàn thành scaffolding, DB và mock contracts (2–3) trong khi thu thập mục 1 và Entra.
2. Làm SSO/scope và connector read-only (4–5).
3. Hoàn thiện bảng và nháp (6).
4. Upload có audit/conflict/recovery (7).
5. Kiểm thử/UAT và triển khai có kiểm soát (8–9).

Mục 2 đã có nền tảng; mục 3 đã có migration session/draft/upload/audit và PostgreSQL tests.
Bảng /demo là preview tạm với dữ liệu giả, không đánh dấu mục 6 hay 7 là hoàn thành.
PostgreSQL test riêng đã chạy trong Docker; full application Compose chưa build/run.

Cập nhật preview 2026-09-25: đã đối chiếu 21 cột Excel, thêm PIC/duration, Upload? và
Change Target?, preview theo dòng chọn. Mục 6 vẫn chưa hoàn thành vì chưa có dữ liệu thật/lưu nháp.

Bằng chứng 2026-09-29: 35 backend tests qua, trong đó 5 PostgreSQL scenarios kiểm tra
session/logout/CSRF, revoked grants, admin không bypass, draft owner và discipline đổi,
connection/site identity, duplicate upload, sending recovery và audit append-only.
Migration upgrade/downgrade/upgrade + schema check qua. Không thay thế UAT hoặc Maximo tests.
Xem [hướng dẫn kiểm thử](database-tests.md) và [trạng thái](implementation-status.md).

SSO 2026-09-29: đã có UI login/logout/session, schema flow một lần, cookie binding và expiry.
60 backend + 8 frontend tests qua; lint/typecheck/build qua. Tests không gọi tenant thật.
Xem [entra-setup.md](entra-setup.md); login chưa bật vì chưa có app registration/HTTPS.

Reader 2026-09-29: các mục connector đã tích được kiểm tra với HTTP giả và PostgreSQL thật,
không phải bằng chứng tương thích Maximo nội bộ. 109 backend tests và Ruff qua.
Chưa nối UI, crew/detail, revision hoặc upload. Xem [Maximo reader](maximo-reader.md).

## Giao diện retrieve — 2026-09-30

- [x] Route /work-orders gọi API thật theo session/grants; chỉ đọc.
- [x] Hiển thị hệ thống/môi trường/discipline, 21 cột Excel và Site.
- [x] Bộ chọn lịch cho hai ô lọc Target Finish (2026-10-02); chuyển ngày thành ISO có offset
      lúc 00:00 theo timezone connection do backend cung cấp, không dùng timezone trình duyệt.
- [x] Hủy request và bỏ phản hồi cũ khi đổi scope/filter, rời trang hoặc kiểm tra lại phiên.
- [x] Phân biệt loading, empty, error, chưa đăng nhập và chưa có quyền.
- [x] 18 frontend tests, typecheck, lint và production build qua.
- [ ] Kiểm thử live login/retrieve và desktop UI với dữ liệu Maximo test.
- [x] API chi tiết WO, crew/PIC với synthetic tests (2026-09-30).
- [ ] Revision/ETag đã xác minh trên Maximo test.

Bảng chỉ giữ dữ liệu trong RAM; kiểm tra lại phiên mỗi phút khi không đang retrieve,
khi quay lại cửa sổ và khi tab hiện lại. Hiện xóa bảng khi kiểm tra lại để tránh giữ scope cũ;
người dùng cần retrieve lại. Các kiểm thử frontend dùng mock, không thay thế kiểm thử backend.

## Detail/PIC/draft API — 2026-09-30

- [x] Scoped detail theo connection/site/WO; kiểm tra status/task/parent hiện tại.
- [x] Crew group mapping server-side và đọc PIC theo respparty; chặn response sai/incomplete.
- [x] POST draft có CSRF/write grant và baseline/PIC lấy từ server.
- [x] GET draft owner-only; kiểm tra scope hiện tại, báo baseline đổi và thay đổi không hợp lệ.
- [x] 129 backend tests, Ruff lint/format qua; PostgreSQL test đã chạy.
- [ ] Xác minh crew relationship, child paging và field identity trên Maximo test.
- [x] Thêm precondition stale-edit và UI chỉnh sửa/lưu/mở nháp một WO (2026-10-01).
- [x] List/update/delete draft, version checks và durable duplicate submission (2026-10-01).
- [ ] Revision/ETag và điều kiện upload đã xác minh trên Maximo test.

API nháp đã nối UI ngày 2026-10-01; không có mutation Maximo. Xem [hợp đồng nháp](drafts.md) cho giới hạn.


## Hoàn thiện nháp và editor — 2026-10-01

- [x] Baseline token từ detail và so sánh fresh WO khi tạo/cập nhật nháp; stale edit trả 409.
- [x] API list/update/delete; owner + grants + upstream checks, version lock và CSRF.
- [x] Durable receipts cho duplicate create/update; giữ receipt sau xóa, không tạo lại nháp đã xóa.
- [x] Kiểm thử PostgreSQL đồng thời: create trùng thành một nháp, update cùng version chỉ một thành công.
- [x] UI editor một WO, PIC crew, lịch/duration, target có intent, PM/CFT lock và before/after/reset.
- [x] Lưu/mở/cập nhật/xóa nháp từ /work-orders; lỗi lưu giữ edits và retry cùng request ID.
- [x] Bảo vệ đổi filter/system; recheck session + WO trước hiện lại edits; mất quyền/phiên xóa dữ liệu.
- [x] Chặn ngày lịch không tồn tại và nhận diện duration/offset khác cách viết nhưng cùng giá trị.
- [x] 131 backend tests, 46 frontend tests, Ruff/TypeScript/ESLint/build và Alembic schema check qua.
- [ ] Browser E2E và kiểm chứng Maximo/Entra thật.
- [ ] Chặn navigation Back trong SPA; sửa/paste/áp ngày nhiều dòng và nháp nhiều WO.
- [ ] Chốt retention/cleanup cho draft_submission và nháp với IT.

Không đánh dấu mục 6 hoặc UAT hoàn tất: UI hiện dùng editor từng WO, chưa phải grid chỉnh sửa
nhiều dòng. Không có remote mutation; baseline token không thay thế conditional write của Maximo.
Hợp đồng và hướng dẫn: [drafts.md](drafts.md).

## Theo dõi hoàn tất task — 2026-10-01

- [x] Commit/push phần hoàn thiện nháp và kiểm thử lên origin/main: 82900f3;
      đã xác minh HEAD bằng origin/main và working tree sạch sau push.
- [x] Ghi quy tắc bắt buộc cập nhật docs/todos.md sau mỗi task hoàn tất trong AGENTS.md;
      cập nhật ngày, phạm vi, bằng chứng kiểm tra và giới hạn; kèm TODO trong commit của task.

Kiểm tra thay đổi tài liệu: liên kết nội bộ và git diff --check qua; không cần chạy lại application tests.


## HTTP riêng cho Maximo test — 2026-10-01

- [x] Ghi nhận Onshore test /maximo, không VPN, chưa cài chứng chỉ; chủ dự án cho phép HTTP cho test.
- [x] Thêm allow_http_for_test mặc định false; HTTP cần opt-in boolean trong registry.
- [x] Guard chung cho list/detail/PIC/draft: URL khớp metadata, connection test, ứng dụng không production.
- [x] Chặn HTTP khi connection/app production; kiểm tra lại metadata sau retrieve; giữ HTTPS/Entra/TLS rules.
- [x] 107 fast + 40 PostgreSQL tests qua (147 tổng), Ruff lint/format qua; không thêm dependency/migration.
- [ ] Nhận credential/API key test qua kênh bảo mật, grants/timezone/crew và WO được chỉ định.
- [ ] Kiểm chứng OSLC authentication/object structures và hợp đồng thật; routing từ Ubuntu.

HTTP opt-in không chứng minh API thật đã hoạt động. Kiểm tra mạng hiện mới DNS/HEAD root từ
Windows; không gửi credential hoặc mutation. Xem [thu thập thông tin](integration-intake.md)
và [cấu hình reader](maximo-reader.md).

## Bộ chọn lịch Target Finish — 2026-10-02

- [x] Hai ô Target Finish từ/trước dùng date input với nút mở lịch của trình duyệt.
- [x] Session API trả timezone connection; ngày chọn chuyển thành midnight có offset tương ứng.
- [x] Giữ khoảng lọc bao gồm ngày đầu, loại trừ 00:00 ngày cuối; hướng dẫn chọn ngày kế tiếp
      để lấy trọn ngày cuối mong muốn.
- [x] 49 frontend tests, TypeScript, ESLint và build qua; 5 PostgreSQL session tests và Ruff qua.
      Có kiểm thử UTC+07, offset 45 phút, DST, ngày không tồn tại và midnight không duy nhất.
- [x] Kiểm tra browser Windows local: cả hai ô hiển thị biểu tượng lịch và accessibility
      có nút Show date picker; quyền Onshore test E&I vẫn xuất hiện.

Không thêm dependency. Chưa kiểm chứng retrieve WO thật hoặc upload Maximo trong task này.

## Sửa lỗi query status khi retrieve — 2026-10-02

- [x] Xác định Onshore test trả HTTP 400/BMXAA8744E vì khoảng trắng sau dấu phẩy
      trong danh sách `status in [...]`; serialize danh sách gọn, giữ nguyên các điều kiện scope.
- [x] GET live với E&I từ 01/09/2026 đến trước 03/09/2026 qua reader trả một WO,
      đã kiểm tra scope và mapping; không có mutation Maximo.
- [x] 39 reader tests và Ruff qua; thêm assertion cho cú pháp status không có khoảng trắng.
- [x] Backend localhost đã restart; browser hiển thị 3 WO E&I cho khoảng từ 01/09/2026
      đến trước 30/09/2026 do người dùng chọn, không còn lỗi retrieve.

Kết quả chỉ chứng minh khoảng lọc này trên Onshore test; paging lớn, detail/PIC và uploads
vẫn cần kiểm chứng riêng.

## Sửa mở chi tiết WO và đọc crew/PIC — 2026-10-02

- [x] Xác định detail WO đọc được nhưng crew_groups chưa cấu hình; thêm mapping Onshore
      theo công thức Excel do chủ dự án cung cấp, E&I → E&I_N (các mã khác xem maximo-reader.md).
- [x] Detail thiếu mapping vẫn xem WO, trả pics_configured=false và khóa editor; draft
      operations vẫn bắt buộc xác minh crew, không thay đổi quyền read thành write.
- [x] Đọc collection child PIC có bounds/paging và identity localref; dựng URL từ path
      kiểm tra trên origin test, không gửi credential tới hostname khác được Maximo quảng bá.
- [x] Live E&I_N trả 25 PIC; browser mở P13457392/BD1 hiển thị ngày/duration/PIC,
      các control sửa/lưu vẫn disabled với quyền read.
- [x] 70 backend tests (reader/detail + PostgreSQL draft), 50 frontend tests qua;
      Ruff, TypeScript, ESLint và build qua. Không thêm dependency hoặc migration.

Chưa kiểm chứng crew các discipline khác, child paging lớn, lưu nháp live hoặc uploads.

## Tìm kiếm và lọc bảng WO — 2026-10-02

- [x] Tìm không phân biệt hoa/thường theo WONUM, mô tả hoặc Tag Name trong tập đã retrieve.
- [x] Lọc status từ dữ liệu đã tải, kết hợp với tìm kiếm; hiển thị số WO hiển thị/tổng đã tải.
- [x] Xóa bộ lọc để hiện lại toàn bộ; phân biệt không khớp bộ lọc với retrieve rỗng.
- [x] Đổi connection/ngày hoặc retrieve lại xóa bộ lọc và dữ liệu cũ; không mở rộng scope,
      không gọi thêm API khi gõ tìm kiếm và không làm mất nội dung editor khi lọc bảng.
- [x] Hiển thị rõ quyền Chỉ xem hoặc Có thể chỉnh sửa và lưu nháp theo grant hiện tại.
- [x] 52 frontend tests, TypeScript, ESLint và production build qua; không thêm dependency.
- [x] Browser local Onshore test: tìm `hvac` kết hợp status WMATL hiển thị đúng WO
      P13464295 trong tập 3 WO E&I đã tải; giữ nhãn Chỉ xem.

Bộ lọc chỉ áp dụng cho tập dữ liệu đã lấy thành công, không tìm toàn bộ Maximo.
Không thay đổi quyền tài khoản hoặc gọi mutation Maximo.

## Chuẩn bị commit/push các thay đổi local — 2026-10-02

- [x] Gom Entra HTTPS Windows, PERSON-derived read grants/audit/migration 0005,
      sửa OSLC status, đọc crew child/PIC, lịch Target Finish và lọc bảng WO.
- [x] Full backend suite 194 tests và Ruff lint/format qua; frontend 52 tests,
      TypeScript/ESLint/build qua. Các kiểm chứng live chỉ đọc Onshore test E&I.
- [x] Xác minh .env/credential DB/PFX được ignore; scan candidate source không chứa
      secret Entra, API key, password DB hoặc password PFX đang dùng.
- [x] Commit triển khai `4239159` đã push origin/main; xác minh HEAD bằng origin/main,
      không force push. GitHub connector xác nhận repository thuộc tài khoản đang kết nối.
      Ghi nhận kết quả trong commit tài liệu tiếp theo.

## Quyền Planner có audit và nháp live — 2026-10-02

- [x] Migration 0006: permission Planner riêng theo user + connection + discipline;
      PERSON quyết định scope hiện tại, chỉ cấp write khi permission khớp, không tự cấp admin.
- [x] API admin PUT /api/admin/planner-permissions có session/CSRF; CLI quản trị DB dùng
      tenant/object ID và lý do bắt buộc. Audit before/after/actor/target/source cùng transaction.
- [x] Thu hồi hạ grant về read ngay; user row lock chung với PERSON sync và final draft write.
      Không giữ draft lock trong network I/O; restore kiểm tra version lại để tránh dữ liệu trộn.
- [x] PostgreSQL + HTTP mock: admin/CSRF/scope, lifecycle draft, revoke giữa đọc WO,
      PERSON đổi discipline, expiry, stale baseline, PM/CFT. Full backend 210 tests qua.
- [x] Frontend 52 tests, TypeScript/ESLint/build; Ruff lint/format; migration/schema check
      trên DB test riêng và local SSO qua. Không thêm dependency.
- [x] Cấp Planner Onshore test/E&I cho identity chủ dự án đã đăng nhập, có audit;
      browser lưu nháp P13457392/BD1 với lịch/PIC/duration, mở lại đúng và cập nhật v2.
- [x] Thu hồi Planner live: browser chuyển Chỉ xem, editor và lưu bị khóa; đã cấp lại E&I.
- [x] Xóa nháp kiểm thử P13457392/BD1 v2 trên browser sau xác nhận của chủ dự án
      (2026-10-02). Danh sách không còn nháp này; truy vấn DB chỉ đọc xác nhận 0 DraftItem
      cho WO đó, hai nháp P13468351/P13468282 vẫn còn. Không gọi mutation Maximo.
      Cập nhật tài liệu, kiểm tra link và diff; không chạy lại application tests vì không sửa mã.

Chỉ GET Maximo; nháp nằm trong DB nội bộ. Scope live mới Onshore E&I; expiry/conflict/PM/CFT
dùng automated tests, chưa sửa dữ liệu Maximo để tạo lỗi giả. Chưa nghiệm thu tải 10 người,
Offshore, UI quản trị/bootstrap admin, upload hoặc ETag/conditional update. Không commit/push
trong task này. Hướng dẫn: [Planner access](planner-access.md).

## Đánh giá UI/UX danh sách WO — 2026-10-02

- [x] Xem browser local với khoảng Target Finish hiện tại (01/10 đến trước 30/10/2026),
      retrieve thành công 4 WO; đối chiếu WorkOrders.tsx, API columns và stylesheet.
      Bảng hiện có 22 cột, min-width 2950px; panel trình duyệt hẹp chỉ thấy vài cột đầu.
- [x] Đề xuất bảng mặc định 7 cột theo tác vụ: WO + Site/Type, công việc + Tag Name,
      Status + Priority, Scheduled Start/Finish, Target Finish, Assigned PIC, Est. Duration.
      Đưa discipline lên nhãn scope; Actual/System ID/WOID/Target Start/lead/progress vào chi tiết.
      Upload?/Change Target? thuộc luồng thao tác khi đã triển khai, không chiếm cột placeholder.
- [x] Tạo minh họa tương tác dữ liệu mẫu: bảng gọn + panel chi tiết và dòng mở rộng;
      đề xuất panel cho desktop, màn hình chi tiết cho viewport hẹp, cột tùy chọn khi cần.
      Kiểm tra cú pháp minh họa và diff tài liệu; không sửa app hoặc chạy lại application tests.
- [x] Triển khai bảng gọn và panel (2026-10-05); ngày theo timezone connection,
      bảo vệ nháp khi đổi WO/scope, focus panel và Escape đóng qua xác nhận bỏ sửa.
      Kiểm tra browser hẹp; nghiệm thu desktop/usability đầy đủ còn chờ.

Đề xuất này đã được triển khai ngày 2026-10-05; xem bằng chứng và giới hạn bên dưới.

## Đề xuất lập lịch hàng loạt — 2026-10-02

- [x] Chủ dự án chọn bảng gọn + panel; yêu cầu phương án scheduled/assign PIC cho hàng
      trăm WO mỗi tháng. Đối chiếu SAP Fiori mass editing: chọn nhiều dòng, sửa trong panel,
      giữ nguyên các trường không chủ động thay đổi; đây là đề xuất, chưa triển khai.
- [x] Đề xuất lọc theo tuần/thiết bị/chưa lập lịch/chưa PIC, chọn nhóm WO và panel áp lịch/PIC
      cho nhiều dòng; chỉnh ô trực tiếp và bàn phím cho các WO có giá trị khác nhau.
      Preview từng WO, undo trước lưu, nháp nhiều WO; chọn tất cả chỉ trong tập kết quả đã tải.
- [x] Triển khai backend/UI nháp nhiều WO (2026-10-05); validate scope,
      crew/PIC, ngày và baseline/version riêng từng WO, hiển thị lỗi theo dòng.
- [x] Kiểm thử synthetic 100/200 WO, sửa nhóm/ngoại lệ, paste/Undo/preview/save/restore,
      thu hồi quyền/stale/version/delayed responses và phím/focus Chromium (2026-10-07);
      [bằng chứng](large-batch-keyboard-tests.md). Upload/reconciliation vẫn là task riêng.

Nguồn thiết kế: [SAP Fiori Mass Editing](https://www.sap.com/design-system/fiori-design-web/v1-84/foundations/best-practices/global-patterns/object-handling/mass-editing).
Ở bước đề xuất ngày 2026-10-02 chỉ cập nhật backlog và kiểm tra liên kết nội bộ.
Triển khai tiếp ngày 2026-10-05 được ghi bên dưới. Chưa có dữ liệu ca làm/khả dụng
để tự động phân bổ PIC hoặc kết luận quá tải.

## Bảng gọn và lập lịch nhóm — triển khai 2026-10-05

- [x] Bảng mặc định 7 cột, cột bổ sung tùy chọn; chi tiết/nháp một WO trong panel.
- [x] Thay nhãn site bằng system rút gọn: HT-98-MISC-SYSTEM → HT-98;
      MT1-61-INSTR-AIR-SYS → MT-61. Site/WOID/connection vẫn giữ trong định danh;
      không suy đoán system từ tag khi dữ liệu Maximo thiếu.
- [x] Lọc system, chưa có lịch/PIC; chọn tất cả chỉ trong kết quả đã tải và lọc.
      Kiểm thử danh sách synthetic 100 WO, lọc 20 WO và xác minh đúng tập được chọn.
- [x] Panel nhóm áp Scheduled Start/Finish, PIC, duration; ô không chọn giữ nguyên;
      sửa riêng từng dòng, Undo/reset, dán 4 cột Excel và preview trước khi lưu.
- [x] API prepare/save/update/restore nhóm tối đa 200 WO, tối đa 4 detail GET đồng thời;
      một lần đọc crew mỗi nhóm, recheck scope sau I/O và trước transaction lưu.
- [x] Một transaction lưu toàn nhóm hoặc không lưu; lỗi từng WO, baseline/version,
      durable request receipt chống gửi trùng; mở/cập nhật/xóa nháp nhóm theo owner.
      Xóa nháp dùng version và xác nhận riêng; Maximo giữ nguyên.
- [x] 222 backend tests qua (HTTP mocks + PostgreSQL), 61 frontend tests qua;
      Ruff, ESLint, TypeScript và production build qua. Không thêm dependency.
- [x] Browser HTTPS local đăng nhập lại với chủ dự án, đọc 4 WO E&I thật trong
      khoảng 01/10 đến trước 30/10/2026; mở panel nhóm, lấy crew, áp PIC vào preview.
      Không lưu thử lên các nháp thật hoặc ghi Maximo trong lần kiểm tra này.

Giới hạn: 4 WO live chưa trả systemid nên hiện “Chưa có system”; cần kiểm chứng
relationship/metadata Maximo cho dữ liệu system thật. Chưa nghiệm thu 100+ WO live,
10 planner đồng thời hoặc desktop rộng đầy đủ. Nháp đã lưu giữ nguyên tập WO;
muốn bỏ một WO khỏi nhóm đã lưu thì tạo nhóm mới. Bulk target edit chưa mở;
target vẫn qua editor từng WO có intent và PM/CFT lock. Upload/reconciliation,
tự động phân bổ theo capacity và ca làm vẫn là các task riêng. Không commit/push.

## Sửa mất kết quả retrieve và giữ bảng gọn + panel — 2026-10-05

- [x] Xác định refresh phiên mỗi 60 giây/focus luôn gọi setRows(null), làm mất
      kết quả retrieve dù vẫn còn quyền. Vite log cũng ghi Fast Refresh invalidation
      do export dataColumns cùng React component; đã chuyển helper sang presentation.ts.
- [x] Giữ ngày lọc, phạm vi, tìm kiếm và các lựa chọn còn hợp lệ; sau auth recheck
      đọc lại danh sách bằng cùng query trước khi hiện. WO biến mất bị bỏ chọn.
      Lỗi tạm thời giữ dữ liệu/nháp ẩn để retry; đổi identity/grants hoặc hết phiên
      vẫn xóa dữ liệu. Không dùng browser storage để lưu WO.
- [x] Giữ bảng 7 cột, đưa Target Start/Finish chung một cột; không bật bảng dài.
      Panel đơn/nhóm có 17 field nghiệp vụ hiện có trong ánh xạ Excel, gồm actual
      dates, discipline, onshore PIC, tiến độ và toàn bộ schedule/target.
- [x] Bỏ System và bộ lọc System, ẩn Site/WOID trong danh sách, panel và nhãn nháp.
      Connection/site/WOID vẫn giữ trong API, selection keys và preconditions;
      WOID tiếp tục là định danh cho luồng ghi Maximo sau này.
- [x] 65 frontend tests qua, gồm timer 60 giây, focus, giữ bộ lọc/lựa chọn/nháp,
      retry, WO biến mất và đủ field trong panel; TypeScript, ESLint và build qua.
      Backend/frontend log không có error/traceback, liveness và DB-schema readiness trả ok.
- [x] Browser live: retrieve 4 WO E&I, tìm/chọn P13468351 và mở panel đủ field;
      quan sát qua hơn 60 giây vẫn giữ scope, ngày lọc, tìm kiếm và lựa chọn.
      Không ghi Maximo hoặc thay đổi nháp thật. Console có lỗi import HMR tạm thời
      lúc chuyển helper giữa file; sau khi chuyển xong không phát sinh lỗi mới.

Ghi chú: file Excel gốc không nằm trong workspace; đối chiếu field theo API mapping
đã có, chưa chứng nhận toàn bộ workbook. Upload/Change Target là thao tác, không phải
field dữ liệu Maximo; upload vẫn chưa triển khai, target intent/PM/CFT guard vẫn giữ.
Các mục System ở bước trước là lịch sử và đã được yêu cầu mới thay thế. Không commit/push.

## Bỏ timer refresh và thêm date picker đơn lẻ — 2026-10-05

- [x] Bỏ interval 60 giây của /work-orders theo yêu cầu. Khi đang làm việc trên trang
      không tự gọi auth/list hoặc ẩn giao diện theo timer. Vẫn kiểm tra phiên khi mở
      trang/quay lại cửa sổ và backend vẫn kiểm tra scope/baseline trước khi lưu.
- [x] Scheduled Start/Finish và Target Start/Finish của editor đơn lẻ dùng native
      datetime-local picker; hiển thị timezone của kết nối, serialize offset-aware
      qua zonedDateTime. Preview ngày giờ dùng định dạng đọc được.
- [x] Target vẫn cần Change Target intent và bị khóa cho PM/CFT; không hỗ trợ clear
      ngày. PIC, duration, reset, version và retry receipt giữ nguyên luồng.
- [x] 66 frontend tests qua, TypeScript/ESLint/build qua. Regression clock 3 phút
      không có auth/list refresh; date picker chuyển instant UTC sang giờ nghiệp vụ,
      ngày chọn lưu +07:00; date ordering, target intent và PM/CFT tests vẫn qua.
- [x] Browser local với WO P13468351: bốn input ngày là date/time picker; bấm
      calendar Scheduled Finish mở native calendar và time lists. Không sửa/lưu
      nháp thật hoặc ghi Maximo trong bước xác minh.

Các đoạn nói timer 60 giây ở bước trước là lịch sử, đã được thay thế bởi yêu cầu mới.
Không thêm dependency, không ghi Maximo và không commit/push.

## Picker Target và Finish tự tính — 2026-10-05

- [x] Ẩn nhãn múi giờ trong phần lập lịch đơn lẻ/nhóm và phần bảo vệ nháp;
      vẫn hiển thị/serialize ngày theo múi giờ kết nối, không dùng múi giờ browser.
- [x] Target Start/Finish dùng native date/time picker trực tiếp trên WO hợp lệ;
      người dùng chọn ngày tự đặt change_target=true. Bỏ chọn intent trả target gốc;
      PM/CFT và các guard quyền/baseline/PIC vẫn khóa chỉnh sửa tương ứng.
- [x] Scheduled Finish chỉ đọc, tính Start + Est. Duration (giờ liên tục) khi đổi
      Start hoặc Duration, cả editor đơn lẻ, sửa nhóm và từng dòng; dán Excel đổi
      thành 3 cột Start/PIC/Duration. Chỉ sửa PIC hoặc mở WO không tự viết lại lịch gốc.
- [x] 71 frontend tests qua, ESLint/TypeScript và production build qua. Kiểm thử
      gồm giờ lẻ, duration zero, qua ngày, thiếu/âm duration, group có duration khác nhau,
      sửa ngoại lệ/Undo, paste atomic và explicit target intent/PM/CFT.
- [x] Browser HTTPS local với P13465570: Target Start mở native calendar/time lists;
      Start 21/10/2026 08:00 + 10.5 giờ ra Finish 18:30, đổi duration 12 ra 20:00;
      sửa Target Finish tự bật intent. Đã reset các giá trị thử về baseline, không lưu nháp.

Giới hạn: formula Finish được áp trong UI; backend chưa bắt buộc formula cho mọi API client.
Chưa có lịch ca/ngày làm việc hoặc bulk target. Không thêm dependency, không ghi Maximo,
không commit/push. Các mục trước nói chọn Finish, hiện timezone hoặc dán 4 cột là lịch sử,
đã được yêu cầu mới này thay thế.

## Đóng panel, nháp đã lưu và focus recheck — 2026-10-06

- [x] Kiểm tra luồng đóng: chỉ unmount panel, không gọi DELETE. Nháp lưu PostgreSQL
      trong draft/draft_item, baseline và changes JSONB; bảng/list WO lấy Maximo,
      mở số WO lấy baseline còn mở draft_id mới phục hồi changes.
- [x] Browser live mở P13465570 v1 từ Danh sách nháp: lịch 08/10/2026 09:07–19:37,
      PIC DUONGVQ vẫn còn. Đóng panel không xóa nháp. Lần kiểm tra này không tái hiện
      full-page reload; mã cũ gọi auth/list và ẩn UI trên mọi window focus.
- [x] Thêm thông báo/nút Mở lại nháp đã lưu, giữ sau đóng panel đơn lẻ hoặc nhóm;
      đồng bộ metadata/version sau save/restore và bỏ shortcut khi xóa/đổi scope/quyền.
      Nháp và dữ liệu Maximo được ghi nhãn riêng, không overlay thay baseline.
- [x] Focus chỉ recheck sau window blur/tab hidden; focus đơn lẻ không auth/retrieve.
      Visibility/focus cùng một lần quay lại không gọi trùng; vẫn recheck backend khi lưu.
- [x] 75 frontend tests qua, TypeScript/ESLint/build qua; close/reopen giữ changes,
      close không delete/refresh, chưa lưu có discard guard, nhóm mở đúng API,
      grant change xóa shortcut và nội dung cũ; visibility/focus gọi một lượt.
- [x] Browser sau sửa: mở lại P13465570 v1 rồi đóng, giữ 5 WO, ngày lọc và Danh sách nháp;
      thông báo v1/nút mở lại vẫn hiện. Không sửa/lưu/xóa nháp thật hoặc ghi Maximo.

Giới hạn: shortcut là metadata tạm thời, bị xóa khi kiểm tra lại phiên thực sự;
nháp vẫn mở lại từ Danh sách nháp trong scope được cấp. Không tự lưu edits chưa bấm Lưu nháp.
Backend không đổi trong task này; không chạy lại suite backend, không thêm dependency/commit/push.

## Nháp tích hợp với bảng WO — nghiên cứu UI/UX 2026-10-06

- [x] Đối chiếu SAP Fiori Draft Handling (editing status trên dòng đối tượng và lọc
      own draft) cùng Carbon Data Table (toolbar, row/batch actions, disclosure).
      Chỉ tham khảo cách thể hiện; không áp cơ chế auto-save/lock của SAP vào ứng dụng.
- [x] Đề xuất ba hướng thay khu vực Danh sách nháp riêng: nháp ngay trên WO với
      marker/lọc và panel; hai chế độ WO Maximo/Kế hoạch của tôi dùng cùng bảng;
      gom WO theo từng nháp đơn/nhóm để tiếp tục thao tác hàng tháng.
- [x] Dựng ba bản minh họa tương tác dữ liệu synthetic, giữ bảy cột nghiệp vụ và
      Site/WOID/System ẩn. Lọc nháp, mở/đóng panel, chuyển chế độ và mở nhóm đã
      kiểm tra trên browser; kiểm tra DOM/script qua cho badge sau save/reopen,
      finish theo duration và selection đúng thành viên nhóm. Không gọi API thật.
- [x] Đã triển khai phương án 1 trong mục tiếp theo: scoped index theo connection/site/WOID,
      chọn rõ khi WO thuộc nhiều nháp, mở đúng draft_id/version và nguyên tập nháp nhóm,
      recheck quyền/baseline. Marker không gọi restore riêng từng WO; đọc có giới hạn
      và hủy stale responses.
- [x] Triển khai cập nhật dòng/marker sau save, close, restore, delete; chỉ ô có
      changes mới hiện nhãn nháp, status Maximo không bị thay. Có lối truy cập nháp
      ngoài khoảng Retrieve, không âm thầm gộp vào các WO đã tải hoặc sai scope.

Khuyến nghị: marker/lọc ngay trong bảng cho luồng chính, cân nhắc chế độ Kế hoạch của tôi
để tìm nháp ngoài kết quả Retrieve. Chưa thay giao diện production/local app trong bước
đề xuất; không xóa nháp, không ghi Maximo, không thêm dependency hoặc commit/push.
Nguồn: [SAP Fiori Draft Handling](https://www.sap.com/design-system/fiori-design-web/v1-148/foundations/best-practices/global-patterns/object-handling/draft-handling),
[Carbon Data Table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines).

## Nháp ngay trên WO và bản duyệt Carbon — 2026-10-06

- [x] Triển khai phương án 1: bỏ Danh sách nháp/thông báo shortcut riêng; giữ bảy cột,
      marker đơn/nhóm/phiên bản dưới số WO, filter có/chưa có nháp và counts cho các WO đã tải.
      Các ô schedule/target/PIC/duration hiển thị kế hoạch được chọn với nhãn Nháp;
      baseline giữ riêng, status Maximo không đổi. Baseline stale không overlay và cần đối chiếu.
- [x] WO có nhiều nháp mở chooser rõ phiên bản/thời điểm; mở đúng ID và nguyên nhóm gốc.
      Save/restore/delete đồng bộ cả thành viên nhóm; close giữ marker/giá trị, không retrieve/delete.
      Chọn các WO của cùng nhóm mở lại nhóm; tránh tạo nhóm mới âm thầm trên nháp cũ.
- [x] Nguồn WO có nháp trong phạm vi dùng chung bảng và pagination 20 nháp/trang,
      mở được nháp ngoài khoảng Retrieve. Scope/session đổi hoặc response trễ không lẫn dữ liệu.
- [x] API WO list lấy marker bằng một SQL query, chỉ owner/scope/identity vừa được Maximo xác minh;
      không gọi restore/detail/PIC riêng từng nháp để tô bảng. Chỉ trả đề xuất cho WO được phép,
      không trả identity/count các thành viên khác; group restore vẫn recheck toàn nhóm.
- [x] 226 backend tests và 91 frontend tests qua; Ruff lint/format, ESLint/TypeScript/build qua.
      Có kiểm thử owner/connection/discipline/site collision, grant revoked trong I/O, moved WO,
      stale baseline, một upstream list cho marker, multiple drafts, delete giữ nháp khác,
      filter, same-table ngoài range/pagination/session recheck và hủy response cũ.
- [x] Browser live Onshore E&I: 5 WO, 3 WO có nháp, restore P13468282 v1 giữ DUNGDT/duration 12,
      đóng panel giữ dữ liệu; P13465570 có hai v1 và chooser thời điểm khác nhau.
      Nguồn WO có nháp hiển thị 3 WO trong cùng bảng; chooser nhận focus và Escape đóng.
      Chỉ đọc/khôi phục nháp thật để kiểm tra, không sửa/lưu/xóa hoặc ghi Maximo.
- [x] Dựng bản duyệt màu/font Carbon riêng với Gray 10/White/Gray 100, palette token/hex,
      IBM Plex Sans, mẫu tiếng Việt và bảng WO/panel synthetic. Theme/filter/save/close/finish
      đã kiểm tra DOM và browser; viewport 320/1024 không tràn ngang ngoài vùng bảng.
      Chưa áp palette/font này vào ứng dụng thật.
- [x] Người dùng duyệt Gray 10 và Gray 100 cho sáng/tối vào 2026-10-06; triển khai
      trong mục tiếp theo. Bảng 14/18, label 12/16, heading 28/36 theo productive typography.

Giới hạn: nguồn bảng nháp recheck live toàn bộ thành viên của tối đa 20 nháp mỗi trang;
độ trễ hàng trăm WO, 10 phiên đồng thời và UAT rộng chưa đo. Nháp của owner đang đăng nhập,
không phải kế hoạch chung của tất cả planner. Upload/ETag/history vẫn pending.
Không thêm runtime dependency, không commit/push. Bước này chỉ duyệt màu/font;
palette được áp dụng ở task tiếp theo sau khi người dùng chọn theme.
Nguồn: [Carbon color tokens](https://www.carbondesignsystem.com/building-blocks/foundations/color/tokens),
[Carbon theme values](https://carbon-elements.netlify.app/themes/examples/preview/),
[Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets).

## Carbon light/dark và sửa màu chữ Gray 10 — 2026-10-06

- [x] Áp dụng Gray 10 (sáng) / Gray 100 (tối), bỏ White khỏi preview. Nút chuyển
      trên header có switch label/state và lưu duy nhất preference theme trong localStorage.
      Default sáng; preference không hợp lệ hoặc storage bị chặn không ngăn dùng ứng dụng.
- [x] Màu chữ chính/phụ, field, layer, tags, highlights, lỗi và nút theo theme;
      primary button giữ chữ trắng trên Blue 60. Native date/time picker theo color-scheme.
      Preview cố định color inheritance trong root để headings/cells không nhận chữ sáng
      từ host khi chọn Gray 10.
- [x] IBM Plex Sans 400/500/600 self-hosted từ IBM/plex revision ghi trong
      frontend/public/fonts/SOURCE.txt; giữ giấy phép SIL OFL. Không thêm runtime dependency
      hoặc gọi dịch vụ font bên ngoài từ ứng dụng thật. Kiểm tra browser font đã load.
- [x] 92 frontend tests qua, ESLint/TypeScript và production build qua; test app chuyển
      hai theme khi panel có edit chưa lưu giữ input và không gọi thêm auth/retrieve/detail.
- [x] Browser live Onshore: 3 WO có nháp giữ nguyên qua chuyển sáng/tối; restore P13468282
      rồi đổi theme bằng bàn phím giữ duration 12 và date values. Close giữ nháp trên bảng.
      Computed styles: sáng text #161616/#525252, tối #f4f4f4/#c6c6c6; bảng, panel và date
      field đúng theme. Chỉ đọc nháp, không sửa/lưu/xóa dữ liệu thật hoặc ghi Maximo.
- [x] Preview DOM/script theme/filter/finish/save/close qua; browser xác nhận h1/h2/h3,
      type sample, headers/cells và controls dùng đúng màu ở cả hai theme.

Giới hạn: đây là áp dụng palette/typography Carbon bằng CSS và native controls,
không chuyển toàn bộ component sang thư viện Carbon React. Backend không đổi, không
chạy lại suite backend trong task này. Không commit/push; UAT monthly-load vẫn pending.
Nguồn: [Carbon color tokens](https://www.carbondesignsystem.com/building-blocks/foundations/color/tokens),
[IBM Plex](https://github.com/IBM/plex).

## Xác nhận áp dụng giao diện đã duyệt — 2026-10-06

- [x] Người dùng xác nhận giao diện đạt yêu cầu và cho áp dụng. Đối chiếu source và
      trang /work-orders thật: Gray 10/Gray 100, IBM Plex Sans nội bộ và switch đã tích hợp
      trong frontend ứng dụng, không còn là thay đổi chỉ trong preview.
- [x] Kiểm tra browser sau session recheck: nguồn nháp giữ 3 WO; chuyển tối rồi sáng
      chỉ đổi theme, rows/markers/PIC/duration giữ nguyên. Lưu ảnh bản chạy thật.

Không cần thay mã thêm vì bản đã duyệt đã được tích hợp ở task trước; giữ bằng chứng
92 frontend tests, lint/typecheck/build đã qua của task đó, không chạy lại suite không đổi.

## Sửa độ khớp style/font với bản Carbon đã duyệt — 2026-10-06

- [x] Xác nhận phản hồi: bản trước đổi palette và một phần typography nhưng còn style cũ
      của header, spacing, inputs, table và panel. Thay bộ component styles thống nhất,
      loại các rules cũ/overrides chồng nhau; header đen 48px, spacing 16/24, nút vuông 40px,
      fields nền theo theme và viền dưới, bảng 14/18, tags/marker pill.
- [x] Chuyển font-face sang fonts.css toàn ứng dụng, preload Regular; explicit IBM Plex
      Sans cho headings, body, labels, table và controls. Bỏ weight 700 giả lập/cỡ chữ cũ;
      body 14/20, table/controls 14/18, label 12/16, heading 28/36 và 20/28.
- [x] Xác minh font file Regular được localhost phục vụ HTTP 200, font/woff2, 63020 bytes;
      đọc name table WOFF2 của cả ba assets xác nhận IBM Plex Sans/Medm/SmBld.
      Browser có 3 font faces và regular/600 ready; computed typography đúng trên title,
      table, buttons và fields. Không chỉ dựa vào tên font-family được khai báo.
- [x] Panel gọn 440px dưới header để nút theme luôn dùng được; form hiện trước,
      17 field Maximo vẫn trong disclosure. Kiểm thử mở disclosure xác nhận đầy đủ dữ liệu.
- [x] 92 frontend tests qua sau cập nhật disclosure test; lint/typecheck/build qua.
      Browser live Onshore 3 WO, restore P13468282 duration 12, sáng/tối giữ panel/giá trị;
      viewport 320px không tràn ngang ngoài bảng, field vẫn nằm trong panel. Lưu ảnh bảng
      và panel thật hai theme; không sửa/lưu/xóa nháp thật hoặc ghi Maximo.

Giới hạn: component styles được áp trên native controls theo bản duyệt; không thêm Carbon
React library hoặc runtime dependency. Backend không đổi, không chạy lại suite backend.
UAT hàng trăm WO và 10 phiên vẫn pending; không commit/push.
Nguồn: [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets).

## Mở rộng màn hình WO đơn lẻ và chia section — 2026-10-06

- [x] Thay panel 440px bằng khung rộng tối đa 1320px theo viewport. Desktop đặt thông tin
      WO bên trái, Lịch và phân công / Ngày mục tiêu / Đối chiếu Maximo-Nháp bên phải;
      các date/PIC/duration controls dùng hai cột. Header Đóng và footer Lưu/Reset/Xóa
      nằm ngoài vùng cuộn nội dung, luôn tiếp cận được.
- [x] Giữ đủ 17 field nghiệp vụ: thông tin chung hiện sẵn, sáu ngày Maximo/thực tế trong
      disclosure riêng. Site/WOID/System tiếp tục ẩn khỏi UI; identity API giữ nguyên.
      Màn hình nhỏ xếp form trước thông tin tham chiếu, thứ tự keyboard theo DOM tương ứng.
- [x] Giữ date picker, finish tự tính, target intent và khóa PM/CFT; giữ save/restore/delete,
      kiểm tra session/PIC/baseline và phiên bản nháp. Thêm kiểm thử footer bị khóa khi
      read-only, session recheck hoặc chưa cấu hình crew sau khi tách khỏi fieldset.
- [x] 95 frontend tests / 9 files, lint và TypeScript/build qua. Browser live restore
      P13468282 v1: Gray 10/100 giữ DUNGDT và duration 12; viewport mặc định 1149x884 có
      panel rộng 1101px, body content = client height 680px nên form và hai dòng đối chiếu
      vừa khung không cuộn. Mở disclosure kiểm tra sáu field ngày; 320px form không tràn
      ngang và footer vẫn nhìn thấy. Reset viewport, để panel Gray 10 mở cho người dùng.

Giới hạn: khi mở thêm ngày tham chiếu, nhiều thay đổi hoặc viewport thấp, chỉ nội dung
panel cần cuộn; header/footer giữ cố định. Không thêm dependency; không sửa/lưu/xóa nháp
thật hoặc ghi Maximo trong kiểm tra UI. Backend không đổi, không chạy lại backend suite;
UAT hàng trăm WO / 10 phiên vẫn pending. Không commit/push.

## Tự nhận phạm vi tài khoản và Settings hệ thống — 2026-10-06

- [x] Chủ dự án xác nhận chọn kết nối/URL đã cấu hình và lưu cho tài khoản. Bỏ selector
      Hệ thống/Discipline trên WO; scope duy nhất tự dùng khi login, hoặc dùng preference
      server khớp grant hiện tại. Giữ nhãn system/environment/discipline, không chọn nhóm.
- [x] Trang /settings riêng và link từ header/WO: hiện các URL đã cấu hình thuộc quyền
      tài khoản, radio chọn kết nối và Lưu hệ thống; không chỉnh URL/credential. Giữ guard
      nháp chưa lưu khi đi sang Settings; kiểm tra session khi quay lại từ blur/hidden.
- [x] Migration 0007 user_connection_setting lưu connection per app_user trên PostgreSQL;
      GET/PUT /api/settings/connection và session preferred_connection_id. PUT có CSRF,
      PERSON/current grant recheck, payload allowlist và configured_connection policy.
      Không nhận user/URL/discipline từ client; admin không grant không được chọn WO scope.
- [x] Không tự chọn bằng thứ tự mảng khi có nhiều discipline/kết nối; nhiều kết nối chọn
      một lần ở Settings, ambiguous discipline cần quản trị viên. Preference hết quyền
      không tạo WO access. Khi context đổi, hủy request cũ và xóa bảng/panel phạm vi cũ.
- [x] Nâng migration trên DB ứng dụng local và DB test cô lập; restart đúng backend dev
      để nạp API mới. 236 backend tests qua với Windows Selector loop và PostgreSQL test;
      106 frontend tests/12 files, Ruff, lint và TypeScript/build qua.
- [x] Browser live: tự nhận Onshore test/E&I; lưu preference cho tài khoản hiện tại,
      mở lại Settings xác nhận lựa chọn đọc từ server, quay về WO tải 3 WO có nháp
      mà không chọn phạm vi. Lưu ảnh WO/Settings thật; giữ /work-orders mở.

Giới hạn: chỉ một kết nối live đã được xác minh; nhiều kết nối được kiểm tra synthetic.
Không sửa/lưu/xóa nháp hoặc ghi Maximo. Không thêm dependency, không commit/push;
monthly-load/10 phiên và triển khai Ubuntu vẫn pending. Chi tiết: [Settings](account-settings.md).

## Sửa mất đăng nhập giả sau xóa nháp — 2026-10-07

- [x] Xác định lỗi frontend: DELETE nháp trả 204, session vẫn trả 200, nhưng lần kiểm tra
      sau mở lại ID đã xóa trả 404 và bị xử lý như mất phiên. Xác nhận native còn tạo
      blur/focus, có thể kích hoạt recheck và hủy request xóa đang chạy.
- [x] Chuyển xác nhận xóa WO đơn lẻ vào panel với nút xác nhận/hủy; khóa nút trong lúc
      xóa. Xóa thành công chỉ cập nhật marker nháp và đóng panel, giữ bảng/query/bộ lọc.
- [x] Xóa tham chiếu panel ngay khi đóng/chuyển; bỏ qua phản hồi recheck của panel cũ.
      404 hiện tại đóng panel và đọc lại bảng có kiểm tra quyền, không đặt session null.
      Các lỗi quyền mở/lưu/xóa/list hủy nội dung WO cũ và kiểm tra session server; phiên
      thật hết hạn mới yêu cầu login, account mất grant vẫn đăng nhập nhưng không có WO.
- [x] 114 frontend tests / 12 files, lint và TypeScript/build qua. Hồi quy bao gồm xóa
      thành công giữ bảng/bộ lọc, giữ nháp khác cùng WO, nháp bị xóa ở tab khác, phản hồi
      panel cũ thành công/404, xóa bị 404/401/403 và conflict phiên bản 409.
- [x] Browser live: phiên hiện tại tự nhận Onshore test/E&I và retrieve 5 WO; mở nháp
      có sẵn, kiểm tra xác nhận ngay trong panel, lưu ảnh và Hủy xóa/Đóng nháp vẫn giữ
      bảng cùng trạng thái đăng nhập. Giữ /work-orders mở cho người dùng.

Giới hạn: thao tác DELETE thành công và các race được xác minh bằng frontend mocks;
không xóa nháp thật trong kiểm tra browser, không ghi Maximo. Backend không đổi,
không chạy lại backend suite; monthly-load/10 phiên và browser E2E rộng vẫn pending.
Không thêm dependency, không commit/push. Chi tiết: [Nháp](drafts.md).

## Khảo sát tải lại dữ liệu khi điều hướng / quay lại tab — 2026-10-07

- [x] Kiểm tra mã: WorkOrders blur/focus và visibilitychange kích hoạt kiểm tra session,
      ẩn toàn bộ nội dung, đọc lại WO/nháp đang mở rồi retrieve lại cùng bảng. BatchPlanner
      đọc lại nhóm khi suspended kết thúc. Điều hướng route gỡ WorkOrders, làm mất state
      trong component. Overview SessionPanel và Settings có luồng refocus riêng.
- [x] Xác minh session_info còn sync_person_access qua Maximo; không coi request session
      là chỉ đọc cookie/PostgreSQL. Không có timer định kỳ reload bảng trong mã hiện tại;
      full navigation được dùng cho đăng xuất, còn route nội bộ dùng React Router.
- [x] Đề xuất giữ workspace trong bộ nhớ ứng dụng qua route; tách xác minh phiên/quyền
      khỏi tải WO; giữ cache bảng theo actor/connection/discipline/query, có tuổi dữ liệu,
      nút cập nhật và kiểm tra lại có giới hạn. Dữ liệu mới không ghi đè edits chưa lưu;
      đổi identity/scope, logout hoặc mất quyền phải hủy cache và phản hồi cũ. Duy trì
      kiểm tra quyền/baseline/version tại backend trước thao tác lưu/xóa/upload.
- [x] Triển khai chính sách giữ workspace / cập nhật dữ liệu sau khi chủ dự án chốt;
      xem bằng chứng và giới hạn ở mục triển khai bên dưới (2026-10-07).

Bằng chứng: đọc App.tsx, WorkOrders.tsx, DraftEditor.tsx, BatchPlanner.tsx,
SessionPanel.tsx, Settings.tsx, API client và backend auth/session/person access.
Đối chiếu [React state lifecycle](https://react.dev/learn/preserving-and-resetting-state)
và [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
Giới hạn: đây là khảo sát và đề xuất, chưa thay đổi mã ứng dụng; chưa đo waterfall/độ trễ
trên browser hoặc chạy lại suite vì không có thay đổi hành vi.

## Giữ workspace và giảm tải lại WO — 2026-10-07

- [x] Giữ WorkOrders mounted trong App theo active route; không lấy dữ liệu khi chưa mở
      WO. Giữ bảng/query/page/bộ lọc/dòng chọn, editor đơn/nhóm và phần sửa trong RAM qua
      Settings/Tổng quan; khôi phục vị trí cuộn. Không dùng browser storage cho WO/nháp.
- [x] Tách session verification khỏi WO refresh: chỉ visibilitychange sang visible hoặc
      mở lại route WO kiểm tra quyền; bỏ blur/focus ở WO, Overview session và Settings.
      Gộp session checks đang chạy; không tải lại list/detail/nháp/nhóm khi quyền giữ nguyên
      và không hủy save chỉ vì chuyển tab. Lỗi xác minh ẩn nội dung để kiểm tra lại;
      identity/grants/preference đổi hoặc hết phiên xóa workspace/phản hồi cũ.
- [x] Hiện thời điểm Cập nhật lần cuối, sau 5 phút chỉ báo dữ liệu có thể đã thay đổi.
      Cập nhật thủ công đọc lại cùng query/page, giữ bộ lọc/selection còn tồn tại và edits;
      đối chiếu baseline/PIC/phiên bản mới hơn, không ghi đè edits. Lỗi upstream giữ bảng
      có quyền đã xác minh. Lưu/xóa nháp tiếp tục cập nhật marker tại đúng dòng.
- [x] Đi sang Settings không bỏ edits; Lưu hệ thống khác có guard bỏ sửa chưa lưu.
      Settings không reset lựa chọn chưa lưu vì focus/tab return và không hủy save đang chạy.
- [x] 124 frontend tests/12 files, ESLint, TypeScript và production build qua. Kiểm thử
      route/state/scroll, auth dedupe, blur không request, visible return không refetch,
      tuổi dữ liệu 5 phút, explicit update, nhóm giữ edits, save không hủy khi đổi tab,
      expired session giữa refresh, đổi scope và đối chiếu phiên bản nháp mới hơn;
      phản hồi bảng cũ không ghi đè marker/giá trị của nháp vừa lưu đồng thời.
- [x] Browser live Onshore test/E&I: nguồn nháp tải 3 WO, lọc/chọn 1 WO, đi Settings và
      quay lại vẫn giữ bảng/bộ lọc/selection và cùng thời điểm cập nhật. Lưu ảnh bằng chứng,
      xóa bộ lọc thử và để bảng đầy đủ mở lại; không ghi/xóa nháp hay thay đổi Maximo.

Giới hạn: cache chỉ sống trong vòng đời ứng dụng/tab; F5 mất phần chưa lưu trong RAM,
nháp server vẫn giữ. Session verification hiện vẫn đọc PERSON Maximo; chưa đo độ trễ
waterfall/10 phiên. Tab visibility/timer/race xác minh bằng tests synthetic; browser live
xác minh điều hướng Settings. Backend không đổi, không chạy lại backend suite. Không thêm
dependency, không commit/push. Hành vi hiện tại: [Nháp](drafts.md).

## Sửa mất bảng khi đổi nguồn Maximo / nháp — 2026-10-07

- [x] Xác định reset dùng chung đã xóa rows/query Maximo khi mở nháp và khi quay về.
      Giữ hai snapshot riêng trong RAM cho cùng tài khoản/phạm vi: rows, query/trang,
      bộ lọc, dòng chọn, lựa chọn kế hoạch và thời điểm cập nhật. Chuyển nguồn đã tải
      không gọi API lại; Cập nhật thủ công dùng đúng query/page được khôi phục.
- [x] Lưu/cập nhật/xóa nháp cập nhật marker/giá trị ở cả snapshot đang ẩn; xóa nháp
      giữ WO baseline trong nguồn Maximo, loại WO hết nháp khỏi nguồn nháp. Đổi nguồn
      giữ guard sửa chưa lưu; lỗi tải nháp giữ bảng Maximo và cho tải lại nguồn bị lỗi.
- [x] Đổi ngày chỉ hủy snapshot Maximo cũ; chưa Retrieve hiện hướng dẫn rõ. Hết phiên,
      đổi actor/grants/kết nối hoặc access denied xóa cả hai snapshot, hủy response cũ.
      Tuổi dữ liệu vẫn theo thời điểm gốc, kể cả hai nguồn có timestamp giống nhau.
- [x] 133 frontend tests/12 files, ESLint, TypeScript và production build qua. Thêm
      9 regression tests cho đổi nguồn, query/page refresh, timestamp/tuổi dữ liệu,
      save/delete đồng bộ bảng ẩn, scope isolation, lỗi upstream, guard edits và đổi ngày.
- [x] Browser live Onshore test/E&I: Retrieve 117 WO từ 01/10 đến trước 01/11/2026,
      lọc/chọn P13465570, sang nguồn 3 WO có nháp, quay về vẫn đủ 117 WO trong snapshot,
      giữ filter/selection và thời điểm 10:43:12. Lưu ảnh wo-source-restored.png.

Giới hạn: cache chỉ trong RAM, F5 vẫn cần Retrieve lại; nháp PostgreSQL không mất.
Lưu/xóa và đổi scope xác minh bằng mocks, browser live chỉ đọc và chuyển nguồn;
backend không đổi, không chạy lại backend suite. Không thêm dependency.

## Căn giữa màn hình WO đơn lẻ — 2026-10-07

- [x] Thay vị trí neo phải/dưới bằng căn giữa viewport theo hai trục; giữ chiều rộng
      tối đa 1320px, giới hạn chiều cao 900px và theo dynamic viewport. Giữ section
      dữ liệu, cuộn nội dung và header/footer hiện có; màn hình hẹp vẫn căn giữa có lề.
- [x] ESLint, TypeScript và production build qua. Browser live mở nháp P13431393,
      kiểm tra desktop 1600×1000 (panel 1320×888), viewport 760×884 và kích thước mặc định
      1164×884: tâm panel trùng tâm vùng viewport khả dụng, không tràn ngang ở 760px.
      Reset viewport override, giữ màn hình WO mở và lưu ảnh wo-centered.png.

Giới hạn: chỉ đổi CSS vị trí/kích thước panel WO đơn lẻ; không thay logic nghiệp vụ/API,
      không chạy lại suite 133 tests đã qua ở task trước và không thêm test CSS mô phỏng.
      Không ghi/xóa nháp hay thay đổi Maximo khi kiểm tra giao diện.

## Căn giữa màn hình lập lịch nhóm — 2026-10-07

- [x] Căn panel nhóm giữa viewport theo cả hai trục như màn hình WO đơn lẻ; giữ rộng
      tối đa 1160px, chiều cao tối đa 900px và theo dynamic viewport. Màn hình hẹp có
      lề, nội dung và bảng cuộn trong panel; giữ controls lập lịch nhóm hiện có.
- [x] ESLint, TypeScript và production build qua. Browser Onshore test/E&I mở nhóm
      P13439902/P13457667: tâm panel trùng tâm vùng viewport khả dụng tại 1164×884,
      1600×1000 (panel 1160×888) và 760×884; không tràn ngang panel ở 760px.
      Khôi phục viewport mặc định, lưu ảnh wo-batch-centered.png và giữ panel nhóm mở.

Giới hạn: chỉ đổi CSS, không thay logic nhóm/API, không chạy lại suite ứng dụng cho
      thay đổi vị trí này. Kiểm tra live chỉ prepare/đọc hai WO, không lưu/xóa nháp hay ghi Maximo.

## Kích thước panel nhóm 80% màn hình — 2026-10-07

- [x] Panel nhóm dùng width 80%, height 80dvh, giữ căn giữa hai trục; bỏ giới hạn
      1160px/900px và override chiều rộng ở breakpoint hẹp. Bảng/nội dung cuộn trong panel.
- [x] ESLint, TypeScript và production build qua. Browser live nhóm 2 WO: viewport
      mặc định 1164×884 đo panel xấp xỉ 80% chiều rộng khả dụng và 80% chiều cao,
      tâm sai lệch 0px; 760×884 vẫn giữ cùng tỉ lệ, không tràn ngang panel. Khôi phục
      viewport mặc định và lưu ảnh wo-batch-80-percent.png.

Giới hạn: chỉ CSS, không thay API/logic nhóm; không chạy lại suite cho thay đổi kích thước.
      Không sửa/lưu/xóa dữ liệu khi kiểm tra live.

## Khóa cuộn nền khi mở màn hình lập lịch — 2026-10-07

- [x] Khóa cuộn html/body và bảng WO có scrollbar riêng khi panel đơn lẻ, nhóm hoặc
      chooser hiển thị. Giữ scroll offsets; ổn định gutter tránh nhảy ngang. Chặn
      overscroll từ panel/editorBody; bảng trong panel vẫn cuộn ngang độc lập.
- [x] Cleanup khóa khi đóng, hidden route, xác minh quyền thất bại/hết phiên hoặc
      unmount. Giữ edits khi sang Settings và khôi phục khóa khi quay lại editor.
- [x] 136 frontend tests/12 files, ESLint, TypeScript và production build qua. Thêm
      3 lifecycle tests: đóng/unmount đơn lẻ và nhóm, sang Settings/quay lại và hết phiên.
- [x] Browser Onshore test/E&I: nhóm 3 WO cuộn tới đáy panel (280px); wheel ngoài
      panel và tại đáy không đổi pageY=296/tableY=1866; đóng nhóm giữ nguyên offsets.
      Đơn lẻ P13431393 cuộn editorBody tới đáy (71px); cuộn tiếp/nền giữ pageY=395,
      tableY=0; đóng gỡ khóa và giữ vị trí. Không ghi/xóa nháp/Maximo. Lưu ảnh
      wo-panel-scroll-locked.png, để panel nhóm mở cho chủ dự án xem.

Giới hạn: kiểm tra wheel trực tiếp trên browser desktop; chưa thử thiết bị cảm ứng thật.
      Backend không đổi, không chạy lại backend suite. Không thêm dependency.

## Mở rộng panel nhóm lên 95% — 2026-10-07

- [x] Panel nhóm rộng 95% viewport, giữ cao 80dvh, căn giữa và khóa cuộn nền.
      Tài liệu hành vi hiện tại được cập nhật; không đổi màn hình WO đơn lẻ.
- [x] ESLint, TypeScript và production build qua. Browser nhóm 3 WO tại 1164×884:
      panel 1091.55×707.19px, tương ứng 95% vùng chiều rộng khả dụng / 80% chiều cao;
      nền vẫn overflow hidden. Lưu ảnh wo-batch-95-percent.png, giữ panel mở.

Giới hạn: chỉ CSS, không đổi API/logic; không chạy lại suite cho thay đổi chiều rộng.
      Kiểm tra live chỉ prepare/đọc, không lưu/xóa nháp hay ghi Maximo.

## Panel nhóm 95% cả hai chiều — 2026-10-07

- [x] Tăng height panel nhóm từ 80dvh lên 95dvh, giữ width 95%, căn giữa và khóa cuộn nền.
      Tài liệu hành vi hiện tại cập nhật đồng bộ.
- [x] ESLint, TypeScript và production build qua. Browser nhóm 3 WO tại 1164×884 đo
      panel 1091.55×839.80px, xấp xỉ 95% cả hai chiều, tâm sai lệch 0px; nền vẫn khóa cuộn.
      Lưu ảnh wo-batch-95-both.png và giữ panel mở.

Giới hạn: chỉ đổi CSS chiều cao; không chạy lại suite cho chỉnh kích thước, không thay
      API/logic hay sửa/lưu/xóa dữ liệu trong kiểm tra live.

## Rút gọn thông tin WO trong lịch nhóm — 2026-10-07

- [x] Bỏ thông tin lặp trong phần mở rộng: WO, description, type, tag, status,
      schedule, assigned PIC và duration đã có trên dòng; discipline nằm ở header nhóm.
      Giữ 7 field bổ sung: Priority, Onshore PIC, % Complete, Target Start/Finish,
      Actual Start/Finish; ngày vẫn hiển thị theo timezone của kết nối.
- [x] Chuyển phần mở rộng khỏi ô hẹp sang hàng phụ ngang toàn bảng, chia 3 nhóm,
      dùng màu/font Carbon hiện có. Nút có aria-expanded/controls; chỉ mở một WO mỗi lần.
      Mở/đóng không gọi retrieve hay reset chỉnh sửa. Không đổi panel WO đơn lẻ.
- [x] 138 frontend tests/12 files, ESLint, TypeScript và production build qua.
      Hai tests mới xác minh trường bổ sung/không lặp, định dạng ngày, mở một hàng,
      giữ edits và không gọi prepare lại. Git diff --check qua.
- [x] Browser Onshore test/E&I nhóm 3 WO: P13439902 hiển thị đủ 7 field trên 3 nhóm,
      phần bổ sung rộng 1026.55px/cao 140px ở viewport 1164×884; chuyển mở WO khác
      đóng phần trước. Lưu ảnh wo-batch-compact-details.png và giữ panel mở để xem.

Giới hạn: chỉ kiểm tra desktop browser; bảng nhóm giữ cuộn ngang ở màn hình hẹp.
      Không thêm dependency, không đổi backend hoặc chạy lại backend suite;
      kiểm tra live không lưu/xóa nháp hay ghi Maximo.

## Chuẩn bị commit toàn bộ thay đổi — 2026-10-07

- [x] Gom phạm vi đã duyệt: Planner permission (migration 0006), Settings kết nối
      theo tài khoản (0007), draft batches/markers, bảng WO tích hợp nháp, cache/phiên,
      Carbon Gray 10/100 và IBM Plex Sans, date pickers/derived finish, panel đơn/nhóm
      căn giữa/khóa cuộn nền, thông tin bổ sung gọn và tài liệu liên quan.
- [x] Chạy toàn bộ backend: 236 tests qua (136 fast + 100 PostgreSQL), Ruff check/format qua.
      Sửa test_batch_api dùng SelectorEventLoop: 12 ca trước đó lỗi do event loop mặc định
      Windows không tương thích psycopg; chạy lại toàn suite thành công.
- [x] Frontend hiện tại đã qua 138 tests/12 files, ESLint, TypeScript và production build.
      Git diff --check qua; không thêm dependency runtime, giữ giấy phép/nguồn font.
      Các file .env, log, cache, build và dependency directories được ignore.

Giới hạn: PostgreSQL dùng scheduler_test cô lập; Maximo/Entra giả trong suite.
      Kết quả này không xác nhận remote upload hay UAT nhiều người dùng; không ghi Maximo.

## CI cho backend/frontend và PostgreSQL — 2026-10-07

Checkpoint ban đầu trước khi đọc Actions logs; kết quả runner và bản sửa tiếp được ghi
trong mục “Nhóm 100/200 WO, keyboard/focus và CI/container” bên dưới.

- [x] Thêm `.github/workflows/ci.yml` cho push, pull request và chạy thủ công; ba job
      độc lập trên Ubuntu 24.04: backend fast, PostgreSQL migration/integration, frontend.
      Dùng lockfile frozen/npm ci, token chỉ đọc, checkout không lưu credential,
      concurrency cancellation và timeout. Checkout/setup-uv/setup-node khóa SHA release
      chính thức; không thêm dependency runtime hoặc nạp secret Entra/Maximo vào CI.
- [x] Khóa `.python-version` từ 3.12 thành 3.12.14 khớp Dockerfile/local đã kiểm tra;
      CI dùng uv 0.11.9 và Node 26.0.0 hiện có. Không nâng package/lockfile.
      Mục đánh giá/pin toàn bộ runtime/image vẫn chưa hoàn thành, PostgreSQL còn tag 17-alpine.
- [x] `actionlint` 1.7.12 qua. Backend 236 tests qua: 136 fast và 100 PostgreSQL;
      Ruff lint/format qua. Frontend 138 tests/12 files, ESLint, TypeScript/build qua.
      `uv sync --frozen` qua với môi trường local hiện có.
- [x] Upgrade/check/downgrade base/upgrade/check qua trên database tạm mới tạo từ
      PostgreSQL test riêng; hai lần schema check không lệch. Xóa đúng database tạm sau
      kiểm tra; không downgrade DB ứng dụng hoặc database test đang chứa dữ liệu.
      Tài liệu CI/README/status cập nhật; diff và liên kết nội bộ qua.
- [x] Đối soát 2026-10-07: CI commit `dd9cae6` tồn tại trên GitHub; local main khớp origin/main.
- [ ] Xác minh cả ba job success trên GitHub Ubuntu sau bản sửa setup-python;
      run trước sửa đã đọc: frontend success, hai backend failure. Xem cập nhật tiếp bên dưới.
- [ ] Cấu hình required checks/branch protection nếu chủ dự án chọn chính sách merge này.

Giới hạn: kiểm chứng thực thi hiện trên Windows local với PostgreSQL 17 trong Docker;
      chưa chứng minh Linux clean install hoặc GitHub Actions thành công. Không commit/push,
      không đổi repository settings, không gọi Maximo/Entra thật hoặc ghi dữ liệu nghiệp vụ.
      UAT 10 phiên, ETag/conditional update và remote upload vẫn pending.
      Hướng dẫn/phạm vi: [CI](ci.md).

## Đối soát toàn bộ checklist 1–6 — 2026-10-07

- [x] Đối chiếu 99 checkbox gốc (55 đã tick, 44 chưa tick) với mã, migrations, tests và
      ghi nhận live trong repo. Trong 44 mục chưa tick: 12 đã làm, 21 một phần,
      9 chưa đủ kiểm chứng, 2 chưa triển khai; bảng từng mục ở [đối soát](checklist-review.md).
- [x] Tick phần đã có bằng chứng, tách các mục gộp implementation/local live với UAT,
      scopes khác/Offshore và write contract; cập nhật CSRF/Planner/audit/PIC/nháp nhóm,
      timezone/Finish suy ra và migrations tới 0007. Không dùng mocks để tick yêu cầu live.
- [x] Đối chiếu Git hiện tại và GitHub connector: CI đã commit/push trong dd9cae6;
      combined commit statuses rỗng không chứng minh Actions chưa chạy hoặc đã thành công.
      Vì chưa có job results, kết quả runner vẫn pending; task đối soát không commit/push thêm.
- [x] Lập kế hoạch có phụ thuộc/tiêu chí nghiệm thu: nhóm lớn/keyboard, CI/images,
      admin/roster, runtime DB role/retention, read contract/scopes, tenant/staging và write contract.
      Đồng bộ README/intake/Entra/reader/status/CI; diff, links và coverage 99 hàng qua.

Giới hạn: chỉ sửa tài liệu, không chạy lại application tests; dùng bằng chứng 2026-10-07
      ở task CI (236 backend + 138 frontend, lint/typecheck/build, migrations DB tạm).
      Không gọi Maximo/Entra hoặc thay credential/grants/dữ liệu; live evidence từ các
      task trước, không phải kiểm chứng mới. Mục 7–10 giữ nguyên phạm vi.

## Nhóm 100/200 WO, keyboard/focus và CI/container — 2026-10-07

- [x] Hoàn tất phần synthetic của ưu tiên 1 trong đối soát: 100/200 WO group apply,
      row exceptions, Reset/Undo, paste CRLF hợp lệ/lỗi cuối nhóm, preview/save/reopen;
      stale baseline/version, invalid PIC, thu hồi grant giữa I/O và delayed response.
      PostgreSQL kiểm tra không có Draft/DraftItem/receipt một phần khi lỗi, replay/update/owner.
- [x] Sửa vòng Tab/Shift+Tab, focus khi mở/đóng/chooser→editor và sau Save disabled;
      giữ focus đúng khi thay panel bằng WO khác, gỡ listeners khi route ẩn và giữ edits.
      Version409 nhóm khóa lưu lại cho tới mở lại đối chiếu; không xóa edits.
- [x] Reviewer GPT-6 Astra/high rà soát read-only theo AGENTS mới: không có finding
      blocking/policy/API; finding P3 focus trả về WO cũ đã sửa và reviewer xác nhận.
- [x] 244 backend tests (136 fast + 108 PostgreSQL) qua trên Windows và Docker Linux;
      Ruff lint/format qua. Frontend clean npm ci, 151 tests/14 files, lint/typecheck/build qua.
      Chromium 154, viewport 1600×1000: native phím/focus/paste/Undo/preview/save/reopen,
      giữ edits Settings và radio ArrowDown/Tab/Enter qua; 27 synthetic API calls, không errors.
      [Bằng chứng và số đo](large-batch-keyboard-tests.md); không gọi Maximo/Entra thật.
- [x] Đọc Actions runs 37588420363/37590200157 và job logs run mới nhất: frontend Ubuntu
      success, hai backend fail vì uv0.11.9 thiếu Python3.12.14 Linux download. Setup-python
      v7.0.0 khóa SHA xác minh, đọc Python pin; frozen sync cấm download để dùng đúng binary.
- [x] Khóa base image digests đã xác minh; backend/web builds qua. Backend UID10001,
      live/readiness DB-schema-only trả ok; nginx -t qua. Migration upgrade/check/downgrade/
      upgrade/check và 244 tests qua trên PostgreSQL tạm Linux riêng, không publish host port.
- [x] Vá riêng source-map-js transitive dev 1.2.1 → 1.2.2 theo GHSA-68fv-2mgg-jv7q;
      package.json không đổi, không thêm dependency runtime. Clean install/build và npm audit
      0 advisories qua. [Container/CI evidence](container-checks.md), [CI](ci.md).
- [ ] Commit/push bản sửa rồi xác minh corrected GitHub Ubuntu run; hiện chưa có run cho working tree này.
- [ ] Monthly-load/10 planner live, toàn bộ keyboard-only/accessibility UAT, runtime lifecycle/
      security patch review và image scans, full staging Compose/HTTPS còn pending.

Giới hạn: browser APIs hoàn toàn giả; PostgreSQL là test infrastructure cô lập. Không ghi
      Maximo, thay credential/grants thật, deploy, commit/push hoặc đổi repository settings.
      Container tạm được dọn, images local-check giữ local. Các thay đổi AGENTS/README/.codex
      và docs/codex-agents.md từ chat khác được giữ nguyên. Ưu tiên tiếp: CI run sau push;
      sau đó bootstrap/admin UI và roster tid/oid được duyệt, DB roles/retention, read scopes/
      tenant staging và write contract theo [kế hoạch](checklist-review.md).


## Admin, DB roles và hồ sơ IT/write contract — 2026-10-07

- [x] GET admin roster đúng configured tenant/PERSON connections, current authority,
      no-store và không trả host/secret; PUT Planner kiểm tra crew discipline khi cấp,
      cho revoke assignment cũ. `/admin` phân biệt assignment và quyền DB gần nhất;
      session/identity recheck, CSRF, fail-closed và delayed read/error reconciliation.
- [x] Bootstrap first-admin dry-run/execute, exact tid/oid/active user, transaction lock,
      authority + global append-only audit 0008; user mới default admin=false. Chủ dự án
      chọn bản thân; local DB Entra 55433 additive 0007→0008 + Alembic check qua,
      preview đối chiếu rồi execute cho identity đã login. Đọc lại admin=true, đúng một
      authority audit; một WO grant/một Planner assignment vẫn nguyên như trước.
- [x] Provisioning roles trên DB riêng mới: runtime không sở hữu DB/schema/function,
      không membership/DDL/TEMP/TRUNCATE/nâng admin/gỡ hoặc sửa/xóa audit. Có test login
      runtime thật, unsafe ownership/prior ACL/default grants/future objects; không xóa
      receipts/uploads. Compose tách owner/runtime DSNs; CI đảm bảo psql test client.
- [x] Cleanup chỉ expired auth flow/session, dry-run mặc định, execute opt-in; tests giữ
      các phiên/flows còn hạn. Local dry-run thấy 6 session/0 flow hết hạn, không xóa.
      Không chọn thời hạn hoặc purge nháp/receipts/audit khi chưa được IT duyệt.
- [x] Chuẩn bị [hồ sơ IT](it-acceptance.md), roster mẫu, read/tenant/staging acceptance,
      [DB/retention runbook](database-operations.md) và [write contract](maximo-write-contract.md).
      Ghi single-resource href/orgid/token, exact ETag, stale/concurrent rejection,
      read-back, dates/null/PIC/duration/target và durable intent trước mọi test mutation.
      Collection ETag/baseline hash không được coi là revision WO; upload vẫn chưa có.
- [x] Kiểm chứng: 254 backend tests (136 fast + 118 PostgreSQL) qua; Ruff lint/format;
      0008 isolated downgrade/upgrade và Alembic drift clean. Role test cuối qua sau
      native psql portability + SQL cleanup. Frontend 160 tests/16 files, lint/typecheck/
      production build qua. Reviewer Astra/high rà soát và xác nhận sửa các blockers
      schema/function ownership, default privileges và admin refresh/auth failure.
      Compose config với DSNs synthetic, actionlint và links/placeholders/diff checks qua.
- [ ] IT đối chiếu operator/staging, DB provisioning thật và backup/restore;
      secret manager/reference resolver chưa có. Quyền mặc định/retention chủ dự án chốt 08/10 bên dưới.
- [ ] Nghiệm thu read đầy đủ các discipline/Offshore, web/workbook cùng snapshot,
      Ubuntu routing, tenant portal/MFA/assignment/guest và HTTPS staging.
- [ ] Xác minh write contract/ETag live trước
      sender/upload. Không tick các mục live từ synthetic evidence.

## Quyết định quyền/retention và probe write contract — 2026-10-08

- [x] Chủ dự án là admin; không cần roster cố định. Entra identity + PERSON discipline
      hợp lệ cấp read theo từng connection; Planner chỉ do chủ dự án cấp khi cần.
      Giữ cơ chế read/explicit Planner hiện tại; không thêm quyền hoặc sửa grant thật.
- [x] Giữ receipts/upload/audit; không purge theo tuổi. Tự xóa nháp sau toàn bộ upload
      được read-back xác nhận; partial/conflict/unknown hoặc nháp sửa tiếp phải giữ.
      Ghi rõ finalizer chưa có, manual scoped/version discard vẫn có.
- [x] Nhận production origins Onshore bd-maxapp và Offshore bdpqp-maxapp;
      ghi tại [intake](integration-intake.md), không đoán context path/OSLC hoặc đăng ký
      connection production. Onshore/Offshore là hệ thống, không phải vị trí người dùng.
- [x] Probe GET bounded test-only, stable identity/PERSON/Planner trước/sau, origin pinning,
      no redirect, identity/scope và exact token classification. Không thêm dependency/migration.
      Reviewer Astra/high rà soát read-only: không có blocker cho probe GET.
- [x] Main chạy 214 backend fast tests qua (134 integration deselected); Ruff lint/format
      các files probe qua. Không thay FE nên không tính FE tests lịch sử là rerun.
- [x] Live Onshore test E&I: PERSON recheck, 117 WO tháng 10, 7 CM phù hợp; chọn
      P13463520/BD1/523961, single resource 200/orgid BDPOC. Href quảng bá origin khác
      không được theo. ETag `0` qua các GET variants, rowstamp `3235810749` chỉ là evidence;
      [write contract](maximo-write-contract.md) ghi conditional token chưa xác minh.
- [ ] IT xác minh token/header và cấu hình ETag của đúng OSLC endpoint; audited authenticated
      test harness chứng minh success/token advance/stale rejection/concurrency/restore.
      Chủ dự án đã cho phép mọi thử nghiệm cần thiết trên Onshore test ngày 08/10;
      không chờ thêm xác nhận WO/field/window. Hành vi endpoint vẫn cần bằng chứng live.
- [ ] Sender + immutable source draft/version/member linkage + confirmed-only finalizer,
      production/scopes khác, tenant/Ubuntu HTTPS staging, DB runtime/backup nghiệm thu thật.

Giới hạn: chỉ đọc Maximo test, không mutation/upload; không tự dùng rowstamp hoặc hash
thay If-Match. Không purge, provisioning DB thật, deploy, gửi IT, commit/push hoặc gọi
production. Local readiness API ok; không tính browser login/UAT mới là đã kiểm chứng.

Giới hạn: không gọi mutation Maximo hoặc gửi email IT, không deploy/commit/push.
Thay đổi dữ liệu thật chỉ là additive migration/admin bootstrap local được chủ dự án
chọn; không thay WO/Planner grants, không chạy role provisioning hoặc cleanup execute
trên DB thật. Không có browser live admin test hoặc corrected GitHub runner cho working tree.
Các thay đổi batch/CI/agent có sẵn được giữ nguyên; các mốc tests Linux trước là lịch sử,
không phải Linux rerun cho admin mới.

## Diễn tập backup/restore PostgreSQL cô lập — 2026-10-08

- [x] Thêm `backup_restore_rehearsal.py`: chỉ nhận cấu hình integration đã guard,
      tạo nguồn/đích và owner/runtime riêng bằng UUID, migrate/seed dữ liệu synthetic,
      pg_dump custom-format và pg_restore transaction; không nhận DB nguồn thật.
      Kiểm tra container test port mapping; giữ credential ngoài argv/output;
      cleanup chỉ objects đã tạo thành công và archive tạm.
- [x] Main chạy Docker PostgreSQL 17: revision 0008, 17 bảng/32 hàng dữ liệu khớp
      sau restore; schema/type modifiers/owners/ACL/default privileges/triggers qua.
      Audit append-only và các quyền runtime được thử còn đúng; recovery sending cũ
      thành unknown, không tự resend, giữ unique lock WO; reconciliation có audit.
      [Bằng chứng/command/giới hạn](database-operations.md#diễn-tập-cô-lập-bằng-dữ-liệu-synthetic).
- [x] Sửa lỗi row lock phát hiện dưới runtime: transition/recovery chỉ FOR UPDATE OF
      upload_item, không khóa bảng batch chỉ được đọc/insert. Không mở rộng quyền DB.
      Thêm 20 tests cho guard/credential/cleanup failure và tích hợp CLI vào CI dùng
      binaries PostgreSQL 17 trong service container, tránh client Ubuntu khác major.
- [x] Reviewer Sol/high review độc lập một lượt: không có P1; finding P2 thiếu schema
      ACL/default privileges/type modifiers đã sửa và Main đối chiếu catalog queries,
      chạy lại rehearsal thực tế. Toàn bộ 368 backend tests (234 fast + 134 PostgreSQL)
      qua; Ruff lint/format, actionlint, docs links/placeholders và diff check qua.
- [ ] Backup staging/Ubuntu, RPO/RTO, offsite/encryption/retention, phục hồi roles/secret
      trên cluster khác và corrected GitHub run sau commit/push vẫn cần nghiệm thu.

Giới hạn: dữ liệu hoàn toàn synthetic, cùng cluster test; runtime dùng SET ROLE,
chưa nghiệm thu login runtime hoặc vận hành staging. Native client transport chưa chạy
local; Docker17 đã chạy. Không đổi frontend, migration, credentials/grants thật;
không gọi Maximo/Entra, deploy, commit/push hoặc bật lịch backup. Upload tiếp tục chờ
write contract/conditional update live; ETag `0` chưa chứng minh chống stale write.

## Nghiệm thu browser preview và audited write probe — 2026-10-08

- [x] Chủ dự án yêu cầu nghiệm thu preview với nháp Onshore test và cho phép nối/thử
      mọi phần cần thiết trên hệ thống này, không hỏi lại WO/field/window/restore.
      Đây là authorization test; production và kết nối khác vẫn chưa nghiệm thu.
- [x] Browser đăng nhập Entra mới, Onshore test/E&I scoped Planner; nháp đơn
      P13469545 v2 đọc lại Maximo thành công, hiện current/proposal và upload khóa.
      Sửa duration 10.5→10.75 chưa lưu hủy preview/khóa đối chiếu; không lưu đè nháp cũ.
- [x] Retrieve đủ 117 WO tháng 10; app chặn lập nhóm mới từ WO đã có nháp.
      Tạo fixture riêng P13462775/P13465570: nháp nhóm PIC BANPV, v1; save/reopen từ
      server đúng v1, preview cả hai WO khớp và upload khóa. Sửa PIC chưa lưu hủy
      preview; trả lại BANPV, không lưu v2. Ba nháp ban đầu giữ nguyên.
      Fixture nhóm còn lưu để xem nghiệm thu; ảnh `.cache/p7-group-preview.jpg`.
- [x] Harness operator-only giữ một active WO reservation, committed intent từng POST,
      current Entra/PERSON/Planner/scope; wrong/stale negatives là no-op, readback và
      conditional restore. Recovery probe riêng chỉ remote GET, chỉ giải phóng unknown
      khi exact original baseline; không xử lý sending còn có thể in-flight.
      Review Sol/high + một focused P1 recheck, main sửa/kiểm tra các finding phụ.
- [x] Live advertised ETag probe P13463520: wrong sentinel và exact ETag0 đều trả412
      BMXAA8229W; đọc lại estdur20.0/baseline nguyên trạng. Audit item kết thúc failed,
      không giữ reservation; không có write thành công, không chạy pair/stale/restore.
      [Chi tiết](maximo-write-contract.md). Upload gate của app giữ khóa.
- [x] Live rowstamp candidate được chọn rõ ở harness: sai sentinel và exact current
      rowstamp no-op đều412 BMXAA8229W. Dừng trước positive, baseline20.0 nguyên trạng;
      audit item failed, không giữ reservation. Không tự đổi quoting/token/app gate.
- [x] Full backend439 tests qua, gồm PostgreSQL và rehearsal Windows/Docker; Ruff qua.
      Probe suite127 tests gồm9 PG: real commit visibility, reservation, guard denial,
      unknown exact-original reconciliation và sending refusal. Không dependency/migration.
- [x] Xác định usable conditional token/representation sau ETag0 và raw rowstamp bị412:
      JSON `_rowstamp` qua full fresh/stale/same-token pair/readback/restore08/10,
      xem mốc sửa lỗi bên dưới. Fields/date/PIC/null/target trước sender thật còn pending.
      Không coi HTTP412 của ETag0 là bằng chứng mọi conditional token không được hỗ trợ.

Giới hạn browser: route-away/late-response còn dựa automated tests; gặp IAB CDP/click
bridge treo ở tab cũ, phiên sạch phục hồi tương tác và hoàn tất nhóm, không sửa code
theo lỗi tool. Không upload fixture, gọi production, deploy, commit/push hoặc gửi IT.

Read-only schema xác nhận root WORKORDER/persistent schedule fields; conditional GET
raw/quoted0 và rowstamp đều200/ETag0, không304. Chưa có evidence cho một write token
khác ở thời điểm đó. Server logs/config có thể giải thích ETag0/header rejection;
workspace không có quyền đọc trực tiếp. Sau phép thử JSON rowstamp bên dưới, logs
không còn là dependency bắt buộc để tiến tiếp trên Onshore test. Không cần xác nhận
lại quyền test; field contract và sender/app gate vẫn cần triển khai/kiểm chứng.

- [x] 08/10: đối chiếu lại endpoint/path, POST override PATCH, JSON estdur, If-Match
      và transaction IDs từ harness/hồ sơ audit để trình bày request lỗi cho chủ dự án.
      Chỉ đọc mã/evidence đã lưu, không resend hoặc gọi Maximo mới; chỉ giữ HTTP412 và
      reasonCode BMXAA8229W, không có raw response message/body trong audit.

## Sửa lỗi conditional OSLC — 2026-10-08

- [x] Đối chiếu tài liệu IBM và response thực tế: header ETag0/raw rowstamp bị412;
      thêm explicit TEST-only `rowstamp_body_candidate` gửi native `_rowstamp` trong
      JSON. Không fallback unconditional, không nối transport vào API ứng dụng.
- [x] Sửa conflict classifier:412+BMXAA8229W không đòi message phải có WORKORDER,
      vẫn từ chối known child;400/409 đòi WORKORDER. Negative chỉ là bước đầu;
      bắt buộc current/no-op/fresh/stale/pair/readback/restore đầy đủ mới đạt.
- [x] Live P13463520/BD1/523961: wrong412/current204/fresh204/stale412/pair204+412/
      restore204. estdur20→21→22→20; toàn bộ PIC/ngày/baseline khôi phục đúng.
      Rowstamp tiến3235810749→3624646770→3624646774→3624646778, ETag vẫn0.
      Audit item38f274be-2eee-4d47-873d-eb3bdf6c6657 confirmed29events; reservation
      giải phóng sau verified restore. [Evidence](maximo-write-contract.md).
- [x] Main full backend453 tests qua trước narrow classifier fix;148 targeted tests
      (10 PostgreSQL) sau fix và Ruff qua. Không dependency/migration/server changes.
- [ ] Tiếp theo: live field contract date/PIC/duration precision/null và target CM;
      PM/CFT target cấm trước outbound. Sau đó tích hợp sender dùng body precondition,
      recheck current authority/WO, audit, readback/unknown recovery và UI upload UAT.

Giới hạn: chỉ verified configured Onshore test CM duration/resource đã chọn; không
chứng minh mọi connection/PM/CFT/field hay runtime/staging/crash. App upload giữ khóa.
Không cần IT logs để tiếp tục các phép thử TEST này; không deploy/commit/push/gửi IT.

## Đối chiếu IBM OSLC/REST reference — 2026-10-08

- [x] Đọc URL Overview chủ dự án cung cấp và các mục Create/update, Selecting,
      API keys, Duplicate requests. Đối chiếu reader/contract/write probe: lean1,
      POST overridePATCH, member href-derived REST ID, apikey header và transactionid
      đúng guide; _rowstamp dirty-update purpose phù hợp live conditional proof.
- [x] Ghi reference matrix trong [write contract](maximo-write-contract.md), phân biệt
      documented semantics và live evidence: null omission khác write clear; child
      PATCH khác MERGE; duplicate409/retention chưa live verified, không thay receipts.
      Docs-only, kiểm tra link/consistency/placeholders và diff whitespace; không resend
      Maximo, không đổi code/server/settings/gate, không chạy lại application tests.
- [ ] Ưu tiên tiếp theo vẫn là field contract date/PIC/duration precision/null/CM target,
      rồi sender body precondition và browser upload UAT trên Onshore test.

## P7 nối sender và browser upload — hoàn thành phạm vi CM Onshore test 2026-10-08

- [x] Chủ dự án đồng ý tiếp tục field contract, sender và browser UAT; quyền thử
      Onshore test/khôi phục đã có, không xin lại field/WO/window.
- [x] Live field harness item05bdf081-83c4-4c28-b850-2adc738bcf5f trên P13463520:
      wrong412, current/no-op/null và bốn ca positive/restore đều204; duration20.25,
      schedule+1h7m13s, PIC ANHTQ1→null và CM target exact. Mỗi ca khôi phục toàn bộ
      baseline trước ca tiếp theo.159 targeted tests/Ruff trước live qua.
      [Evidence và giới hạn](maximo-write-contract.md).
- [x] Tích hợp sender chỉ explicit verified TEST connection/non-production, native
      rowstamp từ exact resource, giữ immutable source revision nháp riêng với fresh
      write revision; CSRF/scope/current PERSON/Planner/audit/readback vẫn bắt buộc.
- [x] Submit idempotent receipt kể cả source đã finalized; chỉ xử lý pending,
      tối đa10 WO mỗi request; explicit continue/status/unknown read-only reconcile.
- [x] Giao diện kết quả từng WO và exact-version finalized callback/refresh; không
      gửi lại unknown, không polling hoặc mất unrelated unsaved drafts.
- [x] Focused independent review sender + trực tiếp related FE paths, full appropriate
      checks, browser upload/restore fixture riêng; giữ nguyên các nháp cũ.

Bằng chứng: full backend 500 tests (PostgreSQL và backup/restore) qua; frontend 175
tests/16 files, typecheck/lint/build qua. Independent Sol/high không có P1; P2 sửa
và main kiểm tra. Sau minor receipt-toolbar fix, 60 WorkOrders tests/typecheck/lint
qua; browser lần restore không còn recovery button thừa. Live P13467327/BD1/531789
duration 5→6→5, hai lần app upload confirmed/source finalized, lookup receipt chỉ đọc;
trình duyệt hiển thị Maximo 5.0, PIC/ngày lịch vẫn trống. Nháp cũ ba đơn và một nhóm
giữ nguyên. [Hồ sơ audit/UAT](upload-workflow.md).

Giới hạn và việc tiếp theo:
- Yêu cầu browser UAT riêng từng mã type đã được chủ dự án thay bằng nghiệm thu hai
      nhóm target ngày2026-10-09; lịch sử phạm vi gate tại mốc CM bên dưới được giữ.
      PM/CFT vẫn cấm target. Null-clear app chưa được mở; giới hạn số/ngày phải kiểm tra riêng.
      2026-10-08 conditional-duration đã đạt trên7 type còn lại; ngày/PIC/target
      từng type chưa đủ coverage nên app sender vẫn CM. Xem mốc kiểm chứng bên dưới.
- [x] 2026-10-08: browser live nhóm hai CM upload/restore fixture riêng trên Onshore test:
      P13467496 duration11→12→11 và P13467932 duration10.5→11.5→10.5.
      Mỗi lượt UI confirmed2/2, làm mới giá trị Maximo, đóng panel và bỏ đúng markers;
      không còn receipt recovery thừa. Baseline được ghi độc lập trước gửi.
      Read-only audit:4 POST đều204/confirmed,24 events, cả hai nhóm finalize sau
      đủ2 confirmed trong một transaction; sáu fields exact original, không còn
      active reservations, các nháp cũ giữ nguyên. Không sửa code/config hoặc chạy
      lại application suite trong lượt UAT này; diff/docs consistency qua.
      [Hồ sơ nhóm](upload-workflow.md). Nhóm lớn/partial/conflict/unknown vẫn chỉ có
      synthetic tests; không coi thành công hai WO là nghiệm thu mọi trường hợp.
- [ ] Worker/lease và crash recovery tự động; hiện sending sau crash cần xác định process
      ownership trước operator recovery, unknown chỉ đối chiếu đọc, không retry mù.
- [ ] Ubuntu/staging HTTPS/routing, tenant policy, Offshore connection và 10 planner live
      còn phụ thuộc hạ tầng/quyền/test roster từ IT; chưa deploy hoặc mở production.

## Conditional write các WO type còn lại — 2026-10-08

- [x] Scoped October E&I inventory117 WO: CM25, PM70/CFT11/OVERHAUL4/General3/
      REC2/MoD1/Routine1. Chọn7 root WO không có nháp của bất kỳ owner hoặc active
      reservation; lưu exact baseline độc lập trước thử.
- [x] Operator probe chọn exact case-preserved type; non-CM chỉ cho duration và
      explicit native JSON rowstamp. Reader/app mặc định CM, không mở gate từ client;
      PM/CFT target và non-duration non-CM bị chặn trước audit/network.
- [x] Live PM P13469691, CFT H14302007, REC P13469038, OVERHAUL P13468596,
      MoD P13439902, General P13457667, Routine H14306831: wrong412/current204/
      fresh204/stale412/pair204+412/restore204 đều đạt. Không suy winner từ thứ tự
      response; đối chiếu label/transactionid và readback. Final audit7 items confirmed/203events/49POST
      transaction IDs với committed intent và result tương ứng, actor đúng.
      Cả7 exact six-field baseline bằng ban đầu; không còn active reservation,
      ba nháp đơn cũ và nhóm hai WO giữ đúng version/membership.
- [x] Browser PM/CFT Change Target/Target Start/Target Finish đều disabled;
      không lưu nháp hoặc thử ghi target. Full backend531 tests qua (4 known warnings),
      Ruff qua; main review type boundaries, diff/docs consistency qua. Không FE,
      API/schema/dependency/config changes trong mốc này.
- [x] Date/PIC/allowed target field contract từng non-CM type, gồm exact-null
      restoration có guards; hoàn tất09/10, bằng chứng ở mốc tiếp theo.
- [ ] Browser app upload từng non-CM type trước khi mở gate; xử lý PM date/duration
      side effect đã đo trong field proof trước browser UAT.

[Bảng WO/item và phạm vi bằng chứng](maximo-write-contract.md). Chỉ E&I Onshore test
open root WO đại diện trong tháng10; không suy rộng sang discipline/connection/type
không thấy trong inventory. Chưa deploy/commit/push hoặc mở production/Offshore.

## Field contract non-CM — 2026-10-09 (đã nghiệm thu)

- [x] Chủ dự án yêu cầu kiểm chứng ngày lịch/PIC/allowed target và exact restore;
      áp dụng7 type đã qua duration proof. PM/CFT target luôn cấm.
- [x] Operator-only field plan bất biến theo label/payload, exact original null schedule
      pair/PIC restoration và exact original PIC ngoài crew (preflight no-op trước
      positive). Giữ default duration probe và app gate, không mở API clear/null.
- [x] 263 related tests gồm isolated PostgreSQL qua; Ruff toàn backend qua.
      Independent Sol/high review new field-mode không còn P1 sau fixes: diagnostic-only
      không được chạy positive fields; mọi duration-mode chỉ estdur; low-level payload
      numeric/finite/bounds/exact serialization được kiểm tra trước intent/network.
      Main kiểm tra fixes, không chạy thêm independent review cho minor guard.
      Tests/review focused new field-mode boundary trước live; audit từng POST,
      recheck quyền/current WO và dừng unknown, không fallback/unconditional retry.
- [x] Live từng type tuần tự: schedule/PIC/allowed target positive rồi restore từng
      ca về toàn bộ baseline; độc lập audit cuối, giữ nháp cũ và giải phóng reservation
      chỉ khi kết quả đã xác minh.

Live preflight ban đầu chưa chạy: phiên Entra hết hạn, active verified session guard
dừng trước network/reservation. Ngày09/10 đã sửa login503: backend local được launch
trong sandbox có proxy từ chối kết nối (ProxyError/WinError10061); cùng settings MSAL
ngoài sandbox tạo flow được. Khởi động lại owned backend với network permission phù hợp,
GET login303 Microsoft/secure flow cookie, readiness200; browser callback/SSO thành công
Nhat Nguyen Hoang Onshore test/E&I. Không sửa credential/TLS/grants hoặc tạo session giả.
Sau khi login phục hồi đã capture fresh plans trước live field mutations.

Main full backend590 tests qua (4 known warnings) sau tất cả fixes ngày09/10;
PostgreSQL/backup-restore và app CM gate regressions có trong suite. Không đánh dấu
schedule/PIC/target non-CM đã verified chỉ từ mocks.

Login đã phục hồi như bằng chứng bên trên. Fresh7 preflight đã qua, baselines/typed
plans ghi `.cache/p7-fields-types-initial.json`. Phép thử PM P13469691 dừng unknown
với reservation giữ lại: schedule+1:07:13 đã áp dụng đúng/HTTP204, nhưng Maximo tự
đổi estdur25→21 (quan sát readback, chưa biết server rule/config). Fraction25.25 và
restore25 trước đó đều exact; target/PIC chưa đổi. Lúc dừng các type khác chưa gửi.
Sau đó chuẩn bị scoped audited recovery ngày lịch gốc + duration25, freshconditional và
exactsixfield readback trước release. Không gọi lại wholeprobe hoặc retry mù.

Recovery PM đã hoàn tất: request ngày gốc+estdur25 có HTTP204 nhưng readback còn21;
ngày/PIC/target đều đúng gốc. Phase riêng duration-only, chỉ sau settled204 và fresh
pin/otherfields exact, gửi estdur25 HTTP204; readback original_state_exact=true và
reservation_released=true. Hai immutable recovery plans/intent giữ nguyên lịch sử
unknown; không lặp payload trước. Recovery PostgreSQL17 tests qua, gồm timeout giữ
unknown và cấm replay. Đã cập nhật schedule experiment để ghi nhận auto duration
và restore duration riêng, trước khi thử tiếp bảy type.

Nghiệm thu hoàn tất09/10: PM/CFT/REC/OVERHAUL/MoD/General/Routine đều confirmed,
schedule/PIC/fraction và allowed targets có positive readback/exact restore; PM/CFT
zero target payloads. Date/PIC original null được restore thật, MoD SONNA gốc
được phục hồi. PM schedule tự tính25→21, sau date restore gửi duration-only trả25;
sáu type khác duration không đổi khi cập nhật ngày. Audit độc lập448 events,
84 unique TXIDs/intent/results (7 wrong-token412,77 còn lại204), all6fields bằng
initial originals, zero reservations; bốn source drafts cũ giữ version/membership.
Evidence `.cache/p7-fields-types-audit.json` và receipts/initial/recovery artifacts.
Main full backend616 passed/4 known warnings, Ruff qua; không thay API/schema/
dependencies/config/gate trong field milestone. Login503 đã xử lý và browser vào
Work Orders đúng Onshore test/E&I, bằng chứng `.cache/p7-login-workorders-recovered.jpg`.

- [x] Ưu tiên tiếp: xử lý preview/upload semantics ngày và duration PM dựa trên
      side effect đã đo; API app phải báo đúng kết quả khi Maximo tính lại duration.
- Coverage sender/UAT riêng từng mã type được thay bằng gate chung tám mã và tests
      theo hai nhóm target theo quyết định chủ dự án2026-10-09. PM đơn/nhóm và CFT
      duration đã qua; không đánh dấu các browser type chưa chạy là đã nghiệm thu.

## Preview/readback duration PM — 2026-10-09

- [x] Cảnh báo theo WO ở preview nháp đơn/nhóm và API upload preview khi PM thực
      sự đổi schedstart hoặc schedfinish. Duration edit tự đổi finish cũng cảnh báo;
      không đoán calendar hoặc con số duration thực tế trước upload.
- [x] Sau known successful write, chỉ xác nhận duration Maximo tính lại khi PM đổi
      ngày, estdur không có actual change và toàn bộ baseline khác exact. Audit lưu
      expected/actual/full snapshot/revision trước confirmed; finalize và reconcile
      yêu cầu pinned actual snapshot exact, không dung thứ drift về sau.
- [x] Explicit duration mismatch vẫn unknown/reserved, giữ nháp, trả expected/actual
      cho UI; timeout không được suy ra recalc success. Không POST bổ sung hoặc retry.
      Khi reconcile đạt exact expected, receipt bỏ mismatch hiện tại, audit cũ giữ lại.
- [x] Mọi preview item trả warnings[], mọi receipt item trả duration_result|null;
      FE kiểm tra code/state và duration finite/nonnegative/bounds. Dữ liệu duration
      không hợp lệ có display null, không phá receipt của cả nhóm.
- [x] Main full backend629 passed/4 known warnings; backend focused51 PG tests,
      Ruff qua. Independent Sol/high review không có P1; P2 cảnh báo local thiếu
      finish-only đã sửa, main kiểm tra lại. Full FE181 tests qua, typecheck/lint/build
      qua, gồm batch100/200WO và warnings theo từng PM. Không migration/dependency.
- [x] Browser real Onshore test/E&I preview P13469691/BD1/536549 đã hiện cảnh báo
      và gate upload vẫn đóng. Nháp kiểm chứng riêng a043956f-4fce-4fbf-9237-95ba6240aac4
      v1 được giữ để xem; bốn source drafts cũ giữ version/membership. Read-only audit
      xác nhận PM exact original six fields/25h và zero reservations. Không gửi WO
      mutation trong mốc này. Evidence `.cache/pm-duration-preview-browser.jpg`,
      `pm-duration-browser-audit.json`, `pm-duration-full-tests.txt`.

Ở mốc preview này chưa nghiệm thu PM app upload thật. Mốc browser tiếp theo bên dưới
đã xác minh PM đơn; PM/CFT target vẫn cấm, production/Offshore vẫn khóa.

## Browser PM upload/restore — hoàn thành phạm vi đơn Onshore TEST 2026-10-09

- [x] Sender native_rowstamp_test hỗ trợ CM/PM dưới opt-in hiện có, app dev/test và
      configured Onshore TEST; fresh scoped read/typed native pin/actor intent giữ
      nguyên. CFT/REC/OVERHAUL/MoD/General/Routine, production và Offshore vẫn khóa.
- [x] Immutable actor-scoped receipt restore_source.before giữ original PM khi source
      đã finalized. UI giữ first origin theo principal/connection/discipline/site/WO;
      date-only rồi duration-only proposals đều qua save/preview/upload bình thường.
      Không automatic POST/restore; PIC/target/type drift hoặc original ngày null khóa
      restore. Full reload chưa có UI nạp original từ history, audit server vẫn giữ.
- [x] Browser P13469691/BD1/536549 đổi lịch chỉ schedstart/schedfinish: HTTP204,
      confirmed và source finalized, Maximo duration25→21 có immutable actual snapshot.
      Restore cặp ngày gốc30/10 06:30→31/10 17:30+07 HTTP204/duration21; phase riêng
      chỉ estdur25 HTTP204, original all6 exact. Reopen không còn restore region/nháp.
- [x] Read-only independent audit19events,3unique transactions/3intents/3results204,
      không extra request, zero active reservations. PICnull/target không đổi hoặc
      outbound; bốn nháp cũ/năm members giữ exact version/baseline/proposals.
      Evidence `.cache/pm-browser-before-audit.json`, `pm-browser-final-audit.json`,
      `pm-browser-{upload-preview,positive,dates-restored,restored}.jpg`.
- [x] Backend641 tests/4 known warnings, frontend187 tests/typecheck/lint/build qua.
      Review Sol/high không có P1; ba P2 nullable-origin parser, interrupted receipt
      recovery first-origin và semantic date/duration equality đã sửa. Main kiểm tra
      fixes, recovery lookup integration và phase-by-phase browser UAT. Không migration
      hoặc runtime dependency. Credits interruption đã giải quyết sau owner bổ sung,
      standard browser API hoạt động trở lại, không workaround approval rejection.
- [x] Browser PM nhóm hai WO và restore từng WO đã qua mốc tiếp theo bên dưới;
      explicit-duration mismatch vẫn chỉ synthetic/PostgreSQL, chưa live cố ý.
- [x] Sender CFT và browser duration-only upload/restore đã qua mốc tiếp theo.
- CFT app lịch/PIC/nhóm và browser từng type là giới hạn bằng chứng lịch sử;
      chủ dự án không yêu cầu nghiệm thu riêng từng mã nữa. Nghiệm thu nhóm hỗn hợp
      theo hai nhóm target thay thế; null clear, production/Offshore và scope rộng
      vẫn chưa được mở bởi quyết định này.

## Browser PM nhóm và CFT duration — 2026-10-09

- [x] September E&I PM nhóm H14286978/BD1/2458816 (26h/PICnull) và
      H14288340/BD1/2461540 (24h/PICNGOCNH). Fresh preview có warning riêng từng WO;
      batch0104725f-5e51-474d-80cb-ee5bfb701b04 chỉ gửi schedstart/schedfinish,
      cả hai confirmed/source finalized. Duration thực tế lần này giữ26/24h;
      không suy mọi PM đều recalculates từ kết quả PM tháng10 trước đó.
- [x] Restore từng PM qua browser origin riêng: PM1 ngày16/09 06:30→30/09 18:30,
      PM2 ngày01/09 06:30→15/09 18:30+07. Hai request204/datepair-only, all6 original
      exact; không cần duration POST vì duration chưa đổi. PM1 origin clear không
      xóa origin PM2; reopen từng WO sau restore không còn region/marker nháp.
- [x] CFT H14302007/BD1/2488922 browser6→6.25→6h, hai request204 chỉestdur;
      schedule/PICnull và target gốc giữ nguyên. PM/CFT target khóa UI và backend;
      thêm CFT positive sender/receipt/duplicate/recovery PG coverage và target/
      clear/mismatched-type/revoked-authority unit tests. CM/PM/CFT opt-in Onshore
      TEST dev/test, năm type khác và production/Offshore vẫn khóa.
- [x] Independent read-only final audit:3WO all6original exact,6confirmed/finalized
      items,6unique TXIDs/6intents/6native conditionalresults204,36events;
      noextra POST, noPIC/targetpayload, zero active reservations. Bốn nháp cũ/năm
      members giữ exact version/baseline/proposals. Evidence
      `.cache/pm-group-cft-before-audit.json`, `pm-group-cft-final-audit.json`, `pm-group-first-restored.jpg`,
      `pm-group-second-restored.jpg`, `cft-browser-positive.jpg`, `cft-browser-restored.jpg`.
- [x] Main full backend644 passed/4 known warnings, Ruff và diff--check qua.
      Full run trong sandbox bị Docker/temp-file permission errors; chạy lại với
      local infrastructure permission phù hợp đạt toàn bộ. Evidence
      `.cache/pm-group-cft-backend-verified-tests.txt`. Frontend không đổi ở mốc này;
      bộ187 tests/typecheck/lint/build của mốc PM đơn vẫn là evidence trước đó.
- [x] Khoanh nguyên nhân Retrieve3months502 bằng read-only: firstcollection200,
      nextPage advertised https://maximo.biendongpoc.vn khác TEST configured
      http://bd-maxdev.biendongpoc.vn, reader dừng `Unsafe paging response` và không
      gọi host đó. Monthly September166/October117 đã qua browser. Không bỏ URL
      guard/đổi config/server; `.cache/pm-group-cft-read-diagnostic.json` giữ sanitized
      origin-only evidence. Không kết luận từ log/config server không truy cập được.
- Chủ dự án xác nhận test dùng DB sao chép production nên next-page mang host
      production; không yêu cầu sửa server hoặc rewrite paging trong mốc này.
      Vẫn chặn host khác khi đang chọn test. Pagination production chưa được
      kiểm chứng, cần kiểm tra khi nghiệm thu kết nối production, không suy đã qua.
- Yêu cầu mở guard/browser REC rồi từng mã khác được chủ dự án thay bằng hai nhóm
      target ngày2026-10-09; xem quyết định và kiểm chứng bước1 bên dưới.

## Quyết định gate theo hai nhóm target — 2026-10-09

- Chủ dự án chốt khác biệt quyền target giữa PM/CFT và các type còn lại; không yêu
  cầu nghiệm thu browser riêng từng mã. Các live operator contract/duration/fields
  bảy non-CM đã verified trước đó vẫn là evidence; không đổi thành browser evidence.
- Sender/preview dùng chung domain contract tám mã đã biết:
  CM/PM/CFT/REC/OVERHAUL/MoD/General/Routine. PM/CFT luôn cấm target, sáu mã còn lại
  chỉ đổi target với explicit change_target trong immutable saved proposal.
  Mã không hỗ trợ vẫn fail closed; production/staging/Offshore và default opt-in
  closed giữ nguyên. Không đổi grants, credentials, config, schema hoặc frontend.
- [x] Hoàn tất tests tự động native sender/PG API mọi mã: allowlisted targets với
      explicit intent, missing intent, PM/CFT forbidden targets, scope/authorization,
      durable intent/duplicate/conflict/timeout reconciliation và source finalization.
      Cả targstartdate/targcompdate:32 ca API qua; mỗi payload chỉ trường target đã
      chọn cùng rowstamp. Main full backend694 passed/4 known warnings, Ruff và
      diff--check qua; evidence `.cache/two-target-groups-backend-tests.txt`.
      Main rà soát gate/validation; backend local đã nạp lại, readiness200
      database-schema-only. Không live write Maximo trong bước1; frontend không đổi.
- [x] Bước2: nghiệm thu nhóm hỗn hợp PM/CFT/WO được đổi target trên TEST,
      preview/receipt/readback/restore từng WO. Chọn fixture restore chính xác;
      không bổ sung clear/null hoặc viết production trong phạm vi này.
      Hoàn tất ngày2026-10-09; bằng chứng chi tiết tại mục mixed browser dưới đây.
- [ ] Sau nghiệm thu chức năng: kiểm tra deployment Ubuntu/Docker/HTTPS, Entra callback,
      Maximo routes và backup/restore. Production setup cần IT và kiểm chứng riêng.

## Logo BDPOC trên web — 2026-10-09

- [x] Thêm PNG do chủ dự án cung cấp vào assets frontend và header chung, có alt text, giữ tỷ lệ trên nền trắng để đọc rõ ở header tối. Browser preview đã xác nhận hiển thị; evidence: .cache/bdpoc-logo-preview.png.
- [x] TypeScript/build và ESLint qua. Build cần quyền chạy tiến trình con ngoài sandbox (Vite spawn EPERM trong sandbox). Không thay đổi luồng WO/upload hoặc backend.
- Tiếp theo ưu tiên: nghiệm thu nhóm hỗn hợp PM/CFT/WO được đổi target trên Onshore test theo mục gate hai nhóm phía trên.

## Favicon Work Order Scheduler — 2026-10-09

- [x] Tạo favicon SVG chữ WOS (WO Scheduler) theo yêu cầu chủ dự án, màu trắng trên nền accent #0f62fe của web, góc bo tròn; dùng paths để không phụ thuộc font. Gắn rel=icon vào index.html.
- [x] TypeScript/build qua sau đổi WO thành WOS; browser render SVG và DOM trang work-orders xác nhận link favicon. Evidence .cache/favicon-wos-preview.png; không thay đổi dữ liệu hoặc nghiệp vụ.
- Tiếp theo ưu tiên: nghiệm thu nhóm hỗn hợp PM/CFT/WO được đổi target trên Onshore test.

## Mixed browser PM/CFT/allowed target — 2026-10-09

- [x] Bổ sung Target Start/Finish từng dòng BatchPlanner, tự đặt explicit intent;
      PM/CFT khóa cả controls và handler, không có group target apply. Undo/Reset
      giữ đúng các trường khác; nhập lại baseline gỡ target change và intent.
      Independent review phát hiện một P2 về thay đổi giả khi nhập lại baseline;
      đã sửa và main xác nhận browser số dòng đổi3→2→3. Frontend190 tests,
      typecheck/lint/build/diff-check qua. Backend không đổi;694 tests của bước1.
- [x] Baseline bất biến trước mọi write: PM P13469691/BD1/536549,
      CFT H14302007/BD1/2488922, REC P13469038/BD1/535211, Onshore TEST E&I.
      Forward cùng batch1bcf571d-c65a-463c-839b-849ff2386480 confirmed3:
      PM datepair Oct30 07:30→Oct31 08:30 (duration25→21 server-derived);
      CFT duration6→6.25 giữ lịch/PICnull; REC targetstartOct1 10:38→11:38
      explicit change_target=true, không đổi targetfinish/lịch/duration/PIC.
- [x] Restore qua browser: PM originaldatepair Oct30 06:30→Oct31 17:30
      batch22988ae2-49ed-491a-8370-554e2df1c556 rồi duration-only25
      batche98ce9a3-9800-4b5e-bee6-c10f35fcb6ad. CFTduration6 và RECtargetstart10:38
      cùng restorebatch8dec2205-ad11-4a5f-b018-330677811271 confirmed2.
      Reopen PM hiển thị gốc25 và không còn restore-origin section; REC targetgốc.
- [x] Final independent read-only audit: cả3WO all6original semanticexact,
      7unique transactions/7intents/7native conditionalresponses204,4batches,
      43events, allconfirmed/finalized, zero reservations. Chỉ RECtarget outbound
      hai chiều có explicit intent; không PM/CFTtarget/PIC hoặc extraPOST.
      Bốn nháp cũ/năm members giữ nguyên versions/baselines/proposals.
      Evidence `.cache/mixed-target-{before,forward,final}.json`,
      `mixed-target-upload-preview.png`, `mixed-target-pm-restored.png`,
      `mixed-target-rec-restored.png`, `mixed-target-cft-restored.png`.
- Giới hạn: một mixedgroup E&I TEST; không suy mọi WO/discipline/production đã qua.
  Production/staging/Offshore vẫn khóa. Bước tiếp theo sẵn sàng: rà soát deployment
  Ubuntu/Docker/HTTPS và backup/restore; endpoint/certificate/Entra production
  cần thông tin IT và kiểm chứng riêng.

## Thu gọn Work Orders theo browser comments — 2026-10-09

- [x] Bỏ khối hướng dẫn nháp và khối account context (connection/system/environment/discipline/capability cùng link Settings bên dưới) đúng hai ghi chú của chủ dự án. Settings trên header vẫn truy cập được; thông báo kết quả upload/lỗi và backend authorization giữ nguyên.
- [x] 62 tests WorkOrders qua; TypeScript/build/lint qua. Browser preview xác nhận hai khối đã bỏ; evidence .cache/work-orders-remove-notices.png. Điều chỉnh tests dùng navigation header và trạng thái Retrieve thay nội dung đã xóa; không live write Maximo.
- Tiếp theo ưu tiên theo mốc nghiệm thu: rà soát deployment Ubuntu/Docker/HTTPS và backup/restore; thông tin kết nối production cần IT.

## Review bố trí bộ lọc WO — 2026-10-09

- [x] Bỏ badge Lập lịch / Nháp theo browser comment2. Review comment1: các khối Retrieve, help, nguồn, refresh, status và localfilters hiện tách nhiều hàng; dateflexbasis220px làm nút Retrieve xuống hàng tại viewport600px.
- Đề xuất: gom nguồn/date/Retrieve thành thanh lấy dữ liệu gọn; chuyển help vào popover; sau Retrieve thu gọn thành summary khoảngngày có nút đổi, gộp count/update/selection vào một thanh; local search luôn hiện, các lọc phụ mở qua nút Bộ lọc kèm count. Desktop rộng hiện nhiều controls cùng hàng, viewport600px cho date+Retrieve một hàng riêng. Chưa triển khai sắp xếp bộ lọc vì ghi chú yêu cầu review/đề xuất.
- [x] TypeScript/build qua; browser badge removed evidence .cache/work-orders-no-badge.png. Tiếp theo ưu tiên: triển khai phương án bộ lọc sau khi chủ dự án chọn; không thay đổi retrieve/date semantics hoặc protectiondraft.

## Mockup bộ lọc trước/sau Retrieve — 2026-10-09

- [x] Tạo hai hình đề xuất cùng viewport 600×742, màu Gray 10/Carbon blue và logo hiện tại: `.cache/wo-filter-proposal-before.png`, `.cache/wo-filter-proposal-after.png`. Bản trước gom nguồn/ngày/Retrieve; bản sau thu gọn khoảng ngày, giữ search, đưa các lọc phụ vào Bộ lọc, gộp count/time/update. Bảng sau bắt đầu tại y=313px và hiển thị tám dòng minh họa.
- [x] Render bằng Edge headless từ HTML cục bộ, kiểm tra trực quan cả hai PNG. Dữ liệu bảng là minh họa, không phải kết quả đọc Maximo mới. Chỉ tạo artifact đề xuất; chưa sửa UI ứng dụng hoặc thực hiện API/write. Source tái tạo: `.cache/render-filter-proposal.cjs` và hai HTML cùng tên.
- Tiếp theo: chủ dự án duyệt hai trạng thái; sau duyệt triển khai bố cục và kiểm chứng Retrieve, bộ lọc, selection và bảo vệ nháp trên browser.

## Triển khai phần Retrieve đã duyệt — 2026-10-09

- [x] Chủ dự án duyệt phần 1, yêu cầu giữ bảng và các thanh lọc hiện tại của phần 2. Gom nguồn WO, hai ngày Target Finish, nút Retrieve và trợ giúp vào một panel gọn; không thu gọn sau Retrieve, không đưa các lọc bảng vào menu. Giữ pagination nháp bên ngoài panel và toàn bộ handlers/quy tắc ngày/quyền/bảo vệ chỉnh sửa hiện tại.
- [x] TypeScript/build/lint và 62 tests WorkOrders qua. Browser Onshore test Retrieve 01/10/2026 đến trước 01/12/2026 trả đủ 172 WO; search, Status, Lập lịch, Nháp, clear filters, group selection và các cột bảng hiện tại vẫn hiển thị. Evidence `.cache/work-orders-compact-retrieve.png`. Chỉ live read, không upload hoặc thay đổi nháp/Maximo.
- Tiếp theo ưu tiên: chủ dự án nghiệm thu độ gọn phần Retrieve trong preview; sau đó tiếp tục rà soát deployment Ubuntu/Docker/HTTPS và backup/restore theo mốc đã nghiệm thu. Kết nối/certificate/Entra production cần thông tin IT.

## Chuyển Nguồn WO vào bộ lọc bảng — 2026-10-09

- [x] Chuyển selector Nguồn WO khỏi panel Retrieve, đặt đầu khối bộ lọc bảng cùng search/Status/Lập lịch/Nháp. Khối nguồn vẫn hiển thị khi chưa Retrieve hoặc kết quả rỗng để không mất đường chuyển sang/ra nguồn nháp. Giữ nguyên handlers, bảng, các bộ lọc dữ liệu và pagination nháp; bỏ CSS riêng cho nguồn trong heading cũ.
- [x] 62 tests WorkOrders qua; TypeScript/build/lint qua. Cập nhật test đổi connection: nguồn vẫn khả dụng nhưng search/Status và dữ liệu cũ phải biến mất. Browser xác nhận nguồn nằm trong section bộ lọc, giữ 172 WO và khoảng ngày hiện tại; evidence `.cache/work-orders-source-table-filters.png`. Không live write hoặc thay đổi nháp.
- Tiếp theo: nghiệm thu vị trí nguồn trong preview; tiếp tục rà soát deployment và backup/restore sau khi chốt giao diện.

## Điều chỉnh Nguồn WO sang hàng Cập nhật — 2026-10-09

- [x] Theo yêu cầu Undo của chủ dự án, bỏ Nguồn WO khỏi khối bộ lọc và chuyển sang phải hàng Cập nhật lần cuối/stale notice/Cập nhật. Các bộ lọc bảng trở lại bố cục trước khi thêm nguồn; nguồn vẫn khả dụng trước Retrieve hoặc khi kết quả rỗng.
- [x] 62 tests WorkOrders, TypeScript/build/lint qua. Browser xác nhận Nguồn WO và nút Cập nhật cùng hàng ở viewport hiện tại (y350/y350.5), selector không nằm trong bộ lọc, giữ 172 WO và khoảng ngày. Evidence `.cache/work-orders-source-update-row.png`. Chỉ chỉnh giao diện; không live write hoặc thay đổi nháp.
- Tiếp theo: nghiệm thu bố cục mới; tiếp tục rà soát deployment/backup/restore sau khi chốt giao diện.

## Thu gọn khoảng ngày sau Retrieve — 2026-10-09

- [x] Bổ sung phần chủ dự án nhắc còn thiếu: sau Retrieve thành công (kể cả kết quả rỗng), panel chỉ hiện khoảng ngày đã tải và nút Đổi khoảng ngày. Mở nút giữ dữ liệu/selection và không gọi API; thay ngày vẫn dùng bảo vệ nháp và xóa kết quả theo logic cũ. Retrieve thất bại giữ input mở. Lưu range đã tải trong React state, xóa khi mất quyền/clear, khôi phục đúng range khi đổi nguồn. Nguồn nháp hiện input bình thường; bảng/bộ lọc/hàng Cập nhật giữ bố cục đã duyệt.
- [x] Hướng dẫn mở bằng summary ⓘ có accessible label/title. 63 tests WorkOrders qua (thêm success/open/failure regression); TypeScript/build/lint qua. Browser Onshore test tải đủ 172 WO, thu gọn đúng 01/10/2026 đến trước 01/12/2026; mở ngày giữ 172 dòng và hai giá trị, ⓘ mở hướng dẫn đúng. Evidence `.cache/work-orders-retrieve-collapsed.png`. Chỉ read, không upload/thay đổi nháp.
- Tiếp theo: nghiệm thu phần tự thu gọn trên preview; tiếp tục deployment/backup/restore sau khi chốt giao diện.

## Thay Nguồn WO bằng Nháp của tôi — 2026-10-09

- [x] Theo phương án chủ dự án duyệt, thay dropdown Nguồn WO bằng nút Nháp của tôi trên hàng Cập nhật. Trong nguồn nháp hiện nút Quay lại WO đã tải. Giữ bộ lọc Nháp của bảng, phạm vi truy cập, pagination, snapshot từng nguồn và xác nhận bảo vệ thay đổi chưa lưu; không đổi API hoặc logic dữ liệu.
- [x] Cập nhật tests chuyển nguồn sang click nút; 63 tests WorkOrders, TypeScript/build/lint và diff check qua. Browser Onshore test mở danh sách 5 WO có nháp, quay lại đủ 172 WO và khoảng ngày thu gọn trước đó. Evidence `.cache/work-orders-my-drafts-view.png`, `.cache/work-orders-my-drafts-button.png`. Chỉ đọc; không sửa/xóa nháp hoặc upload Maximo.
- Tiếp theo: nghiệm thu hai nút chuyển danh sách; sau khi chốt giao diện tiếp tục rà soát deployment Ubuntu/Docker/HTTPS và backup/restore. Thông tin production/certificate/Entra cần IT.

## Xóa hai note và rà soát button style — 2026-10-09

- [x] Xóa hướng dẫn ⓘ và dòng đếm thành công “N WO đã lấy đầy đủ” theo hai browser comments. Giữ dòng Hiển thị N/N phía dưới bộ lọc và thông báo kết quả rỗng/lỗi. Bỏ CSS help không dùng; sửa dấu chấm còn thiếu của selector responsive `.retrieveDates` tại 480px được phát hiện khi rà CSS.
- [x] 63 tests WorkOrders, TypeScript/build/lint qua. Browser giữ 172 WO, xác nhận hai note biến mất; evidence `.cache/work-orders-remove-help-count.png`. Tests dùng count Hiển thị thay count đã xóa.
- [x] Review style: palette/typography Carbon Gray10/100 tự triển khai bằng CSS/native controls, chưa có component variants chung ngoài primary. Toolbar hiện 40px đồng nhất nhưng date-change viền/chữ xanh được override riêng, update/draft viền xám; destructive actions như xác nhận xóa nháp chưa có danger style. Retrieve căn giữa khác default trái; close panel 32px và links WO compact là ngoại lệ theo ngữ cảnh. Disabled gray là trạng thái có chủ đích.
- Đề xuất chuẩn hóa variant theo vai trò: primary cho hành động chính; tertiary chung cho Đổi khoảng ngày/Cập nhật; ghost cho Nháp của tôi/clear filters/Đóng; danger cho xác nhận xóa nháp. Dùng chung chiều cao 40px/font14/18/padding/focus/hover/disabled, chỉ giữ compact size ở khu vực phù hợp. Chưa thay đổi style các nút trong task review này. Tham chiếu [Carbon Button guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines): hierarchy, consistent variants, không trộn size trong cùng button group.
- Tiếp theo ưu tiên: chuẩn hóa variants và áp vào WO/editor/upload theo phương án duyệt, kiểm chứng sáng/tối/disabled/focus; sau đó tiếp tục deployment/backup/restore.

## Chuẩn hóa nút WO và panel — 2026-10-09

- [x] Áp reusable primary/tertiary/ghost/danger/dangerGhost cho WorkOrders, DraftEditor, BatchPlanner và UploadPreviewPanel. Base cùng font14/18, min-height40px, padding10/16, căn trái, hover/focus; touch min44px. Primary cho thao tác chính, tertiary cho đối chiếu/cập nhật/restore, ghost cho đóng/reset/chuyển danh sách/clear, danger cho xác nhận xóa và dangerGhost cho bước mở xác nhận. Bỏ overrides nút retrieveSummary/panelHeading/căn giữa Retrieve. Giữ WO links/disclosure nhỏ theo ngữ cảnh; text dài có thể tăng chiều cao khi wrap.
- [x] Disabled áp cùng theme tokens, opacity1, không giữ màu primary/danger; focus-visible viền2px có offset2px. Filled danger dùng token #da1e28, hover#ba1b23 ở cả hai theme để chữ trắng vẫn có tương phản; dangerGhost dùng error text theo theme.
- [x] Frontend full191/191 tests, TypeScript/lint/build và diffcheck qua. Main rà CSS/class assignment và kiểm chứng live browser trang WO/nháp đơn/nháp nhóm ở Gray10/Gray100: toolbar40px, primarybluewhite/tertiaryoutline/ghosttransparent; disabledgray, keyboard focus2px trên Cập nhật, xác nhận xóa, đối chiếu nhóm. Chỉ mở rồi Hủy xác nhận xóa; không gửi/save/delete/upload. Giữ172WO và một dòng user chọn, đóng panels và khôi phục g10.
- Evidence `.cache/wo-buttons-{light,dark}-focus.png`, `wo-panel-buttons-{light,dark}-focus.png`, `wo-batch-buttons-light.png`, `wo-batch-buttons-dark-focus.png`. Upload control dùng cùng variants và có unit tests; browser không gửi upload hay tạo trạng thái lỗi/unknown để kiểm tra style.
- Tiếp theo ưu tiên: nghiệm thu style trong preview; tiếp tục rà soát deployment Ubuntu/Docker/HTTPS và backup/restore. Production endpoint/certificate/Entra cần IT trước triển khai production.

## Chuyển nút nháp cạnh Lập lịch nhóm — 2026-10-09

- [x] Chuyển Nháp của tôi/Quay lại WO đã tải từ hàng Cập nhật xuống ngay bên phải Lập lịch nhóm trong cùng cụm thao tác. Cụm chuyển danh sách luôn khả dụng cả khi chưa Retrieve, rỗng, lọc không có kết quả hoặc chỉ có quyền đọc. Giữ ghost style và các handlers/snapshot/bảo vệ nháp hiện tại.
- [x] 63 tests WorkOrders, TypeScript/build/lint qua. Browser: Nháp của tôi ở cùng y536 và bên phải nút nhóm; nguồn nháp 5WO có Quay lại ở cùng y647 và bên phải nhóm. Quay về172WO giữ một dòng user chọn. Evidence `.cache/wo-drafts-next-to-batch.png`, `.cache/wo-back-next-to-batch.png`. Không save/delete/upload.
- Tiếp theo: nghiệm thu vị trí toolbar nhóm; tiếp tục deployment/backup/restore sau khi chốt giao diện.

## Nghiệm thu chuyển màn và review layout nháp — 2026-10-09

- [x] Live browser Onshore test: WO đã tải172, Nháp của tôi5; quay lại giữ172WO, khoảng01/10 đến trước01/12 và checkbox P13431393. Nháp search P13462775 giảm1/5; chuyển qua WO rồi quay lại giữ search riêng. Search không khớp cho0 dòng vẫn có Quay lại, thông báo đúng; khôi phục search nháp rỗng, trở về WO/g10 với dòng chọn ban đầu. Không lưu/xóa/upload/đổi giá trị WO.
- [x] Review tại viewport928×884: panel retrieval WO height72px, drafts127px; drafts thêm hàng pagination56px. Top bảng WO y592, drafts y703 (dịch111px). Dùng cùng table/filter/button styles/cột là nhất quán; context header đều Work Orders, retrieval dates vẫn hiện khi đang ở nguồn nháp dù không áp dụng. Draft filter tại nguồn nháp chỉ có Có5/Không0, hai pagination buttons disabled ở trang duy nhất.
- Evidence `.cache/uat-layout-loaded-wo.png`, `.cache/uat-layout-my-drafts.png`. Automated source preservation/dirty guard/error/connection checks đã qua trong63WorkOrders tests ở task trước; không chạy lại khi chỉ review/read UI. Live nghiệm thu không tạo lỗi mạng/unknown upload hoặc kiểm chứng phân trang nhiều trang vì nguồn hiện chỉ5WO.
- Đề xuất, chưa triển khai: (1) nguồn nháp thay panel Retrieve bằng summary gọn cùng chiều cao, thể hiện Nháp của tôi/phạm vi và không phụ thuộc ngày; giữ action toggle tại cụm nhóm đã duyệt; (2) ẩn filter Nháp thừa riêng trong nguồn nháp nhưng giữ Status/search/Lập lịch ở vị trí ổn định, gom pagination vào count/footer và chỉ hiện khi cần; (3) nhãn hành động nhóm theo dữ liệu đã lưu: Mở nháp nhóm khi chọn đúng một nhóm, tránh gọi Lập lịch nhóm cho mọi WO đã có kế hoạch. Cần giữ snapshot/dirty guard/date semantics và thông báo rỗng/lỗi. Bước sẵn sàng đầu tiên: triển khai1 để tránh hiểu nhầm ngày và kéo bảng nháp lên; sau chốt UI tiếp tục deployment/backup/restore.

## Triển khai layout nháp đã duyệt — 2026-10-09

- [x] Thực hiện cả bốn đề xuất: nguồn nháp có summary Nháp của tôi/phạm vi discipline/không phụ thuộc ngày, ẩn Retrieve inputs; pagination vào count row và chỉ hiện nếu có trang trước/tiếp (kể cả trang rỗng); ẩn Nháp filter và bỏ tác động filter đó ở nguồn nháp, giữ search/status/planning cùng vị trí bằng slot layout; chọn cùng saved batch đổi nhãn Mở nháp nhóm(N), nguồn nháp đơn/trộn khác nhóm khóa nút và có guidance bên ngoài cụm button. Nút chuyển nguồn vẫn sát bên phải action nhóm. Các API/dirty guard/snapshot/date rules giữ nguyên.
- [x] 67 WorkOrders tests, TypeScript/lint/build và diffcheck qua. Thêm tests single-page pagination hidden/empty later page navigation/same-group label/single-mixed disabled, cập nhật tests date/filter/source. Main rà source và live UI. Không chạy lại backend vì không thay đổi backend.
- [x] Phiên cũ hết hạn lúc bắt đầu nghiệm thu; app xóa workspace đúng quy tắc. SSO đăng nhập lại thành công, Retrieve Onshore test01/10 đến trước01/12 đủ172WO. Nguồn nháp5WO: panel72px và bảng y592px, khớp WO đã tải và cao hơn bản cũ111px; ngày không hiển thị, filterNháp và pagination một trang không còn. Quay về giữ172WO và hai giá trị ngày; bộ lọc Nháp hiện lại. Chọn P13462775/P13465570 mở đúng nhóm2WO/v1; chọn nháp đơn hoặc nháp đơn trộn nhóm khóa action và hướng dẫn đúng, không làm mất nút quay về. Đã đóng panel và bỏ các lựa chọn tạo trong nghiệm thu, trả preview g10/WO172. Không save/delete/upload hoặc chỉnh WO.
- Evidence `.cache/drafts-layout-loaded-wo.png`, `.cache/drafts-layout-my-drafts.png`, `.cache/drafts-layout-same-group.png`. Multi-page drafts được kiểm chứng synthetic tests; live nguồn chỉ5WO nên không khẳng định nghiệm thu nhiều trang thật.
- Tiếp theo ưu tiên: chủ dự án nghiệm thu layout nguồn nháp mới; tiếp tục rà soát deployment Ubuntu/Docker/HTTPS và backup/restore. Thông tin production endpoint/certificate/Entra cần IT trước rollout.

## Ẩn/hiện bộ lọc và tận dụng tiêu đề WO — 2026-10-09

- [x] Thêm nút Ẩn/Hiện bộ lọc bên phải Work Orders khi có dữ liệu, kèm số điều kiện đang áp dụng. Dùng aria-expanded/aria-controls và giữ controls mounted khi ẩn để bảo toàn search/status/planning/draft filter, kết quả và dòng chọn; không gọi Retrieve khi toggle. Áp dụng cả WO đã tải và Nháp của tôi. Bỏ dòng hướng dẫn “Bảng gọn · bấm Work Order để xem đầy đủ thông tin trong panel”.
- [x] 68/68 WorkOrders tests, TypeScript/build/lint và diffcheck qua. Regression kiểm chứng hide/show giữ search và checkbox, accessible search ẩn đúng và không Retrieve thêm. Browser Onshore test tải172WO, search P13431393/chọn dòng rồi hide/show giữ1/172 và checkbox; nguồn nháp5WO toggle đúng, quay lại giữ172WO. Tại viewport928×884, ẩn bộ lọc kéo bảng từ y560 lên y407 (thêm153px cho bảng). Trả preview về bộ lọc hiện, search rỗng, selection0; không save/delete/upload.
- Evidence `.cache/wo-filters-hidden.png`, `.cache/wo-filters-visible.png`. Không kiểm chứng reload persistence cho trạng thái toggle vì tùy chọn này chỉ thuộc phiên trang hiện tại.
- Tiếp theo ưu tiên: nghiệm thu vị trí toggle và diện tích bảng trong preview; sau chốt UI tiếp tục rà soát deployment Ubuntu/Docker/HTTPS và backup/restore. Production endpoint/certificate/Entra cần IT trước rollout.

## Dời nút bộ lọc cạnh Cập nhật — 2026-10-09

- [x] Theo browser comment mới: dời nút Ẩn/Hiện bộ lọc khỏi tiêu đề xuống ngay bên phải Cập nhật; mặc định bộ lọc ẩn. Giữ số điều kiện đang áp dụng, aria-expanded/aria-controls và toggle không xóa điều kiện/dòng chọn.
- [x] 68 WorkOrders tests, TypeScript/build/lint và diffcheck qua. Regression xác nhận mặc định hidden, toggle ngay sau Cập nhật và không nằm trong title. Browser Onshore test Retrieve172WO xác nhận mặc định ẩn; show/hide hoạt động, hai nút cùng y255 và toggle nằm bên phải. Preview giữ172WO, bộ lọc ẩn, selection0; không save/delete/upload. Evidence `.cache/wo-filter-toggle-next-to-refresh.png`.
- Tiếp theo: nghiệm thu hàng Cập nhật mới; sau chốt UI tiếp tục rà soát deployment/backup/restore, thông tin production/certificate/Entra cần IT trước rollout.

## Nghiệm thu hàng thao tác mới trên preview — 2026-10-09

- [x] Live Onshore test tại928×884: Cập nhật và Hiện/Ẩn bộ lọc cùng y255, cao40px, toggle ngay bên phải (x325.53 so với Cập nhật x218.36). Bộ lọc bắt đầu ẩn; mở/search P13431393/chọn dòng/ẩn giữ1/172, checkbox và nhãn Hiện bộ lọc(1). Cập nhật chuyển disabled khi xác minh/tải, hoàn tất đổi timestamp17:22:59→17:27:10 và giữ search, dòng chọn, trạng thái ẩn.
- [x] Nháp của tôi có5WO và cùng hàng thao tác, show/hide đúng; quay lại WO giữ1/172 và dòng chọn. Gray10/Gray100 hiển thị đúng; keyboard focus Cập nhật và toggle có outline2px (blue #0f62fe sáng, #78a9ff tối). Không phát hiện lỗi trong phạm vi nghiệm thu. Trả preview Gray10/172WO/search rỗng/selection0/bộ lọc ẩn. Không save/delete/upload.
- Evidence `.cache/uat-toolbar-light-final.png`, `.cache/uat-toolbar-dark-focus.png`, `.cache/uat-toolbar-drafts-dark.png`. Task này chỉ browser UAT và docs, không đổi code; 68 tests/TypeScript/build/lint đã qua ở task triển khai, không chạy lại. Diffcheck qua.
- Tiếp theo sẵn sàng: rà soát deployment Ubuntu/Docker/HTTPS và quy trình backup/restore. Rollout production phụ thuộc IT cung cấp endpoint/certificate/Entra đã chốt.

## Rà soát deployment và backup/restore trong repo — 2026-10-09

- [x] Rà Compose/Dockerfiles/dockerignore, nginx, Settings/readiness, migrations,
      grants và công cụ rehearsal/recovery. Ghi 11 findings D1–D5/B1–B4/O1–O2,
      ưu tiên, tiêu chí nghiệm thu và đầu vào IT trong
      [báo cáo rà soát](deployment-readiness-review.md). Phân biệt read-only staging
      với cổng upload production đang khóa; không mở write bằng cấu hình development.
- [x] `docker compose --env-file .env.example -f compose.yaml config --quiet`
      với biến DSN/password synthetic trong process qua. Kiểm tra links local,
      placeholder và diffcheck. Chỉ rà source/tài liệu; không chạy lại application
      tests/build hoặc diễn tập restore cũ, không đọc secrets thật/khởi động container/
      deploy/migrate DB ứng dụng/upload/commit/push. Giữ thay đổi TODO có sẵn.
- [x] Đối soát mục 9: đánh dấu đúng phần Docker/Compose local và base digest đã có
      bằng chứng; staging/production/backup vận hành vẫn chưa hoàn thành.
- Tiếp theo sẵn sàng: chuẩn bị cấu hình staging mẫu và runbook D1–D4, rồi policy/job
      backup và runbook B1–B4. Nghiệm thu Ubuntu/restore cluster mới cần IT cung cấp
      server/hostname/TLS/Entra/DBA/kho backup và duyệt RPO/RTO.

## Chuẩn bị cấu hình staging và runbook — 2026-10-09

- [x] Thêm Compose staging độc lập: release image references bắt buộc, env files raw
      runtime/owner riêng, DBA password file, volume riêng, migration profiles/tools
      chạy theo operator, chỉ publish443, healthcheck/backend và log rotation.
- [x] Thêm nginx TLS ingress trực tiếp/cert mounts, backend bỏ proxy headers,
      forwarded headers được thay tại ingress; timeout read310s vượt single-reader
      budget300s, proxy không retry. Multi-step endpoints vẫn có thể vượt310s;
      deadline toàn request cần xử lý/kiểm chứng trước nghiệm thu D3.
      Log path/status/time; error log tắt để tránh
      lộ request credentials, ghi rõ yêu cầu monitoring thay thế.
- [x] Runbook D1–D4: release/secrets/IT inputs, DB provisioning → migration owner →
      grants/runtime login check → app; upgrade quiesce/backup/migrate/grants/smoke;
      rollback theo schema compatibility, không downgrade/xóa volume tự động.
- Giới hạn: template/read-only staging; chưa triển khai Ubuntu, chưa nghiệm thu
      Entra/Maximo/DB roles thật hay backup/restore/rollback có dữ liệu. Private CA
      mount, release registry/digests thực tế, monitoring và upload production vẫn pending.
- [x] Synthetic checks: Compose5.3.1 config/role separation/ports/manual migration/
      raw secret giữ `$` trong container/missing-input failure; staging Settings
      reject thiếu Entra và TEST write contract. nginx-t/TLS trusted synthetic/SPA/
      header spoof overwrite/log markers không lộ qua; fake read33.0s trả200.
      Dọn containers/networks thử, không migrate DB hoặc gọi upstream thật.
      Docs links/placeholders/diffcheck qua; không đổi app code/runtime dependencies.
- [x] Một review độc lập Sol/high phạm vi config/runbook: không thấy P1; findingP2
      timeout được phản ánh đúng trong comment/runbook/TODO, không khẳng định310s
      bao phủ mọi endpoint. Deadline/backend negative tests còn mở; Main kiểm tra
      sửa tài liệu, không gọi recheck hay mở rộng task sang refactor backend.
- Tiếp theo sẵn sàng: xử lý/kiểm chứng deadline toàn endpoint read/draft trước
      nghiệm thu D3; chuẩn bị policy/job backup và runbook restore B1–B4.
      IT cần cấp Ubuntu/DNS/TLS/Entra/secret channel/DBA trước staging acceptance;
      chốt kho backup và RPO/RTO trước bật backup thực tế.

## Deadline chung cho WO read và nháp — 2026-10-09

- [x] Backend `ReadDraftDeadlineRoute` áp vào WO list/detail và local draft/batch
      routers; Settings.read_draft_request_timeout_seconds mặc định180, range1..300,
      deadline monotonic chung bao validation/dependencies/PERSON/crew/WO/rechecks/DB.
      Hết hạn trả504/no-store; inner timeout/upstream/auth errors giữ semantics.
      Không áp vào remote upload/auth/session. Fanout drain children trước đóng client.
- [x] 417 backend offline tests qua; sau fix commit worker,54 related PostgreSQL
      regressions và1 PERSON delayed-commit test bổ sung qua. Tổng16 deadline cases
      (11 offline/5 DB). PostgreSQL test riêng hủy `pg_sleep` sau draft/item/receipt flush: create/
      update chưa commit rollback atomic; retry request ID cũ/replay không tạo trùng;
      restore/list/delete timeout giữ nháp hiện hữu. Ruff lint và scoped format qua.
- [x] FE504 messages có hướng dẫn trạng thái, không lộ upstream body/auto retry;
      regression single/batch save giữ edits/request ID khi người dùng retry.
      86 focused tests/typecheck/lint/build qua. Vitest/Vite cần quyền spawn ngoài
      sandbox Windows, đã chạy lại thành công; không đổi runtime dependencies.
- [x] Synthetic HTTPS/nginx → actual deadline route với budget1s và2 bước0.6s:
      504/no-store khoảng1s server, client3.05s có DNS Windows; probe cancelled1/
      completed0/started1, fast200. Script/fixtures trong .cache, containers/networks
      thử đã dọn. Không dùng DB app/Maximo/Entra thật, không upload/deploy/commit/push.
- Giới hạn: cancellation cooperative, cleanup/socket response có thể vượt budget;
      timeout sát commit không chứng minh chưa lưu. Durable receipts/request ID cũ
      tiếp tục bảo vệ manual retry; không hứa rollback giao dịch đã commit.
      Ubuntu/upstream thực, full10-session load và shutdown drain còn pending.
- [x] Một reviewer Sol/high tìm P2 sessionmaker.begin shield commit worker; đã sửa
      cả5 contexts draft/batch/PERSON sang session/direct transaction context.
      Delayed-exit tests chứng minh không còn worker commit tách khỏi request khi504,
      draft/update/receipts và PERSON grants/audit chưa commit rollback. Không có
      P1/P2 khác trong review; Main kiểm chứng fix, không mở review/recheck thứ hai.
      Main chạy lại3 delayed-exit/PERSON PostgreSQL cases:3passed/2deselected;
      Ruff format8files và diffcheck qua, docs links/placeholders qua.
- Tiếp theo sẵn sàng: chuẩn bị policy/job backup và runbook restore B1–B4.
      Staging acceptance D1–D4/O1 cần IT cấp Ubuntu/DNS/TLS/Entra/DBA/secrets;
      backup thực tế cần kho lưu và RPO/RTO được duyệt.

## Chuẩn bị policy/job backup và runbook restore — 2026-10-10

- [x] Thêm [policy](backup-policy.md) với inventory DB/tài sản ngoài DB, RPO/RTO,
      schedule/retention/offsite/owners/key custody/provenance/session policy cần
      duyệt; không tự đặt lịch/lưu bao lâu. Config approval false và timer chưa có
      lịch hợp lệ; không bật service/timer hay backup DB ứng dụng.
- [x] Job Ubuntu Python stdlib/PostgreSQL17/OpenSSL CMS AES-256-GCM: private
      service/passfile, source/server/schema/release guards, shared exported snapshot
      cho dump và counts16 bảng nghiệp vụ, recipient fingerprint/expiry, flock,
      mount source/device/inode checks, encrypted inventory/hash và atomic publish.
      Không copy secret env, không retention-delete/restore/Maximo write; cleanup chỉ
      temp/new set do run sở hữu, diagnostics không lộ credential/tool stderr.
- [x] [Runbook](backup-restore-runbook.md): freeze ingress/senders/writes, DB mới
      cô lập, trusted-set decrypt trước restore atomic, roles/secrets recovery riêng,
      schema/grants/auth gates và script auth invalidation có guard expectedDB/case.
      Đối soát cả khoảng Maximo sau snapshot dù receipt không còn trong backup;
      giữ unknown/chưa rõ outcome bị khóa, không auto retry hay đánh confirmed bằng SQL.
- [x] 10 Linux stdlib tests qua; Windows7pass/3Linux-onlyskip. Failures gồm missing
      approval/passfile override, wrong/mất mount/inode replacement, certificate,
      dump/encryption/diagnostic/timeout, fsync/publish và collision; giữ backup cũ.
      Main chạy lại cả10 Linux tests sau fixes:10pass; Docker Desktop cần escalation
      để truy cập named pipe, chạy lại thành công trong container thử đã tự dọn.
- [x] Rehearsal thật bằng PostgreSQL17/OpenSSL3.5 trên DB UUID tạm của designated
      scheduler_test: encrypted shared snapshot → decrypt → pg_restore single
      transaction, schema/data equality17bảng/32rows/revision0008. Mutation source
      sau export không lọt vào dump/counts; GCM corruption bị từ chối; source identity
      mismatch không tạo success set. Auth SQL source/wrongDB/invalidcase refusals
      không đổi dữ liệu; validcase chỉ xóa đúng restored flows/sessions, giữ history.
      Temp DBs/files/container đã dọn; không restore DB ứng dụng hay deploy/upload.
- [x] Một reviewer Sol/high/fresh reader: không thấy P1, hai P2 mount-loss/local
      fallback và service-passfile override đã sửa; Main xem fixes/chạy10 Linux
      regressions, không gọi review thứ hai. Ruff lint/format4 Python files qua;
      docs local links/diffcheck qua. README/DB operations/staging/readiness liên kết
      đúng trạng thái chuẩn bị, không đóng B1–B4 acceptance vận hành.
- Giới hạn: chưa thử Ubuntu/offsite/TLS route, cluster mới mất source, backup-role/
      runtime login, alert delivery/freshness, key rotation, Maximo-gap thực hoặc
      RPO/RTO đo được. SIGKILL/power loss có thể còn plaintext temp; runbook yêu cầu
      encrypted local disk và cleanup/quarantine có xác minh. Host job chưa có route/
      PostgreSQL TLS từ Compose; mountpoint dưới mount phải root-owned/unwritable.
- Tiếp theo ưu tiên: IT/chủ dự án duyệt RPO/RTO/lịch/retention/session policy, cấp
      owners/kho ngoài máy chủ/keys/DB principal và private route/TLS/CA; đây là đầu
      vào đang chặn bật job. Sau đó diễn tập Ubuntu staging sang cluster mới, thử
      quyền/auth/Maximo-gap/alerts và đo RPO/RTO trước bật timer hoặc rollout.

## Hoàn thiện validation Schedule trong Target — 2026-10-10

- Chủ dự án chuyển lịch sử upload/audit tổng thể sang **phase 2**; ưu tiên hoàn
      thiện chức năng lập lịch chính. Backup/restore và kiểm thử tải/lỗi vận hành
      tạm gác theo yêu cầu, không coi đã nghiệm thu hoặc loại khỏi backlog.
- [x] Kiểm tra code: trước đây frontend/backend chỉ kiểm tra date pairs/order,
      chưa có containment Schedule trong Target. Bổ sung helper UI dùng chung:
      mọi endpoint schedule hiện có phải nằm trong các target bounds đã biết,
      cho phép bằng biên và so instant có timezone. Dùng effective target mới nếu
      đang sửa; Finish từ Start + Duration cũng bị kiểm tra. Malformed/reversed
      bounds hoặc ngày lịch không hợp lệ bị chặn khi sửa schedule/duration/target.
- [x] Editor đơn hiển thị lỗi tức thời và khóa Lưu nháp/preview upload; nhóm có lỗi
      theo WO, khóa lưu/preview qua validator sẵn có. Sửa dòng/áp nhóm/dán Excel/
      mở lại saved draft dùng cùng rule, paste lỗi giữ nguyên cả nhóm. Giữ edits
      để sửa, không tự clamp ngày; PM/CFT vẫn không đổi target. Target thiếu một
      mốc chỉ áp mốc có khi sửa lịch; khi sửa target vẫn yêu cầu đủ pair như backend.
      PIC-only/nochanges không bị khóa bởi lịch cũ ngoài target.
- [x] 57 focused editing/DraftEditor/BatchPlanner +68 WorkOrders regressions qua
      (125 tổng); equality/offsets/one-sided bounds/duration overflow/target overrides/
      reversed dates/single & batch legacy preview/group/paste đều có coverage.
      Điều chỉnh fixture luồng hợp lệ để pair ngày nhất quán, giữ các assertions
      trước đó. Typecheck/lint/production build qua; Main rà helper/gates và fixtures,
      diffcheck/docs links qua. Không thêm dependency/API/schema, không live Maximo
      write, browser UAT, load/DR test, deploy, commit hoặc push trong task này.
- Giới hạn: theo yêu cầu chỉ thêm validation UI. Backend vẫn chưa áp containment
      cho API client trực tiếp; upload re-read/so baseline đầy đủ vẫn chặn target
      trên Maximo đổi sau khi lưu. Những request upload đã tồn tại vẫn giữ chức năng
      tra cứu/đối soát, không làm mất receipt hoặc tự retry.
- Quyết định chủ dự án 2026-10-10: validation containment chỉ trên UI, **không cần
      bổ sung backend**; phần yêu cầu hiện tại đã hoàn tất. Lịch sử tổng thể để
      phase 2; load/backup acceptance vẫn tạm gác, triển khai thực tế còn cần đầu
      vào IT đã ghi ở mốc trước. Khi tiếp tục nghiệm thu, xác nhận thông báo/khóa
      lưu trên editor đơn và nhóm theo rule đã triển khai.

## Kiểm thử 10 phiên API và lỗi vận hành — 2026-10-10

- Chủ dự án yêu cầu tiếp tục phần tải/lỗi vận hành đã tạm gác. Backup/restore vẫn
      tạm gác; lịch sử upload phase 2 và validation Schedule chỉ trên UI giữ nguyên.
- [x] Thêm runner/orchestrator synthetic riêng, không sửa app/API/schema/dependencies.
      Real HTTP/Linux Uvicorn, PostgreSQL17 schema0008,10 users/10 clients,2 PERSON
      scopes/connections cùng site/WOID/WONUM; thêm1 session cùng actor chỉ cho race.
      Guard private run UUID/DB/hosts trước seed; mock chỉ GET, không Maximo thật.
- [x] 3 vòng ×10 requests ×8 pha =240 load requests;270 response samples gồm warmup và
      checks, không có status ngoài expectation. Retrieve 200 WO P95=0.412s, lưu đơn
      0.244s, prepare200=1.017s, lưu nhóm200=2.651s, mở lại=2.884s, cập nhật=2.461s.
      [Báo cáo](ten-session-operational-rehearsal.md) và
      [JSON evidence](evidence/ten-session-2026-10-10.json) giữ samples/thống kê.
- [x] Same-scope owner GET/PUT404, wrong connection/discipline/guessed ID404;
      moved WO 502 fail closed. Hai phiên cùng owner/version cho200+409. Duplicate ID
      đúng1 receipt/cùng result; replay sau process restart không tạo thêm rows.
- [x] Deadline 1s trả504/drain 4 children/không draft-item-receipt mới; private PG stop
      cho503, start lại cùng backend/session200. Process/container thay mới giữ
      session và nháp version 2/200 items. SIGTERM drain request trả201/exit0/receipt 1;
      grace 5s bị giữ cho500 ở 5.97s/không draft commit trong ca này. Commit trước giữ
      response rồi SIGKILL cho RemoteProtocolError; replay ID sau restart trả đúng
      receipt, không tăng counts. Hai fault response đặc biệt ghi riêng, ngoài 270 samples.
- [x] Một reviewer Sol/high không thấy P1, 5 P2 harness đã sửa: guard DB, owner check
      same scope, after-commit replay, moved 502 expected, verify cleanup. Main kiểmtra
      fixes/evidence, chạy lại6 guard tests = 6 pass; Ruff lint/format3 files qua.
      Main Docker CLI xác minh không còn owned prefix containers/network; worker
      đã dọn owned volumes/private config. Docs links/diffcheck qua; không app changes,
      live writes/SSO/browser/backup/deploy/commit/push. Không gọi review thứ hai.
- [x] Ưu tiên tối ưu danh sách nháp: baseline P95 tăng3.153→6.091→9.211s khi mỗi user tích
      lũy1→2→3 nhóm 200 WO và số nháp đơn tương ứng. Endpoint re-read toàn bộ thành viên
      từng nháp tuần tự trước trả summary. Cần giảmread lặp/bounded work mà giữ scope
      và current discipline checks. Đã sửa/đo lại trong task tiếp theo dưới đây;
      ngưỡng phản hồi production vẫn cần nghiệm thu môi trường thật.
- [x] Chuẩn hóa cấu hình stop budget/graceful deadline trước staging: task bước1
      phía dưới đặt backend/nginx320s, Compose330s và stop web rồi backend tuần tự.
      5s rehearsal không chứng minh 330s; kiểm thử cấu hình mới khi có request
      đang lưu vẫn pending. Client mất response/500 phải giữ request ID để tra
      cứu/replay, không suy chưa commit.
- Giới hạn: mock WO 5ms, Docker Desktop 16 CPU/~15.37GiB RAM không container limits,
      Cookie/CSRF thủ công HTTP loopback; chưa 10 browser/Entra/TLS/proxy/Maximo thật,
      remote upload/worker lease, long soak hoặc production SLO. Final run 82.1s,
      số đo không chứng minh live capacity. IT cần Ubuntu/TLS/routing/test roster trước
      nghiệm thu thật. Báo cáo tách lỗi cố ý gây ra với lỗi ngoài dự kiến.
- Tiếp theo sẵn sàng: xử lý danh sách nháp chậm rồi chạy lại tải tương ứng; chốt
      shutdown contract/cấu hình stop trước staging. Nghiệmthu môi trường thật còn
      chờ IT, backup/restore và lịch sửphase 2 không mở rộng trong task này.

## Tối ưu danh sách nháp — 2026-10-10

- [x] `/api/drafts` đọc metadata/thành viên theo tập; trả DB connection trước I/O,
      dedup theo connection/site/WO trong mỗi request, crew một lần/fanout4. Một
      current grant check cho tập đồng nhất thay SQL từng thành viên; không cache
      giữa requests. Summary tránh expanded payload, `include_items=true` giữ
      baseline/changes/PIC/token/flags và contract frontend. Pagination20 giữ nguyên.
- [x] Giữ owner/scope/current discipline/eligibility mọi thành viên và recheck
      session/grant sau I/O. Nháp đổi version/membership hoặc nhóm không xác minh
      đủ bị bỏ toàn bộ. Không giữ transaction network I/O, timeout hủy/drain tasks.
      Reviewer Sol/high không P1, một P2 version/changes khác SQL snapshot đã sửa
      bằng joinedstatement; Main kiểm tra fix và regression interleaving. Không
      gọi review thứ hai; không API/schema/runtime dependency hoặc UI change.
- [x] 55 distinct PostgreSQL regressions qua các lượt chạy: 13 list tests gồm overlap,
      distinct401keys, mixed discipline, moved member, revoke, version change và
      coherent snapshot; cùng marker/draft/batch/deadline. 425 offline tests qua;
      Ruff check/format qua. Deadline test inject vào page reader mới cho list.
- [x] Final-source Docker rehearsal10 users/3 vòng qua, thêm expanded list:
      270 load requests/300 response samples, zero unexpected statuses; cố ý gây
      grace-expiry500 và response-loss được tách riêng. Summary P95 9.210→1.207s
      (giảm86.9%); vòng3 9.211→1.209s. Expanded P95=1.484s/max1.525s.
      Owner/isolation/race/duplicate/deadline/DB outage/restart/shutdown/replay qua.
      Counts63drafts/6033items/94receipts; owned cleanup verified. Báo cáo và
      [evidence](evidence/ten-session-draft-list-optimized-2026-10-10.json) giữ
      baseline riêng; docs/diffcheck qua, không deploy/commit/push/live writes.
- Giới hạn: upstream giả lập5ms, Docker Desktop không resource limits; chưa SLO
      production/10browser/Entra/TLS/Maximo thật. Distinct WO tăng vẫn phải đọc đủ,
      tối ưu này giảm read lặp và SQL dư, không bỏ current verification. Schedule
      containment vẫn UI-only; historyphase2 và backup/restore tiếp tục tạm gác.
- Tiếp theo sẵn sàng: stop budget và `stop_grace_period` đã cấu hình ở bước1 dưới
      đây; xác minh request đang chạy và replay khi mất response. Nghiệm thu thật còn
      chờ IT cấp Ubuntu/tài nguyên/routing/TLS/test roster, rồi đo response/monitoring
      với Maximo thật và chốt ngưỡng phản hồi.

## Chuẩn hóa shutdown — bước1 cấu hình — 2026-10-10

- [x] Giữ deadline WO/nháp mặc định180s, tối đa300s và nginx proxy read310s.
      Compose staging đặt Uvicorn `--timeout-graceful-shutdown 320`, backend
      SIGTERM/stop330s; nginx `worker_shutdown_timeout 320s`, web SIGQUIT/stop330s.
      Không đổi app handlers, deadline phạm vi khác hoặc local foundation Compose.
- [x] Runbook dùng stop web trước rồi stop backend, giữ DB hoạt động và dùng budget
      trong Compose thay override CLI. Thêm restart ứng dụng không migration,
      các margin/cooperative cleanup/forced kill/receipt caveats và giải thích
      mỗi service330s riêng. Sửa YAML không tự áp lên container đã tồn tại.
- [x] Kiểm chứng local bằng synthetic inputs: Docker Compose render xác nhận330s/
      TERM/QUIT/graceful320; image Uvicorn hỗ trợ option, image nginx `-t` qua
      với config mới/certificate giả. Fixtures dọn, containers `--rm`; Main
      kiểm tra docs links/diffcheck. Không start stack/restart dịch vụ thật,
      deploy/migrate/live Maximo write/commit/push; không cần dependency mới.
- [x] Bước2 synthetic local: kiểm thử lưu đang chạy qua quy trình stop/restart mới; xác minh drain,
      dữ liệu/receipt/replay và outcome khi hết grace. Rehearsal5s trước đó không
      đóng kiểm chứng320/330s; task bên dưới thử budgets thật. Thời gian đệm không
      bảo đảm cứng cho cleanup/lifespan; nghiệm thu Ubuntu vẫn chưa đóng.
- Tiếp theo: bước2 synthetic đã hoàn tất bên dưới. Nghiệm thu Ubuntu thật còn chờ IT cấp server/
      routing/TLS/tài nguyên/test roster; backup/restore và historyphase2 vẫn tạm gác.

## Shutdown — bước2 runtime/restart/receipt — 2026-10-10

- [x] Harness opt-in riêng, real LinuxUvicorn/PostgreSQL17/nginx với TLS giả được
      client trust/verify; source/Compose/nginx/image hashes trong evidence. Dùng
      request180s/grace320s/Docker330s thật, không scale5s. Reader fixture300s
      thay default120s để cô lập outerdeadline180s; upstream GET-only giả lập.
      Tài nguyên UUID riêng, không stop shared DB hoặc chạy stack staging thật.
- [x] A: batch200 đang lưu qua HTTPS, SIGQUIT web ngừng nhận kết nối mới, request
      cũ trả201; webstop3.284s rồi backendTERM1.101s/exit0. Restart/TLS replay cùng
      ID không tăng1draft/200items/1receipt. B: hold trước commit trả504 ở179.935s,
      active0/cancelled4/no newrows; backendstop180.810s/exit0; cùng ID sau restart
      lưu một lần rồi replay đúng/không tăng rows.
- [x] C: commit200items/1receipt rồi giữ response; thật320s grace gây500 ở320.199s,
      backendstop321.031s/exit0 trước330s. Restart/TLS replay exactreceipt giữ đúng
      WO/scopes/changesestdur9/version1, không lưu trùng. B/C trực tiếp backend
      để cô lập fault boundary; không suy đã thử proxy310/nginx320 ở đúng biên
      hoặc forcedDockerSIGKILL330s.
- [x] Hai lượt: lượt đầu A/B qua, C dừng ở harnessstdout-only logassert; raw report
      failed giữ nguyên. Sửa capturestderr/regression, chạy riêng C từ đầu với320s
      thật và assertions đầy đủ qua. Reviewer Sol/high khôngP1, mộtP2 restore
      content coverage đã bổ sung exactkeys/scope/version/changes/negativecases;
      Main kiểm tra helper, API restore3nháp qua process thay thế ở lượt đầu và
      C runtime sau restart. 28guards/assertions qua, Ruff lint/format qua.
- [x] Lượt đầu cleanup rỗngWindowsdir bịPermissionError; Main guardedRemove-Item
      -Force sau xác minh đúng childworkspace/rỗng, Docker kiểm tra containers/
      network/volumes tạo trong timewindow đều không còn. Harness clearread-only
      chỉdir UUIDrỗng trênWindows; lượt cuối CLIexit0/cleanupverified containers,
      network/volume/privatefiles. Main kiểm tra lại, docs links/diffcheck qua.
      [Báo cáo](staging-deployment.md#kết-quả-runtime--2026-10-10) và
      [evidence](evidence/shutdown-180-320-330-2026-10-10.json) tách rõ hai lượt và
      đối chiếu bổ sung. Không app/schema/dependency change/deploy/commit/push.
- Giới hạn: DockerDesktop/DB role synthetic/sessionseed/manualCookie-CSRF,
      không10browser/Entra/Ubuntu/Maximo thật, monitoring/liveuploads/backuprestore.
      500/mấtresponse không chứng minh chưacommit; phải giữ requestID để đối soát.
- Tiếp theo ưu tiên: nghiệm thu cùng contract trên Ubuntu staging với resource
      limits/TLS/routing và Maximo/Entra thật; chờ IT cấp server/quyền truy cập,
      DNS/certificate/routes/test roster. Cần đo10browser/latency và chốt SLO trước
      nghiệm thu capacity; backup/restore và historyphase2 tiếp tục tạm gác.
