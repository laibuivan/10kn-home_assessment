# Plan — F8 Policy assignment (gán Group và/hoặc Device; chặn inactive/chéo org; chịu group lớn, có trạng thái job)

## Readiness

- SoT: `docs/sot/F8-policy-assignment.md` — **approved** (2026-09-17,
  lai.bui.vtp@gmail.com). §11 có **32 scenario** (đánh số S1–S32 dưới đây
  theo thứ tự xuất hiện trong file), cả 12 Open Question (§12) đã chốt
  "theo khuyến nghị" — plan này bám đúng các quyết định đó, **không** mở
  lại bất kỳ OQ nào trong số đó.
- Design DB/API/Frontend: `docs/design/F8-db.md`, `docs/design/F8-api.md`,
  `docs/design/F8-frontend.md` (+ `F8-frontend-preview.html`) — **cả 3 đã
  approved** (2026-09-17). 3 bản thiết kế đã tự phát hiện và giải quyết
  tường minh các điểm sau — plan **kế thừa nguyên**, không tự chọn khác:
  - `F8-db.md` §1c: `Group has_many :policy_assignment_jobs, dependent:
    :nullify` (không phải `:delete_all` như gợi ý ban đầu) + callback
    `before_destroy :fail_pending_policy_assignment_jobs` **phải khai báo
    trước** 2 dòng `has_many :policy_assignments`/`:policy_assignment_jobs`
    trong `class Group` — sai thứ tự sẽ làm A10/A19 không thỏa (job đã bị
    `group_id = NULL` trước khi callback tìm thấy nó để set `failed`).
  - `F8-db.md` §2.2: 2 unique index **partial**, có `name:` tường minh
    (`index_policy_assignments_on_policy_and_group` /
    `..._and_device`) — bắt buộc để `upsert_all unique_by:` trỏ đúng
    partial index (không dùng mảng cột).
  - `F8-db.md` §1a: CHECK constraint "đúng 1 trong 2" (`group_id`/`device_id`)
    là **bắt buộc**, không tùy chọn — vì cả 2 code path chính đều dùng
    `upsert_all` (bỏ qua model validation).
  - `F8-api.md` §2.5/§2.11: `202` cho nhánh Group (async, chưa xong tại
    thời điểm response), `201` cho nhánh Device (đồng bộ, đã xong thật) —
    2 status code khác nhau có chủ đích, không phải sơ suất.
  - `F8-api.md` §2.5: dedupe OQ-5 chỉ ở **service layer** (query
    `pending`/`running` hiện có trước khi tạo job mới), **không** có
    unique index DB-level cho dedupe (race vô hại nhờ idempotent).
  - `F8-api.md` §2.9: `serialize_policy_assignment_job` phải xử lý
    `job.group nil` → trả `200`, `group: null`, `status: "failed"` —
    **không** 404 sau khi Group bị xóa.
  - `F8-frontend.md` §2.3: `AsyncJobBanner`/`stores/jobs.ts` mount **1 lần
    global ở `AppShell.vue`**, không mount cục bộ ở từng view — vì job có
    thể được khởi tạo từ 2 entry point (Group Detail, Policy Detail).
  - `F8-frontend.md` §2.2: gỡ Policy khỏi Group từ **cả 2 hướng** (Group
    Detail tab Policies, Policy Detail tab Group) gọi **cùng 1 hàm API**
    `deleteGroupPolicyAssignment(groupId, policyId)` — không có endpoint
    đối xứng dưới `/policies/:id/group_assignments/:group_id`.
  - `F8-frontend.md` §4: **không toast khi bắt đầu job** (chỉ đóng modal,
    banner đảm nhiệm feedback) — khác nhánh Device (đồng bộ, có toast ngay).
- Dependency (`docs/backlog.md` dòng 17, 29–30): F8 phụ thuộc **F6, F7, F4
  — cả 3 đã Done** (xác nhận trực tiếp trong code, không chỉ theo backlog):
  - `api/db/schema.rb` có `organizations`, `users`, `devices`, `groups`,
    `group_memberships` (F6), `policies` (F7) — không có `policy_assignments`/
    `policy_assignment_jobs`/`solid_queue_*` nào (đúng dự đoán "chưa làm" của
    3 bản thiết kế).
  - `api/Gemfile` **không có** `solid_queue`; `grep queue_adapter` trên
    `api/config/environments/*.rb` chỉ thấy 1 dòng comment mẫu
    (`# config.active_job.queue_adapter = :resque`) — xác nhận F8 là feature
    đầu tiên cần cài Solid Queue thật, không phải giả định.
  - `api/config/routes.rb`: `resources :policies, only: [:index, :create,
    :update]` (không có `:show`) — đúng F7 OQ-7 đã chốt "chưa làm", F8 mở lại.
  - `api/app/models/group.rb` đã có comment "ghi nợ": *"F8 still owes
    `has_many :policy_assignments, dependent: :delete_all` once that table
    exists"* — xác nhận đúng carry-over F5→F8.
  - `web/src/views/groups/GroupDetailView.vue`: tab Policies hiện là
    `<span class="tab-item future" title="Có ở F7">Policies</span>` —
    placeholder tĩnh (comment trong file còn ghi sai "Có ở F7", thực tế F7
    đã chủ động không làm và giao lại cho F8 — không sửa comment đó, chỉ
    thay hẳn `<span>` thành tab thật, comment cũ sẽ mất theo diff).
  - `web/src/router/index.ts` đã có comment xác nhận không có `/policies/:id`
    ("no `GET /policies/:id` route exists" — F7 OQ-7); `AppShell.vue`
    **đã có** `nav-policies` thật (không phải nợ của F8 — F7 đã trả debt
    này, `data-testid="nav-policies"` đã tồn tại).
  - `web/src/components/AsyncSearchSelect.vue` đã tồn tại (từ F6) — F8 tái
    dùng nguyên, không tạo lại.
  - **Nghĩa vụ carry-over cụ thể F8 phải trả** (không được bỏ quên, theo
    đúng SoT §1):
    - F7 OQ-6: cột `assignments_count` ở `GET /api/v1/policies` (T18).
    - F7 OQ-7: trang `Policy Detail` (`/policies/:id`, 2 tab) thật (T17, T43,
      T44).
    - F7 OQ-9: cảnh báo deactivate với N thật (T45, T46).
    - F6 OQ-1 / `F6-api.md` §4: toàn bộ hạ tầng Solid Queue job + bảng theo
      dõi trạng thái + API poll + `AsyncJobBanner.vue` dồn hết vào F8, không
      chia sẻ ngược lại F6 (T1, T3, T12, T34, T36).
