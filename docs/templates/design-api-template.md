---
feature_id: <F-id>
status: draft   # draft | approved
approver:
date:
---

# Thiết kế API — <F-id>

Nguồn: `docs/design/<id>-db.md` (approved), `docs/sot/<id>-<slug>.md`, `PRD.md`,
router/controller pattern hiện có trong `api/app/controllers/`.

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| | | | | | luôn qua `current_organization.<assoc>` — xem `CLAUDE.md` §4 |

## 2. Business logic từng endpoint

Với mỗi endpoint: thứ tự thao tác, side effect (enqueue job, cập nhật entity
liên quan), transaction boundary nếu multi-step.

## 3. Lỗi / edge case

- Not found (đúng ngữ nghĩa 404 khi resource thuộc org khác — không phải 403).
- Trùng dữ liệu (unique trong org).
- Vi phạm business rule (`CLAUDE.md` §4: retired device, inactive policy...).
- Validate input (dùng `ActiveModel` validation hoặc form object riêng — nêu rõ).

## 4. Xử lý bất đồng bộ (nếu có, vd. gán policy cho group lớn)

- Job nào (Solid Queue), input/output job, endpoint poll trạng thái, trạng
  thái enum (`pending/running/done/failed`), idempotency key/unique index.

## 5. Rủi ro / open question
- ...
