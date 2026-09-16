---
feature_id: F3
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Database — F3

Nguồn: `docs/sot/F3-device-create-edit.md` (approved), `PRD.md` §"Device",
`CLAUDE.md` §4, `api/db/schema.rb` hiện có (bảng `devices` đã tồn tại từ F2,
xem `docs/design/F2-db.md`), `api/app/models/device.rb` hiện có,
`api/app/controllers/api/v1/devices_controller.rb` (F2, chỉ có `index`).

**Kết luận đầu tiên (khớp SoT §8, §3 "Ngoài phạm vi"):** F3 **không cần
migration nào**. Không thêm/đổi cột, không thêm bảng, không thêm DB-level
check constraint. Toàn bộ phần "mới" của F3 nằm ở **model-layer** (validation
+ callback trên `Device`) và ở API-layer (`/design F3` API — strong params,
Pundit, error envelope) — tài liệu này chỉ chốt phần model.

## 1. Model / field / enum / relation

| Model | Field/Assoc/Method | Kiểu | Ràng buộc / hành vi | Add/Change/No-change |
|---|---|---|---|---|
| `Device` | `identifier`, `name`, `platform`, `os_version`, `status`, `organization_id`, `last_seen_at`, timestamps | (như F2) | Không đổi field/kiểu/index nào — xem `docs/design/F2-db.md` §1 | **No-change** |
| `Device` | `validates :identifier, uniqueness: { scope: :organization_id, ... }` | — | **Đổi `message`** sang tiếng Việt: `"Identifier này đã tồn tại trong tổ chức của bạn."` (SoT §6, `UI_UX_design.md` §10 — trước đây F2 dùng message mặc định của Rails vì F2 không có form để user nhìn thấy lỗi này) | **Change** |
| `Device` | `validates :name, :platform, :status, presence: true` | — | Giữ nguyên từ F2, không đổi message (không có yêu cầu Vietnamese-hoá riêng cho các field này — SoT/`UI_UX_design.md` §10 chỉ nêu ví dụ cho `identifier`) | **No-change** |
| `Device` | `before_validation :restore_immutable_identifier, on: :update` | callback | **Mới** — enforce "identifier bất biến sau khi tạo" ở tầng model, xem §1a | **Add** |
| `Device` | `before_validation :block_all_changes_when_retired, on: :update` | callback (có thể `throw(:abort)`) | **Mới** — enforce "retired bất biến" (invariant `CLAUDE.md` §4), xem §1b | **Add** |
| `Device::PLATFORM_INVALID`/`STATUS_INVALID` (nếu cần dùng lại constant) | — | — | Không thêm — việc guard `ArgumentError` khi gán enum từ string lạ là quyết định controller-layer, xem §4 | **No-change** (ghi chú, không phải quyết định DB) |

### 1a. `identifier` bất biến sau khi tạo — cơ chế model-layer

SoT OQ-1: "Không — `identifier` bất biến sau khi tạo... strong params không
permit field này cho update... không báo lỗi." Quyết định chính (strong
params không cho phép `identifier` trong permitted params của action
`update`) thuộc `/design F3` API, **không** thuộc file này. Nhưng có 2 lý do
DB design cần thêm 1 lớp model-layer bên dưới thay vì chỉ dựa vào strong
params:

