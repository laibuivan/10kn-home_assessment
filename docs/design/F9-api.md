---
feature_id: F9
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (approved by Claude on behalf of user, explicit delegation 2026-09-17)
date: 2026-09-17
---

# Thiết kế API — F9

Nguồn: `docs/sot/F9-policy-resolution.md` (approved — §8 endpoint dự kiến,
§9 RBAC, §11 toàn bộ 18 Scenario canonical, §12 OQ-1..OQ-7 đã chốt theo
khuyến nghị), `docs/design/F9-db.md` (approved — service
`Devices::PolicyResolver`, query plan 2-4 câu, lọc `active` ở tầng Ruby
không ở SQL, §4 để ngỏ 1 câu hỏi mở "có cần assert phòng vệ cross-org không"
— **quyết định ở tài liệu này, xem §6**), `docs/design/F8-api.md` (approved
— văn phong, pattern `.merge(current_organization.<assoc>)` làm lớp phòng vệ
thứ 2, pattern "action tên `index` nhưng phải `authorize record, :show?`
tường minh" của `GroupPolicy`/`PolicyPolicy`, envelope lỗi 401/404,
không dùng shape phẳng), `CLAUDE.md` §4 (org isolation 404 not 403), code
hiện có `api/app/controllers/application_controller.rb`,
`api/app/controllers/api/v1/devices_controller.rb`,
`api/app/controllers/concerns/paginatable.rb`,
`api/app/policies/device_policy.rb`, `api/app/models/{policy_assignment,
group_membership,policy,device,group}.rb`, `api/config/routes.rb`.

**Kết luận đầu tiên:** F9 cần **1 controller mới**
(`Api::V1::DeviceAppliedPoliciesController`, action `index`), **1 service
mới** (`Devices::PolicyResolver`, `api/app/services/devices/policy_resolver.rb`)
trả thẳng mảng Hash đã đúng shape JSON cuối cùng (không có class serializer
riêng — xem §2.3), **không Pundit policy mới** (tái dùng nguyên
`DevicePolicy#show?`, gọi tường minh vì action là `index`), **không route
lồng dưới `/groups` hay `/policies`** (chỉ `member do get "applied_policies"
... end` trong `resources :devices`, đúng OQ-2).

## 1. Endpoint

| Method | Path | Input | Output | Org-scope |
|---|---|---|---|---|
| `GET` | `/api/v1/devices/:id/applied_policies` | — (không query param, không phân trang — xem §2.2) | `200: { "applied_policies": [ {...} ] }` (mảng rỗng nếu không có policy nào áp dụng — A1) / `401` (thiếu/sai token) / `404` (device không tồn tại hoặc khác org — không phân biệt, A15/A16) | `policy_scope(Device).find(params[:id])`, `authorize device, :show?` |

Không có nhánh `422` — endpoint chỉ đọc, không nhận input ngoài `:id` (SoT §6
ghi chú "F9 chỉ đọc"), một `:id` sai định dạng đi thẳng vào `RecordNotFound`
→ 404 qua `rescue_from` toàn cục (đã có sẵn từ F0, không code mới).

### Route

Thêm vào `api/config/routes.rb`, trong `resources :devices do member do ...
end end` — hiện `devices` **chưa có** `member do` nào (khác `groups`/
`policies`), F9 là feature đầu tiên thêm route con cho `devices`:

```ruby
resources :devices, only: [ :index, :show, :create, :update ] do
  member do
    # F9 — docs/design/F9-api.md §1. OQ-2: endpoint riêng, tách khỏi
    # GET /devices/:id để loading/error của khối "Policy đang áp dụng" độc
    # lập với Header/Groups (carry-over F4 §12).
    get "applied_policies", to: "device_applied_policies#index"
  end
end
```

`member do ... end`, không `resources :devices do resources
:applied_policies end` — cùng lý do đã lặp lại ở F6/F8: giữ `params[:id]` là
Device, không đổi tên thành `:device_id`, khớp path SoT §8/§11 nguyên văn
(`GET /api/v1/devices/:id/applied_policies`).

### Pundit — tái dùng nguyên `DevicePolicy#show?`

Không sửa `device_policy.rb`. `show?` đã `true` không điều kiện từ F2 (không
phân role). Gọi **tường minh** ở controller:

```ruby
authorize device, :show?
```

không phải `authorize device` trần — action là `index`
(`DeviceAppliedPoliciesController#index`), và Pundit tự suy `action_name` →
`index?` nếu không truyền action tường minh. `DevicePolicy` có `index?`
nghĩa khác ("được liệt kê toàn bộ Device") — cùng đúng cái bẫy đã ghi ở
`docs/design/F6-api.md` §1 cho `GroupPolicy#show?`/`docs/design/F8-api.md`
§1 cho `PolicyPolicy#show?`. Hôm nay `index?` và `show?` đều `true` nên
không có khác biệt hành vi thực tế, nhưng viết tường minh để không thành
bẫy âm thầm nếu sau này 1 trong 2 action đổi ý nghĩa role.

**Không cần Pundit policy mới cho kết quả resolution** — kết quả không phải
1 resource độc lập có id/scope riêng, nó là 1 phép tính trên 1 Device đã
authorize xong; đúng tinh thần SoT §8 ("tái dùng `DevicePolicy#show?`... nếu
endpoint được coi là 1 phần của 'xem chi tiết Device'").

## 2. Business logic từng endpoint

### 2.1 `GET /api/v1/devices/:id/applied_policies` (`DeviceAppliedPoliciesController#index`)

```ruby
def index
  device = policy_scope(Device).find(params[:id])   # 404 — org khác/không tồn tại/sai định dạng (A15/A16)
  authorize device, :show?

  results = Devices::PolicyResolver.new(device).call
  render json: { applied_policies: results }
end
```

- Không `authenticate_request!` viết tay — `Authenticatable` include ở
  `ApplicationController`? **Không** — kiểm tra lại: `Authenticatable` được
  `include` **từng controller** (như `DevicesController`, `PoliciesController`),
  không phải ở `ApplicationController`. `DeviceAppliedPoliciesController`
  **phải** `include Authenticatable` (401 nếu thiếu/sai token — A17), đúng
  quy ước mọi controller resource khác.
- **Không `Paginatable`** — quyết định tường minh, xem §2.2.
- `results` đã là mảng Hash JSON-ready (xem §2.3) — controller không map/transform
  thêm gì, chỉ bọc key `applied_policies`.
- Thứ tự đúng SoT §4 bước 3: tìm Device (org-scope) → authorize → gọi
  service. Không side-effect nào khác (không gọi `record_seen!` — đó là
  hành vi của `GET /devices/:id`, F9 không lặp lại; xem §6 để không hiểu
  nhầm là thiếu sót).

### 2.2 Quyết định: không phân trang

Khác mọi list endpoint khác trong app (Device/Group/Policy list, các list
con của F8 — đều qua `Paginatable`), `applied_policies` **không** có `meta`/
`page`/`per_page`. Lý do:

- Đơn vị trả về không phải "N record của 1 bảng lớn có thể tăng vô hạn" —
  nó là "N `type` Policy khác nhau đang áp dụng lên **1** Device", bị chặn
  trên bởi số `type` Policy phân biệt tồn tại trong Organization (SoT §10:
  "vài chục", cùng luận cứ F9-db.md §3.4 đã dùng để từ chối cache/`LIMIT`).
- Thêm `meta`/phân trang vào 1 response vốn đã lồng cấu trúc 2 tầng
  (`applied_policies[].candidates[]`) làm phức tạp hợp đồng không cần thiết
  — không có acceptance scenario nào yêu cầu phân trang khối này
  (`UI_UX_design.md` §5 cũng không mô tả phân trang cho bảng này).
- Nếu sau này 1 Device có hàng trăm `type` (không thực tế theo giả định
  SoT §10), đây là rủi ro production ghi vào `DESIGN.md`, không phải lý do
  để thêm phân trang bây giờ mà không có yêu cầu.

### 2.3 Response shape — chốt đầy đủ

**Quyết định làm rõ 1 điểm SoT §8 viết mơ hồ**: "danh sách theo từng `type`"
được hiểu là **mảng object**, mỗi object có field `type` tường minh — **không
phải** 1 object JSON keyed-by-type-string (`{"wifi": {...}, "password":
{...}}`). Lý do: (a) thứ tự key trong object JSON không phải hợp đồng đáng
tin cậy để FE `v-for` render bảng theo thứ tự nhất quán; (b) **mọi** response
list khác trong toàn app (`policies: [...]`, `devices: [...]`,
`policy_assignment_jobs: [...]`) đều là mảng, không có tiền lệ nào keyed-by-
field — giữ nhất quán tuyệt đối thay vì để F9 là ngoại lệ duy nhất.

```jsonc
GET /api/v1/devices/42/applied_policies

200 OK
{
  "applied_policies": [
    {
      "type": "wifi",
      "policy": {
        "id": 12,
        "name": "Wifi Direct",
        "type": "wifi",
        "configuration": { "ssid": "Corp-5G" },
        "status": "active"
      },
      "source": {
        "kind": "direct",       // "direct" | "group"
        "group": null           // { "id": 3, "name": "Sales Laptops" } khi kind == "group"
      },
      "conflict": true,
      "candidates": [
        {
          "policy_id": 12,
          "name": "Wifi Direct",
          "configuration": { "ssid": "Corp-5G" },
          "status": "active",
          "source": { "kind": "direct", "group": null },
          "included": true,
          "excluded_reason": null
        },
        {
          "policy_id": 15,
          "name": "Wifi Group",
          "configuration": { "ssid": "Guest-2G" },
          "status": "active",
          "source": { "kind": "group", "group": { "id": 3, "name": "Sales Laptops" } },
          "included": false,
          "excluded_reason": "Ưu tiên thấp hơn"
        },
        {
          "policy_id": 19,
          "name": "Wifi Legacy",
          "configuration": { "ssid": "Old-AP" },
          "status": "inactive",
          "source": { "kind": "group", "group": { "id": 5, "name": "Legacy Devices" } },
          "included": false,
          "excluded_reason": "Policy đang inactive, không được tính hiệu lực"
        }
      ]
    }
  ]
}
```

- **Không có bất kỳ `type` nào chỉ toàn candidate `inactive`** trong mảng
  `applied_policies` — nếu 1 `type` không còn candidate `active` nào, `type`
  đó **biến mất hoàn toàn** khỏi response (A9), không xuất hiện với
  `candidates: []`. Chỉ `type` đã có ≥1 candidate `active` (đã có dòng thắng)
  mới mang theo cả các candidate `inactive`/thua cuộc trong `candidates` để
  phục vụ "Xem tất cả nguồn" (OQ-4).
- **`candidates` chứa MỌI ứng viên `active` của `type` đó (kể cả những cái
  cùng `policy_id` với candidate thắng — xem A13) CỘNG toàn bộ ứng viên
  `inactive`.** Không có ứng viên nào bị lọc bỏ khỏi mảng này trừ đúng lý do
  đã nêu ở trên (type không có active nào).
- **`policy`** (field thắng ở top-level): `id, name, type, configuration,
  status` — SoT §8 chỉ liệt `{id, name, type, configuration}`; tài liệu này
  **thêm `status`** để phục vụ đúng OQ-7 ("cột Trạng thái = `policy.status`
  badge") mà không bắt FE phải tự suy luận field nào đại diện cho cột đó —
  giá trị luôn là `"active"` theo định nghĩa R1 (chỉ policy active mới có
  thể thắng), nhưng field vẫn tường minh thay vì FE hard-code chuỗi
  `"active"`.
- **`candidates[].policy_id`** (không phải `id`) — đúng chữ SoT §8, phân
  biệt rõ với `policy` ở top-level (record đầy đủ) — `candidates` là "tham
  chiếu nhẹ", không lặp lại field `type` (đã biết từ object cha).
- **`source`** xuất hiện cả ở top-level (nguồn của policy thắng) **và** mỗi
  phần tử `candidates` (nguồn riêng của từng ứng viên) — bắt buộc cho A13
  (popover phải liệt kê **từng Group** đang đóng góp cùng 1 policy, không
  gộp).
- **`excluded_reason`**: `nil` khi `included: true`; khi `false`, đúng 1
  trong 2 chuỗi cố định (hằng số, xem §3) — khớp nguyên văn 2 lý do trong
  Scenario canonical SoT §11 ("Ưu tiên thấp hơn" / "Policy đang inactive,
  không được tính hiệu lực"), không phải mã enum để FE tự dịch — cùng tiền
  lệ `PolicyAssignmentJob#error_message` (F8) đã trả prose tiếng Việt thẳng
  từ API, không phải code cho FE map.
- **`conflict`** tính trên tập candidate **`active`** của `type` đó — `true`
  khi ≥2 `configuration` khác nhau (so sánh Hash `==` sau khi Postgres cast
  JSONB, đúng F9-db.md §3.1) — độc lập với `included`, đúng R8.

### 2.4 Case rỗng

Device không có candidate active ở bất kỳ `type` nào (A1) →
`{"applied_policies": []}` — **mảng rỗng, không phải `null`/object đặc
biệt**, HTTP `200` (không phải `404` — Device tồn tại và hợp lệ, chỉ là
không có gì áp dụng). Đúng tiền lệ mọi list rỗng khác trong app (`devices:
[]`, `groups: []` — chưa từng dùng `null` cho "không có gì").

### 2.5 Service `Devices::PolicyResolver` — interface & thuật toán chọn thắng đầy đủ

`api/app/services/devices/policy_resolver.rb`:

```ruby
module Devices
  class PolicyResolver
    EXCLUDED_REASON_INACTIVE = "Policy đang inactive, không được tính hiệu lực".freeze
    EXCLUDED_REASON_LOWER_PRIORITY = "Ưu tiên thấp hơn".freeze

    def initialize(device)
      @device = device
    end

    # => Array<Hash> — đúng shape JSON ở §2.3, sẵn sàng render json: trực
    # tiếp. Hàm thuần: 2 lần gọi liên tiếp với state DB không đổi phải trả
    # 2 mảng Hash bằng nhau tuyệt đối (kể cả thứ tự phần tử) — R5/A18.
    def call
      candidates = load_candidates
      candidates
        .group_by { |c| c.policy.type }
        .filter_map { |type, group| resolve_type(type, group) }
        .sort_by { |entry| entry[:type] }   # thứ tự type: alphabet — xác định tuyệt đối
    end

    private

    attr_reader :device

    # ...
  end
end
```

**Thuật toán `resolve_type(type, group)`** (mỗi `group` = mọi
`PolicyAssignment` — cả active lẫn inactive — của 1 `type`):

1. `actives = group.select { |c| c.policy.status == "active" }` — nếu rỗng
   → `return nil` (`filter_map` tự loại `type` này khỏi kết quả — A9).
2. `inactives = group - actives`.
3. **Sort key đầy đủ, áp dụng cho `actives`** (kết hợp R2→R3→R4 **và** OQ-3
   thành 1 khóa sort duy nhất — xem lý do bên dưới):
   ```ruby
   sort_key = ->(c) {
     [
       c.device_id.present? ? 0 : 1,        # R2 — trực tiếp (0) thắng group (1)
       -c.policy.updated_at.to_f,            # R3 — updated_at mới hơn thắng (số âm để asc-sort thành desc)
       c.policy_id,                          # R4 — id nhỏ hơn thắng
       c.group_id || Float::INFINITY         # OQ-3 — cùng policy_id qua ≥2 group: group_id nhỏ hơn thắng (A13)
     ]
   }
   winner_row = actives.min_by(&sort_key)
   ```
   - **Vì sao cần thêm phần tử thứ 4 (`group_id`) mà R2–R4 gốc không có**:
     A13 (2 Group cùng gán **đúng 1 Policy**) tạo ra 2 row có cùng
     `device_id.present?` (đều `false`), cùng `policy.updated_at`, cùng
     `policy_id` (**cùng 1 policy**, không phải 2 bản ghi khác nhau) — 3
     khóa đầu hòa tuyệt đối. Không có khóa thứ 4, `min_by` sẽ phụ thuộc thứ
     tự phần tử trong mảng Ruby, mà thứ tự đó đến từ thứ tự trả về của 2
     câu SQL không có `ORDER BY` tường minh (F9-db.md §3.1) — vi phạm R5/A18
     ("hàm thuần của state hiện tại", không phụ thuộc thứ tự query). OQ-3 đã
     chốt tie-break này ở tầng SoT ("badge chính = `group_id` nhỏ nhất")
     nhưng chỉ mô tả ở mức "hiển thị" — tài liệu này làm rõ nó phải nằm
     **trong chính khóa sort**, không phải 1 bước riêng sau đó, để toàn bộ
     thuật toán chọn thắng là 1 hàm sort duy nhất, xác định tuyệt đối cho
     **mọi** tổ hợp input có thể có (không chỉ case OQ-3 nêu tên).
4. `winning_policy_id = winner_row.policy_id`.
5. `conflict = actives.map { |c| c.policy.configuration }.uniq.size > 1` (R8).
6. Build `candidates` JSON:
   - Với mỗi `c` trong `actives.sort_by(&sort_key)`: `included = (c.policy_id
     == winning_policy_id)`; `excluded_reason = included ? nil :
     EXCLUDED_REASON_LOWER_PRIORITY`.
   - Với mỗi `c` trong `inactives.sort_by(&sort_key)`: `included = false`;
     `excluded_reason = EXCLUDED_REASON_INACTIVE`.
   - Nối 2 mảng theo thứ tự **active trước, inactive sau** — khớp đúng thứ
     tự đọc trong Scenario canonical SoT §11 ("Wifi New, Wifi Old, Wifi
     Inactive").
7. `source` cho `winner_row`: `kind: winner_row.device_id.present? ?
   "direct" : "group"`; `group: kind == "group" ? {id: winner_row.group.id,
   name: winner_row.group.name} : nil`.
8. Trả `{type:, policy: {id: winner_row.policy.id, name: ..., type: ...,
   configuration: ..., status: winner_row.policy.status}, source:, conflict:,
   candidates:}`.

**`load_candidates`** — đúng query plan đã approve ở F9-db.md §3.1, **cộng 1
điểm mở rộng phòng vệ cross-org** — xem §6 quyết định câu hỏi mở.

### 2.6 Vì sao không có serializer class riêng

Không tạo `app/serializers/` (thư mục này **chưa tồn tại** trong repo — xác
nhận qua kiểm tra trực tiếp `api/app/`). Toàn bộ response JSON của app từ
F2–F8 được build bằng 1 trong 2 cách: (a) hash trực tiếp trong controller
(`serialize_device`/`serialize_policy` — hàm private hoặc concern khi ≥2 nơi
dùng), (b) hash trực tiếp trong service/job khi có (chưa có tiền lệ service
nào khác ngoài `JsonWebToken`). F9 là **service đầu tiên** của app có trách
nhiệm build shape JSON lồng nhau phức tạp — quyết định đặt việc build hash
**trong chính `Devices::PolicyResolver`**, không tách thêm 1 class serializer
độc lập, vì:

- Chỉ **1 call site** (`DeviceAppliedPoliciesController#index`) — đúng
  nguyên tắc đã lặp lại xuyên suốt F5-F8 ("tách concern/class riêng khi ≥2
  nơi cần, không tách trước" — `docs/design/F6-api.md`/`F8-api.md` §5
  OQ-API-1).
- Test TDD bắt buộc của service (`CLAUDE.md` §3 rule 4) đã tự nhiên assert
  đúng shape Hash cuối cùng — tách thêm 1 serializer sẽ tạo 2 lớp test
  trùng lặp (service test + serializer test) cho cùng 1 output, không có
  lợi ích tương xứng.
- Nếu 1 feature sau (ngoài phạm vi F9) cần dùng lại kết quả resolution ở
  nơi khác (vd 1 endpoint tổng hợp "policy áp dụng cho N device"), đó là
  lúc tách hàm build-hash ra khỏi `resolve_type` thành 1 method/class dùng
  chung — chưa cần bây giờ.

## 3. Constant mới cần thêm

```ruby
# app/services/devices/policy_resolver.rb (hằng số nội bộ, không thêm vào Policy/Device)
EXCLUDED_REASON_INACTIVE = "Policy đang inactive, không được tính hiệu lực".freeze
EXCLUDED_REASON_LOWER_PRIORITY = "Ưu tiên thấp hơn".freeze
```

Đặt **trong service**, không phải `Policy`/`PolicyAssignment` model — đây là
message của **kết quả tính toán F9**, không phải message validate/lỗi ghi dữ
liệu (khác `Policy::INACTIVE_ASSIGNMENT_MESSAGE`/`Device::RETIRED_POLICY_MESSAGE`
của F8, vốn gắn với hành động ghi ở model tương ứng). Nguyên văn khớp đúng
2 chuỗi trong Scenario canonical SoT §11 dòng 484-485 — **không** thêm phần
mở rộng "(updated_at cũ hơn)" như câu chữ ở A6 (§5.2, không phải canonical)
để tránh lệch giữa 2 chỗ SoT tự mâu thuẫn nhẹ về câu chữ (§11 canonical
thắng, đúng vai trò "canonical" ghi rõ trong tiêu đề §11).

## 4. Xử lý bất đồng bộ

**Không áp dụng.** F9 là read-only, đồng bộ hoàn toàn trong 1 request — SoT
§3 chỉ liệt `applied_policies` là 1 endpoint đọc-only, không side-effect,
không job. Chi phí đã xác nhận không phụ thuộc kích thước Group (F9-db.md
§3.1-§3.4, "2-4 query DB cố định") nên không cần bất kỳ cơ chế bất đồng bộ
nào — khác hẳn F8 (nơi `POST .../policy_assignments` cho Group phải job vì
ghi hàng loạt tỉ lệ với kích thước Group). Không có trạng thái
`pending/running/done/failed` nào ở F9.

## 5. Lỗi / edge case — map toàn bộ Scenario canonical (SoT §11) + edge case §5.2

| SoT | Tình huống | Request | Response | Cơ chế |
|---|---|---|---|---|
| Scenario 1 / A1 | Device không thuộc group, không gán trực tiếp | `GET .../applied_policies` | `200 {"applied_policies": []}` | Không candidate nào → mảng rỗng (§2.4) |
| Scenario 2 / A2 | 1 policy gán trực tiếp, active, không group | `GET ...` | `200`, 1 entry `type` đó, `source.kind: "direct"` | `actives` chỉ có 1 row, `device_id` present → sort_key thắng ngay |
| Scenario 3 / A3 | 1 policy qua 1 Group, active | `GET ...` | `200`, 1 entry, `source: {kind: "group", group: {id, name}}` | `actives` 1 row, `group_id` present |
| Scenario 4 / A4 | 2 type khác nhau (wifi/password), không gán chồng | `GET ...` | `200`, 2 entry riêng, mỗi entry `conflict: false` | `group_by policy.type` tách riêng — không so sánh chéo type |
| Scenario 5 / A5 | Trực tiếp + group cùng type cùng configuration | `GET ...` | `200`, 1 entry `type`, `policy` = bản trực tiếp, `conflict: false` | `conflict` = `uniq(configuration).size > 1` → chỉ 1 giá trị unique dù 2 policy id khác nhau; sort_key vẫn chọn trực tiếp thắng (R2) cho **dòng hiển thị**, đúng OQ-1 |
| Scenario 6 / A6 | Conflict 2 group, `updated_at` khác | `GET ...` | `200`, `policy` = bản `updated_at` mới nhất, `conflict: true` | Sort key phần tử 2 (`-updated_at`) phân định trước khi tới `policy_id` |
| Scenario 7 / A7 | Hòa `updated_at`, `id` nhỏ hơn thắng | `GET ...` | `200`, `policy` = bản `id` nhỏ hơn | Sort key phần tử 3 (`policy_id` asc) |
| Scenario 8 / A8 | Trực tiếp thắng dù group `updated_at` mới hơn | `GET ...` | `200`, `policy` = bản trực tiếp, `conflict: true` | Sort key phần tử 1 (`device_id` present) luôn thắng trước khi so `updated_at` |
| Scenario 9 / A9 | Toàn bộ candidate của 1 type đều inactive | `GET ...` | `200`, `type` đó **không xuất hiện** trong `applied_policies` | `actives.empty?` → `resolve_type` trả `nil` → `filter_map` loại bỏ |
| Scenario 10 / A10 | Policy đang thắng bị deactivate | `GET ...` (lần 2, sau khi Policy đổi status) | `200`, Policy đó biến mất khỏi kết quả | Service đọc `policy.status` tại thời điểm gọi (không cache) — R5 |
| Scenario 11 / A11 | Policy inactive được activate lại | `GET ...` (lần kế tiếp) | `200`, Policy xuất hiện lại, không cần gán lại | Cùng cơ chế Scenario 10 — `policy_assignment` chưa từng bị xóa (F8 A22) |
| Scenario 12 / A12 | Group bị xóa (đã gán Policy) | `GET ...` (sau khi Group xóa) | `200`, Policy của Group đó biến mất | F8 đã `dependent: :delete_all` `policy_assignments` khi xóa Group (F8-db §1) — `load_candidates` không còn thấy row đó |
| Scenario 13 | Cùng 1 policy qua 2 Group | `GET ...` | `200`, 1 entry duy nhất, `source.group` = group_id nhỏ nhất, `candidates` liệt kê cả 2 group, cả 2 `included: true` | Sort key phần tử 4 (`group_id`) chọn badge; `included = (policy_id == winning_policy_id)` đúng cho cả 2 row vì cùng `policy_id` |
| Scenario 14 / A14 | Device retired | `GET ...` | `200`, dữ liệu y hệt Device active | Không rẽ nhánh `device.status` nào trong service/controller — đọc dữ liệu, không phải hành động ghi |
| Scenario 15 / A15 | Device thuộc org khác (đoán id) | `GET /devices/77/applied_policies` (org khác) | `404 {"error": "Not found"}` | `policy_scope(Device).find` raise trước khi chạm service |
| Scenario 16 / A16 | Device không tồn tại | `GET /devices/999999/applied_policies` | `404` | Cùng cơ chế Scenario 15 |
| Scenario 17 / A17 | Không token | `GET /devices/1/applied_policies` (không `Authorization` header) | `401 {"error": "..."}` | `Authenticatable` (include ở controller này) |
| Scenario 18 / A18 | Gọi 2 lần liên tiếp, state không đổi | `GET ...` × 2 | 2 response **giống hệt nhau tuyệt đối** (kể cả thứ tự mảng) | Không cache (R5); sort tường minh mọi tầng (`type` asc, `sort_key` đầy đủ 4 phần tử — không phần tử nào phụ thuộc thứ tự query) |
| Scenario (popover) / OQ-4 | Conflict + 1 inactive candidate | `GET ...` | `candidates` có đủ 3: winner (`included: true`), loser active (`excluded_reason: "Ưu tiên thấp hơn"`), inactive (`excluded_reason: "Policy đang inactive, không được tính hiệu lực"`) | §2.3/§2.5 bước 6 |
| Scenario (lỗi tải) / A20 | API trả 500 | `GET ...` → lỗi hạ tầng | Ngoài phạm vi tài liệu này (BE không cố ý trả 500) — **FE** xử lý qua `ErrorState` riêng cho khối này (SoT §7, thuộc `/design F9-frontend`), không kéo sập Header/Groups vì đây **đã là endpoint tách riêng** (đúng OQ-2, tiền đề để FE làm được việc này) | N/A ở tầng API — chỉ cần xác nhận response 500 (nếu có) không lẫn body của Header/Groups, đúng vì là 2 request độc lập |
| A19 | `assignments_count` (F8, Policy List) không bị ảnh hưởng | — | — | Không thuộc phạm vi F9, ghi chú không cần test chéo (SoT A19) |

## 6. Rủi ro / open question

### 6.1 Quyết định câu hỏi mở từ `docs/design/F9-db.md` §4: có cần assert phòng vệ cross-org không?

**Quyết định: có, nhưng ở dạng "filter phòng vệ" (cùng idiom `.merge
(current_organization.<assoc>)` đã dùng xuyên suốt F6/F8), không phải
`raise`/exception mới.**

F9-db.md để ngỏ 2 lựa chọn: (a) tin tưởng tuyệt đối invariant "Group chỉ
chứa Device cùng org" do F6/F8 duy trì, không kiểm tra lại; (b) tự assert
(`raise` nếu phát hiện lệch org). Tài liệu này chọn **phương án thứ 3**,
nằm giữa 2 lựa chọn đó, và nhất quán hơn với phần còn lại của codebase:

- **Bước 1 của query plan** (`GroupMembership.where(device_id:
  device.id).pluck(:group_id)`, F9-db.md §3.1) hiện **không** filter theo
  org. Tài liệu này đổi thành:
  ```ruby
  group_ids = GroupMembership.joins(:group)
    .merge(current_organization.groups)
    .where(device_id: device.id)
    .pluck(:group_id)
  ```
  Thêm đúng 1 `JOIN groups` + điều kiện `organization_id` (dùng PK index có
  sẵn của `groups`, không cần index mới — không mâu thuẫn với kết luận "không
  thêm index" của F9-db.md §3.2, chỉ thêm 1 join rẻ trên tập kết quả đã nhỏ
  từ `index_group_memberships_on_device_id`).
- **Bước 2 (nhánh trực tiếp và nhánh group)** đã filter
  `current_organization.policy_assignments` từ chính F9-db.md §3.1/§3.3 —
  giữ nguyên, không đổi.
- **Vì sao chọn "filter" thay vì "raise"**: mọi lớp phòng vệ thứ 2 hiện có
  trong app (F6 `device.groups.merge(current_organization.groups)`, F8
  `Policy.joins(:policy_assignments).merge(current_organization.policies)`
  ở 3 endpoint "chiều ngược") đều là **filter im lặng** (loại bỏ hàng vi
  phạm khỏi kết quả), không phải `raise` gây lỗi 500. Dùng `raise` ở F9 sẽ
  là tiền lệ duy nhất trong toàn app biến 1 vi phạm invariant nội bộ (bug ở
  F6/F8, không phải lỗi của người gọi) thành lỗi hạ tầng lộ ra ngoài — sai
  hướng so với triết lý "404 khi sai org, không leak lỗi" của `CLAUDE.md`
  §4. Filter khiến trường hợp lý thuyết "group lệch org" đơn giản **không
  xuất hiện** trong kết quả resolution (coi như Device không thuộc group
  đó) — an toàn hơn (không leak), không gây crash, và tốn chi phí gần như 0.
- **Vẫn giữ nguyên kết luận "không tự tin cậy write-time invariant" của
  `CLAUDE.md` §4** ("mọi controller action lấy resource qua
  `current_organization.<assoc>`") — áp dụng đúng câu chữ đó ngay trong
  service, đúng như F8-db.md §3.3 đã tự lập luận cho lớp `organization_id`
  filter trên `policy_assignments`. Không có lý do để bước 1 (group_ids) là
  ngoại lệ duy nhất bỏ qua nguyên tắc này trong khi bước 2 đã áp dụng.

### 6.2 Điểm mở khác cần người duyệt cân nhắc

- **`status` thêm vào `policy` top-level** (§2.3) là 1 field SoT §8 không
  liệt kê nguyên văn — mở rộng nhỏ, có lý do rõ (OQ-7), nhưng là điểm lệch
  khỏi "chữ" SoT §8 cần xác nhận khi approve.
- **Quyết định "mảng, không phải object keyed-by-type"** (§2.3) — SoT §8
  viết "danh sách theo từng `type`" đủ mơ hồ để hiểu 2 cách; tài liệu này
  chọn mảng và giải thích lý do, cần người duyệt xác nhận không muốn
  object-keyed (vd để FE lookup nhanh theo type mà không cần `.find`).
- **2 chuỗi `excluded_reason` cố định** (§3) khớp đúng Scenario canonical
  §11, **không** khớp thêm phần mở rộng "(updated_at cũ hơn)" ở A6 (§5.2) —
  đã chọn ưu tiên §11 vì được đặt tên "canonical"; nếu người duyệt muốn câu
  dài hơn có ngữ cảnh, đây là thay đổi 1 dòng hằng số, không ảnh hưởng field
  nào khác.
- **Không phân trang** (§2.2) — quyết định dựa trên giả định "số `type`
  luôn nhỏ" kế thừa từ SoT §10/F9-db.md §3.4; nếu giả định sai trong thực
  tế, đây là điểm cần thêm phân trang sau, không phải lỗi thiết kế hiện tại.
- **`Devices::PolicyResolver` không tự kiểm tra `device.status`** (đọc dữ
  liệu bình thường cho Device retired, A14) — xác nhận tường minh: đây
  **không phải** thiếu sót, `CLAUDE.md` §4 "retired bất biến" chỉ áp dụng
  cho hành động **ghi**, F9 không ghi gì.
- **Không thêm entry point ghi nào** ở Device Detail (đúng OQ-6 đã chốt ở
  SoT) — tài liệu này xác nhận lại, không đề xuất thêm.
