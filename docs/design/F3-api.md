---
feature_id: F3
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế API — F3

Nguồn: `docs/sot/F3-device-create-edit.md` (approved), `docs/design/F3-db.md`
(approved), `docs/design/F2-api.md` (approved — quy ước envelope, style
controller), `PRD.md` §"Device", `CLAUDE.md` §4, code hiện có
`api/app/controllers/api/v1/devices_controller.rb` (F2, chỉ có `index`),
`api/app/controllers/application_controller.rb` (`render_not_found`,
`render_validation_errors` dùng chung), `api/app/policies/device_policy.rb`
(F2, `index?`/`Scope`), `api/config/routes.rb`.

**Kết luận đầu tiên:** F3 **không thêm controller mới, không thêm route
namespace mới** — chỉ mở rộng `DevicesController` đã có ở F2 thêm 2 action
`create`/`update`, tái dùng gần như toàn bộ hạ tầng đã có (`Authenticatable`,
`render_validation_errors`, `render_not_found`, `serialize_device`,
`invalid_enum?`, hằng số `ENUM_ERROR`). Chỉ có 2 phần thật sự mới ở tầng API:
(1) strong params cho `create`/`update` (khác nhau về field được permit), và
(2) 1 `rescue_from` mới cho race condition A12.

## 0. Quy ước kế thừa từ F0/F2 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần — không đổi.
- 422 (validate lỗi field-level): `{ "errors": { "<field>": ["<message>"] } }`
  — **F3 tái dùng nguyên khung này cho cả lỗi "chặn vì retired"**, chỉ khác
  ở chỗ key không phải tên field mà là `"base"` (xem §3, quyết định OQ-4).
  Đây là điểm quyết định chính của tài liệu này — không tạo envelope riêng
  (vd `{"error": "..."}`) cho lỗi retired-block, để FE chỉ cần 1 quy tắc duy
  nhất khi render: "key `base` → banner đầu form; key khác → field-level".
- Lỗi khác (401/404): `{ "error": "<message>" }` — không đổi. 404 cross-org
  (A10) **không cần code mới**: `policy_scope(Device).find(params[:id])` khi
  không tìm thấy (kể cả vì thuộc org khác — scope đã loại trừ) raise
  `ActiveRecord::RecordNotFound`, đã được `ApplicationController` rescue
  toàn cục thành `{ "error": "Not found" }` / 404 từ F0 — F3 không cần thêm
  `rescue_from` nào cho case này.
- Auth: `Authenticatable` concern — tái dùng nguyên vẹn, không sửa.
- **Request body: phẳng, không bọc trong key `device:`** — giữ đúng tiền lệ
  đã có ở F0 (`POST /api/v1/sessions` nhận `{ email, password }` phẳng, không
  `{ session: {...} }`). `ActionController::ParamsWrapper` không được dùng ở
  dự án này (chưa từng xuất hiện ở F0/F2), F3 tiếp tục nhất quán: client gửi
  `{ identifier, name, platform, os_version }` / `{ name, platform,
  os_version, status }` phẳng ở top-level body.
