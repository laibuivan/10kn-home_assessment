---
feature_id: F4
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế API — F4

Nguồn: `docs/design/F4-db.md` (approved — không migration, không đổi
`Device` model), `docs/sot/F4-device-detail.md` (approved), `docs/design/F3-api.md`
(approved — quy ước envelope, style controller, `serialize_device`), `PRD.md`
§"Device", `CLAUDE.md` §4, code hiện có
`api/app/controllers/api/v1/devices_controller.rb` (F2/F3: `index`,
`create`, `update`), `api/app/controllers/application_controller.rb`
(`render_not_found` dùng chung), `api/app/policies/device_policy.rb`
(`index?`/`create?`/`update?`/`Scope`), `api/config/routes.rb`.

**Kết luận đầu tiên:** F4 **không thêm controller mới, không thêm route
namespace mới** — chỉ thêm 1 action `show` vào `DevicesController` đã có,
tái dùng gần như toàn bộ hạ tầng có sẵn (`Authenticatable`, `render_not_found`
toàn cục, `serialize_device`, `DevicePolicy::Scope#resolve`). Đã xác nhận
bằng thực nghiệm (`docker compose exec api bin/rails runner`, xem
`docs/design/F4-db.md` §4) rằng `Device.find("abc")` (id sai định dạng) raise
thẳng `ActiveRecord::RecordNotFound` — **không** raise `StatementInvalid`
hay lỗi hạ tầng nào khác, nên action `show` không cần thêm bất kỳ guard/rescue
riêng nào cho A3 ngoài rescue toàn cục đã có từ F0.

## 0. Quy ước kế thừa từ F0/F2/F3 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần — không đổi.
- 404 (`{ "error": "Not found" }`): tái dùng nguyên `rescue_from
  ActiveRecord::RecordNotFound, with: :render_not_found` toàn cục ở
  `ApplicationController` — không thêm `rescue_from` cục bộ nào ở
  `DevicesController` cho action `show` (khác với F3's `RecordNotUnique`,
  vốn là ngữ nghĩa write-only không áp dụng cho `show`).
- 401 (`{ "error": "Unauthorized" }`): tái dùng `Authenticatable`, không đổi.
- **Response thành công: bọc trong key `device:`** — giữ nguyên đúng shape
  đã chốt ở `docs/design/F3-api.md` §0 cho `create`/`update`
  (`{ "device": { id, identifier, name, platform, os_version, status,
  last_seen_at, created_at, updated_at } }`), tái dùng nguyên
  `serialize_device` — **không thêm field `groups`/`applied_policies`** vào
  response (SoT OQ-6, đã quyết định "không thêm field giả").

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `GET` | `/api/v1/devices/:id` | — (không body, không query param) | 200: `{ "device": { id, identifier, name, platform, os_version, status, last_seen_at, created_at, updated_at } }` hoặc 404 | Bất kỳ user `active` thuộc org (không phân role — SoT §9) | Record lấy qua `policy_scope(Device).find(params[:id])` — 404 nếu `:id` thuộc org khác, không tồn tại, hoặc sai định dạng (A1–A3, không phải 403) |

Route (thêm `:show` vào `resources :devices` đã có, không route mới):

```ruby
resources :devices, only: [ :index, :show, :create, :update ]
```

### Pundit — `DevicePolicy`

Thêm `show?`, giữ nguyên style `index?`/`create?`/`update?` (không phân role
nội bộ org):

```ruby
class DevicePolicy < ApplicationPolicy
  def index?
    true
  end

  def show?
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

`Scope#resolve` tái dùng nguyên vẹn — dùng cho `show` để tìm record
(`policy_scope(Device).find(params[:id])`), giống hệt cách `update` đã dùng
từ F3.

## 2. Business logic

### 2.1 `GET /api/v1/devices/:id`

1. `Authenticatable#authenticate_request!` (có sẵn, `before_action`) →
   có `current_organization`.
2. Tìm record: `device = policy_scope(Device).find(params[:id])` — raise
   `ActiveRecord::RecordNotFound` nếu `:id` thuộc org khác (đã bị loại khỏi
   scope), không tồn tại, hoặc sai định dạng (đã xác nhận thực nghiệm ở
   `docs/design/F4-db.md` §4) → 404 tự động qua rescue toàn cục (A1–A3,
   không cần code mới).
3. `authorize device` — `DevicePolicy#show?` (luôn `true`). Gọi ở mức
   instance, cùng convention với `update` (`policy_scope` để tìm, `authorize`
   trên instance tìm được).
4. Render:
   ```ruby
   render json: { device: serialize_device(device) }
   ```
   Không có business logic nào khác — F4 không tính toán, không join
   group/policy (chưa có model), không side-effect (không cập nhật
   `last_seen_at` hay bất kỳ field nào khi xem chi tiết — SoT không yêu cầu
   "view = last_seen_at update", và field này là do device tự báo cáo, xem
   `docs/sot/F3-device-create-edit.md` §3 "Ngoài phạm vi").

