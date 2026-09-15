---
description: Kiểm tra tính nhất quán giữa PRD, backlog, schema và UI đã build
---

Audit các source of truth để tìm sự nhất quán và báo cáo drift (không tự sửa khi
chưa xác nhận):

- `PRD.md` ↔ `docs/backlog.md`: mỗi mục nghiệp vụ / trang trong bảng "Giao diện
  bắt buộc" có mục backlog (F-id) tương ứng không? Có mục backlog nào không còn
  trong PRD không?
- `PRD.md` §"Nghiệp vụ" ↔ `api/db/schema.rb` (nếu `api/` đã tồn tại): model/
  field/enum có khớp không (Organization/User/Device/Group/Policy)? Có field
  nào trong schema không có trong PRD (hoặc ngược lại)?
- `web/src/` (nếu đã tồn tại) ↔ `UI_UX_design.md` §2 (IA/routes) và §8
  (component dùng chung): route/component đã build có khớp tên/props đã định
  nghĩa không? Có route/component nào bị tạo trùng chức năng thay vì tái dùng?
- `UI_UX_design.md` ↔ bảng "Giao diện bắt buộc" trong `PRD.md`: mỗi trang bắt
  buộc có route tương ứng trong `UI_UX_design.md` không? Có trang nào được
  thiết kế/build mà PRD không yêu cầu ("không làm trang thừa")?
- **Scope**: phát hiện dấu vết của nghiệp vụ **ngoài phạm vi** theo
  `docs/backlog.md` §"Ngoài phạm vi" (màn hình quản lý Organization, un-retire
  không được thiết kế/ghi tài liệu, bất kỳ nghiệp vụ nào PRD không nhắc tới) —
  đây là ngoài phạm vi và phải bị loại bỏ hoặc yêu cầu ghi rõ vào DESIGN.md.
- `CLAUDE.md` §4 (invariant) ↔ code hiện có: mỗi invariant có test tự động
  tương ứng chưa (grep RSpec/Playwright theo từ khóa: cross-org, unique,
  retired, inactive policy, xóa group, idempotent)?

Xuất ra danh sách "khớp / drift / đề xuất". Chỉ cập nhật để đồng bộ sau khi
user xác nhận.
