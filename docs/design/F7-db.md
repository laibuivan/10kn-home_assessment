---
feature_id: F7
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc) — sửa 1 lỗi STI trước khi approve, xem §1/§4b "[SỬA khi review]"
date: 2026-09-17
---

# Thiết kế Database — F7

Nguồn: `docs/sot/F7-policy-crud.md` (approved, cả 10 OQ đã chốt), `PRD.md`
§"Nghiệp vụ" → "Policy", `CLAUDE.md` §4, `api/db/schema.rb` hiện có
(`organizations`, `users` từ F0; `devices` từ F2/F3; `groups` từ F5;
`group_memberships` từ F6 — xem `docs/design/F5-db.md`,
`docs/design/F6-db.md`), `docs/backlog.md` (F8 sở hữu `policy_assignments` —
**chưa tồn tại**, không đụng ở F7).

**Kết luận đầu tiên (khớp SoT §3, §8):** F7 cần **đúng 1 migration** tạo bảng
mới `policies` — resource độc lập, không đụng Device/Group ở tầng dữ liệu.
Không sửa cột nào của `organizations`/`users`/`devices`/`groups`/
`group_memberships`. F7 **không** tạo bảng `policy_assignments` và **không**
thiết kế trước bất kỳ index/FK/cột nào cho nó (đúng bài học đã rút ra ở
F5→F6 với `group_memberships`: thiết kế sớm 1 bảng join phụ thuộc vào yêu cầu
idempotent/bulk-write của feature sở hữu nó — ở đây là F8 — là đoán mò).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `Policy` (mới) | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false` + `foreign_key: true` (mọi Policy phải thuộc đúng 1 org — không có "Policy mồ côi"; neo của invariant "tách Organization tuyệt đối", `CLAUDE.md` §4) | Add |
| `Policy` | `name` | `string` | `null: false`; **unique theo `organization_id`** (composite, case-sensitive — xem §1a, SoT OQ-1); model: `presence: true`, `length: { maximum: 100 }` sau khi trim (SoT OQ-8) | Add |
| `Policy` | `type` | `string` | `null: false`; **free-form, không DB enum/check constraint** (SoT OQ-3 đã chốt tường minh — xem §1d); model: `presence: true`, `length: { maximum: 100 }` sau khi trim (SoT OQ-8) | Add |
| `Policy` | `configuration` | `jsonb` | `null: false`; model validate phải là JSON **object** (Hash), không chấp nhận mảng/số/chuỗi/`null` (SoT OQ-5, A12/A13) — xem §1b cho quyết định `json` vs `jsonb` | Add |
| `Policy` | `status` | `integer` | `null: false`, `default: 0`; Rails native enum `enum status: { active: 0, inactive: 1 }` — cùng cơ chế enum số nguyên đã dùng cho `Device#status`/`User#status` (xem §1c, SoT OQ-10) | Add |
| `Policy` | `created_at` / `updated_at` | `datetime` | `null: false` (Rails timestamps mặc định). `created_at` là sort key chính cho phân trang (đúng pattern `devices`/`groups`, SoT §10); `updated_at` là **tie-break bậc 2** trong công thức resolution của F9 (`CLAUDE.md` §4) — không được bỏ hay đổi ý nghĩa | Add |
| `Organization` | `has_many :policies` | — | **Không** khai báo `dependent:` — nhất quán với `has_many :devices`/`has_many :groups` hiện có: PRD không có màn hình xóa Organization nên đường xóa này hiện không tồn tại (xem §4) | Add (association only) |
| `Policy` | `has_many :policy_assignments, dependent: :delete_all` | — | **KHÔNG làm ở F7** — bảng `policy_assignments` chưa tồn tại; khai báo association trỏ tới model chưa có sẽ raise `NameError` ngay khi Rails boot (đúng lý do đã ghi ở `docs/design/F5-db.md` cho `Group`). **Nghĩa vụ carry-over bắt buộc của F8** — xem §4a | Không làm (ghi nợ F8) |
| `Policy` | `has_many :groups, through: :policy_assignments` / `has_many :devices, through: :policy_assignments` | — | **KHÔNG làm ở F7** — phụ thuộc `policy_assignments` (F8). Kéo theo: **không** có cột "Số nơi đang gán" ở F7 (SoT OQ-6) nên **không** thêm counter cache nào ở migration này | Không làm (ghi nợ F8) |
| `Device` / `Group` / `User` / `Organization` (cột, index hiện có) | — | — | Không thêm/đổi/xóa cột hay index nào | **No-change** |

