# Plan — F2 Device list (phân trang + lọc platform/status)

## Readiness
- SoT: `docs/sot/F2-device-list.md` — approved (2026-09-15, lai.bui.vtp@gmail.com).
- Design DB/API/Frontend (`docs/design/F2-{db,api,frontend}.md` +
  `F2-frontend-preview.html`) — cả 3 approved (2026-09-15).
- Dependency: F0 (`docs/backlog.md`) — đã xong (schema `organizations`/`users`,
  JWT auth, `Authenticatable`, routes, `AppShell`/`LoginView`/placeholder
  `DeviceListView` đều đã commit, test xanh).
- Không có mâu thuẫn giữa SoT và 3 bản thiết kế.

## Quyết định implement-time (không phải open question mới)
- Pundit được wire từ F2 theo đúng Quyết định đã approve ở
  `docs/design/F2-api.md` §5 (OQ-API-1): thêm gem, `ApplicationPolicy`,
  `DevicePolicy`. Controller dùng `authorize Device` + `policy_scope(Device)`,
  không gọi thẳng `current_organization.devices`.
- Gem/infra setup (Gemfile, migration) được xếp Layer "Data", theo đúng
  precedent `docs/plan/F0-foundation.md` (T3/T4 ở đó).
- 6 component dùng chung mới (`FilterBar`, `DataTable`, `PaginationBar`,
  `StatusBadge`, `EmptyState`, `ErrorState`) và view `DeviceListView.vue` xếp
  Layer "UI"; việc chọn component tự làm `router.replace` hay emit event lên
  view do `slice-implementer` quyết định lúc code — không chốt ở plan này
  (xem Rủi ro).

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | `Gemfile`: thêm gem `pundit`; `bundle install` | Data | `api/Gemfile` | — | — |
| T2 | Migration `CreateDevices` (`identifier`, `name`, `platform:integer`, `os_version`, `status:integer default:0`, `last_seen_at`, `organization_id` `index:false`) + index unique `(organization_id, identifier)` + index `(organization_id, created_at, id)` + `(organization_id, platform)` + `(organization_id, status)` | Data | `api/db/migrate/*_create_devices.rb` | — | — |
| T3 | Model `Device` (`belongs_to :organization`, `enum platform`, `enum status`, validate `identifier` presence+uniqueness scope org, `name` presence) | Data | `api/app/models/device.rb` | T2 | Unique `identifier` trong org, không unique toàn hệ thống |
| T4 | `Organization`: thêm `has_many :devices` | Data | `api/app/models/organization.rb` | T2 | — |
| T5 | FactoryBot `factory :device` (traits theo platform/status) | Test | `api/spec/factories/devices.rb` | T3 | — |
| T6 | RSpec model spec `Device` (uniqueness scope org, presence, enum values) | Test | `api/spec/models/device_spec.rb` | T3, T5 | Unique trong org; validate name/identifier |
| T7 | `ApplicationPolicy` (base, `scope` raise `NotImplementedError` theo convention Pundit) | API | `api/app/policies/application_policy.rb` | T1 | — |
| T8 | `DevicePolicy` (`index?` luôn `true` cho user active; `Scope#resolve` trả `current_organization.devices`) | API | `api/app/policies/device_policy.rb` | T7, T3, T4 | — |
| T9 | RSpec spec `DevicePolicy` (Scope chỉ resolve device của org hiện tại, `index?` true) | Test | `api/spec/policies/device_policy_spec.rb` | T8, T5 | Org A không thấy device org B qua Scope |
| T10 | `Api::V1::DevicesController#index` — validate `page`/`per_page` (`Integer(str, exception:false)`, gom lỗi), clamp `per_page` max 100, whitelist enum `platform`/`status` (`.in?`), `authorize Device` + `policy_scope(Device)`, order `created_at desc, id desc`, count trước limit/offset, render `{devices, meta}` | API | `api/app/controllers/api/v1/devices_controller.rb` | T8, T3 | Toàn bộ §2 logic của `F2-api.md`; message lỗi đúng chữ đã chốt |
| T11 | `routes.rb`: `namespace :api { namespace :v1 { resources :devices, only: [:index] } }` | API | `api/config/routes.rb` | T10 | — |
| T12 | RSpec request spec `GET /api/v1/devices` (org-scope A9 kể cả total_count, filter platform/status/AND A3/A4, page/per_page hợp lệ A5, page vượt total_pages A6→200 rỗng, page/per_page sai kiểu A7→422, per_page vượt ngưỡng A8→clamp không lỗi, platform/status enum sai→422 cả 2 field, 401 không token/token hết hạn A10) | Test | `api/spec/requests/api/v1/devices_spec.rb` | T11, T5 | Toàn bộ scenario liên quan API ở SoT §11 |
| T13 | `db/seeds.rb`: thêm Device rải rác platform/status cho ≥1 Organization, idempotent (`find_or_create_by!` theo `identifier`+org) | Data | `api/db/seeds.rb` | T3, T4 | Chạy seed nhiều lần không tạo trùng |
| T14 | `components.css`: thêm modifier `.data-table.is-clickable` bọc quanh rule `tr:hover td { cursor: pointer }` hiện có (không xóa rule cũ) | UI | `web/src/styles/components.css` | — | Bảng F2 không trông "bấm được" |
| T15 | `types/device.ts` — `Device`, `DeviceListMeta`, `DeviceListResponse`, `DevicePlatform`, `DeviceStatus` khớp `F2-api.md` §1 | UI | `web/src/types/device.ts` | — | — |
| T16 | `api/devices.ts` — `fetchDeviceList(params)` dùng `apiClient` có sẵn, không truyền `per_page` | UI | `web/src/api/devices.ts` | T15 | — |
| T17 | `stores/devices.ts` — Pinia `devices/meta/loading/error`, action `fetchDevices`, không giữ filter/page trong store, giữ data cũ khi loading/error | UI | `web/src/stores/devices.ts` | T16 | Giữ bảng cũ khi lỗi xảy ra lúc đổi trang |
| T18 | `components/StatusBadge.vue` (dùng lại `.badge.active/.inactive/.retired`) | UI | `web/src/components/StatusBadge.vue` | T15 | — |
| T19 | `components/FilterBar.vue` (select Platform + Status, nút "Xóa lọc" điều kiện) | UI | `web/src/components/FilterBar.vue` | T15 | Nút "Xóa lọc" chỉ hiện khi có filter |
| T20 | `components/DataTable.vue` (6 cột, skeleton rows khi loading rỗng, overlay khi loading có data, `onRowClick` optional không truyền ở F2, `last_seen_at` null → "—") | UI | `web/src/components/DataTable.vue` | T14, T15 | Skeleton lần đầu; overlay khi đổi filter/trang; em-dash khi null |
| T21 | `components/PaginationBar.vue` ("Hiển thị x–y / tổng", prev/next/số trang, disable khi loading hoặc ngoài `[1,total_pages]`) | UI | `web/src/components/PaginationBar.vue` | T15 | A5 trang cuối ít dòng hơn |
| T22 | `components/EmptyState.vue` (2 biến thể: A1 không CTA, A2 có nút "Xóa lọc") | UI | `web/src/components/EmptyState.vue` | — | A1, A2 |
| T23 | `components/ErrorState.vue` (banner đỏ + nút "Thử lại") | UI | `web/src/components/ErrorState.vue` | — | A11 |
| T24 | `views/devices/DeviceListView.vue` — đọc/sanitize `route.query` (platform/status/page không hợp lệ → bỏ/mặc định), gọi `fetchDevices`, watcher `route.query`, `router.replace` khi đổi filter (reset page) / đổi trang (giữ filter) / xóa lọc, auto-redirect `page` → `meta.total_pages` khi vượt, ráp toàn bộ component T18-T23 | UI | `web/src/views/devices/DeviceListView.vue` | T17, T18, T19, T20, T21, T22, T23 | Toàn bộ §4/§5.1 SoT: reload URL giữ filter+trang, đổi filter reset page 1, đổi trang giữ filter |
| T25 | Vitest `stores/devices.spec.ts` (fetch thành công, lỗi giữ data cũ, loading state) | Test | `web/src/stores/__tests__/devices.spec.ts` | T17 | — |
| T26 | Vitest component `DeviceListView.spec.ts` (empty A1/A2, error+"Thử lại", đổi filter reset page trên URL, đổi trang giữ filter, hydrate đúng từ URL có sẵn filter+page, redirect khi page vượt total_pages, "—" khi `last_seen_at` null) | Test | `web/src/views/devices/__tests__/DeviceListView.spec.ts` | T24 | Toàn bộ scenario FE-facing ở SoT §11 |