1. **Nhất quán triết lý `CLAUDE.md` §4** ("validate ở service layer, không
   chỉ ở UI") — áp dụng ngược lại: không chỉ dựa vào 1 lớp controller, model
   nên tự bảo vệ độc lập để không phụ thuộc việc dev tương lai không lỡ thêm
   `:identifier` vào `permit` khi sửa action khác (vd. 1 endpoint admin sau
   này).
2. **Tránh "response drift"**: nếu chỉ chặn ở DB (`attr_readonly
   :identifier`) mà không chặn ở tầng attribute trong bộ nhớ, và có code nào
   đó lỡ gán `identifier` vào `update_params` (bug), Rails `attr_readonly`
   chỉ loại cột này khỏi câu `UPDATE` SQL — **giá trị trong bộ nhớ của object
   Ruby vẫn bị đổi**. Nếu controller serialize luôn object đó (không
   `reload`) để trả response, response sẽ hiện `identifier` mới (sai) dù DB
   vẫn giữ giá trị cũ — vi phạm ngay chính kịch bản
   "Không thể đổi identifier khi sửa Device dù cố gửi giá trị khác" (SoT
   §11) vì response phải phản ánh đúng giá trị thật `IPHONE-001`.

   → Vì vậy **không dùng `attr_readonly`** (dù đây là cách "kinh điển" của
   Rails cho immutable column) — dùng `before_validation` reset thay vào đó,
   tự sửa lại cả in-memory attribute lẫn ngăn ghi xuống DB, không có khoảng
   hở nào giữa 2 nơi:

   ```ruby
   before_validation :restore_immutable_identifier, on: :update

   private

   def restore_immutable_identifier
     self.identifier = identifier_was if identifier_changed?
   end
   ```

   Hành vi: nếu có bất kỳ đường nào (bug, script nội bộ, endpoint khác) gán
   `identifier` khác vào 1 record đã persisted rồi gọi `save`/`update`, giá
   trị bị **âm thầm reset về giá trị cũ trước khi validate/save chạy** — đúng
   tinh thần OQ-1 ("không báo lỗi, chỉ bỏ qua"), và object sau khi save luôn
   phản ánh đúng giá trị thật trong DB, không có response drift.

   Đây là lớp phòng thủ **thứ 2**, không thay thế strong params (`/design F3`
   API) — strong params vẫn là lớp chính (identifier không bao giờ xuất hiện
   trong `params` được `update` action dùng), callback này chỉ đảm bảo không
   có cách nào (kể cả bug tương lai) khiến `identifier` thực sự đổi.

### 1b. "Retired bất biến" — cơ chế model-layer

SoT §4 bước 3: *"BE tìm record ... → kiểm tra retired trước tiên: nếu
`status` hiện tại (trước khi áp thay đổi) là `retired` → chặn toàn bộ, trả
`422` ngay, **không chạy validate field nào khác**."* Chữ "không chạy validate
field nào khác" là điểm mấu chốt quyết định cơ chế: đây không phải "thêm 1
validation nữa vào error bag", mà phải **short-circuit** toàn bộ chuỗi
validate còn lại (presence, enum, uniqueness) khi record đang retired — nếu
không, response 422 có thể lẫn cả lỗi "name can't be blank" (nếu client gửi
name rỗng) lẫn lỗi retired-block trong cùng 1 lần gọi, sai với AC "chặn toàn
bộ ... không field nào bị đổi" (chỉ 1 loại lỗi, không map field nào).

**Quyết định**: dùng `before_validation` (không phải `validate`) kèm
`throw(:abort)` — Rails dừng ngay toàn bộ chuỗi callback/validate còn lại khi
1 `before_validation` throw `:abort`, `valid?`/`save` trả `false` ngay lập
tức mà không chạy tiếp các `validate` khác (presence/uniqueness/enum):

```ruby
before_validation :block_all_changes_when_retired, on: :update

RETIRED_IMMUTABLE_MESSAGE = "Thiết bị đã retired, không thể sửa".freeze

private

def block_all_changes_when_retired
  return unless status_was == "retired"

  errors.add(:base, RETIRED_IMMUTABLE_MESSAGE)
  throw(:abort)
end
```

Điểm quan trọng cần giữ đúng khi implement:

- **`status_was`, không phải `status`**: `status_was` phản ánh giá trị đã
  persisted trước khi cycle save hiện tại áp thay đổi lên nó — đúng nghĩa
  "status hiện tại (trước khi áp thay đổi)" SoT yêu cầu. Nhờ vậy:
  - A7 (sửa 1 device đang `active`, đổi status **sang** `retired`) → **không**
    bị chặn, vì `status_was == "active"` tại thời điểm check (chuyển VÀO
    retired vẫn hợp lệ).
  - A8 (sửa 1 device **đang** `retired`, dù đổi status hay bất kỳ field nào
    khác, kể cả không đổi gì / gửi lại y nguyên) → luôn bị chặn, vì
    `status_was == "retired"` bất kể payload gửi gì. Đây cũng chính là cách
    "không làm un-retire" được enforce triệt để: mọi cố gắng đổi `status` từ
    `retired` sang giá trị khác đều bị chặn ở đúng bước này, không cần thêm
    logic riêng cho "un-retire".
- **Chạy vô điều kiện kể cả no-op** (OQ-3): validation không so sánh field
  nào có thực sự đổi hay không — Rails luôn chạy `valid?` mỗi khi
  `save`/`update` được gọi trên 1 record (kể cả khi record không có thay đổi
  nào, `changed?` false), nên callback này chắc chắn chạy dù request là
  no-op. Không cần code diff thủ công (đúng khuyến nghị OQ-3: tránh so sánh
  field cũ/mới).
- **Lỗi gắn vào `:base`, không field cụ thể** (OQ-4): dùng
  `errors.add(:base, ...)` vì đây không phải lỗi của 1 input — cả request bị
  từ chối. `errors[:base]` là quy ước chuẩn của ActiveModel cho lỗi không
  thuộc field nào; việc API-layer serialize `errors[:base]` thành envelope gì
  cụ thể (`{"errors": {"base": [...]}}` tái dùng đúng shape field-level hiện
  có, hay đổi hẳn qua `{"error": "..."}` riêng) là quyết định của `/design
  F3` API (SoT OQ-4 để ngỏ) — file này chỉ đảm bảo model expose đúng 1 chỗ
  duy nhất (`errors[:base]`) để API-layer đọc, không cần đoán field.
- **Message tái dùng nguyên văn** tooltip đã có ở `UI_UX_design.md` §4 dòng
  128 ("Thiết bị đã retired, không thể sửa") — nhất quán giữa lỗi disable ở
  UI và lỗi 422 ở API (đúng khuyến nghị OQ-4).
- **Thứ tự 2 callback**: `block_all_changes_when_retired` nên khai báo
  **trước** `restore_immutable_identifier` (dù cả 2 đều `before_validation,
  on: :update`) — không bắt buộc về mặt kết quả (cả 2 đều dẫn tới không ghi
  DB khi retired), nhưng khai báo theo đúng thứ tự nghiệp vụ SoT mô tả
  ("kiểm tra retired trước tiên") giúp code dễ đọc/maintain hơn.

## 2. Migration plan

**Không có migration nào ở F3.** Xác nhận lại theo đúng SoT §3/§8: bảng
`devices`, mọi cột, mọi index (kể cả unique index `(organization_id,
identifier)` dùng cho cả validate thường lẫn race-condition A12) đã đủ từ
F2, không cần thêm/đổi gì ở schema. Toàn bộ thay đổi ở tài liệu này là Ruby
code trong `api/app/models/device.rb` (validation message, 2 callback mới).

Không có bước nào cần cân nhắc "backfill dữ liệu cũ" hay "phá dữ liệu cũ" vì
không đụng migration.

## 3. Index / hiệu năng

Không thêm/đổi index nào. Xác nhận lại 2 điểm liên quan trực tiếp tới F3 từ
index đã có ở F2 (`docs/design/F2-db.md` §3):

| Index có sẵn (F2) | Vai trò với F3 |
|---|---|
| `devices(organization_id, identifier)` UNIQUE | (a) Backing cho validate uniqueness scope `organization_id` khi tạo mới (§6 SoT); (b) Backing cho race-condition A12 — 2 request tạo trùng identifier gần như đồng thời, request thua chạm unique index này ở tầng DB, raise `ActiveRecord::RecordNotUnique`, không phải lỗi validate app-level (do đã "thua" race trước khi query `EXISTS` app-level kịp thấy). |

**A12 — rescue `RecordNotUnique` thành `422` (không phải `500`)**: SoT §10
đã chốt "chỉ cần rescue exception vi phạm unique index thành `422` cùng
message với validate thường". Đây thuần là quyết định **controller-layer**
(rescue ở đâu, `rescue_from` toàn cục hay `begin/rescue` cục bộ trong action
`create`) — thuộc `/design F3` API, không phải file DB design này. Nhưng có
1 điểm DB-layer cần đảm bảo để controller-layer làm đúng, dễ dàng: **message
dùng khi rescue `RecordNotUnique` phải giống hệt message của validate
uniqueness thường** (`"Identifier này đã tồn tại trong tổ chức của bạn."` —
xem §1) để FE không phân biệt được 2 nhánh (đúng yêu cầu "giống hệt A1" của
SoT A12) — không cần model đổi gì thêm để hỗ trợ việc này, chỉ cần API-layer
tái dùng đúng string hằng số (đề xuất: expose qua
`Device::IDENTIFIER_TAKEN_MESSAGE` constant thay vì lặp lại string ở 2 chỗ —
implementer cân nhắc lúc code, không bắt buộc thiết kế lại validate).

Không có rủi ro N+1/hiệu năng mới — F3 là ghi 1 record đơn lẻ (SoT §10),
không liên quan kịch bản Group 10k device.

## 4. Rủi ro / open question

- **`ArgumentError` khi gán enum string lạ vào `platform`/`status` lúc
  create/update (SoT A4/A5)** — hành vi này **đã tồn tại từ F2**
  (`docs/design/F2-db.md` §1b: cột `integer` + Rails native enum, gán string
  ngoài enum raise `ArgumentError`, không tự thành lỗi validate 422).
  F2 chỉ có action `index` (filter, không mass-assign), nên F2 chỉ cần guard
  ở bước filter (`invalid_enum?` trong `DevicesController`, xem code hiện
  tại). **F3 là lần đầu tiên hệ thống gọi `Device.new(...)`/`Device#update`
  với `platform`/`status` từ client body** → nếu controller gọi thẳng
  `Device.new(device_params)` mà không validate raw string trước, giá trị lạ
  (`platform: "windows"`) sẽ raise `ArgumentError` **trước khi** validation
  chạy, thoát ra ngoài thành `500`, sai với AC "422 field-level, không phải
  lỗi hạ tầng". → Đây **không phải quyết định của file DB design này**
  (không đổi cột/kiểu enum), nhưng cần `/design F3` API áp dụng **đúng
  pattern đã có ở F2** (`invalid_enum?` kiểm tra raw string nằm trong
  `Device.platforms.keys`/`Device.statuses.keys` **trước khi** gọi
  `Device.new`/`update`, trả `422` field-level ngay nếu không hợp lệ) —
  nêu rõ ở đây để `/design F3` API không bị bất ngờ, giống cách F2-db.md đã
  làm với chính vấn đề này.
- **`status` bị ép `active` khi tạo (OQ-2)**: xác nhận đây thuần là quyết
  định strong params ở `/design F3` API (action `create` không `permit
  :status`) — cột `status` đã có `default: 0` (active) từ F2, không cần đổi
  gì ở model/migration để hỗ trợ việc này. Không thêm callback
  `before_validation :force_active_status_on_create` vì SoT OQ-2 đã chốt rõ
  strong params là đủ (không unnecessarily thêm 1 lớp code trùng lặp cho 1
  path đã kín).
- **`attr_readonly :identifier` bị cân nhắc và loại bỏ** — xem lý do chi
  tiết ở §1a ("response drift"). Ghi lại ở đây để người review sau không đề
  xuất lại phương án này mà không biết đã bị loại có chủ đích.
- **FactoryBot (`api/spec/factories/devices.rb`) — không cần đổi gì mới**:
  trait `:retired` đã có sẵn từ F2, đủ dùng cho mọi spec F3 cần 1 device
  retired (test `block_all_changes_when_retired`). Không cần thêm trait mới
  (vd trait riêng cho "device sắp update" — factory hiện tại đã đủ tổng
  quát, chỉ cần `create(:device, :retired)` rồi `.update(...)` trong spec).
- **`DevicePolicy#create?`/`#update?` không thuộc file này** — SoT §8/§9 đã
  nói rõ đây là quyết định `/design F3` API (luôn `true` cho user active,
  business rule retired nằm ở model như §1b, không phải Pundit) — nêu lại ở
  đây chỉ để xác nhận DB design không cần thêm gì cho Pundit.
- **Message của `name`/`platform`/`status` presence & inclusion validation
  không được Việt-hoá** — SoT/`UI_UX_design.md` §10 chỉ đưa ví dụ Việt-hoá
  cho lỗi unique `identifier`; các message khác giữ mặc định Rails (tiếng
  Anh), nhất quán với cách F2 đã làm (`"must be a positive integer"`, `"is
  not included in the list"` ở `DevicesController` cũng là tiếng Anh). Nếu
  người duyệt muốn Việt-hoá toàn bộ message validate, đây là quyết định cần
  nêu rõ (ảnh hưởng cả F2 lẫn F3, không chỉ riêng field này) — flag lại ở
  đây như 1 open question thật sự (không phải giả định có thể tự chọn):
  **OQ-DB1**: có cần Việt-hoá toàn bộ error message (`name`, `platform`,
  `status`) hay chỉ riêng `identifier` như hiện tại? Khuyến nghị: giữ nguyên
  hiện trạng (chỉ Việt-hoá `identifier` theo đúng ví dụ SoT nêu), vì đây là
  quyết định UI-copy rộng hơn phạm vi 1 feature, nên làm đồng loạt ở 1 quyết
  định riêng nếu cần (giống cách F2-db.md từng hoãn quyết định check
  constraint đồng loạt cho `User.status`/`Device.platform/status`).
</content>
