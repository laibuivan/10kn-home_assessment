---
feature_id: F8
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-17
---

# Thiết kế API — F8

Nguồn: `docs/design/F8-db.md` (approved — bảng `policy_assignments` 2 FK
riêng `group_id`/`device_id` nullable + CHECK constraint + 2 unique partial
index tên tường minh `index_policy_assignments_on_policy_and_group`/
`..._and_device`; bảng `policy_assignment_jobs` với `group_id` **nullable**
+ `dependent: :nullify` + `before_destroy` callback trên `Group`; enum
`status: pending/running/done/failed`; `processed_count` cosmetic 0→
`total_count` khi `done`; `upsert_all unique_by: <tên index Symbol>,
on_duplicate: :skip`; job class `GroupPolicyAssignmentJob#perform(job_id)`),
`docs/sot/F8-policy-assignment.md` (approved — §3 endpoint dự kiến, §4 main
flow A–F, §5.2 A1–A32, §6 business rule, §9 RBAC, §12 12 OQ đã chốt theo
khuyến nghị), `docs/design/F7-api.md` (approved — `PoliciesController`
hiện có 3 action `index/create/update`, không có `show`/`destroy`, §2.5
"404 qua routing" — **F8 mở lại route `show`, phần này hết hiệu lực**,
`STATUS_ENUM_ERROR`/`invalid_status?` cục bộ, `serialize_policy` 7 field),
`docs/design/F6-api.md` (approved — `GroupDevicesController` là pattern gần
nhất cho 1 controller con của Group thao tác hàng loạt + đồng bộ, concern
`DeviceSerializable`/`DeviceFilterable`/`Paginatable`, quy ước "gỡ luôn 404
khi liên kết không tồn tại"), `docs/design/F0-api.md` (envelope lỗi toàn
cục, `Authenticatable`), `UI_UX_design.md` §6.2/§6.3/§7.1/§7.2 (field FE cần
để vẽ banner + 2 tab Policy Detail), `CLAUDE.md` §4, code hiện có
`api/app/controllers/application_controller.rb`,
`api/app/controllers/concerns/{authenticatable,paginatable,device_serializable,device_filterable}.rb`,
`api/app/controllers/api/v1/{policies_controller,groups_controller,group_devices_controller,devices_controller}.rb`,
`api/app/policies/{application_policy,policy_policy,group_policy,device_policy}.rb`,
`api/config/routes.rb`, `api/app/models/{policy,group,device}.rb`.

**Kết luận đầu tiên:** F8 cần **5 controller mới**
(`Api::V1::GroupPolicyAssignmentsController`,
`Api::V1::GroupPolicyAssignmentJobsController`,
`Api::V1::PolicyDeviceAssignmentsController`,
`Api::V1::PolicyGroupAssignmentsController`,
`Api::V1::PolicyAssignmentJobsController`), **mở rộng 1 controller đã
approve** (`PoliciesController` — thêm `show` + `assignments_count` ở
`index`), **mở rộng 2 Pundit policy đã approve** (`GroupPolicy`,
`PolicyPolicy`), **1 Pundit policy mới** (`PolicyAssignmentJobPolicy`), và
**1 concern mới** (`PolicyAssignmentJobSerializable` — dùng ngay từ đầu ở 3
call site: `create` của `GroupPolicyAssignmentsController`, `index` của
`GroupPolicyAssignmentJobsController`, `show` của
`PolicyAssignmentJobsController` — không có giai đoạn "copy trước, tách
sau" như F5/F6 vì cả 3 nơi cần cùng lúc). Không có Pundit policy riêng cho
`PolicyAssignment` (join model) — mọi action ghi/gỡ join row đi qua
`authorize <Group hoặc Policy>, :<action>?`, đúng pattern F6 đã dùng cho
`GroupMembership` (không có `GroupMembershipPolicy`).

## 0. Quy ước kế thừa từ F0/F2/F3/F5/F6/F7 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần, body phẳng (không
  bọc `policy_assignment:`/`device_assignment:` khi gửi).
- **422** (field-level): `{ "errors": { "<field>": ["<message>"] } }` qua
  `render_validation_errors` đã có. Key `base` dùng cho lỗi nghiệp vụ không
  gắn với field cụ thể trên request body — **quyết định field cho 2 lỗi mới
  của F8** (xem §2.8):
  - "Policy không active" → `base` (không phải `policy_id`) — đúng tinh
    thần F6 dùng `base` cho "retired bất biến" (lỗi về **trạng thái của
    record được tham chiếu**, không phải lỗi format của chính field
    `policy_id`/`device_id`/`group_id` trên request).
  - "Device retired, không gán trực tiếp được" → `base`, cùng lý do.
- **401 / 404**: `{ "error": "<message>" }` — tái dùng nguyên
  `Authenticatable` và `rescue_from ActiveRecord::RecordNotFound` toàn cục.
  **Không thêm `rescue_from` mới cho 404** ở bất kỳ controller F8 nào.
- **Response thành công bọc key resource** — `{ "policy_assignment_job":
  {...} }`, `{ "policy": {...} }`, `{ "device": {...} }`, `{ "policies":
  [...], "meta": {...} }` — đúng khuôn đã có. **Không** dùng shape phẳng
  kiểu `{ job_id, status }` như ví dụ minh họa (`vd`) ở `UI_UX_design.md`
  §6.3 bước 2 — xem §4.1 giải thích rõ đây là ví dụ minh họa UX, không phải
  hợp đồng field cứng (cùng tinh thần SoT OQ-1 đã xử lý cho tên trạng thái
  `queued`/`completed`).
- **`meta` shape**: `{ current_page, per_page, total_count, total_pages }` —
  tái dùng `Paginatable`, lần thứ 4 (Device, Group, Policy, nay các list
  con của F8).
- **Pundit**: `authorize` + `policy_scope` bắt buộc mọi action. Deny-by-
  default ở `ApplicationPolicy`.
- **Không có nhánh 403 nào trong F8** — mọi vi phạm ranh giới org là 404
  (`CLAUDE.md` §4), kể cả khi action đụng 2 resource (Policy **và**
  Group/Device) — 2 lần `policy_scope(...).find` **độc lập**, không suy diễn
  từ 1 lần tìm.

## 1. Endpoint

