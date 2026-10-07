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
khớp backend Dockerfile. `actions/setup-python` v7.0.0 cài Python trước setup-uv;
`uv sync --frozen --no-python-downloads` dùng đúng binary đã cài. Không dùng
`uv python install`: catalog uv 0.11.9 thiếu bản tải 3.12.14 Linux dù Python đã phát hành.
Checkout/setup-python/setup-uv/setup-node được khóa theo SHA release chính thức.
PostgreSQL CI/Compose và các base image đã khóa digest; xem [container checks](container-checks.md).
Lockfile backend giữ nguyên; frontend chỉ vá transitive development dependency
source-map-js 1.2.1 → 1.2.2 theo [advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Job PostgreSQL dùng database `scheduler_test` ở `127.0.0.1:55432`, đáp ứng guard
`integration_settings()` hiện có. Mật khẩu `ci-test-only` chỉ dùng cho service container
được GitHub tạo mới mỗi job; không phải credential môi trường local/staging/production.
Workflow không nạp Entra/Maximo secrets, không gọi hệ thống thật và không deploy ứng dụng.
Downgrade chỉ nằm trong job với DB mới, trước khi tests tạo dữ liệu synthetic; không
thực hiện lệnh này trên DB ứng dụng. Hướng dẫn local: [Database tests](database-tests.md).

Token workflow chỉ có `contents: read`; checkout không lưu Git credential cho các bước
sau. Một lần chạy mới hủy lần cũ cùng branch/PR, mỗi job có timeout. Không dùng
`pull_request_target`. Không bỏ qua job theo đường dẫn để trạng thái CI luôn đủ ba job.

Workflow đã commit/push trong [dd9cae6](https://github.com/miketybear/workorder-scheduler/commit/dd9cae6d00a7aa99d955e05d3dcee3725cc294ae),
được GitHub connector xác nhận ngày 2026-10-07. Đã đọc run/job logs của
[run 37590200157](https://github.com/miketybear/workorder-scheduler/actions/runs/37590200157)
cho commit 9e4cf58: frontend checks/build **success** trên Ubuntu 24.04; hai backend jobs
**failure** tại `uv python install`, báo không tìm thấy cpython-3.12.14-linux-x86_64-gnu.
Migrations/tests backend chưa chạy trong lần này; combined commit statuses rỗng không
phản ánh kết quả Actions. Bản sửa setup-python hiện ở working tree, chưa có kết quả
GitHub runner sau sửa; cần commit/push rồi xác minh lại đủ ba job.
Branch protection/required checks cần được cấu hình riêng nếu chủ dự án muốn bắt buộc CI
trước merge; task này không thay đổi settings của repository.

Ghi nhận ban đầu 2026-10-07, trước khi đọc job logs: actionlint 1.7.12, backend 136 fast + 100 PostgreSQL tests,
Ruff lint/format, frontend 138 tests/12 files, ESLint, TypeScript/build đều qua trên
Windows local. Vòng migrations của CI qua trên database tạm mới ở PostgreSQL test;
hai schema checks không lệch, database tạm đã xóa. Tại checkpoint này GitHub/Linux chưa xác minh.

Kiểm chứng tiếp 2026-10-07: actionlint qua với workflow sửa; **244 backend tests**
(136 fast + 108 PostgreSQL) qua trên Windows và Docker Linux Python 3.12.14.
Frozen clean sync, upgrade/check/downgrade/upgrade/check qua trong container với DB tạm
riêng, schema không lệch. Frontend clean `npm ci`, **151 tests**, lint/typecheck/build
và `npm audit` 0 advisories qua. Docker backend/web builds và smoke checks qua.
Docker Linux là Debian/Alpine; không gọi đây là corrected GitHub Ubuntu run.
Browser harness synthetic của [nhóm lớn/phím](large-batch-keyboard-tests.md) chưa thêm vào CI.

Nguồn đối chiếu: [GitHub PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers),
[checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node),
[setup-uv](https://github.com/astral-sh/setup-uv),
[setup-python v7.0.0](https://github.com/actions/setup-python/tree/5fda3b95a4ea91299a34e894583c3862153e4b97),
[catalog Python Actions](https://github.com/actions/python-versions/blob/main/versions-manifest.json).


## Admin privilege tests — 2026-10-07

Job PostgreSQL đảm bảo `psql` có trên PATH (cài postgresql-client khi thiếu) để chạy
SQL provisioning/real runtime LOGIN test trên DB/roles tạm, không phụ thuộc tên Docker
container Windows. Backend current local suite 254 tests qua; frontend 160 tests qua.
Actionlint cho thay đổi workflow qua; chưa có corrected GitHub run cho working tree mới.
