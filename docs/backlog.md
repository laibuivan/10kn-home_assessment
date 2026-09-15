# Backlog — Device Management Console

Nguồn: `PRD.md` (đọc trực tiếp — không có Notion). Mỗi dòng là một feature
`F-id`; agent trong vòng đời ATDD (`docs/sdlc.md`) đọc mục tương ứng ở đây để
biết scope + dependency, rồi đọc `PRD.md` để lấy chi tiết nghiệp vụ.

| ID | Feature | Trang PRD liên quan | Dependency | SoT | Design | Plan |
|---|---|---|---|---|---|---|
| F0 | Foundation: ~~Rails API + Vue skeleton, Postgres~~ (done, PR #1/#2) + Organization/User model, JWT auth scaffold, seed 2 org | (nền tảng, không phải 1 trang) | — | [approved](sot/F0-foundation.md) | — | — |
| F1 | Login & session | Login | F0 | — | — | — |
| F2 | Device list (phân trang + lọc platform/status) | Devices | F0 | — | — | — |
| F3 | Device create/edit + validate (identifier unique trong org) | Devices | F2 | — | — | — |
| F4 | Device detail (info, group đang thuộc, policy đang áp dụng) | Device detail | F3 | — | — | — |
| F5 | Group CRUD (list/create/edit/xóa an toàn) | Groups | F0 | — | — | — |
| F6 | Group membership tại scale (thêm/gỡ device, chịu 10.000 device, idempotent) | Groups (chi tiết) | F5, F3 | — | — | — |
| F7 | Policy CRUD (list/create/edit, status) | Policies | F0 | — | — | — |
| F8 | Policy assignment (gán Group và/hoặc Device; chặn inactive/chéo org; chịu group lớn, có trạng thái running/done/failed) | Policies (gán), Groups (chi tiết) | F6, F7, F4 | — | — | — |
| F9 | Policy resolution engine (policy đang áp dụng trên Device, xử lý conflict cùng `type`) | Device detail (policy đang áp dụng) | F8 | — | — | — |

Cột SoT/Design/Plan cập nhật link file (`docs/sot/F1-login.md` ...) và trạng
thái (`draft`/`approved`) khi chạy `/brainstorm`, `/design`, `/plan`. Để trống
`—` nghĩa là chưa bắt đầu.

## Dependency (đọc thêm cột Dependency ở bảng trên)

- F0 → F1, F2, F5, F7 (nền tảng, không phụ thuộc feature khác)
- F2 → F3 → F4
- F5 → F6
- F4, F6, F7 → F8
- F8 → F9 (F9 cũng cập nhật lại khối "Policy đang áp dụng" ở panel của F4)

## Ngoài phạm vi (PRD nói rõ — không tự thêm)

- Màn hình quản lý Organization (PRD: "Không cần màn hình quản lý Organization").
- Un-retire device, trừ khi chủ động thiết kế **và** ghi rõ trong `DESIGN.md`
  (mặc định: không làm — xem `CLAUDE.md` §4).
- Bất kỳ nghiệp vụ nào không xuất hiện trong `PRD.md` (billing, notification,
  audit log UI riêng, v.v.) — nếu thấy cần cho việc khác, ghi vào "Rủi ro/giả
  định" của SoT, không tự build.