- **Response thành công: bọc trong key `device:`** — đây là **quyết định mới**
  của tài liệu này (SoT/F3-db.md không chốt shape response, chỉ nói "device
  serialize (shape giống item trong `GET /devices`)"). Chọn bọc
  `{ "device": { ...8 field... } }` thay vì trả phẳng ở top-level, theo đúng
  tiền lệ F0 (`POST /sessions` trả `{ token, user: {...}, organization: {...}
  }` — resource luôn nằm dưới 1 key ngữ nghĩa, không bao giờ trả phẳng ở
  top-level cùng cấp với các field khác có thể xuất hiện sau này, vd
  `job_id` cho các action bất đồng bộ ở F6/F8). Field bên trong `device`
  giống hệt item trong `GET /devices` (§1 `docs/design/F2-api.md`): `id`,
  `identifier`, `name`, `platform`, `os_version`, `status`, `last_seen_at`,
  `created_at`, `updated_at` — tái dùng nguyên `serialize_device` đã có,
  không viết lại serializer mới.

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `POST` | `/api/v1/devices` | Body (phẳng): `identifier` (bắt buộc), `name` (bắt buộc), `platform` (bắt buộc, enum), `os_version` (tùy chọn). **Không permit** `status`, `organization_id` dù client gửi kèm. | 201: `{ "device": { id, identifier, name, platform, os_version, status, last_seen_at, created_at, updated_at } }` hoặc 422 | Bất kỳ user `active` thuộc org (không phân role — SoT §9) | Luôn `current_organization.devices.build(...)` — không bao giờ `Device.new` trần; `organization_id`/`status` không nhận từ client dưới bất kỳ hình thức nào |
| `PATCH` | `/api/v1/devices/:id` | Body (phẳng): subset của `name`, `platform` (enum), `os_version`, `status` (enum). **Không permit** `identifier`, `organization_id` dù client gửi kèm. | 200: `{ "device": {...} }` hoặc 422 (validate/retired-block) hoặc 404 (cross-org) | Như trên | Record lấy qua `policy_scope(Device).find(params[:id])` — 404 nếu `:id` thuộc org khác hoặc không tồn tại (A10, không phải 403) |

Route (thêm vào `resources :devices` đã có ở F2, không route mới):

```ruby
resources :devices, only: [ :index, :create, :update ]
```

### Pundit — `DevicePolicy`

Thêm 2 action mới, giữ nguyên style `index?` đã có (không phân role nội bộ
org, business rule "retired bất biến" **không** nằm ở đây — SoT §8/§9,
`docs/design/F3-db.md` §4):

```ruby
class DevicePolicy < ApplicationPolicy
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
      user.organization.devices
    end
  end
end
```

`Scope#resolve` tái dùng nguyên vẹn từ F2 — dùng cho `PATCH` để tìm record
(`policy_scope(Device).find(params[:id])`). `create?`/`update?` luôn `true`:
authorization thật sự (org-scope) nằm ở `Scope`/`current_organization`, không
ở đây; việc chặn sửa device `retired` là lỗi nghiệp vụ (422 từ model), không
phải authorization (403/404) — đúng nguyên tắc đã ghi ở SoT §9.

## 2. Business logic

### 2.1 `POST /api/v1/devices`

1. `Authenticatable#authenticate_request!` (qua `before_action`, có sẵn) →
   có `current_organization`.
2. `authorize Device` — `DevicePolicy#create?` (luôn `true`). Gọi ở mức class
   (giống cách F2 gọi `authorize Device` cho `index?`) vì tại bước này chưa
   có instance nào cần authorize theo field — nhất quán với F2, không cần
   instance để quyết định `create?`.
3. **Guard enum `platform` trước khi chạm `Device.new`** (A4, tái dùng đúng
   pattern `invalid_enum?`/`ENUM_ERROR` đã có ở F2 cho filter, áp dụng lần
   đầu cho write body — theo đúng cảnh báo của `docs/design/F3-db.md` §4):
   ```ruby
   errors = {}
   errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(create_params[:platform], Device.platforms.keys)
   return render_validation_errors(errors) if errors.any?
   ```
   - `create_params[:platform]` **blank** (thiếu hoặc `""`) → `invalid_enum?`
     trả `false` (không phải lỗi ở bước này) — đã xác nhận qua kiểm tra thực
     tế trên `Device` model: gán `platform = ""` cho cột enum không raise
     `ArgumentError`, Rails coerce về `nil` một cách an toàn — nên field
     blank tiếp tục rơi xuống bước 4, bị bắt bởi `validates :platform,
     presence: true` với message chuẩn Rails ("can't be blank"), **không**
     bị bắt bởi guard enum ở đây (giữ đúng phân biệt "thiếu" (A3) vs "sai
     kiểu enum" (A4) như 2 lỗi khác nhau, khớp F2's cách xử lý filter).
   - `create_params[:platform]` có giá trị nhưng **không nằm trong**
     `Device.platforms.keys` (vd `"windows"`) → 422 ngay, dừng lại, không gọi
     `Device.new` (tránh `ArgumentError` → 500).
   - Không cần guard `status` ở `create` — `status` không nằm trong permitted
     params của action này (xem §strong params dưới), không có đường nào để
     giá trị lạ chạm tới cột `status` từ request body tạo mới.
4. Build & save:
   ```ruby
   device = current_organization.devices.build(create_params)
   if device.save
     render json: { device: serialize_device(device) }, status: :created
   else
     render_validation_errors(device.errors.messages)
   end
   ```
   - `current_organization.devices.build(...)` → `organization_id` luôn là
     org của token hiện tại, không đường nào client ghi đè (A9).
   - `status` **không** có trong `create_params` → cột dùng `default: 0`
     (`active`, đã có sẵn từ F2 schema) — không cần code ép giá trị thủ công,
     không cần callback `before_validation` riêng cho việc này (đúng khuyến
     nghị `docs/design/F3-db.md` §4: "không cần đổi gì ở model để hỗ trợ
     OQ-2", thuần là hệ quả của strong params + default cột có sẵn).
   - `device.save` thất bại (A1: identifier trùng org, A3: thiếu field) →
     `device.errors.messages` là 1 Hash `{field => [msg, ...]}` sẵn đúng
     shape `errors` cần — không cần biến đổi thêm, kể cả nhiều field lỗi
     cùng lúc (A3: `identifier`/`name`/`platform` đều blank → cả 3 key xuất
     hiện cùng lúc trong `errors.messages`, đúng AC "gộp chung 1 response").
   - `device.save` thành công → 201 + `{ device: serialize_device(device) }}`.
5. **Race condition A12** — rescue ở scope `DevicesController` (không phải
   `ApplicationController`, vì đây là ngữ nghĩa riêng của
   `(organization_id, identifier)`, không phải lỗi chung mọi resource):
   ```ruby
   rescue_from ActiveRecord::RecordNotUnique, with: :render_identifier_taken

   private

   def render_identifier_taken
     render_validation_errors(identifier: [ Device::IDENTIFIER_TAKEN_MESSAGE ])
   end
   ```
   Message **giống hệt** message validate uniqueness thường (A1) — implementer
   nên expose qua hằng `Device::IDENTIFIER_TAKEN_MESSAGE` trên model (dùng
   chung cho cả `validates :identifier, uniqueness: { message:
   Device::IDENTIFIER_TAKEN_MESSAGE, ... }` lẫn nhánh rescue này), đúng đề
   xuất `docs/design/F3-db.md` §3 — tránh lặp lại chuỗi Việt hoá ở 2 chỗ có
   nguy cơ lệch nhau theo thời gian.

**Strong params (`create`):**
```ruby
def create_params
  params.permit(:identifier, :name, :platform, :os_version)
end
```
Cố tình **không** `permit :status`, `:organization_id` — đây là lớp phòng
thủ chính cho OQ-2/A9 (không phải lớp duy nhất — `current_organization.devices`
là lớp org-scope, cột `status` có default là lớp phòng thủ status), khớp
đúng khuyến nghị SoT/F3-db.md.

### 2.2 `PATCH /api/v1/devices/:id`

1. `Authenticatable#authenticate_request!` (có sẵn).
2. Tìm record: `device = policy_scope(Device).find(params[:id])` — raise
   `ActiveRecord::RecordNotFound` nếu không tồn tại hoặc thuộc org khác (đã
   bị loại khỏi scope) → 404 tự động qua rescue toàn cục ở
   `ApplicationController` (A10, không cần code mới — xem §0).
3. `authorize device` — `DevicePolicy#update?` (luôn `true`). Gọi ở mức
   instance (khác với `create` ở mức class) vì tại đây đã có record cụ thể;
   không ảnh hưởng kết quả (luôn `true`) nhưng đúng convention Pundit chuẩn
   (`policy_scope` để tìm, `authorize` trên instance tìm được).
4. **Guard enum `platform`/`status`** (A4 áp dụng lại cho sửa, A5) — trước
   khi gọi `device.update`, cùng pattern với `create`, gộp cả 2 field trong
   1 lần kiểm tra (giống style `filter_errors` đã có ở `index`):
   ```ruby
   errors = {}
   errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(update_params[:platform], Device.platforms.keys)
   errors[:status] = [ ENUM_ERROR ] if invalid_enum?(update_params[:status], Device.statuses.keys)
   return render_validation_errors(errors) if errors.any?
   ```
   Field không có trong body (client không gửi) → `update_params[:field]` là
   `nil` → `invalid_enum?` trả `false` (không lỗi, đúng ngữ nghĩa "không đổi
   field này"). **Guard này chạy trước `device.update`, kể cả khi device
   đang `retired`** — không sao, vì nếu device đang retired,
   `block_all_changes_when_retired` (model, `docs/design/F3-db.md` §1b) sẽ
   chặn ở bước 5 bất kể enum guard có pass hay không; còn nếu client gửi
   *cả* status/platform sai enum *và* device đang retired, ưu tiên trả lỗi
   enum trước (422 field-level) là chấp nhận được — không có scenario nào ở
   SoT §11 kiểm tra tổ hợp 2 lỗi này cùng lúc, và trả lỗi sớm nhất bắt được
   vẫn là 422 hợp lệ theo đúng tinh thần "không để `ArgumentError` lọt ra
   ngoài".
5. Update:
   ```ruby
   if device.update(update_params)
     render json: { device: serialize_device(device) }
   else
     render_validation_errors(device.errors.messages)
   end
   ```
   - `device.update(update_params)` chạy qua đúng 2 callback đã chốt ở
     `docs/design/F3-db.md` §1a/§1b theo thứ tự khai báo trên model:
     - `block_all_changes_when_retired` (nếu `status_was == "retired"`) →
       `errors.add(:base, Device::RETIRED_IMMUTABLE_MESSAGE)` +
       `throw(:abort)` → `update` trả `false` ngay, **không chạy tiếp**
       validate khác (A8 — đúng AC "không field nào bị đổi", vì
       `throw(:abort)` dừng toàn bộ callback chain, DB không được ghi).
     - `restore_immutable_identifier` — vô hiệu hoá mọi giá trị `identifier`
       lỡ lọt vào (không xảy ra trong luồng bình thường vì `identifier`
       không nằm trong `update_params`, nhưng là lớp phòng thủ thứ 2 độc lập
       với strong params — A11).
   - `device.errors.messages` cho case retired-block trả về
     `{ "base" => ["Thiết bị đã retired, không thể sửa"] }` — **serialize y
     hệt cách các lỗi field-level khác được serialize** (không rẽ nhánh
     code riêng cho case này trong controller), FE tự phân biệt banner/field
     dựa vào key `base` (xem §0, OQ-4).
   - `device.update` thành công (A6, A7) → 200 + `{ device: serialize_device(device) }`
     — `identifier` trong response luôn là giá trị gốc (callback
     `restore_immutable_identifier` đảm bảo không có "response drift", xem
     `docs/design/F3-db.md` §1a) — không cần `device.reload`.

**Strong params (`update`):**
```ruby
def update_params
  params.permit(:name, :platform, :os_version, :status)
end
```
Cố tình **không** `permit :identifier`, `:organization_id` — lớp phòng thủ
chính cho OQ-1/A11 (lớp thứ 2 là callback model `restore_immutable_identifier`
— `docs/design/F3-db.md` §1a).

Không có transaction tường minh nào cần thêm — mỗi request chỉ ghi 1 record
đơn (`device.save`/`device.update` đã tự bọc trong 1 transaction ngầm của
ActiveRecord, đủ cho scope F3 — SoT §10).

## 3. Lỗi / edge case

- **422 — thiếu field bắt buộc khi tạo** (A3):
  ```json
  { "errors": { "identifier": ["can't be blank"], "name": ["can't be blank"], "platform": ["can't be blank"] } }
  ```
  (chỉ field nào blank mới xuất hiện; nếu chỉ 1 field blank thì chỉ 1 key).
- **422 — identifier trùng trong cùng org** (A1, validate app-level bắt được
  trước khi chạm DB):
  ```json
  { "errors": { "identifier": ["Identifier này đã tồn tại trong tổ chức của bạn."] } }
  ```
- **422 — identifier trùng do race condition** (A12, `RecordNotUnique` từ
  unique index, rescue ở controller):
  ```json
  { "errors": { "identifier": ["Identifier này đã tồn tại trong tổ chức của bạn."] } }
  ```
  **Giống hệt** shape/message của A1 — client không phân biệt được 2 nhánh
  (đúng yêu cầu SoT A12).
- **422 — platform không hợp lệ khi tạo hoặc sửa** (A4):
  ```json
  { "errors": { "platform": ["is not included in the list"] } }
  ```
- **422 — status không hợp lệ khi sửa** (A5):
  ```json
  { "errors": { "status": ["is not included in the list"] } }
  ```
- **422 — chặn sửa vì device đã `retired`** (A8, OQ-4 — banner, không field
  cụ thể):
  ```json
  { "errors": { "base": ["Thiết bị đã retired, không thể sửa"] } }
  ```
  FE nhận diện: response chỉ có key `base` (không phải tên field nào của
  form) → render banner đầu form thay vì bám dưới 1 input cụ thể (§7 SoT).
- **Thành công — tạo** (201):
  ```json
  { "device": { "id": 42, "identifier": "IPHONE-001", "name": "iPhone của Alice", "platform": "ios", "os_version": null, "status": "active", "last_seen_at": null, "created_at": "...", "updated_at": "..." } }
  ```
- **Thành công — sửa** (200): shape giống hệt, dữ liệu đã cập nhật.
- **`identifier` bị bỏ qua khi sửa** (A11): request `PATCH` kèm
  `identifier: "IPHONE-999"` → `200` bình thường (không lỗi), response
  `device.identifier` vẫn là giá trị gốc — không có nhánh lỗi riêng, đây là
  hệ quả tự nhiên của strong params + callback model (§2.2).
- **`organization_id` bị bỏ qua khi tạo/sửa** (A9): tương tự — không có
  nhánh lỗi riêng, `organization_id` không bao giờ nằm trong params được
  dùng.
- **404 — sửa Device thuộc org khác** (A10):
  ```json
  { "error": "Not found" }
  ```
  Tái dùng nguyên `render_not_found` đã có từ F0 — không code mới.
- **401 — thiếu/hết hạn token** (A14): tái dùng `Authenticatable`, không
  code mới, shape `{ "error": "Unauthorized" }` (F0).
- **500/hạ tầng (A13)**: không thiết kế riêng ở tầng API — FE tự xử lý theo
  status code chung (`UI_UX_design.md` §9), không phải business logic F3.

## 4. Xử lý bất đồng bộ

Không áp dụng — F3 ghi 1 record đơn lẻ (create/update), không phải thao tác
hàng loạt trên Group (khác F6/F8).

## 5. Rủi ro / open question

- **Quyết định response wrapping `{ "device": {...} }`** (§0): SoT/F3-db.md
  không chốt shape này tường minh, chỉ nói "device serialize (shape giống
  item trong `GET /devices`)". Tài liệu này **tự quyết định** bọc trong key
  `device` (thay vì trả phẳng ở top-level) theo tiền lệ F0
  (`sessions`/`me`). Nếu người duyệt muốn trả phẳng (đồng bộ tuyệt đối với
  item bên trong mảng `devices` của `GET /devices`, không có key bọc), cần
  nêu rõ ở đây trước khi `frontend-designer`/`slice-implementer` dựa vào
  shape này — ảnh hưởng cả `web/src/api/devices.ts` lẫn Playwright step
  definitions.
- **`Device::IDENTIFIER_TAKEN_MESSAGE` là hằng số mới cần thêm vào model**
  (`api/app/models/device.rb`) dù đây là tài liệu API design — vì message
  này cần dùng chung ở cả `validates :identifier, uniqueness: {...}` (model,
  đã chốt ở `docs/design/F3-db.md` §1) lẫn `render_identifier_taken`
  (controller, mới ở tài liệu này). Không coi đây là thay đổi DB design lại
  (không migration, không field mới) — chỉ là 1 hằng số Ruby, implementer tự
  thêm lúc code, đúng tinh thần "implementer cân nhắc" mà F3-db.md §3 đã ghi.
- **`rescue_from ActiveRecord::RecordNotUnique` đặt local ở
  `DevicesController`, không phải `ApplicationController`** — quyết định có
  chủ đích: message trả về (`Device::IDENTIFIER_TAKEN_MESSAGE`) là ngữ nghĩa
  riêng của `Device`, không tổng quát cho mọi resource tương lai (Group/User
  có thể có unique constraint khác, message khác). Nếu 1 feature sau này cần
  pattern tương tự cho resource khác, mỗi controller tự khai `rescue_from`
  riêng với message của mình — không tổng quát hoá sớm.
- **Guard enum không phủ hết mọi tổ hợp lỗi cùng lúc** (ghi ở §2.2 bước 4):
  nếu client vừa gửi `status` sai enum vừa nhắm vào 1 device đang `retired`,
  response chỉ trả lỗi enum (422 field-level), không trả lỗi retired-block
  cùng lúc. Không có scenario nào ở SoT §11 kiểm tra tổ hợp này — nêu ở đây
  để người duyệt xác nhận đây là hành vi chấp nhận được (khuyến nghị: chấp
  nhận, vì cả 2 đều là 422 hợp lệ, không lộ `ArgumentError`/500, và soạn
  logic "ưu tiên lỗi nào trước" phức tạp hơn không được PRD yêu cầu).
- **Không thêm action `show`** — đúng phạm vi F3 (`docs/sot/F3-device-create-edit.md`
  §3 "Ngoài phạm vi": click-through/detail route thuộc F4). `PATCH` tìm
  record qua `:id` trong URL nhưng không có endpoint `GET /devices/:id`
  tương ứng — form Sửa luôn prefill từ dữ liệu đã có sẵn trong response
  `GET /devices` (list), không gọi thêm API (SoT §4 bước Sửa 1).
</content>