| Method | Path | Input | Output | Org-scope |
|---|---|---|---|---|
| `GET` | `/api/v1/policies` | Query: `q`, `status`, `page`/`per_page` (không đổi từ F7) | `200: { "policies": [{ ...7 field F7, "assignments_count": Int }], "meta": {...} }` | `policy_scope(Policy)` — không đổi |
| `GET` | `/api/v1/policies/:id` | — (**endpoint mới**, F7 OQ-7) | `200: { "policy": { ...7 field F7, "assignments_count": Int } }` / `404` | `policy_scope(Policy).find(params[:id])` |
| `GET` | `/api/v1/groups/:id/policy_assignments` | Query: `page`/`per_page` | `200: { "policies": [{ id, name, type, status }], "meta": {...} }` / `404` (group sai org) / `422` (phân trang) | `policy_scope(Group).find(params[:id])`, sau đó join `policy_assignments` |
| `POST` | `/api/v1/groups/:id/policy_assignments` | Body phẳng: `policy_id` (bắt buộc) | `202: { "policy_assignment_job": {...} }` / `404` (group hoặc policy sai org, 2 check độc lập) / `422` (`base`: policy inactive) | `policy_scope(Group).find` **và** `policy_scope(Policy).find` — 2 lần độc lập |
| `DELETE` | `/api/v1/groups/:id/policy_assignments/:policy_id` | — | `204` / `404` (group sai org, policy sai org, **hoặc** liên kết không tồn tại — 3 nhánh 404 độc lập) | `policy_scope(Group).find` **và** `policy_scope(Policy).find`, rồi tìm join row |
| `GET` | `/api/v1/groups/:id/policy_assignment_jobs` | Query: `status` (optional, list phân tách dấu phẩy trong `pending/running/done/failed`), `page`/`per_page` | `200: { "policy_assignment_jobs": [...], "meta": {...} }` / `404` (group sai org) / `422` (`status` sai giá trị, hoặc phân trang) | `policy_scope(Group).find(params[:id])`, sau đó `group.policy_assignment_jobs` |
| `GET` | `/api/v1/policy_assignment_jobs/:id` | — | `200: { "policy_assignment_job": {...} }` / `404` | `current_organization.policy_assignment_jobs.find(params[:id])` |
| `GET` | `/api/v1/policies/:id/device_assignments` | Query: `page`/`per_page` | `200: { "devices": [...7 field DeviceSerializable...], "meta": {...} }` / `404` (policy sai org) / `422` (phân trang) | `policy_scope(Policy).find(params[:id])`, sau đó join `policy_assignments` |
| `POST` | `/api/v1/policies/:id/device_assignments` | Body phẳng: `device_id` (bắt buộc) | `201: { "device": {...} }` / `404` (policy hoặc device sai org, 2 check độc lập) / `422` (`base`: policy inactive **hoặc** device retired) | `policy_scope(Policy).find` **và** `policy_scope(Device).find` — 2 lần độc lập |
| `DELETE` | `/api/v1/policies/:id/device_assignments/:device_id` | — | `204` / `404` (policy sai org, device sai org, **hoặc** liên kết không tồn tại) | `policy_scope(Policy).find` **và** `policy_scope(Device).find`, rồi tìm join row |
| `GET` | `/api/v1/policies/:id/group_assignments` | Query: `page`/`per_page` | `200: { "groups": [{ id, name }], "meta": {...} }` / `404` (policy sai org) / `422` (phân trang) | `policy_scope(Policy).find(params[:id])`, sau đó join `policy_assignments` |

Toàn bộ endpoint mới đều `authenticate_request!` trước (401 nếu thiếu/sai
token — A29), và **không** có endpoint nào ở Device Detail (OQ-11).

### Route

Thêm vào `api/config/routes.rb`, trong `namespace :api` → `namespace :v1`:

```ruby
resources :devices, only: [ :index, :show, :create, :update ]

resources :groups, only: [ :index, :show, :create, :update, :destroy ] do
  member do
    get "devices", to: "group_devices#index"
    post "devices", to: "group_devices#create"
    delete "devices/:device_id", to: "group_devices#destroy"

    # F8 — docs/design/F8-api.md §1.
    get "policy_assignments", to: "group_policy_assignments#index"
    post "policy_assignments", to: "group_policy_assignments#create"
    delete "policy_assignments/:policy_id", to: "group_policy_assignments#destroy"
    get "policy_assignment_jobs", to: "group_policy_assignment_jobs#index"
  end
end

# `:show` MỞ LẠI ở đây (F7 OQ-7 chốt không có, F8 SoT §3 chốt có) — toàn
# bộ phân tích "404 qua routing" ở docs/design/F7-api.md §2.5 hết hiệu lực
# từ đây, thay bằng 404 qua policy_scope(Policy).find như mọi action khác.
resources :policies, only: [ :index, :show, :create, :update ] do
  member do
    get "device_assignments", to: "policy_device_assignments#index"
    post "device_assignments", to: "policy_device_assignments#create"
    delete "device_assignments/:device_id", to: "policy_device_assignments#destroy"
    get "group_assignments", to: "policy_group_assignments#index"
  end
end

# Đứng độc lập — không nested dưới /groups hay /policies (SoT §3: poll bằng
# chính job_id, không cần biết trước group/policy nào).
resources :policy_assignment_jobs, only: [ :show ]
```

`member do ... end` (không `resources ... do` lồng) — giữ nguyên đúng lý do
đã ghi ở `docs/design/F6-api.md` §1: `params[:id]` luôn là Group/Policy,
không đổi tên thành `:group_id`/`:policy_id`, khớp path SoT §3/§8 nguyên
văn.

### Pundit — mở rộng `GroupPolicy`

```ruby
class GroupPolicy < ApplicationPolicy
  # ... index?/show?/create?/update?/destroy?/add_devices?/remove_device? giữ nguyên (F5/F6)

  # F8 — GET/POST /groups/:id/policy_assignments, GET /groups/:id/policy_assignment_jobs
  # đều đọc/viết TRÊN CHÍNH group đó, dùng lại show? cho 2 action đọc
  # (list policy đang gán, list job) — không khai báo add_policy_assignments?/
  # list_jobs? riêng vì đều là "xem 1 group", đúng tinh thần show? đã dùng
  # cho GroupDevicesController#index (docs/design/F6-api.md §1).
  def assign_policy?
    true
  end

  def unassign_policy?
    true
  end
end
```

`GroupPolicy#show?` (đã có từ F6) được **tái dùng nguyên**, gọi tường minh ở
2 nơi mới: `authorize group, :show?` trong
`GroupPolicyAssignmentsController#index` và
`GroupPolicyAssignmentJobsController#index` — lý do giống hệt lý do F6 đã
ghi (action `index` của 2 controller này trùng tên với `index?` mang nghĩa
khác — "list mọi group" — nên **không** dựa vào default suy từ
`action_name`).

