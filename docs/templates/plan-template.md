# Plan — <F-id> <slug>

## Readiness
- SoT: `docs/sot/<id>-<slug>.md` — approved? (ngày, approver)
- Design DB/API/Frontend — cả 3 approved?
- Dependency (theo `docs/backlog.md`) đã xong chưa?

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | | Data\|API\|Logic\|UI\|Test | | — | |

Quy tắc: Data trước API cần nó; API trước UI gọi nó; Logic thuần
(`api/app/services/`) tách task riêng; mỗi test (RSpec/Vitest) là task riêng,
phụ thuộc task code nó kiểm tra.

## Sơ đồ wave

```text
Wave 1 (song song): T1, T4
        │
        ▼
Wave 2 (song song): T2, T3
        │
        ▼
Wave 3: T5
```

## Rủi ro / open question
- ...
