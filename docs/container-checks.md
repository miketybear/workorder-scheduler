# Container builds và Linux checks — 2026-10-07

Backend và web images đã dựng thành công từ lockfiles trên Docker Desktop Linux.
Backend runtime chạy UID 10001, liveness/readiness trả `ok` trên PostgreSQL tạm riêng.
Nginx `-t` qua. Đây là build/smoke local; HTTPS/Entra, Ubuntu routing tới Maximo,
full Compose staging, backup/restore và production deployment chưa nghiệm thu.

## Digests đã khóa

Giữ các version tags đã có và thêm multi-platform manifest digest xác minh từ registry;
không dùng digest của image ứng dụng build local thay cho digest base image.

| Base image | Manifest digest |
| --- | --- |
| python:3.12.14-slim | `sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f` |
| ghcr.io/astral-sh/uv:0.11.9 | `sha256:6b6fa841d71a48fbc9e2c55651c5ad570e01104d7a7d701f57b2b22c0f58e9b1` |
| node:26.0.0-alpine | `sha256:30f5a66e7265ef70aac56b4753ffa7905e54eca1084bc25503893ad8e9273f05` |
| nginx:1.28-alpine | `sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236` |
| postgres:17-alpine | `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |

Áp dụng ở [backend Dockerfile](../backend/Dockerfile), [frontend Dockerfile](../frontend/Dockerfile),
[Compose](../compose.yaml), [test Compose](../compose.test.yaml),
[Entra local Compose](../compose.entra-local.yaml) và [CI](../.github/workflows/ci.yml).
Digest PostgreSQL khớp image test đã dùng (17.11 trên Alpine 3.24). Backend sync có
`--no-python-downloads` để binary Python từ base image là runtime được dùng.
Digest khóa khả năng tái lập; cần review/refresh có chủ đích khi vá image, không chứng minh image an toàn.

## Kiểm tra Linux

- Build backend: Python 3.12.14 + uv 0.11.9, `uv sync --frozen --no-dev --no-install-project`
  với Python downloads disabled qua; không copy `.env`, `.venv` hoặc tests vào runtime image.
- Build frontend: Node 26.0.0, clean `npm ci`, TypeScript/Vite build qua; runtime chỉ có nginx và dist.
- Image tests tạm dựa trên backend image, bổ sung Python pin/tests và frozen dev dependencies.
  **244 tests / 136 fast + 108 PostgreSQL**, Ruff lint/format qua trên Linux.
- PostgreSQL tạm `scheduler_test`, port 55432 **chỉ bên trong container**, không publish
  host port/bind mount. Test runner chia network namespace để guard localhost:55432
  vẫn áp dụng; không đổi guard cho phép database vận hành.
- Upgrade/check/downgrade base/upgrade/check chạy trước tests trên DB mới; hai schema checks
  không lệch. Database test Windows, Entra local và dữ liệu vận hành không bị downgrade.
- Runtime backend không cấu hình Maximo/Entra; `/api/health/live` và `/api/health/ready`
  trả ok, readiness ghi rõ `database-schema-only`. Không chứng minh upstream integration.
- Nginx configuration validation dùng mapping backend về loopback; chưa chạy full proxy/HTTPS stack.

Dockerfiles/container source đều chỉ chứa cấu hình test giả. Container tạm được dọn sau
kiểm tra; images local-check giữ local để tái lập. Không push image, deploy hoặc ghi Maximo.

## Dependency patch và phần còn lại

`npm ci` phát hiện [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
trên source-map-js 1.2.1. Chỉ cập nhật entry transitive **dev** này tới 1.2.2 trong
package-lock; package.json không đổi, không thêm package/runtime dependency. Clean install,
151 frontend tests, build và `npm audit` 0 advisories qua. Đây là kết quả npm registry
tại thời điểm kiểm tra, chưa là scan toàn bộ OS/Python/container image.

Python 3.12 đang ở security-fixes-only tới tháng 10/2028; 3.12.14 đã được thay bởi
3.12.15 theo [Python versions](https://www.python.org/doc/versions/) và
[release lifecycle](https://test.python.org/downloads/release/python-31214/).
Task này giữ baseline đã kiểm chứng để sửa CI và pin artifact. Đánh giá/nâng security patch
runtime, toàn bộ dependency lifecycle, OS image scan/SBOM và chính sách refresh digest còn mở.
Corrected workflow phải được commit/push và chạy lại trên GitHub Ubuntu; kết quả Linux
local không thay cho lần chạy đó. Xem [CI](ci.md) và [todos](todos.md).
