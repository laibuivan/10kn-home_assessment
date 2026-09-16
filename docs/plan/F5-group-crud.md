# Plan — F5 Group CRUD (list/create/edit/xóa an toàn)

## Readiness
- SoT: `docs/sot/F5-group-crud.md` — **approved** (2026-09-16, lai.bui.vtp@gmail.com).
  §11 có **39 scenario** (scenario "xóa group không để dữ liệu liên kết treo"
  đã bị OQ-3 loại khỏi F5 một cách tường minh và chuyển thành nghĩa vụ F6/F8 —
  **không kéo lại vào F5**).
- Design DB/API/Frontend: `docs/design/F5-db.md`, `docs/design/F5-api.md`,
  `docs/design/F5-frontend.md` (+ `F5-frontend-preview.html`) — **cả 3
  approved** (2026-09-16). Các open question đã được chốt khi approve và plan
  này tuân theo, **không mở lại**:
  - **OQ-API-1 → (a)**: tách `Paginatable` concern dùng chung
    `DevicesController`/`GroupsController` ⇒ có **1 task chạm code F2 đã xanh**
    (T4) và **bắt buộc re-run toàn bộ `devices_spec.rb`** (T5).
  - **OQ-API-2 → giữ nguyên** message `length` tiếng Anh mặc định của Rails ⇒
    **không có task i18n**.
  - **OQ-FE-1 → (a)**: build `components/SearchInput.vue` dùng chung (T19).
  - **OQ-FE-2 → (a)**: `PaginationMeta` vào `types/ui.ts`, `DeviceListMeta`
    thành alias ⇒ task chạm file F2 (T13).
  - **OQ-FE-3 → giữ** `active-class="active"` của `RouterLink` (nằm trong T24,
    không có task riêng).
  - **OQ-FE-4 → (a)**: chuyển `firstQueryValue` sang
    `web/src/utils/queryParams.ts` ⇒ task chạm file F2 (T15).
- Dependency (`docs/backlog.md`): F5 chỉ phụ thuộc **F0 — Done**
  (`Organization`/`User`, JWT `Authenticatable`, Pundit `ApplicationPolicy`
  deny-by-default, `ApplicationController#render_validation_errors` +
  `rescue_from ActiveRecord::RecordNotFound` → 404, `AppShell`, router guard).
  F2/F3/F4 tuy **không** là dependency nghiệp vụ nhưng đều **Done** và F5 tái
  dùng convention/component của chúng (pagination + `meta` của F2, `FormModal`
  + `extractFormErrors` + `rescue_from RecordNotUnique` của F3, `ActionsMenu` +
  `isNotFoundError` của F4).
- **Đọc chéo SoT ↔ 3 design: không phát hiện mâu thuẫn nào.** Hai sai khác so
  với `UI_UX_design.md` §6.1 (bỏ cột "Số device", bỏ action "Xem chi tiết") đã
  được SoT chốt trước ở OQ-4/OQ-5, không phải mâu thuẫn mới. → **Sẵn sàng
  implement.**

## Quy trình áp dụng cho plan này (CLAUDE.md §3 sau cập nhật 2026-09-16)
- Golden rule #3 (viết `.feature` trước) **tạm ngưng** ⇒ **không có task nào**
  cho `features/f5-group-crud.feature` / step definitions Playwright.
- Gate #4 (Playwright) **tạm ngưng** ⇒ Done của F5 tính theo **3 gate**:
  `rubocop`, `rspec`, `eslint + vitest`.
- 39 scenario ở SoT §11 vẫn là **hợp đồng hành vi**; cột "Acceptance scenario"
  dưới đây map từng task với scenario (ký hiệu **S1–S39** theo đúng thứ tự xuất
  hiện trong SoT §11) và với edge case **A1–A25** của SoT §5.2 — để không ý nào
  bị rơi dù chưa viết file `.feature`.
- TDD (rule #4) áp dụng cho pure logic: validate/normalize của `Group` (T3
  trước/song song T1), debounce + single-flight của `SearchInput`/`ConfirmModal`
  (T25/T26), guard `lastRequestId` của store (T29).

