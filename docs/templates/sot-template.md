---
feature_id: <F-id>
title: <tên feature>
status: draft   # draft | approved
approver:
date:
---

## §1. Meta
- Feature: `<F-id>` — <tên>
- Dependency: <F-id khác, theo `docs/backlog.md`>
- Nguồn: `PRD.md` (mục ...), `docs/backlog.md`

## §2. Summary / User story
Là <role>, tôi muốn <hành động> để <giá trị>.

## §3. Scope
**Trong phạm vi:** ...
**Ngoài phạm vi:** ... (nếu đụng mục "Ngoài phạm vi" của `docs/backlog.md`, ghi rõ lý do loại trừ)

## §4. Main flow
1. ...
2. ...

## §5. Edge & alternate flow
### 5.1 Biến thể chính
- ...

### 5.2 Edge case
- A1. ...
- A2. ...

## §6. Business rule & validation
- Input hợp lệ: ...
- Input bị chặn: ... (kèm invariant liên quan ở `CLAUDE.md` §4 nếu có)

## §7. UI state
- Empty: ...
- Loading: ...
- Error: ...
- Success: ...

## §8. Data & API touchpoint
- Model/field liên quan (dự kiến, chưa chốt — chốt ở `/design`): ...
- Endpoint dự kiến: ...

## §9. RBAC / Authorization
- Role nào gọi được; org-scope check nào bắt buộc (xem `CLAUDE.md` §4).

## §10. Non-functional (performance/scale)
- Có liên quan tới group/list lớn không? Nếu có, ghi rõ ngưỡng (PRD: ~10.000 device/group).

## §11. Acceptance criteria (canonical)
Viết một scenario cho **mỗi** edge flow ở §5.2 và **mỗi** business rule ở §6
(input hợp lệ + input bị chặn), cộng RBAC denial. Scenario phụ thuộc open
question chưa chốt → đặt tên `Scenario: ... (pending OQ-n)`.

```gherkin
Scenario: <tên>
  Given ...
  When ...
  Then ...
```

## §12. Decisions & Open questions
| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | ... | ... | |

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật, bỏ tag, rồi mới set `status: approved` ở đầu file.
