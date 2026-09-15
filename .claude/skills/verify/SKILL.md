---
name: verify
description: How to build/launch/drive this Device Management Console app (Rails api/ + Vue web/) for manual verification (not the automated test suites).
---

# Verifying a change in this repo

## Bring up the environment

Local Postgres and both servers are **not** started by default — check before
assuming they're up:

```bash
docker compose up -d db          # postgres:16-alpine, host port set in docker-compose.yml
cd api && bin/rails db:prepare && bin/rails s -p 3000   # Rails API on :3000
cd web && npm run dev                                    # Vue dev server on :5173 (proxies /api to :3000)
```

`DATABASE_URL` etc. live in `api/.env` (not `.env.local`, not committed — copy
from `api/.env.example`). Each Bash tool call is a fresh shell — env vars set
in one call don't persist to the next. Source it inline with whatever command
needs it:

```bash
set -a && source api/.env && set +a && <command>
```

`docker`/`docker compose` commands have occasionally returned completely empty
output with exit 0 in sandboxed environments (looked like the daemon was
unreachable) and then started working again moments later with no change on
my end — if a docker command comes back empty, retry once before concluding
Docker itself is inaccessible.

## Seeded accounts (`api/db/seeds.rb`)

Seed tạo **2 Organization**, mỗi bên ít nhất 1 tài khoản, để chứng minh không
truy cập chéo được (theo yêu cầu PRD). Cập nhật danh sách này khi `seeds.rb`
thay đổi — đây là điểm dễ bị lệch giữa code và tài liệu:

- Org A (`Acme Inc.`): `admin@acme.example` / `Password123!`
- Org B (`Globex Corp.`): `admin@globex.example` / `Password123!`

Login qua `POST /api/v1/sessions` (email+password) → JWT; SPA lưu token, gọi
API kèm `Authorization: Bearer <token>`.

Seed cũng tạo sẵn một số Device/Group/Policy mẫu ở mỗi org để walkthrough UI
ngay sau setup (không cần tạo tay trước khi demo) — xem README §Walkthrough.

## Driving the app directly (not through the acceptance suite)

- Admin UI: `http://localhost:5173` → login bằng tài khoản seed ở trên.
- API trực tiếp (khi cần debug, không thay thế UI khi review): `curl -X POST
  http://localhost:3000/api/v1/sessions -d '{"email":"...","password":"..."}'
  -H 'Content-Type: application/json'`.
- Rails console để tạo fixture nhanh khi cần data chưa có trong seed:
  `cd api && bin/rails c` → `Organization.first.devices.create!(...)`.

## Running the automated suites (see also `docs/sdlc.md`, `/gate`)

```bash
cd api && bundle exec rspec              # backend unit/request specs
cd web && npm run test:unit              # Vue component/unit tests (Vitest)
cd features && npx playwright test       # acceptance (Gherkin, drives real api+web)
```

`/gate` runs all of the above in order and reports pass/fail as a table —
prefer it over running suites ad hoc when checking Definition of Done.