### Bảng tra scenario (SoT §11 → ký hiệu dùng trong plan)
| # | Scenario | # | Scenario |
|---|---|---|---|
| S1 | Xem danh sách Group của org mình | S21 | Xóa Group thành công sau khi xác nhận |
| S2 | Danh sách phân trang, không render toàn bộ | S22 | Group đã xóa biến mất hoàn toàn (PATCH → 404) |
| S3 | Trang vượt quá số trang → danh sách rỗng | S23 | Confirm nói rõ device/policy không bị xóa |
| S4 | Tham số phân trang không hợp lệ bị từ chối | S24 | Xóa thất bại do lỗi hạ tầng, không xóa nửa vời |
| S5 | Org chưa có group → empty state + CTA | S25 | Xóa Group đã bị người khác xóa trước đó |
| S6 | Tìm group theo tên | S26 | Bấm xác nhận xóa 2 lần chỉ 1 request |
| S7 | Tìm không khớp → empty state + "Xóa tìm kiếm" | S27 | Xóa dòng cuối trang cuối → tự lùi trang |
| S8 | Tạo Group thành công | S28 | Group của org khác không xuất hiện trong list |
| S9 | Group vừa tạo đứng đầu danh sách | S29 | PATCH group org khác → 404 |
| S10 | Tạo Group không có mô tả vẫn hợp lệ | S30 | DELETE group org khác → 404 và không xóa gì |
| S11 | Tạo với tên rỗng bị chặn | S31 | id không tồn tại → 404 |
| S12 | Trùng tên trong cùng org bị chặn | S32 | id sai định dạng → 404, không 500 |
| S13 | Hai org khác nhau được trùng tên | S33 | Gửi `organization_id` không đổi được org đích |
| S14 | Hai request trùng tên đồng thời → 422, không 500 | S34 | Gọi API không token → 401 |
| S15 | Vượt giới hạn độ dài bị chặn | S35 | Token hết hạn → 401 |
| S16 | Sửa tên + mô tả thành công | S36 | Chưa đăng nhập mở `/groups` → redirect login |
| S17 | Sửa giữ nguyên tên cũ vẫn hợp lệ | S37 | Lỗi hạ tầng khi tải list → banner + "Thử lại" |
| S18 | Sửa thành tên group khác đang dùng bị chặn | S38 | Sidebar có mục Groups + đánh dấu đang chọn |
| S19 | Xóa phải qua bước xác nhận | S39 | Menu hành động chỉ có hành động đã có thật |
| S20 | Hủy hộp thoại xác nhận không xóa | | |

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | Migration `CreateGroups` + model `Group` + `Organization has_many :groups`. Migration đúng như `F5-db.md` §2: `t.references :organization, null: false, foreign_key: true, index: false`, `t.string :name, null: false`, `t.text :description`, `t.timestamps`, `add_index [:organization_id, :name], unique: true`, `add_index [:organization_id, :created_at, :id]`. Model: `belongs_to :organization`; hằng `NAME_TAKEN_MESSAGE` / `NAME_BLANK_MESSAGE`; `before_validation :normalize_name_and_description` (trim `name`; `description.strip.presence` → `nil`; guard `is_a?(String)`); `validates :name` presence(+message)/length 100/uniqueness `scope: :organization_id, case_sensitive: true`; `validates :description, length: { maximum: 500 }, allow_nil: true`. **KHÔNG** khai `has_many :group_memberships`/`:policy_assignments` (bảng chưa tồn tại → `NameError` khi boot; nợ F6/F8). `Organization has_many :groups` **không** `dependent:` (nhất quán `has_many :devices`) | Data | `api/db/migrate/<ts>_create_groups.rb`, `api/app/models/group.rb`, `api/app/models/organization.rb`, `api/db/schema.rb` (sinh ra) | — | Nền cho S1–S18, S22, S28–S33; A4, A5, A6, A7, A10, A25 |
| T2 | FactoryBot `factory :group` — `association :organization`, `sequence(:name) { \|n\| "Group #{n}" }` (tránh đụng unique index khi tạo nhiều record trong 1 spec), `description` mặc định có giá trị + trait `:without_description` | Test | `api/spec/factories/groups.rb` | T1 | — (hạ tầng cho T3, T10, T11) |
| T3 | RSpec model spec `Group` (TDD — viết trước/song song T1): trim `name`; `"   "` → invalid ở field `name` (A4); `description` `""`/`"   "`/`nil` → lưu `nil` (A25); `description` chỉ trim chứ không rỗng thì giữ nguyên; length 100/500 (A10); uniqueness trong org (A5) và **cho phép trùng giữa 2 org** (A6); case-sensitive: `"Sales Team"` vs `"sales team"` **cùng hợp lệ** trong 1 org (`F5-db.md` §4c); `name: nil` → 422-able chứ không `NoMethodError`; `belongs_to :organization` bắt buộc | Test | `api/spec/models/group_spec.rb` | T1, T2 | S11, S12, S13, S15; A4, A5, A6, A10, A25 |
| T4 | **(Chạm code F2 đã xanh — refactor thuần, không đổi hành vi)** Tách `Paginatable` concern: di chuyển `DEFAULT_PAGE`, `DEFAULT_PER_PAGE`, `MAX_PER_PAGE`, `PAGINATION_ERROR`, `pagination_errors`, `valid_pagination_param?`, `coerce_positive_integer`, `page`, `per_page`, `total_pages` từ `private` của `DevicesController` sang concern; `DevicesController` `include Paginatable` và **xóa** bản cũ. Giữ nguyên từng ký tự message `"must be a positive integer"` và mọi comment giải thích `Integer(raw, 10, exception: false)`. **Không** đụng `filter_errors`/`invalid_enum?`/`serialize_device`/`ENUM_ERROR` (ngữ nghĩa riêng của Device) | API | `api/app/controllers/concerns/paginatable.rb` (mới), `api/app/controllers/api/v1/devices_controller.rb` | — | S2, S3, S4 (dùng lại cho Groups); A16, A17, A18 |
| T5 | **Regression gate cho T4**: chạy lại **toàn bộ** `api/spec/requests/api/v1/devices_spec.rb` (+ `me_spec.rb`, `sessions_spec.rb`, `device_policy_spec.rb`) và `rubocop` — **không sửa file spec nào**; nếu có spec đỏ ⇒ T4 đã đổi hành vi, phải sửa T4 chứ không sửa spec | Test | `api/spec/requests/api/v1/devices_spec.rb` (chỉ chạy, không sửa) | T4 | Bảo toàn acceptance của F2/F3/F4 |
| T6 | `GroupPolicy` (mới) — `index?`/`create?`/`update?`/`destroy?` = `true`; **không** khai `show?` (F5 không có action `show`, OQ-5 — để `ApplicationPolicy#show?` = `false` giữ deny-by-default); `Scope#resolve` = `user.organization.groups` (đi qua association, không `Group.where`) | API | `api/app/policies/group_policy.rb` | T1 | S28, S29, S30; A1, SoT §9 |
| T7 | `Api::V1::GroupsController` (mới) — `include Authenticatable`, `include Paginatable`; **index**: `pagination_errors` → 422 trước khi chạm DB (A17), clamp `per_page` (A18), `authorize Group`, `policy_scope(Group)`, filter `q` = `params[:q].to_s.strip` (rỗng ⇒ không lọc) với `scope.where("name ILIKE ?", "%#{Group.sanitize_sql_like(q)}%")` — **bắt buộc `Group.sanitize_sql_like` + placeholder `?`**, `order(created_at: :desc, id: :desc)`, `count` trước `offset/limit`, `meta` 4 field; **create**: `current_organization.groups.build(create_params)` → 201 `{ group: ... }` / `render_validation_errors`; **update**: `policy_scope(Group).find(params[:id])` + `authorize group` + `group.update(update_params)` → 200; **destroy**: `policy_scope(Group).find(params[:id])` + `authorize group` + **`group.destroy!`** + `head :no_content` (204, body rỗng) — kèm comment giải thích cấm `#delete` (xem Rủi ro); `create_params`/`update_params` = `params.permit(:name, :description)` giữ **2 method riêng**; `serialize_group` đúng 5 field (`id, name, description, created_at, updated_at`), **không** `organization_id`, **không** `devices_count` | API | `api/app/controllers/api/v1/groups_controller.rb` | T1, T4, T6 | S1–S3, S6, S8–S10, S13, S15–S18, S21, S22, S28–S33; A1–A3, A8, A14–A18, A20, A22 |
| T8 | `rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken` **local trong `GroupsController`** (không đưa lên `ApplicationController`) + `render_name_taken` dùng **cùng hằng** `Group::NAME_TAKEN_MESSAGE` với nhánh validate thường ⇒ client không phân biệt được A5 vs A7; handler phủ cả `create` lẫn `update` (đổi tên cũng có thể thua race) | API | `api/app/controllers/api/v1/groups_controller.rb` | T1, T7 | S14; A7, A9 |
| T9 | `routes.rb` — thêm đúng 1 dòng trong `namespace :api → :v1`: `resources :groups, only: [ :index, :create, :update, :destroy ]`. **Không** mở `:show`/`:new`/`:edit` (OQ-5) | API | `api/config/routes.rb` | T7 | S1, S8, S16, S21 |
| T10 | RSpec `GroupPolicy` spec — 4 action trả `true`; `show?` vẫn `false` (deny-by-default còn nguyên); `Scope#resolve` chỉ trả group của org user, **không** trả group org khác | Test | `api/spec/policies/group_policy_spec.rb` | T2, T6 | S28; SoT §9 |
| T11 | RSpec request spec `/api/v1/groups` (file mới, khuôn theo `devices_spec.rb`): **index** — chỉ group của org mình (S1/S28), phân trang 25 group → 20 dòng + `meta.total_count = 25` (S2), `page=99` → 200 + mảng rỗng + meta đúng (S3/A16), `page=abc`/`per_page=0` → 422 gom **cả 2 field** (S4/A17), `per_page=999` → `meta.per_page = 100` (A18), `q=sales` khớp một phần không phân biệt hoa/thường (S6), `q` không khớp → `[]` + `total_count: 0` (A15), `q` rỗng/`"   "` → trả tất cả, **`q = "100%"` và `q = "_"` không match bừa** (kiểm chứng `sanitize_sql_like`), **`q = "' OR 1=1 --"` không leak/không 500** (kiểm chứng placeholder), sort `created_at DESC, id DESC` (S9); **create** — 201 + đúng 5 field (S8), `description` rỗng/thiếu → `null` (S10/A25), name `"  Sales Team  "` lưu trimmed, `"   "` → 422 field `name` (S11/A4), trùng tên trong org → 422 + đúng message (S12/A5), trùng tên **khác org → 201** (S13/A6), `name` 101 ký tự / `description` 501 ký tự → 422 (S15/A10), gửi kèm `organization_id` của org khác → group vẫn thuộc org token **và org kia không có thêm group** (S33/A22); **update** — đổi tên+mô tả 200 (S16), giữ nguyên tên cũ của chính nó 200 (S17/A8), đổi thành tên group khác trong org → 422 (S18/A9), `description: ""` → `null`, PATCH chỉ `description` không đụng `name`, id org khác/không tồn tại/`"abc"` → 404 (S29/S31/S32, A1–A3); **destroy** — 204 body rỗng + record biến mất, PATCH lại id đó → 404 (S21/S22), DELETE lần 2 → 404 (A12), DELETE id org khác → 404 **và group kia vẫn tồn tại** (S30), DELETE `"abc"` → 404 không 500 (S32), **assert `Group.count` giảm đúng 1**; **auth** — mọi endpoint không token → 401, token hết hạn → 401 (S34/S35, A20) | Test | `api/spec/requests/api/v1/groups_spec.rb` | T2, T7, T8, T9 | S1–S4, S6, S8–S18, S21, S22, S28–S35; A1–A10, A12, A14–A18, A20, A22, A25 |
| T12 | `db/seeds.rb` — thêm vài Group cho mỗi Organization, **idempotent** (`Group.find_or_create_by!(organization:, name:)` rồi set `description` trong block), đủ để walkthrough README/demo có nội dung thật. Không seed 25 group (dữ liệu phân trang là việc của FactoryBot trong spec) | Data | `api/db/seeds.rb` | T1 | Chạy seed nhiều lần không tạo trùng |
| T13 | **(Chạm file F2 — thuần type-level, không có runtime)** Thêm `export interface PaginationMeta { current_page; per_page; total_count; total_pages }` vào `types/ui.ts`; đổi `types/device.ts`: `export type DeviceListMeta = PaginationMeta` (giữ tên cũ để `stores/devices.ts`/`PaginationBar` không phải sửa), import từ `./ui` | UI | `web/src/types/ui.ts`, `web/src/types/device.ts` | — | Nền cho S2, S27 |
| T14 | `types/group.ts` (mới) — `Group` (5 field, `description: string \| null`, **không** `devices_count`, **không** `organization_id`), `GroupListResponse { groups; meta: PaginationMeta }`, `GroupResponse { group }`, `GroupQueryParams { q?: string; page: number }` (**không** `per_page`), `GroupCreatePayload { name; description? }`, `GroupUpdatePayload { name?; description? }` | UI | `web/src/types/group.ts` | T13 | Hợp đồng cho T16/T17/T21/T22 |
| T15 | **(Chạm file F2 — refactor thuần)** Tạo `utils/queryParams.ts` export `firstQueryValue(value)` (di chuyển nguyên hàm + comment từ `DeviceListView.vue`), sửa `DeviceListView.vue` xóa hàm module-scope và import từ util. Không đổi logic | UI | `web/src/utils/queryParams.ts` (mới), `web/src/views/devices/DeviceListView.vue` | — | Nền cho URL-as-source-of-truth ở T22 |
| T16 | `api/groups.ts` (mới) — đúng **4 hàm**, đi qua `apiClient` có sẵn (không tạo axios instance mới): `fetchGroupList(params)` (GET, axios tự bỏ param `undefined`), `createGroup(payload)` (POST body **phẳng**), `updateGroup(id, payload)` (PATCH), `deleteGroup(id): Promise<void>` (DELETE — **không đọc `response.data`**, 204 body rỗng). **Tuyệt đối không có** `fetchGroup(id)` | UI | `web/src/api/groups.ts` | T14 | S1, S8, S16, S21; A20 (401 qua interceptor sẵn có) |
| T17 | `stores/groups.ts` (mới, khuôn `stores/devices.ts`) — state `{ groups, meta: PaginationMeta \| null, loading, error, lastRequestId }`; `fetchGroups(params)` sở hữu `loading`/`error`, guard `lastRequestId` (bỏ response cũ về muộn — quan trọng hơn F2 vì có debounce search), **giữ nguyên `groups`/`meta` cũ khi refetch lỗi** (không làm trắng bảng), fallback message `'Không tải được danh sách group.'`; `createGroup`/`updateGroup`/`deleteGroup` **không** set `loading`/`error` và **throw nguyên lỗi** lên component; `deleteGroup` **không** tự xóa phần tử khỏi `state.groups` (không optimistic delete). Không có `lastListLocation` (F5 không có trang chi tiết) | UI | `web/src/stores/groups.ts` | T14, T16 | S1, S8, S16, S21, S37; A19 |
| T18 | `styles/components.css` — thêm đúng 2 rule đã chốt: `.search-row { display:flex; gap:10px; align-items:center; margin-bottom:14px; }` + `.search-row .field { width:280px; }` và `.cell-truncate { display:block; max-width:420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`. **Không** thêm CSS cho `ConfirmModal` (dùng lại `.modal*`/`.btn-danger`), không thêm token màu mới | UI | `web/src/styles/components.css` | — | Nền cho T19, T22 |
| T19 | `components/SearchInput.vue` (mới, dùng chung — OQ-FE-1) — props `modelValue`, `placeholder`, `debounceMs = 300`, `testId`, `clearTestId`; emit `change(value)` (đã debounce + **trim**) và `clear`; nút "Xóa tìm kiếm" **chỉ render khi có giá trị** (không nút chết); `keydown.enter` flush debounce ngay; `clearTimeout` ở `onUnmounted`; đồng bộ lại ô input khi `modelValue` đổi từ ngoài (back/forward) | UI | `web/src/components/SearchInput.vue` | T18 | S6, S7 |
| T20 | `components/ConfirmModal.vue` (mới, dùng chung — đặc tả **đầy đủ** ở `F5-frontend.md` §2.1, F6/F8 phải dùng lại **không sửa**) — props `title`, `message`, `confirmLabel='Xác nhận'`, `cancelLabel='Hủy'`, `destructive=false`, `onConfirm: () => Promise<unknown> \| unknown`, `testId`/`confirmTestId`/`cancelTestId`; emit `cancel`, `error`; **single-flight** (`if (submitting) return` đầu `run()`); disable + spinner (`:disabled` + `:data-busy` + `.btn-label`/`.spinner`, không viết CSS mới); **không tự đóng** (parent điều khiển bằng `v-if`); `Escape`/click nền/nút Hủy → `emit('cancel')` nhưng **bị chặn khi `submitting`**; `try/catch/finally` để promise reject không thành unhandled rejection; a11y `role="dialog"`, `aria-modal`, `aria-labelledby`, **focus vào nút Hủy** khi mount; **không dùng `window.confirm`** | UI | `web/src/components/ConfirmModal.vue` | — | S19, S20, S23, S26; A23, A24 |
| T21 | `components/GroupFormModal.vue` (mới) — bọc `FormModal.vue` (không viết lại shell), props `mode: 'create' \| 'edit'`, `group: Group \| null`; field `name` (`data-testid="group-form-name"`, label "Tên group") + `description` (`<textarea rows="3">`, `data-testid="group-form-description"`, label "Mô tả (tùy chọn)", hint "Tối đa 500 ký tự") — **KHÔNG đặt `maxlength`** trên cả hai (xem Rủi ro); prefill từ `props.group` (không gọi API); client-validate **chỉ** `name.trim()` rỗng → `fieldErrors.name = ["Tên group không được để trống"]` (đúng câu chữ `Group::NAME_BLANK_MESSAGE`), không gọi API; submit: create → `POST` với `description` **bị bỏ khỏi body khi rỗng**, edit → `PATCH` **luôn gửi `description` kể cả `''`** (cách duy nhất xóa mô tả); `emit('saved', { mode, message })` với "Đã tạo group"/"Đã cập nhật group"; catch: `isNotFoundError` → `emit('missing')` (**bắt trước** nhánh 422/500), còn lại `extractFormErrors(error, 'Có lỗi xảy ra, vui lòng thử lại.')` — **không viết hàm map lỗi mới**; `clearFieldError` khi gõ | UI | `web/src/components/GroupFormModal.vue` | T14, T17 | S8, S10, S11, S12, S15, S16, S17, S18; A4, A5, A7, A9, A10, A12, A25 |
| T22 | `views/groups/GroupListView.vue` (mới) — `activeQuery` computed đọc `route.query` qua `firstQueryValue` (`page` rác → 1, `q` trim, rỗng → `undefined`), `watch(activeQuery, load, { immediate: true })`; `SearchInput` → `router.replace({ query: { q: value \|\| undefined } })` (**bỏ hẳn key `page`** = reset trang 1), `PaginationBar` → `replace` **giữ `q`**; `DataTable` cột `Name │ Description │ ⋯` (`test-id="groups-table"`, `row-test-id="group-row"`, **không truyền `onRowClick`**), slot `#cell-description` dùng `.cell-truncate` + `:title` + `?? '—'`; `ActionsMenu` đúng **2 item** "Sửa"/"Xóa" (`group-action-edit`/`group-action-delete`), không item disable; nút "+ Thêm Group" (`add-group-button`) **ẩn khi empty-state A14 đang hiện** (CTA của empty state dùng **cùng** testid); 2 biến thể empty state phân biệt bằng `q` của FE ("Chưa có group nào" + CTA tạo / "Không tìm thấy group nào" + "Xóa tìm kiếm" `empty-state-clear-search-button`), `showEmptyState = !loading && meta !== null && meta.total_count === 0`; `ErrorState` + "Thử lại" → `load()`; `GroupFormModal` (`@saved`: create → `router.replace({ query: { q } })` + toast + `load()`; edit → toast + `load()` giữ nguyên `q`+`page`; `@missing` → đóng + toast lỗi + `load()`); `ConfirmModal` mount bằng `v-if="confirmTarget"`, message **đúng nguyên văn** SoT OQ-4 (không có số N), `handleDeleteConfirm`: 204 → đóng + toast "Đã xóa group" + `load()`; 404 → đóng + toast lỗi "Group không tồn tại hoặc đã bị xóa" + `load()`; 500/network → **giữ modal mở** + toast "Không xóa được group, vui lòng thử lại." + **không refetch**; watcher `store.meta` tự lùi trang: `total_pages > 0 && page > total_pages` → về `total_pages`, **`total_count === 0 && page > 1` → về trang 1** (nhánh mới so với F2) | UI | `web/src/views/groups/GroupListView.vue` | T14, T15, T17, T18, T19, T20, T21 | S1–S3, S5–S10, S16, S19–S27, S37, S39; A12–A19, A23, A24 |
| T23 | `router/index.ts` — thêm `{ path: '/groups', name: 'groups', component: GroupListView }` (không `props: true`). **Không** thêm `/groups/:id` (OQ-5). Guard `beforeEach` sẵn có tự áp dụng → chưa đăng nhập vào `/groups` bị redirect `/login` (**không sửa guard**) | UI | `web/src/router/index.ts` | T22 | S36, S38; A21 |
| T24 | `components/AppShell.vue` — trả **cả hai nửa** món nợ F0: (a) `<span class="nav-item future">Groups</span>` → `<RouterLink to="/groups" class="nav-item" active-class="active" data-testid="nav-groups">`; (b) bỏ hard-code `class="nav-item active"` của Devices → `class="nav-item" active-class="active" data-testid="nav-devices"`; Policies **giữ nguyên** `<span class="nav-item future">` (chưa có route ⇒ không được là link); sửa `.sidebar-note` thành "Policies hiện khi F7 thêm route"; xóa comment nợ F0, thay bằng 1 dòng ngắn chỉ còn Policies chờ F7. **Không** import `useRoute`, không thêm `computed` | UI | `web/src/components/AppShell.vue` | — | S38 |
| T25 | Vitest `SearchInput.spec.ts` — gõ liên tiếp chỉ emit `change` **1 lần** sau 300ms (fake timers), giá trị đã trim; Enter flush ngay không chờ debounce; nút clear chỉ hiện khi có giá trị và emit `clear`; unmount giữa lúc chờ debounce **không** emit (timer đã `clearTimeout`); đổi `modelValue` từ ngoài đồng bộ vào input | Test | `web/src/components/__tests__/SearchInput.spec.ts` | T19 | S6, S7 |
| T26 | Vitest `ConfirmModal.spec.ts` — render title/message/labels, `destructive` → class `btn-danger`; click confirm gọi `onConfirm` 1 lần, **click 2 lần liên tiếp vẫn chỉ 1 lần** (S26/A24); trong lúc chạy: 2 nút disable + `data-busy`, `Escape`/click nền/Hủy **không** emit `cancel`; xong (resolve/reject) → nút enable lại, **component không tự đóng**; `onConfirm` reject → emit `error`, không throw ra ngoài; Hủy khi rảnh → emit `cancel`; focus mặc định ở nút Hủy | Test | `web/src/components/__tests__/ConfirmModal.spec.ts` | T20 | S19, S20, S23, S26; A23, A24 |
| T27 | Vitest `GroupFormModal.spec.ts` (khuôn `DeviceFormModal.spec.ts`) — create: submit `name` rỗng/chỉ khoảng trắng → hiện lỗi dưới field, **không gọi API** (S11/A4); `description` rỗng **không có trong body** POST (S10/A25); edit: prefill đúng, `description: ''` **vẫn được gửi** trong PATCH; 422 `name` trùng → message bám field `name`, **modal không đóng, dữ liệu giữ nguyên** (S12/A5/A7); 422 `length` tiếng Anh vẫn render nguyên văn (S15/A10); 404 khi edit → emit `missing` chứ không hiện banner "Not found" (A12); 500 → banner đỏ đầu form, modal không đóng; thành công → emit `saved` đúng `mode`+`message` | Test | `web/src/components/__tests__/GroupFormModal.spec.ts` | T21 | S8, S10–S12, S15–S18; A4, A5, A7, A9, A10, A12, A25 |
| T28 | Vitest `GroupListView.spec.ts` (khuôn `DeviceListView.spec.ts`) — mount đọc `?q=&page=` fetch đúng tham số; đổi `q` → `router.replace` **bỏ key `page`**, đổi page → **giữ `q`**; 2 biến thể empty state theo `q` + nút "+ Thêm Group" bị ẩn ở biến thể A14 (S5/S7); menu ⋯ đúng 2 item, không có "Xem chi tiết" (S39); ô mô tả `null` render `—`, **không bao giờ ra chữ "null"** (S10/A25); tạo xong → về trang 1 giữ `q` + toast + refetch (S8/S9); xóa: mở ConfirmModal (chưa request nào — S19), Hủy → không request (S20), 204 → toast "Đã xóa group" + refetch (S21), 404 → đóng + toast lỗi + refetch (S25/A12), 500 → **modal vẫn mở**, toast lỗi, **không refetch**, dòng còn nguyên (S24/A13); watcher lùi trang: `total_count === 0 && page > 1` → về trang 1 (S27); store `error` → `ErrorState` + "Thử lại" gọi lại `load()` (S37/A19) | Test | `web/src/views/groups/__tests__/GroupListView.spec.ts` | T22, T23 | S1–S3, S5–S10, S19–S21, S24, S25, S27, S37, S39 |
| T29 | Vitest `stores/__tests__/groups.spec.ts` — `fetchGroups` set `loading`/ghi `groups`+`meta`/xóa `error`; lỗi → `error` có message fallback và **`groups`/`meta` cũ không bị xóa**; guard `lastRequestId`: response của request cũ về sau **không đè** kết quả mới; `createGroup`/`updateGroup`/`deleteGroup` **throw** lỗi lên caller và **không** đụng `loading`/`error`/`groups` | Test | `web/src/stores/__tests__/groups.spec.ts` | T17 | A19; nền cho S24, S25, S37 |
| T30 | **Regression gate FE cho T13/T15/T24**: chạy lại toàn bộ `vitest` (đặc biệt `DeviceListView.spec.ts`, `DeviceDetailView.spec.ts`, `FormModal.spec.ts`, `DeviceFormModal.spec.ts`, `ActionsMenu.spec.ts`) + `eslint` + `vue-tsc` — **không sửa spec cũ**; đặc biệt xác nhận highlight "Devices" **vẫn sáng ở `/devices/:id`** sau khi đổi sang `active-class` (nếu hỏng ⇒ sửa T24, không sửa test) | Test | `web/src/**/__tests__/*` (chỉ chạy, không sửa) | T13, T15, T24 | Bảo toàn acceptance F2/F3/F4 + S38 |

