---
feature_id: F5
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Database — F5

Nguồn: `docs/sot/F5-group-crud.md` (approved), `PRD.md` §"Nghiệp vụ" →
"Group", `CLAUDE.md` §4, `api/db/schema.rb` hiện có (`organizations`, `users`
từ F0; `devices` từ F2 — xem `docs/design/F0-db.md`, `docs/design/F2-db.md`),
`docs/backlog.md` (F6 sở hữu `group_memberships`, F8 sở hữu
`policy_assignments` — **chưa tồn tại** ở F5).

**Kết luận đầu tiên (khớp SoT §3, §8):** F5 cần **đúng 1 migration** tạo bảng
mới `groups`, không sửa/không đụng bất kỳ bảng nào đang có
(`organizations`/`users`/`devices` giữ nguyên 100%). F5 **không** tạo bảng
join nào (SoT §12 OQ-3 đã chốt) và **không** thêm cột soft-delete (OQ-2 —
hard delete).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `Group` (mới) | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false` + `foreign_key: true` (mọi Group phải thuộc đúng 1 org — không có "Group mồ côi"; đây là chỗ neo của invariant "tách Organization tuyệt đối", `CLAUDE.md` §4) | Add |
| `Group` | `name` | `string` | `null: false`; **unique theo `organization_id`** (composite, case-sensitive — xem §1a); model: `presence: true`, `length: { maximum: 100 }` sau khi trim (SoT OQ-8) | Add |
| `Group` | `description` | `text` | `null: true` (SoT A25 — mô tả tùy chọn); model: `length: { maximum: 500 }`; chuỗi rỗng/chỉ khoảng trắng được normalize thành `NULL` (§1b). Chọn `text` thay vì `string` — xem §1c | Add |
| `Group` | `created_at` / `updated_at` | `datetime` | `null: false` (Rails timestamps mặc định). `created_at` là sort key chính (SoT OQ-7: `created_at DESC, id DESC`) | Add |
| `Group` | `before_validation :normalize_name_and_description` | callback | **Mới** — trim `name`, trim `description` và đổi blank → `NULL`. Bắt buộc, không phải "cho đẹp": xem §1b | Add |
| `Group::NAME_TAKEN_MESSAGE` | constant | `string` | `"Tên group này đã tồn tại trong tổ chức của bạn."` (SoT A5) — dùng chung cho validate uniqueness **và** cho nhánh rescue `ActiveRecord::RecordNotUnique` ở API layer, đúng pattern `Device::IDENTIFIER_TAKEN_MESSAGE` của F3 | Add |
| `Organization` | `has_many :groups` | — | **Không** khai báo `dependent:` (xem §4) — nhất quán với `has_many :devices` của F2: PRD không có màn hình xóa Organization nên đường xóa này hiện không tồn tại | Add (association only) |
| `Group` | `has_many :group_memberships, dependent: :delete_all` | — | **KHÔNG làm ở F5** — bảng `group_memberships` chưa tồn tại (SoT OQ-3); khai báo association trỏ tới model chưa có sẽ raise `NameError` ngay khi Rails boot (đúng lý do đã ghi ở `docs/design/F4-db.md` §1). **Nghĩa vụ carry-over bắt buộc của F6** — xem §4 | Không làm (ghi nợ F6) |
| `Group` | `has_many :policy_assignments, dependent: :delete_all` | — | **KHÔNG làm ở F5** — cùng lý do trên. **Nghĩa vụ carry-over bắt buộc của F8** — xem §4 | Không làm (ghi nợ F8) |
| `Group` | `has_many :devices, through: :group_memberships` | — | **KHÔNG làm ở F5** — phụ thuộc `group_memberships` (F6). Kéo theo: **không** có `devices_count` ở F5 (SoT OQ-4) nên **không** thêm cột counter cache nào ở migration này | Không làm (ghi nợ F6) |
| `Device` / `User` / `Organization` (cột, index) | — | — | Không thêm/đổi/xóa cột hay index nào | **No-change** |

Model-level validation đi kèm migration (viết ra để `slice-implementer` không
phải đoán):

```ruby
class Group < ApplicationRecord
  belongs_to :organization

  NAME_TAKEN_MESSAGE = "Tên group này đã tồn tại trong tổ chức của bạn.".freeze
  NAME_BLANK_MESSAGE = "Tên group không được để trống".freeze

  before_validation :normalize_name_and_description

  validates :name, presence: { message: NAME_BLANK_MESSAGE },
                   length: { maximum: 100 },
                   uniqueness: { scope: :organization_id,
                                 case_sensitive: true,
                                 message: NAME_TAKEN_MESSAGE }
  validates :description, length: { maximum: 500 }, allow_nil: true

  private

  def normalize_name_and_description
    self.name = name.strip if name.is_a?(String)
    self.description = description.strip.presence if description.is_a?(String)
  end