Không cần strong params (không có input ngoài `:id` trong route, không có
body/query param nào action này đọc).

Không có transaction nào cần thêm — 1 `SELECT` đơn, không ghi dữ liệu (SoT
§10, F4-db.md §3).

## 3. Lỗi / edge case

- **404 — id thuộc Organization khác** (A1):
  ```json
  { "error": "Not found" }
  ```
  Tái dùng nguyên `render_not_found` từ F0 — không code mới, không lộ khác
  biệt nào giữa "khác org" và "không tồn tại" (đúng `CLAUDE.md` §4).
- **404 — id không tồn tại** (A2): shape giống hệt A1.
- **404 — id sai định dạng** (A3, vd `"abc"`, `"1;drop table devices"`,
  chuỗi rỗng qua route param): shape giống hệt A1/A2 — đã xác nhận thực
  nghiệm `Device.find("abc")` raise `RecordNotFound` (không phải
  `StatementInvalid`), nên **không có nhánh code riêng nào** để phân biệt 3
  case A1/A2/A3, cả 3 đi qua cùng 1 dòng `policy_scope(Device).find(...)` và
  cùng 1 rescue toàn cục — đây chính là lý do action `show` không cần thêm
  bất kỳ validate/guard nào trước khi gọi `find` (khác hẳn `index`'s
  `pagination_errors`/`filter_errors`, vốn cần guard vì filter query param
  tự do dạng string do client gõ; `:id` ở `show` không có "vùng giá trị hợp
  lệ" cần validate trước — mọi giá trị lạ tự nhiên rơi vào `RecordNotFound`).
- **200 — thành công** (khớp shape `create`/`update` từ F3):
  ```json
  { "device": { "id": 42, "identifier": "IPHONE-001", "name": "iPhone của Alice", "platform": "ios", "os_version": null, "status": "active", "last_seen_at": null, "created_at": "...", "updated_at": "..." } }
  ```
- **401 — thiếu/hết hạn token** (A13): tái dùng `Authenticatable`, không
  code mới, `{ "error": "Unauthorized" }` (F0).
- **500/hạ tầng** (A12): không thiết kế riêng ở tầng API — FE tự xử lý theo
  status code chung (`UI_UX_design.md` §9), không phải business logic F4.
  Không có kịch bản nào trong scope F4 tự nhiên tạo ra 500 (không có
  computation, không external call) — chỉ xảy ra do lỗi hạ tầng thật sự
  (DB down, v.v.), FE vẫn phải xử lý được như 1 network error thông thường.

## 4. Xử lý bất đồng bộ

Không áp dụng — F4 chỉ đọc 1 record đơn lẻ, không phải thao tác hàng loạt
trên Group (khác F6/F8), không có computation nào cần tách job (policy
resolution thuộc F9).

## 5. Rủi ro / open question

- **Không thêm field `groups`/`applied_policies` vào response, kể cả dạng
  mảng rỗng** (SoT OQ-6, xác nhận lại ở đây vì đây là tài liệu chốt response
  shape thật sự): quyết định có chủ đích, tránh bịa 1 contract mà F6/F8/F9
  nhiều khả năng cần thiết kế khác (vd `applied_policies` cần field
  `source`/`type`/`overridden_by`, không phải 1 mảng phẳng đơn giản). Khi F6
  làm Group membership và F9 làm Policy resolution, họ **sẽ mở rộng chính
  response này** (thêm field mới), không phải tạo endpoint riêng — implementer
  F6/F9 cần đọc lại file này trước khi đổi shape.
- **FE tự vẽ 2 khối "Groups đang thuộc"/"Policy đang áp dụng" ở dạng empty
  tĩnh, không gọi thêm API nào** — xác nhận lại quyết định SoT OQ-1, vì
  không có endpoint nào khác ngoài `GET /api/v1/devices/:id` được thiết kế ở
  F4 cho 2 khối này (không có `GET /api/v1/devices/:id/groups` hay tương
  tự) — `frontend-designer` (`/design F4` bước Frontend) không nên tự bịa
  thêm endpoint cho 2 khối này.
- **`show` dùng `policy_scope(Device).find`, không phải
  `current_organization.devices.find`** (khác cách `create` dùng
  `current_organization.devices.build`) — nhất quán với cách `update` đã
  làm ở F3 (`docs/design/F3-api.md` §2.2), vì `show`/`update` đều là "tìm 1
  record có sẵn" (dùng `policy_scope` đúng convention Pundit chuẩn: `Scope`
  cho tìm-kiếm, `current_organization.<assoc>.build` chỉ dùng khi **tạo
  mới** một record chưa tồn tại). Ghi lại ở đây để tránh nhầm lẫn 2 pattern
  này khi implement.
- **Không thêm action `destroy`** — đúng SoT §3 "Ngoài phạm vi" (PRD không
  liệt kê "xóa" cho Devices, khác Groups).
