# Device Management Console

Take-home assessment — see [`PRD.md`](PRD.md) for the spec and
[`CLAUDE.md`](CLAUDE.md) for how this repo is built (stack, invariants, ATDD
workflow). This file will grow into the full setup/seed/test/walkthrough guide
the PRD requires as features land — for now it only covers running the
skeleton.

## Quickstart (Docker — one command)

Requires only Docker (Desktop or OrbStack) — no local Ruby/Node/Postgres needed.

```bash
docker compose up --build
```

- API: <http://localhost:3010> (health check: `/up`)
- Web: <http://localhost:5173>
- DB: `localhost:5433` (`postgres`/`postgres`)

First run builds both images and runs `rails db:prepare` automatically — no
separate setup step. Subsequent runs reuse the build cache and the `db-data`
volume, so `docker compose up` (no `--build`) is enough once images exist.
Ports are non-default (3010/5433) to avoid clashing with anything else already
running on your machine — override via a root `.env` (see `.env.example`) if
those also collide.

Run the gates inside the containers, e.g.:

```bash
docker compose exec -e RAILS_ENV=test api bundle exec rspec
docker compose exec api bundle exec rubocop
docker compose exec web npm run lint
docker compose exec web npm run test:unit
```

(`/gate` in Claude Code runs all of these plus the E2E suite once it exists —
see `docs/sdlc.md`.)

## Native dev (no Docker)

`api/` and `web/` also run natively if you'd rather not use Docker — requires
Ruby 4.0.x, Node 24.x, and a local Postgres 16 (`mise install` provisions the
Ruby/Node versions if you use [mise](https://mise.jdx.dev)). Point `api/`'s
`DATABASE_HOST`/`DATABASE_PORT`/etc at your local Postgres, then:

```bash
cd api && bundle install && bin/rails db:prepare && bin/rails s
cd web && npm install && npm run dev
```

## What's here so far

Built through the ATDD workflow in `docs/sdlc.md` — see `docs/backlog.md` for
the full feature list/status. Done so far: `F0` (Organization/User, JWT auth,
Login), `F2` (Device list — pagination + platform/status filter), `F3`
(Device create/edit, identifier unique per Organization, retired-immutable),
`F4` (Device detail page — info, plus the "Groups đang thuộc"/"Policy đang áp
dụng" panels), `F5` (Group CRUD — list/create/edit/delete, org-scoped),
`F6` (Group membership at scale — add/remove Device to/from a Group from
either side, paginated up to 10k members per Group, idempotent bulk-add via
`upsert_all`; the "Groups đang thuộc" panel on Device Detail is now live).
Not built yet: Policies, policy assignment/resolution.

`bin/rails db:seed` (run automatically by `docker compose up --build` on
first run) creates 2 Organizations ("Acme Inc.", "Globex Corp.") each with a
login account at `admin@<org>.example` / `Password123!`, a spread of Devices
across every platform/status combo, a few Groups, and a handful of Group
memberships linking them — enough to exercise pagination, filtering, the
detail pages, and Group membership add/remove from the UI. The full 5-minute
walkthrough this section owes the PRD will be written once Policies exist too
(walking through "gán policy" needs that feature).
