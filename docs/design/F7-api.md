---
feature_id: F7
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc) — sửa 1 lỗi (§2.5, body 404 route-miss không phải HTML, đã verify bằng rails runner), chốt OQ-API-1 (to_unsafe_h) trước khi approve
date: 2026-09-17
---

# Thiết kế API — F7

Nguồn: `docs/design/F7-db.md` (approved — bảng `policies`, model `Policy`
với `self.inheritance_column = "_type_disabled"`, `enum status: { active: 0,
inactive: 1 }`, `Policy::NAME_TAKEN_MESSAGE`, unique index composite
`[organization_id, name]`, cảnh báo tường minh §1c "gán `status` string
ngoài enum raise `ArgumentError`, không phải lỗi validation" và §4d "org
isolation ở DB không đủ, cần API layer"), `docs/sot/F7-policy-crud.md`
(approved — §4 main flow, §5.2 edge case A1–A31, §6 business rule, §8 data &
API touchpoint, §9 RBAC, §11 acceptance criteria, §12 cả 10 OQ đã chốt theo
khuyến nghị), `docs/design/F5-api.md` (approved — cấu trúc gần nhất: CRUD
org-scoped đơn giản, pagination, search+filter, 422 envelope, `Paginatable`
concern), `docs/design/F6-api.md` (approved — skim cho `DeviceFilterable`
pattern chống `ArgumentError` khi filter theo enum, không dùng job/poll ở
F7), `docs/design/F0-api.md` (approved — envelope lỗi toàn cục, auth, `meta`
shape), `CLAUDE.md` §4, code hiện có `api/app/controllers/application_controller.rb`,
`api/app/controllers/concerns/{authenticatable,paginatable,device_filterable,device_serializable}.rb`,
`api/app/controllers/api/v1/{devices_controller,groups_controller}.rb`,
`api/app/policies/{application_policy,group_policy,device_policy}.rb`,
`api/config/routes.rb`, `api/db/schema.rb`.

**Kết luận đầu tiên:** F7 là **CRUD đơn giản nhất trong 3 resource controller
đã có** (Device/Group/Policy) — chỉ 3 action (`index`/`create`/`update`),
**không** `show`, **không** `destroy` (SoT OQ-2, OQ-7 đã chốt). Ba điểm mới
thật sự ở tầng API mà F5/F6 chưa từng gặp:

1. **`status` là enum, xuất hiện ở CẢ hai phía** — filter trên `GET` (query
   param) **và** field ghi trên `POST`/`PATCH` (body) — trong khi F2/F3 chỉ
   có enum ở filter (`platform`/`status` của Device) hoặc chỉ ở ghi (`Device
   #update`), chưa từng có 1 resource cần guard `ArgumentError` ở **cả 3
   action cùng lúc**. Xem §2.1/§2.2/§2.3 + §5 OQ-API-3.
2. **`configuration` là JSON tự do (jsonb), không phải scalar** — khác hẳn
   mọi field đã có ở F2–F6 (toàn bộ đều string/integer/enum). Strong params
   kiểu `permit(:field)` không đủ để vừa chấp nhận cấu trúc bất kỳ vừa phân
   biệt đúng "field không gửi" (giữ nguyên giá trị cũ khi `PATCH`) với "field
   gửi giá trị không phải object" (phải 422). Đây là cái bẫy lớn nhất của
   F7, xem §2.4.
3. **Không có route cho `GET /api/v1/policies/:id`**, nhưng acceptance
   scenario của SoT §11 vẫn gọi `GET /api/v1/policies/42` và kỳ vọng `404`
   (không phải lỗi routing 500) — cần xác nhận rõ cơ chế nào tạo ra `404` đó
   khi không có action nào xử lý route này. Xem §2.5.

## 0. Quy ước kế thừa từ F0/F2/F3/F5/F6 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần.
- **422** (field-level): `{ "errors": { "<field>": ["<message>"] } }` — qua
  `ApplicationController#render_validation_errors` đã có, **không** tạo
  helper/envelope mới.
- **401 / 404**: `{ "error": "<message>" }` — `{ "error": "Unauthorized" }`
  từ `Authenticatable`, `{ "error": "Not found" }` từ `rescue_from
  ActiveRecord::RecordNotFound` toàn cục ở `ApplicationController` (F0).
- **Auth**: `include Authenticatable` trong `PoliciesController` (mới) →
  `before_action :authenticate_request!`. Không sửa concern.
- **Request body phẳng, không bọc `policy:`** — đúng tiền lệ F3/F5. Client
  gửi `{ name, type, configuration, status }` ở top-level.
- **Response thành công bọc trong key resource** — `{ "policy": {...} }`
  cho `POST`/`PATCH`, `{ "policies": [...], "meta": {...} }` cho `GET` — đúng
  khuôn `{ "device": {...} }`/`{ "group": {...} }` đã có.
- **`meta` shape**: `{ current_page, per_page, total_count, total_pages }` —
  y hệt F2/F5, tái dùng nguyên `Paginatable` concern (`api/app/controllers/concerns/paginatable.rb`),
  **không** copy lại logic, đây đã là lần dùng thứ ba (Device, Group, nay
  Policy) — đúng đường đã mở sẵn từ F5 OQ-API-1.
- **Pundit**: `authorize` + `policy_scope` bắt buộc ở mọi action.
  `ApplicationPolicy` mặc định deny → `PolicyPolicy` (mới) phải khai báo
  tường minh từng action.
- **Không có `rescue_from ActiveRecord::RecordNotDestroyed`/không có logic
  xóa nào** — F7 không có `destroy` (SoT OQ-2).

**Lưu ý đặt tên (SoT §3 đã flag)**: class Pundit cho model `Policy` là
`PolicyPolicy` — **không** viết tắt/gọi chung chung là "the policy" trong
comment code khi đang nói tới class này, vì "policy" cũng là khái niệm chung
của Pundit (`authorize`/`policy_scope` đều lấy tên từ khái niệm đó) lẫn tên
model nghiệp vụ (`Policy`). Toàn bộ tài liệu này dùng **"Policy record"**
khi nói tới model nghiệp vụ, **"Pundit policy"**/`PolicyPolicy` khi nói tới
authorization class, không dùng "policy" trần một mình ở chỗ có thể gây
nhầm.

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `GET` | `/api/v1/policies` | Query: `q` (optional — tìm một phần trên `name`, không phân biệt hoa/thường), `status` (optional — `active`/`inactive`, giá trị khác → 422), `page`/`per_page` (optional, mặc định 1/20, max 100 — clamp im lặng) | `200`: `{ "policies": [ { id, name, type, configuration, status, created_at, updated_at } ], "meta": { current_page, per_page, total_count, total_pages } }`<br>`422`: lỗi field `page`/`per_page`/`status` | Bất kỳ user `active` thuộc org (không phân role — SoT §9) | `policy_scope(Policy)` → `current_organization.policies`; không bao giờ `Policy.all`/`Policy.where` trần; **không nhận `organization_id`** dưới bất kỳ hình thức nào (A28) |
| `POST` | `/api/v1/policies` | Body (phẳng): `name` (bắt buộc, 1–100 ký tự sau trim), `type` (bắt buộc, 1–100 ký tự sau trim), `configuration` (bắt buộc, phải là JSON object — kể cả `{}`), `status` (tùy chọn, `active`/`inactive`, mặc định `active` nếu không truyền — OQ-10; giá trị khác enum → 422). **Không permit** `organization_id`, `id`, `created_at`, `updated_at` | `201`: `{ "policy": {...} }`<br>`422`: lỗi field `name`/`type`/`configuration`/`status` | Như trên | `current_organization.policies.build(...)` — không bao giờ `Policy.new` trần; `organization_id` luôn từ token (A28) |
| `PATCH` | `/api/v1/policies/:id` | Body (phẳng): subset của `name`, `type`, `configuration`, `status` — mọi field sửa được kể cả `type` (OQ-4). **Không permit** `organization_id` | `200`: `{ "policy": {...} }`<br>`422`: lỗi field<br>`404`: `{ "error": "Not found" }` | Như trên | `policy_scope(Policy).find(params[:id])` — 404 nếu `:id` thuộc org khác/không tồn tại/sai định dạng (A1–A3, **không phải 403**) |

**Không có `DELETE /api/v1/policies/:id`** (SoT OQ-2 — PRD liệt kê hành động
cho Policy chỉ là "tạo/sửa/gán", không có "xóa" như Group; F7 chỉ hỗ trợ
chuyển `status` sang `inactive` qua `PATCH`, A29 khẳng định menu ⋯ không có
action "Xóa").

**Không có `GET /api/v1/policies/:id`** (SoT OQ-7 — trang chi tiết + 2 tab
gán Group/Device thuộc F8, dựng ở F7 sẽ là trang gần như trống; F3/F5 form
Sửa của F7 prefill từ dữ liệu đã có sẵn trong response của `GET
/api/v1/policies`, đúng cách F5 làm cho Group). Hệ quả của việc không có
route này với `GET /api/v1/policies/:id` (id bất kỳ) được xử lý ở §2.5 —
**đọc kỹ trước khi implement**, đây không phải "không cần làm gì".

**Không có field `assignments_count`/"Số nơi đang gán"** trong bất kỳ
response nào (SoT OQ-6 — chưa có `policy_assignments` ở F7, không bịa `0`).

### Route

Thêm đúng 1 dòng vào `api/config/routes.rb` (trong `namespace :api` →
`namespace :v1` đã có, cạnh `resources :groups`):

```ruby
resources :policies, only: [ :index, :create, :update ]
```

Cố ý **không** mở `:show`/`:destroy`/`:new`/`:edit`. Rails không sinh route
dư cho các action này — bất kỳ request nào gọi `GET /api/v1/policies/:id`
hay `DELETE /api/v1/policies/:id` đều **không khớp route nào cả** (khác hẳn
"route tồn tại nhưng action không tồn tại", là chưa từng đăng ký), xem hệ
quả ở §2.5.

### Pundit — `PolicyPolicy` (mới)

`api/app/policies/policy_policy.rb`, cùng style `GroupPolicy`/`DevicePolicy`
(SoT §9: không phân role nội bộ org — ranh giới thật nằm ở `Scope`):

```ruby
# Authorization for Policy (docs/design/F7-api.md §1).
#
# Naming note: this is the Pundit policy for the `Policy` model — the class
# name collision with the generic "Pundit policy" concept is intentional
# (there is no better name for a model literally called Policy) and is
# flagged so nobody reads "policy" in a comment here and can't tell which
# one it means (SoT F7 §3).
#
# No roles inside an Organization (SoT F7 §9): every active user may list,
# create and edit the org's policies, including flipping `status`. The real
# authorization boundary is the Scope below.
class PolicyPolicy < ApplicationPolicy
  def index?
    true
  end

  def create?
    true
  end

  def update?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      # Through the association, never Policy.where(...) — same rule as
      # every other org-scoped query in this codebase.
      user.organization.policies
    end
  end
end
```

Ghi chú bắt buộc cho implementer:

- **Không** khai báo `show?`/`destroy?` — F7 không có 2 action này (OQ-2,
  OQ-7); khai báo thừa là dead code. `ApplicationPolicy` mặc định `false`
  vẫn giữ đúng tinh thần deny-by-default nếu ai lỡ thêm route sau này mà
  quên mở policy.
- `Organization has_many :policies` là association mới do
  `docs/design/F7-db.md` §1 chốt; `Scope#resolve` phụ thuộc trực tiếp.

## 2. Business logic từng endpoint

### 2.1 `GET /api/v1/policies`

Read-only, không cần transaction. Thứ tự thao tác:

1. `authenticate_request!` (qua `before_action`) → `current_organization`;
   thiếu/sai token → 401, action không chạy (A26).
2. **Validate `page`/`per_page` trước** (`Paginatable#pagination_errors`,
   tái dùng nguyên vẹn) → lỗi → 422, dừng, không query DB (A22).
3. **Validate `status` filter** (mới, xem §2.6 cho định nghĩa `invalid_status?`):
   ```ruby
   errors = pagination_errors
   errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(params[:status])
   return render_validation_errors(errors) if errors.any?
   ```
   - Gộp chung với lỗi `page`/`per_page` trong **cùng một** response nếu
     nhiều field cùng sai (đúng quy ước field-level của F0).
   - `status` **vắng mặt/blank** → không filter, không lỗi. Chỉ giá trị có
     mặt và không thuộc `Policy.statuses.keys` mới là lỗi (A24).
   - **Vì sao phải chặn ở bước này, không để `.where(status: ...)` tự chạy**:
     `docs/design/F7-db.md` §1c đã cảnh báo tường minh — cột `status` là
     Rails enum trên `integer`; gọi `.where(status: "archived")` (giá trị
     không có trong enum map) khiến ActiveRecord **raise `ArgumentError`
     khi type-cast điều kiện WHERE**, y hệt hành vi khi gán giá trị đó vào
     record — **không** tự thành 422, sẽ crash thành 500 nếu không chặn
     trước. Đây là hệ quả trực tiếp của quyết định "cột integer + enum" ở
     `F7-db.md` §1c, không phải lỗi thiết kế API, nhưng API layer là nơi
     duy nhất có thể biến nó thành 422 đúng như A24 yêu cầu.
4. **Build scope**:
   ```ruby
   authorize Policy                 # PolicyPolicy#index? — luôn true
   scope = policy_scope(Policy)     # → current_organization.policies
   scope = scope.where("name ILIKE ?", "%#{Policy.sanitize_sql_like(search_term)}%") if search_term.present?
   scope = scope.where(status: params[:status]) if params[:status].present?
   scope = scope.order(created_at: :desc, id: :desc)
   ```
   - `search_term` = `params[:q].to_s.strip` — rỗng/chỉ khoảng trắng thì
     **không filter** (không có nhánh 422 nào cho `q`, đúng pattern F5/F6).
   - `sanitize_sql_like` bắt buộc — lý do giống hệt F5 §2.1 bước 4 (không
     lặp lại ở đây).
   - `.where(status: params[:status])` **an toàn để chạy tới đây** vì bước
     3 đã đảm bảo `params[:status]` hoặc rỗng hoặc là một trong
     `Policy.statuses.keys` — không còn khả năng `ArgumentError`.
   - Sort `created_at DESC, id DESC` — đúng index
     `policies(organization_id, created_at, id)` của `F7-db.md` §3.
5. `total_count = scope.count` — trên relation đã org-scope + đã lọc `q`/
   `status`, **trước** `limit/offset`.
6. `records = scope.offset((page - 1) * per_page).limit(per_page)` — `page`
   vượt cuối (A21) không cần nhánh riêng, `OFFSET` tự trả rỗng.
7. `total_pages = total_count.zero? ? 0 : (total_count.to_f / per_page).ceil`.
8. Render `200` theo shape §1, mỗi policy qua `serialize_policy` tường minh.

**N+1**: không có — `name`/`type`/`configuration`/`status` nằm ngay trên
`policies`, không join bảng nào, không có "Số nơi đang gán" (OQ-6) nên không
có cám dỗ đếm gì trong vòng lặp.

### 2.2 `POST /api/v1/policies`

1. `authenticate_request!` (có sẵn).
2. `authorize Policy` — `PolicyPolicy#create?` (luôn `true`), ở mức class.
3. **Validate `status` TRƯỚC khi build** (không phải sau) — cùng lý do đã
   nêu ở §2.1 bước 3, nhưng lần này là guard cho **assignment**, không phải
   `WHERE`:
   ```ruby
   errors = {}
   errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(create_params[:status])
   return render_validation_errors(errors) if errors.any?
   ```
   - `create_params[:status]` **vắng mặt** → không lỗi, không set field →
     cột giữ `default: 0` (`active`) của migration (A17, OQ-10). **Không**
     tự gán `status: "active"` tường minh trong controller — để DB default
     làm việc đó, tránh 2 nguồn sự thật cho "mặc định là gì".
   - `create_params[:status]` có mặt nhưng ngoài enum (`"archived"`) → 422
     field `status`, **dừng trước khi gọi `.build`** — nếu để lọt xuống
     `current_organization.policies.build(status: "archived")`, Rails
     raise `ArgumentError` ngay tại lệnh gán, **không** có cơ hội trở thành
     lỗi validation 422 (`F7-db.md` §1c) → sẽ crash thành 500 nếu không có
     guard này (A18).
4. Build & save:
   ```ruby
   policy = current_organization.policies.build(create_params)
   if policy.save
     render json: { policy: serialize_policy(policy) }, status: :created
   else
     render_validation_errors(policy.errors.messages)
   end
   ```
   - `current_organization.policies.build(...)` → `organization_id` luôn từ
     token (A28) — lớp phòng thủ thứ nhất; strong params không permit
     `organization_id` là lớp thứ hai.
   - `name`/`type` rỗng/khoảng trắng → 422 qua `presence` validator sau
     `before_validation` trim (A4, A11).
   - `configuration` thiếu/`null`/không phải object → 422 field
     `configuration` qua `configuration_must_be_a_json_object` (A12, A13) —
     xem §2.4 cho cách `create_params` phải dựng field này để validator có
     cơ hội chạy đúng.
   - `name` trùng trong org → 422 qua uniqueness validator (A5); trùng org
     khác → thành công (A6).
5. **Race condition A7** — `rescue_from ActiveRecord::RecordNotUnique`
   local trong `PoliciesController` (không phải `ApplicationController` —
   message là ngữ nghĩa riêng của `Policy`, đúng quyết định đã ghi ở
   `docs/design/F3-api.md` §5):
   ```ruby
   rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken

   def render_name_taken
     render_validation_errors(name: [ Policy::NAME_TAKEN_MESSAGE ])
   end
   ```
   Dùng chung hằng `Policy::NAME_TAKEN_MESSAGE` (đã có ở `F7-db.md` §1) với
   nhánh validate uniqueness thường → client không phân biệt được 2 nhánh.
   Phủ cả `create` lẫn `update` (A9 cũng có thể thua race).

### 2.3 `PATCH /api/v1/policies/:id`

1. `authenticate_request!` (có sẵn).
2. **Tìm record**: `policy = policy_scope(Policy).find(params[:id])` → raise
   `RecordNotFound` nếu thuộc org khác/không tồn tại/id sai định dạng → 404
   qua rescue toàn cục (A1–A3). **Không** dùng `Policy.find`.
3. `authorize policy` — `PolicyPolicy#update?` (luôn `true`), mức instance.
4. **Validate `status` TRƯỚC khi update** — cùng cơ chế §2.2 bước 3, áp
   dụng cho `update_params[:status]`:
   ```ruby
   errors = {}
   errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(update_params[:status])
   return render_validation_errors(errors) if errors.any?
   ```
   - `update_params[:status]` vắng mặt → không đụng field `status` hiện tại
     (PATCH partial — client chỉ sửa `name` thì `status` giữ nguyên).
   - Có mặt và hợp lệ (`active`/`inactive`, dù giữ nguyên giá trị cũ hay đổi
     chiều) → cho qua cả 2 chiều, không rule nào chặn ở F7 (A15, A16 — rule
     "không gán Policy inactive" chỉ áp dụng lúc **gán**, thuộc F8).
5. Update:
   ```ruby
   if policy.update(update_params)
     render json: { policy: serialize_policy(policy) }
   else
     render_validation_errors(policy.errors.messages)
   end
   ```
   - **A8** (giữ nguyên `name` cũ của chính nó → 200): hệ quả tự nhiên của
     `uniqueness scope: :organization_id` tự loại chính record đang sửa.
     Không code thêm, **có test riêng**.
   - **A14** (sửa `type` của policy đã tồn tại, kể cả trùng `type` với
     policy khác) → cho phép, `200` — không có validate nào ràng buộc
     `type` phải duy nhất hay khoá sau khi tạo (SoT OQ-3/OQ-4; F9 tính lại
     từ state hiện tại, là hàm thuần).
   - PATCH partial cho `configuration` có cùng cái bẫy như strong params —
     xem §2.4, **không** lặp lại logic riêng ở đây.
   - `policy.update` là 1 transaction ngầm của ActiveRecord, đủ cho 1
     record đơn.

### 2.4 Strong params — cái bẫy `configuration` (jsonb tự do)

Đây là phần **quan trọng nhất, dễ sai nhất** của F7, chưa từng xuất hiện ở
F2–F6 (mọi field trước đó là scalar). Không thể viết đơn giản
`params.permit(:name, :type, :configuration, :status)` — Rails strong
params sẽ **âm thầm bỏ qua** key `configuration` bất cứ khi nào giá trị của
nó không phải một `Hash`/`ActionController::Parameters` lồng bên trong
(mảng, chuỗi, số, `null` đều bị loại khỏi `permit` một cách im lặng, không
raise, không log) — nếu không tự xử lý, hệ quả là:

- Client gửi `configuration: ["a", "b"]` hoặc `configuration: "raw string"`
  hoặc `configuration: 5` → bị `permit` **loại bỏ khỏi params đã permit**
  trước khi tới `.build`/`.update` → với `create`, field không được set →
  validator `configuration_must_be_a_json_object` vẫn bắt được (attribute
  mặc định `nil` → `nil.is_a?(Hash)` false) → **vẫn ra đúng 422** (A13),
  **nhưng đây là trùng hợp may mắn ở nhánh create, không phải thiết kế cố
  ý** — nhánh `update` thì **sai hẳn**, xem điểm tiếp theo.
- **Với `update`**: client gửi `PATCH { configuration: null }` (cố tình
  xoá/làm sai cấu hình) hoặc `{ configuration: "oops" }` — nếu chỉ dùng
  `params.permit(:configuration)` kiểu scalar, `null`/string bị coi là "có
  giá trị nhưng permit bỏ qua vì không phải Hash mong đợi" (`configuration:
  {}` trong `permit` mới chấp nhận Hash) → key `configuration` **biến mất
  hoàn toàn khỏi `update_params`** → `.update(update_params)` **không đụng
  field `status` này** → policy giữ nguyên `configuration` cũ, request trả
  **`200` thành công** thay vì **`422`** như A12/A13 yêu cầu. Đây là bug
  **im lặng** nếu implementer chỉ copy công thức `permit` của F5/F6.

**Thiết kế đúng — phân biệt tường minh 3 trạng thái của field `configuration`
trong request** (key vắng mặt / key có mặt nhưng giá trị sai kiểu / key có
mặt và hợp lệ):

```ruby
def create_params
  build_policy_params
end

def update_params
  build_policy_params
end

# Scalar fields đi qua permit bình thường; `configuration` được lấy thủ
# công VÀ chỉ được đưa vào hash kết quả khi client thực sự gửi key này —
# đây là điều kiện bắt buộc để PATCH partial (không gửi configuration) khác
# với PATCH cố ý gửi configuration sai kiểu (phải 422).
def build_policy_params
  attrs = params.permit(:name, :type, :status).to_h.symbolize_keys
  attrs[:configuration] = configuration_param if params.key?(:configuration)
  attrs
end

# `to_unsafe_h`, không `permit(configuration: {})`: giá trị này không bao
# giờ được dùng để mass-assign thêm bất kỳ model/association nào khác — nó
# đi thẳng vào ĐÚNG MỘT cột jsonb rồi dừng lại, nên rủi ro mass-assignment
# mà strong params vốn được sinh ra để chặn (gán field lạ vào record qua
# đường vòng) không áp dụng ở đây. Nếu giá trị không phải Hash (Array,
# String, Numeric, nil), trả về nguyên trạng để validator model bắt lỗi ở
# đúng field `configuration`, không cố "sửa" hộ.
def configuration_param
  raw = params[:configuration]
  raw.is_a?(ActionController::Parameters) ? raw.to_unsafe_h : raw
end
```

Hệ quả đúng cho từng case (đối chiếu SoT §5.2):

| Request gửi | `params.key?(:configuration)` | `attrs[:configuration]` | Kết quả |
|---|---|---|---|
| Không có key `configuration` (PATCH partial sửa field khác) | `false` | không set — field cũ giữ nguyên | `200`, `configuration` không đổi |
| `configuration: null` | `true` | `nil` | model validate fail → `422` field `configuration` (A12) |
| `configuration` field vắng mặt hoàn toàn ở `POST` | `false` | không set → cột mới `nil` (jsonb không có default) | model validate fail → `422` (A12) |
| `configuration: "just a string"` / `configuration: 5` | `true` | giá trị scalar nguyên trạng | model validate fail (không `is_a?(Hash)`) → `422` (A13) |
| `configuration: ["a","b"]` | `true` | mảng nguyên trạng | model validate fail → `422` (A13) |
| `configuration: {}` | `true` | `{}` | hợp lệ (`{}` là Hash) → `200`/`201` |
| `configuration: {"key":"value"}` | `true` | `{"key"=>"value"}` | hợp lệ → `200`/`201` |

**Vì sao không dùng `params.require(:configuration).permit!` hay
`ActionController::Parameters#to_unsafe_h` trên toàn bộ `params`**: chỉ mở
`to_unsafe_h` cho **đúng một field** (`configuration`), không phải toàn bộ
request — `name`/`type`/`status` vẫn đi qua `permit` có whitelist bình
thường, giữ nguyên lớp phòng thủ "không nhận field lạ từ client" (A28) cho
mọi field khác. Đây là ngoại lệ có chủ đích, hẹp nhất có thể, không phải
tắt strong params cho cả action.

### 2.5 `GET /api/v1/policies/:id` — không có route, nhưng vẫn phải trả 404

SoT §11 có 3 acceptance scenario gọi trực tiếp `GET /api/v1/policies/<id>`
(org khác, không tồn tại, sai định dạng) và cả 3 đều assert **`404`** — dù
§1 đã chốt **không** đăng ký route `show` (OQ-7). Không có gì mâu thuẫn,
nhưng cơ chế tạo ra `404` ở đây **khác hẳn** cơ chế của `PATCH` (A1–A3), cần
ghi rõ để `slice-implementer`/test writer không đi tìm nhầm chỗ:

- Vì `resources :policies, only: [:index, :create, :update]` không sinh
  route `GET /api/v1/policies/:id`, request này **không khớp bất kỳ route
  nào** trong toàn bộ ứng dụng → Rails routing raise
  `ActionController::RoutingError` **trước khi** có bất kỳ controller nào
  được khởi tạo — không đi qua `Authenticatable`, không đi qua
  `policy_scope`, không đi qua `rescue_from ActiveRecord::RecordNotFound`
  của `ApplicationController` (exception này sinh ra ở tầng routing, không
  phải tầng controller, nên `rescue_from` khai báo trong
  `ApplicationController` **không bắt được** nó).
- **[SỬA khi review, 2026-09-17 — đã verify bằng `rails runner` thật trên
  chính app này, không suy đoán từ tài liệu Rails]** Bản nháp ban đầu khẳng
  định body trả về là "trang 404 mặc định của Rails (HTML)". **Sai** — đã
  verify trực tiếp (`RAILS_ENV=test`, gọi `Rails.application.call` với
  request thật tới `GET /api/v1/policies/42`, header `Accept:
  application/json` — đúng header mọi request spec (`get ..., as: :json`)
  và mọi client Axios thật sự gửi):
  - **Trong `test`/`development`** (`consider_all_requests_local = true`,
    có sẵn từ F0): body là **JSON**, nhưng là JSON debug đầy đủ của
    `ActionDispatch::DebugExceptions` —
    `{"status":404,"error":"Not Found","exception":"#<ActionController::RoutingError: No route matches [GET] \"/api/v1/policies/42\">","traces":{...backtrace đầy đủ...}}`
    — **rò rỉ tên exception class + backtrace**, không phải HTML, không
    phải envelope `{"error": "Not found"}` của app.
  - **Trong cấu hình kiểu production** (`consider_all_requests_local =
    false`, `show_exceptions = :all` — đã verify bằng cách set trực tiếp 2
    config này rồi gọi lại request tương tự): body là JSON **sạch, không rò
    rỉ gì**: `{"status":404,"error":"Not Found"}` — không phải HTML, nhưng
    khác shape `{"error": "Not found"}` toàn cục của app (thêm key
    `status`, và `"Not Found"` viết hoa 2 chữ đầu thay vì `"Not found"`).
  - **Kết luận an toàn**: route-miss này **không** rò rỉ dữ liệu
    Organization hay bất kỳ thông tin nghiệp vụ nào ở bất kỳ environment
    nào (chỉ rò rỉ tên exception class + backtrace framework ở test/dev —
    hành vi này áp dụng cho **mọi** route không tồn tại trong toàn app, vd
    `GET /api/v1/khong-ton-tai`, không phải rủi ro riêng do F7 tạo ra,
    không cần fix ở phạm vi F7) — nhưng khác nhau cả về hình dạng lẫn giữa
    2 environment, nên **không có body contract nào ổn định** để dựa vào.
- **Hệ quả cho test**: request spec cho 3 scenario này (`GET
  /api/v1/policies/42` org khác, `/999999` không tồn tại, `/abc` sai định
  dạng) chỉ nên assert `expect(response).to have_http_status(:not_found)`,
  **tuyệt đối không** assert `response.parsed_body` theo bất kỳ shape cụ
  thể nào (kể cả `{"error": "Not found"}` hay `{"error": "Not Found"}`) —
  body ở nhánh này không đi qua `ApplicationController#render_not_found` và
  khác nhau giữa `test` và production thật, viết assertion trên nó là
  coupling vào chi tiết triển khai của Rails, không phải hợp đồng API của
  F7. Đây là **request spec khác hẳn** 404 của `PATCH` (dùng
  `policy_scope(Policy).find` → JSON đúng envelope ổn định) dù cùng mã
  trạng thái.
- **Không tự thêm route `show` "cho tiện" để có JSON envelope đồng nhất** —
  làm vậy là vi phạm ngay quyết định OQ-7 (F7 không được có endpoint chi
  tiết), và authorize/scope cho 1 action không ai gọi từ FE (F7 không có
  trang chi tiết) chỉ là bề mặt tấn công thừa không cần thiết.
- **`DELETE /api/v1/policies/:id`** rơi vào đúng tình huống tương tự (không
  route, routing 404) nhưng **SoT không có acceptance scenario nào gọi
  `DELETE` cho Policy** (khác `GET`) nên không cần ghi test riêng — nêu ở
  đây chỉ để implementer không bất ngờ nếu ai đó thử gọi thủ công.

### 2.6 Enum guard dùng chung trong `PoliciesController`

`Policy.statuses` chỉ có 2 giá trị và chỉ 1 field cần guard (khác Device có
2 field `platform`+`status` dùng chung `DeviceFilterable`) — định nghĩa
**cục bộ** trong `PoliciesController`, **không** tái dùng/sửa
`DeviceFilterable` (module đó đặt tên và tài liệu hoá riêng cho
`Device.platforms`/`Device.statuses`, và mở rộng nó cho `Policy` sẽ phải
đụng vào file đã approve của F2/F6 mà không có lợi ích tương xứng — 4 dòng
lặp lại không đáng đánh đổi việc chạy lại toàn bộ `devices_spec.rb`/
`group_devices_spec.rb` như OQ-API-1 của F5 từng phải làm cho `Paginatable`,
nơi đó xứng đáng vì hàng chục dòng logic phân trang y hệt nhau ở 3 nơi):

```ruby
STATUS_ENUM_ERROR = "is not included in the list".freeze # cùng câu chữ với
                                                           # DeviceFilterable::ENUM_ERROR
                                                           # (nhất quán UX), khai
                                                           # báo riêng có chủ đích — xem trên

private

def invalid_status?(value)
  value.present? && !value.to_s.in?(Policy.statuses.keys)
end
```

Dùng **một** method này ở cả 3 nơi cần guard: `index` (filter, §2.1 bước
3), `create` (§2.2 bước 3), `update` (§2.3 bước 4) — tránh viết lại điều
kiện 3 lần với nguy cơ lệch nhau.

### 2.7 Serializer dùng chung

```ruby
def serialize_policy(policy)
  {
    id: policy.id,
    name: policy.name,
    type: policy.type,
    configuration: policy.configuration,
    status: policy.status,
    created_at: policy.created_at,
    updated_at: policy.updated_at
  }
end
```

- Đúng 7 field, **không** `organization_id` (đúng convention `serialize_group`/
  `serialize_device` — client chỉ có 1 org). **Không** `assignments_count`
  (OQ-6).
- `policy.type` đọc thẳng attribute string bình thường — `F7-db.md` §1 đã
  disable STI (`self.inheritance_column = "_type_disabled"`) nên
  `policy.type` **không** bị Rails diễn giải thành tên class; không cần xử
  lý gì thêm ở serializer.
- `configuration` là 1 `Hash` (ActiveRecord tự deserialize cột `jsonb`) →
  `render json:` tự serialize lại thành JSON object đúng cấu trúc, không
  cần `.to_json` thủ công.

**Strong params (đầy đủ, gộp từ §2.4):**
```ruby
def create_params
  build_policy_params
end

def update_params
  build_policy_params
end
```
Cố tình **không** permit `:organization_id`, `:id`, `:created_at`,
`:updated_at` (A28) — và cố tình dùng chung 1 method `build_policy_params`
(khác quyết định của F5 giữ `create_params`/`update_params` tách rời) vì cả
2 action ở F7 permit **đúng cùng 4 field** — không có field nào chỉ dành
riêng cho 1 action (khác F3, nơi `identifier` bất biến chỉ có ở `create`).
Nếu F8 sau này cần permit thêm field chỉ ở 1 action, tách lại lúc đó.

## 3. Lỗi / edge case — map đầy đủ A1–A31 (SoT §5.2)

| SoT | Tình huống | Status | Body | Cơ chế |
|---|---|---|---|---|
| **A1** | `PATCH` với `:id` thuộc Organization khác | `404` | `{ "error": "Not found" }` | `policy_scope(Policy).find` → record bị `Scope#resolve` loại → `RecordNotFound` → rescue toàn cục |
| **A1 (biến thể GET)** | `GET /api/v1/policies/:id` bất kỳ id nào | `404` | JSON không theo envelope chuẩn của app, khác nhau giữa test/production — không có contract ổn định, test chỉ assert status (xem §2.5) | Không có route → `ActionController::RoutingError` → xem §2.5 |
| **A2** | `:id` không tồn tại | `404` | Giống A1 (theo verb tương ứng) | Cùng cơ chế A1 |
| **A3** | `:id` sai định dạng | `404`, không 500 | Giống A1 | `find` id phi số raise `RecordNotFound` (đã xác nhận ở `F4-db.md` §4), qua `PATCH` |
| **A4** | `name` rỗng/khoảng trắng | `422` | `{ "errors": { "name": [...] } }` | `before_validation` trim → `presence` |
| **A5** | Trùng `name` trong cùng org | `422` | `{ "errors": { "name": [Policy::NAME_TAKEN_MESSAGE] } }` | `validates uniqueness scope: :organization_id` |
| **A6** | Trùng `name` với org khác | `201` | `{ "policy": {...} }` | `uniqueness` có `scope: :organization_id` — hệ quả tự nhiên, có test riêng |
| **A7** | Race tạo trùng `name` đồng thời | `422` (bên thua), không 500 | Giống A5 | Unique index DB → `RecordNotUnique` → `rescue_from` local → `render_name_taken` (§2.2 bước 5) |
| **A8** | Sửa giữ nguyên `name` cũ | `200` | `{ "policy": {...} }` | `uniqueness` tự loại chính record. Có test riêng |
| **A9** | Sửa `name` thành tên đang dùng trong org | `422` | Giống A5 | Cùng validator; thua race → A7 |
| **A10** | `name`/`type` vượt 100 ký tự | `422` | `{ "errors": { "name": [...] } }` (hoặc `type`) | `validates length: { maximum: 100 }` (`F7-db.md` §1, OQ-8) |
| **A11** | `type` rỗng/khoảng trắng | `422` | `{ "errors": { "type": [...] } }` | `before_validation` trim → `presence` |
| **A12** | `configuration` thiếu hoặc `null` | `422` | `{ "errors": { "configuration": [CONFIGURATION_INVALID_MESSAGE] } }` | §2.4 — key vắng mặt hoặc `nil` đều không `is_a?(Hash)` |
| **A13** | `configuration` không phải JSON object (mảng/số/chuỗi) | `422` | Giống A12 | §2.4 — `configuration_param` giữ nguyên giá trị sai kiểu để validator bắt |
| **A14** | Sửa `type` của policy đã tồn tại | `200` | `{ "policy": {...} }` với `type` mới | Không có validate khoá `type` (OQ-3/OQ-4) |
| **A15** | `status: active → inactive` | `200` | `{ "policy": { ..., "status": "inactive" } }` | Không rule nào chặn ở F7 (§2.3 bước 4) |
| **A16** | `status: inactive → active` | `200` | Tương tự | Không rule nào chặn |
| **A17** | Tạo không truyền `status` | `201` | `status: "active"` | Cột `default: 0` của migration — không set tường minh ở controller (§2.2 bước 3) |
| **A18** | Tạo với `status` ngoài enum | `422` | `{ "errors": { "status": [STATUS_ENUM_ERROR] } }` | `invalid_status?` chặn **trước** `.build` (§2.2 bước 3) — nếu bỏ qua sẽ là `ArgumentError` → 500 |
| **A19** | Org chưa có policy nào | `200` | `{ "policies": [], "meta": { total_count: 0, ... } }` | Không phải lỗi |
| **A20** | Search/filter không khớp | `200` | Shape giống A19 | API không phân biệt A19/A20 — FE tự phân biệt bằng state `q`/`status` |
| **A21** | `page` vượt số trang hiện có | `200` | Mảng rỗng, `meta` phản ánh đúng toàn tập | `OFFSET` tự trả rỗng, không check thủ công |
| **A22** | `page`/`per_page` không phải số nguyên dương | `422` | `{ "errors": { "page": [...] } }` (và/hoặc `per_page`) | `Paginatable#pagination_errors`, tái dùng nguyên vẹn |
| **A23** | `per_page` > 100 | `200` | `meta.per_page = 100` | Clamp im lặng, không lỗi |
| **A24** | `status` filter ngoài enum | `422` | `{ "errors": { "status": [STATUS_ENUM_ERROR] } }` | `invalid_status?` chặn **trước** khi build scope (§2.1 bước 3) — nếu bỏ qua sẽ là `ArgumentError` từ `.where` → 500 |
| **A25** | Lỗi hạ tầng khi tải danh sách | `500` | (Rails default) | Không thiết kế riêng; FE hiện ErrorState |
| **A26** | Không token/token hết hạn/user inactive | `401` | `{ "error": "Unauthorized" }` | `Authenticatable`, không code mới |
| **A27** | Chưa đăng nhập mở `/policies` | — | — | Thuần FE (router guard), không có API touchpoint |
| **A28** | Client gửi `organization_id` | Bình thường (`201`/`200`) | Org đích không đổi | Strong params không permit + `current_organization.policies.build` |
| **A29** | Menu ⋯ không có "Xóa"/"Xem chi tiết" | — | — | Thuần FE — hệ quả tự nhiên của việc không có route `destroy`/`show` (§1) |
| **A30** | List không có cột "Số nơi đang gán" | — | — | Serializer §2.7 không có field này — thuần FE không render, không phải API trả thiếu |
| **A31** | Đóng modal khi có dữ liệu chưa lưu | — | — | Thuần FE, không phát sinh request |

**Không có nhánh lỗi nào cho `q`** — mọi giá trị hợp lệ, `200`, không khớp
gì → mảng rỗng (A20). Không giới hạn độ dài `q`.

**Không có nhánh 403 nào trong toàn bộ F7** — mọi vi phạm ranh giới org đều
là 404 (`CLAUDE.md` §4).

**Không có `rescue_from ActiveRecord::RecordNotDestroyed`** — F7 không có
`destroy`.

## 4. Xử lý bất đồng bộ

**Không áp dụng ở F7.** Cả 3 endpoint đều thao tác trên tối đa 1 row của
bảng `policies` (list chỉ đọc, create/update ghi 1 record) — không thao tác
hàng loạt, không enqueue Solid Queue job, không endpoint poll trạng thái.

Bài toán "gán Policy cho Group 10.000 device, bulk-write `upsert_all`,
poll `pending/running/done/failed`" (`CLAUDE.md` §4) thuộc **F8**
(`policy_assignments`), không phải F7 — F7 chỉ có nghĩa vụ đảm bảo
`type`/`configuration`/`status` là dữ liệu đáng tin cậy để F8 dùng ngay,
không phải sửa lại schema/API của Policy khi F8 bắt đầu.

## 5. Rủi ro / open question

### OQ-API-1 — `to_unsafe_h` cho field `configuration` (cần người duyệt xác nhận)

§2.4 chọn lấy `params[:configuration]` qua `to_unsafe_h` (khi là
`ActionController::Parameters`) thay vì `permit(configuration: {})`, vì
`permit(configuration: {})` tuy **về mặt kỹ thuật cũng permit toàn bộ cấu
trúc lồng bất kỳ** (Rails coi `{}` là "cho phép mọi key trong hash này,
không giới hạn độ sâu") nhưng **chỉ áp dụng khi giá trị là Hash** — với
giá trị sai kiểu (mảng/scalar/`null`), `permit(configuration: {})` **loại
bỏ key đó khỏi kết quả một cách im lặng** thay vì giữ lại để model bắt lỗi,
gây đúng cái bug PATCH-partial đã mô tả ở §2.4. Hai phương án tương đương
về mặt an toàn (không phương án nào mở lỗ mass-assignment thật, vì giá trị
chỉ đi vào 1 cột jsonb, không dùng để gán field khác):

- **(a) `to_unsafe_h` + `params.key?(:configuration)` guard tường minh**
  (đã chọn ở §2.4). Rõ ràng nhất về ý định, dễ test từng nhánh trong bảng ở
  §2.4, nhưng là lần đầu tiên dự án dùng `to_unsafe_h` — cần ghi rõ lý do
  (đã ghi ở §2.4) để review sau này không tưởng nhầm là lỗ hổng bảo mật.
- **(b) `permit(configuration: {})` + xử lý riêng nhánh "key có mặt nhưng
  giá trị không phải Hash"** bằng cách kiểm tra `params[:configuration]`
  song song (không dùng giá trị đã permit cho nhánh sai kiểu) — phức tạp
  hơn vì phải đọc `params[:configuration]` (raw) **và**
  `create_params[:configuration]` (permitted) ở 2 chỗ khác nhau tùy trạng
  thái, dễ lẫn.

**Khuyến nghị**: giữ (a) — đơn giản hơn, một nguồn duy nhất
(`configuration_param`) cho mọi nhánh. Cần người duyệt xác nhận vì đây là
lần đầu dự án dùng `to_unsafe_h`, và tài liệu này **tự quyết định** thay vì
để trống vì không có tiền lệ nào trong F0–F6 để tham chiếu — nếu người
duyệt không đồng ý, đổi sang (b) không ảnh hưởng bất kỳ endpoint/status
code nào ở §1–§3, chỉ đổi cách viết `build_policy_params`.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** chọn
**(a)** như khuyến nghị. Đã kiểm tra lại lập luận an toàn: `to_unsafe_h` chỉ
áp dụng cho **đúng một** field (`configuration`), giá trị lấy ra chỉ đi vào
1 cột jsonb duy nhất qua `attrs[:configuration] = ...` — không có đường nào
để giá trị này "leo" sang gán field khác (không dùng `merge!` lên toàn bộ
`params`, không `permit!`), nên không mở lỗ mass-assignment thật sự (đúng
điều `permit`/strong params được sinh ra để chặn: gán field lạ vào record
qua đường vòng — không xảy ra ở đây vì không có "field lạ" nào, chỉ có
đúng 1 field đã biết trước đi vào đúng 1 cột đã biết trước). `name`/`type`/
`status` vẫn qua `permit` whitelist bình thường, không đổi. Chấp nhận đây
là tiền lệ đầu tiên của `to_unsafe_h` trong dự án, ghi chú tại chỗ khai báo
(`configuration_param`, §2.4) để review sau không hiểu nhầm là lỗ hổng.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **§2.5 (route 404 qua routing, không qua controller) là pattern hoàn
  toàn mới của dự án** — F0–F6 chưa từng có route nào bị cố tình bỏ trống
  trong khi acceptance test vẫn gọi tới nó. Nếu `slice-implementer` viết
  request spec assert `response.parsed_body["error"]` cho 3 scenario GET-by-id
  của A1–A3, spec sẽ đỏ (body là HTML, không phải JSON) — phải assert status
  only, đã ghi rõ ở §2.5.
- **`STATUS_ENUM_ERROR` trùng câu chữ nhưng không dùng chung hằng số với
  `DeviceFilterable::ENUM_ERROR`** (§2.6) — chấp nhận trùng lặp có chủ đích,
  ghi lý do ngay tại chỗ khai báo để review sau không tự ý "dọn dẹp" bằng
  cách gộp 2 module lại (sẽ đụng file đã approve của F2/F6 không cần
  thiết).
- **Nghĩa vụ carry-over cho F8** (nhắc lại từ `F7-db.md` §4a để không trôi
  qua tầng API): khi F8 tạo bảng `policy_assignments`, endpoint `GET
  /api/v1/policies` sẽ cần thêm `assignments_count` (một `LEFT JOIN
  GROUP BY` gộp, đúng pattern `devices_count` đã làm ở F6 cho Group — xem
  `api/app/controllers/api/v1/groups_controller.rb#index`, **không** đếm
  trong vòng lặp); F8 cũng là nơi thêm `GET /api/v1/policies/:id` thật (2
  tab gán Group/Device) — lúc đó route `show` mới được mở, và toàn bộ phân
  tích ở §2.5 về "404 qua routing" sẽ **hết hiệu lực**, thay bằng 404 qua
  `policy_scope(Policy).find` giống các action khác.
- **Không có index nào cho `q`** (ILIKE wildcard đầu) — chấp nhận theo
  `F7-db.md` §3, giống F5/F6, không tối ưu sớm.
- **`configuration` trả về nguyên trạng đã lưu trong DB (`jsonb`), không
  giữ thứ tự key/whitespace gốc client gõ** — đã chấp nhận ở `F7-db.md`
  §1b, không phải việc của tầng API sửa.
