# Cấu hình Codex cho Work Order Scheduler

Dự án dùng một Main và ba sub-agent. Cấu hình nằm trong repo, dùng định dạng
native của Codex; không cần cài thêm plugin hoặc framework agent.

| Agent | Model | Effort | Phạm vi |
| --- | --- | --- | --- |
| Main / Fullstack Lead | `gpt-6.1-sol` | `medium` | Yêu cầu, chia việc, quyết định, tích hợp và kiểm tra |
| `frontend` | `gpt-6-luna` | `medium` | React/TypeScript, UI, state và nối API |
| `backend` | `gpt-6.1-sol` | `medium` | FastAPI, nghiệp vụ, PostgreSQL và migrations |
| `reviewer` / Debugger | `gpt-6-astra` | `high` | Kiến trúc, bug khó/lặp lại và review thay đổi lớn |

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
- Quyết định kiến trúc, bug khó hoặc tái diễn, và review cuối của thay đổi lớn:
  giao `reviewer`. Main quyết định và xử lý các finding trước khi kết thúc.

Reviewer mặc định review-only và có sandbox mặc định `read-only`. Main thường
nhận finding rồi tự sửa hoặc giao cho frontend/backend. Reviewer chỉ implement
khi Main giao rõ phạm vi và phiên làm việc thực sự cho phép ghi. Sandbox/quyền
runtime của Main có thể được áp lại khi spawn; hướng dẫn review-only vẫn áp dụng.
Các sub-agent không tự tạo thêm agent; Main quản lý tài liệu chung và TODO.

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
