---
feature_id: F6
status: approved   # draft | approved
approver: Lai Bui <lai.bui.vtp@gmail.com>
date: 2026-09-16
---

# Thiết kế API — F6

Nguồn: `docs/design/F6-db.md` (approved — bảng `group_memberships`, model
`GroupMembership`, `Group has_many :group_memberships, dependent:
:delete_all; has_many :devices, through:`, `Device has_many :groups,
through:`, unique index `[group_id, device_id]` + index riêng `device_id`,
sort key `devices.created_at DESC, devices.id DESC`, **không** validate
org-khớp ở model, **không** check constraint retired ở DB — cả hai đều là
trách nhiệm tường minh của tầng này), `docs/sot/F6-group-membership.md`
(approved — §4 main flow, §5.2 A1–A32, §6 business rule, §8 data & API
touchpoint dự kiến, §9 RBAC, §11 acceptance, §12 cả 8 OQ đã chốt), `PRD.md`
§"Nghiệp vụ" + bảng "Giao diện bắt buộc", `docs/design/F5-api.md` (approved —
envelope lỗi, `Paginatable` concern, style `ILIKE` + `sanitize_sql_like`,
convention `policy_scope(...).find` vs `current_organization.<assoc>.build`,
cách F5 chốt "204 No Content" cho `DELETE`), `docs/design/F4-api.md`
(approved — `serialize_device`, xác nhận id sai định dạng → `RecordNotFound`
không phải 500), `CLAUDE.md` §4, code hiện có `api/app/controllers/api/v1/
{devices_controller,groups_controller}.rb`, `api/app/controllers/concerns/
{authenticatable,paginatable}.rb`, `api/app/policies/{application_policy,
device_policy,group_policy}.rb`, `api/config/routes.rb`.

**Kết luận đầu tiên:** F6 **không cần Solid Queue job nào** (SoT §12 OQ-1,
`docs/design/F6-db.md` §3 "1 câu lệnh `upsert_all`... không cần enqueue") —
khác hẳn F8 sẽ làm cho gán Policy. F6 cần **1 controller mới**
(`Api::V1::GroupDevicesController`, sub-resource của Group), **mở rộng 2
controller đã approve** (`GroupsController` thêm `show` + `devices_count`;
`DevicesController` thêm `q` + field `groups` ở `show`), **mở rộng
`GroupPolicy`** (3 action mới), và **3 khối logic dùng chung giữa 2
controller** (phân trang — đã có `Paginatable`; serialize device; validate
enum filter `platform`/`status`) — xem OQ-API-1 ở §5 cho quyết định tách
concern hay copy.

## 0. Quy ước kế thừa từ F0/F2/F3/F4/F5 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần, body phẳng (không
  bọc `group:`/`device:` khi gửi).
- **422** (field-level): `{ "errors": { "<field>": ["<message>"] } }` qua
  `render_validation_errors` đã có ở `ApplicationController`. Key `base`
  dùng cho lỗi không gắn với 1 field cụ thể trên request body (đúng cách
  `Device#block_all_changes_when_retired` đã dùng `errors.add(:base, ...)`
  cho cùng loại invariant "retired bất biến").
- **401 / 404**: `{ "error": "<message>" }` — tái dùng nguyên
  `Authenticatable` và `rescue_from ActiveRecord::RecordNotFound` toàn cục.
  F6 **không thêm `rescue_from` mới cho 404** ở bất kỳ action nào.
- **Response thành công bọc key resource**: `{ "group": {...} }`,
  `{ "devices": [...], "meta": {...} }`, `{ "device": {...} }` — đúng khuôn
  F2/F3/F4/F5. Riêng `POST .../devices` trả **phẳng** `{ "added_count":
  ..., "devices_count": ... }` (không bọc, vì không phải 1 resource CRUD
  đơn — đây là kết quả của 1 thao tác hàng loạt, đúng shape SoT §8 đã ghi).
- **`meta` shape**: `{ current_page, per_page, total_page, total_count }` —
  chính xác là `{ current_page, per_page, total_count, total_pages }` y hệt
  F2/F5, dùng lại `Paginatable`.
- **Pundit**: `authorize` + `policy_scope` bắt buộc mọi action; deny-by-
  default ở `ApplicationPolicy`.
- **Không có nhánh 403 nào** trong F6 — mọi vi phạm ranh giới org là 404
  (`CLAUDE.md` §4).

## 1. Endpoint

