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

Only the Rails/Vue skeleton + Docker Compose — no business logic yet (no
Organization/User/Device/Group/Policy models, no auth, no seed data). That's
`F0` in `docs/backlog.md`, built through the ATDD workflow in `docs/sdlc.md`.
The seed accounts, test-run instructions, and 5-minute walkthrough the PRD
requires will be added here once real features exist.
