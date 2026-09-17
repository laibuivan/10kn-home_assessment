# Backlog — Device Management Console

Nguồn: `PRD.md` (đọc trực tiếp — không có Notion). Mỗi dòng là một feature
`F-id`; agent trong vòng đời ATDD (`docs/sdlc.md`) đọc mục tương ứng ở đây để
biết scope + dependency, rồi đọc `PRD.md` để lấy chi tiết nghiệp vụ.

| ID | Feature | Trang PRD liên quan | Dependency | SoT | Design | Plan |
|---|---|---|---|---|---|---|
| F0 | Foundation: ~~Rails API + Vue skeleton, Postgres~~ (done, PR #1/#2) + Organization/User model, JWT auth + **Login page** (hấp thụ F1), seed 2 org | (nền tảng) + Login | — | [approved](sot/F0-foundation.md) | [DB](design/F0-db.md) [API](design/F0-api.md) [Frontend](design/F0-frontend.md) approved | [done](plan/F0-foundation.md) |
| ~~F1~~ | ~~Login & session~~ — gộp vào F0 (SoT F0 đã đặc tả login end-to-end từ POST /api/v1/sessions tới Login page; tách riêng SoT/design cho F1 chỉ trùng lặp) | Login | — | — | — | — |
| F2 | Device list (phân trang + lọc platform/status) — **Done** | Devices | F0 | [approved](sot/F2-device-list.md) | [DB](design/F2-db.md) [API](design/F2-api.md) [Frontend](design/F2-frontend.md) approved | [done](plan/F2-device-list.md) |
| F3 | Device create/edit + validate (identifier unique trong org) — **Done** | Devices | F2 | [approved](sot/F3-device-create-edit.md) | [DB](design/F3-db.md) [API](design/F3-api.md) [Frontend](design/F3-frontend.md) approved | [done](plan/F3-device-create-edit.md) |
| F4 | Device detail (info, group đang thuộc, policy đang áp dụng) — **Done** | Device detail | F3 | [approved](sot/F4-device-detail.md) | [DB](design/F4-db.md) [API](design/F4-api.md) [Frontend](design/F4-frontend.md) approved | [done](plan/F4-device-detail.md) |
| F5 | Group CRUD (list/create/edit/xóa an toàn) — **Done** | Groups | F0 | [approved](sot/F5-group-crud.md) | [DB](design/F5-db.md) [API](design/F5-api.md) [Frontend](design/F5-frontend.md) approved | [done](plan/F5-group-crud.md) |
| F6 | Group membership tại scale (thêm/gỡ device, chịu 10.000 device, idempotent) — **Done** | Groups (chi tiết) | F5, F3 | [approved](sot/F6-group-membership.md) | [DB](design/F6-db.md) [API](design/F6-api.md) [Frontend](design/F6-frontend.md) approved | [done](plan/F6-group-membership.md) |
| F7 | Policy CRUD (list/create/edit, status) — **Done** | Policies | F0 | [approved](sot/F7-policy-crud.md) | [DB](design/F7-db.md) [API](design/F7-api.md) [Frontend](design/F7-frontend.md) approved | [done](plan/F7-policy-crud.md) |
| F8 | Policy assignment (gán Group và/hoặc Device; chặn inactive/chéo org; chịu group lớn, có trạng thái running/done/failed) — **Done** | Policies (gán), Groups (chi tiết) | F6, F7, F4 | [approved](sot/F8-policy-assignment.md) | [DB](design/F8-db.md) [API](design/F8-api.md) [Frontend](design/F8-frontend.md) approved | [done](plan/F8-policy-assignment.md) |
| F9 | Policy resolution engine (policy đang áp dụng trên Device, xử lý conflict cùng `type`) — **Done** | Device detail (policy đang áp dụng) | F8 | [approved](sot/F9-policy-resolution.md) | [DB](design/F9-db.md) [API](design/F9-api.md) [Frontend](design/F9-frontend.md) approved | [done](plan/F9-policy-resolution.md) |

Cột SoT/Design/Plan cập nhật link file (`docs/sot/F1-login.md` ...) và trạng
thái (`draft`/`approved`) khi chạy `/brainstorm`, `/design`, `/plan`. Để trống
`—` nghĩa là chưa bắt đầu.

## Dependency (đọc thêm cột Dependency ở bảng trên)

- F0 → F2, F5, F7 (nền tảng, không phụ thuộc feature khác; F1 đã gộp vào F0)
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