- Cross-check SoT ↔ 3 design: không phát hiện mâu thuẫn mới. 2 mâu thuẫn
  đa-nguồn đã tự giải quyết trong SoT (OQ-1 tên trạng thái job `pending/
  running/done/failed` — không dùng `queued/completed` của
  `UI_UX_design.md`; OQ-2 Phương án A assignment-level) đã được 3 bản design
  bám đúng nhất quán. → **Sẵn sàng build.**

## Quy trình áp dụng cho plan này (`CLAUDE.md` §3/§5)

- Golden rule #3 (viết `.feature` trước) **đang tạm ngưng** → không có task
  nào cho `features/f8-policy-assignment.feature`/step definitions trong
  plan này.
- Gate #4 (Playwright) tạm ngưng → Done cho F8 đo bằng **3 gate bắt buộc**:
  `rubocop`, `rspec`, `eslint + vitest` — phải xanh trước khi coi bất kỳ
  wave/task nào là Done. Đây là **điều kiện hoàn tất bắt buộc của mọi task
  có code**, không phải 1 task riêng có thể tách ra rồi bỏ qua — nhắc lại ở
  cuối mỗi wave.
- TDD (rule #4) áp dụng cho pure logic: `PolicyAssignment`/`PolicyAssignmentJob`
  model validation (T9/T10, viết cùng lúc T2/T3), `GroupPolicyAssignmentJob`
  job logic (T12), và các pure function FE (`stores/jobs.ts` polling/dedupe
  logic — T34/T48).
- `CLAUDE.md` §4: **mọi task đụng `PolicyAssignment`/`PolicyAssignmentJob`
  phải có test org-isolation riêng** (org A không đọc/gán/gỡ được resource
  của org B ở **cả 2 phía** — Policy và Group/Device đích — kỳ vọng 404,
  không 403) — gộp vào T25/T27/T28 (request spec), không tách task riêng,
  nhưng T25/T27/T28 **không được bỏ sót** vế này.

### Bảng tra scenario (SoT §11 → ký hiệu dùng trong plan; đối chiếu A-item §5.2 khi có)

| # | Scenario (SoT §11) | A-item liên quan |
|---|---|---|
| S1 | Gán Policy cho Group nhỏ chạy async, hoàn thành `done` | §4-A (main flow) |
| S2 | Gán Policy cho Group org khác → 404 | A1 |
| S3 | Gán Policy org khác cho Group org mình → 404 | A2 |
| S4 | Gán trực tiếp Policy org khác cho Device org mình → 404 | A4 |
| S5 | Gán trực tiếp Policy cho Device org khác → 404 | A3 |
| S6 | Gán Policy inactive cho Group → 422 | A5, A26 |
| S7 | Gán Policy inactive trực tiếp cho Device → 422 | A6, A26 |
| S8 | Gán trực tiếp Policy cho Device retired → 422 | A7 |
| S9 | Gán Policy cho Group chứa device retired vẫn thành công | A8 |
| S10 | Gán lại Policy đã gán cho cùng Group không tạo trùng | A12, A13, 5.1 |
| S11 | Gán 3 lần liên tiếp không nhân đôi liên kết | A13 |
| S12 | Group bị xóa giữa lúc job đang chạy → job `failed` | A10, A19 |
| S13 | Poll job org khác → 404 | A15 |
| S14 | Poll job không tồn tại → 404 | A16 |
| S15 | Quay lại Group Detail thấy banner job `running` | A17 (nhánh có job) |
| S16 | Group không có job → không banner | A17 (nhánh rỗng) |
| S17 | Xóa Group có Policy gán → không để dữ liệu treo | A18 |
| S18 | Gỡ Policy khỏi Group thành công | §4-C |
| S19 | Gỡ Policy trực tiếp khỏi Device thành công | §4-C |
| S20 | Deactivate Policy chưa gán ở đâu → không cảnh báo | A20 |
| S21 | Deactivate Policy đang gán vẫn thành công, không tự gỡ | A21 |
| S22 | Activate lại Policy giữ nguyên liên kết cũ | A22 |
| S23 | Cột "Số nơi đang gán" = tổng Group + Device, không tính trùng | A23 |
| S24 | Policy chưa gán ở đâu → "Số nơi đang gán" = 0 | A32 |
| S25 | Policy Detail 2 tab hiện đúng Group/Device đã gán | §4-D |
| S26 | Policy Detail của org khác → 404 | tương đương A1–A4 áp cho `:id` |
| S27 | Policy Detail rỗng khi chưa gán ở đâu | A24 |
| S28 | Nút "Gán thêm" disable khi Policy inactive | A25 |
| S29 | Menu ⋯ Policy List có action "Xem chi tiết" | A28 |
| S30 | Không token ở endpoint gán cho Group → 401 | A29 |
| S31 | Không token ở endpoint gán trực tiếp Device → 401 | A29 |
| S32 | RBAC — user khác trong org vẫn gỡ được policy do người khác gán | A31 |

## Task breakdown

### Backend — hạ tầng & DB (wave 1–3)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | Cài Solid Queue: `bundle add solid_queue`, `bin/rails solid_queue:install` (sinh `config/queue.yml`, `config/recurring.yml`, migration `solid_queue_*` tables, `bin/jobs`), thêm `config.active_job.queue_adapter = :solid_queue` vào `development.rb` (installer chỉ tự làm cho `production.rb`), `config.active_job.queue_adapter = :test` vào `test.rb`, `config.include ActiveJob::TestHelper` vào `rails_helper.rb`. **Quyết định vận hành dev/docker** (F8-db.md §2.1 để ngỏ cho plan quyết): thêm service `worker` mới vào `docker-compose.yml` (build từ `./api`, cùng volume/env với service `api`, `depends_on: db (healthy)`, command `bin/jobs`) — lý do: repo chạy chính qua `docker compose up`, không có `Procfile.dev`/foreman, nên thêm 1 service Compose là cách khớp đúng thói quen vận hành hiện có, không bắt user tự mở terminal thứ 2. Cập nhật `README.md` root (mục "Quickstart") ghi rõ service `worker` tự chạy cùng `docker compose up`, không cần bước tay | Infra | `api/Gemfile`, `api/Gemfile.lock`, `api/config/queue.yml`, `api/config/recurring.yml`, `api/db/migrate/<ts>_create_solid_queue_tables.rb`, `api/config/environments/{development,test,production}.rb`, `api/bin/jobs`, `api/spec/rails_helper.rb`, `docker-compose.yml`, `README.md` | — | Hạ tầng cho T12, T25 |
| T2 | Migration `CreatePolicyAssignments` (đúng SQL `F8-db.md` §2.2: 4 `t.references` `index: false`, 2 unique partial index tên tường minh, 2 index đơn `group_id`/`device_id`, 1 composite `(organization_id, policy_id)`, CHECK constraint `chk_policy_assignments_exactly_one_target`) + model `PolicyAssignment` (`belongs_to :organization/:policy`, `belongs_to :group/:device, optional: true`, `validate :exactly_one_of_group_or_device` với `EXACTLY_ONE_TARGET_MESSAGE`, XOR `group_id.present? ^ device_id.present?`) | Data | `api/db/migrate/<ts>_create_policy_assignments.rb`, `api/app/models/policy_assignment.rb`, `api/db/schema.rb` | — | Nền cho S1–S32 |
| T3 | Migration `CreatePolicyAssignmentJobs` (đúng SQL `F8-db.md` §2.3: `group_id` **nullable**, `status`/`total_count`/`processed_count`/`error_message`, index `[group_id, status]`, `[organization_id]`, `[policy_id, group_id]`) + model `PolicyAssignmentJob` (`belongs_to :group, optional: true`, `enum :status, { pending: 0, running: 1, done: 2, failed: 3 }`, `GROUP_DELETED_MESSAGE`, `validates :total_count, :processed_count, numericality: { greater_than_or_equal_to: 0 }`) | Data | `api/db/migrate/<ts>_create_policy_assignment_jobs.rb`, `api/app/models/policy_assignment_job.rb`, `api/db/schema.rb` | — | Nền cho S1, S12–S16 |
| T4 | `Group` model: thêm `before_destroy :fail_pending_policy_assignment_jobs` **trước** 2 dòng `has_many :policy_assignments, dependent: :delete_all` / `has_many :policy_assignment_jobs, dependent: :nullify` (thứ tự khai báo bắt buộc, `F8-db.md` §1c) + method riêng `fail_pending_policy_assignment_jobs` dùng `update_all` (không callback) trên `status IN (pending, running)` | Data | `api/app/models/group.rb` | T2, T3 | S12, S17 |
| T5 | `Policy` model: `has_many :policy_assignments, dependent: :restrict_with_error` + constant `INACTIVE_ASSIGNMENT_MESSAGE = "Chỉ gán được Policy đang active."` | Data | `api/app/models/policy.rb` | T2 | S6, S7 |
| T6 | `Device` model: `has_many :policy_assignments` (không `dependent:`) + constant `RETIRED_POLICY_MESSAGE = "Thiết bị đã retired, không thể gán policy trực tiếp."` | Data | `api/app/models/device.rb` | T2 | S8 |
| T7 | `Organization` model: `has_many :policy_assignments`, `has_many :policy_assignment_jobs` (không `dependent:`) | Data | `api/app/models/organization.rb` | T2, T3 | Nền cho `current_organization.policy_assignment_jobs` |
| T8 | FactoryBot `factory :policy_assignments` (trait `:for_group`/`:for_device`), `factory :policy_assignment_jobs` (trait `:pending`/`:running`/`:done`/`:failed`) | Test | `api/spec/factories/policy_assignments.rb`, `api/spec/factories/policy_assignment_jobs.rb` | T2, T3 | Hạ tầng cho T9–T11, T25–T30 |

### Backend — model/job spec (wave 3)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T9 | RSpec model `PolicyAssignment`: model validation "đúng 1 trong 2" (cả 2 nil, cả 2 present → invalid; đúng 1 → valid); **test riêng cho CHECK constraint** — bypass model validation bằng raw SQL `INSERT`/`ActiveRecord::Base.connection.execute` với cả 2 cột nil hoặc cả 2 có giá trị → assert raise `ActiveRecord::StatementInvalid` (đây là test mà `F8-db.md` §1a giải thích lý do CHECK constraint tồn tại — `upsert_all` bỏ qua model validation); test `upsert_all unique_by: :index_policy_assignments_on_policy_and_group, on_duplicate: :skip` không tạo dòng trùng khi gọi lại | Test | `api/spec/models/policy_assignment_spec.rb` | T2, T8 | S10, S11, A12, A13 (nửa model) |
| T10 | RSpec model `PolicyAssignmentJob`: enum 4 giá trị, `total_count`/`processed_count` numericality (âm → invalid), `group_id` nullable (tạo job với `group: nil` vẫn valid — mô phỏng sau khi Group bị xóa) | Test | `api/spec/models/policy_assignment_job_spec.rb` | T3, T8 | S12 (nửa model) |
| T11 | RSpec model `Group` — bổ sung test **thứ tự callback** (`F8-db.md` §1c): tạo Group có 1 job `pending` + 1 `policy_assignment` → `group.destroy!` → assert job `reload.status == "failed"` **và** `group_id.nil?` **và** `error_message == PolicyAssignmentJob::GROUP_DELETED_MESSAGE`; assert `PolicyAssignment` liên quan bị xóa sạch; assert Device/Policy vẫn còn (S17); test riêng Group không có job nào cũng xóa được bình thường (regression, không phá A18/A19 cũ ở F5/F6) | Test | `api/spec/models/group_spec.rb` | T4, T8 | S12, S17 |
| T12 | `GroupPolicyAssignmentJob < ApplicationJob` (`perform(job_id)` đúng code mẫu `F8-db.md` §3.4b: guard `return unless job.pending? || job.running?`, `job.update!(status: :running)`, `Group.find(job.group_id)` rescue `RecordNotFound` → `failed` với `GROUP_DELETED_MESSAGE`, `upsert_all` 1 dòng `unique_by: :index_policy_assignments_on_policy_and_group, on_duplicate: :skip`, `job.update!(status: :done, processed_count: job.total_count)`) + job spec dùng `:test` adapter + `perform_enqueued_jobs` (S1, S9, S12) | Backend job | `api/app/jobs/group_policy_assignment_job.rb`, `api/spec/jobs/group_policy_assignment_job_spec.rb` | T1, T3, T4 | S1, S9, S12 |

### Backend — Pundit (wave 2–3)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T13 | `GroupPolicy` — thêm `assign_policy?`/`unassign_policy?` (luôn `true`, tái dùng `show?` có sẵn cho 2 action đọc) + spec | Backend Pundit | `api/app/policies/group_policy.rb`, `api/spec/policies/group_policy_spec.rb` | — | Nền cho T19, T20 |
| T14 | `PolicyPolicy` — thêm `show?`/`assign_device?`/`unassign_device?` (luôn `true`) + spec | Backend Pundit | `api/app/policies/policy_policy.rb`, `api/spec/policies/policy_policy_spec.rb` | — | Nền cho T18, T22, T23 |
| T15 | `PolicyAssignmentJobPolicy` mới (`show?` → `true`, `Scope#resolve` = `user.organization.policy_assignment_jobs`) + spec (org isolation của Scope) | Backend Pundit | `api/app/policies/policy_assignment_job_policy.rb`, `api/spec/policies/policy_assignment_job_policy_spec.rb` | T3, T7 | S13, S14 |

### Backend — concern & controller (wave 3–4)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T16 | Concern `PolicyAssignmentJobSerializable` (`serialize_policy_assignment_job` — `group: job.group ? {id,name} : nil`, đúng `F8-api.md` §2.9) | Backend | `api/app/controllers/concerns/policy_assignment_job_serializable.rb` | T3 | S12 (`group: null` khi đã xóa) |
| T17 | Route: mở lại `resources :policies, only: [:index, :show, :create, :update]`; thêm `member do get/post/delete "policy_assignments"`, `get "policy_assignment_jobs"` vào `resources :groups`; thêm `member do get/post/delete "device_assignments"`, `get "group_assignments"` vào `resources :policies`; thêm `resources :policy_assignment_jobs, only: [:show]` độc lập (không nested) | API | `api/config/routes.rb` | — | S25, S26 + nền toàn bộ T18–T23 |
| T18 | `PoliciesController` — mở `show` (`policy_scope(Policy).find` → `authorize policy` → render); `serialize_policy` thêm `assignments_count:` (default arg `policy.policy_assignments.count`, override ở `index` bằng 1 `GROUP BY policy_id` cho cả trang — không N+1) | API | `api/app/controllers/api/v1/policies_controller.rb` | T2, T14, T17 | S23, S24, S25, S26 |
| T19 | `Api::V1::GroupPolicyAssignmentsController` (`index`/`create`/`destroy` đúng `F8-api.md` §2.4–§2.6: `index` join `policy_assignments` + phân trang; `create` — org-scope 2 phía độc lập → `policy.active?` (422 `base`) → `find_or_create_policy_assignment_job` (dedupe OQ-5, transaction `create! + perform_later`) → `202`; `destroy` — org-scope 2 phía → tìm join row → `delete_all` + check `deleted_count` → `204`/`404`) | API | `api/app/controllers/api/v1/group_policy_assignments_controller.rb` | T5, T12, T13, T16, T17 | S1–S3, S6, S10–S12, S18 |
| T20 | `Api::V1::GroupPolicyAssignmentJobsController` (`index` — filter `status=pending,running` (split dấu phẩy) + guard `invalid_job_statuses?` trước `.where`, phân trang) | API | `api/app/controllers/api/v1/group_policy_assignment_jobs_controller.rb` | T13, T16, T17 | S15, S16 |
| T21 | `Api::V1::PolicyAssignmentJobsController` (`show` — `current_organization.policy_assignment_jobs.find` → `authorize` → render, không rẽ nhánh gì cho Group đã xóa, `group: null` tự nhiên qua T16) | API | `api/app/controllers/api/v1/policy_assignment_jobs_controller.rb` | T15, T16, T17 | S13, S14 |
| T22 | `Api::V1::PolicyDeviceAssignmentsController` (`index`/`create`/`destroy` đúng `F8-api.md` §2.10–§2.12: `create` — org-scope 2 phía → `policy.active?` (422) → `device.retired?` (422) → `upsert_all` 1 dòng → `201`; `destroy` — **không** check `device.retired?` (đọc đúng phạm vi hẹp SoT §6, khác F6) | API | `api/app/controllers/api/v1/policy_device_assignments_controller.rb` | T6, T14, T17 | S4, S5, S7, S8, S19 |
| T23 | `Api::V1::PolicyGroupAssignmentsController` (`index` — field tối giản `{id, name}`, phân trang) | API | `api/app/controllers/api/v1/policy_group_assignments_controller.rb` | T14, T17 | S25 |

### Backend — request spec (wave 5)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T24 | Request spec `policies_spec.rb` — bổ sung `show` (S26 org khác → 404, A27 id sai định dạng → 404), `assignments_count` ở `index`/`show`/`create`/`update` (S23, S24), org-isolation riêng cho `show` | Test | `api/spec/requests/api/v1/policies_spec.rb` | T18 | S23–S26 |
| T25 | Request spec `group_policy_assignments_spec.rb` — **toàn bộ vòng đời**: happy path async qua `perform_enqueued_jobs` (S1), org-isolation **2 phía độc lập** (S2, S3 — Group sai org, Policy sai org, test riêng từng phía, không lồng ghép), Policy inactive → 422 (S6, không enqueue job), idempotent (S10, S11 — gọi 3 lần, assert đúng 1 dòng `policy_assignments`), dedupe OQ-5 (2 request liên tiếp cho cùng cặp khi job đầu còn `pending` → cùng `job_id`), gỡ thành công (S18), gỡ liên kết không tồn tại → 404 (OQ-4), 401 không token (S30), RBAC user khác trong org vẫn gỡ được (S32) | Test | `api/spec/requests/api/v1/group_policy_assignments_spec.rb` | T19 | S1–S3, S6, S10, S11, S18, S30, S32 |
| T26 | Request spec `group_policy_assignment_jobs_spec.rb` — filter `status`, org-isolation, group không có job → mảng rỗng (S16), có job `running` → thấy trong response (S15), status ngoài enum → 422 | Test | `api/spec/requests/api/v1/group_policy_assignment_jobs_spec.rb` | T20 | S15, S16 |
| T27 | Request spec `policy_assignment_jobs_spec.rb` — org khác → 404 (S13), id không tồn tại → 404 (S14), **job sau khi Group bị xóa** → `200`, `group: null`, `status: "failed"` (test tích hợp dựng lại đúng tình huống S12: tạo job `pending`, xóa Group, poll lại) | Test | `api/spec/requests/api/v1/policy_assignment_jobs_spec.rb` | T21 | S12–S14 |
| T28 | Request spec `policy_device_assignments_spec.rb` — org-isolation 2 phía độc lập (S4, S5), Policy inactive → 422 (S7), Device retired → 422 (S8), gán vào Group chứa cả retired+active không liên quan nhánh này (điều hướng qua T25, không lặp ở đây), gỡ thành công (S19), gỡ Device retired **vẫn thành công** (đúng quyết định `F8-api.md` §2.12, có test khẳng định rõ để không bị hiểu nhầm là thiếu), 401 (S31) | Test | `api/spec/requests/api/v1/policy_device_assignments_spec.rb` | T22 | S4, S5, S7, S8, S19, S31 |
| T29 | Request spec `policy_group_assignments_spec.rb` — org-isolation, field tối giản `{id,name}`, phân trang | Test | `api/spec/requests/api/v1/policy_group_assignments_spec.rb` | T23 | S25 |
| T30 | Request spec tích hợp — **xóa Group đang có Policy gán + job pending/running cùng lúc** qua `DELETE /api/v1/groups/:id` (đã có từ F5, không sửa controller): assert `groups` row mất, `policy_assignments` liên quan mất sạch, `policy_assignment_jobs` liên quan chuyển `failed` + `group_id: null`, `Policy`/`Device` không đổi (S17, kết hợp T4/T11 ở tầng API thay vì chỉ tầng model) | Test | `api/spec/requests/api/v1/groups_spec.rb` (bổ sung context mới) | T4, T19 | S12, S17 |

### Backend — seed (wave 3)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T31 | `api/db/seeds.rb` — mỗi Organization: vài `PolicyAssignment` mẫu (2–3 Group + 2–3 Device trực tiếp) để cột "Số nơi đang gán" có ý nghĩa; **1 Group cỡ vài trăm device** (ví dụ 300–500, đủ để thấy job chạy vài giây, không cần đúng 10.000 để seed không chậm) + 1 `PolicyAssignment` async demo cho group đó qua `GroupPolicyAssignmentJob.perform_later` trực tiếp trong seed (không qua HTTP) | Data | `api/db/seeds.rb` | T2, T3, T12 | Manual QA readiness (không phải §11 scenario) |

### Frontend — types/api/store (wave 1–3)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T32 | `types/policy.ts` thêm `assignments_count: number`; mới `types/policyAssignment.ts` (`PolicySummary`, `GroupSummary`); mới `types/policyAssignmentJob.ts` (`POLICY_ASSIGNMENT_JOB_STATUSES`, `PolicyAssignmentJob`, `PolicyAssignmentJobResponse`, `PolicyAssignmentJobListResponse`) — đúng `F8-frontend.md` §3.1–§3.3 | Frontend types | `web/src/types/policy.ts`, `web/src/types/policyAssignment.ts`, `web/src/types/policyAssignmentJob.ts` | — | Hợp đồng cho T33–T55 |
| T41 | `utils/policyMessages.ts` mới — export `DEACTIVATE_WARNING(n: number)` (literal SoT §4-F) dùng chung bởi `PolicyListView.vue` (T45) và `PolicyFormModal.vue` (T46), tránh copy-paste literal | Frontend util | `web/src/utils/policyMessages.ts` | — | Nền cho T45, T46 |
| T42 | CSS mới vào `styles/components.css` — `.job-banner-stack`, `.job-banner`, `.job-banner.status-done`, `.job-banner.status-failed`, `.code-block` (đúng `F8-frontend.md` §5, chỉ dùng token màu có sẵn ở `tokens.css`, không bịa màu mới) | Frontend style | `web/src/styles/components.css` | — | Nền cho T36, T43 |
| T33 | `api/policies.ts` thêm `fetchPolicy(id)`; mới `api/policyAssignments.ts` — đủ 8 hàm (`fetchGroupPolicyAssignments`, `createGroupPolicyAssignment`, `deleteGroupPolicyAssignment`, `fetchGroupPolicyAssignmentJobs`, `fetchPolicyAssignmentJob`, `fetchPolicyDeviceAssignments`, `createPolicyDeviceAssignment`, `deletePolicyDeviceAssignment`, `fetchPolicyGroupAssignments`) đúng `F8-frontend.md` §3.4–§3.5, `status` filter join bằng `,` | Frontend API client | `web/src/api/policies.ts`, `web/src/api/policyAssignments.ts` | T32 | Nền cho T34–T40 |
| T36 | `components/AsyncJobBanner.vue` mới — 4 trạng thái theo bảng `F8-frontend.md` §2.3.2, `expanded`/`autoHideTimer` (auto-dismiss 4s khi `done`), nút "Thử lại"/"Xem chi tiết"/"Đóng" theo đúng điều kiện (ẩn "Thử lại" khi `group: null`) | Frontend component | `web/src/components/AsyncJobBanner.vue` | T32, T42 | S1, S12, S15, S16 |
| T46 | `PolicyFormModal.vue` (sửa) — chặn `onSubmit` khi `form.status === 'inactive' && policy.status === 'active' && policy.assignments_count > 0`, hiện `ConfirmModal` với `DEACTIVATE_WARNING(policy.assignments_count)` (từ T41) trước khi thực sự `PATCH` | Frontend component | `web/src/components/PolicyFormModal.vue` | T41 | S21 |
| T34 | `stores/jobs.ts` mới — `track`/`ensurePolling`/`stopPolling` (setInterval 2s, không polling-per-component), `reattachForGroup(groupId)`, `retry(job)` (re-enqueue toàn bộ, OQ-9), `dismiss(jobId)` — đúng `F8-frontend.md` §2.3.1 | Frontend store | `web/src/stores/jobs.ts` | T32, T33 | S1, S10–S16 |
| T35 | `stores/policyAssignments.ts` mới — 3 slice độc lập (`groupPolicies`/`policyGroups`/`policyDevices`, mỗi slice tự `loading`/`error`/`meta`), 7 action đúng bảng `F8-frontend.md` §3.6 (`assign*`/`unassign*` không set `loading`/`error` cấp store, throw nguyên lỗi cho caller) | Frontend store | `web/src/stores/policyAssignments.ts` | T32, T33 | S18, S19, S23–S27 |

### Frontend — component/modal (wave 3–4)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T38 | `components/GroupPolicyAssignModal.vue` mới — wrapper `FormModal` + `AsyncSearchSelect` (`mode="single"`), search chỉ `status=active` (5.1), cảnh báo trùng `isDuplicate` (không chặn submit), `emit('assigned', job)` không toast (T33) | Frontend component | `web/src/components/GroupPolicyAssignModal.vue` | T33 | S6, S10 |
| T39 | `components/PolicyGroupAssignModal.vue` mới — đối xứng T38, search Group không lọc trạng thái, gọi **cùng** `createGroupPolicyAssignment` (tham số đảo) | Frontend component | `web/src/components/PolicyGroupAssignModal.vue` | T33 | S10 |
| T40 | `components/PolicyDeviceAssignModal.vue` mới — search Device (kể cả `retired`, gắn nhãn "· retired" trong dropdown, 5.1), chặn sớm ở FE khi chọn Device `retired` (`canSubmit = false` + banner tĩnh `RETIRED_POLICY_MESSAGE`, **không thay thế** validate server), submit `201` → toast "Đã gán policy cho device" | Frontend component | `web/src/components/PolicyDeviceAssignModal.vue` | T33 | S8, S19 |
| T37 | `AppShell.vue` (sửa) — mount `job-banner-stack` cạnh `<ToastContainer />`, `v-for="job in jobsStore.jobs"` bind `@retry`/`@dismiss` | Frontend layout | `web/src/components/AppShell.vue` | T34, T36 | S1, S12, S15, S16 |
| T43 | `views/policies/PolicyDetailView.vue` mới — header (`fetchPolicy`, edit qua `PolicyFormModal`, code block `configuration` + nút Copy), 2 tab (Group mặc định active, Device lazy-load lần click đầu), nút "Gán thêm" disable khi inactive (A25), nút "Gỡ" mỗi dòng → `ConfirmModal` → gọi đúng hàm dùng chung (T33) — đúng toàn bộ `F8-frontend.md` §2.2 | Frontend view | `web/src/views/policies/PolicyDetailView.vue` | T35, T38, T39, T40 | S25, S27, S28 |

### Frontend — router/view (wave 4–5)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T44 | `router/index.ts` — thêm `{ path: '/policies/:id', name: 'policy-detail', component: PolicyDetailView, props: true }` ngay sau route `groups/:id`, xóa comment cũ "no `/policies/:id`" (F7 để lại, giờ không còn đúng) | Frontend router | `web/src/router/index.ts` | T43 | S25, S26 |
| T45 | `views/policies/PolicyListView.vue` (sửa) — cột `assignments_count` (giữa Status và ⋯), dòng bảng clickable → `router.push('/policies/:id')` (bọc `ActionsMenu` bằng `<span @click.stop>`), menu ⋯ thêm item "Xem chi tiết" (item thứ 3, A28), toggle trạng thái tách nhánh confirm khi `N > 0` dùng `DEACTIVATE_WARNING` (T41) | Frontend view | `web/src/views/policies/PolicyListView.vue` | T44, T41 | S23, S24, S20, S21, S29 |
| T47 | `views/groups/GroupDetailView.vue` (sửa) — đổi 2 `<span>` placeholder thành `<button>` thật + `activeTab`, dựng tab Policies từ đầu (list + nút "+ Gán policy" mở `GroupPolicyAssignModal`, nút "Gỡ" mỗi dòng, `EmptyState`/`ErrorState` riêng), `onMounted` gọi `jobsStore.reattachForGroup(groupId)` **bất kể tab nào active** (A17), watch `jobsStore.jobs` để refetch tab khi job `done` (đúng logic `seenDoneJobIds` ở `F8-frontend.md` §2.4) | Frontend view | `web/src/views/groups/GroupDetailView.vue` | T35, T38, T34 | S1, S9, S15, S16, S18 |

### Frontend — Vitest (wave 6)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T48 | Vitest `stores/jobs.spec.ts` — `track`/dedupe theo `id`, polling dừng đúng lúc `done`/`failed`, poll lỗi network không rơi job khỏi danh sách (im lặng thử lại), `reattachForGroup` gọi đúng endpoint + status filter, `retry` gọi lại `createGroupPolicyAssignment` (không resume) | Test | `web/src/stores/__tests__/jobs.spec.ts` | T34 | S1, S10–S16 |
| T49 | Vitest `stores/policyAssignments.spec.ts` — 3 slice độc lập không share `loading`, `assign*`/`unassign*` không mutate `loading`/`error` cấp store và rethrow lỗi nguyên vẹn | Test | `web/src/stores/__tests__/policyAssignments.spec.ts` | T35 | S18, S19, S23–S27 |
| T50 | Vitest `AsyncJobBanner.spec.ts` — render đúng nội dung/nút theo từng trạng thái (bảng §2.3.2), auto-dismiss sau 4s khi `done` (dùng fake timer), ẩn nút "Thử lại" khi `job.group === null` | Test | `web/src/components/__tests__/AsyncJobBanner.spec.ts` | T36 | S1, S12, S15, S16 |
| T51 | Vitest 3 modal — `GroupPolicyAssignModal.spec.ts`/`PolicyGroupAssignModal.spec.ts`/`PolicyDeviceAssignModal.spec.ts`: search chỉ trả `active` (nhánh Policy), cảnh báo trùng không chặn submit, `PolicyDeviceAssignModal` chặn sớm khi chọn Device retired (`canSubmit=false`) và vẫn xử lý nhánh `422 base` trong `catch` | Test | `web/src/components/__tests__/{GroupPolicyAssignModal,PolicyGroupAssignModal,PolicyDeviceAssignModal}.spec.ts` | T38, T39, T40 | S6, S8, S10 |
| T52 | Vitest `PolicyDetailView.spec.ts` — lazy-load tab Device chỉ ở lần click đầu, 404 header → `EmptyState` + link về `/policies`, 2 tab lỗi độc lập (1 tab lỗi không kéo sập tab khác), nút "Gán thêm" disable khi `policy.status === 'inactive'` | Test | `web/src/views/policies/__tests__/PolicyDetailView.spec.ts` | T43 | S25, S27, S28 |
| T53 | Vitest `PolicyListView.spec.ts` (sửa) — cột `assignments_count` render đúng giá trị, dòng bảng clickable điều hướng đúng route, menu ⋯ có "Xem chi tiết", toggle deactivate hiện `ConfirmModal` khi `N>0` và gọi PATCH thẳng khi `N=0` | Test | `web/src/views/policies/__tests__/PolicyListView.spec.ts` | T45 | S20, S21, S23, S24, S29 |
| T54 | Vitest `PolicyFormModal.spec.ts` (sửa) — thêm case: đổi `active→inactive` với `assignments_count > 0` chặn submit thật, hiện `ConfirmModal` đúng nội dung `DEACTIVATE_WARNING`, xác nhận mới gọi `updatePolicy` | Test | `web/src/components/__tests__/PolicyFormModal.spec.ts` | T46 | S21 |
| T55 | Vitest `GroupDetailView.spec.ts` (sửa) — 2 tab switch được (không còn `<span>` chết), tab Policies lazy-load lần click đầu, reattach job gọi đúng lúc mount (bất kể tab active), refetch tab khi job vừa `done` (cả 2 nhánh active/không active) | Test | `web/src/views/groups/__tests__/GroupDetailView.spec.ts` | T47 | S1, S9, S15, S16, S18 |

### Docs (wave 7)

| # | Task | Layer | File(s) | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T56 | `DESIGN.md` — cập nhật "Mô hình dữ liệu/quan hệ" (thêm `policy_assignments`/`policy_assignment_jobs`, 2 FK nullable + CHECK constraint, Phương án A vs B đã chọn A), "Xử lý Group rất lớn" (ghi rõ Solid Queue **mới cài ở F8**, không phải "có sẵn Rails 8" như §1 ngụ ý — đúng yêu cầu `CLAUDE.md` §4/§6, quyết định `processed_count` cosmetic, quyết định worker service trong `docker-compose.yml`), thêm mục con `### F8 (Policy assignment...)` vào "## AI" (tool/chỗ AI làm/chỗ tự thiết kế/chỗ AI sai đã sửa — theo đúng khuôn các mục F0/F5/F6/F7 đã có, viết ngay sau khi implement xong, không dồn cuối dự án) | Docs | `DESIGN.md` | Toàn bộ T1–T55 | — |

**Rubocop/ESLint/Prettier**: điều kiện hoàn tất ngầm định của **mọi** task
có code ở trên (T1–T55, trừ T56 là docs thuần) — không phải 1 dòng riêng
trong bảng; mỗi task Done kèm chạy sạch `rubocop`/`eslint`+`prettier` trên
đúng file nó sửa. **3 gate bắt buộc** (`rubocop`, `rspec`, `eslint+vitest`)
phải xanh **toàn cục** trước khi coi cả feature F8 Done — không phải điều
kiện riêng của 1 wave cuối, mà là gate chặn của mọi wave đã hoàn thành tính
tới thời điểm kiểm tra.

## Sơ đồ wave

```text
Wave 1 (song song): T1, T2, T3, T32, T41, T42
        │
        ▼
Wave 2 (song song): T4, T5, T6, T7, T8, T13, T14, T33, T36, T46
        │
        ▼
Wave 3 (song song): T9, T10, T11, T12, T15, T16, T31, T34, T35, T38, T39, T40
        │
        ▼
Wave 4 (song song): T17, T18, T19, T20, T21, T22, T23, T37, T43, T47
        │
        ▼
Wave 5 (song song): T24, T25, T26, T27, T28, T29, T30, T44, T45
        │
        ▼
Wave 6 (song song): T48, T49, T50, T51, T52, T53, T54, T55
        │
        ▼
Wave 7: T56
```

- **Wave 1**: hạ tầng Solid Queue, 2 migration nghiệp vụ, FE type contract,
  util nhỏ, CSS — không phụ thuộc gì mới, chạy song song hoàn toàn.
- **Wave 2**: mọi thay đổi model (`Group`/`Policy`/`Device`/`Organization`)
  cần bảng đã tồn tại (wave 1); 2 Pundit extension chỉ cần model Group/Policy
  đã có sẵn từ trước (không mới); FE api client cần types; `AsyncJobBanner`
  chỉ cần type job; `PolicyFormModal` sửa chỉ cần `utils/policyMessages.ts`.
- **Wave 3**: model/job spec cần model+factory (wave 2); `PolicyAssignmentJobPolicy`
  cần `Organization` assoc (wave 2); concern serializer cần model job; seed
  cần model+job class; 2 store FE cần api client (wave 2); 3 modal chỉ cần
  api client, **không** cần store (theo đúng thiết kế — modal gọi hàm `api/`
  trực tiếp, không qua Pinia).
- **Wave 4**: route + 6 controller cần đủ model/job/pundit/concern (wave 2–3);
  `AppShell` mount banner cần banner+store (wave 2–3); `PolicyDetailView` và
  `GroupDetailView` (FE) code song song với backend controller vì **contract
  API đã cố định từ design docs approved** — không cần chờ backend chạy thật
  mới viết được FE.
- **Wave 5**: request spec cần đúng controller (wave 4) đã tồn tại; router
  entry `/policies/:id` cần `PolicyDetailView` (wave 4); `PolicyListView`
  sửa cần route đã có (để "Xem chi tiết"/click dòng có nơi điều hướng tới).
- **Wave 6**: mọi Vitest suite cần component/store/view chúng kiểm tra đã
  tồn tại (wave 2–5) — nhóm chung 1 wave vì không phụ thuộc lẫn nhau.
- **Wave 7**: `DESIGN.md` viết sau cùng, phản ánh đúng quyết định cuối
  (đặc biệt quyết định vận hành Solid Queue T1) — không viết trước khi biết
  chắc quyết định đó có đổi trong lúc implement hay không.

## Rủi ro / open question cần giải quyết trước khi build

Cả 12 SoT OQ + OQ-DB-1/OQ-DB-2 (F8-db.md) + OQ-FE-1/2/3 (F8-frontend.md) đã
chốt — **không có OQ nghiệp vụ nào còn treo**. Các điểm dưới đây là quyết
định **plan này tự đưa ra** để lấp đúng 1 khoảng để ngỏ có chủ đích của 3
bản design (không phải mâu thuẫn cần dừng lại theo `CLAUDE.md` §5, mà là chi
tiết vận hành/kỹ thuật mà `F8-db.md` §2.1 mục 3 tường minh giao lại cho
`/plan`), cùng vài điểm cần implementer không lặng lẽ bỏ qua:

1. **Quyết định vận hành Solid Queue lần đầu trong repo (T1) — thêm service
   `worker` vào `docker-compose.yml`, không dùng Procfile/foreman**: repo
   hiện chạy chính qua `docker compose up` (không có `Procfile.dev`, không
   có gem `foreman`/`overmind`), nên thêm 1 service Compose mới (build từ
   `./api`, `command: bin/jobs`, share volume/env với `api`) là lựa chọn
   khớp nhất với quy trình vận hành đã có, không bắt người chấm mở thêm
   terminal tay. Nếu người duyệt muốn khác (ví dụ Puma plugin chạy
   Supervisor in-process, tránh thêm container), cần sửa lại T1 trước khi
   code — đây là quyết định có thể đổi rẻ, không ảnh hưởng schema/API/FE.
2. **`api/config/environments/test.rb` dùng `:test` adapter, không phải
   `:solid_queue` thật** (đã chốt ở `F8-db.md` §2.1 mục 4, nhắc lại ở đây vì
   dễ bị "tiện tay" đổi lại khi debug CI) — mọi request spec async (T25, T30)
   **phải** dùng `perform_enqueued_jobs` (đồng bộ trong transaction test),
   không `sleep`/poll thật, tránh flaky.
3. **T30 là test tích hợp duy nhất chạm cả 3 model** (`Group`, `PolicyAssignment`,
   `PolicyAssignmentJob`) qua đúng 1 request `DELETE /groups/:id` — dễ bị bỏ
   quên nếu chỉ nghĩ theo layer (model spec ở T11 đã test unit-level, dễ tưởng
   đã "đủ") — T30 xác nhận đúng hành vi end-to-end qua `GroupsController#destroy`
   hiện có (không sửa controller đó, F5 đã viết đúng `destroy!`).
4. **Thứ tự khai báo trong `Group` model (T4) là điểm dễ vỡ nhất của toàn
   feature** — `before_destroy` phải đứng **trước** 2 dòng `has_many` mới,
   không phải theo thói quen "association trước, callback sau" ở các model
   khác trong repo (`Device`, `Policy` không có tình huống tương tự) — T4 và
   T11 (spec) phải cùng khóa chặt điểm này, review code T4 nên đọc kỹ comment
   giải thích thứ tự trong `F8-db.md` §1c trước khi viết.
5. **Seed T31 gọi `GroupPolicyAssignmentJob.perform_later` trực tiếp trong
   `seeds.rb`** — cần adapter thật (`:solid_queue`, không phải `:test`) đang
   chạy để job này thực sự được xử lý khi seed trong Docker (đúng vì
   `RAILS_ENV=development` dùng `:solid_queue` theo T1) — nếu chạy seed mà
   service `worker` (T1) chưa lên, job sẽ nằm `pending` mãi trong demo (không
   phải bug, chỉ cần đảm bảo `docker compose up` khởi cả 2 service trước khi
   seed, đúng thứ tự `depends_on` đã khai ở T1).
6. **Không có nhánh nào ở F8 thêm route/component tại `/devices/:id`** (OQ-11)
   — nhắc lại rõ trong plan vì đây là chỗ dễ bị "tiện tay" thêm khi thấy
   `UI_UX_design.md` §5 gợi ý nút "Gán policy trực tiếp" ở Device Detail —
   3 bản design đã tường minh từ chối, không task nào trong plan này chạm
   `web/src/views/devices/DeviceDetailView.vue`.

**Không phát hiện điểm nào trong 3 bản design (`F8-db.md`/`F8-api.md`/
`F8-frontend.md`) thiếu chi tiết tới mức không code thẳng được** — cả 3 đã tự
đối chiếu chỉ dẫn đầu vào với SoT, tự phát hiện và giải quyết 2 mâu thuẫn
đa-nguồn (OQ-1, OQ-2 lệch nghĩa) và 1 lệch có chủ đích (`:nullify` thay
`:delete_all`), đều đã ghi rõ lý do + được approve tường minh — plan chỉ cần
bám đúng, không cần dừng lại hỏi thêm.