### Pundit — mở rộng `PolicyPolicy`

```ruby
class PolicyPolicy < ApplicationPolicy
  # ... index?/create?/update? giữ nguyên (F7)

  # F8 — GET /policies/:id (F7 OQ-7 mở lại), và tái dùng cho 2 action đọc
  # mới (list device đang gán, list group đang gán) — cùng lý do GroupPolicy
  # ở trên.
  def show?
    true
  end

  def assign_device?
    true
  end

  def unassign_device?
    true
  end
end
```

### Pundit — mới `PolicyAssignmentJobPolicy`

```ruby
# Authorization cho PolicyAssignmentJob (docs/design/F8-api.md §1) — resource
# độc lập duy nhất của F8 có route top-level riêng (GET /policy_assignment_jobs/:id),
# nên cần Scope#resolve của chính nó, khác PolicyAssignment (không có Pundit
# policy riêng — mọi hành động ghi/gỡ join row luôn authorize qua Group/Policy
# cha, đúng pattern GroupMembership của F6, không phải "quên").
class PolicyAssignmentJobPolicy < ApplicationPolicy
  def show?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.organization.policy_assignment_jobs
    end
  end
end
```

Không phân role (SoT §9) — `show?` luôn `true`, ranh giới thật ở `Scope`.

## 2. Business logic từng endpoint

### 2.1 `GET /api/v1/policies` (mở rộng — thêm `assignments_count`)

Không đổi bất kỳ bước nào của F7 §2.1 — chèn đúng 1 bước trước khi render:

```ruby
records = scope.offset((page - 1) * per_page).limit(per_page)

# 1 câu GROUP BY cho cả trang, không phải 1 COUNT/record trong vòng lặp
# (SoT §10, F8-db.md §3.1 index (organization_id, policy_id) phục vụ đúng
# câu này). Policy không ở trong bảng không xuất hiện trong hash →
# fetch(id, 0) trả đúng 0 (A32).
assignments_counts = PolicyAssignment
  .where(organization_id: current_organization.id, policy_id: records.map(&:id))
  .group(:policy_id).count

render json: {
  policies: records.map { |p| serialize_policy(p, assignments_count: assignments_counts.fetch(p.id, 0)) },
  meta: { ... }
}
```

`assignments_count` đếm **số dòng `policy_assignments`** (Group + Device
trực tiếp), không phải "số device chịu ảnh hưởng" — đúng A23 (2 dòng riêng
biệt cho 1 policy vừa gán 1 group vừa gán trực tiếp 1 device thuộc group đó
= đếm 2, không gộp). `WHERE organization_id = ?` dùng đúng cột trực tiếp
trên `policy_assignments` (không join qua `policy_id`), khớp lý do bảng đó
có `organization_id` riêng (F8-db.md §1 dòng đầu).

### 2.2 `GET /api/v1/policies/:id` (mới — F7 OQ-7)

```ruby
def show
  policy = policy_scope(Policy).find(params[:id])
  authorize policy

  render json: { policy: serialize_policy(policy) } # assignments_count mặc định = 1 COUNT cho record này
end
```

- `policy_scope(Policy).find` → 404 org khác/không tồn tại/sai định dạng
  (A27, tương đương A1–A3 của F7 nhưng giờ đi qua controller thật, không
  còn "404 qua routing" như F7 §2.5 nữa).
- `serialize_policy(policy)` không truyền `assignments_count:` →
  default-argument evaluate `policy.policy_assignments.count` — 1 record,
  1 `COUNT`, không phải N+1 (đúng nguyên lý default-arg đã dùng ở
  `serialize_group`/`serialize_policy`).

### 2.3 Serializer `serialize_policy` (mở rộng)

```ruby
def serialize_policy(policy, assignments_count: policy.policy_assignments.count)
  {
    id: policy.id,
    name: policy.name,
    type: policy.type,
    configuration: policy.configuration,
    status: policy.status,
    assignments_count: assignments_count,
    created_at: policy.created_at,
    updated_at: policy.updated_at
  }
end
```

`create`/`update` (F7, không đổi logic) tiếp tục gọi
`serialize_policy(policy)` không truyền `assignments_count:` — 1 policy mới
tạo luôn có `assignments_count: 0` qua đúng 1 `COUNT` phụ (chi phí không
đáng kể, tương tự F6 đã chấp nhận cho `devices_count` ở `create`/`update`
Group).

### 2.4 `GET /api/v1/groups/:id/policy_assignments` (`GroupPolicyAssignmentsController#index`)

1. `group = policy_scope(Group).find(params[:id])` → 404 (tương đương A1
   của F6, áp cho nhánh mới).
2. `authorize group, :show?`.
3. `pagination_errors` → 422.
4. Build scope + render:
   ```ruby
   scope = Policy.joins(:policy_assignments)
                 .where(policy_assignments: { group_id: group.id })
                 .merge(current_organization.policies) # lớp phòng thủ thứ 2 — org-scope Policy tại thời điểm đọc, không chỉ tại thời điểm gán (cùng tinh thần .merge ở F6 §2.2)
                 .order("policy_assignments.created_at DESC, policy_assignments.id DESC")
   total_count = scope.count
   records = scope.offset(...).limit(...)

   render json: {
     policies: records.map { |p| { id: p.id, name: p.name, type: p.type, status: p.status } },
     meta: { ... }
   }
   ```
   - Field đúng SoT §3: `name/type/status` — không `configuration` (tránh
     đổ jsonb đầy vào 1 list tab phụ), không `assignments_count` (không có
     ý nghĩa ở context này).
   - Sắp theo `policy_assignments.created_at DESC` (thời điểm **gán**, mới
     nhất trước) — khác `policy.created_at` (thời điểm tạo Policy), quyết
     định hợp lý cho 1 tab "vừa gán gì gần đây" (không có acceptance
     scenario chỉ định thứ tự — ghi ở §5 để người duyệt xác nhận nếu muốn
     khác).
   - **Quyết định có phân trang**: **Có**, dùng `Paginatable` như mọi list
     khác trong app, dù F7 SoT §10 nhận định số Policy/org thường nhỏ
     ("hàng chục"). Lý do: (a) nhất quán tuyệt đối — mọi list endpoint từ
     F2 đã có `meta` shape cố định, thêm 1 ngoại lệ "không phân trang" chỉ
     vì "chắc sẽ nhỏ" là giả định về dữ liệu, không phải giả định về API
     contract; (b) chi phí thêm gần như 0 (`Paginatable` đã có sẵn, tái
     dùng nguyên); (c) phòng trường hợp 1 Group được gán rất nhiều Policy
     (không có giới hạn cứng nào chặn số Policy 1 Group được gán).

