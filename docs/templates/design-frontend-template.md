---
feature_id: <F-id>
status: draft   # draft | approved
approver:
date:
---

# Thiết kế Frontend — <F-id>

Nguồn: `docs/design/<id>-api.md` (approved), `docs/sot/<id>-<slug>.md`,
**`UI_UX_design.md`** (design system nền — route/component/pattern bắt buộc
tuân theo), bảng "Giao diện bắt buộc" trong `PRD.md`, component/token đã có
trong `web/src/components/`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/<id>-frontend-preview.html` — dựng từ
`docs/templates/design-frontend-preview-base.html`. Không approve file `.md`
này khi chưa xem file preview.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|

## 2. Element / Trigger / Action / Notes

| Element | Trigger | Action | Notes |
|---|---|---|---|

## 3. State management

- Pinia store nào, action nào gọi endpoint nào (query khi mount / mutation khi
  submit), optimistic update nếu có.
- List lớn: phân trang thật (query param `page`/`per_page`), không render hết.

## 4. Empty / loading / error / success

- Empty: ...
- Loading: ... (không spinner vô hạn — timeout/retry)
- Error: ... (message từ API hiện ra được, không nuốt lỗi)
- Success: ...
- Nếu có thao tác async chạy nền (gán policy group lớn): UI thể hiện rõ
  running/done/failed, không phải "bấm xong không biết gì" (PRD).

## 5. Rủi ro / open question
- ...
