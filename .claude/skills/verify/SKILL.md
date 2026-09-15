---
name: verify
description: How to build/launch/drive this Device Management Console app (Rails api/ + Vue web/) for manual verification (not the automated test suites).
---

# Verifying a change in this repo

## Bring up the environment

Nothing is started by default — check before assuming it's up. Single command
for the whole stack (db + api + web), see root `README.md`:

```bash
docker compose up --build -d
```

- API on `http://localhost:3010` (health check: `/up`), DB on `localhost:5433`.
- Web on `http://localhost:5173`.
- First boot runs `bin/rails db:prepare` automatically (create + migrate);
  re-running is idempotent (safe on an already-migrated DB).
- Run gates inside the containers: `docker compose exec api bundle exec rspec`,
  `docker compose exec api bundle exec rubocop`, `docker compose exec web npm
  run lint`, `docker compose exec web npm run test:unit`.
- Host ports (3010/5433) are non-default on purpose — this machine already had
  an unrelated project bound to 3000/5432. Override via root `.env` (see
  `.env.example`) if 3010/5433 also collide.

`docker`/`docker compose` commands have occasionally returned completely empty
output with exit 0 in sandboxed environments (looked like the daemon was
unreachable) and then started working again moments later with no change on
my end — if a docker command comes back empty, retry once before concluding
Docker itself is inaccessible.

Native (no Docker) also works — see root `README.md` §"Native dev".

## Seeded accounts (`api/db/seeds.rb`) — target design, not built yet

`api/db/seeds.rb` is still the Rails default stub — this is F0/F1's job (see
`docs/backlog.md`), not done yet. Once implemented, seed should create **2
Organization**, mỗi bên ít nhất 1 tài khoản, để chứng minh không truy cập chéo
được (theo yêu cầu PRD). Cập nhật danh sách này khi `seeds.rb` thay đổi — đây
là điểm dễ bị lệch giữa code và tài liệu:

- Org A (`Acme Inc.`): `admin@acme.example` / `Password123!`
- Org B (`Globex Corp.`): `admin@globex.example` / `Password123!`

Login qua `POST /api/v1/sessions` (email+password) → JWT; SPA lưu token, gọi
API kèm `Authorization: Bearer <token>`.

Seed cũng tạo sẵn một số Device/Group/Policy mẫu ở mỗi org để walkthrough UI
ngay sau setup (không cần tạo tay trước khi demo) — xem README §Walkthrough.

## Driving the app directly (not through the acceptance suite)

- Admin UI: `http://localhost:5173` → login bằng tài khoản seed ở trên (một
  khi F1 xong — hiện chưa có trang login thật, chỉ có Vite default page).
- API trực tiếp (khi cần debug, không thay thế UI khi review): `curl -X POST
  http://localhost:3010/api/v1/sessions -d '{"email":"...","password":"..."}'
  -H 'Content-Type: application/json'` (một khi endpoint này tồn tại — hiện
  API chỉ có `/up`).
- Rails console để tạo fixture nhanh khi cần data chưa có trong seed:
  `docker compose exec api bin/rails c` → `Organization.first.devices.create!(...)`.

## Running the automated suites (see also `docs/sdlc.md`, `/gate`)

```bash
cd api && bundle exec rspec              # backend unit/request specs
cd web && npm run test:unit              # Vue component/unit tests (Vitest)
cd features && npx playwright test       # acceptance (Gherkin, drives real api+web)
```

`/gate` runs all of the above in order and reports pass/fail as a table —
prefer it over running suites ad hoc when checking Definition of Done.
