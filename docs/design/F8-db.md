---
feature_id: F8
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-17
---

# Thiết kế Database — F8

Nguồn: `docs/sot/F8-policy-assignment.md` (approved, cả 12 OQ đã chốt theo
khuyến nghị), `PRD.md` §"Nghiệp vụ" → "Policy"/"Group", `CLAUDE.md` §4 toàn
bộ, `api/db/schema.rb` hiện có (`organizations`, `users` từ F0; `devices` từ
F2/F3; `groups` từ F5; `group_memberships` từ F6; `policies` từ F7 — xem
`docs/design/F5-db.md`, `docs/design/F6-db.md`, `docs/design/F7-db.md`),
`docs/backlog.md` dòng 17/29/30 (F8 sở hữu `policy_assignments` +
`policy_assignment_jobs`, phụ thuộc F6/F7/F4; F9 đọc `policy_assignments`,
không phải việc của F8).

**Kết luận đầu tiên (khớp SoT §1, §3, §8):** F8 cần **ba** migration —
(1) cài đặt Solid Queue (bảng `solid_queue_*` do gem sinh, hạ tầng, chưa tồn
tại trong repo — xác nhận lại: `grep` `api/Gemfile`/`config/environments/*.rb`
không thấy `solid_queue`/`queue_adapter` nào), (2) `CreatePolicyAssignments`,
(3) `CreatePolicyAssignmentJobs`. Không sửa cột nào của
`organizations`/`users`/`devices`/`groups`/`group_memberships`/`policies`.
Trả 2 nghĩa vụ carry-over F7 đã ghi nợ ở `docs/design/F7-db.md` §4a
(`Policy has_many :policy_assignments`, cột "Số nơi đang gán") và nghĩa vụ F5
đã ghi nợ ở `docs/design/F5-db.md` §4 (`Group has_many :policy_assignments,
dependent: :delete_all`) — **có sửa một chi tiết** so với câu chữ đó, xem §1
mục "Lệch có chủ đích" ngay dưới.

**Lệch có chủ đích so với chỉ dẫn ban đầu — `policy_assignment_jobs` dùng
`dependent: :nullify`, không phải `:delete_all`:** chỉ dẫn đầu vào của bước
`/design` này liệt `Group has_many :policy_assignment_jobs, dependent:
:delete_all` cùng hàng với `policy_assignments`. Đây **không** áp dụng được
cho `policy_assignment_jobs` — lý do đầy đủ, xem §4a. Tóm tắt: SoT §11 có
Scenario "Job gán Policy cho Group bị xóa giữa lúc đang chạy chuyển sang
failed" — job phải **còn tồn tại và đọc được qua `GET
/api/v1/policy_assignment_jobs/:id` với `status: failed`** sau khi Group đã
bị xóa (A10/A19). Nếu `dependent: :delete_all` xóa luôn dòng
`policy_assignment_job`, request poll đó sẽ nhận 404 (dòng đã mất), không
phải `failed` — vi phạm trực tiếp acceptance criteria đã approve. Không tự ý
bỏ qua mâu thuẫn này (đúng tinh thần `CLAUDE.md` §5) — đã phân tích và chọn
`dependent: :nullify` + `before_destroy` callback thay thế, giữ đúng mọi
Scenario khác (A18 vẫn xóa sạch `group_memberships`/`policy_assignments`).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `PolicyAssignment` (mới) | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false` + `foreign_key: true`. Org-scope **trực tiếp trên bảng này** (không suy ra qua join `policy`/`group`/`device`) — cho phép `current_organization.policy_assignments` tồn tại và mọi query đếm/lookup không phải join 2-3 bảng chỉ để lọc org, đúng yêu cầu đề bài §"Nội dung cần thiết kế" | Add |
| `PolicyAssignment` | `belongs_to :policy` | FK `policy_id`, `bigint` | `null: false` + `foreign_key: true` | Add |
| `PolicyAssignment` | `belongs_to :group` | FK `group_id`, `bigint` | **`null: true`** + `foreign_key: true` (2 cột FK riêng, không polymorphic — OQ-12 đã chốt) | Add |
| `PolicyAssignment` | `belongs_to :device` | FK `device_id`, `bigint` | **`null: true`** + `foreign_key: true` | Add |
| `PolicyAssignment` | CHECK constraint "đúng 1 trong 2" | DB constraint | `add_check_constraint` — xem §1a cho lý do **bắt buộc**, không phải tùy chọn | Add |
| `PolicyAssignment` | validate `exactly_one_of_group_or_device` | model validation | Lớp thứ 2, message field-level thân thiện hơn `CheckViolation` — xem §1a | Add |
| `PolicyAssignment` | `created_at`/`updated_at` | `datetime` | `null: false` mặc định. Không mang ý nghĩa gì cho công thức tie-break F9 (đó là `policies.updated_at`, không phải `policy_assignments.updated_at`) — xem §1b | Add |
| `PolicyAssignment` | `status` | — | **Không thêm** — SoT §12 "Rủi ro/giả định" đã chốt hiệu lực suy ra từ `policy.status` tại thời điểm F9 tính | Không làm (chốt SoT) |
| `PolicyAssignment` | `source` (`group`/`direct`) | — | **Không cần** — khác câu chữ minh họa của `CLAUDE.md` §4. Ở Phương án A (OQ-2), `group_id`/`device_id` (đúng 1 có giá trị) đã tự thân phân biệt "gán qua Group" hay "gán trực tiếp Device" — thêm `source` là dữ liệu suy ra được, trùng lặp, vi phạm chuẩn hoá không cần thiết | Không làm |
| `PolicyAssignmentJob` (mới) | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false` + `foreign_key: true` | Add |
| `PolicyAssignmentJob` | `belongs_to :policy` | FK `policy_id`, `bigint` | `null: false` + `foreign_key: true` | Add |
| `PolicyAssignmentJob` | `belongs_to :group` | FK `group_id`, `bigint` | **`null: true`** (khác đề xuất ban đầu "job chỉ có cho nhánh Group nên FK bắt buộc") — nullable **có chủ đích**, xem §1c/§4a: bắt buộc để `dependent: :nullify` không vi phạm `NOT NULL` khi Group bị xóa. Model: `belongs_to :group, optional: true` | Add |
| `PolicyAssignmentJob` | `status` | `integer` | `null: false, default: 0`; `enum :status, { pending: 0, running: 1, done: 2, failed: 3 }` — thứ tự đúng vòng đời tự nhiên, cùng phong cách enum số nguyên của `Device#status`/`Policy#status` | Add |
| `PolicyAssignmentJob` | `total_count` | `integer` | `null: false, default: 0` — set đúng 1 lần lúc enqueue (`group.devices.count`), không đổi sau đó | Add |
| `PolicyAssignmentJob` | `processed_count` | `integer` | `null: false, default: 0` — xem §1c cho ý nghĩa thực sự (không phải bộ đếm tăng dần theo batch) | Add |
| `PolicyAssignmentJob` | `error_message` | `text` | `null: true` — chỉ có giá trị khi `status: failed` | Add |
| `PolicyAssignmentJob` | `created_at`/`updated_at` | `datetime` | `null: false` mặc định | Add |
| `Policy` | `has_many :policy_assignments` | — | **Trả nghĩa vụ carry-over F7** (`docs/design/F7-db.md` §4a). `dependent:` — xem §1d cho lựa chọn `:restrict_with_error` | Add |
| `Group` | `has_many :policy_assignments, dependent: :delete_all` | — | **Trả nghĩa vụ carry-over F5** (`docs/design/F5-db.md` §4), đúng nguyên văn chỉ dẫn — A18/`CLAUDE.md` §4 "xóa Group không để dữ liệu treo" | Add |
| `Group` | `has_many :policy_assignment_jobs, dependent: :nullify` | — | **Khác chỉ dẫn ban đầu** (`:delete_all`) — xem "Lệch có chủ đích" ở trên + §1c/§4a | Add |
| `Group` | `before_destroy :fail_pending_policy_assignment_jobs` | callback | **Phải khai báo trước** 2 dòng `has_many` ngay trên — thứ tự callback quan trọng, xem §1c | Add |
| `Device` | `has_many :policy_assignments` | — | Không cần `dependent:` — PRD không có luồng xóa Device (nhất quán `has_many :group_memberships` hiện có) | Add |
| `Organization` | `has_many :policy_assignments`, `has_many :policy_assignment_jobs` | — | Không `dependent:` — nhất quán mọi `has_many` khác của `Organization` (không có luồng xóa Organization) | Add |
| `devices`/`groups`/`policies`/`group_memberships` (cột, index hiện có) | — | — | Không thêm/đổi/xóa cột hay index nào | No-change |

