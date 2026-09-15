---
feature_id: <F-id>
status: draft   # draft | approved
approver:
date:
---

# Thiết kế Database — <F-id>

Nguồn: `docs/sot/<id>-<slug>.md` (approved), `PRD.md`, `api/db/schema.rb` hiện có.

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| | | | | |

Ràng buộc phải nêu tường minh: `null: false`, unique (đơn hay composite theo
`organization_id`?), FK + `dependent:` behavior, check constraint nếu có
(vd. `status` enum).

## 2. Migration plan

- Thứ tự migration (tên file dự kiến).
- Có backfill dữ liệu không? Có phá dữ liệu cũ không?
- Migration có reversible (`down`) không?

## 3. Index / hiệu năng

Bắt buộc xét nếu feature đụng list lớn hoặc query theo group (PRD: group cỡ
10.000 device) — nêu index nào, composite theo cột nào, tránh N+1 ở đâu
(`includes`/`preload`).

## 4. Rủi ro / open question
- ...