| Method | Path | Input | Output | Org-scope |
|---|---|---|---|---|
| `GET` | `/api/v1/groups/:id` | — | `200: { "group": { id, name, description, devices_count, created_at, updated_at } }` / `404` | `policy_scope(Group).find(params[:id])` |
| `GET` | `/api/v1/groups/:id/devices` | Query: `page`, `per_page` (kế thừa `Paginatable`), `platform`, `status` (enum, optional) | `200: { "devices": [...], "meta": {...} }` / `404` (group sai org) / `422` (param phân trang/enum sai) | `group.devices.merge(current_organization.devices)` sau khi group đã qua `policy_scope` |
| `POST` | `/api/v1/groups/:id/devices` | Body phẳng: `device_ids` (bắt buộc, mảng số nguyên, 1–500 phần tử) | `200: { "added_count": Int, "devices_count": Int }` / `404` (group sai org) / `422` (`device_ids` rỗng/sai kiểu, vượt cap, retired trong batch, toàn bộ không hợp lệ sau lọc) | Group qua `policy_scope`; mỗi `device_id` qua `current_organization.devices` |
| `DELETE` | `/api/v1/groups/:id/devices/:device_id` | — | `204` / `404` (group sai org, hoặc `device_id` không phải thành viên) / `422` (device retired) | Group qua `policy_scope`; membership tìm qua `GroupMembership.find_by(group_id:, device_id:)` — org của device được đảm bảo transitively (xem §5 rủi ro) |
| `GET` | `/api/v1/devices` | Thêm query `q` (optional, ILIKE `identifier`/`name`) vào contract F2 đã có | Không đổi shape, chỉ thêm 1 filter | `policy_scope(Device)` (không đổi) |
| `GET` | `/api/v1/devices/:id` | — | Thêm field `groups: [{id, name}]` vào response F4 đã có | `device.groups.merge(current_organization.groups)` |

Riêng `GET /api/v1/groups` (list, F5) **cũng được mở rộng** thêm field
`devices_count` — F5-api.md §1 đã ghi rõ "F6 bổ sung" field này, và SoT §11
có acceptance scenario "Danh sách Group hiện đúng số lượng device đang là
thành viên" chạy trên chính trang Group List (`GroupListView.vue`, không
phải trang chi tiết) — nên đây không phải suy đoán, là nghĩa vụ tường minh
đã được cả F5-api.md lẫn F6 SoT §8 xác nhận. `POST`/`PATCH /api/v1/groups`
cũng được mở rộng thêm `devices_count` để **một** shape `serialize_group`
duy nhất dùng cho mọi response (create một group mới luôn có
`devices_count: 0`, PATCH luôn tính lại — chi phí thêm đúng 1 `COUNT` cho 1
record, không đáng kể) — tránh tình trạng field có ở response này nhưng
thiếu ở response khác của cùng resource, gây FE phải xử lý 2 shape khác
nhau cho cùng 1 group.

### Route

```ruby
namespace :api do
  namespace :v1 do
    resources :sessions, only: [ :create ]
    resource :me, only: [ :show ], controller: "me"
    resources :devices, only: [ :index, :show, :create, :update ]

    resources :groups, only: [ :index, :show, :create, :update, :destroy ] do
      member do
        get "devices", to: "group_devices#index"
        post "devices", to: "group_devices#create"
        delete "devices/:device_id", to: "group_devices#destroy"
      end
    end
  end
end
```

`member do ... end` (không phải `resources :devices do ... end` lồng) giữ
param của Group là `:id` (không đổi thành `:group_id`) — khớp **đúng** path
SoT §8 đã viết: `groups/:id/devices`, `groups/:id/devices/:device_id`. Sinh
ra:

- `GET /api/v1/groups/:id/devices` → `GroupDevicesController#index`
- `POST /api/v1/groups/:id/devices` → `GroupDevicesController#create`
- `DELETE /api/v1/groups/:id/devices/:device_id` → `GroupDevicesController#destroy`
  (`params[:id]` = group, `params[:device_id]` = device — 2 param tên khác
  nhau trong cùng route, Rails route `member` hỗ trợ tự nhiên qua thêm
  segment `:device_id`).

### Pundit — `GroupPolicy` (mở rộng)

```ruby
class GroupPolicy < ApplicationPolicy
  def index?
    true
  end

  def show?          # MỚI (F6) — GET /groups/:id, GET /groups/:id/devices
    true
  end

  def create?
    true
  end

  def update?
    true
  end

  def destroy?
    true
  end

  def add_devices?    # MỚI (F6) — POST /groups/:id/devices
    true
  end

  def remove_device?  # MỚI (F6) — DELETE /groups/:id/devices/:device_id
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.organization.groups
    end
  end
end
```

Ghi chú:

- 3 action mới **không phân role nội bộ** — đúng SoT §9, ranh giới thật vẫn
  ở `Scope#resolve` (record chỉ tới được `authorize` sau khi đã qua
  `policy_scope`, nên group sai org đã 404 từ trước).
- `authorize group, :show?`/`:add_devices?`/`:remove_device?` được gọi
  **tường minh** (truyền `query` thứ 2), **không** dựa vào default suy từ
  `action_name` — vì `GroupDevicesController#index`/`create`/`destroy`
  trùng tên action với `GroupsController#index`/`create`/`destroy` (đã có ý
  nghĩa khác: "list mọi group" vs "list device của 1 group"). Nếu dựa vào
  default, Pundit sẽ gọi nhầm `index?`/`create?`/`destroy?` — hôm nay đều
  `true` nên không lộ bug ngay, nhưng gây nhầm lẫn ngữ nghĩa và là bẫy chờ
  sẵn nếu sau này 1 trong 2 cặp action cần tách quyền khác nhau.
- `DevicePolicy` **không đổi gì** — `show?`/`index?` đã `true` sẵn từ
  F2/F4, đủ cho `q` (vẫn là `index`) và field `groups` (vẫn là `show`).

