---
description: Chạy toàn bộ vòng đời ATDD cho một feature trong backlog
argument-hint: <feature-id> (vd. F4)
---

Implement feature **$ARGUMENTS** theo quy trình AIDD + ATDD (xem
`CLAUDE.md` §3 và `docs/sdlc.md`). Tuân thủ nghiêm ngặt 5 golden rule.

Thực hiện theo thứ tự sau; dừng lại và báo cáo nếu có gì mâu thuẫn với PRD:

0. **SoT gate (bắt buộc):** kiểm tra `docs/sot/<...>.md` cho **$ARGUMENTS**.
   - Nếu **chưa có** hoặc status **chưa `approved`** → **DỪNG**, bảo user chạy
     `/brainstorm $ARGUMENTS` và xin con người approve SoT trước. Không code.
   - Nếu **`approved`** → qua bước 1.

1. **Design gate (bắt buộc):** kiểm tra `docs/design/$ARGUMENTS-{db,api,frontend}.md`.
   - Nếu thiếu file nào hoặc có file **chưa `approved`** → **DỪNG**, bảo user
     chạy `/design $ARGUMENTS` (thiết kế tuần tự Database → API → Frontend, mỗi
     bản cần con người approve) trước. Không code.
   - Nếu cả 3 đã **`approved`** → dùng chúng làm nguồn tham chiếu chính cho các
     bước sau.

2. **Đọc bối cảnh:** đọc SoT + 3 bản thiết kế đã approved (nguồn chính) cùng
   mục **$ARGUMENTS** trong `docs/backlog.md`, phần liên quan trong `PRD.md`,
   và `CLAUDE.md` §4 (invariant liên quan). Nếu dependency chưa xong → báo cáo
   và dừng.

3. **Plan** (dùng subagent `Plan`): liệt kê vertical slice dựa trên 3 bản thiết
   kế đã approved, chia thành **task nhỏ đánh số T1, T2...** (Data/API/Logic/UI/Test,
   file, phụ thuộc, acceptance scenario) và một **sơ đồ thứ tự thực hiện theo
   wave** (task cùng wave làm song song được). Ghi ra `docs/plan/$ARGUMENTS-<slug>.md`
   (xem `.claude/agents/plan.md`); trình bày tóm tắt ngắn gọn trước khi code.

4. **Viết acceptance test (RED):** giao cho subagent `acceptance-author`
   để tạo/hoàn thiện `features/<slug>.feature` (Gherkin tiếng Anh) + step trong
   `features/steps/`. Chạy `npx playwright test` (từ `features/`) và xác nhận
   **RED** đúng lý do (feature chưa được build, không phải lỗi cú pháp).

5. **Implement vertical slice:** giao cho subagent `slice-implementer` — làm
   theo đúng **thứ tự wave** trong plan (migration/model theo thiết kế Database
   → controller/Pundit policy theo thiết kế API → Vue UI theo thiết kế Frontend
   + bảng "Giao diện bắt buộc" PRD), cùng unit/integration test cho logic mới.
   **Không** sửa acceptance test để pass.

6. **Verify:** chạy `/gate` (rubocop, rspec, eslint+vitest, playwright) đến khi
   mọi thứ **GREEN**.

7. **Review:** chạy `/code-review`; nếu đụng vào auth/tách-org/xóa dữ liệu, chạy
   thêm `/security-review`. Sửa các finding hợp lý.

8. **Tổng kết:** liệt kê file đã tạo/sửa, acceptance scenario đã cover, và
   đề xuất một commit (branch `feat/<slug>`). **Chỉ commit/push khi được yêu cầu.**