Quy tắc chia task giữ nguyên theo `docs/plan/F3-*.md` / `F4-*.md`: Data trước API
cần nó; API trước UI gọi nó; mỗi test (RSpec/Vitest) là task riêng, phụ thuộc
đúng task code nó kiểm tra. **Không** có task riêng cho `types/group.ts`
(T14) / `api/groups.ts` (T16) ở dạng unit test — chúng là khai báo type + 4
wrapper axios một dòng, được cover gián tiếp qua T27/T28/T29 (cùng lý do F4 đã
áp dụng cho `lastListLocation`). **Không** có task nào cho
`features/f5-group-crud.feature` (golden rule #3 tạm ngưng) và không có bước
Playwright.

## Sơ đồ wave

```text
Wave 1 (song song): T1, T4, T13, T15, T18, T20, T24
        │
        ▼
Wave 2 (song song): T2, T5, T6, T12, T14, T19, T26, T30
        │
        ▼
Wave 3 (song song): T3, T7, T10, T16, T25
        │
        ▼
Wave 4 (song song): T8, T9, T17
        │
        ▼
Wave 5 (song song): T11, T21, T29
        │
        ▼
Wave 6 (song song): T22, T27
        │
        ▼
Wave 7: T23
        │
        ▼
Wave 8: T28
```

Ghi chú: BE (T1–T12) và FE (T13–T30) độc lập hoàn toàn về file — có thể chạy 2
nhánh song song từ Wave 1; đường găng là nhánh FE
(T18 → T19/T20 → T21 → T22 → T23 → T28).

## Rủi ro / open question

- **Bẫy #1 — `#destroy` vs `#delete` (rủi ro nặng nhất của F5).** T7 **bắt buộc**
  `group.destroy!`. Nếu viết `group.delete`/`delete_all`, **mọi test của F5 vẫn
  xanh** (chưa có bảng join) nhưng invariant nặng nhất của đề bài (`CLAUDE.md`
  §4 — "xóa Group không để dữ liệu treo") sẽ vỡ **âm thầm** ở F6/F8, và bug
  được introduce từ F5. Yêu cầu: comment giải thích ngay tại action `destroy`;
  `destroy!` (bang) chứ không `destroy` trần (hôm nay không bao giờ raise; mai
  nếu F6/F8 thêm guard chặn xóa thì nó **raise → 500 ồn ào** thay vì nói dối
  204); **không** bọc `ActiveRecord::Base.transaction` thủ công (`destroy` đã
  tự bọc); **không** thêm `rescue_from RecordNotDestroyed`.
- **Bẫy #2 — `maxlength` trên input.** T21 **tuyệt đối không** đặt
  `maxlength="100"`/`maxlength="500"`. Nghe "chỉnh chu" hơn nhưng nó làm S15
  (A10) **không thể kiểm chứng qua UI**: trình duyệt tự cắt chuỗi, request trở
  nên hợp lệ và test xanh giả. Giới hạn độ dài là hợp đồng của server (422
  field-level); FE chỉ chặn `name` rỗng.
- **Bẫy #3 — quên `sanitize_sql_like`/placeholder ở `q`.** Quên escape ⇒ user
  gõ `%`/`_` biến thành wildcard (search `"100%"` ra toàn bộ danh sách — bug
  hành vi); nội suy chuỗi vào SQL thay vì `?` ⇒ **SQL injection thật**. Không
  scenario nào ở SoT §11 bắt được 2 lỗi này ⇒ T11 **bắt buộc** có case `q =
  "100%"`, `q = "_"`, `q = "' OR 1=1 --"`. Gọi `Group.sanitize_sql_like` (class
  method trên model) — viết trần trong controller sẽ `NoMethodError` → 500.
- **Chạm code của feature đã Done (3 điểm, đều là refactor thuần):** T4
  (`DevicesController` → `Paginatable`), T13 (`types/device.ts` →
  `DeviceListMeta` alias), T15 (`DeviceListView.vue` → import
  `firstQueryValue`), cộng T24 (`AppShell.vue`). T5 và T30 là 2 gate regression
  bắt buộc. Nguyên tắc: nếu spec cũ đỏ ⇒ **sửa code refactor, không sửa spec**.
- **Hồi quy tiềm ẩn ở T24**: nếu ai đó "tường minh hoá" bằng
  `route.path === '/devices'` thay vì `active-class`, trang chi tiết Device
  (`/devices/:id`) sẽ **mất highlight** — hồi quy của F4 do F5 gây ra. Đã chốt
  OQ-FE-3 dùng `active-class="active"`; nếu bắt buộc phải so `route.path` thì
  **phải** dùng `startsWith`.
- **Nghĩa vụ carry-over bắt buộc cho F6/F8** (từ `F5-db.md` §4a, nhắc lại để
  không trôi): F6 thêm `has_many :group_memberships, dependent: :delete_all`,
  F8 thêm `has_many :policy_assignments, dependent: :delete_all` vào `Group`;
  FK trỏ tới `groups(id)` **không** được `on_delete: :cascade`; index có
  `group_id` leftmost; mỗi feature tự viết test "xóa group → không còn join row
  mồ côi, device/policy vẫn tồn tại". Action `destroy` của T7 **không cần sửa
  một dòng nào** khi 2 association đó xuất hiện. Phải ghi vào `DESIGN.md` với
  ghi chú "hợp đồng chốt từ F5".
- **Phải ghi vào `DESIGN.md` khi implement xong** (đã chốt ở 3 design, không
  phải quyết định mới): (1) sai khác có chủ đích với `UI_UX_design.md` §6.1 —
  không có cột "Số device", không có action/route "Xem chi tiết", câu confirm
  không có số N (OQ-4/OQ-5, F6 phải khôi phục đủ); (2) `ILIKE '%...%'` không
  dùng được index — rủi ro production đã biết, đường đi sẵn là `pg_trgm` + GIN,
  **không làm ở F5**; (3) unique **case-sensitive** + search
  **case-insensitive** ⇒ `"Sales Team"` và `"sales team"` cùng tồn tại được
  trong 1 org và search `"sales"` trả **cả hai** — không phải bug; (4) message
  lỗi trộn 2 ngôn ngữ trong cùng form (`presence` tiếng Việt, `length` tiếng
  Anh mặc định Rails — OQ-API-2 approve giữ nguyên), FE **không** tự dịch;
  (5) mục "3. AI".
- **Ô mô tả trống render `—` (em dash), không phải chuỗi rỗng** —
  `emptyValue` mặc định của `DataTable`, nhất quán Devices list. S10 diễn đạt
  "ô mô tả hiển thị trống"; assertion đúng là **"không hiển thị chữ `null`"**
  (T28), không assert chuỗi rỗng tuyệt đối.
- **A14 và A15 trả response giống hệt nhau** (API cố ý không có cờ `searched`)
  — FE phân biệt bằng state `q` của chính nó. Nếu implementer thấy "thiếu dữ
  liệu từ server", đó là dấu hiệu đã đi sai hướng: **không tự thêm field vào
  contract**, phải dừng và báo cáo.
- **Không có nhánh 403 nào trong toàn bộ F5** — mọi vi phạm ranh giới org đều
  là 404. Nếu đang viết `status: :forbidden` ⇒ sai hướng.
- **Không mở rộng scope**: đúng 4 endpoint, đúng 1 route `/groups`, không
  `GET /groups/:id`, không `devices_count`, không bảng join, không soft-delete,
  không job/async (F5 chỉ thao tác tối đa 1 row).
- **Open question còn treo (không chặn implement)**: `F5-db.md` §4b nêu 2 điểm
  "cần người duyệt xác nhận" — `description` dùng `text` hay `string`, và việc
  không đặt `limit:`/check constraint ở tầng DB. File đã `status: approved` ⇒
  plan này đi theo khuyến nghị trong đó (`text`, giới hạn enforce ở model). Nếu
  người duyệt muốn khác, đó là sửa 1 dòng migration ở T1 **trước khi chạy
  `db:migrate`**, không ảnh hưởng task nào khác.