## 2. Business logic từng endpoint

### 2.1 `GET /api/v1/groups/:id` (action `show` mới trên `GroupsController`)

1. `authenticate_request!` (có sẵn).
2. `group = policy_scope(Group).find(params[:id])` → `RecordNotFound` cho
   org khác/không tồn tại/sai định dạng → 404 tự động (A1, A5).
3. `authorize group, :show?`.
4. Render:
   ```ruby
   render json: { group: serialize_group(group) }
   ```
   `serialize_group` tính `devices_count: group.devices.count` — **1**
   `COUNT` query cho 1 record, không N+1 (`docs/design/F6-db.md` §3 đã xác
   nhận đây là cách đúng cho `show`).

Không cần transaction (read-only, 2 query: `find` + `count`).

### 2.2 `GET /api/v1/groups/:id/devices` (`GroupDevicesController#index`)

1. `authenticate_request!`.
2. `group = policy_scope(Group).find(params[:id])` → 404 (A2, A5).
3. `authorize group, :show?`.
4. `pagination_errors` (từ `Paginatable`, dùng lại nguyên) → 422 nếu sai
   (A17 kế thừa F2).
5. `filter_errors` (platform/status enum, xem §5 OQ-API-2 cho việc tách
   concern) → 422 nếu enum không hợp lệ.
6. Build scope:
   ```ruby
   scope = group.devices.merge(current_organization.devices)
   scope = scope.where(platform: params[:platform]) if params[:platform].present?
   scope = scope.where(status: params[:status]) if params[:status].present?
   scope = scope.order(created_at: :desc, id: :desc)
   ```
   - `group.devices` (qua `has_many :devices, through: :group_memberships`)
     đã tự động `WHERE group_memberships.group_id = ?` (dùng unique index
     composite qua leftmost-prefix, `docs/design/F6-db.md` §3).
   - `.merge(current_organization.devices)` là lớp phòng thủ **thêm**, cố ý
     dù `group_memberships` không có validate org-khớp ở model
     (`F6-db.md` §1b) — org của device được đảm bảo *tại thời điểm tạo
     membership* (§2.3 dưới), không phải tại thời điểm đọc; `.merge` ở đây
     giữ đúng tinh thần "mọi query qua `current_organization.<assoc>`"
     (`CLAUDE.md` §4) **tuyệt đối**, không dựa vào invariant write-time làm
     đủ. Không thêm cost đáng kể — cùng 1 câu SQL, thêm 1 điều kiện
     `organization_id = ?` mà `devices` đã có index.
   - Sort `devices.created_at DESC, devices.id DESC` — đúng chốt ở
     `docs/design/F6-db.md` §4a (người duyệt xác nhận), **không phải**
     `group_memberships.created_at`.
7. `total_count = scope.count` (trên relation đã group-scope + org-scope +
   filter, trước limit/offset — A17, group 10.000 device).
8. `records = scope.offset(...).limit(...)`.
9. Render:
   ```ruby
   render json: {
     devices: records.map { |d| serialize_device(d) },
     meta: { current_page: page, per_page: per_page, total_count: total_count, total_pages: total_pages(total_count) }
   }
   ```
   `serialize_device` **không** merge `groups` ở đây (khác `DevicesController#show`)
   — đây là list nhiều device, thêm `device.groups` mỗi dòng sẽ N+1.

Không transaction (read-only).

### 2.3 `POST /api/v1/groups/:id/devices` (`GroupDevicesController#create`)

Thứ tự thao tác (từng bước fail-fast, **không** query gì thêm sau khi đã
biết sẽ trả lỗi):

1. `authenticate_request!`.
2. `group = policy_scope(Group).find(params[:id])` → 404 (A3, A5) —
   **trước** khi đọc `device_ids`, nên group sai org không bao giờ tạo
   membership nào dù `device_ids` hợp lệ (A3 khớp acceptance scenario).
3. `authorize group, :add_devices?`.
4. **Validate hình dạng `device_ids` trên param thô** (trước `permit`, để
   cap-check ở bước 5 đo đúng kích thước request thật, không bị `permit`
   lọc bớt phần tử không hợp lệ trước):
   ```ruby
   raw_ids = params[:device_ids]
   return render_validation_errors(device_ids: [DEVICE_IDS_BLANK_MESSAGE]) \
     unless raw_ids.is_a?(Array) && raw_ids.present?
   ```
   → 422 field `device_ids` (A13 — rỗng, thiếu field, hoặc không phải mảng).
5. **Cap 500** (SoT OQ-2), đo trên `raw_ids.size` (chưa lọc org/kiểu, đúng
   tinh thần "chặn payload khổng lồ" — kiểm tra trước khi làm bất cứ việc
   gì tốn hơn):
   ```ruby
   return render_validation_errors(device_ids: [DEVICE_IDS_CAP_MESSAGE]) \
     if raw_ids.size > MAX_DEVICE_IDS_PER_REQUEST
   ```
   → 422 (A12), không thêm gì.
