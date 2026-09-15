# Plan — F0 foundation

## Readiness
- SoT: `docs/sot/F0-foundation.md` — **approved** (2026-09-15).
- Design DB/API/Frontend (`docs/design/F0-{db,api,frontend}.md` +
  `F0-frontend-preview.html`) — **cả 3 approved** (2026-09-15).
- Dependency: F0 là nền tảng, không phụ thuộc feature nào khác.

## Quyết định implement-time (ghi ở đây vì không phải open question — SoT/design
đã cho phép chọn, chỉ chốt cụ thể lúc lên plan)

- **Không dùng Tailwind.** `UI_UX_design.md` §1 cho phép "Tailwind... hoặc
  component lib nhẹ nếu Claude Code thấy hợp lý hơn". Preview HTML đã
  approved (`F0-frontend-preview.html`) dùng CSS custom properties (token ở
  `UI_UX_design.md` §12) trực tiếp, không qua Tailwind. Giữ nguyên cách này khi
  code thật: `web/src/styles/tokens.css` port y hệt token đã duyệt — tránh
  phải dịch lại sang `tailwind.config` rồi có nguy cơ lệch màu/spacing so với
  bản preview đã review. Ghi vào "giả định" của `DESIGN.md` khi viết tài liệu
  đó.

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | Migration tạo bảng `organizations` (`name:string null:false`) | Data | `api/db/migrate/*_create_organizations.rb` | — | — |
| T2 | Migration tạo bảng `users` (`organization_id`, `email`, `password_digest`, `status:integer default:0`) + unique index `(organization_id, email)` + index đơn `email` | Data | `api/db/migrate/*_create_users.rb` | T1 | Unique trong org (không unique toàn hệ thống) |
| T3 | `Gemfile`: bỏ comment `bcrypt`, thêm `jwt`; `bundle install` | Data | `api/Gemfile` | — | — |
| T4 | Set `jwt_secret` trong Rails credentials (`bin/rails credentials:edit`) | Data | `api/config/credentials.yml.enc` | T3 | — |
| T5 | Model `Organization` (`has_many :users, dependent: :restrict_with_error`) | Data | `api/app/models/organization.rb` | T1 | — |
| T6 | Model `User` (`belongs_to :organization`, `has_secure_password`, `enum status`, normalize email lowercase, validate uniqueness scope `organization_id`) | Data | `api/app/models/user.rb` | T2, T3 | Unique trong org; user active mới login được |
| T7 | `db/seeds.rb`: 2 Organization, mỗi bên ≥1 User, `find_or_create_by!` (idempotent) | Data | `api/db/seeds.rb` | T5, T6 | Chạy seed nhiều lần không tạo trùng |
| T8 | Service encode/decode JWT (HS256, claim `user_id`/`organization_id`/`exp` 24h) | Logic | `api/app/services/json_web_token.rb` | T4 | — |
| T9 | Concern `Authenticatable` — đọc header, decode JWT, **load `User` tươi từ DB**, set `current_user`/`current_organization`, 401 mọi lỗi | API | `api/app/controllers/concerns/authenticatable.rb` | T6, T8 | Không token → 401; token hết hạn → 401; user bị deactivate giữa phiên vẫn bị chặn |
| T10 | `Api::V1::SessionsController#create` — tìm `User` theo email (mọi org), thử từng candidate nếu trùng email (OQ-2), check password + active, phát JWT | API | `api/app/controllers/api/v1/sessions_controller.rb` | T6, T8 | Login thành công; sai password; sai email; user inactive; email trùng 2 org |
| T11 | `Api::V1::MeController#show` — trả `current_user`/`current_organization` | API | `api/app/controllers/api/v1/me_controller.rb` | T9 | Gọi `/me` không token → 401 |
| T12 | `routes.rb`: namespace `api/v1`, `POST /sessions`, `GET /me` | API | `api/config/routes.rb` | T10, T11 | — |
| T13 | `ApplicationController`: `rescue_from` chuẩn hoá lỗi 422 (`{"errors": {...}}`) / 401 (`{"error": "..."}`) | API | `api/app/controllers/application_controller.rb` | T9 | Submit rỗng → 422, không phải 400/500 |
| T18 | FactoryBot: `organization`, `user` factory | Test | `api/spec/factories/organizations.rb`, `api/spec/factories/users.rb` | T5, T6 | — |
| T14 | RSpec model spec `Organization` | Test | `api/spec/models/organization_spec.rb` | T5, T18 | — |
| T15 | RSpec model spec `User` (unique scope org, active-only login, normalize email) | Test | `api/spec/models/user_spec.rb` | T6, T18 | Unique trong org; email trùng 2 org được phép |
| T16 | RSpec request spec `POST /api/v1/sessions` (toàn bộ scenario §11 liên quan) | Test | `api/spec/requests/api/v1/sessions_spec.rb` | T12, T18 | Mọi scenario login ở SoT §11 |
| T17 | RSpec request spec `GET /api/v1/me` (không token, token hết hạn, user deactivate giữa phiên) | Test | `api/spec/requests/api/v1/me_spec.rb` | T12, T18 | 3 scenario auth-middleware ở SoT §11 |
| T19 | `web/src/styles/tokens.css` — port token từ `UI_UX_design.md` §12 (đã approved qua preview) | UI | `web/src/styles/tokens.css` | — | — |
| T20 | `web/src/api/client.ts` — axios instance, interceptor đính token + xử lý 401 | UI | `web/src/api/client.ts` | — | — |
| T21 | `web/src/stores/auth.ts` — Pinia: `login`, `logout`, `hydrate`, `isAuthenticated` | UI | `web/src/stores/auth.ts` | T20 | — |
| T22 | `web/src/router/index.ts` — route `/login`, `/devices` + guard | UI | `web/src/router/index.ts` | T21 | — |
| T23 | `web/src/components/AppShell.vue` — topbar (org name, user menu) + sidebar (Devices active, Groups/Policies ẩn) | UI | `web/src/components/AppShell.vue` | T21, T19 | Topbar hiện đúng tên Organization |
| T24 | `web/src/views/LoginView.vue` — theo `F0-frontend.md` §2 + preview đã approved | UI | `web/src/views/LoginView.vue` | T21, T19 | Login thành công; lỗi 401 hiện message chung; lỗi 422 hiện dưới field |
| T25 | `web/src/views/devices/DeviceListView.vue` — placeholder trong `AppShell` | UI | `web/src/views/devices/DeviceListView.vue` | T23 | — |
| T26 | `web/src/App.vue` — `<router-view>` + loading toàn trang khi đang `hydrate()`; xoá `HelloWorld.vue`/scaffold mặc định | UI | `web/src/App.vue` | T21, T22 | — |
| T27 | Vitest: `stores/auth.ts` (login success/fail, hydrate, logout) | Test | `web/src/stores/__tests__/auth.spec.ts` | T21 | — |
| T28 | Vitest component: `LoginView.vue` (render, submit disable+spinner, hiện banner lỗi) | Test | `web/src/views/__tests__/LoginView.spec.ts` | T24 | — |

