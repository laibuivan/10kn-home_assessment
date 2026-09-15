---
feature_id: F2
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

# Thiết kế Database — F2

Nguồn: `docs/sot/F2-device-list.md` (approved), `PRD.md` §"Device", `CLAUDE.md`
§4, `api/db/schema.rb` hiện có (chỉ có `organizations`, `users` từ F0 —
`Device` **chưa tồn tại**, đây là migration đầu tiên tạo model này).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `Device` (mới) | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false` (mọi Device phải thuộc 1 org — không có "Device mồ côi") | Add |
| `Device` | `identifier` | `string` | `null: false`; **unique theo `organization_id`** (composite, xem §1a) — `CLAUDE.md` §4 | Add |
| `Device` | `name` | `string` | `null: false` (hiển thị bắt buộc ở cột "Name" của bảng list, SoT §7) | Add |
| `Device` | `platform` | `integer` | `null: false`; Rails native enum `enum platform: { ios: 0, android: 1, macos: 2 }` (xem §1b) | Add |
| `Device` | `os_version` | `string` | `null: true` (xem OQ-D1 — device mới có thể chưa từng report OS version) | Add |
| `Device` | `status` | `integer` | `null: false`, `default: 0`; Rails native enum `enum status: { active: 0, inactive: 1, retired: 2 }` (xem §1b) | Add |
| `Device` | `last_seen_at` | `datetime` | `null: true` (xem OQ-D1 — device mới tạo có thể chưa từng check-in) | Add |
| `Device` | `created_at` / `updated_at` | `datetime` | `null: false` (Rails timestamps mặc định) — `created_at` dùng làm sort key chính (OQ-2 SoT) | Add |
| `Organization` | `has_many :devices` | — | Chưa quyết định `dependent:` — PRD không có màn hình xóa Organization nên đường xóa này hiện không tồn tại; xem Rủi ro §4 | Add (association only, không cần `dependent:` ngay) |

Model-level validation đi kèm migration (để `slice-implementer` code lại đúng,
không đoán): `validates :identifier, presence: true, uniqueness: { scope:
:organization_id }`; `validates :name, presence: true`; `validates :platform,
:status, presence: true` (tự động qua enum khi cần).

### 1a. Composite unique index — `identifier` unique trong Organization

Giống pattern đã dùng cho `User.email` ở F0 (`docs/design/F0-db.md` §1a):

```ruby
add_index :devices, [:organization_id, :identifier], unique: true
```

**Không** thêm `add_index :devices, :identifier, unique: true` (đơn, toàn
cục) — sẽ vô tình cấm 2 Organization khác nhau cùng dùng 1 `identifier`, trái
`CLAUDE.md` §4 ("Unique trong Organization, không unique toàn hệ thống").

### 1b. Enum implementation — Rails native enum (integer), không thêm check constraint

Chọn **Rails native enum trên cột `integer`** cho cả `platform` và `status`,
nhất quán với `User.status` đã làm ở F0 (`docs/design/F0-db.md`). Lý do:
- Nhất quán codebase (F0 đã thiết lập precedent này cho `User.status`), tránh
  2 cách làm enum khác nhau trong cùng project.
- Rails enum tự sinh scope (`Device.ios`, `Device.retired`...) và method dự
  đoán (`device.retired?`) — hữu ích cho F3/F4/F9 (policy resolution, retired
  immutability check) mà không cần thêm code.
- **Không** thêm DB check constraint song song cho 2 cột này (dù về mặt lý
  thuyết an toàn hơn nếu có ai ghi thẳng SQL bỏ qua Rails) — giữ nhất quán với
  cách F0 đã chấp nhận trade-off này cho `User.status`, tránh áp 2 tiêu chuẩn
  khác nhau cho 2 model tenant-scoped tương tự nhau mà không có lý do nghiệp
  vụ khác biệt. Nếu muốn siết chặt hơn ở tầng DB, nên làm đồng loạt cho cả
  `User.status` lẫn `Device.platform/status` trong 1 quyết định riêng, không
  lặt vặt từng feature.
- **Hệ quả cần API layer xử lý** (ghi chú lại đây vì phát sinh từ lựa chọn
  cột `integer` + enum, dù quyết định thuộc `/design F2` API): gán giá trị
  string không có trong enum map (`Device.new(platform: "windows")`) khiến
  Rails raise `ArgumentError`, không tự thành lỗi validation 422. Endpoint
  `GET /api/v1/devices` filter theo query param (không phải gán tất cả) nên
  cách làm còn phụ thuộc controller (`params.require... .in?(Device.platforms.keys)`
  trước khi query, hoặc rescue `ArgumentError` → 422) — quyết định implementation
  cụ thể để `/design F2` API, ở đây chỉ cảnh báo trước để API design không bị
  bất ngờ.

## 2. Migration plan

Một migration duy nhất (bảng mới hoàn toàn, không có dữ liệu cũ cần giữ):

1. `CreateDevices`:
   ```ruby
   create_table :devices do |t|
     t.references :organization, null: false, foreign_key: true, index: false
     t.string   :identifier, null: false
     t.string   :name,       null: false
     t.integer  :platform,   null: false
     t.string   :os_version
     t.integer  :status,     null: false, default: 0
     t.datetime :last_seen_at
     t.timestamps
   end

   add_index :devices, [:organization_id, :identifier], unique: true
   add_index :devices, [:organization_id, :created_at, :id]
   add_index :devices, [:organization_id, :platform]
   add_index :devices, [:organization_id, :status]
   ```
   Lưu ý `index: false` trên `t.references :organization` — cố ý bỏ index
   đơn `organization_id` mặc định của Rails vì index composite
   `(organization_id, identifier)` unique ở trên đã phủ được mọi truy vấn chỉ
   lọc theo `organization_id` (leftmost-prefix của B-tree) — tránh 1 index dư
   thừa không cần thiết. Xem thêm §3.

- **Backfill**: không cần — bảng mới tạo, chưa có dữ liệu cũ.
- **Phá dữ liệu cũ**: không — không có migration nào sửa/xóa bảng đang tồn
  tại (`organizations`, `users` không đổi).
- **Reversible**: có — toàn bộ dùng `create_table`/`add_index` trong block
  `change`, Rails tự sinh `down` (drop bảng + index kèm theo).
- **Seed**: SoT §3 yêu cầu seed đủ device rải rác nhiều platform/status để
  demo phân trang/filter có ý nghĩa — việc này thuộc `db/seeds.rb`, thực hiện
  ở stage Implement, không phải file thiết kế này.

## 3. Index / hiệu năng

F2 chưa phải kịch bản "Group 10.000 device" (đó là F6/F8 — join table
`group_memberships`/`policy_assignments` sẽ có index riêng khi thiết kế tới
lượt), nhưng nguyên tắc "list không quét toàn bảng khi dữ liệu tăng"
(`PRD.md` §"Chất lượng kỹ thuật", SoT §10) vẫn bắt buộc áp dụng ngay từ F2:

| Index | Phục vụ truy vấn | Ghi chú |
|---|---|---|
| `devices(organization_id, identifier)` UNIQUE | Ràng buộc unique-trong-org (§1a) + mọi lookup chỉ theo `organization_id` (leftmost prefix) | Thay thế index đơn `organization_id` mặc định — xem §2 |
| `devices(organization_id, created_at, id)` | Query mặc định **không filter**: `current_organization.devices.order(created_at: :desc, id: :desc)` — đúng sort key đã chốt OQ-2 | Đây là trường hợp phổ biến nhất (mở `/devices` lần đầu, chưa áp filter) — index scan theo đúng thứ tự `ORDER BY`, không cần sort riêng, không quét toàn bảng để `LIMIT/OFFSET` phân trang |
| `devices(organization_id, platform)` | Filter theo `platform` (A3, A4) | Kết hợp với index status bên dưới qua bitmap AND của Postgres khi filter cả 2 cùng lúc |
| `devices(organization_id, status)` | Filter theo `status` (A3, A4) | — |

**Vì sao không gộp 1 index "covering" duy nhất** (vd
`(organization_id, platform, status, created_at, id)`): ở quy mô 1
Organization (chưa tới hàng chục nghìn Device như kịch bản Group F6/F8),
Postgres bitmap-AND giữa 2 index filter riêng + 1 bước sort bổ sung sau khi
đã lọc là đủ rẻ, trong khi 1 mega-index vừa tốn ghi (insert/update phải cập
nhật index lớn hơn) vừa chỉ tối ưu đúng 1 tổ hợp filter cụ thể. Nếu sau này đo
đạc thực tế cho thấy filter kết hợp chậm ở quy mô lớn hơn dự kiến, revisit lúc
đó (YAGNI — không tối ưu sớm dựa trên phỏng đoán).

**N+1**: F2 không có rủi ro N+1 — mọi cột hiển thị ở bảng list
(`identifier`, `name`, `platform`, `os_version`, `status`, `last_seen_at`)
đều nằm ngay trên bảng `devices`, không cần `includes`/`preload` bảng nào
khác (không join `Group`/`Policy` ở F2 — xem SoT §3 "Ngoài phạm vi", OQ-4).

## 4. Rủi ro / open question

- **OQ-D1 (giả định, cần xác nhận)**: `os_version` và `last_seen_at` để
  `null: true`. SoT §8 liệt kê 2 field này nhưng không nói rõ bắt buộc hay
  không. Giả định: một Device mới được tạo (F3) có thể chưa từng "check-in"
  nên chưa có `last_seen_at`/`os_version` thực. Nếu người duyệt muốn 2 field
  này bắt buộc ngay từ lúc tạo (`null: false` + giá trị mặc định do FE nhập),
  cần nêu rõ ở đây trước khi implement — ảnh hưởng migration lẫn form validate
  F3.
- **Retired immutability không được enforce ở tầng DB tại F2**: F2 chỉ là
  read-only list nên migration này không thêm trigger/constraint nào chặn sửa
  Device `retired`. Đây là nhắc nhở cho F3/F4 (`CLAUDE.md` §4): việc chặn sửa
  field/đổi group/policy khi `status == "retired"` phải làm ở **service
  layer** khi implement update action, không phải việc của schema F2. Không
  thêm cột/flag nào ở đây gây khó cho việc đó sau này.
- **Enum string không hợp lệ → 422 (OQ-5 SoT)**: như đã ghi ở §1b, cách xử lý
  cụ thể (validate trước khi query vs. rescue `ArgumentError`) là quyết định
  của `/design F2` API, không phải DB — nêu ở đây để bước API không bị bất
  ngờ bởi lựa chọn cột `integer` enum.
- **`Organization has_many :devices` chưa có `dependent:`**: PRD không có màn
  hình xóa Organization (`docs/backlog.md` "Ngoài phạm vi") nên hiện không có
  đường nào gọi `Organization#destroy`. Không quyết định `dependent:` ngay vì
  chưa có nhu cầu thật; nếu tương lai có tính năng xóa Organization, phải
  quay lại quyết định điểm này (khả năng: `dependent: :restrict_with_error`
  giống `User`, theo đúng pattern F0 đã chọn).
- **Chuẩn bị cho F6/F8**: `group_memberships` và `policy_assignments` (chưa
  thiết kế ở đây, ngoài scope F2) sẽ FK tới `devices(id)`. Khóa chính mặc
  định của Rails (`bigint id`) là đủ, không cần thay đổi gì ở migration F2 để
  chuẩn bị việc đó.
</content>
