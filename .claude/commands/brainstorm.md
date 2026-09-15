---
description: Brainstorm user story + thiết kế → tạo Source of Truth (SoT) cho một feature, chờ con người approve
argument-hint: <feature-id> (vd. F4)
---

Phân tích và **brainstorm** feature **$ARGUMENTS** để tạo tài liệu **Source of
Truth (SoT)**. Bước này diễn ra TRƯỚC acceptance test & code. **Không viết
code, không viết file `.feature`.**

Giao cho subagent `analyst`:

1. Đọc mục **$ARGUMENTS** trong `docs/backlog.md` (dependency, trang PRD liên
   quan), phần liên quan trong `PRD.md` (nguồn nghiệp vụ chính, không có
   Notion), `CLAUDE.md` §4 (invariant liên quan), và `api/db/schema.rb` /
   `web/src/` hiện có nếu đã tồn tại.
2. **Brainstorm**: mở rộng user story; vẽ main flow + edge/alternate
   flow; nêu edge case, business rule, UI state (empty/loading/error);
   liệt kê **open question** để con người quyết định.
3. Điền `docs/templates/sot-template.md` vào **`docs/sot/<feature-id>-<slug>.md`**
   với `status: draft`. Không bịa feature ngoài scope (xem mục "Ngoài phạm vi"
   trong `docs/backlog.md`).
   - **§11 phải phủ hết §5.2 & §6**, không chỉ AC gốc — mỗi edge flow (mỗi
     A-item) và mỗi business rule cần một scenario. Scenario phụ thuộc OQ
     chưa quyết → viết theo phương án khuyến nghị, đặt tên
     `Scenario: <...> (pending OQ-n)`.
4. Trình bày cho user: tóm tắt SoT + **danh sách open question** cần giải quyết +
   danh sách scenario ở §11 đang mang tag `(pending OQ-n)`.

Kết thúc bằng lời nhắc: *con người review & approve SoT — đặt status thành
`approved`, điền approver/date, điền Quyết định ở §12, VÀ rà lại từng scenario
`(pending OQ-n)` ở §11 (sửa theo Quyết định thật, bỏ tag) — trước khi chạy
`/design $ARGUMENTS` / `/feature $ARGUMENTS`.*
