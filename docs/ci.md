# Continuous integration

Workflow: [CI](../.github/workflows/ci.yml), chạy cho push, pull request và chạy thủ công
trên GitHub Actions. Ba job độc lập dùng Ubuntu 24.04:

| Job | Kiểm tra |
| --- | --- |
| Backend fast checks | Cài `uv.lock` bằng `uv sync --frozen`; Ruff lint/format; pytest không có marker integration |
| PostgreSQL migrations and integration | PostgreSQL 17 riêng; upgrade/check/downgrade/upgrade/check trên DB trống; toàn bộ tests integration với `--run-db-tests` |
| Frontend checks and build | `npm ci`; TypeScript, ESLint, Vitest và production build |

Python 3.12.14 lấy từ [backend/.python-version](../backend/.python-version), khớp Dockerfile;
Node.js 26.0.0 lấy từ [frontend/.node-version](../frontend/.node-version); uv 0.11.9
khớp backend Dockerfile. Không nâng dependency ứng dụng; hai lockfile hiện có được giữ nguyên.
Các action checkout/setup-uv/setup-node được khóa theo SHA của release chính thức.
PostgreSQL vẫn dùng tag `17-alpine` như Compose test; digest/scan và đánh giá runtime
versions tổng thể còn thuộc checklist riêng.

Job PostgreSQL dùng database `scheduler_test` ở `127.0.0.1:55432`, đáp ứng guard
`integration_settings()` hiện có. Mật khẩu `ci-test-only` chỉ dùng cho service container
được GitHub tạo mới mỗi job; không phải credential môi trường local/staging/production.
Workflow không nạp Entra/Maximo secrets, không gọi hệ thống thật và không deploy ứng dụng.
Downgrade chỉ nằm trong job với DB mới, trước khi tests tạo dữ liệu synthetic; không
thực hiện lệnh này trên DB ứng dụng. Hướng dẫn local: [Database tests](database-tests.md).

Token workflow chỉ có `contents: read`; checkout không lưu Git credential cho các bước
sau. Một lần chạy mới hủy lần cũ cùng branch/PR, mỗi job có timeout. Không dùng
`pull_request_target`. Không bỏ qua job theo đường dẫn để trạng thái CI luôn đủ ba job.

Sau khi commit/push workflow, xem kết quả trong tab Actions của repository. Việc có file
workflow và kiểm tra tương đương ở local chưa chứng minh GitHub runner chạy thành công.
Branch protection/required checks cần được cấu hình riêng nếu chủ dự án muốn bắt buộc CI
trước merge; task này không thay đổi settings của repository.

Kiểm chứng 2026-10-07: actionlint 1.7.12, backend 136 fast + 100 PostgreSQL tests,
Ruff lint/format, frontend 138 tests/12 files, ESLint, TypeScript/build đều qua trên
Windows local. Vòng migrations của CI qua trên database tạm mới ở PostgreSQL test;
hai schema checks không lệch, database tạm đã xóa. Chưa chạy workflow trên GitHub/Linux.

Nguồn đối chiếu: [GitHub PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers),
[checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node),
[setup-uv](https://github.com/astral-sh/setup-uv).
