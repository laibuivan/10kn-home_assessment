# Device Management Console

Take-home assessment — see [`PRD.md`](PRD.md) for the spec,
[`CLAUDE.md`](CLAUDE.md) for how this repo is built (stack, invariants, ATDD
workflow), [`DESIGN.md`](DESIGN.md) for the design rationale, and
[`docs/overview.md`](docs/overview.md) for a one-page map of every feature —
FE route ↔ API endpoint ↔ exact seed record to test it, including the 4
policy-resolution/conflict scenarios (F9).

## Quickstart (Docker — one command)

Requires only Docker (Desktop or OrbStack) — no local Ruby/Node/Postgres needed.

```bash
docker compose up --build
```

- API: <http://localhost:3010> (health check: `/up`)
- Web: <http://localhost:5173>
- DB: `localhost:5433` (`postgres`/`postgres`)
- Worker: no exposed port — runs `bin/jobs` (Solid Queue supervisor) against
  the same database as `api`, started automatically by `docker compose up`
  (F8: async "gán Policy cho Group" jobs need this running or they stay
  `pending` forever — see `docs/design/F8-db.md` §2.1).

First run builds all three app images (`api`, `worker`, `web`) and runs
`rails db:prepare` automatically — no separate setup step. Subsequent runs
reuse the build cache and the `db-data` volume, so `docker compose up` (no
`--build`) is enough once images exist. Ports are non-default (3010/5433) to
avoid clashing with anything else already running on your machine — override
via a root `.env` (see `.env.example`) if those also collide.

## Chạy test (1 lệnh)

Với stack đã `docker compose up` sẵn (Playwright ở root repo chạy qua
`api`/`web` thật, không mock — cần `npm install` ở root 1 lần trước đó):

```bash
docker compose exec -e RAILS_ENV=test api bundle exec rspec && \
docker compose exec api bundle exec rubocop && \
docker compose exec web npm run lint && \
docker compose exec web npm run test:unit && \
npm run test:e2e
```

4 gate bắt buộc (rubocop, rspec, eslint+vitest, Playwright — xem `CLAUDE.md`
§3) đều nằm trong lệnh trên; dừng ngay ở gate đầu tiên fail nhờ `&&`.
(`/gate` trong Claude Code chạy đúng các bước này — xem `docs/sdlc.md`.)

## Native dev (no Docker)

`api/` and `web/` also run natively if you'd rather not use Docker — requires
Ruby 4.0.x, Node 24.x, and a local Postgres 16 (`mise install` provisions the
Ruby/Node versions if you use [mise](https://mise.jdx.dev)). Point `api/`'s
`DATABASE_HOST`/`DATABASE_PORT`/etc at your local Postgres, then:

```bash
cd api && bundle install && bin/rails db:prepare && bin/rails s
cd web && npm install && npm run dev
```

## What's here

Built through the ATDD workflow in `docs/sdlc.md` — see `docs/backlog.md` for
the full feature list. **`F0`–`F9` đều Done** (3 gate bắt buộc xanh): auth/JWT
+ Login (`F0`), Device list/create/edit/detail (`F2`–`F4`), Group CRUD +
membership tại scale (`F5`–`F6`), Policy CRUD + assignment (`F7`–`F8`, gán
Group lớn chạy async qua Solid Queue), và policy-resolution/conflict engine
(`F9`, panel "Policy đang áp dụng" trên Device Detail). Chi tiết route/API/
seed fixture của từng feature ở [`docs/overview.md`](docs/overview.md).

### Tài khoản seed

`bin/rails db:seed` (chạy tự động bởi `docker compose up --build` ở lần đầu,
idempotent — chạy lại bao nhiêu lần cũng an toàn) tạo 2 Organization tách biệt
hoàn toàn dữ liệu với nhau:

| Organization | Email | Password | Ghi chú |
|---|---|---|---|
| Acme Inc. | `admin@acme.example` | `Password123!` | tài khoản chính để walkthrough |
| Globex Corp. | `admin@globex.example` | `Password123!` | login xong thấy Device/Group/Policy hoàn toàn khác Acme — chứng minh tách Organization |
| Acme Inc. | `shared.login@example.com` | `AcmePass123!` | cùng email tồn tại ở CẢ 2 org — chứng minh email unique theo org, không unique toàn hệ thống |
| Globex Corp. | `shared.login@example.com` | `GlobexPass123!` | — |
| Acme Inc. | `inactive@acme.example` | `Password123!` | `status: inactive` — login phải bị từ chối |

Cùng với đó: Device trải đủ mọi platform/status (kể cả `retired` bất biến và
device chưa từng check-in), Group (kể cả 1 group rỗng và 1 group ~300 device
để demo job async), Policy đủ `active`/`inactive`, và — quan trọng nhất — 4
kịch bản dựng sẵn để tự tay kiểm chứng engine tính conflict của `F9` (direct
thắng group, tie-break theo `updated_at`, candidate inactive bị loại, cách ly
giữa 2 Organization). Danh sách đầy đủ + cách test từng cái ở
[`docs/overview.md`](docs/overview.md).

### Walkthrough 5 phút (gán Policy + xem Device detail)

1. `docker compose up --build`, mở <http://localhost:5173>, đăng nhập
   `admin@acme.example` / `Password123!`.
2. **Devices** → phân trang/lọc theo platform, status → click vào 1 device
   (vd. `ACME-0001`) → Device Detail hiện "Group đang thuộc" và **"Policy
   đang áp dụng"** — device này có sẵn xung đột giữa policy gán trực tiếp và
   policy qua Group (banner "Đã tự động chọn policy ưu tiên cao hơn..." ở đầu
   bảng, icon ⚠ cạnh dòng `password`) — bấm "Xem tất cả nguồn" để thấy từng
   policy ứng viên, cái nào thắng và vì sao.
3. **Groups** → click **"Bulk Ops (F8 demo)"** (~300 device, seed sẵn) → tab
   Policy → gán thêm 1 Policy khác (vd. `Corp WiFi`) cho group này → banner
   góc dưới phải hiện ngay trạng thái `pending` → `running` → `done` (poll
   mỗi 2s) — không phải bấm xong không biết gì. Muốn thấy nhánh `pending`
   kẹt lại: `docker compose stop worker` trước khi gán, gán xong quan sát
   banner đứng yên ở `pending`, rồi `docker compose start worker` để job
   chạy tiếp tới `done`.
4. **Policies** → mở `Legacy VPN` (`status: inactive`) → nút "Gán cho
   Group"/"Gán cho Device" bị disable ngay ở UI (Policy inactive không được
   gán — validate cả 2 tầng, UI lẫn service layer bên dưới). Mở 1 Policy
   `active` khác để thấy luồng gán thật hoạt động bình thường.
5. Đăng xuất, đăng nhập lại bằng `admin@globex.example` — toàn bộ
   Device/Group/Policy khác hẳn Acme, chứng minh tách Organization tuyệt đối.
