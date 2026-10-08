# Cấu hình Codex cho Work Order Scheduler

Dự án dùng một Main và ba sub-agent. Cấu hình nằm trong repo, dùng định dạng
native của Codex; không cần cài thêm plugin hoặc framework agent.

| Agent | Model | Effort | Phạm vi |
| --- | --- | --- | --- |
| Main / Fullstack Lead | `gpt-6.1-sol` | `medium` | Yêu cầu, chia việc, quyết định, tích hợp và kiểm tra |
| `frontend` | `gpt-6-luna` | `medium` | React/TypeScript, UI, state và nối API |
| `backend` | `gpt-6.1-sol` | `medium` | FastAPI, nghiệp vụ, PostgreSQL và migrations |
| `reviewer` / Debugger | `gpt-6.1-sol` | `high` | Review độc lập có phạm vi; ca khó mới nâng mức |

## Các file

- [`.codex/config.toml`](../.codex/config.toml): mặc định Main và tối đa ba
  sub-agent đồng thời, không tính Main.
- [`frontend.toml`](../.codex/agents/frontend.toml),
  [`backend.toml`](../.codex/agents/backend.toml),
  [`reviewer.toml`](../.codex/agents/reviewer.toml): tên, nhiệm vụ, model,
  effort và hướng dẫn riêng của từng sub-agent.
- [`AGENTS.md`](../AGENTS.md): routing và trách nhiệm tích hợp của Main.
  Hướng dẫn nghiệp vụ trong [frontend](../frontend/AGENTS.md) và
  [backend](../backend/AGENTS.md) tiếp tục áp dụng.

## Routing

- Task nhỏ, sửa cục bộ hoặc chỉ sửa tài liệu: Main tự làm.
- Frontend có phạm vi đáng kể: giao `frontend`.
- Backend/database có phạm vi đáng kể: giao `backend`.
- FE và BE độc lập sau khi thống nhất API contract: giao song song, phân rõ file.
  Nếu còn phụ thuộc, giải quyết contract/phần nền trước rồi mới giao phần còn lại.
- Main tự review các thay đổi nhỏ/thường bằng Sol/Medium. Không gọi reviewer chỉ
  vì bắt đầu chat/lượt mới, cập nhật trạng thái, sửa TODO/tài liệu hoặc chạy test.
- Khi cần góc nhìn độc lập cho một tính năng đáng kể hoặc vấn đề correctness/
  security cụ thể, giao `reviewer` Sol/High; gom thay đổi và review diff liên quan.
- Mỗi tính năng/mốc: mặc định một lượt review độc lập và tối đa một lượt kiểm tra
  lại bản sửa lỗi P1/nghiêm trọng. Main tự kiểm tra các bản sửa nhỏ. Chat/lượt mới
  không đặt lại giới hạn này cho cùng mốc; không review lại bằng chứng không đổi.
- Sol/Extra High (`xhigh`) chỉ cho câu hỏi còn khó hoặc khi bạn yêu cầu. Astra/High
  chỉ cho nguyên nhân bug khó hoặc vấn đề kiến trúc/bảo mật/concurrency quan trọng
  chưa giải quyết sau Sol, hoặc khi bạn yêu cầu rõ. Main nêu vấn đề chưa giải
  quyết trước khi nâng mức; không mặc định chạy cả Sol lẫn Astra. Lượt nâng mức
  tính vào giới hạn review; vượt giới hạn cần yêu cầu rõ của bạn hoặc vấn đề
  P1/nghiêm trọng mới có thay đổi thực chất, với lý do và phạm vi cụ thể.

Reviewer mặc định review-only và có sandbox mặc định `read-only`. Main thường
nhận finding rồi tự sửa hoặc giao cho frontend/backend. Reviewer chỉ implement
khi Main giao rõ phạm vi và phiên làm việc thực sự cho phép ghi. Sandbox/quyền
runtime của Main có thể được áp lại khi spawn; hướng dẫn review-only vẫn áp dụng.
Các sub-agent không tự tạo thêm agent; Main quản lý tài liệu chung và TODO.

