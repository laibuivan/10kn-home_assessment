---
description: Thiết kế chi tiết Database → API → Frontend cho một feature (tuần tự, mỗi bản cần con người approve) trước khi lên Plan
argument-hint: <feature-id> (vd. F4)
---

Thiết kế chi tiết cho feature **$ARGUMENTS**, chạy tuần tự qua 3 bản thiết kế:
**Database → API → Frontend**. Mỗi bản phải được con người approve trước khi
làm bản tiếp theo. **Không viết code.**

0. **SoT gate (bắt buộc):** kiểm tra `docs/sot/<...>.md` cho **$ARGUMENTS** là
   `status: approved`. Nếu chưa → dừng lại, bảo user chạy `/brainstorm $ARGUMENTS`
   trước.

1. **Database design:**
   - Nếu `docs/design/<id>-db.md` chưa tồn tại → giao cho subagent `db-designer`
     tạo draft từ SoT + `PRD.md` + `api/db/schema.rb` hiện có (nếu `api/` đã tồn tại).
   - Nếu tồn tại nhưng `status` chưa `approved` → dừng lại, nhắc user review &
     approve trước khi tiếp tục.
   - Nếu đã `approved` → qua bước 2.

2. **API design:**
   - Nếu `docs/design/<id>-api.md` chưa tồn tại → giao cho subagent `api-designer`
     tạo draft từ SoT + thiết kế Database đã approved + `PRD.md`.
   - Nếu tồn tại nhưng chưa `approved` → dừng lại, nhắc user approve.
   - Nếu đã `approved` → qua bước 3.

3. **Frontend design:**
   - Nếu `docs/design/<id>-frontend.md` chưa tồn tại → giao cho subagent
     `frontend-designer` tạo draft từ SoT + thiết kế API đã approved +
     **`UI_UX_design.md`** (design system nền, bắt buộc tuân theo route/
     component/pattern đã định nghĩa ở đó) + bảng "Giao diện bắt buộc" trong
     `PRD.md` để đối chiếu completeness. **Bắt buộc kèm theo**
     `docs/design/<id>-frontend-preview.html` (từ
     `docs/templates/design-frontend-preview-base.html`) — publish qua
     Artifact tool để user xem trực tiếp. Hai file này duyệt **cùng một lúc**,
     không tách gate riêng.
   - Nếu tồn tại nhưng chưa `approved` → dừng lại, nhắc user approve — nhắc
     rõ cả file `.md` lẫn file preview `.html` đều cần được xem trước khi approve.
   - Nếu đã `approved` → cả 3 bản thiết kế đã sẵn sàng.

Mỗi lần dừng lại chờ approve: tóm tắt bản thiết kế vừa tạo + open question, và
nhắc rõ *con người phải set `status: approved` (điền approver/date) trong file
đó rồi chạy lại `/design $ARGUMENTS` để tiếp tục bước kế*.

Khi cả 3 đã `approved`: báo "Sẵn sàng cho `/plan $ARGUMENTS`" và dừng — không
tự động chạy `/plan`.