6. **Coerce + lọc org** — permit mảng số nguyên, bỏ qua phần tử không coerce
   được (không lỗi riêng cho phần tử lạ — cùng tinh thần "lọc âm thầm" của
   OQ-4), rồi lọc theo `current_organization.devices`:
   ```ruby
   permitted_ids = params.permit(device_ids: [])[:device_ids] || []
   coerced_ids = permitted_ids.filter_map { |v| Integer(v.to_s, 10, exception: false) }
   valid_ids = current_organization.devices.where(id: coerced_ids).pluck(:id)
   ```
   `valid_ids` không có phần tử trùng (kết quả của 1 câu `WHERE id IN (...)`
   trên PK, không nhân đôi dù `device_ids` client gửi có trùng) — org khác/
   không tồn tại/không coerce được đều rơi rụng ở đây, im lặng (A10).
7. **Toàn bộ không hợp lệ sau lọc**:
   ```ruby
   return render_validation_errors(device_ids: [NO_VALID_DEVICES_MESSAGE]) if valid_ids.empty?
   ```
   → 422 (A11).
8. **Atomic reject nếu có retired trong `valid_ids`** (SoT OQ-3 — chặn toàn
   bộ request, không thêm gì kể cả device hợp lệ khác):
   ```ruby
   retired_identifiers = current_organization.devices
     .where(id: valid_ids, status: :retired)
     .order(:identifier)
     .pluck(:identifier)
   if retired_identifiers.any?
     return render_validation_errors(base: ["#{RETIRED_BATCH_PREFIX}#{retired_identifiers.join(', ')}"])
   end
   ```
   → 422 (A8, A27 — cùng nhánh code cho cả UI-bypass lẫn UI thường, không
   phân biệt được). `order(:identifier)` để danh sách trong message **xác
   định**, không phụ thuộc thứ tự trả về ngẫu nhiên của Postgres — quan
   trọng vì test sẽ assert đúng chuỗi.
9. **Đếm trước khi ghi** (để tính `added_count` chính xác — chỉ device thật
   sự mới làm tăng, A6/A7):
   ```ruby
   existing_member_ids = GroupMembership.where(group_id: group.id, device_id: valid_ids).pluck(:device_id)
   added_count = valid_ids.size - existing_member_ids.size
   ```
10. **Ghi — 1 câu lệnh, idempotent**:
    ```ruby
    now = Time.current
    rows = valid_ids.map { |device_id| { group_id: group.id, device_id: device_id, created_at: now, updated_at: now } }
    GroupMembership.upsert_all(rows, unique_by: [:group_id, :device_id], on_duplicate: :skip)
    ```
    - `on_duplicate: :skip` (`ON CONFLICT DO NOTHING`) — cặp đã tồn tại
      **không bị đụng tới** (không bump `updated_at`), khớp đúng quyết định
      "không `touch:`" đã chốt ở `docs/design/F6-db.md` §4a: bulk-add và gỡ
      đơn lẻ phải cùng 1 chuẩn "không tự ý cập nhật timestamp của thứ không
      đổi". Đây cũng là cách đọc tự nhiên nhất của "idempotent — gọi lại
      không tạo hiệu ứng phụ nào thêm".
    - **Không cần transaction thủ công** — đúng 1 câu SQL, tự atomic ở tầng
      DB (`docs/design/F6-db.md` §3).
11. `devices_count = group.devices.count` (tính lại sau khi ghi — 1 `COUNT`,
    không cộng dồn thủ công từ `added_count`, để luôn là hàm thuần của state
    hiện tại, nhất quán §5).
12. Render `200 { added_count: added_count, devices_count: devices_count }`.

**Race A15** (2 request thêm cùng device cùng group gần như đồng thời): cả
hai đều đi qua bước 10, unique index `[group_id, device_id]` + `on_duplicate:
:skip` đảm bảo **đúng 1** dòng tồn tại dù cả hai `upsert_all` cùng chạy —
không request nào raise `RecordNotUnique` (khác hẳn `create`/`update` của
Group/Device — không cần `rescue_from` ở controller này), cả hai nhận `200`.
`added_count` của từng response được tính từ **snapshot trước ghi của chính
request đó** (bước 9) — dưới race thật sự (2 request đọc `existing_member_ids`
gần như cùng lúc, trước khi cả hai ghi), **cả hai** response có thể báo
`added_count: 1` cho cùng 1 device dù thực tế chỉ 1 dòng được tạo — chấp
nhận sai số nhỏ này ở field hiển thị (không ảnh hưởng data — `devices_count`
ở bước 11 luôn đúng vì tính lại bằng `COUNT` thật sau khi ghi, không cộng
dồn `added_count`), xem thêm §5.

### 2.4 `DELETE /api/v1/groups/:id/devices/:device_id` (`GroupDevicesController#destroy`)

1. `authenticate_request!`.
2. `group = policy_scope(Group).find(params[:id])` → 404 (A4, A5).
3. `authorize group, :remove_device?`.
4. Tìm membership:
   ```ruby
   membership = GroupMembership.find_by(group_id: group.id, device_id: params[:device_id])
   return render_not_found if membership.nil?
   ```
   → 404 nếu chưa từng là thành viên, hoặc đã bị gỡ bởi request khác trước
   đó (A14, nhánh "đã gỡ" của A16).
