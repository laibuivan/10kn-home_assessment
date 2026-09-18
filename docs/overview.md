# Overview — toàn bộ tính năng của Device Management Console

Một trang duy nhất, đọc trong 5 phút, để biết **hệ thống làm được gì** và
**bấm/gọi ở đâu để tự kiểm tra từng tính năng bằng seed data** — không cần đọc
lại `PRD.md`/`docs/backlog.md`/9 bộ SoT-Design-Plan. Chi tiết "vì sao thiết kế
vậy" nằm ở `DESIGN.md` + `docs/design/<id>-*.md`; file này chỉ liệt kê
**cái gì có** và **test bằng cách nào**.

Toàn bộ `F0`–`F9` trong `docs/backlog.md` đã **Done** (rubocop, rspec,
eslint+vitest xanh). Playwright/E2E (`features/*.feature`) hiện phủ
`F0`/`F2`/`F3`/`F4` — chạy `npm run test:e2e` ở root repo, xem `README.md`.

## 1. Sản phẩm trong một câu

Console nội bộ để 1 Organization quản lý Device/Group/Policy của mình — nhiều
Organization dùng chung 1 hệ thống nhưng **không bao giờ thấy dữ liệu của
nhau** (mọi query scope qua `current_organization`, 404 chứ không phải 403 khi
đoán ID chéo org).

## 2. Đăng nhập & tài khoản seed (F0)

`POST /api/v1/sessions` → JWT Bearer, không cookie. FE lưu token, đính kèm mọi
request qua `Authorization` header (interceptor Axios), 401 → redirect
`/login`.

| Organization | Email | Password | Ghi chú |
|---|---|---|---|
| Acme Inc. | `admin@acme.example` | `Password123!` | tài khoản chính để walkthrough |
| Globex Corp. | `admin@globex.example` | `Password123!` | dùng để chứng minh tách org — login xong thấy Device/Group/Policy hoàn toàn khác Acme |
| Acme Inc. | `shared.login@example.com` | `AcmePass123!` | cùng email tồn tại ở CẢ 2 org, password khác nhau — chứng minh `User.email` unique theo org, không unique toàn hệ thống |
| Globex Corp. | `shared.login@example.com` | `GlobexPass123!` | — |
| Acme Inc. | `inactive@acme.example` | `Password123!` | `status: inactive` — login phải bị từ chối, message KHÔNG được tiết lộ khác với "sai mật khẩu" (chống user-enumeration) |

## 3. Bản đồ tính năng (route FE ↔ API ↔ seed fixture để test)

| F-id | Tính năng | Route FE | Endpoint chính | Test bằng gì trong seed |
|---|---|---|---|---|
| F0 | Login, JWT auth, tách Organization ở tầng auth | `/login` | `POST /sessions`, `GET /me` | 5 tài khoản ở mục 2 |
| F2 | Device list — phân trang + lọc platform/status | `/devices` | `GET /devices` | Acme có 47 device (không chia hết cho `per_page=20` → trang cuối lẻ), Globex có 8 — trộn đủ `ios/android/macos` × `active/inactive/retired`, device #1, #11, #21... (mỗi 10 device một cái) chưa từng check-in (`os_version`/`last_seen_at` là `nil`, cột "Last seen" hiện "—") |
| F3 | Device create/edit + validate | `/devices` (modal), `/devices/:id` | `POST /devices`, `PATCH /devices/:id` | thử tạo `identifier` trùng trong cùng org → 422; thử sửa `ACME-0005` (`status: retired` — xem cột Status ở list `/devices`) → 422 "device retired bất biến" |
| F4 | Device detail — info + Group đang thuộc + Policy đang áp dụng | `/devices/:id` | `GET /devices/:id`, `GET /devices/:id/applied_policies` | `ACME-0001` — xem mục 4 (đây là device demo đầy đủ nhất) |
| F5 | Group CRUD | `/groups` | `GET/POST/PATCH/DELETE /groups` | `Sales Team` trùng tên ở CẢ Acme và Globex — chứng minh `Group.name` unique theo org; xóa thử 1 group → confirm modal, join rows dọn sạch trong transaction |
| F6 | Group membership tại scale (thêm/gỡ device) | `/groups/:id` (tab Thành viên) | `GET/POST /groups/:id/devices`, `DELETE /groups/:id/devices/:device_id` | `Bulk Ops (F8 demo)` — 300 device/org, phân trang tab Thành viên là bắt buộc phải thấy chạy mượt, không load hết 300 dòng cùng lúc |
| F7 | Policy CRUD + status active/inactive | `/policies` | `GET/POST/PATCH /policies` | `Corp WiFi` trùng tên ở cả Acme/Globex (unique theo org); `Legacy VPN` (Acme) có sẵn `status: inactive` để test filter theo status |
| F8 | Policy assignment (Group/Device) + job async cho Group lớn | `/policies/:id`, `/groups/:id` (tab Policy) | `POST/DELETE .../policy_assignments`, `GET /policy_assignment_jobs/:id` | Login xong sẽ thấy banner job (pending/running/done) ngay trên `Bulk Ops (F8 demo)` — job gán `Password Baseline`/`Corp WiFi` cho 300 device được enqueue tự động lúc seed; cần service `worker` chạy (đã có trong `docker compose up`) để job chuyển `done`, tắt worker để tự thấy trạng thái treo ở `pending` không im lặng |
| F9 | Policy resolution — hợp direct ∪ group, xử lý conflict | `/devices/:id` (panel Policy đang áp dụng) | `GET /devices/:id/applied_policies` | 4 device dựng riêng để lộ đủ nhánh — xem mục 4 |

