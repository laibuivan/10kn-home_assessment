---
description: Tạo/hoàn thiện acceptance test (.feature) cho một feature — chạy RED
argument-hint: <feature-id> (vd. F4)
---

Viết acceptance test cho feature **$ARGUMENTS**. **Chỉ viết test, không
implement feature.**

Giao cho subagent `acceptance-author`:
- Dùng `docs/sot/<...>.md` **đã approved** cho **$ARGUMENTS** làm nguồn chính
  (mục §11 Acceptance criteria là canonical); nếu chưa có hoặc chưa `approved`,
  dừng lại và bảo user chạy `/brainstorm $ARGUMENTS` trước. Đối chiếu với
  `PRD.md` §"Nghiệp vụ" để lấy bối cảnh.
- Trước khi viết: kiểm tra §11 không còn scenario nào mang tag `(pending OQ-n)`
  và mỗi edge flow ở §5.2 / rule ở §6 đã có scenario tương ứng. Thiếu → dừng lại,
  báo user cập nhật §11 (không tự bịa thêm).
- Tạo `features/<slug>.feature` (Gherkin **tiếng Anh**), ngôn ngữ nghiệp vụ — không
  đi vào chi tiết kỹ thuật.
- Thêm step definitions còn thiếu trong `features/steps/`.
- Chạy `npx playwright test` (từ `features/`) và xác nhận test **RED vì
  feature chưa được build** (không phải lỗi cú pháp hay step chưa định nghĩa).

Kết thúc bằng cách liệt kê các scenario đã viết và trạng thái red của từng cái
so với acceptance criterion. Không đụng vào code sản phẩm (`api/`, `web/`).