5. Check retired **trước khi xóa**:
   ```ruby
   if membership.device.retired?
     return render_validation_errors(base: [Device::RETIRED_GROUP_MESSAGE])
   end
   ```
   → 422 (A9, A27), **không xóa gì**, membership vẫn còn nguyên.
6. Xóa — dùng `delete_all` trên `WHERE id = ?` (thay vì gọi thẳng
   `membership.destroy!`) để lấy **số dòng thực sự bị xóa bởi chính câu SQL
   này**, cần cho việc đảm bảo A16 "đúng 1 request thành công" dưới race
   thật (2 request cùng `find_by` thấy record tồn tại trước khi cái nào
   `DELETE` xong — nếu chỉ gọi `destroy!` mù, Rails không kiểm tra số dòng
   bị ảnh hưởng nên **cả hai** sẽ "thành công" theo Ruby dù DB chỉ xóa được
   1 dòng thật; `docs/design/F6-db.md` §4b chỉ nói "`find_by` trả `nil` ở
   lần gọi thứ 2 là đủ", đúng cho trường hợp 2 request nối tiếp gần nhau,
   nhưng không đủ cho race **thật sự đồng thời** hai `find_by` cùng thấy
   record tồn tại trước khi request nào `DELETE` xong — bước này siết chặt
   thêm 1 mức để giữ đúng lời hứa "chỉ 1 hiệu ứng xảy ra" của acceptance
   scenario, xem §5 để người duyệt xác nhận có đồng ý mức siết thêm này
   không):
   ```ruby
   deleted_count = GroupMembership.where(id: membership.id).delete_all
   return render_not_found if deleted_count.zero?
   head :no_content
   ```
   `deleted_count.zero?` chỉ xảy ra khi 1 request khác đã xóa đúng dòng này
   giữa bước 4 và bước 6 — case cực hiếm, xử lý y hệt "đã bị gỡ" → 404.

Không cần transaction thủ công — `delete_all` trên 1 điều kiện `id = ?` đã
atomic ở tầng DB, không có bước ghi thứ 2 nào cần bọc chung.

### 2.5 `GET /api/v1/devices` — thêm `q` (`DevicesController#index`, mở rộng)

Chèn thêm 1 điều kiện vào `filtered_scope` đã có (giữa `platform`/`status`
và `order`), đúng pattern `ILIKE` + `sanitize_sql_like` đã dùng ở
`GroupsController` (F5):

```ruby
def filtered_scope
  scope = policy_scope(Device)
  scope = scope.where(platform: params[:platform]) if params[:platform].present?
  scope = scope.where(status: params[:status]) if params[:status].present?
  scope = scope.where("identifier ILIKE :q OR name ILIKE :q", q: "%#{Device.sanitize_sql_like(search_term)}%") if search_term.present?
  scope.order(created_at: :desc, id: :desc)
end

def search_term
  @search_term ||= params[:q].to_s.strip
end
```

- `q` optional, blank/không gửi = không filter — **không có nhánh 422** cho
  `q` (đúng tinh thần F5-api.md §3 cho `q` trên Group).