### 2.5 `POST /api/v1/groups/:id/policy_assignments` (`GroupPolicyAssignmentsController#create`)

```ruby
def create
  group = policy_scope(Group).find(params[:id])   # 404 độc lập #1 (A1)
  authorize group, :assign_policy?

  policy = policy_scope(Policy).find(params[:policy_id])  # 404 độc lập #2 (A2)
  return render_validation_errors(base: [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ]) unless policy.active?  # A5, A26

  job = find_or_create_policy_assignment_job(group, policy)
  render json: { policy_assignment_job: serialize_policy_assignment_job(job) }, status: :accepted
end

private

# OQ-5 (dedupe): job pending/running hiện có cho ĐÚNG cặp (policy_id,
# group_id) → trả lại job đó, KHÔNG tạo job mới (A12). Check-rồi-tạo có 1
# khoảng hở race lý thuyết (2 request gần như đồng thời có thể tạo 2 job) —
# chấp nhận đúng như OQ-DB-2 đã phân tích: hậu quả chỉ là 1 job chạy dư,
# upsert_all vẫn idempotent, không sai dữ liệu.
def find_or_create_policy_assignment_job(group, policy)
  existing = current_organization.policy_assignment_jobs
    .where(policy_id: policy.id, group_id: group.id, status: %i[pending running])
    .order(:id).first
  return existing if existing

  # 1 transaction cho create! + perform_later — docs/design/F8-db.md §3.4a:
  # cả hai là INSERT trên cùng database, phải cùng thành công hoặc cùng
  # rollback, tránh 1 job row "mồ côi" mãi ở pending không ai enqueue.
  ActiveRecord::Base.transaction do
    job = current_organization.policy_assignment_jobs.create!(
      policy_id: policy.id,
      group_id: group.id,
      status: :pending,
      total_count: group.devices.count,
      processed_count: 0
    )
    GroupPolicyAssignmentJob.perform_later(job.id)
    job
  end
end
```

- **Status code: `202 Accepted`** (không phải `201 Created`) — quyết định
  cần chốt rõ (SoT §3 để ngỏ "202 hoặc 201, xem `/design`"). Lý do chọn
  202: response này **không** trả về "resource đã tạo xong" theo nghĩa
  `201` thường ngụ ý (`201` đúng chuẩn HTTP đi kèm 1 resource đã **tồn
  tại đầy đủ** ngay khi response trả về, ví dụ `POST /policies` → policy
  đã lưu xong). Ở đây, request được **chấp nhận để xử lý bất đồng bộ**
  (`policy_assignments` — cái người dùng thực sự muốn tạo — **chưa** tồn
  tại tại thời điểm response trả về, có thể mất vài giây tới xong với
  Group 10.000 device) — đúng nghĩa `202 Accepted`: "đã nhận, sẽ xử lý,
  chưa xong". `job` (bản ghi theo dõi) thì đúng là đã tạo, nhưng đó không
  phải resource chính mà client quan tâm ("tôi vừa gán Policy cho Group"),
  chỉ là handle để poll. Trường hợp dedupe (job đã có từ trước) **cũng trả
  202** (không phải `200`) — nhất quán: dù job cũ hay mới, ngữ nghĩa với
  client luôn là "yêu cầu gán của bạn đã/đang được chấp nhận xử lý", không
  cần phân biệt 2 status code chỉ để lộ chi tiết "job này có phải request
  vừa tạo hay không" — client có thể tự biết qua so sánh `job.id`/
  `created_at` nếu cần.
- **Body: bọc `policy_assignment_job`, không dùng shape phẳng
  `{job_id, status}`** như câu chữ minh họa (`vd`) ở `UI_UX_design.md`
  §6.3 bước 2 — xem §4.1.