Model-level validation đi kèm migration (viết ra để `slice-implementer` không
phải đoán):

```ruby
class Policy < ApplicationRecord
  # Cột `type` trùng tên `inheritance_column` mặc định của Rails (STI) — nếu
  # không disable, Rails sẽ cố `constantize` giá trị `type` (vd "wifi",
  # "password") thành tên class mỗi khi load record, raise
  # `ActiveRecord::SubclassNotFound` ngay khi có bất kỳ record nào với `type`
  # không phải tên class hợp lệ (tức là mọi Policy thật). Bắt buộc phải có
  # dòng dưới đây trước khi cột `type` được dùng cho bất kỳ mục đích nghiệp
  # vụ nào khác ngoài STI thật sự — xem §1 ghi chú.
  self.inheritance_column = "_type_disabled"

  belongs_to :organization

  NAME_TAKEN_MESSAGE = "Tên policy này đã tồn tại trong tổ chức của bạn.".freeze
  NAME_BLANK_MESSAGE = "Tên policy không được để trống".freeze
  TYPE_BLANK_MESSAGE = "Loại policy không được để trống".freeze
  CONFIGURATION_INVALID_MESSAGE = "Cấu hình phải là một object JSON hợp lệ.".freeze

  enum :status, { active: 0, inactive: 1 }

  before_validation :normalize_name_and_type

  validates :name, presence: { message: NAME_BLANK_MESSAGE },
                   length: { maximum: 100 },
                   uniqueness: { scope: :organization_id,
                                 case_sensitive: true,
                                 message: NAME_TAKEN_MESSAGE }
  validates :type, presence: { message: TYPE_BLANK_MESSAGE },
                   length: { maximum: 100 }
  validates :status, presence: true
  validate :configuration_must_be_a_json_object

  private

  def normalize_name_and_type
    self.name = name.strip if name.is_a?(String)
    self.type = type.strip if type.is_a?(String)
  end

  def configuration_must_be_a_json_object
    errors.add(:configuration, CONFIGURATION_INVALID_MESSAGE) unless configuration.is_a?(Hash)
  end
end
```

Ghi chú:
- **[SỬA khi review, 2026-09-17]** `type` **có** đụng `ActiveRecord`'s STI
  convention theo nghĩa xấu, và đây **không phải** vô hại: Rails kích hoạt
  hành vi STI dựa trên **sự tồn tại của cột `type`** trên bảng, không phụ
  thuộc việc có class con nào kế thừa `Policy` hay không. Cụ thể,
  `ActiveRecord::Inheritance#discriminate_class_for_record` gọi
  `find_sti_class(record["type"])` mỗi khi Rails **load** một record có giá
  trị `type` không rỗng, và cố `constantize` chuỗi đó thành tên class — với
  giá trị nghiệp vụ thật (`"wifi"`, `"password_baseline"`...) sẽ raise
  `ActiveRecord::SubclassNotFound` ngay từ record đầu tiên có `type` khác
  rỗng, tức là **mọi** `Policy.find`/`current_organization.policies.all` sau
  khi có ≥1 policy thật sẽ crash. Bản nháp ban đầu của file này đánh giá sai
  rủi ro này (cho rằng chỉ kích hoạt khi có class con) — đã sửa lại: model
  bắt buộc có `self.inheritance_column = "_type_disabled"` (đặt tên cột giả,
  không tồn tại trên bảng `policies`, khiến `has_attribute?(inheritance_column)`
  luôn `false` → `using_single_table_inheritance?` luôn `false`) ngay đầu
  class, **trước** mọi dòng khác — xem code mẫu ở trên. Không đổi tên cột
  DB/field API `type` (giữ đúng thuật ngữ PRD + SoT), chỉ tắt cơ chế STI ở
  tầng model.