- Khớp cả `identifier` **hoặc** `name` (SoT §12 OQ-7: "ILIKE trên
  `identifier` hoặc `name`"), 1 điều kiện `OR` trong cùng where — dùng
  named placeholder `:q` (không nội suy) để tránh viết lại wildcard 2 lần
  qua string interpolation riêng rẽ (rủi ro gõ thiếu escape ở 1 trong 2).
- **Không loại device đã là thành viên của group đích khỏi kết quả** — SoT
  OQ-7 đã chốt rõ, vì thêm lại device đã là thành viên là no-op vô hại.
- Không phá contract F2 hiện có — order/pagination/filter platform-status
  không đổi, `q` là filter **thêm**, không bắt buộc.

### 2.6 `GET /api/v1/devices/:id` — thêm `groups` (`DevicesController#show`, mở rộng)

```ruby
def show
  device = policy_scope(Device).find(params[:id])
  authorize device
  device.record_seen!

  render json: {
    device: serialize_device(device).merge(
      groups: device.groups.merge(current_organization.groups).order(:name).map { |g| { id: g.id, name: g.name } }
    )
  }
end
```

- `.merge(current_organization.groups)` — cùng lý do phòng thủ đã giải
  thích ở §2.2 (không dựa hoàn toàn vào invariant write-time).
- `order(:name)` — SoT không chỉ định thứ tự cụ thể cho khối "Groups đang
  thuộc"; chọn theo tên (alphabet) để hiển thị ổn định/dễ tìm, không phải
  quyết định nghiệp vụ nặng — xem §5 nếu người duyệt muốn khác (vd theo
  thời điểm thêm vào group).
- **Không N+1**: chỉ 1 Device, 1 query join (`docs/design/F6-db.md` §3 đã
  xác nhận).
- **Chỉ `show` có field này** — `index`/`create`/`update` vẫn dùng
  `serialize_device` trần, **không** merge `groups` (sẽ N+1 nếu thêm vào
  `index`, danh sách nhiều device).

### 2.7 Serializer dùng chung (mở rộng/mới)

```ruby
# GroupsController — dùng cho show/create/update; index tự truyền
# devices_count đã tính sẵn (batch, xem dưới) để tránh N+1.
def serialize_group(group, devices_count: group.devices.count)
  {
    id: group.id,
    name: group.name,
    description: group.description,
    devices_count: devices_count,
    created_at: group.created_at,
    updated_at: group.updated_at
  }
end
```

- Ruby chỉ evaluate default `group.devices.count` khi **không** truyền
  `devices_count:` — `index` luôn truyền tường minh nên default (1 query/
  record) không bao giờ chạy ở đó, giữ đúng cấm N+1 của
  `docs/design/F6-db.md` §3.
- `index` build 1 query đếm gộp cho cả trang (không phải N query riêng lẻ):
  ```ruby
  records = scope.offset(...).limit(...)
  counts = GroupMembership.where(group_id: records.map(&:id)).group(:group_id).count
  render json: {
    groups: records.map { |g| serialize_group(g, devices_count: counts.fetch(g.id, 0)) },
    meta: { ... }
  }
  ```
  2 query tổng cộng cho `index` (scope query + 1 `GROUP BY` count), không
  phụ thuộc số group trên trang.

`serialize_device` (dùng cho cả `DevicesController` và
`GroupDevicesController#index`) **không đổi shape** so với F2/F3/F4 — xem
§5 OQ-API-2 cho quyết định có tách thành concern dùng chung hay không.

## 3. Lỗi / edge case — map A1–A32 (SoT §5.2)

| SoT | Tình huống | Status | Cơ chế |
|---|---|---|---|
| A1 | `GET /groups/:id` org khác | 404 | `policy_scope(Group).find` → `RecordNotFound` |
| A2 | `GET /groups/:id/devices` org khác | 404 | Cùng cơ chế A1, group tìm trước khi query devices |
| A3 | `POST .../devices` group org khác | 404 | Group tìm **trước** khi đọc `device_ids` — không tạo gì |
| A4 | `DELETE .../devices/:device_id` group org khác | 404 | Cùng cơ chế A1 |
| A5 | `:id` không tồn tại/sai định dạng (4 endpoint mới) | 404 | `find` với id phi số raise `RecordNotFound` (đã xác nhận thực nghiệm F4-db.md §4) |
| A6 | Thêm device đã là thành viên | 200, idempotent | `on_duplicate: :skip` — không tạo dòng mới, `added_count` không tính nó |
| A7 | Thêm mix (mới + đã có) | 200, count chỉ tăng theo mới | `added_count` tính từ `existing_member_ids` snapshot trước ghi (§2.3 bước 9) |
| A8 | Thêm có retired trong batch | 422, chặn toàn bộ | Atomic reject bước 8 (§2.3), liệt kê identifier, dừng trước `upsert_all` |
| A9 | Gỡ device retired | 422, vẫn còn thành viên | Check `membership.device.retired?` trước `delete_all` (§2.4 bước 5) |
| A10 | `device_ids` có id org khác/không tồn tại | Lọc âm thầm, id hợp lệ khác vẫn thêm | `current_organization.devices.where(id: coerced_ids).pluck(:id)` (§2.3 bước 6) |
| A11 | Toàn bộ `device_ids` không hợp lệ sau lọc | 422 | `valid_ids.empty?` (§2.3 bước 7) |
| A12 | Vượt cap 500 | 422, không thêm gì | Check trên `raw_ids.size` trước mọi query (§2.3 bước 5) |
| A13 | `device_ids` rỗng/thiếu/sai kiểu | 422 field `device_ids` | Check `is_a?(Array) && present?` trước mọi query (§2.3 bước 4) |
| A14 | Gỡ device không phải thành viên | 404 | `find_by` trả `nil` (§2.4 bước 4) |
| A15 | Race thêm đồng thời | Cả 2 nhận 200, không dòng trùng | Unique index + `upsert_all on_duplicate: :skip` (DB tự xử lý êm) |
| A16 | Race gỡ đồng thời | Đúng 1 thành công, còn lại 404, không 500 | `delete_all` + check `deleted_count` (§2.4 bước 6 — siết hơn "chỉ `find_by`" của F6-db.md §4b, xem §5) |
| A17 | Group 10.000 device, tab Thành viên | 200, phân trang đúng, `meta.total_count` đúng | `Paginatable` + `scope.count` trước limit/offset (§2.2) |
| A18 | Filter không khớp | 200, mảng rỗng | Không nhánh riêng — filter làm relation rỗng tự nhiên (FE tự phân biệt A18 vs A19 bằng state filter của chính nó, giống F5 A14/A15) |
| A19 | Group chưa có device thật | 200, mảng rỗng | Shape giống hệt A18 (có chủ đích) |
| A20 | Xóa Group có device (tới 10k) | `group_memberships` xóa sạch cùng transaction | Kế thừa `GroupsController#destroy` (F5) — `dependent: :delete_all` giờ có hiệu lực thật vì `Group.has_many :group_memberships` đã tồn tại (F6-db.md §1), **không sửa 1 dòng nào** ở `destroy` |
| A21 | Sau khi xóa Group, device không còn hiện group đó | Hệ quả tự nhiên | `device.groups` không còn join row trỏ tới group đã xóa |
| A22 | Search device không khớp | 200, mảng rỗng (FE hiện "Không tìm thấy" trong dropdown) | `q` không match → relation rỗng, không nhánh lỗi riêng |
| A23 | Search group không khớp | Không đổi — dùng `q` đã có từ F5 | Không cần thay đổi API |
| A24 | Device thuộc nhiều group | Hợp lệ, không giới hạn | Không có ràng buộc nào chặn — `has_many :through` tự nhiên cho phép |
| A25 | Device Detail hiện đúng group (kể cả 0 group) | `groups: []` khi rỗng | `device.groups...map` trên mảng rỗng → `[]`, không `null` |
| A26 | Retired — ẩn nút ở Device Detail | Không đổi ở API — đọc vẫn trả `groups` bình thường | Thuần FE (banner + disable); API không lọc gì khi đọc |
| A27 | Gọi thẳng API thêm/gỡ group cho device retired (bypass UI) | 422 | **Cùng chính xác nhánh code** A8/A9 — không có code path riêng cho "qua UI" vs "gọi thẳng", double-check ở BE là mặc định |
| A28 | Lỗi hạ tầng tải tab Thành viên | 500 | Không thiết kế riêng — FE tự xử lý (giống F5 A19) |
| A29 | Lỗi hạ tầng thêm/gỡ | 500 | Không thiết kế riêng, không rollback nửa vời vì mỗi thao tác ghi là 1 câu lệnh atomic |
| A30 | Không token (4 endpoint mới + `q`) | 401 | `Authenticatable`, không code mới |
| A31 | Gửi `organization_id` trong request | Bị bỏ qua, org đích không đổi | `add_devices_params`/`current_organization.devices` không bao giờ đọc `organization_id` từ input — không permit field này ở bất kỳ đâu |
| A32 | RBAC — không phân role | Mọi user active của org thêm/gỡ được | `GroupPolicy` 3 action mới đều `true`, ranh giới ở `Scope` |

## 4. Xử lý bất đồng bộ

**Không áp dụng ở F6** (SoT §12 OQ-1, đã approve: "không làm bulk-add-theo-
filter", "không cần enqueue Solid Queue job cho thao tác này"). Cả `POST`
lẫn `DELETE` đều là **1 câu lệnh ghi atomic** (`upsert_all`/`delete_all`),
cap 500 device/request giữ transaction đủ nhanh để chạy đồng bộ trong
request kể cả khi Group đã có 10.000 thành viên. `DELETE /api/v1/groups/:id`
(xóa cả group) cũng chạy đồng bộ — quyết định đã chốt ở `docs/design/F6-db.md`
§3/§4a ("1 câu `DELETE ... WHERE group_id = ?` là đủ nhanh dù 10.000 dòng").
Ranh giới async job (`pending/running/done/failed`, Solid Queue) thuộc F8
(gán Policy cho Group lớn), không phải F6 — không thiết kế gì ở đây.

## 5. Rủi ro / open question

### OQ-API-1 (đã người duyệt xác nhận, 2026-09-16, Lai Bui) — Tách concern dùng chung hay copy code, cho `GroupDevicesController`

**Quyết định: (a) Tách concern** (`device_serializable.rb`, `device_filterable.rb`), đúng khuyến nghị, nhất quán với `Paginatable` đã chốt ở F5. Refactor `DevicesController` được phép, có request spec F2/F3/F4 làm lưới an toàn — rerun rspec đầy đủ trước khi coi Done.

`GroupDevicesController#index` cần lại đúng 2 khối logic hiện đang `private`
trong `DevicesController`: (a) `serialize_device`, (b) cặp
`ENUM_ERROR`/`invalid_enum?` dùng cho `filter_errors` (platform/status).
Đây là tình huống **giống hệt** `OQ-API-1` mà `docs/design/F5-api.md` §5 đã
gặp và chốt cho `Paginatable` — cùng class rủi ro: hằng
(`ENUM_ERROR = "is not included in the list"`) và field list của
`serialize_device` tồn tại ở ≥2 nơi, chắc chắn lệch nhau khi field mới
(vd `groups` ở F6 chính nó) được thêm vào 1 chỗ mà quên chỗ kia.

- **(a) Tách 2 concern mới** (khuyến nghị, nhất quán quyết định đã có ở F5
  OQ-API-1): `app/controllers/concerns/device_serializable.rb`
  (`serialize_device`) và `app/controllers/concerns/device_filterable.rb`
  (`ENUM_ERROR`, `invalid_enum?`), cả hai `include` vào cả
  `DevicesController` và `GroupDevicesController`. Refactor thuần giữ
  nguyên hành vi cho `DevicesController` (đã có request spec F2/F3/F4 làm
  lưới an toàn).
- **(b) Copy** `serialize_device`/`ENUM_ERROR`/`invalid_enum?` sang
  `GroupDevicesController`. Không đụng file F2/F3/F4 đã approve, đổi lại
  chấp nhận trùng lặp — rủi ro lệch cao hơn vì lần này đích thân F6 sắp
  **thêm field `groups`** vào 1 trong 2 bản `serialize_device` (chỉ ở
  `DevicesController#show`, xem §2.6) — nếu copy, 2 bản `serialize_device`
  sẽ **cố ý** khác nhau ngay từ đầu (bản trong `GroupDevicesController`
  không bao giờ cần `groups`), làm giảm phần nào rủi ro drift so với F5
  OQ-API-1 (ở đó 2 bản `Paginatable` phải **giống hệt tuyệt đối**) — nhưng
  `ENUM_ERROR`/`invalid_enum?` vẫn là rủi ro drift thật (2 chỗ y hệt nhau).

Tài liệu này **khuyến nghị (a)** cho cả hai, nhất quán với quyết định đã
approve ở F5, nhưng cần người duyệt xác nhận vì (a) chạm vào
`DevicesController` đã approve (gate rspec phải chạy lại toàn bộ
`devices_spec.rb`).

### OQ-API-2 (đã người duyệt xác nhận, 2026-09-16, Lai Bui) — Mức "siết thêm" ở DELETE cho A16

**Quyết định: giữ `delete_all` + check `deleted_count`**, đúng khuyến nghị — đóng đúng khoảng hở acceptance scenario A16 ("đúng một request thành công") dưới race thật sự đồng thời, chi phí gần như bằng 0.

`docs/design/F6-db.md` §4b nói nguyên văn: "DB layer không cần cơ chế đặc
biệt... hành vi tự nhiên của `find_by` trả `nil` ở lần gọi thứ 2 là đủ".
Thiết kế ở §2.4 bước 6 đi xa hơn 1 chút: dùng `delete_all` + kiểm tra
`deleted_count` thay vì gọi thẳng `destroy!`, để đảm bảo đúng nghĩa đen của
acceptance scenario A16 ("đúng **một** request nhận thành công") dưới race
**thật sự đồng thời** (2 `find_by` cùng thấy record tồn tại trước khi request
nào `DELETE` xong) — trường hợp mà `destroy!` mù (không tự kiểm tra số dòng
bị ảnh hưởng) có thể để cả hai request cùng trả `204`.

- Nếu người duyệt cho rằng `docs/design/F6-db.md` §4b đã đủ chi tiết và
  không muốn controller có thêm 1 bước kiểm tra ngoài "tìm rồi xóa" — đổi
  lại thành `membership.destroy!` đơn giản, chấp nhận rủi ro lý thuyết đã
  nêu (chưa có bằng chứng request spec chạy 2 thread thật sự bắt được race
  này trong môi trường test hiện tại — DB test transaction/connection pool
  có thể tự nhiên serialize phần lớn trường hợp).
- Tài liệu này **khuyến nghị giữ `delete_all` + check count** vì chi phí
  code gần như bằng 0 (không transaction thêm, không round-trip DB thêm —
  `delete_all` vẫn là 1 câu lệnh) trong khi đóng đúng khoảng hở acceptance
  scenario A16 mô tả.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **`added_count` có thể hơi lệch dưới race A15** (§2.3, cuối bước 10) —
  chấp nhận, không ảnh hưởng `devices_count` (luôn tính lại bằng `COUNT`
  thật). Không có acceptance scenario nào assert giá trị chính xác của
  `added_count` dưới race đồng thời (chỉ assert status code + không tạo
  dòng trùng), nên đây không phải regression so với SoT.
- **Response `POST .../devices` không trả danh sách id bị lọc âm thầm**
  (org khác/không tồn tại) — đúng SoT §12 "Rủi ro/giả định" đã để ngỏ và
  giao quyết định cho `/design`: chốt **không trả** (`{ added_count,
  devices_count }` đúng nguyên văn SoT §8), vì FE luôn build `device_ids`
  từ chính kết quả search đã org-scope — case này chỉ có giá trị phòng thủ
  chống request giả mạo trực tiếp, không phải luồng UI thật.
- **Sort field `groups` trong `GET /devices/:id` chọn theo `name`** (§2.6)
  — SoT không chỉ định; đây là giả định hợp lý mức thấp (không phải quyết
  định nghiệp vụ nặng), có thể đổi không ảnh hưởng contract nếu người duyệt
  muốn khác.
- **`GroupDevicesController` không cần `rescue_from
  ActiveRecord::RecordNotUnique`** — khác `GroupsController`/
  `DevicesController` (create/update Group/Device qua `save`/`update` có
  thể thua race ở unique index) — `POST .../devices` dùng `upsert_all` (xử
  lý conflict ở tầng SQL, không raise exception Ruby-side) và `DELETE` dùng
  `delete_all` (không có unique constraint nào để vi phạm) — không có code
  path nào trong controller này chạm `save`/`create` tuần tự trên
  `GroupMembership`, nên rescue này sẽ là dead code nếu thêm — nhất quán lý
  do `docs/design/F6-db.md` §4b cuối cùng đã nêu.
- **`GET /api/v1/groups` (index F5) giờ có thêm 1 query** (`GROUP BY` đếm
  theo trang) so với F5 gốc — chi phí O(1) theo số group/trang (≤100), không
  phụ thuộc tổng số group toàn hệ thống; ghi vào `DESIGN.md` như 1 thay đổi
  hiệu năng nhỏ, không phải regression.
- **Không thiết kế gì cho tab "Policies" ở Group Detail** — đúng SoT §3
  "Ngoài phạm vi", thuộc F7/F8.