## Sơ đồ thứ tự thực hiện

```text
Wave 1: T1, T3, T19, T20
        │
        ▼
Wave 2: T2, T4, T5, T21
        │
        ▼
Wave 3: T6, T8, T22, T23, T24, T27
        │
        ▼
Wave 4: T7, T9, T10, T18, T25, T26, T28
        │
        ▼
Wave 5: T11, T13, T14, T15
        │
        ▼
Wave 6: T12
        │
        ▼
Wave 7: T16, T17
```

## Rủi ro / open question

- Chuỗi auth (T6→T8→T9→T10/T11→T12→T16/T17) khá sâu (7 wave) — đúng bản chất
  của việc login phụ thuộc tuần tự model→JWT→middleware→controller→route→test,
  không cố ép phẳng ra ít wave hơn cho đẹp bảng.
- T10 (candidate matching khi trùng email 2 org — OQ-2) là phần dễ viết sai
  nhất trong slice này — `slice-implementer` cần bám sát đúng thứ tự
  `id ASC` đã chốt ở `F0-api.md` §2, có test riêng ở T16 cho đúng kịch bản này.
- Trước khi `slice-implementer` chạy các task trên: `acceptance-author` phải
  viết `features/f0-foundation.feature` (RED) trước — đây là bước 4 của
  `/feature F0`, không nằm trong bảng T-task ở trên (T-task chỉ cho
  unit/integration test, không phải acceptance Gherkin).