end
```

### 1a. Composite unique index — `name` unique trong Organization

Đúng pattern đã dùng cho `User.email` (F0 §1a) và `Device.identifier`
(F2 §1a), theo quyết định SoT OQ-1 (**có** unique theo org, **case-sensitive**):

```ruby
add_index :groups, [:organization_id, :name], unique: true
```

- **Không** thêm `add_index :groups, :name, unique: true` (đơn, toàn cục) —
  sẽ cấm chính điều `CLAUDE.md` §4 cho phép và SoT A6 yêu cầu ("Hai
  Organization khác nhau được phép trùng tên Group").
- **Không** thêm functional index `lower(name)`: OQ-1 chốt case-sensitive, nên
  index B-tree thường trên cột `name` là khớp 1-1 với `validates ...
  case_sensitive: true`. Hệ quả đã biết và được chấp nhận: trong cùng org,
  `"Sales Team"` và `"sales team"` là **2 group hợp lệ khác nhau** (còn search
  `q` lại dùng `ILIKE` nên sẽ trả về cả hai) — ghi lại ở §4 để không bị coi là
  bug.
- Đây là **lớp 2** của bảo vệ 2 lớp mà SoT §6 yêu cầu: validate ở model chặn
  đa số trường hợp, unique index chặn race A7 ở tầng DB
  (`ActiveRecord::RecordNotUnique`). Việc rescue exception đó thành `422`
  field-level (thay vì `500`) là quyết định **API layer** — đã có sẵn pattern
  ở `docs/design/F3-api.md` §5, không phải việc của file này. DB layer chỉ có
  1 nghĩa vụ hỗ trợ: expose **đúng 1 hằng số message** (`NAME_TAKEN_MESSAGE`)
  để 2 nhánh (validate thường / rescue race) trả về chuỗi giống hệt nhau, FE
  không phân biệt được.

### 1b. Normalize `name`/`description` — vì sao callback là bắt buộc, không phải tùy chọn

Ba lý do, mỗi lý do đều gắn với 1 acceptance criteria của SoT:

1. **A4 — `name` chỉ toàn khoảng trắng phải 422.** Không trim thì `"   "` là
   một chuỗi *present* theo Rails (`"   ".blank?` là `true` thật, nhưng
   `presence` validator dùng `blank?` nên vẫn bắt được) — tuy nhiên `"  Sales
   Team  "` thì **không** bị chặn và sẽ được lưu nguyên cả khoảng trắng thừa.
