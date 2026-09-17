# Plan — F7 Policy CRUD (list/create/edit, status)

## Readiness
- SoT: `docs/sot/F7-policy-crud.md` — **approved** (2026-09-17, lai.bui.vtp@gmail.com).
  §11 has **31 scenarios** (numbered S1–S31 below in the order they appear),
  all 10 Open Questions (§12) closed "theo khuyến nghị" — plan follows those
  decisions verbatim, does **not** reopen any of them.
- Design DB/API/Frontend: `docs/design/F7-db.md`, `docs/design/F7-api.md`,
  `docs/design/F7-frontend.md` (+ `F7-frontend-preview.html`) — **all 3
  approved** (2026-09-17). Corrections made during review that the plan
  explicitly carries forward (see "Risks/open questions" below, all tagged
  `[SỬA khi review]`/`OQ-API-1`/`OQ-FE-*` in the source docs):
  - `F7-db.md` §1 **STI fix**: `Policy` must set
    `self.inheritance_column = "_type_disabled"` as literally the first line
    of the class body, before any other declaration — without it, every
    query that loads a Policy with a non-empty `type` raises
    `ActiveRecord::SubclassNotFound` (the original draft wrongly assessed
    this as harmless; the fix was verified before approval).
  - `F7-api.md` §2.4 / OQ-API-1: `configuration` strong params use
    `to_unsafe_h` on exactly one field (`configuration_param`), **not**
    `permit(configuration: {})` — the latter silently drops the key when the
    client sends a non-Hash value, turning A12/A13 into a silent `200`
    instead of `422` on `PATCH`.
  - `F7-api.md` §2.5 **route-miss 404**: there is no `GET
    /api/v1/policies/:id` route (OQ-7). The 3 SoT scenarios that call it
    (org-mismatch, non-existent id, malformed id) hit
    `ActionController::RoutingError` before any controller/rescue_from runs
    — request specs for these 3 must assert **status only**
    (`have_http_status(:not_found)`), never `response.parsed_body` shape
    (body differs between test/dev — leaks exception class/backtrace — and
    production, and is not the app's `{"error": "Not found"}` envelope).
  - `F7-api.md` §2.1/§2.2/§2.3/§2.6: `status` enum guard (`invalid_status?`)
    must run **before** `.build`/`.where`/`.update` in all three actions —
    assigning/filtering a string outside `Policy.statuses.keys` raises
    `ArgumentError` (500), not a validation error, if not pre-checked.
  - `F7-frontend.md` §0.1/OQ-3: `type` is a free-form string column with a
    **combobox** (`<input list>` + `<datalist>`, suggestions = distinct
    `type` from `store.policies` already loaded, no extra endpoint) — not a
    `<select>` with a hardcoded domain enum.
- Dependency (`docs/backlog.md`): F7 depends only on **F0 — confirmed done**:
  - `api/db/schema.rb` has `organizations`, `users` (+ `devices`, `groups`,
    `group_memberships` from F2/F3/F5/F6, all marked Done in backlog).
  - `api/app/models/organization.rb`, `api/app/models/user.rb` exist.
  - `api/app/controllers/application_controller.rb` has
    `include Pundit::Authorization`, `rescue_from ActiveRecord::RecordNotFound
    → render_not_found` (`{"error":"Not found"}`), `render_validation_errors`
    (`{"errors":{...}}`) — exactly the envelope F7 reuses.
  - `api/app/controllers/concerns/authenticatable.rb` and
    `.../paginatable.rb` exist and are already reused by
    `devices_controller.rb`/`groups_controller.rb`.
  - `web/src/` has `router/index.ts` with an auth guard, `stores/auth.ts`,
    `components/AppShell.vue` (with the F7-flagged placeholder nav item and
    `.sidebar-note`), `components/FormModal.vue`, `ActionsMenu.vue`,
    `DataTable.vue`, `SearchInput.vue`, `FilterBar.vue`, `EmptyState.vue`,
    `ErrorState.vue`, `ToastContainer.vue`, `StatusBadge.vue`, `PaginationBar.vue`.
  - F7 does **not** depend on F2–F6 for business logic (independent resource
    at the DB layer) but reuses their conventions/components verbatim, per
    SoT §1. **No blocking dependency** — ready to implement.
- Cross-check SoT ↔ 3 designs: no contradictions found. The 3 deliberate
  deviations from `UI_UX_design.md` (§7.1 "Số nơi đang gán" column, §7.2
  Policy Detail page, deactivate-warning) are pre-resolved by SoT OQ-6/OQ-7/
  OQ-9 as F8 carry-over obligations, not new conflicts. → **Ready to build.**

## Quy trình áp dụng cho plan này (CLAUDE.md §3/§4)
- Golden rule #3 (viết `.feature` trước) is **currently suspended** →
  **no task** for `features/f7-policy-crud.feature` / Playwright step
  definitions in this plan.
- Gate #4 (Playwright) suspended → Done for F7 is measured by the **3
  mandatory gates**: `rubocop`, `rspec`, `eslint + vitest` — all green before
  any task/wave is marked Done, not a separate task, an implicit requirement
  of every code task below.
- CLAUDE.md §4: **every task touching the `Policy` resource must carry a
  dedicated cross-org isolation test** (org A cannot read/edit org B's
  Policy, expect **404, never 403**) — this is folded into T7 (request
  specs), not a separate task; T7 explicitly must not skip it.
- TDD (rule #4) applies to pure logic: `Policy` model validations/STI-guard
  (T3, written before/alongside T1) and the frontend JSON-parse/combobox
  pure functions (T18, alongside T14).

### Bảng tra scenario (SoT §11 → ký hiệu dùng trong plan)
| # | Scenario | # | Scenario |
|---|---|---|---|
| S1 | Xem danh sách Policy của org mình | S17 | Chuyển inactive→active thành công |
| S2 | GET org khác → 404 (route-miss) | S18 | Tạo không truyền status → mặc định active |
| S3 | PATCH org khác → 404 | S19 | Tạo với status ngoài enum → 422 |
| S4 | id không tồn tại → 404 (route-miss GET) | S20 | Danh sách rỗng vì org chưa có policy |
| S5 | id sai định dạng → 404, không 500 | S21 | Danh sách rỗng vì search không khớp |
| S6 | Tạo name rỗng → 422 | S22 | Lọc danh sách theo status |
| S7 | Tạo trùng tên cùng org → 422 | S23 | page vượt quá → 200 rỗng |
| S8 | Tạo trùng tên org khác → 201 | S24 | page/per_page không hợp lệ → 422 |
| S9 | Race condition trùng tên → 1×201 + 1×422 | S25 | per_page > 100 → clamp im lặng |
| S10 | Sửa giữ nguyên tên cũ → 200 | S26 | status filter không hợp lệ → 422 |
| S11 | name/type vượt độ dài → 422 | S27 | Lỗi hạ tầng list → ErrorState |
| S12 | Tạo type rỗng → 422 | S28 | Không token → 401 |
| S13 | Thiếu configuration → 422 | S29 | Chưa đăng nhập → redirect /login |
| S14 | configuration không phải JSON object → 422 | S30 | Menu ⋯ không có Xóa/Xem chi tiết |
| S15 | Sửa type đã tồn tại → 200 | S31 | List không hiện cột "Số nơi đang gán" |
| S16 | active→inactive không cảnh báo | | |

## Task breakdown

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | Migration `CreatePolicies` + model `Policy` + `Organization has_many :policies`. Migration exactly per `F7-db.md` §2: `t.references :organization, null: false, foreign_key: true, index: false`, `t.string :name, null: false`, `t.string :type, null: false`, `t.jsonb :configuration, null: false`, `t.integer :status, null: false, default: 0`, `t.timestamps`; `add_index [:organization_id,:name], unique: true`, `add_index [:organization_id,:created_at,:id]`, `add_index [:organization_id,:status]`. Model **must** open with `self.inheritance_column = "_type_disabled"` (STI fix, §1 `[SỬA khi review]`), then `belongs_to :organization`, constants `NAME_TAKEN_MESSAGE`/`NAME_BLANK_MESSAGE`/`TYPE_BLANK_MESSAGE`/`CONFIGURATION_INVALID_MESSAGE`, `enum :status, { active: 0, inactive: 1 }`, `before_validation :normalize_name_and_type` (trim, `is_a?(String)` guard), `validates :name` (presence+length 100+uniqueness scope `:organization_id` case-sensitive), `validates :type` (presence+length 100), custom `configuration_must_be_a_json_object` (`configuration.is_a?(Hash)`). **Do not** declare `has_many :policy_assignments`/`through:` associations (table doesn't exist — `NameError` on boot; F8 carry-over) | Data | `api/db/migrate/<ts>_create_policies.rb`, `api/app/models/policy.rb`, `api/app/models/organization.rb`, `api/db/schema.rb` | — | Nền cho S1–S19; A4–A18 |
| T2 | FactoryBot `factory :policies` — `association :organization`, `sequence(:name) { |n| "Policy #{n}" }` (avoid unique index collisions), `type { "password" }` default with a way to override, `configuration { { key: "value" } }` (valid Hash default), trait `:inactive` | Test | `api/spec/factories/policies.rb` | T1 | — (infra for T3, T7) |
| T3 | RSpec model spec `Policy` (TDD — written alongside/before T1 is finalized): trim `name`/`type`; blank/whitespace-only → invalid on correct field (S6/S12); length boundary 100/101 chars on both `name` and `type` (S11); uniqueness scoped to `organization_id`, case-sensitive, and explicitly **allowed across two different orgs** (S7/S8); `configuration` — `nil`, `[]`, `5`, `"string"` all invalid on field `configuration`, `{}` and populated Hash valid (S13/S14); enum `status` accepts `active`/`inactive`, **and assigning a string outside the enum map raises `ArgumentError`** (regression-documenting test — this is exactly what the controller layer (T6) must guard against, so the spec proves the raw model behavior the guard exists for); **dedicated STI regression test** per `F7-db.md` §1 `[SỬA khi review]`: create ≥1 Policy with a realistic `type` value (e.g. `"wifi"`, `"password_baseline"`) and assert `Policy.find`/`organization.policies.all`/`.reload` do **not** raise `ActiveRecord::SubclassNotFound` (this is the test that would have caught the original bad draft) | Test | `api/spec/models/policy_spec.rb` | T1, T2 | S6, S7, S8, S9(model half), S10, S11, S12, S13, S14, S15, S18, S19; STI regression |
| T4 | Route (`resources :policies, only: [:index, :create, :update]` — **no** `:show`/`:destroy`) + `PolicyPolicy` (Pundit, mirrors `F7-api.md` §1 code exactly): `index?`/`create?`/`update?` → `true`, **no** `show?`/`destroy?` declared (dead code otherwise, `ApplicationPolicy` default-deny still protects any future accidental route), `Scope#resolve` = `user.organization.policies` | API/Policy | `api/config/routes.rb`, `api/app/policies/policy_policy.rb` | T1 | Nền cho S1–S3, S28, S30; SoT §9 |
| T5 | RSpec `PolicyPolicy` spec — 3 predicates all `true`; `show?`/`destroy?` remain `false` (deny-by-default untouched); `Scope#resolve` returns only the current org's policies, never another org's | Test | `api/spec/policies/policy_policy_spec.rb` | T2, T4 | S2, S3 (scope half); SoT §9 |
| T6 | `Api::V1::PoliciesController` (`index`/`create`/`update` only) — `include Authenticatable`, `include Paginatable`; local `STATUS_ENUM_ERROR` + `invalid_status?` (per `F7-api.md` §2.6 — **not** shared with `DeviceFilterable`, deliberate duplication documented in code comment) run **before** `.where`/`.build`/`.update` in all 3 actions (guards A18/A24, prevents `ArgumentError`→500); **index**: pagination_errors → status filter validation → `authorize Policy` → `policy_scope(Policy)` → `q` via `ILIKE` + `sanitize_sql_like` → `status` filter → `order(created_at: :desc, id: :desc)` → count-before-limit → serialize; **create**: `authorize Policy` → validate `status` → `current_organization.policies.build(create_params)` → save/render; **update**: `policy_scope(Policy).find(params[:id])` (404 on org-mismatch/missing/malformed id) → `authorize policy` → validate `status` → `policy.update(update_params)`; **strong params exactly per `F7-api.md` §2.4/§2.7**: `build_policy_params` permits `:name,:type,:status` normally, handles `:configuration` via `configuration_param` (`to_unsafe_h` when `ActionController::Parameters`, raw otherwise) **only when `params.key?(:configuration)`** — this is the single most error-prone part of F7, must follow the doc's table of 6 request-shape cases verbatim; `rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken` **local to this controller** (not `ApplicationController`), reusing `Policy::NAME_TAKEN_MESSAGE`, covering both `create` and `update`; `serialize_policy` — exactly 7 fields (`id,name,type,configuration,status,created_at,updated_at`), no `organization_id`, no `assignments_count` | API | `api/app/controllers/api/v1/policies_controller.rb` | T1, T4 | S1–S3, S6–S19, S20–S26, S30, S31; A1–A29 |
| T7 | RSpec request spec `api/spec/requests/api/v1/policies_spec.rb` (mirrors `devices_spec.rb`/`groups_spec.rb` structure) covering **every** SoT §11 scenario: **index** — org isolation (S1, dedicated CLAUDE.md §4 test expecting 404 not 403 on the GET-by-id variant, S2/S4/S5 route-miss asserting **status only**, never response body shape, per `F7-api.md` §2.5), pagination (S23–S25), `q` search case-insensitive + `sanitize_sql_like` safety (no `%`/`_`/SQL-injection leakage), `status` filter (S22, S26 invalid→422), empty org (S20), empty search (S21); **create** — name/type blank (S6/S12), length >100 (S11), duplicate name same org →422 (S7), duplicate name different org →201 (S8), **race condition test simulating concurrent inserts hitting the unique index →1×201+1×422** (S9 — via stubbed/forced `RecordNotUnique` or literal concurrent threads/transactions), missing/null configuration (S13), non-object configuration: array/number/string (S14), status omitted→default active (S18), status outside enum→422 (S19), `organization_id` sent by client is ignored (A28); **update** — org-mismatch→404 (S3), no-op name keeps 200 (S10), type change allowed (S15), status toggle both directions (S16/S17), duplicate name on rename→422 (A9), same race-condition rescue path exercised via update; **auth** — no token/expired→401 (S28) on all 3 actions. Do **not** assert `response.parsed_body` for the route-miss GET-by-id cases | Test | `api/spec/requests/api/v1/policies_spec.rb` | T2, T3, T6 | S1–S26, S28; full A1–A29; CLAUDE.md §4 isolation test |
| T8 | `api/db/seeds.rb` — add a handful of Policy records per Organization with varied `type`/`status` (idempotent `Policy.find_or_create_by!(organization:, name:)` then set other attrs in block), enough for manual QA of search/filter to have visible effect. Not for pagination-scale data (that's FactoryBot's job in specs) | Data | `api/db/seeds.rb` | T1 | Manual QA readiness (not an §11 scenario) |
| T9 | `web/src/types/policy.ts` (new) — `POLICY_STATUSES`/`PolicyStatus`, `Policy` interface (7 fields, `configuration: Record<string, unknown>`, **no** `organization_id`/`assignments_count`), `PolicyListResponse`, `PolicyResponse`, `PolicyQueryParams` (`q?`, `status?`, `page`), `PolicyCreatePayload` (4 required fields), `PolicyUpdatePayload` (4 optional fields — used by both the form and the toggle-status caller), `isPolicyStatus` type guard — exactly per `F7-frontend.md` §3.1, no invented fields | Frontend types | `web/src/types/policy.ts` | — | Hợp đồng cho T10–T15 |
| T10 | `web/src/api/policies.ts` (new) — exactly 3 functions: `fetchPolicyList(params)`, `createPolicy(payload)`, `updatePolicy(id, payload)`, all through the existing `apiClient`. **No** `fetchPolicy(id)` (no `show` route) | Frontend API client | `web/src/api/policies.ts` | T9 | S1, S6–S19 (transport) |
| T11 | `web/src/stores/policies.ts` (new, mirrors `stores/groups.ts` minus delete) — state `{ policies, meta: PaginationMeta \| null, loading, error, lastRequestId }`; `fetchPolicies(params)` owns `loading`/`error`, `lastRequestId` guard against out-of-order responses (search debounce + filter change race), **keeps stale `policies`/`meta` on fetch error** (no blanking the table); `createPolicy`/`updatePolicy` do **not** touch store `loading`/`error` — they `throw` the raw error so callers (`PolicyFormModal` for 422, `toggleStatus` for toast) map it themselves. One `updatePolicy` action used by both the form (sends all 4 fields) and `toggleStatus` (sends only `status`) | Frontend store | `web/src/stores/policies.ts` | T9, T10 | S1, S6–S19, S27 |
| T12 | `FormModal.vue` — add backward-compatible `wide?: boolean` prop (default `false`), apply `modal-wide` class conditionally; add `.modal.modal-wide { max-width: 480px; }` to `components.css` without touching `.modal`'s base rule. `GroupFormModal`/`DeviceFormModal` remain byte-identical in behavior (prop defaults to `false` → no class added) | Frontend shared component | `web/src/components/FormModal.vue`, `web/src/styles/components.css` | — | Nền cho T14 (JSON editor cần chiều rộng lớn hơn) |
| T13 | **Regression gate for T12**: run existing `FormModal.spec.ts`, `GroupFormModal.spec.ts`, `DeviceFormModal.spec.ts` unchanged — must stay green; add one new assertion to `FormModal.spec.ts` for the `wide` prop (`modal-wide` class present when `wide=true`, absent by default) | Test | `web/src/components/__tests__/FormModal.spec.ts` (only file touched) | T12 | Bảo toàn hành vi F3/F5/F6 FormModal callers |
| T14 | `PolicyFormModal.vue` (new) — wraps `FormModal :wide="true"`; **combobox `type`** exactly per `F7-frontend.md` §2.1 (`<input list="policy-type-suggestions">` + `<datalist>`, `typeSuggestions` computed = distinct sorted `type` from `policiesStore.policies`, `autocomplete="off"`); **JSON editor `configuration`** exactly per §2.2 (single `parseConfiguration()` pure function reused by blur/Format/submit — rejects empty string, syntax errors, non-object JSON (array/number/string), accepts `{}`; `onConfigurationBlur` sets error but never auto-rewrites the textarea; `onFormat` pretty-prints via `JSON.stringify(value, null, 2)` only on valid parse; client-side validation blocks submit on JSON syntax error even if blur never fired); `status` `<select>` shown in **both** create and edit modes, default `active` on create; submit — `create` → `POST` with all 4 fields; `edit` → `PATCH` always sending **all 4 fields** (not partial); `422` → `extractFormErrors` maps to `name`/`type`/`configuration`/`status` field errors, modal stays open, raw JSON text preserved; `500`/network → base error banner. New CSS: `.json-editor`, `.field-label-row`, `.btn-sm` | Frontend component | `web/src/components/PolicyFormModal.vue`, `web/src/styles/components.css` | T9, T11, T12 | S6, S7, S10–S19 |
| T15 | `PolicyListView.vue` (new) — `activeQuery` computed from `route.query` via `firstQueryValue` (reused util from F5), `watch(activeQuery, load, { immediate: true })`; `SearchInput`/`FilterBar` changes drop `page` from query (reset to page 1); `DataTable` columns **Name │ Type │ Status │ ⋯** only, **no `onRowClick`** (no detail page — OQ-7), `#cell-status` slot uses `StatusBadge`; `ActionsMenu` per row has **exactly 2 items** — "Sửa" (opens `PolicyFormModal` prefilled from the row already in the store, no API call) and toggle-status (label swaps "Kích hoạt"/"Vô hiệu hoá" per `row.status`, calls `store.updatePolicy(id, {status: nextStatus})` directly with **no modal**, single-flight per row via `togglingIds` array, **not** optimistic — table only updates after refetch succeeds); **no** "Xóa"/"Xem chi tiết" items (S30); **no** "Số nơi đang gán" column (S31); empty states — A19 org-empty (`EmptyState` "Chưa có policy nào" + CTA `add-policy-button`) vs A20 search/filter-empty ("Không tìm thấy policy nào" + "Xóa bộ lọc" clearing both `q` and `status`), distinguished purely by FE query state (`hasActiveQuery`), never by an API flag; `ErrorState` + "Thử lại" on list-load failure; on create-success → reset to page 1 keeping `q`/`status`; on edit-success/toggle-success → refetch same page/`q`/`status` | Frontend view | `web/src/views/policies/PolicyListView.vue` | T11, T14 | S1, S6–S27, S30, S31 |
| T16 | `router/index.ts` — add `{ path: '/policies', name: 'policies', component: PolicyListView }` (no `/policies/:id` — OQ-7). **Do not** modify `router.beforeEach` — the existing generic guard already redirects unauthenticated visits to `/login` (S29) | Frontend router | `web/src/router/index.ts` | T15 | S29 (via existing guard, no new guard code) |
| T17 | `AppShell.vue` — replace `<span class="nav-item future">Policies</span>` with `<RouterLink to="/policies" class="nav-item" :class="{active: isSectionActive('/policies')}" data-testid="nav-policies">` and remove the `.sidebar-note` div entirely (last piece of F0/F5-flagged tech debt, per `F7-frontend.md` §2.5 — do not touch `isSectionActive`, code already matches this pattern for `/groups`) | Frontend nav | `web/src/components/AppShell.vue` | T16 | S1 (nav entry point); SoT UI acceptance |
| T18 | Vitest `PolicyFormModal.spec.ts` — pure-logic focus (TDD, written alongside T14): `parseConfiguration` for valid object/`{}`/invalid syntax/array/number/string/empty-string, `onFormat` rewrites textarea only on valid parse and leaves it untouched on error, blur does not auto-format, submit blocked when configuration has a pending error even without a prior blur; `typeSuggestions` computed correctly derives distinct/sorted values from a mocked store and updates reactively; 422 field errors render under `name`/`type`/`configuration`/`status` and preserve raw JSON text on error; create payload sends 4 fields, edit `PATCH` always sends all 4 (never partial) | Test | `web/src/components/__tests__/PolicyFormModal.spec.ts` | T14 | S6, S7, S10–S19 (client-side half) |
| T19 | Vitest `stores/policies.spec.ts` — `fetchPolicies` success path sets `policies`/`meta`; error path keeps prior `policies`/`meta` (no blanking); `lastRequestId` guard drops a stale in-flight response that resolves after a newer one; `createPolicy`/`updatePolicy` do not mutate store `loading`/`error` and rethrow the original error object | Test | `web/src/stores/__tests__/policies.spec.ts` | T11 | S27 (store half) |
| T20 | Vitest `PolicyListView.spec.ts` — route-query sync (`?q=&status=&page=`) drives `fetchPolicies` args on mount and on query change; empty-state A19 vs A20 render the correct title/CTA based on FE query state, not a fake API flag; `ActionsMenu` items list is exactly `["Sửa", toggle-label]`, asserting absence of "Xóa"/"Xem chi tiết" (S30) and absence of an "assignments" column header (S31); toggle-status flow — label reflects current status, calls `store.updatePolicy` with the opposite status, disables the row's "Sửa" + toggle items while in flight (single-flight), shows the correct toast on success/failure, does **not** optimistically mutate the row before refetch; `ErrorState`/"Thử lại" triggers reload | Test | `web/src/views/policies/__tests__/PolicyListView.spec.ts` | T15 | S20–S22, S27, S30, S31 |

**Rubocop/ESLint/Prettier**: implicit acceptance criterion of every code task
above (T1, T4, T6, T9–T17) — not a separate row; each task's Done includes a
clean `rubocop`/`eslint`+`prettier` run on its own files.

## Sơ đồ wave

```text
Wave 1 (song song): T1, T9, T12
        │
        ▼
Wave 2 (song song): T2, T4, T8, T10, T13
        │
        ▼
Wave 3 (song song): T3, T5, T6, T11
        │
        ▼
Wave 4 (song song): T7, T14
        │
        ▼
Wave 5 (song song): T15, T18, T19
        │
        ▼
Wave 6 (song song): T16, T20
        │
        ▼
Wave 7: T17
```

- Wave 1: DB migration/model, frontend type contract, and the isolated
  `FormModal.wide` change can start immediately — none depend on each other.
- Wave 2: everything that needs exactly one Wave-1 artifact (factory needs
  the model; route+policy need the model; seeds need the model; api client
  needs types; the FormModal regression gate needs the prop to exist).
- Wave 3: model spec needs model+factory; PolicyPolicy spec needs
  policy+factory; the controller needs model+route+policy; the store needs
  types+api client.
- Wave 4: request specs need factory+model spec (to trust model behavior)
  +controller; `PolicyFormModal.vue` needs types+store+the `wide` prop.
- Wave 5: the list view needs store+form modal; the two Vitest suites for
  the form modal and the store can run once their subjects exist.
- Wave 6: router entry needs the view to exist; the list-view Vitest suite
  needs the view.
- Wave 7: `AppShell` nav enablement is the very last step — SoT/CLAUDE.md
  frame this as "F7 pays off the F0/F5 nav debt", logically the final wiring
  step once the route it points to is real and tested.

## Rủi ro / open question cần giải quyết trước khi build

Cả 10 SoT OQ và mọi OQ-API/OQ-FE trong design docs đã chốt — **không có open
question nào còn treo**. Những điểm dưới đây không phải câu hỏi mới, mà là
**nhắc lại các pattern đã sửa/chốt trong lúc review**, để implementer không
lặng lẽ quay về phương án ngây thơ ban đầu:

1. **STI fix là bắt buộc, không tùy chọn** (`F7-db.md` §1, `[SỬA khi review,
   2026-09-17]`): `self.inheritance_column = "_type_disabled"` phải là dòng
   đầu tiên trong `class Policy`. Bản nháp đầu tiên của thiết kế DB đánh giá
   sai mức độ nghiêm trọng (nghĩ chỉ kích hoạt STI khi có class con thật) —
   thực tế Rails kích hoạt dựa trên **sự tồn tại của cột `type`**, không
   phụ thuộc có class con hay không, nên thiếu dòng này sẽ crash **mọi**
   query khi có ≥1 policy có `type` khác rỗng. T1 và T3 (regression test)
   phải cùng khóa chặt điểm này.
2. **`to_unsafe_h` cho đúng 1 field `configuration`, không mở rộng** (`F7-
   api.md` §2.4, OQ-API-1 — quyết định (a) đã chốt): T6 phải implement đúng
   `build_policy_params`/`configuration_param` như trong tài liệu, phân biệt
   tường minh 3 trạng thái (key vắng mặt / có mặt sai kiểu / có mặt hợp lệ).
   Copy công thức `permit` scalar đơn giản của F5/F6 cho field này sẽ tạo
   bug im lặng ở nhánh `PATCH` (A12/A13 trả `200` thay vì `422`) — T7 phải
   có test riêng cho từng dòng trong bảng 6-case của `F7-api.md` §2.4.
3. **404 cho `GET /:id` đi qua routing, không qua controller** (`F7-api.md`
   §2.5, verified bằng `rails runner` thật, không suy đoán): T7's test cho
   S2/S4/S5 (biến thể GET) chỉ được assert `have_http_status(:not_found)`,
   **tuyệt đối không** assert `response.parsed_body` — body khác nhau giữa
   test/dev (leak exception class + backtrace) và production, và không đi
   qua envelope `{"error": "Not found"}` của app. Đây là loại 404 duy nhất
   trong toàn dự án không có contract JSON ổn định.
4. **`status` enum guard phải chạy trước mọi `.build`/`.where`/`.update`**
   (`F7-db.md` §1c, `F7-api.md` §2.1/§2.2/§2.3): T6 phải implement
   `invalid_status?` local và gọi nó ở **cả 3 action** trước khi chạm ActiveRecord
   — bỏ sót một chỗ sẽ biến A18/A24 từ `422` thành `500` (`ArgumentError`).
5. **Kiểm tra org-isolation là nghĩa vụ riêng, không lồng ghép qua loa**
   (`CLAUDE.md` §4): T7 phải có test rõ ràng "org A không đọc/sửa được
   policy của org B → 404, không 403" tách biệt khỏi test happy-path, đúng
   yêu cầu chung của dự án cho mọi resource.
6. **Gate suspension hiện tại** (`CLAUDE.md` §3, cập nhật 2026-09-16): không
   có task nào cho `features/f7-policy-crud.feature`/Playwright step
   definitions trong plan này — nhưng **3 gate bắt buộc** (`rubocop`,
   `rspec`, `eslint+vitest`) phải xanh trước khi coi bất kỳ wave/feature nào
   là Done. Nếu gate #3 (acceptance-first) được bật lại trước khi implement,
   phải dừng và bổ sung task viết `.feature` trước khi code, không đi tắt.
7. **Không lẫn phạm vi F8 vào F7** (SoT §0/§3, OQ-2/OQ-6/OQ-7/OQ-9): không
   task nào ở trên được thêm cột "Số nơi đang gán", trang `/policies/:id`,
   action "Xóa"/"Xem chi tiết", hay cảnh báo deactivate — dù
   `UI_UX_design.md` §7.1/§7.2 có mô tả các thứ này, chúng đã được SoT chốt
   là nghĩa vụ carry-over cho F8, không được "tiện tay" làm sớm ở F7.