## Sơ đồ thứ tự thực hiện

```text
Wave 1 (song song): T1, T2, T14, T15, T22, T23
        │
        ▼
Wave 2 (song song): T3, T4, T7, T16, T18, T19, T20, T21
        │
        ▼
Wave 3 (song song): T5, T8, T13, T17
        │
        ▼
Wave 4 (song song): T6, T9, T10, T24, T25
        │
        ▼
Wave 5 (song song): T11, T26
        │
        ▼
Wave 6: T12
```

## Rủi ro / open question

- **Pundit lần đầu wire vào repo (T1/T7/T8)**: `DevicePolicy#index?` luôn
  `true` nên `Pundit::NotAuthorizedError` không bao giờ thực sự raise ở F2.
  `docs/design/F2-api.md` không yêu cầu thêm `rescue_from
  Pundit::NotAuthorizedError` vào `ApplicationController` ở F2 (không có
  nhánh lỗi nào cần nó). Việc thêm rescue này chưa được chốt ở design — nếu
  không làm ở F2, F3 (khi có `create`/`update` với rule thật) sẽ là nơi tự
  nhiên cần bổ sung. Không tự thêm ở plan này để tránh mở rộng scope; ghi
  nhận để F3 không bỏ sót.
- **Quyền quyết định của `slice-implementer` (không phải open question cần
  duyệt lại)**: `docs/design/F2-frontend.md` §2 mô tả trigger/action theo
  từng element (vd "FilterBar — select Platform" → `router.replace(...)`)
  nhưng không nói rõ `FilterBar.vue`/`PaginationBar.vue` tự gọi
  `useRouter()` hay chỉ emit event để `DeviceListView.vue` xử lý routing.
  Vì 2 component này được thiết kế dùng chung cho F3+ (không phải mọi
  màn hình dùng chúng đều đồng bộ filter qua URL theo cùng cách), khuyến
  nghị **emit event lên view** (giữ component "dumb"/tái sử dụng được),
  nhưng đây là quyết định implement-time, không chặn việc build — nêu ở đây
  để review không bất ngờ nếu implementer chọn khác.
- **Thứ tự wave khá sâu (6 wave)** — phần lớn do chuỗi
  DB→Policy→Controller→Route→Request-spec tuần tự đúng bản chất (T3/T4→T8→
  T10→T11→T12), giống pattern F0. Không cố ép phẳng.
- **T13 (seed) không có acceptance scenario riêng ở SoT §11** — chỉ là yêu
  cầu demo ở SoT §3, không bị RSpec/Vitest nào kiểm tra trực tiếp; kiểm tra
  thủ công lúc verify.
- Trước khi `slice-implementer` bắt đầu: `acceptance-author` viết
  `features/f2-device-list.feature` (RED) trước — bước 4 của `/feature F2`,
  không nằm trong bảng T-task trên (chỉ dành cho unit/integration/component
  test).
