---
feature_id: F9
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (approved by Claude on behalf of user, explicit delegation 2026-09-17)
date: 2026-09-17
---

# Thiết kế Database — F9

Nguồn: `docs/sot/F9-policy-resolution.md` (approved, §8/§10 đã dự kiến "không
thêm bảng/cột DB mới"), `PRD.md` §"Nghiệp vụ" → "Policy" (đoạn "Policy thực
áp dụng trên Device"), `CLAUDE.md` §4 (công thức hợp + 3 bước conflict
resolution + "hàm thuần của state hiện tại"), `api/db/schema.rb` hiện có
(`policy_assignments`, `group_memberships`, `policies` — tạo bởi F6/F7/F8),
`docs/design/F8-db.md` (thiết kế `policy_assignments`, đặc biệt §1b — cột
`updated_at` nào tham gia tie-break — và §3.1 — bảng index đầy đủ).

**Kết luận đầu tiên (khớp SoT §8, §10):** F9 **không có migration nào**. F9
là feature đọc-thuần (`R6` trong SoT: "service/API của F9 tuyệt đối không
tạo/sửa/xóa `policy_assignments`... — chỉ đọc"). Bản thiết kế này xác nhận:
(a) chính xác những bảng/cột hiện có mà F9 sẽ đọc, (b) câu query dự kiến của
service `Devices::PolicyResolver`, và (c) đối chiếu lại claim "index sẵn có
đủ dùng" ở SoT §10 bằng cách truy vết từng bước query qua đúng index nào —
kết luận: **xác nhận đúng, không cần thêm index mới** (chi tiết lý luận ở
§3). Không có điểm nào lệch so với SoT §8/§10 cần user quyết định lại.

## 1. Model / field / enum / relation

Không `Add`/`Change` nào. Bảng dưới liệt kê chính xác cột hiện có (theo
`api/db/schema.rb`, dòng 71-99) mà F9 sẽ đọc, kèm mục đích đọc trong service
resolution:

| Model | Field/Assoc | Kiểu | Ràng buộc hiện có | F9 đọc để làm gì | Add/Change/No-change |
|---|---|---|---|---|---|
| `PolicyAssignment` | `id` | `bigint` PK | — | Định danh candidate, không dùng trong logic resolution (chỉ để log/debug) | No-change |
| `PolicyAssignment` | `organization_id` | `bigint`, `null: false`, FK | — | Filter defense-in-depth (org-scope tường minh ngay trên bảng này, không suy ra qua join — xem §3, §4) | No-change |
| `PolicyAssignment` | `policy_id` | `bigint`, `null: false`, FK | — | Join sang `policies` để lấy `type`/`configuration`/`status`/`updated_at` | No-change |
| `PolicyAssignment` | `group_id` | `bigint`, nullable, FK | CHECK "đúng 1 trong 2" (cùng `device_id`) | **Nhánh "gán qua Group"**: `WHERE group_id IN (group_ids_của_device)` — group_id có giá trị ⇒ nguồn = "group" (badge "Từ group: &lt;tên&gt;") | No-change |
| `PolicyAssignment` | `device_id` | `bigint`, nullable, FK | CHECK "đúng 1 trong 2" | **Nhánh "gán trực tiếp"**: `WHERE device_id = device.id` — device_id có giá trị ⇒ nguồn = "direct" (R2: luôn thắng ứng viên group) | No-change |
| `PolicyAssignment` | `created_at`/`updated_at` | `datetime` | — | **Không đọc** — SoT §1b/`docs/design/F8-db.md` §1b đã chốt tie-break R3 dùng `policies.updated_at`, không phải `policy_assignments.updated_at`. Ghi rõ ở đây để tránh nhầm 2 cột `updated_at` khác bảng khi implement | No-change |
| `GroupMembership` | `device_id` | `bigint`, `null: false`, FK | index đơn `index_group_memberships_on_device_id` | Bước 1 của resolution: tìm tập `group_id` mà Device đang thuộc — `WHERE device_id = device.id` | No-change |
| `GroupMembership` | `group_id` | `bigint`, `null: false`, FK | unique `(group_id, device_id)` | `pluck(:group_id)` từ kết quả trên — input cho nhánh "gán qua Group" của `PolicyAssignment` | No-change |
| `Policy` | `id` | `bigint` PK | — | Tie-break R4 ("`id` nhỏ hơn thắng") + định danh policy thắng trong output | No-change |
| `Policy` | `type` | `string`, `null: false` | — | Khóa nhóm ứng viên (R1: "nhóm ứng viên theo `type`") | No-change |
| `Policy` | `configuration` | `jsonb`, `null: false` | — | So sánh nội dung để xác định "conflict thật" (R8: "≥2 configuration khác nhau"), so sánh bằng `==` trên Ruby Hash sau khi Postgres đã cast JSONB → Hash (không so sánh JSONB thô ở SQL) | No-change |
| `Policy` | `status` | `integer` enum (`active`/`inactive`), `null: false` | — | Filter R1 ("lọc `status: active` tại thời điểm tính") — filter ở **tầng Ruby**, không ở SQL (xem §3, lý do: cần giữ lại candidate `inactive` cho "Xem tất cả nguồn" — OQ-4) | No-change |
| `Policy` | `updated_at` | `datetime`, `null: false` | — | Tie-break R3 ("giữa nhiều Group, `updated_at` mới nhất thắng") | No-change |
| `Policy` | `organization_id` | `bigint`, `null: false`, FK | — | Không đọc trực tiếp trong resolution (Policy đã đến từ `PolicyAssignment` đã org-scope) — chỉ có ý nghĩa ở lớp Pundit/scope phía trên, không phải service | No-change |
| `Group` | `id`, `name` | — | — | Chỉ đọc khi candidate có `group_id` (nhánh group) — hiển thị badge "Từ group: &lt;tên&gt;" (A3) và tie-break hiển thị OQ-3 ("badge chính = `group_id` nhỏ nhất") | No-change |
| `Device` | `id`, `organization_id` | — | — | Input của service (đã org-scope qua `policy_scope(Device).find` ở controller, xem `docs/design/F9-api.md`) — không đọc field nào khác của Device trong resolution logic | No-change |

**Không migration nào ở F9** — xác nhận đúng SoT §8 ("Không thêm bảng/cột DB
mới").

## 2. Migration plan

- **Không có migration mới.** Không có bảng/cột/index nào cần tạo — F9 chỉ
  đọc dữ liệu đã tồn tại từ F6 (`group_memberships`), F7 (`policies`), F8
  (`policy_assignments`).
- **Backfill**: không áp dụng — không có bảng/cột mới.
- **Phá dữ liệu cũ**: không — F9 không ghi (R6), không chạm bất kỳ
  migration/schema nào.
- **Reversible**: không áp dụng.

## 3. Index / hiệu năng

### 3.1. Query plan dự kiến của `Devices::PolicyResolver`

Service nhận 1 `Device` đã org-scope (từ controller), chạy đúng 2 câu query
DB (cộng 2 câu preload N+1-safe), theo đúng công thức hợp ở SoT R1:

```ruby
# Bước 1 — tìm tập group Device đang thuộc.
# SQL: SELECT group_id FROM group_memberships WHERE device_id = $1
# Index dùng: index_group_memberships_on_device_id (đơn, đã có từ F6)
group_ids = GroupMembership.where(device_id: device.id).pluck(:group_id)

# Bước 2a — nhánh "gán trực tiếp".
# SQL: SELECT * FROM policy_assignments
#      WHERE organization_id = $1 AND device_id = $2
# Index dùng: index_policy_assignments_on_device_id (đơn, đã có từ F8)
#   — organization_id chỉ là filter phụ (defense-in-depth, §3.3), không cần
#   leading trong index vì device_id đã đủ chọn lọc (unique theo policy_id
#   nhưng không unique theo device_id — 1 Device có thể có nhiều
#   policy_assignment trực tiếp, mỗi cái 1 type khác nhau).
direct = current_organization.policy_assignments
  .where(device_id: device.id)
  .includes(:policy)

# Bước 2b — nhánh "gán qua Group" (chỉ chạy nếu group_ids không rỗng —
# tránh 1 query dư khi Device không thuộc group nào, A1).
# SQL: SELECT * FROM policy_assignments
#      WHERE organization_id = $1 AND group_id IN ($2, $3, ...)
# Index dùng: index_policy_assignments_on_group_id (đơn, đã có từ F8) —
#   Postgres dùng bitmap index scan gộp nhiều group_id trong 1 lần quét index.
via_group = group_ids.present? ?
  current_organization.policy_assignments
    .where(group_id: group_ids)
    .includes(:policy, :group)
  : []

candidates = direct.to_a + Array(via_group)
```

- **Bước 3 — nhóm & chọn thắng**: thuần Ruby, không đụng DB nữa — `group_by
  { |pa| pa.policy.type }`, filter `policy.status == "active"` (R1), sort
  theo R2 (`device_id.present?` trước) → R3 (`policy.updated_at` desc) → R4
  (`policy.id` asc). Toàn bộ field cần (`type`, `configuration`, `status`,
  `updated_at`, `id`) đã có sẵn trong bộ nhớ nhờ `includes(:policy)` ở bước
  2 — không có query nào phát sinh thêm ở bước 3.
- **`includes(:policy)`/`includes(:policy, :group)` là bắt buộc, không phải
  tối ưu tùy chọn**: nếu bỏ, mỗi lần service đọc `candidate.policy.type`
  (bước 3, chạy cho từng candidate) sẽ bắn 1 query `SELECT * FROM policies
  WHERE id = ?` riêng → N+1 kinh điển. Với `includes`, Rails preload đúng 1
  câu `SELECT * FROM policies WHERE id IN (...)` (gộp mọi `policy_id` distinct
  trong tập candidates) + 1 câu tương tự cho `groups` (chỉ chạy nếu
  `via_group` không rỗng) — tổng **cố định 2-4 query DB** cho toàn bộ
  resolution 1 Device, không phụ thuộc số candidate.
- **Lọc `status: active` không thực hiện trong SQL** (khác cách làm quen
  thuộc "WHERE status = 0"): SoT §8 yêu cầu output còn phải chứa **candidate
  bị loại** (kể cả `inactive`) cho "Xem tất cả nguồn" (OQ-4) — nếu filter ở
  SQL, dữ liệu `inactive` sẽ không bao giờ vào tay service để build
  `excluded_reason`. Đây là lý do có chủ đích, không phải thiếu sót — chi
  phí thêm (giữ vài dòng `inactive` trong Ruby) là không đáng kể vì tổng số
  candidate của 1 Device luôn nhỏ (§3.2).
- **Không có yếu tố ngẫu nhiên/thứ tự query nào ảnh hưởng kết quả** (A18):
  cả 2 query trên không có `ORDER BY` tường minh (không cần, vì bước chọn
  thắng ở Ruby luôn duyệt **toàn bộ** tập candidate rồi `sort_by`/`min_by`
  tường minh theo R2→R3→R4, không phải "candidate đầu tiên gặp") — đúng yêu
  cầu R5/A18 "hàm thuần của state hiện tại", không phụ thuộc thứ tự Postgres
  trả hàng.

### 3.2. Vì sao "index sẵn có đủ dùng" (SoT §10) là đúng — xác nhận lại, không chỉ tin theo

Truy vết từng bước ở §3.1 qua đúng index nào (đối chiếu `api/db/schema.rb`
dòng 33-99 và `docs/design/F8-db.md` §3.1):

| Query | Index dùng | Đã tồn tại từ | Loại scan dự kiến |
|---|---|---|---|
| `group_memberships WHERE device_id = ?` | `index_group_memberships_on_device_id` | F6 | Index scan, chọn lọc cao (unique theo `(group_id, device_id)` nên mỗi `device_id` chỉ khớp đúng số Group Device đang thuộc — thực tế nhỏ) |
| `policy_assignments WHERE device_id = ?` (+ `organization_id = ?` filter phụ) | `index_policy_assignments_on_device_id` | F8 | Index scan — 1 Device thường có rất ít policy_assignment trực tiếp (mỗi `type` tối đa 1 gán trực tiếp hợp lý theo nghiệp vụ, dù DB không ràng buộc cứng điều này) |
| `policy_assignments WHERE group_id IN (...)` (+ `organization_id = ?` filter phụ) | `index_policy_assignments_on_group_id` | F8 | Bitmap index scan gộp nhiều `group_id` — **quan trọng**: đây **không** phải quét theo `device_id` của Group (tức không phải "quét N device trong Group"), mà quét bảng `policy_assignments` (số dòng = số lần Policy được gán cho **Group**, không phải số Device trong Group) theo đúng `group_id` cụ thể — đúng khẳng định SoT §10 "chi phí không phụ thuộc kích thước Group" |
| Preload `policies WHERE id IN (...)` | PK index (mặc định) | F7 | Index scan theo PK, số `id` distinct = số candidate ≤ (số group Device thuộc + số gán trực tiếp), luôn nhỏ |
| Preload `groups WHERE id IN (...)` | PK index (mặc định) | F5 | Tương tự trên |

**Kết luận**: mọi bước trong query plan đều có index đơn-cột sẵn sàng, không
bước nào phải full table scan hay dùng index composite mà chỉ khớp được
prefix. **Không đề xuất thêm index mới** — khớp đúng dự kiến SoT §10, không
có điểm lệch cần user quyết định lại.

Lý do cốt lõi khiến F9 "rẻ" bất kể Group có 10.000 Device (SoT §10 nhắc
lại): cả 2 query chính ở bước 2 đều lọc theo **`group_id`/`device_id` của
chính PolicyAssignment**, tức đơn vị "1 dòng = 1 lần Policy được gán cho 1
Group hoặc 1 Device" — **không bao giờ** JOIN sang `group_memberships` để
liệt kê từng Device trong Group. Nếu 1 thiết kế sai lầm nào đó join theo
kiểu "lấy mọi Device cùng Group rồi lấy policy của Group" thì mới tỉ lệ
thuận với kích thước Group — F9 không làm vậy.

### 3.3. `organization_id` filter trên `policy_assignments` — defense-in-depth, không cần index riêng

Cả 2 query ở §3.1 thêm `organization_id = current_organization.id` (qua
`current_organization.policy_assignments`) dù về logic nghiệp vụ điều này
**luôn đúng sẵn**: `group_id` chỉ có thể trỏ tới Group cùng org với Device
(ràng buộc ở tầng ghi của F6 khi tạo `group_membership`/F8 khi gán Policy
cho Group/Device — không phải ràng buộc DB cứng, nhưng invariant nghiệp vụ
xuyên suốt dự án), và Device đã được lấy qua `policy_scope(Device)` ở
controller. Vẫn giữ filter này vì:

- Nhất quán với `CLAUDE.md` §4 "mọi controller action lấy resource qua
  `current_organization.<assoc>`" — áp dụng luôn cho query bên trong
  service, không chỉ controller.
- **Không cần index mới cho filter này**: Postgres đã dùng index
  `device_id`/`group_id` để thu hẹp tập hàng trước (rất nhỏ), rồi áp
  `organization_id = ?` như 1 filter rẻ trên tập hàng đã nhỏ đó (không quét
  lại toàn bảng) — không có lý do dùng index composite
  `(organization_id, policy_id)` (đã có từ F8, phục vụ mục đích khác:
  `assignments_count` ở Policy List) cho query này.

### 3.4. Số lượng candidate thực tế — vì sao không cần cache/batch

SoT §10 giả định số Group 1 Device thuộc là "hữu hạn, gán thủ công, thực tế
nhỏ" — không phải input do attacker/script kiểm soát tùy ý (khác PRD §"Cách
chấm" lo ngại về Group 10k Device, vốn là **số Device trong 1 Group**, không
phải **số Group 1 Device thuộc**). Với giả định này, tổng số candidate của 1
lần resolution (≈ số gán trực tiếp + Σ số Policy gán cho mỗi Group Device
thuộc) nằm trong khoảng vài chục, không cần bất kỳ `LIMIT`/phân trang/cache
nào ở tầng query — khớp quyết định "không cache" đã chốt ở SoT §3/§10.

## 4. Rủi ro / open question

- **Không có điểm nào lệch SoT §8/§10 cần quyết định lại** — sau khi truy
  vết chi tiết từng bước query (§3.1-3.2), xác nhận **không cần thêm index
  mới**. Đây là kết quả rà soát, không phải giả định chưa kiểm chứng.
- **Giả định nghiệp vụ không kiểm chứng lại ở tầng DB**: "Group chỉ chứa
  Device cùng org", "PolicyAssignment.group_id chỉ trỏ Group cùng org với
  policy" — không có FK/CHECK constraint nào ở DB ép buộc điều này (F6/F8
  chỉ validate ở tầng ghi, không có composite FK liên-bảng kiểu Postgres hỗ
  trợ). F9 **tin tưởng** invariant này đúng (được duy trì bởi F6/F8) thay vì
  tự kiểm tra lại `group.organization_id == device.organization_id` trong
  mỗi lần resolution — nếu invariant này từng bị vi phạm (bug ở F6/F8), F9 sẽ
  âm thầm hiện policy "lẫn org" thay vì báo lỗi rõ ràng. Đây là rủi ro chấp
  nhận được (không phải bug của F9), nhưng nêu ra để `/design F9-api` cân
  nhắc có cần assert phòng vệ (`raise` nếu phát hiện group khác org) hay
  không — quyết định đó không thuộc phạm vi file DB design này.
- **`policy.configuration` (JSONB) so sánh bằng Ruby `==` sau khi load**,
  không so sánh ở SQL (`configuration = configuration`) — đơn giản hơn, và
  số candidate luôn nhỏ (§3.4) nên chi phí so sánh Ruby không đáng kể; không
  cần index GIN trên `configuration` (không có query nào tìm kiếm *trong*
  JSONB, chỉ so sánh 2 giá trị đã có sẵn trong bộ nhớ).
- **Nếu giả định "số Group 1 Device thuộc luôn nhỏ" sai trong thực tế**
  (vd 1 Device bị gán vào hàng nghìn Group — ngoài dự đoán nghiệp vụ của
  SoT) — index đơn `group_id`/`device_id` vẫn hoạt động đúng, chỉ là
  `group_ids.present?` sẽ là mảng lớn hơn dự kiến khi dùng trong `WHERE
  group_id IN (...)` (Postgres vẫn xử lý được, không lỗi, chỉ chậm dần
  tuyến tính theo số Group, không theo số Device trong Group) — không phải
  lý do để thêm index mới ngay bây giờ, chỉ ghi nhận làm rủi ro production
  còn lại nếu về sau phát hiện giả định sai (đưa vào `DESIGN.md` nếu cần).