- Không viết `validates :configuration, presence: true` riêng — `nil`/thiếu
  field đã bị `configuration_must_be_a_json_object` bắt (`nil.is_a?(Hash)` là
  `false`) nên 1 validate custom là đủ, tránh 2 message khác nhau cho cùng 1
  input (A12 chỉ cần 1 lỗi bám field `configuration`).
- `is_a?(String)` guard trong `normalize_name_and_type` giữ nguyên lý do đã
  áp dụng ở `Group#normalize_name_and_description` (F5): `name`/`type` gửi
  `null` hoặc kiểu khác rơi đúng vào `presence`/`configuration` validator →
  422 field-level, không `NoMethodError` → 500.

### 1a. Composite unique index — `name` unique trong Organization

Đúng pattern đã dùng cho `User.email` (F0), `Device.identifier` (F2),
`Group.name` (F5), theo quyết định SoT OQ-1 (**có** unique theo org,
case-sensitive):

```ruby
add_index :policies, [:organization_id, :name], unique: true
```

- **Không** thêm `add_index :policies, :name, unique: true` (đơn, toàn cục)
  — sẽ cấm chính điều `CLAUDE.md` §4 cho phép và SoT A6 yêu cầu ("Hai
  Organization khác nhau được phép trùng tên Policy").
- **Không** thêm functional index `lower(name)`: SoT OQ-1 chốt
  case-sensitive, nên B-tree thường trên `name` khớp 1-1 với `validates ...
  case_sensitive: true` — đúng hệ quả đã chấp nhận ở `docs/design/F5-db.md`
  §1a cho `Group.name` (`"Password Baseline"` và `"password baseline"` là 2
  policy hợp lệ khác nhau trong cùng org).
- Đây là **lớp 2** của bảo vệ 2 lớp (SoT §6): validate ở model chặn đa số
  trường hợp, unique index chặn race A7 ở tầng DB
  (`ActiveRecord::RecordNotUnique`). Rescue exception đó thành `422`
  field-level là quyết định **API layer** (pattern đã có ở
  `docs/design/F3-api.md`/`F5-api.md`), không phải việc của file này — DB
  layer chỉ có nghĩa vụ expose đúng 1 hằng số `NAME_TAKEN_MESSAGE` để 2
  nhánh (validate thường / rescue race) trả về chuỗi giống hệt nhau.

### 1b. `configuration`: `jsonb`, không `json`

**Quyết định: `jsonb`.** Lý do:

1. **F9 cần so sánh bằng nội dung `configuration` giữa các policy cùng
   `type`** để phát hiện conflict (`CLAUDE.md` §4: "Conflict (cùng `type`,
   `configuration` khác nhau)"). `jsonb` lưu ở dạng nhị phân đã parse, hỗ trợ
   toán tử `=` so sánh cấu trúc JSON hiệu quả (và có thể lập chỉ mục GIN nếu
   cần sau này); `json` là text thô — so sánh `=` giữa 2 cột `json` thực chất
   là so sánh chuỗi ký tự, nên `{"a":1,"b":2}` và `{"b":2,"a":1}` (cùng ý
   nghĩa, khác thứ tự key) sẽ bị coi là **khác nhau** một cách sai lệch. F9
   chắc chắn cần đúng ngữ nghĩa so sánh theo cấu trúc, không theo chuỗi.
2. **Không mất khả năng gì so với `json`** ở phạm vi F7: F7 không cần giữ
   nguyên thứ tự key hay whitespace gốc của input JSON (`json` giữ text thô
   1-1, `jsonb` chuẩn hoá lại) — SoT §10/§6 không có yêu cầu nào về việc giữ
   nguyên format JSON client gửi lên, chỉ cần "là JSON object hợp lệ".
3. **Chi phí ghi** của `jsonb` (phải parse + re-serialize khi write) không
   đáng kể ở quy mô Policy của 1 org (hàng chục, không phải hàng nghìn/giây —
   SoT §10).
4. Nhất quán với khuyến nghị của SoT §10 (`Non-functional`) — SoT đã phân
   tích đúng lý do này và để ngỏ quyết định cuối cùng cho `/design F7-db`;
   không có thông tin mới nào ở đây đổi hướng khuyến nghị đó.

**Không có trade-off thực sự đáng kể để chọn `json` thay vào** — khác các
điểm "để người duyệt xác nhận" khác trong tài liệu này, đây không phải một
open question, chỉ ghi lại lập luận để không ai đổi lại mà không đọc phần
này trước.

### 1c. `status` — Rails native enum (integer), cùng pattern `Device#status`

Chọn **Rails native enum trên cột `integer`**, giá trị `{ active: 0, inactive:
1 }`, đúng phong cách `Device#status` (`{ active: 0, inactive: 1, retired:
2 }`) và `User#status` đã có trong `schema.rb`/model hiện tại — **không**
đánh số lại/đổi ý nghĩa `0`/`1` so với 2 giá trị đầu của `Device#status` để
giữ quy ước "0 luôn là active" nhất quán toàn dự án.

- **Không** thêm DB check constraint song song — giữ nguyên trade-off đã
  chấp nhận ở `docs/design/F2-db.md` §1b cho `Device#status`/`#platform`:
  nếu muốn siết ở tầng DB, làm đồng loạt cho mọi enum trong 1 quyết định
  riêng, không lặt vặt từng feature.
- **Hệ quả cần API layer xử lý** (ghi chú lại vì phát sinh từ cột
  `integer` + enum, không phải quyết định của file này): gán giá trị string
  không có trong enum map (`Policy.new(status: "archived")`) khiến Rails
  raise `ArgumentError`, không tự thành lỗi validation 422 — API layer phải
  bắt trường hợp này (`params[:status].in?(Policy.statuses.keys)` trước khi
  gán, hoặc rescue `ArgumentError` → 422) để thỏa A18/A24 (tạo với `status`
  ngoài enum, và filter `status` ngoài enum) — đúng cảnh báo đã có ở
  `docs/design/F2-db.md` §1b cho `Device.platform`.
- **Không có state machine/transition guard nào ở model `Policy` layer** —
  SoT §6/A15/A16 xác nhận cả 2 chiều `active ↔ inactive` đều tự do ở F7,
  không có `before_validation` chặn transition như `Device#status_was ==
  "retired"`. Rule "không gán Policy inactive" (`CLAUDE.md` §4) chỉ có hiệu
  lực **tại thời điểm gán** — đó là validate của **F8** (service layer khi
  tạo `policy_assignment`), không phải của model `Policy` hay migration này.
  Không thêm callback nào ở đây "phòng xa" cho F8 — nếu F8 cần biết trạng
  thái, nó tự đọc `policy.active?`/`policy.status`.

### 1d. `type` — free-form string, không DB enum/check constraint (SoT OQ-3)

Cột `string` thường, **không** có DB-level enum hay check constraint giới
hạn giá trị — quyết định đã chốt tường minh ở SoT OQ-3 (và ghi nhận mâu
thuẫn có chủ đích với `UI_UX_design.md` §7.1 ở mục "Rủi ro/giả định" của
SoT). DB layer không biết và không cần biết danh sách `type` hợp lệ của
domain — combobox gợi ý ở FE (nạp `type` distinct đã tồn tại trong org) là
quyết định UI, không ảnh hưởng schema.

`type` **sửa tự do sau khi tạo** (SoT OQ-4, A14) — không có cột/flag nào
khóa field này, không có validate "đã được gán chưa" (phụ thuộc ngược vào
bảng của F8, SoT đã loại phương án này). Vì F9's policy resolution là hàm
thuần của state hiện tại (`CLAUDE.md` §4), đổi `type` không để lại "dữ liệu
ma" nào ở tầng DB.

## 2. Migration plan

Đúng **một** migration (bảng mới hoàn toàn, không có dữ liệu cũ cần giữ, nối
tiếp migration `create_group_memberships` gần nhất của F6):

1. `CreatePolicies` (dự kiến
   `api/db/migrate/<timestamp>_create_policies.rb`, timestamp sau migration
   F6 gần nhất — con số cụ thể chốt lúc chạy `rails g migration`):

   ```ruby
   class CreatePolicies < ActiveRecord::Migration[8.1]
     def change
       create_table :policies do |t|
         t.references :organization, null: false, foreign_key: true, index: false
         t.string :name,   null: false
         t.string :type,   null: false
         t.jsonb  :configuration, null: false
         t.integer :status, null: false, default: 0
         t.timestamps
       end

       add_index :policies, [:organization_id, :name], unique: true
       add_index :policies, [:organization_id, :created_at, :id]
       add_index :policies, [:organization_id, :status]
     end
   end
   ```

   - `index: false` trên `t.references :organization`: cố ý bỏ index đơn
     `organization_id` mặc định của Rails — cả ba index bên dưới đều có
     `organization_id` ở vị trí trái nhất, nên mọi truy vấn chỉ lọc theo
     `organization_id` đã được phủ bởi leftmost-prefix của B-tree. Đúng
     quyết định đã áp dụng cho `devices`/`groups`/`group_memberships`.
   - `foreign_key: true` tạo FK **không kèm** `on_delete:` — tức `NO ACTION`,
     không cascade ngầm. Nhất quán với mọi FK khác trong dự án
     (`CLAUDE.md` §4 "không dựa vào FK cascade ngầm không khai báo") — dù F7
     hiện chưa có luồng xóa nào cần dọn dẹp (không hard delete Policy, SoT
     OQ-2), giữ cùng convention để không tạo ngoại lệ không cần thiết.
   - `t.jsonb :configuration, null: false` — xem §1b cho lý do chọn `jsonb`.

- **Backfill**: không cần — bảng mới tạo, chưa có dữ liệu cũ.
- **Phá dữ liệu cũ**: không — migration chỉ `create_table` + `add_index` trên
  một bảng chưa tồn tại; `organizations`/`users`/`devices`/`groups`/
  `group_memberships` không bị đụng một dòng nào.
- **Reversible**: có — toàn bộ nằm trong `change` với `create_table`/
  `add_index`, Rails tự sinh `down` (drop bảng, index đi kèm bị drop theo).
  Không có `execute`/SQL thô nào cần viết `up`/`down` thủ công.
- **Thứ tự phụ thuộc**: `organizations` đã tồn tại từ F0 nên FK tạo được
  ngay, không cần tách nhiều migration. `policies` **không** phụ thuộc
  `devices`/`groups`/`group_memberships` (không FK nào trỏ tới các bảng đó ở
  F7) — khớp đúng SoT §1 "F7 không phụ thuộc F2–F6 về nghiệp vụ ở tầng dữ
  liệu".
- **Seed** (`api/db/seeds.rb`): thuộc stage Implement, không phải file thiết
  kế này — cần vài policy/org với `type`/`status` rải rác để demo filter có
  ý nghĩa (tương tự SoT §3 đã yêu cầu cho `devices`).
  `api/spec/factories/policies.rb` (factory mới, `sequence(:name)` để tránh
  đụng unique index trong spec, `configuration { { key: "value" } }` mặc
  định là Hash hợp lệ) cũng thuộc stage Implement.

## 3. Index / hiệu năng

F7 **không** phải kịch bản "Group/Policy 10.000 bản ghi" (đó là F8's
`policy_assignments`, và F6's `group_memberships`) — số Policy trong 1 org
được coi là nhỏ (hàng chục, SoT §10). Nhưng nguyên tắc "list không quét toàn
bảng khi dữ liệu tăng" vẫn áp dụng ngay, đúng pattern đã làm cho
`devices`/`groups`:

| Index | Phục vụ truy vấn | Ghi chú |
|---|---|---|
| `policies(organization_id, name)` UNIQUE | (a) Ràng buộc unique-trong-org (§1a); (b) backing cho `validates uniqueness` khi create/update (A5, A9); (c) chặn race A7 ở tầng DB; (d) mọi lookup chỉ theo `organization_id` qua leftmost-prefix | Thay thế index đơn `organization_id` mặc định — xem §2 |
| `policies(organization_id, created_at, id)` | Query mặc định của list: `current_organization.policies.order(created_at: :desc, id: :desc).limit(...).offset(...)` — đúng sort key nhất quán với `devices`/`groups` | Index scan theo đúng thứ tự `ORDER BY`, không cần bước sort riêng, không quét toàn bảng để `LIMIT/OFFSET` |
| `policies(organization_id, status)` | Filter theo `status` (SoT §4, "Lọc danh sách theo status") | Kết hợp `organization_id` qua leftmost-prefix; ở quy mô nhỏ 1 org, filter thêm `q` (ILIKE trên `name`) chạy sequential scan trên tập đã thu hẹp về đúng org — chấp nhận được (SoT §10), không cần index riêng cho `q` |
| `policies(id)` PK (mặc định) | `current_organization.policies.find(params[:id])` cho `GET`/`PATCH` (A1–A3) | Không cần index thêm — điều kiện `id = ?` đã giới hạn xuống tối đa 1 row trước khi lọc `organization_id`, cùng phân tích đã làm ở `docs/design/F4-db.md`/`F5-db.md` |

**Không thêm index nào cho search `q`** (`name ILIKE '%...%'`): partial match
có wildcard ở đầu không dùng được B-tree, và SoT §10 chấp nhận sequential
scan trong phạm vi 1 org, không tối ưu sớm (trigram index) khi chưa có số
liệu — đúng quyết định đã áp dụng cho Group List ở F5 §3.

**Không thêm GIN index trên `configuration`**: F7 không có truy vấn nào lọc
theo nội dung `configuration` (SoT §10: "F7 không cần query theo nội dung
`configuration`"). Nếu F9 sau này cần tra cứu theo nội dung JSON ở quy mô
lớn, đó là quyết định của F9, không phải F7 (YAGNI).

**`total_count`**: đếm bằng `COUNT` trên relation đã org-scope + đã lọc `q`/
`status`, **trước** `limit/offset` (SoT §10, §6) — không `.to_a.size`.

**N+1**: F7 không có rủi ro N+1 — mọi cột hiển thị ở bảng list (`name`,
`type`, `status`) nằm ngay trên `policies`, không join bảng nào. Không có
cột "Số nơi đang gán" ở F7 (SoT OQ-6) nên không có cám dỗ đếm
`policy.policy_assignments.count` trong vòng lặp render — cảnh báo bàn giao
cho F8: khi thêm cột này, bắt buộc dùng 1 query gộp (`LEFT JOIN ... GROUP
BY`), không đếm trong vòng lặp, đúng cảnh báo đã lặp lại xuyên suốt F4→F5→F6.

## 4. Rủi ro / open question

### 4a. Nghĩa vụ carry-over bắt buộc cho F8 (ghi nợ tường minh, SoT §3/§12 OQ-6/OQ-7/OQ-9)

| Nghĩa vụ | Vì sao không làm được ở F7 |
|---|---|
| Tạo bảng `policy_assignments` (`policy_id`, `group_id`/`device_id`, `source: group\|direct`), unique index `(policy_id, group_id)`/`(policy_id, device_id)` | Chưa có yêu cầu idempotent/bulk-write cụ thể của F8 để thiết kế đúng — thiết kế sớm là đoán mò (bài học F5→F6) |
| Thêm `has_many :policy_assignments, dependent: :delete_all` vào `Policy`; FK `policy_assignments.policy_id → policies.id` **không** `on_delete: :cascade` (dọn dẹp tường minh qua Rails, không ngầm ở DB) | Bảng chưa tồn tại; khai báo `has_many` trỏ tới model chưa có → `NameError` khi Rails boot |
| Cột/qquery "Số nơi đang gán" (`assignments_count`) trên Policy List (SoT OQ-6) — dùng `COUNT`/`LEFT JOIN` gộp, không counter cache, không đếm trong vòng lặp | Không có nguồn dữ liệu thật ở F7 (SoT OQ-6 đã chốt không bịa `0`/`—`) |
| Trang Policy Detail `/policies/:id` + `GET /api/v1/policies/:id` chi tiết với 2 tab "Đang gán cho Group/Device" (SoT OQ-7) | Toàn bộ nội dung phụ thuộc `policy_assignments` |
| Cảnh báo "đang được gán cho N group/device" khi deactivate 1 policy (SoT OQ-9), kèm quyết định hành vi cụ thể (giữ gán nhưng ngưng hiệu lực, hay gỡ gán) — ghi trong `DESIGN.md` của F8 | Không có bảng để đếm N ở F7 |
| Validate service layer "không gán Policy inactive"/"không gán chéo Organization" khi tạo `policy_assignment` (`CLAUDE.md` §4) | Thuộc hành động **gán**, không tồn tại ở F7 |

Ghi chú thực thi kèm theo (đúng tinh thần đã ghi ở `docs/design/F5-db.md`
§4a cho `Group`→F6): nghĩa vụ này phải xuất hiện lại trong **SoT và design
của F8**, và trong **`DESIGN.md`** với ghi chú "hợp đồng chốt từ F7".

### 4b. Điểm cần người duyệt xác nhận

SoT F7 đã chốt cả 10/10 OQ với "Chốt theo khuyến nghị" (bảng §12), bao gồm cả
điểm duy nhất SoT §10 để ngỏ cho file này (`json` vs `jsonb` — đã quyết định
`jsonb` ở §1b trên, có lập luận riêng, không phải một open question còn
treo). Một điểm **đã được sửa trong lúc review** (không phải open question,
đã chốt), và 1 điểm nhỏ ghi lại chỉ để người duyệt biết đã cân nhắc:

- **[Đã sửa]** `type` đụng STI convention của Rails theo nghĩa nghiêm trọng
  (crash mọi query khi có policy thật), không phải vô hại như bản nháp đầu
  tiên đánh giá — đã thêm `self.inheritance_column = "_type_disabled"` vào
  model (xem §1, code mẫu + ghi chú "[SỬA khi review]"). `slice-implementer`
  **bắt buộc** giữ dòng này khi viết `app/models/policy.rb`, đặt trước mọi
  validation/callback khác trong class.
- **Không thêm giới hạn độ dài ở tầng DB** (`limit:` trên cột `string`) cho
  `name`/`type` — giữ nguyên trade-off đã chấp nhận ở `docs/design/F2-db.md`
  §1b/`F5-db.md` §4b: enforce ở model (`length: { maximum: 100 }`), không
  `t.string :name, limit: 100` ở migration. Nếu người duyệt muốn siết ở tầng
  DB, nên làm đồng loạt cho mọi cột chuỗi định danh trong dự án
  (`users.email`, `devices.identifier`, `devices.name`, `groups.name`,
  `policies.name`, `policies.type`) trong 1 quyết định riêng, không lặt vặt
  từng feature.

### 4c. Rủi ro đã biết, đã chấp nhận (không cần quyết định, chỉ để không bị coi là bug)

- **Unique case-sensitive → `"Password Baseline"` và `"password baseline"`
  cùng tồn tại trong 1 org** (hệ quả trực tiếp của OQ-1, giống hệt rủi ro đã
  ghi nhận ở `Group.name` F5 §4c). Search `q` dùng `ILIKE` nên user gõ
  `"password"` sẽ thấy cả hai — không mâu thuẫn kỹ thuật, chỉ hơi lạ nếu ai
  cố tình tạo cặp tên như vậy.
- **Không có cột soft-delete/`deleted_at`** — SoT OQ-2 chốt không hard
  delete, chỉ có `status` toggle; vì không có hard delete nên cũng không cần
  bàn tới soft-delete. Policy không bao giờ biến mất khỏi bảng `policies`
  trong phạm vi F7/F8 (trừ khi 1 quyết định tương lai khác quyết định khác).
- **`Organization has_many :policies` chưa có `dependent:`** — cùng lý do đã
  áp dụng cho `has_many :devices`/`has_many :groups`: PRD không có màn hình
  xóa Organization nên hiện không có đường nào gọi `Organization#destroy`.
  Nếu tương lai có tính năng xóa Organization, phải quyết định một lượt cho
  cả `users`/`devices`/`groups`/`policies` (và `policy_assignments` khi F8
  tồn tại) trong 1 quyết định riêng, không quyết định lẻ ở đây.
- **`RecordNotUnique` → 422 là việc của API layer**, không phải DB layer
  (§1a) — nêu lại để `/design F7-api` không bỏ sót, giống cách các file
  DB trước đã bàn giao rủi ro tương tự.
- **`ArgumentError` khi gán `status` ngoài enum** (§1c) — API layer phải
  validate/convert trước khi gán, không để Rails tự raise ra ngoài thành
  500; đây là bàn giao tường minh, không phải thiếu sót của schema.
- **`:id` sai định dạng (A3)**: đã xác nhận ở `docs/design/F4-db.md` §4 rằng
  `find` với id phi số trên association raise `ActiveRecord::RecordNotFound`
  (không phải `StatementInvalid`) → `rescue_from` toàn cục của F0 xử lý
  thành 404. Không cần gì thêm ở schema F7.
- **`jsonb` không giữ nguyên thứ tự key/whitespace của input JSON gốc**
  (§1b điểm 2) — chấp nhận có chủ đích, không phải bug; nếu FE cần hiển thị
  lại y hệt định dạng user đã gõ trong modal sửa (vd để không "format lại"
  JSON khi mở lại form edit), đó là việc FE tự giữ state client-side từ lần
  fetch gần nhất, không phải việc DB "nhớ" định dạng gốc.

### 4d. Xác nhận Organization isolation ở tầng DB (không đủ, cần API layer bổ sung)

FK `policies.organization_id → organizations.id` (`null: false`) đảm bảo
**không có Policy nào tồn tại mà không thuộc 1 Organization**, nhưng **không
tự nó** tạo ra hành vi "404 khi org A đoán ID của org B" — đó là **kết quả
của tầng application**, không phải DB: mọi action phải query qua
`current_organization.policies.find(...)` (không bao giờ `Policy.find` trần)
để điều kiện `organization_id = current_organization.id` luôn có mặt trong
`WHERE`, khiến record thuộc org khác không nằm trong tập kết quả → Rails trả
`ActiveRecord::RecordNotFound` → 404 (không phải "tìm thấy nhưng bị chặn
403", tránh lộ sự tồn tại của resource, `CLAUDE.md` §4). **Cờ cho
`/design F7-api`**: đây là nghĩa vụ của controller/Pundit `PolicyPolicy::
Scope`, không phải điều schema/migration ở file này có thể tự đảm bảo — API
design không được bỏ sót việc luôn scope qua `current_organization`.
