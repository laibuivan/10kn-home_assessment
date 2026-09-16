---
feature_id: F5
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế API — F5

Nguồn: `docs/design/F5-db.md` (approved — bảng `groups`, `Group` model,
`Group::NAME_TAKEN_MESSAGE`, nghĩa vụ "API layer phải gọi `#destroy` chứ
không `#delete`" + "rescue `RecordNotUnique` thành 422"),
`docs/sot/F5-group-crud.md` (approved — §4 main flow, §5 edge case A1–A25,
§6 business rule, §8 data & API touchpoint, §9 RBAC, §11 acceptance criteria,
§12 decisions OQ-1…OQ-8), `docs/design/F2-api.md` (approved — envelope lỗi,
coerce param phân trang, `meta` shape), `docs/design/F3-api.md` (approved —
body phẳng, response bọc key resource, `rescue_from
ActiveRecord::RecordNotUnique` local ở controller),
`docs/design/F4-api.md` (approved — 404 cho id sai định dạng, convention
`policy_scope(...).find` vs `current_organization.<assoc>.build`), `PRD.md`
§"Nghiệp vụ" → "Group" + bảng "Giao diện bắt buộc" dòng "Groups",
`CLAUDE.md` §4, code hiện có `api/app/controllers/application_controller.rb`,
`api/app/controllers/concerns/authenticatable.rb`,
`api/app/controllers/api/v1/devices_controller.rb`,
`api/app/policies/{application_policy,device_policy}.rb`,
`api/config/routes.rb`.

**Kết luận đầu tiên:** F5 là feature **đầu tiên có resource controller thứ
hai** của dự án — cần thêm `Api::V1::GroupsController` (mới) +
`GroupPolicy` (mới) + 1 dòng `resources :groups` trong `routes.rb`. Không
sửa `DevicesController`, không sửa `ApplicationController`, không sửa
`Authenticatable`, không sửa `DevicePolicy`. Ba thứ thật sự mới ở tầng API:

1. **Search `q`** (OQ-6) — pattern chưa từng có ở F2/F3/F4 (F2 chỉ có filter
   enum bằng `where(col: value)`); cần `ILIKE` + escape wildcard, xem §2.1
   bước 4.
2. **`DELETE`** — động từ chưa từng xuất hiện ở F2–F4; chốt status code,
   transaction boundary và cái bẫy `#destroy` vs `#delete` (§2.4).
3. **Tái dùng hạ tầng phân trang của F2 từ một controller khác** — hiện
   toàn bộ code coerce/clamp đang nằm `private` trong `DevicesController`;
   đây là điểm cần người duyệt quyết định (OQ-API-1, §5).

## 0. Quy ước kế thừa từ F0/F2/F3/F4 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần.
- **422** (field-level): `{ "errors": { "<field>": ["<message>"] } }` — render
  qua `ApplicationController#render_validation_errors` đã có, **không** tạo
  helper/envelope mới.
- **401 / 404 / 400**: `{ "error": "<message>" }` — `{ "error":
  "Unauthorized" }` từ `Authenticatable`, `{ "error": "Not found" }` từ
  `rescue_from ActiveRecord::RecordNotFound` toàn cục ở
  `ApplicationController` (F0). F5 **không** thêm `rescue_from` nào cho 404:
  `policy_scope(Group).find(params[:id])` raise `RecordNotFound` cho cả 3
  case A1 (org khác — đã bị Scope loại), A2 (không tồn tại), A3 (id sai định
  dạng — đã xác nhận thực nghiệm ở `docs/design/F4-db.md` §4 rằng id phi số
  raise `RecordNotFound` chứ không `StatementInvalid`).
- **Auth**: `include Authenticatable` trong `GroupsController` → có
  `before_action :authenticate_request!`, `current_user`,
  `current_organization`. Tái dùng nguyên vẹn, không sửa concern (A20).
- **Request body phẳng, không bọc `group:`** — đúng tiền lệ F0
  (`POST /sessions` nhận `{ email, password }`) và F3 (`POST /devices` nhận
  `{ identifier, name, ... }`). `ActionController::ParamsWrapper` không được
  dùng ở dự án này. Client gửi `{ name, description }` ở top-level. (SoT §8
  đã ghi rõ yêu cầu này.)
- **Response thành công bọc trong key resource** — `{ "group": {...} }` cho
  `POST`/`PATCH`, `{ "groups": [...], "meta": {...} }` cho `GET` — đúng
  đúng khuôn `{ "device": {...} }` / `{ "devices": [...], "meta": {...} }`
  của F2/F3. Không trả phẳng ở top-level.
- **`meta` shape**: `{ current_page, per_page, total_count, total_pages }` —
  y hệt F2 (`docs/design/F2-api.md` §5, đã approve làm chuẩn cho FE).
- **Pundit**: `authorize` + `policy_scope` bắt buộc ở mọi action
  (`docs/design/F2-api.md` §5 OQ-API-1 đã chốt wire Pundit từ F2).
  `ApplicationPolicy` mặc định **deny** mọi action → `GroupPolicy` phải
  khai báo tường minh từng action (§1).

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `GET` | `/api/v1/groups` | Query: `q` (optional string — tìm một phần trên `name`, không phân biệt hoa/thường), `page` (optional, default `1`), `per_page` (optional, default `20`, max `100` — clamp im lặng) | `200`: `{ "groups": [ { id, name, description, created_at, updated_at } ], "meta": { current_page, per_page, total_count, total_pages } }`<br>`422`: lỗi field `page`/`per_page` | Bất kỳ user `active` thuộc org (không phân role — SoT §9) | `policy_scope(Group)` → `current_organization.groups`; không bao giờ `Group.all`/`Group.where` trần; **không nhận `organization_id`** từ query dưới bất kỳ hình thức nào (A22) |
| `POST` | `/api/v1/groups` | Body (phẳng): `name` (bắt buộc, 1–100 ký tự sau trim), `description` (tùy chọn, ≤500 ký tự sau trim, rỗng → `null`). **Không permit** `organization_id`, `id`, `created_at`, `updated_at` dù client gửi kèm | `201`: `{ "group": { id, name, description, created_at, updated_at } }`<br>`422`: lỗi field `name`/`description` | Như trên | `current_organization.groups.build(...)` — không bao giờ `Group.new` trần; `organization_id` luôn lấy từ token (A22, A6) |
| `PATCH` | `/api/v1/groups/:id` | Body (phẳng): subset của `name`, `description`. **Không permit** `organization_id` | `200`: `{ "group": {...} }`<br>`422`: lỗi field<br>`404`: `{ "error": "Not found" }` | Như trên | `policy_scope(Group).find(params[:id])` — 404 nếu `:id` thuộc org khác / không tồn tại / sai định dạng (A1–A3, **không phải 403**) |
| `DELETE` | `/api/v1/groups/:id` | — (không body, không query param) | `204` **No Content**, body rỗng<br>`404`: `{ "error": "Not found" }` | Như trên | `policy_scope(Group).find(params[:id])` — 404 như trên; **không xóa gì** khi 404 (acceptance §11 "Xóa Group của Organization khác trả về 404 và không xóa gì") |

**Không có `GET /api/v1/groups/:id`** — SoT OQ-5 đã chốt không làm trang chi
tiết Group ở F5; form Sửa prefill từ dữ liệu đã có trong response của `GET
/api/v1/groups` (đúng cách F3 làm với form Sửa Device). F6 sẽ thêm `show`
khi có nội dung thật (tab Thành viên/Policies).

**Không có field `devices_count`** trong bất kỳ response nào — SoT OQ-4 đã
chốt không bịa field rỗng vào contract F5; F6 bổ sung.

### Route

Thêm đúng 1 dòng vào `api/config/routes.rb` (trong `namespace :api` →
`namespace :v1` đã có):

```ruby
resources :groups, only: [ :index, :create, :update, :destroy ]
```

Cố ý **không** mở `:show`/`:new`/`:edit` — Rails không sinh route dư, và
`GET /api/v1/groups/1` sẽ trả 404 routing tự nhiên (không phải nút chết ở
FE vì FE không gọi).

### Pundit — `GroupPolicy` (mới)

`api/app/policies/group_policy.rb`, cùng style `DevicePolicy` (SoT §9: không
phân role nội bộ org; ranh giới thật nằm ở `Scope`):

```ruby
class GroupPolicy < ApplicationPolicy
  def index?
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

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.organization.groups
    end
  end
end
```

Ghi chú bắt buộc cho implementer:

- **Không** khai báo `show?` — F5 không có action `show` (OQ-5); khai báo
  thừa sẽ là dead code. `ApplicationPolicy#show?` mặc định `false` vẫn giữ
  đúng tinh thần deny-by-default nếu ai đó lỡ thêm route `show` mà quên mở
  policy.
- `destroy?` trả `true` **không phải** là "ai cũng xóa được mọi group" —
  `authorize group` chỉ chạy **sau khi** record đã được tìm qua
  `policy_scope(Group)`, nên group của org khác không bao giờ đến được bước
  này (đã 404 từ trước). Đây đúng là mô hình đã dùng cho `update?` ở F3.
- `Scope#resolve` đi qua association `user.organization.groups`, **không**
  `Group.where(organization_id: ...)` — cùng quy tắc với `DevicePolicy::Scope`.
- `Organization has_many :groups` là association mới do `docs/design/F5-db.md`
  §1 chốt; `Scope#resolve` phụ thuộc trực tiếp vào nó.

## 2. Business logic từng endpoint

### 2.1 `GET /api/v1/groups`

Read-only, **không** cần transaction (không ghi gì). Thứ tự thao tác:

1. `Authenticatable#authenticate_request!` (qua `before_action`) → có
   `current_organization`; thiếu/sai token → 401 và action không chạy (A20).
2. **Validate `page`/`per_page` trước mọi thứ khác** (A17) — tái dùng nguyên
   logic đã chốt ở `docs/design/F2-api.md` §2 bước 2:
   - Coerce bằng `Integer(raw.to_s, 10, exception: false)` — **không bao giờ**
     `String#to_i` (`"12abc".to_i` → `12` là giá trị sai được chấp nhận
     nhầm). Base 10 tường minh để `"010"` không bị đọc thành octal.
   - Param **vắng mặt/blank** → dùng default (`page=1`, `per_page=20`),
     không phải lỗi.
   - Param có mặt nhưng coerce ra `nil` hoặc `<= 0` → thêm
     `{ page: ["must be a positive integer"] }` / `{ per_page: [...] }` vào
     error hash. **Gom cả 2 param rồi trả 1 lần** (nếu cả 2 cùng sai thì cả
     2 key cùng xuất hiện), không dừng ở lỗi đầu tiên.
   - Có lỗi → render 422 và **dừng**, không query DB.
3. **Clamp `per_page`**: `[per_page, 100].min` (A18) — **không phải lỗi**,
   không thêm vào error hash. `meta.per_page` trong response phản ánh
   **giá trị đã clamp**, không echo lại giá trị client gửi (đúng F2).
4. **Build scope** (chỉ chạy khi bước 2 sạch):
   ```ruby
   authorize Group                  # GroupPolicy#index? — luôn true
   scope = policy_scope(Group)      # → current_organization.groups
   scope = scope.where("name ILIKE ?", "%#{Group.sanitize_sql_like(q)}%") if q.present?
   scope = scope.order(created_at: :desc, id: :desc)
   ```
   - **`q` được normalize trước**: `params[:q].to_s.strip` → nếu rỗng (không
     gửi, `""`, hoặc chỉ khoảng trắng) thì **không filter** ("tất cả"), đúng
     SoT OQ-6. Chuỗi chỉ-khoảng-trắng **không** là lỗi — không có nhánh 422
     nào cho `q` (xem §3).
   - **`sanitize_sql_like` là bắt buộc, không phải "cho đẹp"**: nếu không
     escape, user gõ `%` sẽ match **mọi** group và gõ `_` sẽ match ký tự bất
     kỳ — tức là ký tự người dùng gõ bị hiểu thành wildcard của `LIKE`, một
     lỗi hành vi nhìn thấy được (search "100%" ra toàn bộ danh sách). Đây là
     pattern mới của dự án (F2 chỉ có `where(col: value)` với enum đã
     whitelist), nên ghi tường minh ở đây để implementer không bỏ sót.
     Gọi dưới dạng **class method trên model** (`Group.sanitize_sql_like`) —
     `ActiveRecord::Sanitization::ClassMethods#sanitize_sql_like` không tồn
     tại trong scope của controller, viết trần `sanitize_sql_like(q)` sẽ
     `NoMethodError` → 500.
   - **Luôn dùng placeholder `?`**, không nội suy chuỗi vào SQL — chống SQL
     injection (giá trị `q` là chuỗi tự do do client gõ, khác hẳn
     `platform`/`status` của F2 vốn đã được whitelist bằng `.in?` trước khi
     chạm ActiveRecord).
   - `ILIKE` là toán tử của PostgreSQL (dự án chốt Postgres 16 ở `CLAUDE.md`
     §1) — không portable sang SQLite/MySQL, đây là phụ thuộc đã chấp nhận
     và được SoT OQ-6 gọi tên.
   - **Sort `created_at DESC, id DESC`** (OQ-7) — đúng index
     `groups(organization_id, created_at, id)` của `docs/design/F5-db.md` §3.
     Tie-break bằng `id` để thứ tự xác định tuyệt đối → acceptance scenario
     "Group vừa tạo hiện ngay ở đầu danh sách" luôn xanh, không phụ thuộc
     thứ tự trả về của Postgres.
5. **Đếm**: `total_count = scope.count` — trên relation **đã org-scope + đã
   lọc `q`**, **trước** `limit/offset` (SoT §4 bước 3, §6, §10). Không
   `.to_a.size`.
6. **Phân trang**: `records = scope.offset((page - 1) * per_page).limit(per_page)`.
   `page` vượt cuối (A16) **không cần nhánh code riêng** — `OFFSET` lớn hơn
   số dòng thực tự trả tập rỗng, đúng hành vi đã chốt (200 + mảng rỗng,
   `meta` vẫn phản ánh đúng `total_count`/`total_pages` của toàn tập đã lọc).
7. `total_pages = total_count.zero? ? 0 : (total_count.to_f / per_page).ceil`
   (tránh chia 0 → `NaN`).
8. Render 200 theo shape §1, mỗi group đi qua `serialize_group` tường minh
   (không `to_json` record trần).

**N+1**: không có — `name`/`description` nằm ngay trên `groups`, không join
bảng nào, không `devices_count` (OQ-4). Không cần `includes`.

### 2.2 `POST /api/v1/groups`

1. `authenticate_request!` (có sẵn) → `current_organization`.
2. `authorize Group` — `GroupPolicy#create?` (luôn `true`). Gọi ở **mức
   class** (chưa có instance nào cần authorize theo field), nhất quán với
   `DevicesController#create` của F3.
3. **Không có guard kiểu enum nào cần chạy trước** (khác hẳn F3, nơi
   `platform` sai enum sẽ raise `ArgumentError` nếu chạm ActiveRecord):
   `name`/`description` là string tự do, mọi giá trị sai đều bị bắt bởi
   validation của model và trở thành 422 field-level một cách tự nhiên.
   `name: nil` cũng an toàn — callback `normalize_name_and_description` có
   guard `is_a?(String)` (`docs/design/F5-db.md` §1b), không `NoMethodError`.
4. Build & save:
   ```ruby
   group = current_organization.groups.build(create_params)
   if group.save
     render json: { group: serialize_group(group) }, status: :created
   else
     render_validation_errors(group.errors.messages)
   end
   ```
   - `current_organization.groups.build(...)` → `organization_id` **luôn** là
     org của token; không có đường nào client ghi đè (A22, và acceptance
     scenario "Gửi organization_id trong request tạo Group không đổi được
     org đích"). Đây là lớp phòng thủ **thứ nhất**; strong params không
     permit `organization_id` là lớp **thứ hai** — giữ cả hai.
   - `group.errors.messages` đã sẵn shape `{ field => [msg, ...] }` — không
     cần biến đổi. Nhiều field lỗi cùng lúc (`name` blank + `description`
     quá dài) → cả 2 key xuất hiện trong cùng 1 response.
   - `before_validation` của model trim `name`/`description` và đổi
     description blank → `nil` **trước** khi validate → A4 (`"   "` → 422
     field `name`) và A25 (`description: ""` → lưu `NULL`, 201) là hệ quả
     tự nhiên, controller không cần code gì thêm.
   - Thành công → **201** + `{ "group": {...} }`.
5. **Race condition A7** — `rescue_from ActiveRecord::RecordNotUnique` khai
   báo **local trong `GroupsController`** (không phải `ApplicationController`
   — message là ngữ nghĩa riêng của `Group`, đúng quyết định đã ghi ở
   `docs/design/F3-api.md` §5 "mỗi controller tự khai `rescue_from` riêng
   với message của mình, không tổng quát hoá sớm"):
   ```ruby
   rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken

   def render_name_taken
     render_validation_errors(name: [ Group::NAME_TAKEN_MESSAGE ])
   end
   ```
   Message **giống hệt** nhánh validate uniqueness thường (A5) nhờ dùng
   chung hằng `Group::NAME_TAKEN_MESSAGE` (`docs/design/F5-db.md` §1 đã chốt
   hằng này tồn tại trên model) → client **không phân biệt được** 2 nhánh,
   đúng acceptance scenario "Hai request tạo Group trùng tên đồng thời...
   nhận lỗi 422 ở field name, không phải 500".
   `rescue_from` này phủ cả `create` lẫn `update` (A9 cũng có thể thua race
   khi đổi tên) — không cần 2 handler.

**Strong params (`create`):**
```ruby
def create_params
  params.permit(:name, :description)
end
```
Cố tình **không** permit `:organization_id`, `:id`, `:created_at`,
`:updated_at`.

### 2.3 `PATCH /api/v1/groups/:id`

1. `authenticate_request!` (có sẵn).
2. **Tìm record**: `group = policy_scope(Group).find(params[:id])` → raise
   `RecordNotFound` nếu thuộc org khác / không tồn tại / id sai định dạng →
   404 tự động qua rescue toàn cục (A1–A3, A12). **Không** dùng
   `Group.find` (CLAUDE.md §4).
3. `authorize group` — `GroupPolicy#update?` (luôn `true`). Gọi ở **mức
   instance** (đã có record), đúng convention Pundit chuẩn và nhất quán với
   `DevicesController#update`.
4. Update:
   ```ruby
   if group.update(update_params)
     render json: { group: serialize_group(group) }
   else
     render_validation_errors(group.errors.messages)
   end
   ```
   - **A8 (giữ nguyên tên cũ của chính nó → 200, không báo trùng)**: hệ quả
     tự nhiên của `validates :name, uniqueness: { scope: :organization_id }`
     — Rails tự loại chính record đang sửa ra khỏi truy vấn kiểm tra
     (`WHERE ... AND id != ?`). Không cần code gì thêm, **nhưng phải có test
     riêng** vì đây là chỗ dễ hỏng nếu ai đó thay validator bằng check thủ
     công.
   - **PATCH partial**: client chỉ gửi `description` → `update_params` chỉ
     có `description`, `name` không bị đụng. Client gửi `description: ""` →
     callback normalize → `NULL` (xóa mô tả — hành vi mong muốn, không phải
     "bỏ qua field"). Client gửi `description: null` → `nil`, cùng kết quả.
   - `group.update` là **1 transaction ngầm của ActiveRecord**, đủ cho 1
     record đơn — không cần `ActiveRecord::Base.transaction` thủ công.
   - Thành công → **200** + `{ "group": {...} }` với dữ liệu đã cập nhật
     (giá trị đã trim, vì callback chạy trước khi ghi → response không bị
     "drift" so với DB, không cần `reload`).

**Strong params (`update`):**
```ruby
def update_params
  params.permit(:name, :description)
end
```
Trùng danh sách với `create_params` (khác F3, nơi `create`/`update` permit
khác nhau vì `identifier` bất biến). Implementer **vẫn nên giữ 2 method
riêng** thay vì gộp thành 1 `group_params`: F6/F8 nhiều khả năng permit thêm
field chỉ dành cho 1 trong 2 action, và gộp sớm sẽ phải tách lại. (Nếu
người duyệt thấy đây là trùng lặp không cần thiết, xem §5.)

### 2.4 `DELETE /api/v1/groups/:id`

Đây là **phần quan trọng nhất của F5** (`CLAUDE.md` §4: "Xóa Group không để
dữ liệu treo") và cũng là chỗ dễ sai nhất.

1. `authenticate_request!` (có sẵn).
2. **Tìm record**: `group = policy_scope(Group).find(params[:id])` → 404 cho
   A1/A2/A3/A12. Vì record được tìm **trước** khi xóa bất cứ thứ gì, case
   "org khác → 404 **và không xóa gì**" là hệ quả tự động (không có lệnh
   `DELETE` nào được phát sinh trên đường 404).
3. `authorize group` — `GroupPolicy#destroy?` (luôn `true`), mức instance.
4. **Xóa**:
   ```ruby
   group.destroy!
   head :no_content
   ```

**Bốn quyết định chốt tại đây (đọc kỹ trước khi implement):**

- **BẮT BUỘC `#destroy`/`#destroy!`, TUYỆT ĐỐI KHÔNG `#delete`/`#delete_all`.**
  `docs/design/F5-db.md` §4a nêu đây là "cái bẫy lớn nhất của feature này":
  `Group#delete` phát 1 câu `DELETE FROM groups WHERE id = ?` và **bỏ qua
  toàn bộ `dependent:`** → ở F5 (chưa có bảng join) trông vẫn "chạy đúng",
  nhưng đến F6/F8 nó sẽ để lại `group_memberships`/`policy_assignments` mồ
  côi hoặc nổ FK — tức là vi phạm invariant nặng nhất của đề bài một cách
  **im lặng**, và bug sẽ được introduce ở F5 chứ không phải F6. Rule này phải
  được nhắc lại trong `docs/plan/F5-*.md` và trong comment của action.
- **Transaction boundary**: `ActiveRecord::Persistence#destroy` **tự bọc**
  việc chạy mọi callback `dependent:` + `DELETE` bản ghi cha trong **một**
  transaction. Vì vậy **không** viết `ActiveRecord::Base.transaction do ...
  end` thủ công ở controller — thừa, và tệ hơn là tạo ảo giác rằng transaction
  đến từ controller (khiến F6/F8 tưởng có thể đổi `destroy` thành `delete` mà
  vẫn an toàn). A13 ("lỗi hạ tầng không xóa nửa vời") được đảm bảo bởi chính
  transaction ngầm này: bất kỳ lỗi nào ở giữa → rollback → group **còn
  nguyên**.
- **Dùng `destroy!` (bang), không `destroy`**: ở F5 `Group` **không có**
  callback `before_destroy` nào có thể `throw(:abort)`, nên `destroy` luôn
  trả truthy — viết thêm nhánh `if group.destroy ... else render 422 ... end`
  sẽ là **dead code không test được** (đúng nguyên tắc đã áp dụng ở
  `ApplicationController`: không thêm `rescue_from Pundit::NotAuthorizedError`
  khi chưa policy nào deny được). Nhưng bỏ qua giá trị trả về của `destroy`
  cũng sai — sẽ trả `204` trong khi không xóa được gì. `destroy!` giải quyết
  cả hai: hôm nay không bao giờ raise; ngày mai nếu F6/F8 thêm guard chặn xóa
  thì nó **raise `ActiveRecord::RecordNotDestroyed` → 500 ồn ào** thay vì nói
  dối 204. **Nghĩa vụ bàn giao**: feature nào thêm guard chặn xóa group phải
  đồng thời đổi chỗ này thành nhánh 422 tường minh — ghi vào `DESIGN.md`.
- **Status code: `204 No Content`, body rỗng** (SoT §8 để ngỏ "204 hoặc 200,
  chốt ở /design" → **chốt 204**). Lý do: sau khi xóa không còn resource nào
  để trả; FE luôn refetch danh sách ngay sau đó (SoT §4 bước 4 + §5.1
  "xóa dòng cuối của trang > 1"), nên một body `{ "group": {...} }` của record
  vừa biến mất chỉ gây hiểu nhầm. `head :no_content` (không `render json:
  nil`) để không gửi body rỗng kèm `Content-Type: application/json` —
  Axios ở FE nhận `response.data === ""`, hợp đồng rõ ràng.

**Không có side effect nào khác**: không enqueue job (F5 xóa đúng 1 row —
SoT §10), không gửi thông báo, không audit log (ngoài phạm vi, SoT §3).

**Không idempotent theo nghĩa HTTP thuần**: gọi `DELETE` lần 2 trên cùng id
trả **404**, không phải 204 (vì hard delete — OQ-2; record đã biến mất khỏi
mọi truy vấn). Đây là hành vi mong muốn và chính là cái A12 mô tả: FE hiện
toast "Group không tồn tại hoặc đã bị xóa" rồi refresh. A24 (double-click chỉ
1 request) là **nghĩa vụ của FE** (nút tự disable), không phải của API — API
không có cơ chế dedupe request và không cần có ở F5.

### 2.5 Serializer dùng chung

```ruby
def serialize_group(group)
  {
    id: group.id,
    name: group.name,
    description: group.description,
    created_at: group.created_at,
    updated_at: group.updated_at
  }
end
```

- Đúng 5 field, **không** `organization_id` (thừa — client chỉ có 1 org,
  và trả ra là gợi ý sai rằng client có thể đổi nó), **không** `devices_count`
  (OQ-4).
- `description` là `null` (JSON) khi không có mô tả — không bao giờ `""`,
  nhờ callback normalize ở model. FE render ô trống, không hiện chữ "null"
  (A25) — đó là việc của FE nhưng contract ở đây đảm bảo chỉ có **một** cách
  biểu diễn "không có mô tả".
- `created_at`/`updated_at` trả cùng format ISO8601 mặc định của Rails,
  giống `serialize_device`.

## 3. Lỗi / edge case — map đầy đủ A1–A25 (SoT §5.2)

| SoT | Tình huống | Status | Body | Cơ chế (code nào xử lý) |
|---|---|---|---|---|
| **A1** | `PATCH`/`DELETE` với `:id` thuộc **Organization khác** | `404` | `{ "error": "Not found" }` | `policy_scope(Group).find` → record đã bị `Scope#resolve` loại → `RecordNotFound` → rescue toàn cục F0. **Không code mới.** Không bao giờ 403 (`CLAUDE.md` §4 — không lộ sự tồn tại) |
| **A2** | `:id` **không tồn tại** trong hệ thống | `404` | Giống hệt A1 | Cùng một dòng code, không phân biệt được với A1 — đó là mục đích |
| **A3** | `:id` **sai định dạng** (`"abc"`, `"1;drop table groups"`) | `404`, **không 500** | Giống hệt A1 | `find` với id phi số raise `RecordNotFound`, không `StatementInvalid` — đã xác nhận thực nghiệm ở `docs/design/F4-db.md` §4. **Không cần guard/rescue riêng** |
| **A4** | Tạo/sửa với `name` rỗng hoặc chỉ khoảng trắng | `422` | `{ "errors": { "name": ["Tên group không được để trống"] } }` | `before_validation` trim → `presence: { message: Group::NAME_BLANK_MESSAGE }` |
| **A5** | Tạo trùng `name` **trong cùng org** | `422` | `{ "errors": { "name": ["Tên group này đã tồn tại trong tổ chức của bạn."] } }` | `validates uniqueness: { scope: :organization_id, case_sensitive: true, message: Group::NAME_TAKEN_MESSAGE }` |
| **A6** | Tạo trùng `name` với group của **org khác** | `201` | `{ "group": {...} }` | Không phải nhánh lỗi — `uniqueness` có `scope: :organization_id` và unique index là composite `[organization_id, name]`. Hệ quả tự nhiên, **nhưng phải có test riêng** (acceptance §11) |
| **A7** | **Race**: 2 request tạo cùng `name`, cùng org, đồng thời | `422` (request thua), **không 500** | Giống hệt A5, không phân biệt được | Unique index DB raise `ActiveRecord::RecordNotUnique` → `rescue_from` local ở `GroupsController` → `render_name_taken` (§2.2 bước 5) |
| **A8** | Sửa giữ nguyên `name` cũ của chính nó | `200` | `{ "group": {...} }` | `uniqueness` validator tự loại chính record (`id != ?`). Không code mới, **có test riêng** |
| **A9** | Sửa `name` thành tên group khác đang dùng trong org | `422` | Giống hệt A5 | Cùng validator; nếu thua race thì rơi vào A7 (cùng `rescue_from`) |
| **A10** | `name` > 100 hoặc `description` > 500 ký tự | `422` | `{ "errors": { "name": ["is too long (maximum is 100 characters)"] } }` (tương tự cho `description`, max 500) | `validates length: { maximum: ... }` (`docs/design/F5-db.md` §1). Message là default của Rails — xem §5 (điểm cần xác nhận về ngôn ngữ message) |
| **A11** | Xóa group **đang có device/policy gán** | `204` | rỗng | Ở F5 chưa có bảng join nên chưa có gì để gỡ; hợp đồng hành vi (`destroy` + `dependent: :delete_all` + 1 transaction) đã chốt ở §2.4 — **thực thi + test là nghĩa vụ carry-over của F6/F8** (SoT OQ-3, `F5-db.md` §4a) |
| **A12** | Xóa/sửa group vừa bị người khác xóa | `404` | `{ "error": "Not found" }` | Hard delete (OQ-2) → record không còn trong scope → `RecordNotFound`. FE: toast + refresh list |
| **A13** | `DELETE` thất bại do lỗi hạ tầng | `500` | (Rails default) | Transaction ngầm của `destroy!` rollback → group **còn nguyên**. Không thiết kế riêng ở tầng API (không phải business logic); FE xử lý theo status code (`UI_UX_design.md` §9) |
| **A14** | Org chưa có group nào | `200` | `{ "groups": [], "meta": { current_page: 1, per_page: 20, total_count: 0, total_pages: 0 } }` | Không phải lỗi. FE phân biệt A14 vs A15 bằng **`q` rỗng hay không** (state của chính FE), API không trả cờ nào cho việc này |
| **A15** | Search không khớp | `200` | `{ "groups": [], "meta": { ..., total_count: 0, total_pages: 0 } }` | Shape **giống hệt** A14 — có chủ đích, xem ghi chú A14 |
| **A16** | `page` vượt quá số trang hiện có | `200` | `{ "groups": [], "meta": { current_page: 99, per_page: 20, total_count: 3, total_pages: 1 } }` | `OFFSET` tự trả rỗng — **không** check `page > total_pages` thủ công (§2.1 bước 6). `meta` vẫn đúng toàn tập |
| **A17** | `page`/`per_page` không phải số nguyên dương | `422` | `{ "errors": { "page": ["must be a positive integer"] } }` (hoặc `per_page`, hoặc **cả hai cùng lúc**) | `pagination_errors` chạy trước mọi query (§2.1 bước 2). Message giữ **đúng nguyên văn** của F2 để FE/test dùng chung 1 hằng |
| **A18** | `per_page` > 100 | `200` | `meta.per_page` = `100` (giá trị **đã clamp**, không echo giá trị client gửi) | Clamp im lặng, không lỗi (§2.1 bước 3) |
| **A19** | Lỗi hạ tầng khi `GET` list | `500` | (Rails default) | Không thiết kế riêng; FE hiện ErrorState + "Thử lại" |
| **A20** | Gọi bất kỳ endpoint groups nào **không có token** / token hết hạn / user bị deactivate | `401` | `{ "error": "Unauthorized" }` | `Authenticatable#authenticate_request!` chạy ở `before_action`, action không bao giờ chạy. **Không code mới** |
| **A21** | Chưa đăng nhập mở thẳng `/groups` | — | — | Thuần FE (router guard), không có API touchpoint |
| **A22** | Client gửi `organization_id` trong body/query | `201`/`200` **bình thường**, org đích **không đổi** | `{ "group": {...} }` với org của token | Không phải nhánh lỗi (không 422, không 400) — 2 lớp: strong params không permit + `current_organization.groups.build`. Acceptance §11 assert "Globex Corp. không có thêm group nào" |
| **A23** | Bấm "Hủy" ở ConfirmModal | — | — | Thuần FE — **không phát sinh request nào**. API không biết case này tồn tại |
| **A24** | Double-click nút xác nhận xóa | — | — | Thuần FE (nút disable). Nếu request thứ 2 vẫn lọt ra → nhận `404` (xem §2.4), **không phải 500** — vẫn an toàn |
| **A25** | `description` để trống khi tạo | `201` | `{ "group": { ..., "description": null } }` | Callback `description.strip.presence` → `nil`. Chỉ có **một** cách biểu diễn "không mô tả" trong toàn hệ thống |

**Không có nhánh lỗi nào cho `q`**: mọi giá trị (rỗng, khoảng trắng, chuỗi
rất dài, ký tự đặc biệt `%`/`_`/`'`) đều hợp lệ và trả `200` — chuỗi không
khớp gì thì trả mảng rỗng (A15). Cố ý **không** giới hạn độ dài `q` bằng 422:
SoT không yêu cầu, và một `q` dài chỉ tốn 1 lần so khớp trong phạm vi 1 org.

**Không có nhánh 403 nào trong toàn bộ F5** — mọi vi phạm ranh giới org đều
là 404 (`CLAUDE.md` §4). Nếu implementer thấy mình đang viết `render ...,
status: :forbidden`, đó là dấu hiệu đã đi sai hướng.

**Không có `rescue_from ActiveRecord::RecordNotDestroyed`** — xem lý do ở
§2.4 (raise → 500 ồn ào là hành vi mong muốn cho tới khi có guard thật).

## 4. Xử lý bất đồng bộ

**Không áp dụng ở F5.** Cả 4 endpoint đều thao tác trên tối đa **1 row** của
bảng `groups` (list chỉ đọc, create/update/delete ghi 1 record) — không có
thao tác hàng loạt nào, không enqueue Solid Queue job, không có endpoint poll
trạng thái, không cần idempotency key.

Ghi nhận ranh giới để không bị hiểu nhầm là thiếu sót: bài toán "Group 10.000
device / thao tác hàng loạt phải async + `pending/running/done/failed` +
`upsert_all` idempotent" (`CLAUDE.md` §4, `PRD.md` §"Điểm khó") thuộc **F6**
(thêm/gỡ device) và **F8** (gán policy cho group), không phải F5. Cảnh báo
kèm theo từ `docs/design/F5-db.md` §3: khi `group_memberships` có thể tới
10.000 dòng/group, `DELETE /api/v1/groups/:id` sẽ kéo theo một lệnh
`DELETE FROM group_memberships WHERE group_id = ?` trong cùng transaction —
**F6 phải đánh giá lại** thời gian giữ transaction và quyết định có chuyển
sang xóa bất đồng bộ hay không. Quyết định đó **không** thuộc F5, nhưng
`DESIGN.md` phải ghi rằng nó được chuyển tiếp từ đây.

## 5. Rủi ro / open question

### OQ-API-1 (cần người quyết định) — Code phân trang đang bị "khóa" trong `DevicesController`

Toàn bộ logic phân trang đã chốt ở F2 (`DEFAULT_PAGE`, `DEFAULT_PER_PAGE`,
`MAX_PER_PAGE`, `PAGINATION_ERROR`, `pagination_errors`,
`valid_pagination_param?`, `coerce_positive_integer`, `page`, `per_page`,
`total_pages`) hiện là **`private` của `Api::V1::DevicesController`**. F5 là
lần đầu một controller **khác** cần đúng khối đó, và F7 (Policies list) sẽ là
lần thứ ba. Hai phương án:

- **(a) Tách `Paginatable` concern** (`api/app/controllers/concerns/paginatable.rb`),
  `DevicesController` và `GroupsController` cùng `include`. — **Khuyến nghị.**
  Đây là refactor **thuần túy giữ nguyên hành vi** (di chuyển method, không
  đổi logic), đã có sẵn lưới an toàn là request spec của F2 + acceptance test
  F2 để bắt hồi quy. Lợi ích thật, không phải trừu tượng hoá sớm: nếu copy,
  hằng `MAX_PER_PAGE = 100` và message `"must be a positive integer"` tồn tại
  ở ≥2 nơi và **chắc chắn sẽ lệch nhau** khi có người sửa 1 chỗ — đúng loại
  bug mà FE/test không phát hiện ngay (`meta.per_page` khác nhau giữa 2 danh
  sách). Đây cũng là lần thứ 2 gặp cùng một nhu cầu (rule of three gần đạt),
  khác hẳn tình huống `rescue_from RecordNotUnique` mà F3 cố ý **không** tổng
  quát hoá — ở đó message là ngữ nghĩa riêng của từng resource, còn ở đây
  logic phân trang giống hệt nhau từng ký tự.
- **(b) Copy khối đó sang `GroupsController`.** Không đụng vào code F2 đã
  xanh 4 gate (rủi ro hồi quy = 0), đổi lại chấp nhận trùng lặp và nguy cơ
  lệch nêu trên.

Cần người duyệt chốt **trước khi** lên plan, vì (a) làm plan F5 có thêm một
task chạm vào file của F2 (và do đó gate #2 phải chạy lại toàn bộ device
spec), còn (b) thì không. Tài liệu này **không tự quyết định** vì nó ảnh
hưởng tới code đã approve của feature khác.

**Quyết định (approve):** chọn **(a)** — tách `Paginatable` concern
(`api/app/controllers/concerns/paginatable.rb`), `DevicesController` và
`GroupsController` cùng `include`. Refactor thuần giữ nguyên hành vi. Plan F5
phải có 1 task riêng cho việc này (di chuyển method, không đổi logic) và gate
rspec phải chạy lại toàn bộ `devices_spec.rb` để xác nhận không hồi quy.

### OQ-API-2 (cần người duyệt xác nhận) — Ngôn ngữ của message lỗi độ dài (A10)

`docs/design/F5-db.md` §1 chốt `name` dùng message **tiếng Việt** cho
`presence` (`Group::NAME_BLANK_MESSAGE` = "Tên group không được để trống") và
**tiếng Anh mặc định của Rails** cho `length` ("is too long (maximum is 100
characters)"). Tức là trong cùng một form, user có thể thấy 1 lỗi tiếng Việt
và 1 lỗi tiếng Anh. Lưu ý: F3 cũng đã trộn (blank = `"can't be blank"` tiếng
Anh, uniqueness = tiếng Việt), nên đây **không** phải mâu thuẫn mới do F5 tạo
ra, cũng **không** phải mâu thuẫn giữa SoT và thiết kế DB (cả hai đều không
chốt câu chữ cho A10 — SoT §11 chỉ assert "lỗi 422 ở field name").

- **Khuyến nghị: giữ nguyên message mặc định của Rails cho `length`** ở F5 —
  đổi ngôn ngữ message là quyết định toàn dự án (ảnh hưởng cả F0/F3 đã
  approve và mọi assertion đang có), không nên làm lặt vặt trong 1 feature.
- Nếu người duyệt muốn đồng bộ tiếng Việt: cần thêm 2 hằng
  (`NAME_TOO_LONG_MESSAGE`, `DESCRIPTION_TOO_LONG_MESSAGE`) vào `Group`, và
  nên mở một quyết định riêng để chuẩn hoá i18n cho **toàn bộ** message của
  `User`/`Device`/`Group` một lượt.

Điểm này **không chặn** việc implement: acceptance test của F5 assert 422 ở
field `name`, không assert câu chữ của lỗi độ dài.

**Quyết định (approve):** giữ nguyên message mặc định tiếng Anh của Rails cho
`length`. Không chuẩn hoá i18n trong F5.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **`#destroy` vs `#delete` là cái bẫy chính của feature** (§2.4). Nếu
  implementer viết `group.delete` thì mọi test của F5 vẫn **xanh** (chưa có
  bảng join), và invariant nặng nhất của đề bài sẽ vỡ âm thầm ở F6/F8. Phải
  có comment giải thích ngay tại action, phải là một mục riêng trong
  `docs/plan/F5-*.md`, và `DESIGN.md` phải ghi lại.
- **`ILIKE` + `sanitize_sql_like` là pattern mới của dự án** (§2.1 bước 4).
  Quên `sanitize_sql_like` → ký tự `%`/`_` người dùng gõ bị hiểu thành
  wildcard (bug hành vi, không phải lỗi bảo mật). Nội suy chuỗi thay vì
  placeholder → SQL injection (lỗi bảo mật thật). Cả hai đều **không** bị
  bất kỳ acceptance scenario nào ở SoT §11 bắt được → nghĩa vụ của
  `slice-implementer` là thêm request spec riêng cho `q = "100%"` và
  `q = "' OR 1=1 --"`.
- **Search `q` không dùng được index** (`ILIKE '%...%'`, wildcard đầu chuỗi)
  — đã chấp nhận ở SoT §10 và `docs/design/F5-db.md` §3 (`organization_id`
  đứng đầu index nên Postgres thu hẹp về 1 org trước). Phải ghi vào
  `DESIGN.md` như rủi ro production đã biết, kèm đường đi sẵn (`pg_trgm` +
  GIN index) — **không** làm ở F5.
- **Unique case-sensitive + search case-insensitive** (`F5-db.md` §4c): trong
  cùng org, `"Sales Team"` và `"sales team"` là 2 group hợp lệ, và search
  `"sales"` trả về **cả hai**. Không phải bug — hệ quả đã biết của OQ-1 +
  OQ-6, ghi vào `DESIGN.md`.
- **A14 và A15 trả response giống hệt nhau** (§3): API cố ý không trả cờ
  `searched: true`. FE tự phân biệt bằng state `q` của chính nó — nếu
  `frontend-designer` thấy cần cờ từ server, đó là một thay đổi contract
  phải quay lại sửa file này, không tự thêm.
- **Nghĩa vụ carry-over cho F6/F8** (nhắc lại từ `F5-db.md` §4a để không
  trôi qua tầng API): F6 thêm `has_many :group_memberships, dependent:
  :delete_all` + F8 thêm `has_many :policy_assignments, dependent:
  :delete_all` vào `Group`; mỗi feature tự viết test "xóa group → không còn
  join row mồ côi, device/policy vẫn tồn tại". Action `destroy` thiết kế ở
  §2.4 **không cần sửa một dòng nào** khi 2 association đó xuất hiện — đó
  chính là lý do nó phải gọi `destroy!` ngay từ F5.
- **Không thêm `show`/`devices_count`/endpoint phụ nào khác** — OQ-4/OQ-5 đã
  chốt. `frontend-designer` (bước Frontend của `/design F5`) không được bịa
  thêm endpoint ngoài 4 endpoint ở §1; nếu thấy thiếu dữ liệu cho UI, phải
  dừng và báo cáo thay vì tự thiết kế API mới.