## 4. Kịch bản F9 (policy resolution) — 4 device để tự tay xác nhận từng nhánh

Đây là phần bị chấm nặng nhất (logic thuần, nhiều nhánh) nên có seed riêng cho
từng case trong `CLAUDE.md` §4, xem trực tiếp ở Device Detail hoặc gọi thẳng
`GET /devices/:id/applied_policies`:

| Device | Type | Nguồn cạnh tranh | Kết quả mong đợi | Nhánh chứng minh |
|---|---|---|---|---|
| `ACME-0001` | `password` | direct `Password Baseline` + group `Password Baseline` (Sales Team, Engineering) + group `Executive Password` (Executives, config khác) | Winner = `Password Baseline` (direct), `conflict: true` | **R2** — gán trực tiếp thắng gán qua Group, dù vẫn còn conflict giữa các candidate active |
| `ACME-0002` | `password` | group `Password Baseline` (Engineering) + group `Executive Password` (Executives) — **không có** gán trực tiếp | Winner = `Executive Password` (`updated_at` mới hơn), `conflict: true` | **R3** — hòa direct thì Group mới nhất thắng (không phải thứ tự query) |
| `ACME-0003` | `vpn` | direct `Legacy VPN` (`status: inactive`) + group `Modern VPN` (Sales Team, active) | Winner = `Modern VPN`, `Legacy VPN` vẫn xuất hiện trong `candidates` với `excluded_reason: "Policy đang inactive..."`, type KHÔNG biến mất | **A9's sibling** — 1 candidate inactive không làm cả type biến mất nếu còn ≥1 candidate active |
| `GLBX-0002` (Globex — org khác) | `password` | group `Sales Password` (Sales Team) + group `Screen Lock` (Support) | Winner theo tie-break `updated_at`/`id`, `conflict: true` | Cùng logic R3 nhưng ở **Organization khác** — chứng minh resolver không rò rỉ/không lẫn state giữa 2 org |

Gọi lại `GET /devices/:id/applied_policies` bao nhiêu lần cũng phải ra đúng
kết quả y hệt (R5/A18, không cache, không phụ thuộc thứ tự Ruby trả record) —
đây chính là bất biến "hàm thuần của state hiện tại" ở `CLAUDE.md` §4.

## 5. Việc KHÔNG làm (đọc `docs/backlog.md` "Ngoài phạm vi" nếu cần lý do)

- Không có màn hình quản lý Organization (PRD nói rõ không cần).
- Không có un-retire Device — sửa/gán policy/group cho device `retired` luôn
  trả `422`.
- Không gán được Policy `inactive` hoặc Policy khác Organization — chặn ở
  service layer, seed cũng không dựng trạng thái này qua API (chỉ có
  `Legacy VPN` inactive AFTER đã được gán lúc còn active, đúng luồng thật:
  admin tắt Policy sau khi đã gán — xem mục 4 case `ACME-0003`).

## 6. Chạy & test

```bash
docker compose up --build                 # api :3010, web :5173, db :5433, worker
docker compose exec api bin/rails db:seed # idempotent — chạy lại bao nhiêu lần cũng an toàn
docker compose exec -e RAILS_ENV=test api bundle exec rspec
docker compose exec api bundle exec rubocop
docker compose exec web npm run lint
docker compose exec web npm run test:unit
```

Chi tiết đầy đủ (native dev không Docker, biến môi trường, troubleshoot
worker) ở `README.md`.
