---
description: Lên plan vertical slice cho một feature (không code)
argument-hint: <feature-id> (vd. F4)
---

Lên plan implementation cho feature **$ARGUMENTS**. **Không viết code.**

**Design gate:** cần `docs/design/$ARGUMENTS-{db,api,frontend}.md` đều
`status: approved`. Nếu thiếu file nào hoặc chưa approved → dừng lại, bảo user
chạy `/design $ARGUMENTS` trước.

Dùng subagent `Plan`. Đọc 3 bản thiết kế đã approved, mục **$ARGUMENTS** trong
`docs/backlog.md`, phần liên quan trong `PRD.md`, và `api/db/schema.rb` /
`api/app/controllers/` / `web/src/` hiện có nếu đã tồn tại.

Plan gồm:
- **Dependencies**: đã sẵn sàng chưa (theo dependency map của backlog)?
- **Task breakdown**: chia slice thành các task nhỏ, đánh số `T1, T2, ...`
  (bảng: Task / Layer / File / Phụ thuộc / Acceptance scenario) — xem quy tắc
  chia task trong subagent `Plan`.
- **Sơ đồ thứ tự thực hiện**: gom task theo wave (song song trong cùng wave,
  tuần tự giữa các wave) dựa trên cột Phụ thuộc.
- **Rủi ro / open question** cần giải quyết trước khi build.

Subagent ghi plan này ra **`docs/plan/$ARGUMENTS-<slug>.md`** (template
`docs/templates/plan-template.md`) — ghi đè nếu file đã có; lịch sử các lần lên
plan xem qua `git log -- docs/plan/$ARGUMENTS-*.md`. Chỉ tóm tắt ngắn trong chat,
không dán lại toàn bộ bảng task.