Vẫn chỉ có ba role. File native reviewer cố định Sol/High; khi nâng mức có lý do,
Main dùng spawn generic/default, truyền model/effort và cùng hướng dẫn review-only
trong phạm vi hẹp. Không chọn role reviewer cố định để ghi đè effort/model, vì
giá trị trong file custom agent được ưu tiên.

Reviewer Astra/High đã tạo trước thay đổi này vẫn giữ model/effort cũ. Main phải
dùng reviewer Sol/High mới cho review thường, không tiếp tục đánh thức phiên Astra
cũ. Cập nhật file không đổi model của sub-agent đang chạy hoặc đã tồn tại.

## Cách dùng

Mở project `workorder-scheduler` trong Codex và bắt đầu chat mới tại thư mục repo.
Kiểm tra bộ chọn của Main là **GPT-6.1 Sol / Medium**. Project đã được đánh dấu
trusted trên máy khi thiết lập; project config chỉ được nạp khi repo trusted.
Cấu hình là mặc định cho phiên mới; model/effort chọn riêng cho chat hoặc CLI có
thể ghi đè mặc định. Thay file không tự đổi model của một lượt đang chạy.

Bạn có thể giao việc bình thường, ví dụ:

- “Sửa nhãn nút Lưu nháp.” → Main tự làm.
- “Cải thiện keyboard navigation cho bảng WO.” → `frontend`.
- “Thêm API lịch sử upload và migration.” → `backend`.
- “Thêm màn hình lịch sử và API theo contract thống nhất; giao FE/BE song song.”
- “Nhờ reviewer tìm nguyên nhân bug mất nháp tái diễn, chỉ phân tích và đề xuất.”


Sau mỗi task hoàn thành, Main luôn kết thúc câu trả lời bằng 1–3 bước tiếp theo
cụ thể, theo thứ tự ưu tiên/phụ thuộc và dựa trên TODO cùng trạng thái đã kiểm chứng.
Nêu việc nên làm đầu tiên, kết quả mong đợi và đầu vào còn cần từ bạn/IT nếu bị chặn.
Nếu không còn việc bắt buộc, nói rõ và đề xuất bước kiểm tra/nghiệm thu phù hợp;
không tạo thêm việc hoặc chuyển phần task chưa hoàn thành thành đề xuất.

Main chỉ giao khi cần, chờ kết quả rồi tích hợp và chạy kiểm tra thích hợp theo
README. Nếu model không khả dụng trên tài khoản, báo rõ để chủ dự án chọn;
không âm thầm thay model.

CLI cũng dùng cùng cấu hình khi chạy từ repo: `codex`.
Để ghi rõ Main cho một lần chạy: `codex -m gpt-6.1-sol -c 'model_reasoning_effort="medium"'`.

Thiết lập được kiểm tra với Codex CLI `0.160.1`. Căn cứ định dạng:
[OpenAI — Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
và [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic).

## Phạm vi xác minh ngày 2026-10-07

Đã parse bốn TOML, đối chiếu role/model/effort, kiểm tra liên kết và placeholder.
Native app-server với strict config xác nhận project config được nạp và Main
Sol/Medium; model/list có đủ ba model với effort tương ứng. Native prompt đã
nạp routing trong AGENTS.md. Không chạy lượt sub-agent/model live hoặc suite
ứng dụng cho thay đổi cấu hình/tài liệu này; model catalog không chứng minh
một lượt gọi model thành công.

## Cập nhật tiết kiệm review ngày 2026-10-08

Theo lựa chọn của chủ dự án, Reviewer mặc định đổi từ Astra/High sang Sol/High.
Main giữ Sol/Medium, frontend và backend giữ cấu hình cũ; áp dụng giới hạn và
điều kiện nâng mức ở trên. Đã kiểm tra TOML, routing nhất quán, liên kết local
và diff; không chạy lượt model để thử routing hoặc lặp suite ứng dụng.