2. **Đồng bộ giữa validate app-level và unique index DB-level.** Nếu không
   trim, `"Sales Team"` và `"Sales Team "` là 2 giá trị **khác nhau** với cả
   `validates uniqueness` lẫn unique index → user tạo được 2 group nhìn y hệt
   nhau trên UI, phá đúng lý do OQ-1 chọn unique ("hai group trùng tên trong
   cùng org khiến UI và test mơ hồ"). Trim ở `before_validation` khiến giá trị
   được validate **chính là** giá trị được ghi xuống index — không có khoảng
   hở giữa 2 lớp.
3. **A25 + OQ-8 — `description` rỗng lưu `NULL` nhất quán.** `description.strip.presence`
   biến `""` và `"   "` thành `nil`, nên DB chỉ có đúng 1 cách biểu diễn
   "không có mô tả" (`NULL`), không lẫn lộn `NULL` vs `''`. Nhờ vậy FE render
   ô trống mà không phải xử lý 2 trường hợp, và test `expect(group.description).to be_nil`
   là xác định.

Callback dùng `is_a?(String)` guard để không nổ khi client gửi `null` hoặc
kiểu khác (`name: nil` vẫn rơi đúng vào `presence` validator → 422 field
`name`, không phải `NoMethodError` → 500).

### 1c. `description` dùng `text`, không `string`

Trên PostgreSQL, `varchar` không giới hạn và `text` là **cùng một kiểu lưu
trữ, cùng hiệu năng** — lựa chọn ở đây thuần túy là biểu đạt ý định. Chọn
`text` vì `description` là văn bản tự do nhiều dòng (khác hẳn `name`/
`identifier`/`email` là định danh ngắn dùng `string`), và để không ai hiểu
nhầm rằng có giới hạn 255 ký tự ngầm ở tầng DB. Giới hạn thật (500 ký tự,
OQ-8) được enforce ở **model layer**, không phải bằng `limit:` ở cột — xem §4
để biết lý do và rủi ro đã chấp nhận.

Đây là field văn bản dài đầu tiên của dự án nên chưa có precedent trong
`schema.rb`; nếu người duyệt muốn giữ tuyệt đối 1 kiểu `string` cho mọi cột
chuỗi thì đổi sang `t.string :description` cũng không ảnh hưởng hành vi nào —
xem §4 (điểm cần xác nhận, không phải bế tắc).

## 2. Migration plan

Đúng **một** migration (bảng mới hoàn toàn, không có dữ liệu cũ cần giữ):

1. `CreateGroups` (dự kiến `api/db/migrate/<timestamp>_create_groups.rb`,
   nối tiếp `20260915111940_create_devices.rb`):

   ```ruby
   class CreateGroups < ActiveRecord::Migration[8.1]
     def change
       create_table :groups do |t|
         t.references :organization, null: false, foreign_key: true, index: false
         t.string :name, null: false
         t.text   :description
         t.timestamps
       end

       add_index :groups, [:organization_id, :name], unique: true
       add_index :groups, [:organization_id, :created_at, :id]
     end
   end
   ```

   - `index: false` trên `t.references :organization`: cố ý bỏ index đơn
     `organization_id` mặc định của Rails — **cả hai** index composite bên
     dưới đều có `organization_id` ở vị trí trái nhất, nên mọi truy vấn chỉ
     lọc theo `organization_id` đã được phủ bởi leftmost-prefix của B-tree.
     Đây đúng quyết định đã áp dụng cho `devices` ở F2 §2 (xem `schema.rb`:
     bảng `devices` không có index đơn `organization_id`).
   - `foreign_key: true` tạo FK **không kèm** `on_delete:` — tức là
     `NO ACTION`, **không** có cascade ngầm. Đây là điều F5 muốn và là tiền đề
     cho invariant "xóa Group không để dữ liệu treo": mọi việc dọn dữ liệu
     liên quan phải do Rails khai báo **tường minh** (`dependent:`), không
     phải do DB âm thầm làm (`CLAUDE.md` §4). Xem §4 — nghĩa vụ này lan sang
     cả các FK mà F6/F8 sẽ tạo **trỏ tới** `groups(id)`.

- **Backfill**: không cần — bảng mới tạo, chưa có dữ liệu cũ.
- **Phá dữ liệu cũ**: không — migration chỉ `create_table` + `add_index` trên
  một bảng chưa tồn tại; `organizations`, `users`, `devices` không bị đụng tới
  một dòng nào. Rollback cũng không làm mất dữ liệu của 3 bảng đó.
- **Reversible**: có — toàn bộ nằm trong `change` với `create_table`/`add_index`,
  Rails tự sinh `down` (drop bảng, index đi kèm bị drop theo). Không có
  `execute`/SQL thô nào cần viết `up`/`down` thủ công.
- **Thứ tự phụ thuộc**: `organizations` đã tồn tại từ F0 nên FK tạo được ngay,
  không cần tách 2 migration.
- **Seed** (`api/db/seeds.rb`): SoT §11 có scenario phân trang (25 group) —
  nhưng đó là dữ liệu **test** do FactoryBot/step definition dựng, không phải
  seed. Seed chỉ cần vài group mỗi org để demo/walkthrough README có nội dung
  thật; việc này thuộc stage Implement, không phải file thiết kế này. Tương
  tự, `api/spec/factories/groups.rb` (factory mới, `sequence(:name)` để tránh
  đụng unique index trong spec) cũng được tạo ở stage Implement.

## 3. Index / hiệu năng

F5 **không** phải kịch bản "Group 10.000 device" (đó là F6/F8 — SoT §10), và
số Group trong 1 org được coi là hàng chục–hàng trăm. Nhưng nguyên tắc "list
không quét toàn bảng khi dữ liệu tăng" (`PRD.md` §"Chất lượng kỹ thuật") vẫn
áp dụng ngay:

| Index | Phục vụ truy vấn | Ghi chú |
|---|---|---|
| `groups(organization_id, name)` UNIQUE | (a) Ràng buộc unique-trong-org (§1a); (b) backing cho `validates uniqueness` khi create/update (A5, A9); (c) chặn race A7 ở tầng DB; (d) mọi lookup chỉ theo `organization_id` qua leftmost-prefix | Thay thế index đơn `organization_id` mặc định — xem §2 |
| `groups(organization_id, created_at, id)` | Query mặc định của list: `current_organization.groups.order(created_at: :desc, id: :desc).limit(...).offset(...)` — đúng sort key đã chốt SoT OQ-7 | Index scan theo đúng thứ tự `ORDER BY` (Postgres đọc ngược index cho `DESC`), không cần bước sort riêng, không quét toàn bảng để `LIMIT/OFFSET`. Giống hệt `devices(organization_id, created_at, id)` của F2 |
| `groups(id)` PK (mặc định) | `current_organization.groups.find(params[:id])` cho `PATCH`/`DELETE` (A1–A3) | Không cần index thêm — điều kiện `id = ?` đã giới hạn xuống tối đa 1 row trước khi lọc `organization_id`; đúng phân tích đã làm ở `docs/design/F4-db.md` §3 |

**Không thêm index nào cho search `q`** (`name ILIKE '%...%'`): partial match
có wildcard ở đầu **không** dùng được B-tree, và SoT §10 đã chốt "chấp nhận
sequential scan trong phạm vi 1 org, không tối ưu sớm (trigram index) khi chưa
có số liệu". Điểm cứu vãn: `organization_id` luôn có mặt trong `WHERE` và đứng
đầu 2 index trên, nên Postgres thu hẹp về đúng 1 org trước rồi mới lọc `ILIKE`
trên tập nhỏ. Nếu sau này thật sự chậm, phương án là bật extension `pg_trgm` +
`add_index :groups, :name, using: :gin, opclass: :gin_trgm_ops` — ghi ra đây
làm đường đi sẵn, **không làm ở F5** (YAGNI). Rủi ro production đã biết này
phải được ghi vào `DESIGN.md` khi implement (SoT §10).

**`total_count`**: đếm bằng `COUNT` trên relation đã org-scope + đã lọc `q`,
**trước** `limit/offset` (SoT §4 bước 3, §6) — không `.to_a.size`. Index
`(organization_id, ...)` đủ để `COUNT` không quét toàn bảng khi không có `q`.

**N+1**: F5 không có rủi ro N+1 — mọi cột hiển thị ở bảng list (`name`,
`description`) nằm ngay trên `groups`, không join bảng nào. Đặc biệt: **không**
có `devices_count` ở F5 (SoT OQ-4) nên **không** có cám dỗ `group.devices.count`
trong vòng lặp. Cảnh báo bàn giao cho F6: khi thêm cột "Số device", **bắt
buộc** dùng 1 query gộp (`LEFT JOIN ... GROUP BY` hoặc counter cache), không
đếm trong vòng lặp render.

**Cảnh báo hiệu năng bàn giao cho F6/F8** (SoT §10, nhắc lại để không trôi):
khi `group_memberships` có thể tới 10.000 dòng/group, `dependent: :delete_all`
sinh ra một lệnh `DELETE FROM group_memberships WHERE group_id = ?` — F6 **bắt
buộc** có index với `group_id` ở vị trí trái nhất để lệnh này không seq-scan
toàn bảng, và phải cân nhắc thời gian giữ transaction; nếu vượt ngưỡng chấp
nhận được thì F6 quyết định chuyển sang xóa bất đồng bộ. Không giải quyết ở
F5.

## 4. Rủi ro / open question

### 4a. Nghĩa vụ carry-over bắt buộc cho F6 và F8 (ghi nợ tường minh, SoT §6 + OQ-3)

Đây là phần quan trọng nhất của file này, vì invariant nặng nhất của F5
("Xóa Group không để dữ liệu treo" — `CLAUDE.md` §4) **chưa có gì để thực thi
ở F5** do 2 bảng join chưa tồn tại. F5 chốt hợp đồng, F6/F8 thực thi:

| Feature | Nghĩa vụ bắt buộc khi tạo bảng join | Vì sao không làm được ở F5 |
|---|---|---|
| **F6** (`group_memberships`) | (a) Thêm `has_many :group_memberships, dependent: :delete_all` vào `Group`; (b) FK `group_memberships.group_id → groups.id` **không** được khai báo `on_delete: :cascade` (dọn dẹp phải tường minh ở Rails, không ngầm ở DB); (c) index có `group_id` leftmost cho lệnh `DELETE` (xem §3); (d) thêm test regression "xóa group → không còn membership mồ côi, **device vẫn tồn tại**" | Bảng chưa tồn tại; khai báo `has_many` trỏ tới model chưa có → `NameError` khi Rails boot. Thiết kế schema/index của nó bị chi phối bởi yêu cầu 10k device + idempotent của F6 → thiết kế sớm là đoán mò |
| **F8** (`policy_assignments`) | (a) Thêm `has_many :policy_assignments, dependent: :delete_all` vào `Group`; (b) FK `policy_assignments.group_id → groups.id` không cascade ngầm; (c) index có `group_id` leftmost; (d) thêm test regression "xóa group → không còn policy_assignment mồ côi, **policy vẫn tồn tại**" | Như trên; thêm nữa schema của nó phụ thuộc quyết định `source: group/direct` + unique index `(policy_id, group_id)`/`(policy_id, device_id)` (`CLAUDE.md` §4) thuộc F8 |

Ghi chú thực thi kèm theo:

- **`dependent: :delete_all`, không `:destroy`** — đúng nguyên văn SoT §6. Với
  10k dòng/group, `:destroy` sẽ instantiate 10.000 object Ruby và chạy callback
  từng dòng; `:delete_all` là 1 lệnh SQL. Join row không có callback nghiệp vụ
  nào cần chạy nên `:delete_all` là đúng cả về ngữ nghĩa lẫn hiệu năng.
- **Transaction**: `Group#destroy` của Rails đã tự bọc mọi `dependent:` +
  `DELETE` bản ghi cha trong **một** transaction → A13 ("lỗi hạ tầng không xóa
  nửa vời") được đảm bảo mà không cần `ActiveRecord::Base.transaction` thủ
  công. Nhưng API layer **phải gọi `destroy`, không gọi `delete`** —
  `Group#delete` bỏ qua toàn bộ `dependent:` và sẽ để lại join row mồ côi (và
  ở F6/F8 sẽ vi phạm FK). Đây là cái bẫy lớn nhất của feature này → phải nêu
  lại trong `docs/design/F5-api.md` và trong plan.
- **Scenario "Xóa Group không để lại dữ liệu liên kết treo..."** đã được SoT
  §11 chủ động **loại khỏi** acceptance test của F5 (OQ-3 phương án a) và
  chuyển thành nghĩa vụ của F6/F8 — không được tự ý kéo lại vào feature file
  của F5 (sẽ RED vĩnh viễn, phá gate #4).
- Nghĩa vụ này phải xuất hiện lại trong **SoT + design của F6 và F8**, và
  trong **`DESIGN.md`** với ghi chú "hợp đồng chốt từ F5".

### 4b. Điểm cần người duyệt xác nhận

- **`description` là `text` hay `string`?** (§1c) — khuyến nghị `text`; hành vi
  hoàn toàn không đổi dù chọn kiểu nào (Postgres lưu trữ như nhau, giới hạn 500
  ký tự nằm ở model). Nêu ra vì đây là lần đầu dự án có cột văn bản dài, và
  `schema.rb` hiện tại chỉ toàn `string` — muốn giữ tuyệt đối một kiểu thì đổi
  1 dòng trong migration là xong.
- **Giới hạn độ dài enforce ở model, không có `limit:` ở cột DB.** Nhất quán
  với quyết định đã chốt ở `docs/design/F2-db.md` §1b (không thêm DB check
  constraint song song cho enum, chấp nhận trade-off "ai ghi thẳng SQL bỏ qua
  Rails thì không được bảo vệ"). Rủi ro đã chấp nhận: một script ghi SQL trực
  tiếp có thể chèn `name` dài 10.000 ký tự. Nếu người duyệt muốn siết ở tầng
  DB (`t.string :name, limit: 100` + check constraint cho `description`), nên
  làm **đồng loạt** cho cả `users.email`/`devices.identifier`/`devices.name`
  trong 1 quyết định riêng, không lặt vặt từng feature — giống cách F2 đã hoãn
  quyết định check constraint.

### 4c. Rủi ro đã biết, đã chấp nhận (không cần quyết định, chỉ để không bị coi là bug)

- **Unique case-sensitive → `"Sales Team"` và `"sales team"` cùng tồn tại
  trong 1 org** (hệ quả trực tiếp của OQ-1). Cộng thêm search `q` dùng `ILIKE`
  (OQ-6, case-insensitive), user gõ `"sales"` sẽ thấy **cả hai** — hai lớp
  hành vi này không mâu thuẫn về mặt kỹ thuật nhưng trông hơi lạ nếu ai đó cố
  tình tạo cặp tên như vậy. Đổi sang case-insensitive unique là một quyết định
  SoT (OQ-1 đã chốt), không phải điều file DB này được tự đổi; nếu revisit thì
  cần thêm functional index `lower(name)` + normalize khi so sánh.
- **Không có cột soft-delete** (`deleted_at`) — OQ-2 chốt hard delete. Hệ quả:
  group đã xóa biến mất hoàn toàn, không khôi phục được, và F6/F8/F9 **không**
  phải nhớ lọc `deleted_at IS NULL` ở mọi query (đây chính là lý do chọn hard
  delete). Không thêm cột "dự phòng cho tương lai".
- **`Organization has_many :groups` chưa có `dependent:`** — PRD không có màn
  hình xóa Organization (`docs/backlog.md` "Ngoài phạm vi") nên hiện không có
  đường nào gọi `Organization#destroy`. Giữ nguyên trạng thái "chưa quyết
  định", đúng như `has_many :devices` của F2. Nếu tương lai có tính năng xóa
  Organization, phải quyết định một lượt cho cả `users`
  (`:restrict_with_error`), `devices`, `groups` — không quyết định lẻ ở đây.
- **`RecordNotUnique` → 422 là việc của API layer**, không phải DB layer (§1a)
  — nêu lại ở đây để `/design F5` API không bỏ sót, giống cách `F3-db.md` bàn
  giao rủi ro `ArgumentError` enum.
- **`:id` sai định dạng (A3)**: đã xác nhận ở `docs/design/F4-db.md` §4 rằng
  `find` với id phi số trên association không rơi xuống DB thành
  `StatementInvalid` mà raise `ActiveRecord::RecordNotFound` → `rescue_from`
  toàn cục của F0 xử lý thành 404. Không cần gì thêm ở schema F5.
- **Không thêm counter cache `devices_count` "cho sẵn"** — OQ-4 đã chốt không
  đưa field này vào contract F5. Thêm cột counter rỗng luôn bằng 0 ở đây sẽ
  phải viết lại toàn bộ khi F6 quyết định cách đếm (counter cache thật sự có
  đúng không, hay `LEFT JOIN ... GROUP BY`) — ghi lại để người review sau
  không đề xuất lại phương án này mà không biết đã bị loại có chủ đích (cùng
  tinh thần `F4-db.md` §4 với `has_many :groups` placeholder).