### 1a. CHECK constraint là **bắt buộc**, không phải lựa chọn tùy ý

Quyết định: **có DB CHECK constraint**, cộng thêm model validation — 2 lớp,
nhưng lý do khác hẳn 2 lớp thông thường ("model bắt phần lớn, unique index
chặn race hiếm gặp") đã dùng cho `name`/`identifier` unique ở F2/F3/F5/F7:

```ruby
add_check_constraint :policy_assignments,
  "(group_id IS NOT NULL AND device_id IS NULL) OR (group_id IS NULL AND device_id IS NOT NULL)",
  name: "chk_policy_assignments_exactly_one_target"
```

- **Cả 2 code path chính viết `policy_assignments` đều dùng `upsert_all`**
  (SoT §4-A bước 5 cho nhánh Group, §4-B bước 3 cho nhánh Device trực tiếp).
  `upsert_all` **bỏ qua toàn bộ validation callback Rails** — đúng phân tích
  đã ghi ở `docs/design/F6-db.md` §3 cho `GroupMembership` (`upsert_all`
  "bỏ qua validation & callback... đây là lý do unique index ở tầng DB là
  bắt buộc, không phải tùy chọn"). Áp đúng lý luận đó ở đây: nếu chỉ có model
  validation `exactly_one_of_group_or_device`, nó **không bao giờ chạy** trên
  cả 2 path chính của F8 — tức là **không có gì** thực sự enforce invariant
  "đúng 1 trong 2" ngoài code Ruby tự tay build đúng `rows` trước khi gọi
  `upsert_all` (dễ vỡ nếu có bug/refactor sau này). CHECK constraint là lớp
  bảo vệ **duy nhất** thực sự chạy trên path chính.
- Khác với case "unique index" (nơi race condition hiếm khi 2 request cùng
  lúc), đây là bug-class hoàn toàn khác: 1 dòng code sai (build `rows` với cả
  2 cột cùng có giá trị, hoặc cả 2 đều `nil`) sẽ luôn luôn vi phạm invariant,
  không phải "hiếm". CHECK constraint biến 1 bug logic thành 1 exception rõ
  ràng ngay lập tức ở integration test đầu tiên, thay vì âm thầm ghi 1 dòng
  dữ liệu sai mà `PolicyAssignment.all.each { |pa| pa.group_id.present? }`
  không ai soát lại.
- Model validation vẫn giữ (không bỏ) vì 2 lý do độc lập với CHECK constraint:
  (1) tự-document invariant ngay tại model, chỗ đầu tiên
  `slice-implementer`/reviewer đọc; (2) bảo vệ có message field-level thân
  thiện (`errors.add(:base, ...)`) cho bất kỳ code path tương lai nào dùng
  `create!`/`save` thay vì `upsert_all` (vd script nội bộ, seed, factory
  test viết sai) — `ActiveRecord::StatementInvalid` từ vi phạm CHECK
  constraint không có message field-level, khó rescue thành 422 sạch ở API
  layer so với `ActiveRecord::RecordInvalid`.
- **Không** đối lập với quyết định "không thêm DB check constraint song song
  cho enum" đã lặp lại ở F2/F5/F7 (`Device#status`, `Policy#status`...) — đó
  là quyết định về **domain giá trị của 1 cột enum** (nhất quán chọn 1 cách
  cho mọi enum, tránh lặt vặt), khác hẳn bản chất của constraint này: đây là
  **ràng buộc quan hệ giữa 2 cột** (shape của bảng), không phải giới hạn giá
  trị 1 cột — 2 loại quyết định độc lập, không cùng 1 "họ" quyết định.

```ruby
class PolicyAssignment < ApplicationRecord
  belongs_to :organization
  belongs_to :policy
  belongs_to :group, optional: true
  belongs_to :device, optional: true

  EXACTLY_ONE_TARGET_MESSAGE =
    "Phải gán cho đúng 1 Group hoặc 1 Device, không thể cả hai hoặc không cái nào.".freeze

  validate :exactly_one_of_group_or_device

  private

  # XOR: true khi đúng 1 trong 2 present, false khi cả 2 hoặc không cái nào.
  def exactly_one_of_group_or_device
    return if group_id.present? ^ device_id.present?

    errors.add(:base, EXACTLY_ONE_TARGET_MESSAGE)
  end
end
```

### 1b. Vì sao `policy_assignments.updated_at` không tham gia tie-break F9

`CLAUDE.md` §4 tie-break conflict resolution dùng `updated_at` của **Policy**
(bậc 2, sau "gán trực tiếp thắng gán qua Group"), không phải `updated_at`
của dòng `policy_assignment`. Vì vậy `upsert_all` ở F8 **không cần** cố ý
"touch" `updated_at` mỗi lần gán lại — xem §3 "on_duplicate: :skip" cho quyết
định cụ thể. Ghi rõ ở đây để F9 không nhầm lẫn 2 cột `updated_at` (2 bảng
khác nhau) khi implement công thức tie-break.

### 1c. `PolicyAssignmentJob.group_id` nullable + thứ tự callback trên `Group`

**Vấn đề phát hiện khi thiết kế** (không có trong chỉ dẫn gốc, do đối chiếu
chỉ dẫn với SoT §11 Scenario "Job... bị xóa giữa lúc đang chạy chuyển sang
failed" + A10/A19): nếu `policy_assignment_jobs.group_id` là `NOT NULL` và
`Group has_many :policy_assignment_jobs, dependent: :delete_all`, thì:

1. Xóa 1 Group **đã từng** có bất kỳ job nào (kể cả `done`/`failed` từ lâu)
   sẽ xóa sạch **toàn bộ lịch sử job** của group đó — mất khả năng poll job
   đang `failed`/`done` sau khi Group đã bị xóa.
2. Nếu đổi sang **không** khai báo `dependent:` gì cho
   `policy_assignment_jobs` (để job "sống sót"), FK `NOT NULL` từ
   `policy_assignment_jobs.group_id → groups.id` sẽ khiến **chính câu lệnh
   xóa Group thất bại** (`ActiveRecord::InvalidForeignKey`) nếu group đó có
   dù chỉ 1 job cũ — vi phạm A18 (Group phải xóa được).

**Giải pháp:** `group_id` **nullable**, `Group has_many
:policy_assignment_jobs, dependent: :nullify` (không `:delete_all`) +
`before_destroy :fail_pending_policy_assignment_jobs` **khai báo trước**
2 dòng `has_many` trong class body:

```ruby
class Group < ApplicationRecord
  belongs_to :organization

  # PHẢI đứng trước `has_many :policy_assignment_jobs, dependent: :nullify`
  # ngay dưới — Rails chạy các before_destroy callback theo đúng thứ tự khai
  # báo trong class body, và `dependent: :nullify` tự đăng ký 1 before_destroy
  # callback riêng ngay tại điểm `has_many` được gọi. Nếu dòng này đứng SAU,
  # `dependent: :nullify` đã set group_id = NULL cho mọi job của group này
  # TRƯỚC KHI callback này chạy, khiến `policy_assignment_jobs.where(...)`
  # (scope qua association, tức WHERE group_id = <id record đang bị xóa>)
  # không còn tìm thấy gì để chuyển failed — SoT A10/A19 sẽ không được thoả.
  before_destroy :fail_pending_policy_assignment_jobs

  has_many :group_memberships, dependent: :delete_all
  has_many :devices, through: :group_memberships
  has_many :policy_assignments, dependent: :delete_all
  has_many :policy_assignment_jobs, dependent: :nullify

  # ... phần còn lại giữ nguyên (name/description validation của F5)

  private

  # A10/A19: xóa Group khi đang có job pending/running cho group đó → job
  # chuyển failed NGAY LÚC xóa (đồng bộ trong transaction destroy), không
  # đợi worker phát hiện sau đó. update_all (không phải .update từng dòng)
  # — bỏ qua callback/validation cố ý, đúng phong cách upsert_all/delete_all
  # đã dùng cho các bulk-op khác trong dự án; nhiều nhất 1 job pending/running
  # cho 1 group tại 1 thời điểm (OQ-5 dedupe) nên chi phí không đáng kể.
  def fail_pending_policy_assignment_jobs
    policy_assignment_jobs.where(status: %w[pending running]).update_all(
      status: PolicyAssignmentJob.statuses[:failed],
      error_message: PolicyAssignmentJob::GROUP_DELETED_MESSAGE,
      updated_at: Time.current
    )
  end
end
```

```ruby
class PolicyAssignmentJob < ApplicationRecord
  belongs_to :organization
  belongs_to :policy
  belongs_to :group, optional: true # nullable sau khi Group bị xóa — xem trên

  enum :status, { pending: 0, running: 1, done: 2, failed: 3 }

  GROUP_DELETED_MESSAGE = "Group đã bị xóa.".freeze

  validates :total_count, :processed_count,
            numericality: { greater_than_or_equal_to: 0 }
end
```

Hệ quả cần API/worker layer biết (không phải quyết định của file này, ghi
lại để `/design F8-api`/`/plan` không bỏ sót):
- `GET /api/v1/policy_assignment_jobs/:id` sau khi Group liên quan đã bị xóa
  vẫn trả `200` với `status: "failed"`, `group_id: null` trong response (hoặc
  field tương đương) — không 404 (job vẫn tồn tại, chỉ mất tham chiếu Group).
- `GET /api/v1/groups/:id/policy_assignment_jobs` chỉ gọi được khi Group còn
  tồn tại (org-scope qua `current_organization.groups.find`) — sau khi Group
  bị xóa, không còn cách nào list job theo group đó nữa (đúng, vì group_id đã
  `NULL`) — chỉ còn poll trực tiếp theo `job_id` nếu FE đã lưu id đó.
- Worker (`GroupPolicyAssignmentJob`) **vẫn nên** tự phòng vệ thêm 1 lớp
  (rescue `ActiveRecord::RecordNotFound` khi `Group.find(group_id)` — hoặc
  `group_id.nil?` — rồi tự set `failed` với message giống hệt) cho trường
  hợp code path nào đó bỏ qua callback này (vd 1 script xóa Group bằng SQL
  thô) — 2 lớp bảo vệ, cùng tinh thần dự án, chốt code cụ thể ở `/plan`.

### 1d. `Policy has_many :policy_assignments, dependent: :restrict_with_error`

Chọn `:restrict_with_error` (không phải bỏ trống `dependent:`). Lý do: F7
OQ-2 đã chốt **không hard-delete Policy** — hiện không có route
`DELETE /api/v1/policies/:id` nào tồn tại, nên trên thực tế dòng này không
bao giờ raise. Nhưng đúng tinh thần đã áp dụng cho
`Organization has_many :users, dependent: :restrict_with_error`
(`docs/design/F0-db.md` §1, "guard against it at the model layer too, not
just 'there's no button for it'") — khai báo tường minh hướng an toàn ngay
từ bây giờ rẻ hơn nhiều so với việc *quên* khai báo rồi một ngày ai đó thêm
route xóa Policy và vô tình cho phép xóa xuyên qua dữ liệu gán đang tồn tại.
Không dùng `:delete_all`/`:destroy` — Policy không có luồng xóa nào để dọn
theo, thêm `dependent:` xóa-dữ-liệu ở đây là bịa ra 1 hành vi không ai yêu
cầu.

## 2. Migration plan

**Ba** migration, theo đúng thứ tự phụ thuộc hạ tầng → dữ liệu, tiếp sau
`20260917005106_create_policies.rb` (F7):

### 2.1. Cài đặt Solid Queue (hạ tầng, chưa có trong repo — SoT §1 xác nhận)

Không phải "đã có sẵn" như `CLAUDE.md` §1 ngụ ý — F8 là feature đầu tiên cần
Solid Queue thật:

1. `bundle add solid_queue` — thêm `gem "solid_queue"` vào `api/Gemfile`
   (nhóm mặc định, **không** giới hạn `group :development, :test` — cần
   thật ở `production` để dispatch job thật; ở `test`, gem vẫn cần present
   vì `ActiveJob::QueueAdapters::SolidQueueAdapter`/model `PolicyAssignmentJob`
   tồn tại độc lập với adapter được chọn cho môi trường test, xem bước 4).
2. `bin/rails solid_queue:install` — installer sinh:
   - `config/queue.yml` (cấu hình worker/dispatcher process — giữ mặc định
     1 queue `default`, đủ cho quy mô 1 org tối đa vài nghìn Group/Policy
     của đề bài; không cần queue riêng cho F8).
   - `config/recurring.yml` (mặc định rỗng — F8 không có job định kỳ/cron).
   - **Một** migration mới do gem sinh (nội dung tự động, không tự viết tay)
     — dự kiến
     `api/db/migrate/20260917091500_create_solid_queue_tables.rb`, tạo các
     bảng nội bộ của Solid Queue: `solid_queue_jobs`,
     `solid_queue_scheduled_executions`, `solid_queue_ready_executions`,
     `solid_queue_claimed_executions`, `solid_queue_blocked_executions`,
     `solid_queue_failed_executions`, `solid_queue_pauses`,
     `solid_queue_processes`, `solid_queue_semaphores`,
     `solid_queue_recurring_executions`, `solid_queue_recurring_tasks`.
     **Không** đây là bảng "nghiệp vụ" của F8 (OQ-3 đã chốt không dùng bảng
     này để expose API poll) — chỉ chạy `bin/rails db:migrate` để có chúng
     trong schema, không đọc/viết trực tiếp từ code ứng dụng.
   - Thêm `config.active_job.queue_adapter = :solid_queue` vào
     `config/environments/production.rb` (hành vi mặc định của installer).
3. **Thêm tay** cùng dòng vào `config/environments/development.rb`
   (installer **không** tự làm cho `development`):
   ```ruby
   config.active_job.queue_adapter = :solid_queue
   ```
   Chạy dev cần 1 process worker riêng (`bin/jobs` — script do installer
   sinh, chạy `SolidQueue::Supervisor`) song song với `bin/rails server`;
   chi tiết supervision (Procfile.dev/`foreman`, hay Puma plugin
   `solid_queue.rb` chạy in-process) là quyết định của `/plan F8`, không
   phải file thiết kế DB này.
4. **Quyết định adapter cho `test`: `:test`, không phải `:solid_queue`**
   (SoT §10 gợi ý đúng hướng này). Thêm vào `config/environments/test.rb`:
   ```ruby
   config.active_job.queue_adapter = :test
   ```
   Lý do: RSpec request spec chỉ cần assert job **đã được enqueue đúng
   tham số** và **kết quả sau khi job chạy xong** — không cần 1 worker
   thật đang chạy nền để test polling. Pattern chuẩn của Rails/RSpec:
   ```ruby
   # spec/rails_helper.rb
   RSpec.configure do |config|
     config.include ActiveJob::TestHelper
   end
   ```
   ```ruby
   # trong request spec
   perform_enqueued_jobs do
     post "/api/v1/groups/#{group.id}/policy_assignments", params: { policy_id: policy.id }
   end
   # job đã chạy XONG (đồng bộ, trong cùng process/transaction test) —
   # assert thẳng job.reload.status == "done", không cần sleep/poll thật.
   ```
   Không chọn `:solid_queue` thật cho test: sẽ cần 1 worker process chạy
   song song với test suite (CI phải tự quản lý start/stop, mỗi lần chạy
   test cần poll/`sleep` chờ worker xử lý → **flaky**, chậm) — đúng cảnh báo
   SoT §10 "test suite RSpec cần adapter test phù hợp... không phải chờ
   worker thật chạy nền".
5. **Không** cấu hình `config.solid_queue.connects_to` (database riêng cho
   queue) — giữ Solid Queue dùng chung 1 Postgres database duy nhất với toàn
   bộ app (mặc định của gem khi không set `connects_to`). Lý do: đơn giản
   hoá vận hành cho phạm vi bài test (1 Postgres instance qua Docker Compose,
   không cần provision database thứ 2); rủi ro (lock contention giữa
   `solid_queue_*` và bảng nghiệp vụ ở quy mô cao) được chấp nhận như 1 rủi
   ro tương lai ngoài phạm vi đề bài — xem §4.

### 2.2. `CreatePolicyAssignments`

Dự kiến `api/db/migrate/20260917093000_create_policy_assignments.rb`:

```ruby
class CreatePolicyAssignments < ActiveRecord::Migration[8.1]
  def change
    create_table :policy_assignments do |t|
      t.references :organization, null: false, foreign_key: true, index: false
      t.references :policy,       null: false, foreign_key: true, index: false
      t.references :group,        foreign_key: true, index: false
      t.references :device,       foreign_key: true, index: false
      t.timestamps
    end

    add_index :policy_assignments, [:policy_id, :group_id], unique: true,
              where: "group_id IS NOT NULL",
              name: "index_policy_assignments_on_policy_and_group"
    add_index :policy_assignments, [:policy_id, :device_id], unique: true,
              where: "device_id IS NOT NULL",
              name: "index_policy_assignments_on_policy_and_device"
    add_index :policy_assignments, :group_id
    add_index :policy_assignments, :device_id
    add_index :policy_assignments, [:organization_id, :policy_id]

    add_check_constraint :policy_assignments,
      "(group_id IS NOT NULL AND device_id IS NULL) OR (group_id IS NULL AND device_id IS NOT NULL)",
      name: "chk_policy_assignments_exactly_one_target"
  end
end
```

- `t.references :group`/`:device` **không** `null: false` — nullable có chủ
  đích (OQ-12, §1a).
- `index: false` trên cả 4 `t.references`: index đơn mặc định bị thay bằng 5
  index tường minh ở dưới (2 unique partial + 2 đơn + 1 composite) — không
  index nào trong 5 cái đó trùng mục đích với index đơn `organization_id`/
  `policy_id`/`group_id`/`device_id` mặc định của Rails, nên tắt hết default
  để không có index dư thừa (đúng pattern F5/F6/F7 đã làm).
- `foreign_key: true` cho cả 4 — **không** `on_delete:` (không cascade ngầm
  ở DB, dọn dẹp tường minh qua Rails `dependent:` — đúng convention xuyên
  suốt dự án).
- Đặt `name:` tường minh cho 2 unique partial index — **bắt buộc**, không
  phải cho đẹp: `upsert_all(rows, unique_by: :index_policy_assignments_on_policy_and_group)`
  cần trỏ đúng tên index này để Postgres build đúng
  `ON CONFLICT (policy_id, group_id) WHERE group_id IS NOT NULL DO ...` khớp
  chính xác partial index đó — xem §3. Nếu để Rails tự sinh tên dài
  (`index_policy_assignments_on_policy_id_and_group_id`), vẫn dùng được,
  nhưng đặt tên ngắn tường minh giúp code gọi `upsert_all` dễ đọc hơn.

### 2.3. `CreatePolicyAssignmentJobs`

Dự kiến `api/db/migrate/20260917094500_create_policy_assignment_jobs.rb`:

```ruby
class CreatePolicyAssignmentJobs < ActiveRecord::Migration[8.1]
  def change
    create_table :policy_assignment_jobs do |t|
      t.references :organization, null: false, foreign_key: true, index: false
      t.references :policy,       null: false, foreign_key: true, index: false
      t.references :group,        foreign_key: true, index: false # nullable — xem §1c
      t.integer :status,          null: false, default: 0
      t.integer :total_count,     null: false, default: 0
      t.integer :processed_count, null: false, default: 0
      t.text :error_message
      t.timestamps
    end

    add_index :policy_assignment_jobs, [:group_id, :status]
    add_index :policy_assignment_jobs, :organization_id
    add_index :policy_assignment_jobs, [:policy_id, :group_id]
  end
end
```

- `group_id` **không** `null: false` — xem §1c (nullable để hỗ trợ
  `dependent: :nullify` khi Group bị xóa).
- Không có `device_id` — job chỉ tồn tại cho nhánh Group (OQ-7 đã chốt gán
  trực tiếp Device là đồng bộ, không qua job).
- Không CHECK constraint nào cần cho bảng này (không có invariant "đúng 1
  trong N cột" như `policy_assignments`).

### 2.4. Backfill / phá dữ liệu cũ / reversible

- **Backfill**: không cần — cả 3 migration chỉ tạo bảng mới hoàn toàn, không
  có dữ liệu cũ nào cần di chuyển vào `policy_assignments`/
  `policy_assignment_jobs`.
- **Phá dữ liệu cũ**: không — không migration nào đụng tới
  `organizations`/`users`/`devices`/`groups`/`group_memberships`/`policies`.
- **Reversible**: (2.2) và (2.3) có, toàn bộ nằm trong `change` với
  `create_table`/`add_index`/`add_check_constraint`, Rails tự sinh `down`.
  (2.1) — migration do Solid Queue gem sinh cũng dùng `change`/reversible
  chuẩn của gem, không tự viết SQL thô.
- **Thứ tự phụ thuộc**: (2.1) không phụ thuộc bảng nghiệp vụ nào, chạy trước
  để `ActiveJob`/`PolicyAssignmentJob` model có adapter thật khi implement.
  (2.2) phụ thuộc `organizations`/`policies`/`groups`/`devices` (đã tồn tại
  từ F0/F5/F7/F2) — chạy được ngay. (2.3) phụ thuộc `organizations`/
  `policies`/`groups` — chạy được ngay, không phụ thuộc (2.2) (2 bảng độc
  lập với nhau, không có FK giữa `policy_assignments` và
  `policy_assignment_jobs`), nhưng giữ thứ tự sau cho mạch đọc tài liệu tự
  nhiên (dữ liệu gán trước, hạ tầng theo dõi job sau).
- **Seed**/factory: thuộc stage Implement — `api/db/seeds.rb` cần vài
  `policy_assignment` mẫu (cả Group và Device) để demo cột "Số nơi đang gán"
  có ý nghĩa; `api/spec/factories/policy_assignments.rb` và
  `.../policy_assignment_jobs.rb` (factory mới) cũng thuộc stage Implement,
  không phải file thiết kế này.

## 3. Index / hiệu năng

### 3.1. Bảng index — `policy_assignments`

| Index | Phục vụ truy vấn | Ghi chú |
|---|---|---|
| `(policy_id, group_id)` UNIQUE, `WHERE group_id IS NOT NULL` | (a) Backing cho `upsert_all` idempotent nhánh Group (A12, A13, A15 tương đương F6); (b) chặn race 2 request gán cùng cặp gần như đồng thời; (c) backing cho `validates uniqueness`-style ở model (dù model không khai báo `uniqueness:` riêng — CHECK+index đã đủ, xem §1a); (d) `GET /api/v1/groups/:id/policy_assignments` — `group.policy_assignments` = `WHERE group_id = ?`, không dùng được leftmost-prefix của index này (policy_id đứng trước) — dùng index đơn `group_id` bên dưới; (e) `GET /api/v1/policies/:id/group_assignments` = `WHERE policy_id = ? AND group_id IS NOT NULL` — **khớp chính xác** cả cột lẫn `WHERE` của index này, dùng được trực tiếp qua leftmost-prefix, không cần index riêng | Tên tường minh `index_policy_assignments_on_policy_and_group` — bắt buộc cho `upsert_all unique_by:`, xem §3.2 |
| `(policy_id, device_id)` UNIQUE, `WHERE device_id IS NOT NULL` | Y hệt vai trò trên, đổi Group→Device. `GET /api/v1/policies/:id/device_assignments` = `WHERE policy_id = ? AND device_id IS NOT NULL` khớp trực tiếp | Tên tường minh `index_policy_assignments_on_policy_and_device` |
| `(group_id)` | `GET /api/v1/groups/:id/policy_assignments` (list Policy đang gán cho 1 Group — mục d trên); cũng là index Rails dùng khi `dependent: :delete_all` sinh `DELETE FROM policy_assignments WHERE group_id = ?` lúc xóa Group (A18) | Yêu cầu tường minh của đề bài — "join ngược khi hiển thị Group đang gán policy này" |
| `(device_id)` | `GET /api/v1/devices/...` (F9 sau này join ngược từ Device — F8 không có endpoint này, nhưng để sẵn cho F9 đọc, đúng đề bài); cũng phục vụ nếu tương lai có xóa Device (chưa có ở PRD) | Yêu cầu tường minh của đề bài |
| `(organization_id, policy_id)` | `assignments_count` trên Policy List (SoT §4-E, §10, A23, A32) — `PolicyAssignment.where(organization_id: org.id).group(:policy_id).count`, **1 query gộp**, không N+1. Không dùng được 2 unique partial index ở trên cho việc này: mỗi cái chỉ phủ **một nửa** số dòng (chỉ Group hoặc chỉ Device), còn `assignments_count` cần tổng **cả 2 loại dòng** cho 1 policy — cần 1 index không có `WHERE` để quét toàn bộ dòng của org theo `policy_id` trong 1 lần | `organization_id` đứng trước — đúng lý do bảng này có cột `organization_id` riêng (đề bài: "tránh N+1/leak khi query theo org") |
| `(id)` PK mặc định | Không có `GET /api/v1/policy_assignments/:id` riêng (đề bài không yêu cầu) | Không cần gì thêm |

### 3.2. Idempotency mechanics — `upsert_all`

**Nhánh Group** (`POST /api/v1/groups/:id/policy_assignments`, chạy trong
job nền):

```ruby
PolicyAssignment.upsert_all(
  [{
    organization_id: group.organization_id,
    policy_id: policy.id,
    group_id: group.id,
    created_at: Time.current,
    updated_at: Time.current
  }],
  unique_by: :index_policy_assignments_on_policy_and_group,
  on_duplicate: :skip
)
```

**Nhánh Device trực tiếp** (`POST /api/v1/policies/:id/device_assignments`,
đồng bộ trong request):

```ruby
PolicyAssignment.upsert_all(
  [{
    organization_id: policy.organization_id,
    policy_id: policy.id,
    device_id: device.id,
    created_at: Time.current,
    updated_at: Time.current
  }],
  unique_by: :index_policy_assignments_on_policy_and_device,
  on_duplicate: :skip
)
```

- **`unique_by:` là tên index** (Symbol), không phải mảng cột — bắt buộc vì
  2 unique index đều là **partial** (`WHERE ... IS NOT NULL`). Nếu truyền
  `unique_by: [:policy_id, :group_id]` (mảng cột), Rails/Postgres sinh
  `ON CONFLICT (policy_id, group_id)` **không kèm `WHERE`**, không khớp với
  bất kỳ partial index nào → Postgres raise "there is no unique or exclusion
  constraint matching the ON CONFLICT specification". Truyền tên index, Rails
  tra `schema_cache` lấy đúng cột + mệnh đề `WHERE` của index đó để sinh
  đúng `ON CONFLICT (policy_id, group_id) WHERE group_id IS NOT NULL DO ...`
  — đây chính là lý do §2.2 đặt tên tường minh cho 2 index này.
- **`on_duplicate: :skip`** (không phải `:update` + cập nhật `updated_at`):
  khác `GroupMembership` (F6) hay `Policy` (F7) — `policy_assignments`
  **không có cột nghiệp vụ nào khác** ngoài 2 FK định danh cặp (không có
  `status`/`source` riêng, §1). Gán lại 1 cặp đã tồn tại không có gì để
  "update" — dòng đã đúng, `:skip` là lựa chọn rẻ nhất, đúng nghĩa "no-op an
  toàn" mà A13 yêu cầu ("chạy lại không nhân đôi"). Không touch `updated_at`
  vì §1b đã xác nhận cột này không tham gia bất kỳ công thức nghiệp vụ nào
  của F9.

### 3.3. Batch size (OQ-10) — phát hiện quan trọng: **không áp dụng cho việc viết `policy_assignments`**

Đề bài yêu cầu đề xuất số cụ thể cho batch `upsert_all` (gợi ý 500-2.000
dòng/batch). Sau khi đối chiếu với OQ-2 (Phương án A, đã approve), có 1 điểm
cần nêu rõ thay vì âm thầm chọn số:

- **Ở Phương án A, gán Policy cho 1 Group luôn là ĐÚNG 1 dòng** ghi vào
  `policy_assignments` (`policy_id` + `group_id`), **không tỉ lệ với số
  device trong group** — khác hẳn F6 (`group_memberships`, thật sự N dòng/N
  device, cần cap 500/request + batch). Câu `upsert_all` ở §3.2 nhánh Group
  nhận **1-phần-tử array**, không có vòng lặp nào để "chia batch". SoT §10
  cũng tự xác nhận điều này ("Bulk-write chỉ còn cần thiết nếu chọn Phương
  án B (fan-out)" — Phương án A đã được chọn).
- Vậy `total_count`/`processed_count`/"batch" ở SoT §4-A bước 5
  ("`upsert_all` theo batch... cập nhật `processed_count`/tiến độ") và OQ-10
  ("kích thước batch cụ thể... 500-2.000 dòng/batch, tương tự cap 500
  device/request đã dùng ở F6") đọc tự nhiên nhất theo mô hình **Phương án B
  (fan-out theo device)** — mô hình mà OQ-2 cuối cùng **không** chọn. Đây là
  phần câu chữ SoT chưa được rà lại triệt để cho khớp 100% với quyết định
  cuối của OQ-2 (2 OQ liên quan, viết ở 2 mục khác nhau, ý định ban đầu có
  lẽ là "để ngỏ nếu B được chọn"). Không tự lặng lẽ chọn 1 cách đọc — xem
  Open Question OQ-DB-1 ở §4b để người duyệt xác nhận cách xử lý cụ thể
  `processed_count` (đã có đề xuất sẵn ở đó để không chặn tiến độ).
- **Đề xuất cụ thể vẫn ghi ra** (đúng yêu cầu đề bài, dù hiện tại không có
  vòng lặp nào dùng tới): nếu 1 tính năng tương lai cần fan-out thật (Phương
  án B revisit, hoặc 1 bulk job khác), **1.000 dòng/batch** — giữa khoảng gợi
  ý 500-2.000, gấp đôi cap 500 device/request đã dùng ở F6 (job nền không bị
  giới hạn timeout HTTP như request đồng bộ nên có thể batch lớn hơn 1 chút),
  nhưng đủ nhỏ để 1 câu `INSERT ... ON CONFLICT` không giữ lock quá lâu trên
  bảng lớn, và là số tròn dễ nhớ/dễ tra log khi debug ("batch 7/10").

### 3.4. Transaction boundary

**(a) Tạo job + đọc `total_count` lúc enqueue** — 1 transaction:

```ruby
ActiveRecord::Base.transaction do
  job = current_organization.policy_assignment_jobs.create!(
    policy_id: policy.id,
    group_id: group.id,
    status: :pending,
    total_count: group.devices.count,
    processed_count: 0
  )
  GroupPolicyAssignmentJob.perform_later(job.id)
end
```

Lý do bọc transaction: `perform_later` (Solid Queue) **cũng là 1 INSERT** vào
`solid_queue_jobs` trên cùng database (§2.1 mục 5 — không dùng database
riêng cho queue). Nếu `create!` job row thành công nhưng `perform_later` lỗi
(hoặc ngược lại) mà không có transaction, sẽ để lại 1 dòng
`policy_assignment_job` ở trạng thái `pending` **vĩnh viễn** — không job nào
thực sự được enqueue để chuyển nó sang `running`/`done`/`failed` (đúng loại
lỗi A10/A19 lo ngại nhưng vì lý do khác: không phải Group bị xóa, mà là job
row mồ côi ngay từ đầu). Transaction đảm bảo cả 2 thành công hoặc cả 2 rollback
cùng nhau.

**(b) Mỗi "batch" `upsert_all` trong job — 1 transaction riêng hay 1
transaction lớn cho cả job?** Dưới Phương án A (đã chốt), câu hỏi này **thu
gọn lại**: toàn bộ "batch" của job chỉ là **1 câu `upsert_all` duy nhất, 1
dòng**. 1 câu SQL đơn đã tự động atomic (Postgres bọc ngầm 1 statement trong
1 transaction), **không cần** `ActiveRecord::Base.transaction` tường minh
bọc quanh chính câu `upsert_all` đó. Job code thực tế:

```ruby
class GroupPolicyAssignmentJob < ApplicationJob
  queue_as :default

  def perform(job_id)
    job = PolicyAssignmentJob.find(job_id)
    return unless job.pending? || job.running?

    job.update!(status: :running)
    group = Group.find(job.group_id) # raise RecordNotFound nếu đã bị xóa

    PolicyAssignment.upsert_all(
      [{ organization_id: group.organization_id, policy_id: job.policy_id,
         group_id: group.id, created_at: Time.current, updated_at: Time.current }],
      unique_by: :index_policy_assignments_on_policy_and_group, on_duplicate: :skip
    )

    job.update!(status: :done, processed_count: job.total_count)
  rescue ActiveRecord::RecordNotFound
    job.update!(status: :failed, error_message: PolicyAssignmentJob::GROUP_DELETED_MESSAGE)
  end
end
```

Không có bước "batch thứ N/M" nào thực sự tồn tại trong code này — điểm này
lặp lại phân tích ở §3.3, ghi ra ở đây vì đây chính là chỗ trade-off
"atomicity" đề bài hỏi thực chất áp dụng: câu hỏi "mỗi batch tự commit, chấp
nhận job done một phần nhờ idempotent + retry" chỉ có ý nghĩa khi có **nhiều
batch**; với Phương án A, không có "một phần" nào để chấp nhận — job hoặc
`done` (dòng đã ghi) hoặc `failed` (Group không còn, chưa ghi được gì, hoặc
lỗi khác) — luôn là toàn-phần, chưa từng có trạng thái lửng lơ giữa 2 batch.
A14 ("Job thất bại một phần") ở SoT vẫn giữ nguyên khả năng xảy ra **nếu**
tương lai chuyển sang Phương án B — không xóa Scenario đó, chỉ ghi rõ ở đây
là chưa có cách nào kích hoạt được nó dưới thiết kế hiện tại.

**(c) Xóa Group** — Rails tự bọc 1 transaction cho toàn bộ `Group#destroy`
(đúng phân tích đã có ở `docs/design/F5-db.md`/`F6-db.md` cho
`group_memberships`), **không cần** `ActiveRecord::Base.transaction` thủ
công. Thứ tự thực thi trong transaction đó (đúng thứ tự khai báo trong
`Group` model, §1c):
1. `before_destroy :fail_pending_policy_assignment_jobs` — chuyển
   `pending`/`running` job của group này sang `failed`.
2. `dependent: :delete_all` cho `group_memberships`.
3. `dependent: :delete_all` cho `policy_assignments`.
4. `dependent: :nullify` cho `policy_assignment_jobs` (mọi job của group này,
   kể cả những job vừa được set `failed` ở bước 1, và mọi job `done`/`failed`
   cũ hơn) — `group_id → NULL`.
5. `DELETE FROM groups WHERE id = ?`.

Thứ tự (2)/(3) hoán đổi được, không ảnh hưởng gì (2 bảng độc lập, không FK
chéo nhau) — đúng A19 "không phụ thuộc thứ tự xóa `group_memberships`/
`policy_assignments` trước hay sau". Thứ tự (1) **phải** trước (4) — đã giải
thích ở §1c. Device và Policy không bị đụng ở bất kỳ bước nào (A18).

## 4. Rủi ro / open question

### 4a. Điểm đã tự sửa so với chỉ dẫn đầu vào (cần người duyệt xác nhận)

- **`Group has_many :policy_assignment_jobs` dùng `dependent: :nullify`,
  không phải `:delete_all` như chỉ dẫn ban đầu của bước `/design` này** —
  lý do đầy đủ ở §1c, tóm tắt: `:delete_all` sẽ xóa mất chính dòng
  `policy_assignment_job` mà SoT Scenario "Job... bị xóa giữa lúc đang chạy
  chuyển sang failed" (A10/A19) yêu cầu phải **còn tồn tại và đọc được với
  `status: failed`** sau khi Group bị xóa. Đây là mâu thuẫn giữa 1 câu chữ
  chỉ dẫn kỹ thuật và 1 acceptance criterion đã approve trong SoT — theo
  đúng nguyên tắc `CLAUDE.md` §5 ("mâu thuẫn → dừng lại, báo cáo, không tự
  chọn"), đã chọn hướng giữ đúng SoT (nguồn quyết định nghiệp vụ) và ghi rõ
  lý do thay vì âm thầm làm theo câu chữ chỉ dẫn kỹ thuật. Nếu người duyệt
  có ý định khác cho hành vi này (vd chấp nhận xóa sạch lịch sử job khi xóa
  Group, đổi luôn Scenario tương ứng ở SoT), cần sửa lại cả SoT §11 trước.

### 4b. Open question cần người duyệt xác nhận

| # | Câu hỏi | Đề xuất | Ảnh hưởng nếu không chốt |
|---|---|---|---|
| OQ-DB-1 | Dưới Phương án A, `policy_assignments` write cho nhánh Group luôn là 1 dòng — vậy `processed_count` trên `policy_assignment_jobs` có ý nghĩa gì thực sự? (xem §3.3/§3.4b) | **Cosmetic, không phải bộ đếm tăng dần**: `processed_count` giữ `0` suốt `pending`/`running`, nhảy thẳng lên bằng `total_count` khi `done` (code mẫu §3.4b). Banner FE "Đang gán cho N thiết bị..." dùng `total_count` (biết ngay lúc enqueue) làm N hiển thị trong lúc `pending`/`running`, không cần đọc `processed_count` tăng dần theo thời gian thực (vì nó không tăng dần) | **Chốt theo đề xuất.** `processed_count` cosmetic (0 → total_count khi done), không cần progress bar % thời gian thực dưới Phương án A. |
| OQ-DB-2 | Dedupe OQ-5 (không tạo 2 job cho cùng `(policy_id, group_id)` đang `pending`/`running`) hiện chỉ được enforce ở **service layer** (`PolicyAssignmentJob.where(policy_id:, group_id:, status: [:pending, :running]).first` trước khi `create!`) — có cần thêm 1 **partial unique index** DB-level (`(policy_id, group_id) WHERE status IN (0, 1)`) để chặn race 2 request tạo job gần như đồng thời không? | **Không cần** — khác trường hợp §1a (CHECK constraint), ở đây nếu race xảy ra và tạo ra 2 job trùng, hậu quả chỉ là 2 job cùng chạy `upsert_all` **cùng 1 dòng, cùng `on_duplicate: :skip`** — vô hại, đúng class rủi ro "chấp nhận được" mà SoT A12 đã mô tả cho chính race condition này ("cả 2 job đều `upsert_all` an toàn... không tạo 2 dòng trùng"). Thêm unique index sẽ buộc service layer phải `rescue RecordNotUnique` rồi tự query lại job đã có — phức tạp hơn cho 1 rủi ro không gây sai dữ liệu, chỉ lãng phí 1 job chạy dư (rẻ, vì mỗi job chỉ làm đúng 1 `upsert_all`) | **Chốt theo đề xuất.** Không thêm partial unique index DB-level cho dedupe; service-layer check là đủ, race vô hại nhờ idempotent. |

**Đã xác nhận (2026-09-17, qua Claude Code, theo ủy quyền của user):** đồng ý
với lựa chọn `dependent: :nullify` ở §4a (giữ đúng SoT A10/A19, không xóa
lịch sử job khi xóa Group) — không sửa SoT. 2 OQ ở §4b đã chốt theo đề xuất.
`status` ở đầu file đã set `approved`. Cho phép tiến hành `/design F8-api`.

### 4c. Rủi ro đã biết, đã chấp nhận (không cần quyết định, chỉ để không bị coi là bug)

- **Không có cột `source`/`status` riêng trên `policy_assignments`** — đã
  giải thích ở §1 (bảng)/SoT §12 "Rủi ro/giả định". Nếu F9 sau này thấy cần
  phân biệt tường minh "gán qua Group nào" (không chỉ biết "có gán qua ít
  nhất 1 group"), đó là mở rộng của F9, không phải thiếu sót của F8.
- **CHECK constraint không có message field-level thân thiện** nếu bị vi
  phạm qua path `upsert_all` (không đi qua model validate) — nhưng path
  `upsert_all` của F8 luôn tự tay build đúng `rows` (chỉ 1 trong 2 khóa
  được set), nên trên thực tế constraint này chỉ có tác dụng "bắt bug lúc
  code sai", không phải "validate input user" — không cần API layer rescue
  đẹp cho case này giống cách rescue `RecordNotUnique`→422 cho `name`/
  `identifier` (SoT/`CLAUDE.md` không yêu cầu 1 message UX riêng cho vi
  phạm invariant nội bộ này).
- **`policy_assignment_jobs` không giới hạn tối đa 1 job `pending`/`running`
  đồng thời ở DB layer** — xem OQ-DB-2, rủi ro đã chấp nhận, không phải bug.
- **`Group.find(job.group_id)` trong job (code mẫu §3.4b) raise
  `RecordNotFound` nếu `group_id` đã là `nil`** (trường hợp Group bị xóa
  *trước khi* job kịp chạy `running`, `before_destroy` đã set job `failed`
  và `dependent: :nullify` đã xóa `group_id`) — job vẫn chạy được (Solid
  Queue không tự hủy job đã enqueue), method `perform` guard bằng `return
  unless job.pending? || job.running?` ở đầu **sẽ chặn từ trước** (job đã
  `failed` từ bước `before_destroy`, không còn `pending`/`running` nữa khi
  worker tới lượt) — không thực sự chạm tới dòng `Group.find` trong trường
  hợp này. `rescue ActiveRecord::RecordNotFound` vẫn giữ lại để phòng trường
  hợp Group bị xóa **đúng lúc** worker đang giữa 2 dòng code (giữa lúc set
  `running` và lúc gọi `Group.find`) — khoảng hở cực nhỏ nhưng có thật, và
  code đã xử lý đúng (raise → rescue → `failed`).
- **Không thêm index `(policy_id)` đơn/không-partial** cho `policy_assignments`
  — đã giải thích ở §3.1 (2 unique partial index + composite org+policy đã
  phủ đủ mọi truy vấn cần thiết của F8 qua leftmost-prefix, thêm 1 index nữa
  chỉ tốn write overhead không cần thiết).
- **Solid Queue chung 1 database với app** (§2.1 mục 5) — rủi ro vận hành đã
  chấp nhận cho phạm vi bài test, không phải quyết định nghiệp vụ; nếu job
  volume thật tăng cao trong tương lai, cấu hình lại `connects_to` là 1
  thay đổi hạ tầng độc lập, không đụng schema `policy_assignments`/
  `policy_assignment_jobs`.

### 4d. Xác nhận Organization isolation ở tầng DB (không đủ, cần API layer bổ sung)

Giống mọi bảng trước (`docs/design/F7-db.md` §4d) — FK `organization_id`
`NOT NULL` trên cả `policy_assignments` và `policy_assignment_jobs` đảm bảo
không có dòng "mồ côi" org, nhưng **không tự nó** tạo hành vi 404 khi org A
đoán id thuộc org B. Nghĩa vụ đó nằm ở API layer: mọi action phải lấy cả
**2 phía** (Policy **và** Group/Device đích) qua
`current_organization.policies`/`.groups`/`.devices`, và mọi action liên
quan tới `policy_assignment_jobs` phải qua
`current_organization.policy_assignment_jobs.find(...)` — không bao giờ
`PolicyAssignment.find`/`PolicyAssignmentJob.find`/`Model.find` trần. **Cờ
cho `/design F8-api`**: SoT A1-A4, A15 yêu cầu 404 (không 403) trên **cả 2
phía độc lập** — API design không được bỏ sót việc check org-scope riêng
cho Policy và riêng cho Group/Device trong cùng 1 action (2 lần
`current_organization.<assoc>.find`, không phải 1 lần rồi suy diễn).
