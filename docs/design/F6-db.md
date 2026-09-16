---
feature_id: F6
status: approved   # draft | approved
approver: Lai Bui <lai.bui.vtp@gmail.com>
date: 2026-09-16
---

# Thiết kế Database — F6

Nguồn: `docs/sot/F6-group-membership.md` (approved, cả 8 OQ đã chốt),
`PRD.md` §"Nghiệp vụ" → "Group"/"Device" + dòng 58 ("Group có thể rất lớn cỡ
10.000 devices") + dòng 81 ("phân trang list, không render 10.000 dòng"),
`CLAUDE.md` §4, `api/db/schema.rb` hiện có (`organizations`, `users` từ F0;
`devices` từ F2/F3; `groups` từ F5 — xem `docs/design/F5-db.md`),
`docs/backlog.md` (F6 sở hữu `group_memberships`; F8 sở hữu
`policy_assignments` — vẫn **chưa tồn tại**, không đụng ở F6).

**Kết luận đầu tiên (khớp SoT §3, §8):** F6 cần **đúng 1 migration** tạo bảng
mới `group_memberships` — join table thuần `group_id`/`device_id`, không có
cột `source`/`status` (khác `policy_assignments` mà F8 sẽ làm). Không sửa cột
nào của `organizations`/`users`/`devices`/`groups`. Đây cũng là lúc trả nghĩa
vụ carry-over mà F5 đã ghi nợ ở `docs/design/F5-db.md` §4a: thêm
`has_many :group_memberships, dependent: :delete_all` vào `Group`.

Theo SoT §12 OQ-5 (đã chốt): **không** thêm cột `devices_count` (counter
cache) vào bảng `groups` — `devices_count` hiển thị ở Group List/Group Detail
tính bằng `COUNT`/`LEFT JOIN` trực tiếp trên `group_memberships` mỗi lần đọc,
không duy trì cột đếm sẵn (lý do: `upsert_all` bỏ qua AR callback nên counter
cache dễ lệch nếu không tự tay cập nhật — SoT đã cân nhắc và loại phương án
này).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `GroupMembership` (mới) | `belongs_to :group` | FK `group_id`, `bigint` | `null: false` + `foreign_key: true`, **không** `on_delete: :cascade` ở DB (dọn dẹp phải tường minh qua `dependent: :delete_all` ở Rails, không ngầm ở DB — đúng pattern F5 §2 đã chốt cho `groups.organization_id`) | Add |
| `GroupMembership` | `belongs_to :device` | FK `device_id`, `bigint` | `null: false` + `foreign_key: true`, cũng **không** `on_delete: :cascade` (PRD không có luồng xóa Device — SoT §3 xác nhận `Device` chưa cần `dependent:`, nhưng FK vẫn phải khai báo tường minh để không có cascade ngầm nào phát sinh nếu sau này có luồng xóa Device) | Add |
| `GroupMembership` | `created_at` / `updated_at` | `datetime` | `null: false` (Rails timestamps mặc định). Không có ý nghĩa sort-key nghiệp vụ ở F6 (danh sách thành viên sort theo cột của `devices`, không sort theo thời điểm thêm vào group — SoT §4A không yêu cầu) | Add |
| `GroupMembership` | validate `uniqueness of :device_id scoped to :group_id` | model validation | Lớp 1 của bảo vệ 2 lớp (SoT §6 "2 lớp giống mọi unique khác trong dự án") — chặn `create`/`save` tuần tự thường; **không** phải cơ chế chính chặn race condition khi bulk-add (đó là việc của `upsert_all` + unique index DB, xem §3) | Add |
| `GroupMembership` | `source`/`status` | — | **Không thêm** — SoT §3 xác nhận rõ bảng này "chỉ diễn tả Device X đang là thành viên Group Y", khác `policy_assignments` (F8) sẽ có `source: group/direct` | Không làm (khác F8) |
| `Group` | `has_many :group_memberships, dependent: :delete_all` | — | **Trả nghĩa vụ carry-over từ F5** (`docs/design/F5-db.md` §4a) — bây giờ bảng đã tồn tại. `:delete_all` (không phải `:destroy`) — join row không có callback nghiệp vụ, 10k dòng/group thì `:delete_all` là 1 câu `DELETE` SQL thay vì instantiate 10.000 Ruby object | Add |
| `Group` | `has_many :devices, through: :group_memberships` | — | Cho phép `group.devices` (dùng ở `GET /api/v1/groups/:id/devices`) | Add |
| `Device` | `has_many :group_memberships` | — | Chưa cần `dependent:` — PRD không có luồng xóa Device (SoT §3 xác nhận, giống cách F4/F5 để ngỏ `has_many :groups` phía Device chưa có `dependent:` vì chưa có action xóa Device nào tồn tại) | Add |
| `Device` | `has_many :groups, through: :group_memberships` | — | Cho phép `device.groups` (dùng ở field `groups: [{id, name}]` của `GET /api/v1/devices/:id` — SoT §12 OQ-6) | Add |
| `Group` | `devices_count` (cột) | — | **Không thêm** — SoT §12 OQ-5 đã chốt `COUNT` trực tiếp, không counter cache | Không làm (chốt SoT) |
| `groups` (bảng) | mọi cột/index hiện có | — | Không đổi | No-change |
| `devices` (bảng) | mọi cột/index hiện có | — | Không đổi — bao gồm cả `status` enum (`retired` bất biến enforce ở model `Device`/service layer khi thêm/gỡ membership, không phải ở DB layer của bảng `group_memberships`, xem §4) | No-change |

Model mới, viết ra để `slice-implementer` không phải đoán:

```ruby
class GroupMembership < ApplicationRecord
  belongs_to :group
  belongs_to :device

  validates :device_id, uniqueness: { scope: :group_id }
end
```

Sửa 2 model hiện có (chỉ thêm dòng association, không đổi gì khác):

```ruby
# app/models/group.rb
class Group < ApplicationRecord
  belongs_to :organization
  has_many :group_memberships, dependent: :delete_all
  has_many :devices, through: :group_memberships
  # ... phần còn lại giữ nguyên (F5)
end
```

```ruby
# app/models/device.rb
class Device < ApplicationRecord
  belongs_to :organization
  has_many :group_memberships
  has_many :groups, through: :group_memberships
  # ... phần còn lại giữ nguyên (F2/F3)
end
```

### 1a. Vì sao không cần validate `belongs_to`-presence riêng cho `group`/`device`

Rails 8 mặc định `belongs_to` là `required: true` (raise validation error nếu
thiếu), nên `null: false` ở cột + FK là đủ 2 lớp bảo vệ tiêu chuẩn của dự án
(app-level qua `belongs_to` mặc định, DB-level qua `NOT NULL` + FK constraint)
— không cần viết thêm `validates :group, :device, presence: true` tường minh
(trùng lặp với default, không có tác dụng thêm).

### 1b. Vì sao *không* validate org-khớp-nhau ở model `GroupMembership`

`GroupMembership` không tự validate "group.organization_id ==
device.organization_id" — lý do: theo SoT §6/§9, việc lọc Device khác org
xảy ra **trước khi** một dòng `GroupMembership` được tạo, ở tầng service/
controller (`current_organization.devices.where(id: device_ids)` — id không
khớp bị lọc âm thầm, không bao giờ tới được `upsert_all`). Thêm 1 validate
app-level ở model cho điều này sẽ **không bao giờ chạy tới** vì `upsert_all`
(SoT §6 "Idempotent bulk-write") **bỏ qua toàn bộ validation callback** —
validate ở model chỉ có tác dụng cho code path dùng `save`/`create` thông
thường, không bảo vệ được path chính (`upsert_all`) của F6. Ràng buộc org-khớp
thật sự nằm ở **service layer** (lọc `device_ids` trước khi gọi `upsert_all`,
chốt ở `/design F6-api.md`), không phải ở model/DB layer — ghi rõ ở đây để
tránh ai đó thêm 1 validate model "cho chắc" rồi tưởng lầm nó có tác dụng bảo
vệ đường `upsert_all`.

## 2. Migration plan

Đúng **một** migration (bảng mới hoàn toàn, không có dữ liệu cũ cần giữ, nối
tiếp `20260916090000_create_groups.rb`):

1. `CreateGroupMemberships` (dự kiến
   `api/db/migrate/20260916150000_create_group_memberships.rb` — timestamp
   sau migration `create_groups` gần nhất, con số cụ thể chốt lúc chạy
   `rails g migration`):

   ```ruby
   class CreateGroupMemberships < ActiveRecord::Migration[8.1]
     def change
       create_table :group_memberships do |t|
         t.references :group, null: false, foreign_key: true, index: false
         t.references :device, null: false, foreign_key: true, index: false
         t.timestamps
       end

       add_index :group_memberships, [:group_id, :device_id], unique: true
       add_index :group_memberships, :device_id
     end
   end
   ```

   - `index: false` trên cả hai `t.references`: index đơn mặc định của Rails
     cho `group_id` bị thay bằng unique composite `[group_id, device_id]`
     (đã có `group_id` ở vị trí trái nhất, phủ đủ mọi truy vấn `WHERE
     group_id = ?` qua leftmost-prefix — kể cả `DELETE ... WHERE group_id = ?`
     do `dependent: :delete_all` sinh ra, xem §3); index đơn mặc định cho
     `device_id` bị thay bằng `add_index :group_memberships, :device_id`
     tường minh ngay dòng dưới — SoT §3/§8 yêu cầu rõ "index riêng trên
     `device_id`" nên viết tường minh thay vì dựa vào default để không ai
     nhầm là thiếu.
   - `foreign_key: true` cho cả hai reference **không kèm** `on_delete:` —
     tức `NO ACTION`, không cascade ngầm ở DB. Đúng tinh thần đã chốt ở
     `docs/design/F5-db.md` §2 cho `groups.organization_id`: dọn dẹp
     `group_memberships` khi xóa `Group` phải do Rails làm **tường minh**
     (`dependent: :delete_all`), không phải DB tự cascade — nếu FK có
     `on_delete: :cascade`, xóa `Group` vẫn xóa sạch `group_memberships`
     đúng như mong muốn *về mặt kết quả*, nhưng sẽ **vi phạm tinh thần**
     "không dựa vào FK cascade ngầm không khai báo" mà `CLAUDE.md` §4 nói rõ
     — và quan trọng hơn, cascade ngầm ở DB sẽ không đi qua bất kỳ
     transaction/callback nào mà Rails-side test có thể assert được một cách
     tường minh.

- **Backfill**: không cần — bảng mới tạo, chưa có dữ liệu cũ.
- **Phá dữ liệu cũ**: không — migration chỉ `create_table` + `add_index` trên
  một bảng chưa tồn tại; `organizations`/`users`/`devices`/`groups` không bị
  đụng một dòng nào.
- **Reversible**: có — toàn bộ nằm trong `change` với `create_table`/
  `add_index`, Rails tự sinh `down` (drop bảng, index đi kèm bị drop theo).
  Không có `execute`/SQL thô nào cần viết `up`/`down` thủ công.
- **Thứ tự phụ thuộc**: `groups` (F5) và `devices` (F2/F3) đã tồn tại nên cả
  hai FK tạo được ngay trong 1 migration, không cần tách nhiều bước.
- **Seed** (`api/db/seeds.rb`): SoT §10 nhắc riêng "seed data cho việc kiểm
  thử/demo quy mô 10.000 Device trong 1 Group... nên được chuẩn bị ở bước
  `/plan`/implementation" — không phải quyết định của file thiết kế DB này,
  chỉ ghi lại để không quên khi viết `README.md` walkthrough/test hiệu năng.
  `api/spec/factories/group_memberships.rb` (factory mới) cũng thuộc stage
  Implement.

## 3. Index / hiệu năng

Đây là **invariant trung tâm của F6** (SoT §10: "chịu 10.000 device,
idempotent") — mọi index dưới đây được chọn trực tiếp để phục vụ 3 thao tác ở
quy mô 1 Group ~10.000 `group_memberships`:

| Index | Phục vụ truy vấn | Ghi chú |
|---|---|---|
| `group_memberships(group_id, device_id)` UNIQUE | (a) Backing cho `upsert_all` idempotent (`POST .../devices` — SoT §6 "Idempotent bulk-write", A6/A7/A15); (b) chặn race condition thêm đồng thời ở tầng DB (A15 — 2 request thêm cùng cặp gần như đồng thời không tạo 2 dòng); (c) backing cho `validates uniqueness` (lớp 1, §1); (d) `group_id` ở vị trí trái nhất nên **cũng** phủ mọi truy vấn chỉ lọc `WHERE group_id = ?` (leftmost-prefix) — bao gồm cả `DELETE FROM group_memberships WHERE group_id = ?` do `dependent: :delete_all` sinh ra khi xóa Group (A20) | Thay thế index đơn `group_id` mặc định của Rails — đúng pattern đã dùng ở `devices`/`groups` (F2/F5): không tạo 2 index trùng lặp mục đích |
| `group_memberships(device_id)` | (a) Truy vấn ngược "group nào chứa Device X" — `device.groups`/`device.group_memberships` dùng ở field `groups: [{id, name}]` của `GET /api/v1/devices/:id` (SoT §12 OQ-6, A25); (b) `DELETE /api/v1/groups/:id/devices/:device_id` lọc theo cặp `(group_id, device_id)` — index composite ở trên đã đủ cho `find_by(group_id:, device_id:)`, nhưng lookup **chỉ** theo `device_id` (không kèm `group_id`) cần index riêng vì `device_id` không ở vị trí trái nhất của index composite | Yêu cầu tường minh của SoT §3/§8 ("index trên `device_id` riêng") |
| `group_memberships(id)` PK (mặc định) | Không có lookup nghiệp vụ nào theo PK riêng lẻ ở F6 (không có `GET /api/v1/group_memberships/:id`) | Không cần gì thêm |

**`GET /api/v1/groups/:id/devices` (tab Thành viên, phân trang server-side,
A17):**
- Query dạng `group.devices.where(...).order(...).limit(...).offset(...)` —
  join `group_memberships` → `devices`, filter `platform`/`status` dùng
  index có sẵn trên `devices(organization_id, platform)`/
  `devices(organization_id, status)` (F2), còn điều kiện `group_id` dùng
  index composite `[group_id, device_id]` ở trên qua leftmost-prefix.
- `meta.total_count`: `COUNT` trên relation đã group-scope + filter, **trước**
  `limit/offset` (SoT §10 "không load hết rồi `.size`") — không quét 10.000
  dòng vào Ruby chỉ để đếm.
- Sort key: SoT không chỉ định thứ tự cụ thể cho tab Thành viên (khác Group
  List/Device List đã có `created_at, id`); baseline hợp lý —
  `devices(organization_id, created_at, id)` đã có sẵn từ F2, group-scope
  chỉ thêm `WHERE group_memberships.group_id = ?` — không cần index mới cho
  sort, join qua `group_id` đã được index composite phủ. Nếu người duyệt
  muốn sort khác (vd theo thời điểm thêm vào group,
  `group_memberships.created_at`), ghi vào §4 (open question).

**`POST /api/v1/groups/:id/devices` (thêm hàng loạt, A15, A17):**
- **1 câu lệnh** `GroupMembership.upsert_all(rows, unique_by: [:group_id,
  :device_id])` thay vì N lệnh `INSERT`/validate tuần tự trong vòng lặp Ruby
  — đúng SoT §6/§10. `unique_by` trỏ đúng tên unique index ở trên.
- `rows` được build **sau khi** đã lọc `device_ids` qua
  `current_organization.devices.where(id: device_ids).pluck(:id)` (org-scope,
  A10) và cap số lượng ở ngưỡng 500 (SoT §12 OQ-2) — không phải việc của
  migration/model, chốt chi tiết ở `/design F6-api.md`, nêu lại ở đây vì nó
  quyết định kích thước `rows` tối đa mỗi `upsert_all` (≤ 500 dòng/lần, nhỏ,
  an toàn về thời gian transaction).
- `upsert_all` **bỏ qua** validation & callback Rails (kể cả
  `before_validation`/`validates uniqueness` của `GroupMembership`) — đây là
  lý do unique index ở tầng DB là **bắt buộc**, không phải tùy chọn: nó là
  lớp bảo vệ **duy nhất** thực sự chạy trên code path chính này (SoT §6 "2
  lớp" — lớp model chỉ bảo vệ path `save`/`create` tuần tự, hiếm khi được
  dùng ở F6 vì action chính luôn là bulk).

**`DELETE` Group (kế thừa hợp đồng carry-over từ F5, giờ có bảng thật, A20,
A21):**
- `group.destroy` (không phải `group.delete`) → `dependent: :delete_all` sinh
  `DELETE FROM group_memberships WHERE group_id = ?` — **1 câu lệnh**, dùng
  index composite `[group_id, device_id]` qua leftmost-prefix để không
  seq-scan toàn bảng dù có 10.000 dòng. Rails bọc toàn bộ (xóa
  `group_memberships` + xóa `groups` record) trong **1 transaction** tự động
  — không cần `ActiveRecord::Base.transaction` thủ công (đúng phân tích đã
  chốt ở `docs/design/F5-db.md` §4a).
- SoT §10 đã kết luận: chấp nhận chạy **đồng bộ trong request** kể cả ở 10k
  dòng (1 `DELETE` statement là đủ nhanh, không cần chuyển sang xóa bất đồng
  bộ) — nêu lại để `/design F6-api.md` và `/plan` không tự ý đổi sang async
  job cho thao tác này.
- **Bẫy phải tránh** (nhắc lại từ F5-db.md §4a, áp dụng y hệt ở F6): API
  layer bắt buộc gọi `destroy`/`destroy!`, **không bao giờ** `delete` — nếu
  không, `dependent: :delete_all` bị bỏ qua hoàn toàn, để lại
  `group_memberships` mồ côi và vi phạm FK khi có ràng buộc khác trỏ tới.

**`q` trên `GET /api/v1/devices` (search phục vụ modal, SoT §12 OQ-7):**
- Không thuộc bảng `group_memberships` — không cần index mới ở migration
  này. Kế thừa nguyên phân tích đã có ở `docs/design/F5-db.md` §3 cho search
  Group: `ILIKE` trên `identifier`/`name`, chấp nhận sequential scan trong
  phạm vi 1 org (đã có `organization_id` đứng đầu index hiện có của
  `devices` để thu hẹp trước), không thêm trigram index sớm khi chưa có số
  liệu (SoT §10).

**N+1 cần tránh ở `/design F6-api.md` (ghi lại ở đây vì gắn trực tiếp với
index/relation vừa thêm):**
- `GET /api/v1/devices/:id` trả `groups: [{id, name}]` (OQ-6) — dùng
  `device.groups` (qua `has_many :groups, through: :group_memberships` vừa
  thêm), **không** N+1 vì chỉ có 1 Device, 1 query join là đủ.
- `GET /api/v1/groups/:id` trả `devices_count` — dùng `group.devices.count`
  (1 `COUNT` query, không đếm trong vòng lặp).
- `GET /api/v1/groups` (Group List, F5) nếu bổ sung cột "Số device"
  (SoT §3, F5 OQ-4 giao lại cho F6) — **bắt buộc** dùng 1 query gộp
  (`LEFT JOIN group_memberships ... GROUP BY groups.id` hoặc N
  `group.devices.count` riêng lẻ **bị cấm** trong vòng lặp render list) —
  cảnh báo này đã được `docs/design/F5-db.md` §3 ghi sẵn, nhắc lại ở đây vì
  giờ là lúc thực thi. Chốt câu query cụ thể ở `/design F6-api.md`.

## 4. Rủi ro / open question

### 4a. Điểm đã người duyệt xác nhận (2026-09-16, Lai Bui)

- **Tên migration/thời điểm timestamp**: chốt theo đề xuất —
  `20260916150000_create_group_memberships.rb` (sau
  `20260916090000_create_groups.rb`); con số thật do `rails g migration`
  sinh tại thời điểm implement, không ảnh hưởng thiết kế.
- **Sort key cho `GET /api/v1/groups/:id/devices`**: chốt theo đề xuất —
  `devices.created_at DESC, devices.id DESC` (không phải
  `group_memberships.created_at`), nhất quán UX với Device List/Group List
  đã có ở F2/F5.
- **`belongs_to :group, touch: true`**: chốt **không** thêm, đúng đề xuất —
  tránh 2 chuẩn khác nhau giữa bulk-add (`upsert_all`, bỏ qua `touch:`) và gỡ
  đơn lẻ (đi qua model, có `touch:`). Nếu sau này cần `groups.updated_at`
  phản ánh lần sửa thành viên gần nhất, thiết kế riêng ở feature liên quan,
  không sửa lại quyết định này của F6.

### 4b. Rủi ro đã biết, đã chấp nhận (không cần quyết định, chỉ để không bị coi là bug)

- **Device `retired` bất biến (A8/A9/A27) không được enforce ở DB layer của
  `group_memberships`** — không có check constraint nào trên bảng này tham
  chiếu `devices.status`. Đây là quyết định có chủ đích, nhất quán với cách
  dự án đã xử lý mọi enum constraint khác (`docs/design/F2-db.md` §1b,
  `docs/design/F5-db.md` §4b: "giới hạn enforce ở model/service layer, không
  có DB check constraint song song"). Việc chặn Device retired (atomic
  reject cho batch — SoT §12 OQ-3) là trách nhiệm của **service layer**
  (kiểm tra `Device.where(id: device_ids, status: :retired).exists?` **trước
  khi** gọi `upsert_all`, tương tự cho gỡ) — chốt chi tiết ở
  `/design F6-api.md`, không phải file DB này. Rủi ro đã chấp nhận: một
  script ghi SQL trực tiếp (bỏ qua Rails hoàn toàn) có thể tạo/xóa
  `group_memberships` cho Device retired mà không bị chặn — cùng class rủi
  ro đã ghi nhận ở mọi feature trước.
- **Race condition gỡ (A16, double-click)**: `DELETE
  /api/v1/groups/:id/devices/:device_id` request thứ 2 phải nhận 404 (đã bị
  gỡ bởi request 1), không 500. DB layer không cần cơ chế đặc biệt cho việc
  này — hành vi tự nhiên của `GroupMembership.find_by(group_id:,
  device_id:)` trả `nil` ở lần gọi thứ 2 (row đã bị xóa) là đủ; API layer
  chuyển `nil` → 404 (chốt ở `/design F6-api.md`, không phải quyết định
  schema).
- **`GroupMembership` không có validate `belongs_to`-org-khớp** — xem §1b,
  nhắc lại ở đây vì đây là điểm dễ bị hiểu nhầm là "thiếu 1 lớp bảo vệ": lớp
  bảo vệ thật sự nằm ở service layer lọc `device_ids` trước `upsert_all`,
  không phải model validation (vốn không chạy trên path `upsert_all`).
- **Không có cột `source`/`status` trên `group_memberships`** (khác
  `policy_assignments` của F8) — quyết định của SoT §3, không phải thiếu sót;
  nếu F9 (policy resolution) sau này cần biết "Device thuộc Group qua đâu",
  đó là câu hỏi của `policy_assignments` (đã có `source: group/direct`),
  không phải của bảng này.
- **Không thêm cột `devices_count` (counter cache) vào `groups`** — SoT §12
  OQ-5 đã chốt dùng `COUNT` trực tiếp; nhắc lại rủi ro đã biết: ở quy mô
  hàng chục–hàng trăm Group/trang danh sách, `COUNT`/`LEFT JOIN` trên
  `group_memberships` (đã có unique index `[group_id, device_id]`) đủ nhanh;
  nếu sau này số Group tăng rất lớn và `COUNT` trở thành nút thắt, hướng đi
  là thêm counter cache + tự quản lý cập nhật thủ công trong cùng
  transaction với `upsert_all`/`delete` — không làm ở F6 (YAGNI, đã cân nhắc
  và loại ở SoT).
- **`ActiveRecord::RecordNotUnique` gần như không thể xảy ra ở path chính**
  vì `upsert_all` xử lý conflict êm ở tầng DB (`ON CONFLICT DO UPDATE`/`DO
  NOTHING` tùy cấu hình) — không phải raise exception cho service layer bắt.
  Path `save`/`create` tuần tự (nếu có code nào dùng, vd script nội bộ) vẫn
  có thể raise, rescue thành 422 là việc của API layer nếu path đó thực sự
  tồn tại — ghi lại để `/design F6-api.md` không bỏ sót nếu quyết định có
  endpoint/thao tác nào đi qua `create` thay vì `upsert_all`.