- Đúng thứ tự SoT §4-A bước 3 ("org-scope 2 phía → validate active → …
  enqueue"): tìm Group (1) → authorize → tìm Policy (2) → check active →
  dedupe/tạo.
- `policy_id` thiếu/blank ở body → `find(nil)`/`find("")` raise
  `RecordNotFound` → 404 (không có acceptance scenario ép kiểu lỗi khác;
  ghi rõ ở §5 để không bị hiểu nhầm là bug).

### 2.6 `DELETE /api/v1/groups/:id/policy_assignments/:policy_id` (`GroupPolicyAssignmentsController#destroy`)

```ruby
def destroy
  group = policy_scope(Group).find(params[:id])       # 404 độc lập #1
  authorize group, :unassign_policy?

  policy = policy_scope(Policy).find(params[:policy_id])  # 404 độc lập #2
  assignment = group.policy_assignments.find_by(policy_id: policy.id)
  return render_not_found if assignment.nil?  # OQ-4 — liên kết không tồn tại → 404, không 204

  deleted_count = PolicyAssignment.where(id: assignment.id).delete_all
  return render_not_found if deleted_count.zero?  # race: 2 request gỡ cùng lúc, giống F6 A16
  head :no_content
end
```

- **3 nhánh 404 độc lập**: Group sai org, Policy sai org, **và** liên kết
  không tồn tại (dù cả Group/Policy đều hợp lệ) — đều cùng envelope
  `{ "error": "Not found" }`, client không phân biệt được (đúng
  `CLAUDE.md` §4, không lộ "org kia có Policy tên gì" qua cách phân biệt
  lỗi).
- **Không check `policy.active?`** — gỡ không bị chặn bởi trạng thái
  Policy (SoT §6 chỉ chặn **gán** Policy inactive, không chặn gỡ; xem A9
  nhánh "liên kết không tồn tại" — không có nhánh nào yêu cầu chặn gỡ
  policy inactive).
- **1 dòng `DELETE`, không phụ thuộc số device trong Group** — đúng OQ-8 (đồng
  bộ, không job) vì Phương án A (OQ-2) làm assignment Group↔Policy luôn là 1
  dòng.
- `delete_all` trên `id` cụ thể (không `assignment.destroy!`) — cùng lý do
  F6 §2.4 bước 6: biết chính xác số dòng bị xóa để phân xử race 2 request
  gỡ cùng lúc, giữ đúng "chỉ 1 request thành công".

### 2.7 `GET /api/v1/groups/:id/policy_assignment_jobs` (`GroupPolicyAssignmentJobsController#index`)

```ruby
def index
  group = policy_scope(Group).find(params[:id])
  authorize group, :show?

  errors = pagination_errors
  errors[:status] = [ STATUS_LIST_ENUM_ERROR ] if invalid_job_statuses?(params[:status])
  return render_validation_errors(errors) if errors.any?

  scope = group.policy_assignment_jobs.merge(current_organization.policy_assignment_jobs)
  scope = scope.where(status: parsed_job_statuses(params[:status])) if params[:status].present?
  scope = scope.order(created_at: :desc, id: :desc)

  total_count = scope.count
  records = scope.offset(...).limit(...)

  render json: {
    policy_assignment_jobs: records.map { |job| serialize_policy_assignment_job(job) },
    meta: { ... }
  }
end

private

# "pending,running" → ["pending", "running"]; "" hoặc absent → [] (coi như
# không filter — cùng convention "blank = no filter" của mọi filter khác
# trong app, không phải lỗi).
def parsed_job_statuses(raw)
  raw.to_s.split(",").map(&:strip).reject(&:blank?)
end

# Guard TRƯỚC khi chạm `.where(status: ...)` — 1 giá trị ngoài enum trong
# list sẽ raise ArgumentError (500) nếu không chặn, đúng lý do đã lặp lại ở
# F7 §2.6/§2.1 cho field status đơn — ở đây filter là 1 MẢNG nên guard lặp
# qua từng phần tử.
def invalid_job_statuses?(raw)
  parsed_job_statuses(raw).any? { |v| !v.in?(PolicyAssignmentJob.statuses.keys) }
end
```

- `STATUS_LIST_ENUM_ERROR = "is not included in the list".freeze` — định
  nghĩa **cục bộ** trong controller này (không tái dùng
  `PoliciesController::STATUS_ENUM_ERROR`, cùng lý do F7 §2.6 đã nêu cho
  việc không mở rộng `DeviceFilterable`: 1 nơi dùng, tách concern không có
  lợi ích tương xứng).
- `.merge(current_organization.policy_assignment_jobs)` — lớp phòng thủ
  thêm dù `group.policy_assignment_jobs` đã tự org-đúng qua FK
  `organization_id` (đúng tinh thần `CLAUDE.md` §4 "luôn qua
  `current_organization.<assoc>`", không dựa write-time invariant làm đủ —
  cùng lý do `.merge` đã dùng ở F6 §2.2/§2.6).
- **A17 (SoT)**: `status` absent/blank → `200`, không filter, trả toàn bộ
  lịch sử job của group (phân trang). Group không có job nào → `200`, mảng
  rỗng (không lỗi).
- **Quyết định có phân trang cho endpoint này** (không có trong SoT §3
  nguyên văn, nhưng SoT §10 tự flag "index `[group_id, status]` để tránh
  scan toàn bảng job khi 1 group có lịch sử nhiều job" — hàm ý số dòng có
  thể tăng theo thời gian dù mỗi lúc chỉ ≤1 job `pending`/`running` do
  dedupe OQ-5): **có**, `Paginatable` mặc định 20/trang, cùng lý do nhất
  quán đã nêu ở §2.4.

### 2.8 `GET /api/v1/policy_assignment_jobs/:id` (`PolicyAssignmentJobsController#show`)

```ruby
def show
  job = current_organization.policy_assignment_jobs.find(params[:id])
  authorize job

  render json: { policy_assignment_job: serialize_policy_assignment_job(job) }
end
```

- `current_organization.policy_assignment_jobs.find` → 404 org khác/không
  tồn tại/sai định dạng (A15, A16, A27).
- **Không rẽ nhánh gì cho Group đã bị xóa** — `serialize_policy_assignment_job`
  (§2.9) tự xử lý `job.group.nil?`, response vẫn `200` với `status: "failed"`,
  `group: null` (đúng yêu cầu `docs/design/F8-db.md` §1c "hệ quả cần API
  biết" — job **vẫn tồn tại**, chỉ mất tham chiếu Group, không phải 404).

### 2.9 `PolicyAssignmentJobSerializable` (concern mới)

Dùng ở cả 3 nơi cần serialize job (§2.5, §2.7, §2.8) — tách ngay từ đầu vì cả
3 controller cần cùng lúc, không có "controller đầu tiên rồi copy" như
`DeviceSerializable` từng trải qua ở F2→F6 (đúng lý do đã ghi ở
`docs/design/F5-api.md`/`F6-api.md` §5 OQ-API-1 cho việc tách concern ngay
khi ≥2 nơi cần).

```ruby
# app/controllers/concerns/policy_assignment_job_serializable.rb
module PolicyAssignmentJobSerializable
  extend ActiveSupport::Concern

  private

  # `group:` PHẢI xử lý nil — sau khi Group bị xóa, before_destroy callback
  # (docs/design/F8-db.md §1c) chuyển job pending/running sang failed rồi
  # dependent: :nullify set group_id = NULL, nhưng dòng job vẫn tồn tại và
  # phải đọc được qua GET /policy_assignment_jobs/:id (200, không 404).
  # `job.group` gọi qua association `belongs_to :group, optional: true` —
  # trả nil an toàn khi group_id là NULL, KHÔNG raise.
  def serialize_policy_assignment_job(job)
    {
      id: job.id,
      status: job.status,
      total_count: job.total_count,
      processed_count: job.processed_count,
      error_message: job.error_message,
      policy: { id: job.policy.id, name: job.policy.name },
      group: job.group ? { id: job.group.id, name: job.group.name } : nil,
      created_at: job.created_at,
      updated_at: job.updated_at
    }
  end
end
```

`job.policy` **không thể** nil (FK `policy_id` `NOT NULL`, `Policy` không có
luồng xóa — `docs/design/F8-db.md` §1d) — không cần ternary ở nhánh đó.

### 2.10 `GET /api/v1/policies/:id/device_assignments` (`PolicyDeviceAssignmentsController#index`)

```ruby
def index
  policy = policy_scope(Policy).find(params[:id])
  authorize policy, :show?

  errors = pagination_errors
  return render_validation_errors(errors) if errors.any?

  scope = Device.joins(:policy_assignments)
                .where(policy_assignments: { policy_id: policy.id })
                .merge(current_organization.devices)
                .order("policy_assignments.created_at DESC, devices.id DESC")
  total_count = scope.count
  records = scope.offset(...).limit(...)

  render json: {
    devices: records.map { |d| serialize_device(d) }, # DeviceSerializable — tái dùng nguyên, không tạo shape mới
    meta: { ... }
  }
end
```

- Tái dùng `serialize_device` đầy đủ (7 field, `DeviceSerializable`) — SoT
  §3 không giới hạn field như đã làm cho nhánh Group→Policy, và tái dùng
  giữ **một** shape Device duy nhất toàn app (đúng tinh thần
  `docs/design/F6-api.md` §5 OQ-API-1).
- Bao gồm cả Device `retired` trong list (SoT không loại — chỉ chặn ở
  bước **gán**, không ẩn dữ liệu đã gán từ trước, A25 tương đương).
- Phân trang: có (nhất quán, cùng lý do §2.4/§2.7 — dù SoT §3 gọi đây là
  "list Device đang gán trực tiếp", số lượng có thể lớn nếu 1 Policy được
  gán trực tiếp cho rất nhiều Device qua nhiều lần).

### 2.11 `POST /api/v1/policies/:id/device_assignments` (`PolicyDeviceAssignmentsController#create`)

```ruby
def create
  policy = policy_scope(Policy).find(params[:id])   # 404 độc lập #1 (A4)
  authorize policy, :assign_device?

  device = policy_scope(Device).find(params[:device_id])  # 404 độc lập #2 (A3)
  return render_validation_errors(base: [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ]) unless policy.active?  # A6
  return render_validation_errors(base: [ Device::RETIRED_POLICY_MESSAGE ]) if device.retired?          # A7, A26 (bypass UI)

  now = Time.current
  PolicyAssignment.upsert_all(
    [{ organization_id: policy.organization_id, policy_id: policy.id, device_id: device.id,
       created_at: now, updated_at: now }],
    unique_by: :index_policy_assignments_on_policy_and_device, on_duplicate: :skip
  )

  render json: { device: serialize_device(device) }, status: :created
end
```

- **Status code: `201 Created`** (khác nhánh Group ở §2.5) — quyết định cần
  chốt rõ (SoT §3/§4-B để "201/200"). Lý do chọn 201, khác 202: đây là
  thao tác **đồng bộ**, `policy_assignments` row **đã tồn tại thật** khi
  response trả về (không có gì "đang xử lý", `upsert_all` đã chạy xong
  trong chính request này) — đúng nghĩa `201` "resource đã được tạo". Gọi
  lại với cùng `device_id` (idempotent, A13-tương-đương) **vẫn trả `201`**
  (không đổi thành `200` dù có thể đã tồn tại từ trước) — quyết định đơn
  giản hóa có chủ đích: phân biệt "mới tạo" vs "đã tồn tại từ trước" đòi
  hỏi 1 query đọc thêm trước `upsert_all` chỉ để chọn status code, không
  có acceptance scenario nào yêu cầu client phân biệt được 2 case này (khác
  hẳn F6's `added_count`, nơi **số lượng** thêm mới có ý nghĩa hiển thị
  UI — ở đây chỉ có 1 device/request, không có "số lượng" gì để đếm).
- Thứ tự: tìm Policy (1) → authorize → tìm Device (2) → active → retired —
  đúng thứ tự SoT §4-B bước 3 ("org-scope 2 phía → policy.active? →
  device không retired").
- **`device_id` thiếu/blank** → `find(nil)` raise `RecordNotFound` → 404,
  cùng ghi chú đã nêu ở §2.5 cho `policy_id`.

### 2.12 `DELETE /api/v1/policies/:id/device_assignments/:device_id` (`PolicyDeviceAssignmentsController#destroy`)

```ruby
def destroy
  policy = policy_scope(Policy).find(params[:id])          # 404 độc lập #1
  authorize policy, :unassign_device?

  device = policy_scope(Device).find(params[:device_id])   # 404 độc lập #2
  assignment = policy.policy_assignments.find_by(device_id: device.id)
  return render_not_found if assignment.nil?  # liên kết không tồn tại → 404 (cùng OQ-4, áp cho nhánh Device)

  deleted_count = PolicyAssignment.where(id: assignment.id).delete_all
  return render_not_found if deleted_count.zero?
  head :no_content
end
```

- **Không check `device.retired?`** — khác F6 (nơi gỡ device khỏi Group
  cũng bị chặn nếu retired, A9 của F6). F8 SoT §6 chỉ viết rule "retired
  bất biến" cho **"khi gán trực tiếp"** (§6 dòng "Device `retired` bất
  biến khi gán trực tiếp"), không có acceptance scenario nào (A1–A32 của
  F8) yêu cầu chặn **gỡ** Policy khỏi Device retired — đọc đúng câu chữ
  hẹp của SoT F8, khác quyết định F6 cho `group_memberships`. Ghi rõ ở §5
  để không bị hiểu nhầm là thiếu sót copy từ F6.
- Cùng lý do `delete_all` + check `deleted_count` như §2.6.

### 2.13 `GET /api/v1/policies/:id/group_assignments` (`PolicyGroupAssignmentsController#index`)

```ruby
def index
  policy = policy_scope(Policy).find(params[:id])
  authorize policy, :show?

  errors = pagination_errors
  return render_validation_errors(errors) if errors.any?

  scope = Group.joins(:policy_assignments)
               .where(policy_assignments: { policy_id: policy.id })
               .merge(current_organization.groups)
               .order("policy_assignments.created_at DESC, groups.id DESC")
  total_count = scope.count
  records = scope.offset(...).limit(...)

  render json: {
    groups: records.map { |g| { id: g.id, name: g.name } },
    meta: { ... }
  }
end
```

- Field `{ id, name }` — **không** `devices_count`/`description` — quyết
  định giữ tối giản, đúng tiền lệ đã có ở
  `docs/design/F6-api.md` §2.6 (`device.groups...map { |group| { id:
  group.id, name: group.name } }`), tránh bịa thêm field không được SoT
  hay `UI_UX_design.md` §7.2 yêu cầu cụ thể (tab Group chỉ nói "list group
  đang gán policy này", không liệt field).
- Phân trang: có, cùng lý do đã lặp lại.

## 3. Constant mới cần thêm vào model (nhắc để không quên khi implement)

Không đổi schema (đúng phạm vi `docs/design/F8-db.md` — 2 model này không
có migration mới), chỉ thêm message constant — cùng tiền lệ F6 đã thêm
`Device::RETIRED_GROUP_MESSAGE` vào `Device` dù logic thực thi nằm ở
controller, không ở `Device#save` (`docs/design/F6-api.md`/`app/models/device.rb`):

```ruby
# app/models/policy.rb
INACTIVE_ASSIGNMENT_MESSAGE = "Chỉ gán được Policy đang active.".freeze # SoT F8 A5 nguyên văn

# app/models/device.rb
RETIRED_POLICY_MESSAGE = "Thiết bị đã retired, không thể gán policy trực tiếp.".freeze
```

`RETIRED_POLICY_MESSAGE` là hằng **mới**, không tái dùng
`RETIRED_GROUP_MESSAGE` đã có — 2 message khác ngữ nghĩa (group vs policy),
dù cùng "họ" invariant "retired bất biến" (đúng cách F6 tự phân biệt các
message theo action, không gộp).

## 4. Xử lý bất đồng bộ

### 4.1 Job async cho nhánh Group — đúng như `docs/design/F8-db.md` §3.4

Đã trình bày đầy đủ ở §2.5/§2.9. Tóm tắt hợp đồng API (đủ cho FE):

- `POST /api/v1/groups/:id/policy_assignments` → `202` ngay, không chờ job
  chạy — body có `total_count` để FE hiện "Đang gán cho N thiết bị..."
  ngay từ bước đầu (SoT §4-A bước 4).
- `processed_count` **cosmetic** (đúng `docs/design/F8-db.md` OQ-DB-1) —
  giữ `0` suốt `pending`/`running`, nhảy `total_count` khi `done`. FE
  **không** vẽ progress bar %-theo-thời-gian-thực dựa vào field này dưới
  thiết kế hiện tại (Phương án A không có khái niệm "batch thứ N/M" —
  §3.3/§3.4b của F8-db.md).
- **Vì sao không dùng shape phẳng `{job_id, status}` như ví dụ ở
  `UI_UX_design.md` §6.3 bước 2**: đoạn đó là `vd` (ví dụ minh họa luồng
  UX), không phải đặc tả field cứng — cùng cách SoT OQ-1 đã xử lý cho
  `queued`/`completed` ("chỉ là mô tả UX minh họa... FE map hiển thị...
  không đổi tên field theo `UI_UX_design.md`"). Áp đúng lý luận đó cho
  **shape response** (không chỉ tên field trạng thái): mọi response
  thành công khác trong app đều bọc `{ "<resource>": {...} }`, không có
  tiền lệ nào trả field phẳng ở top-level cho 1 tài nguyên đơn (chỉ có 1
  tiền lệ duy nhất — `POST .../devices` của F6 — nhưng đó là **kết quả
  của 1 thao tác hàng loạt**, không phải 1 resource, đã tự giải thích rõ ở
  `docs/design/F6-api.md` §0). `policy_assignment_job` là 1 resource đơn
  (có `id`, poll lại được qua `GET .../policy_assignment_jobs/:id`) —
  đúng loại cần bọc envelope, không phải loại phẳng.
- **Re-attach** (`GET /groups/:id/policy_assignment_jobs?status=pending,running`)
  — FE gọi khi load lại trang Group Detail, lọc đúng 2 trạng thái đang
  chạy (A17) để hiện lại banner, không mất theo dõi.

### 4.2 Không có job nào cho nhánh Device trực tiếp (OQ-7)

`POST /api/v1/policies/:id/device_assignments` chạy hoàn toàn đồng bộ (§2.11)
— không enqueue, không trạng thái `pending`/`running` nào phát sinh, đúng
quyết định OQ-7 (bounded 1 device/request, không có rủi ro "group lớn" mà
PRD lo ngại).

## 5. Lỗi / edge case — map A1–A32 (SoT §5.2)

| SoT | Tình huống | Status | Cơ chế |
|---|---|---|---|
| A1 | Gán Policy cho Group org khác | `404` | `policy_scope(Group).find` (§2.5 bước 1) |
| A2 | Gán Policy org khác cho Group org mình | `404` | `policy_scope(Policy).find` (§2.5 bước 3) |
| A3 | Gán trực tiếp Policy cho Device org khác | `404` | `policy_scope(Device).find` (§2.11 bước 3) |
| A4 | Gán trực tiếp Policy org khác cho Device org mình | `404` | `policy_scope(Policy).find` (§2.11 bước 1) |
| A5 | Gán Policy inactive cho Group | `422` `base` | `unless policy.active?` (§2.5) |
| A6 | Gán Policy inactive trực tiếp cho Device | `422` `base` | `unless policy.active?` (§2.11) |
| A7 | Gán trực tiếp cho Device retired | `422` `base` | `if device.retired?` (§2.11) |
| A8 | Gán Policy cho Group chứa cả retired + active | `202`, job `done` | Không check retired ở nhánh Group — Phương án A không đụng device (§2.5 không có bước check retired) |
| A9 | Gỡ Policy khỏi Group không tồn tại liên kết | `404` | `assignment.nil?` (§2.6, OQ-4) |
| A10 | Group bị xóa trước khi job chạy | Job → `failed` | `Group.find` raise trong `GroupPolicyAssignmentJob` (F8-db §3.4b), không phải việc của API layer |
| A11 | Policy chuyển inactive khi job đang chạy | Job vẫn `done` | Job không re-check Policy giữa chừng (F8-db §3.4b) — API không thiết kế gì thêm |
| A12 | Race 2 request gán cùng cặp | Cả 2 `202`, 1 dòng dữ liệu | `upsert_all on_duplicate: :skip` (nếu không dedupe kịp) hoặc dedupe trả lại job cũ (§2.5) |
| A13 | Gán lại policy đã gán, job mới | `202`, `done`, không nhân đôi | `on_duplicate: :skip` |
| A14 | Job thất bại một phần | Không xảy ra dưới Phương án A | Ghi chú F8-db §3.4b — không có "một phần" ở thiết kế hiện tại |
| A15 | Poll job org khác | `404` | `current_organization.policy_assignment_jobs.find` (§2.8) |
| A16 | Poll job không tồn tại | `404` | Cùng cơ chế A15 |
| A17 | `GET .../policy_assignment_jobs` group không có job | `200`, mảng rỗng | Không nhánh lỗi (§2.7) |
| A18 | Xóa Group đang có Policy gán | Xóa sạch `policy_assignments`, giữ Policy | `Group has_many :policy_assignments, dependent: :delete_all` (F8-db §1) — không thuộc phạm vi controller mới, kế thừa `GroupsController#destroy` (F5) không sửa |
| A19 | Xóa Group đang có job pending/running | Job → `failed` | `before_destroy` callback (F8-db §1c) |
| A20 | Deactivate Policy chưa gán ở đâu | `200`, không cảnh báo | Thuần FE — `assignments_count == 0` từ §2.1/§2.3 |
| A21 | Deactivate Policy đang được gán | `200`, không gỡ assignment | `PATCH /policies/:id` (F7, không đổi logic) — chỉ field mới `assignments_count` cho FE tự cảnh báo |
| A22 | Activate lại Policy có assignment cũ | `200`, giữ nguyên | Cùng cơ chế A21, không đổi gì ở F8 |
| A23 | `assignments_count` không tính trùng | Đúng tổng dòng | `GROUP BY policy_id` trên `policy_assignments` (§2.1) — đếm dòng, không đếm device |
| A24 | Policy Detail 2 tab rỗng | `200`, mảng rỗng mỗi tab | §2.10/§2.13 — không có gì để lọc → relation rỗng tự nhiên |
| A25 | Policy Detail của Policy inactive | `200` — dữ liệu cũ vẫn đọc được | §2.10/§2.13 không lọc theo `policy.status` — chỉ chặn ở **gán** (create), không ẩn list |
| A26 | Gọi thẳng API gán Policy inactive (bypass UI) | `422` | Cùng nhánh code A5/A6 — không có code path riêng cho UI vs gọi thẳng |
| A27 | `:id` sai định dạng ở endpoint mới | `404`, không `500` | `find` với id phi số raise `RecordNotFound` (đã xác nhận F4-db.md §4) |
| A28 | Menu ⋯ mở lại "Xem chi tiết" | — | Thuần FE — hệ quả của route `show` mở lại (§1) |
| A29 | Không token | `401` | `Authenticatable`, không code mới |
| A30 | Gửi `organization_id` | Bị bỏ qua | Không endpoint nào permit field này — mọi write dùng `current_organization.<assoc>`/`policy_scope(...).find`, không đọc `organization_id` từ input |
| A31 | RBAC — user khác trong org vẫn gỡ được | Thành công | Không phân role — mọi action org `true`, Scope là ranh giới thật |
| A32 | `assignments_count` khi chưa có `policy_assignments` nào | `0` cho mọi policy | `fetch(id, 0)` (§2.1) |

**Không có nhánh 403 nào** trong toàn bộ F8 — mọi vi phạm ranh giới org là
404 (`CLAUDE.md` §4).

## 6. Rủi ro / open question

Không phát hiện Open Question mới cần người duyệt quyết định nghiệp vụ (cả
12 OQ của SoT + 2 OQ của F8-db đã đủ để suy ra toàn bộ hành vi API) — các
điểm dưới đây là **quyết định thiết kế đã chốt trong tài liệu này**, ghi lại
để review không hiểu nhầm là bỏ sót:

- **202 (nhánh Group) vs 201 (nhánh Device)** — đã giải thích đầy đủ ở
  §2.5/§2.11: 202 vì response chưa đại diện "việc đã xong" (job còn
  `pending`), 201 vì `upsert_all` đã chạy xong thật trong chính request.
- **Không phân biệt "job mới" vs "job dedupe" bằng status code** (luôn
  202) và **không phân biệt "device mới gán" vs "gán lại"** (luôn 201) —
  đơn giản hóa có chủ đích, không có acceptance scenario nào đòi phân biệt.
- **Định dạng query `status=pending,running`** (§2.7) — phân tách dấu
  phẩy, `blank` = không filter, giá trị ngoài enum ở bất kỳ vị trí nào
  trong list → 422 field `status`. Không dùng `status[]=pending&status[]=running`
  (kiểu mảng query Rails) vì SoT §3 viết nguyên văn dạng chuỗi phân tách
  dấu phẩy trong URL ví dụ.
- **Response job khi Group đã bị xóa** — `group: null`, `status: "failed"`,
  vẫn `200` (§2.9) — khớp đúng yêu cầu bắt buộc của `docs/design/F8-db.md`
  §1c, không phải suy đoán.
- **Tránh N+1 cho `assignments_count`** — 1 `GROUP BY` cho cả trang
  (§2.1), dùng index `(organization_id, policy_id)` đã build ở F8-db §3.1.
- **Gỡ Policy khỏi Device retired KHÔNG bị chặn** (§2.12) — khác hành vi
  tương ứng ở F6 (gỡ device khỏi group bị chặn nếu retired) — đọc đúng
  phạm vi hẹp của SoT F8 §6 ("retired bất biến... khi gán trực tiếp"),
  không mở rộng thêm rule không được yêu cầu. Nếu người duyệt muốn nhất
  quán tuyệt đối với F6 (chặn cả gỡ), cần sửa SoT F8 trước — tài liệu này
  **không** tự chọn hướng khác với câu chữ SoT hiện có.
- **Field tối giản cho 2 list "chiều ngược"** (`group_assignments`:
  `{id, name}`; không thêm `devices_count`/`description`) — giữ đúng tiền
  lệ minimal-summary đã có ở F6 §2.6, tránh bịa field không được yêu cầu.
- **`policy_id`/`device_id` thiếu ở body** → 404 (qua `find(nil)`), không
  422 — chấp nhận vì không có acceptance scenario nào kiểm tra case này;
  nếu người duyệt muốn 422 rõ ràng hơn ("thiếu field bắt buộc"), cần thêm 1
  guard tường minh trước `find` ở cả 2 controller `create` — thay đổi nhỏ,
  không ảnh hưởng endpoint/status code nào khác trong tài liệu này.
- **Không có Pundit policy riêng cho `PolicyAssignment`** — mọi authorize
  đi qua Group/Policy cha (đúng pattern `GroupMembership` của F6, không
  phải thiếu sót).
- **Thứ tự sắp xếp 3 list "chiều ngược"** (`policy_assignments`,
  `device_assignments`, `group_assignments`) theo `policy_assignments.created_at
  DESC` (thời điểm gán gần nhất trước) — giả định hợp lý mức thấp, không
  phải quyết định nghiệp vụ nặng, có thể đổi không ảnh hưởng contract nếu
  người duyệt muốn khác (vd theo tên).

**Đã approve (2026-09-17, qua Claude Code, theo ủy quyền của user):** đồng ý
với mọi quyết định thiết kế đã chốt trong tài liệu này, bao gồm 2 điểm được
gắn cờ rõ ràng nhất — (1) gỡ Policy khỏi Device retired **không** bị chặn
(đọc đúng phạm vi hẹp của SoT F8 §6, không mở rộng thêm rule so với F6, không
sửa SoT); (2) `policy_id`/`device_id` thiếu ở body → 404 qua `find(nil)`,
không 422 riêng (không có acceptance scenario yêu cầu khác). `status` ở đầu
file đã set `approved`. Cho phép tiến hành `/design F8-frontend` (kèm
`F8-frontend-preview.html`, duyệt cùng lúc).
