# Plan — F6 Group membership tại scale (thêm/gỡ device, chịu 10.000 device, idempotent)

## Readiness
- SoT: `docs/sot/F6-group-membership.md` — **approved** (2026-09-16, Lai Bui
  <lai.bui.vtp@gmail.com>). §11 có **32 acceptance scenario** (canonical
  gherkin), §5.2 có **32 edge case A1–A32**, §12 có **8 OQ, cả 8 đã chốt**
  theo phương án khuyến nghị (không mở lại bất kỳ OQ nào).
- Design DB/API/Frontend: `docs/design/F6-db.md`, `docs/design/F6-api.md`,
  `docs/design/F6-frontend.md` (+ `F6-frontend-preview.html`) — **cả 3
  approved** (2026-09-16, cùng approver). Các quyết định đã chốt khi approve,
  plan này tuân theo, **không mở lại**:
  - `F6-db.md` — 1 migration `CreateGroupMemberships`; **không** counter
    cache `devices_count` (đã chốt SoT OQ-5); **không** validate org-khớp ở
    model `GroupMembership` (trách nhiệm service layer); sort key tab Thành
    viên = `devices.created_at DESC, devices.id DESC` (không phải
    `group_memberships.created_at`); **không** `belongs_to :group, touch:
    true`.
  - `F6-api.md` OQ-API-1 → **(a) tách 2 concern mới**
    (`device_serializable.rb`, `device_filterable.rb`) dùng chung
    `DevicesController`/`GroupDevicesController` ⇒ có task chạm code F2/F3/F4
    đã Done (T4) + gate regression bắt buộc (T5).
  - `F6-api.md` OQ-API-2 → **giữ `delete_all` + check `deleted_count`** ở
    `DELETE .../devices/:device_id` (siết hơn "chỉ `find_by`" của
    `F6-db.md` §4b, đóng đúng khoảng hở A16 dưới race thật sự đồng thời).
  - `F6-frontend.md` OQ-FE-1 → **giữ** nút Sửa/Xóa ở header Group Detail.
  - `F6-frontend.md` OQ-FE-2 → **hiện nhãn mờ** cho tab "Policies" (không
    render nút chết, không ẩn hẳn).
  - `F6-frontend.md` OQ-FE-3 → modal "+ Thêm vào group" ở Device Detail dùng
    `AsyncSearchSelect` **`mode="single"`** (không multi).
- Dependency (`docs/backlog.md` dòng 15: `F6` phụ thuộc `F5, F3`; dòng 28
  `F5 → F6`):
  - **F3 (Device create/edit)** — backlog ghi rõ "**Done**". Xác nhận bằng
    code: `api/app/models/device.rb`, `api/app/controllers/api/v1/
    devices_controller.rb`, `api/app/policies/device_policy.rb`,
    migration `20260915111940_create_devices.rb` đều tồn tại và đã có đủ
    validate/enum/`record_seen!`/`block_all_changes_when_retired`.
  - **F5 (Group CRUD)** — backlog **không** gắn nhãn "Done" bằng chữ (chỉ ghi
    `[plan](plan/F5-group-crud.md)`, khác cách F3/F4 ghi "— **Done**" ngay
    trong tên feature) — đây là **lệch nhỏ giữa văn bản `docs/backlog.md` và
    thực tế code**, không phải F5 chưa xong: xác nhận bằng code, F5 đã
    triển khai đầy đủ và khớp 100% với `docs/plan/F5-group-crud.md` — migration
    `20260916090000_create_groups.rb`, model `Group` (đúng cấu trúc dự kiến
    "carry-over cho F6" ở comment đầu file), `GroupsController` (4 action,
    đúng `destroy!` không phải `destroy`/`delete`), `GroupPolicy`
    (`index?/create?/update?/destroy?` = true, không có `show?`), route
    `resources :groups, only: [:index, :create, :update, :destroy]`, toàn bộ
    component/store/view FE (`GroupListView.vue`, `GroupFormModal.vue`,
    `ConfirmModal.vue`, `SearchInput.vue`, `stores/groups.ts`,
    `api/groups.ts`, `Paginatable` concern, `utils/queryParams.ts`,
    `types/ui.ts#PaginationMeta`) đều đã tồn tại đúng như F5 plan mô tả.
    → **Khuyến nghị**: cập nhật `docs/backlog.md` dòng F5 thêm "— **Done**"
    khi implement F6 xong (việc văn bản, không chặn plan này).
  - **Kết luận: cả 2 dependency đã xong về mặt code.** → **Sẵn sàng
    implement F6.**
- **Đọc chéo SoT ↔ 3 design ↔ code hiện có**: không phát hiện mâu thuẫn nào.
  3 điểm "vượt khỏi mô tả vắn tắt" mà `F6-frontend.md` §0 tự nêu (nút
  Sửa/Xóa header, row clickable ở Group List, tab Policies dạng nhãn mờ) đều
  đã được người duyệt xác nhận ở OQ-FE-1/2 — không phải mâu thuẫn mới, không
  cần dừng lại chờ quyết định. `Device` model hiện tại **chưa có**
  `Device::RETIRED_GROUP_MESSAGE` mà `F6-api.md` §2.4 tham chiếu — đây là
  hằng số **cần thêm mới** ở bước implement (T1), không phải mâu thuẫn thiết
  kế.

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | Migration `CreateGroupMemberships` đúng `F6-db.md` §2: `t.references :group, null: false, foreign_key: true, index: false`, `t.references :device, null: false, foreign_key: true, index: false`, `t.timestamps`, `add_index [:group_id, :device_id], unique: true`, `add_index :device_id` — **không** `on_delete: :cascade` ở cả 2 FK. Model `GroupMembership` mới (`belongs_to :group`, `belongs_to :device`, `validates :device_id, uniqueness: { scope: :group_id }`). Sửa `Group`: bỏ comment nợ carry-over, thêm `has_many :group_memberships, dependent: :delete_all; has_many :devices, through: :group_memberships`. Sửa `Device`: thêm `has_many :group_memberships; has_many :groups, through: :group_memberships` + hằng mới `RETIRED_GROUP_MESSAGE = "Thiết bị đã retired, không thể thay đổi group".freeze` (dùng ở T11 cho cả A8/A9/A27, cùng 1 hằng cho add lẫn remove) | Data | `api/db/migrate/<ts>_create_group_memberships.rb`, `api/app/models/group_membership.rb`, `api/app/models/group.rb`, `api/app/models/device.rb`, `api/db/schema.rb` (sinh ra) | — | Nền cho toàn bộ F6; A6, A7, A8, A9, A15, A20, A21, A24 |
| T2 | FactoryBot `factory :group_membership` — `association :group`, `association :device` (mặc định độc lập org — mỗi trait/spec tự đảm bảo `group.organization == device.organization` khi cần hợp lệ, và cố tình khác org khi test A2/A3/A10); không cần trait riêng (bảng chỉ có 2 FK) | Test | `api/spec/factories/group_memberships.rb` | T1 | — (hạ tầng cho T3, T15) |
| T3 | RSpec model spec `GroupMembership` — `belongs_to :group`/`:device` bắt buộc (Rails 8 default); uniqueness `device_id` scope `group_id` (tạo 2 lần cùng cặp → invalid ở record thứ 2 qua `save`, không raise); **không** validate org-khớp (ghi rõ trong spec bằng comment, không viết assertion "phải raise" vì đúng thiết kế F6-db.md §1b); `Group#group_memberships, dependent: :delete_all` — `group.destroy!` với ≥2 membership → 0 dòng `group_memberships` còn lại, **Device vẫn tồn tại** (A20); `Group#devices`/`Device#groups` qua `through:` trả đúng record (A24 — 1 device thuộc nhiều group) | Test | `api/spec/models/group_membership_spec.rb` | T1, T2 | A6, A7, A20, A21, A24; scenario "Xóa Group không để lại group_memberships mồ côi" |
| T4 | **(Chạm code F2/F3/F4 đã Done — refactor thuần, không đổi hành vi)** Tách 2 concern mới theo `F6-api.md` OQ-API-1(a): `DeviceSerializable` (di chuyển `serialize_device` từ `private` của `DevicesController`), `DeviceFilterable` (di chuyển `ENUM_ERROR`, `invalid_enum?`). `DevicesController` `include` cả hai, xóa 2 khối cũ. Giữ nguyên từng ký tự field/message hiện có (không thêm `groups` ở bước này — đó là T13) | API | `api/app/controllers/concerns/device_serializable.rb` (mới), `api/app/controllers/concerns/device_filterable.rb` (mới), `api/app/controllers/api/v1/devices_controller.rb` | — | Nền cho T11, T12, T13 |
| T5 | **Regression gate cho T4**: chạy lại **toàn bộ** `api/spec/requests/api/v1/devices_spec.rb` (+ `me_spec.rb`, `sessions_spec.rb`, `device_policy_spec.rb`, `device_spec.rb`) và `rubocop` — **không sửa file spec nào**; spec đỏ ⇒ sửa T4, không sửa spec | Test | `api/spec/requests/api/v1/devices_spec.rb` (chỉ chạy) | T4 | Bảo toàn acceptance F2/F3/F4 |
| T6 | `GroupPolicy` mở rộng — thêm `show?` (mới, `true`), `add_devices?` (mới, `true`), `remove_device?` (mới, `true`). Comment giải thích: 3 action **phải** được `authorize` tường minh (`authorize group, :show?` v.v.) ở mọi call site vì `GroupDevicesController#index/create/destroy` trùng tên action với `GroupsController#index/create/destroy` — dựa vào default suy từ `action_name` sẽ gọi nhầm `index?`/`create?`/`destroy?` (hôm nay đều `true` nên không lộ bug ngay, nhưng là bẫy chờ sẵn) | API | `api/app/policies/group_policy.rb` | — | Nền cho T8, T11; SoT §9, A32 |
| T7 | RSpec `group_policy_spec.rb` mở rộng — 3 action mới trả `true`; `Scope#resolve` không đổi (vẫn chỉ trả group của org user) | Test | `api/spec/policies/group_policy_spec.rb` | T6 | A32; SoT §9 |
| T8 | `GroupsController` — action `show` mới (`GET /groups/:id`): `policy_scope(Group).find(params[:id])` → `authorize group, :show?` → render `{ group: serialize_group(group) }`. Sửa `serialize_group` thêm keyword param `devices_count: group.devices.count` (default chỉ evaluate khi không truyền tường minh — giữ nguyên hành vi cho `create`/`update` hiện có, giờ tự động có thêm field `devices_count` qua default, chấp nhận 1 `COUNT` thêm/record theo `F6-api.md` §1) | API | `api/app/controllers/api/v1/groups_controller.rb` | T1, T6 | A1, A5; scenario "Xem chi tiết Group hiện đúng danh sách thành viên" (nửa header) |
| T9 | `GroupsController#index` — thêm 1 query gộp đếm `devices_count` theo trang (`GroupMembership.where(group_id: records.map(&:id)).group(:group_id).count`), truyền tường minh `devices_count: counts.fetch(g.id, 0)` vào `serialize_group` cho mỗi record — **cấm** `group.devices.count` trong vòng lặp (N+1) | API | `api/app/controllers/api/v1/groups_controller.rb` | T8 | Scenario "Danh sách Group hiện đúng số lượng device", "devices_count cập nhật ngay sau khi thêm và gỡ" |
| T10 | `routes.rb` — đổi `resources :groups, only: [ :index, :create, :update, :destroy ]` thành thêm `:show`; thêm khối `member do get "devices", to: "group_devices#index"; post "devices", to: "group_devices#create"; delete "devices/:device_id", to: "group_devices#destroy" end` (dùng `member`, không lồng `resources :devices`, để giữ param Group là `:id` đúng path SoT §8) | API | `api/config/routes.rb` | T8 | Nền cho T11, T14 |
| T11 | `Api::V1::GroupDevicesController` (mới) — `include Authenticatable, Paginatable, DeviceSerializable, DeviceFilterable`. **index**: `policy_scope(Group).find` → `authorize group, :show?` → `pagination_errors`/`filter_errors` (422) → `scope = group.devices.merge(current_organization.devices)` + filter platform/status + `.order(created_at: :desc, id: :desc)` (đúng chốt F6-db.md §4a) → `count` trước limit/offset → render `{devices, meta}` (không merge `groups` mỗi dòng — cấm N+1). **create**: group qua `policy_scope` trước khi đọc `device_ids` (A3) → `authorize group, :add_devices?` → validate `raw_ids.is_a?(Array) && present?` (422 A13) → cap `MAX_DEVICE_IDS_PER_REQUEST = 500` đo trên `raw_ids.size` trước lọc (422 A12) → coerce + lọc org qua `current_organization.devices.where(id: coerced_ids).pluck(:id)` (A10, lọc âm thầm) → `valid_ids.empty?` → 422 (A11) → atomic reject nếu có `status: :retired` trong `valid_ids` (`order(:identifier)` để message xác định, dùng `Device::RETIRED_GROUP_MESSAGE`, field `base`) → 422 chặn toàn bộ (A8/A27) → đếm `existing_member_ids` trước ghi → `GroupMembership.upsert_all(rows, unique_by: [:group_id, :device_id], on_duplicate: :skip)` (1 câu lệnh, A15 race-safe) → render `200 { added_count, devices_count: group.devices.count }` (phẳng, không bọc). **destroy**: group qua `policy_scope` → `authorize group, :remove_device?` → `GroupMembership.find_by(group_id:, device_id:)` → nil → 404 (A14) → check `membership.device.retired?` trước xóa → 422 `base: Device::RETIRED_GROUP_MESSAGE` (A9/A27), **không xóa** → `GroupMembership.where(id: membership.id).delete_all` → `deleted_count.zero?` → 404 (A16, siết theo OQ-API-2) → `head :no_content`. **Không** `rescue_from RecordNotUnique` (dead code — `upsert_all`/`delete_all` không raise) | API | `api/app/controllers/api/v1/group_devices_controller.rb` | T1, T4, T6, T10 | A2–A4, A6–A17, A20 (gián tiếp qua Group#destroy có sẵn), A24, A27, A30–A32 |
| T12 | `DevicesController#index` — thêm filter `q` (optional): `scope.where("identifier ILIKE :q OR name ILIKE :q", q: "%#{Device.sanitize_sql_like(search_term)}%") if search_term.present?` chèn vào `filtered_scope` (giữa platform/status và order); `search_term = params[:q].to_s.strip`; blank/không gửi = không lọc, **không có nhánh 422** cho `q`. **Không** loại device đã là thành viên của group đích (SoT OQ-7) | API | `api/app/controllers/api/v1/devices_controller.rb` | T4 | A22; scenario "Thêm Device vào Group từ modal search theo identifier", "Modal search Device không khớp" |
| T13 | `DevicesController#show` — thêm field `groups: device.groups.merge(current_organization.groups).order(:name).map { |g| { id: g.id, name: g.name } }` vào response (merge vào `serialize_device(device)`); giữ nguyên `record_seen!`; **chỉ** `show` có field này, `index`/`create`/`update` không đổi | API | `api/app/controllers/api/v1/devices_controller.rb` | T1, T4 | A24, A25; scenario "Device Detail hiển thị đúng danh sách Group đang thuộc", "Device chưa thuộc Group nào hiện đúng trạng thái rỗng thật" |
| T14 | RSpec `groups_spec.rb` mở rộng — **show**: 200 đúng 5 field (id/name/description/devices_count/created_at/updated_at), `devices_count` đúng khi group có N membership (tạo trực tiếp qua `create_list(:group_membership, n, group:)`, không qua API), org khác/không tồn tại/`"abc"` → 404 (A1, A5); **index/create/update**: `devices_count` xuất hiện ở mọi response, `create` → `devices_count: 0`, batch-count không N+1 (assert số query bằng kiểu `ActiveRecord::QueryRecorder` hoặc kiểm tra không tăng tuyến tính theo số group/trang) | Test | `api/spec/requests/api/v1/groups_spec.rb` (mở rộng, không sửa case F5 cũ) | T8, T9, T10 | A1, A5; scenario "Danh sách Group hiện đúng số lượng device", "devices_count cập nhật ngay" |
| T15 | RSpec request spec mới `group_devices_spec.rb` — org-isolation: `GET /groups/:id` (đã ở T14, không lặp), `GET .../devices` org khác → 404 không lộ list (A2), `POST .../devices` group org khác → 404 **và không tạo membership** (A3), `DELETE .../devices/:device_id` group org khác → 404 **và device vẫn còn thành viên** (A4), id sai định dạng/không tồn tại → 404 không 500 (A5). Business rule: thêm device đã là thành viên → 200 idempotent, count không đổi (A6); thêm mix mới+cũ → count chỉ tăng theo mới (A7); thêm có retired trong batch → 422 chặn toàn bộ kể cả device hợp lệ khác, message liệt kê đúng identifier theo `order(:identifier)` (A8); gỡ device retired → 422, vẫn còn thành viên (A9); `device_ids` lẫn org khác/không tồn tại → lọc âm thầm, id hợp lệ khác vẫn thêm, **assert org kia không có gì thay đổi** (A10); toàn bộ không hợp lệ sau lọc → 422 field `device_ids` (A11); vượt cap 500 → 422, không thêm gì (A12, dùng `create_list(:device, 501)` id thật, không phải giả); `device_ids` rỗng/thiếu/sai kiểu (string, object, null) → 422 field `device_ids` (A13); gỡ device không phải thành viên → 404 (A14). Race: 2 thread/2 connection gọi `POST` cùng cặp gần đồng thời → cả 2 `200`, DB chỉ có đúng 1 dòng (A15); 2 thread gọi `DELETE` cùng cặp → đúng 1 `204`/thành công, còn lại `404`, không `500` (A16 — ghi chú rủi ro: DB test transaction pool có thể tự nhiên serialize phần lớn trường hợp, viết test theo tinh thần `F6-api.md` OQ-API-2 dù không luôn bắt được race thật). Scale: seed 10.000 `group_memberships` cho 1 group bằng `GroupMembership.insert_all` (bulk, không qua callback — nhanh, đủ cho test hạ tầng) → `GET .../devices?page=1` → 200, tối đa 20 dòng, `meta.total_count == 10000` (A17). Empty: filter không khớp → mảng rỗng (A18); group chưa có device → mảng rỗng (A19, phân biệt ở FE không phải API). Destroy Group cascade: `DELETE /groups/:id` group có 10k membership → tất cả `group_memberships` bị xóa cùng transaction, device không bị xóa (A20 — request-level, bổ sung cho T3's model-level); sau đó device không còn hiện group đó (A21 — qua `GET /devices/:id`). Auth: không token → 401 (A30) cho cả 4 endpoint mới + `q`. `organization_id` gửi kèm bị bỏ qua (A31). RBAC không phân role (A32) | Test | `api/spec/requests/api/v1/group_devices_spec.rb` (mới) | T1, T2, T11 | A2–A21, A24, A27, A30–A32; toàn bộ scenario liên quan `POST`/`DELETE .../devices`, xóa Group cascade, race |
| T16 | RSpec `devices_spec.rb` mở rộng — `q` khớp `identifier` **hoặc** `name`, không phân biệt hoa/thường, org-scoped; `q` không khớp → mảng rỗng (A22); `q = "100%"`/`q = "_"` không match bừa (kiểm chứng `sanitize_sql_like`); `q = "' OR 1=1 --"` không leak/không 500 (kiểm chứng named placeholder — cùng lớp rủi ro `F5-db.md` đã cảnh báo cho Group search); `q` rỗng/thiếu → không lọc, hành vi y hệt F2. `GET /devices/:id` trả `groups: [{id, name}]` đúng, org-scoped (`.merge(current_organization.groups)`), rỗng khi chưa thuộc group nào (A25), không N+1 (1 device, 1 query join) | Test | `api/spec/requests/api/v1/devices_spec.rb` (mở rộng, không sửa case F2/F3/F4 cũ) | T12, T13 | A22, A24, A25; scenario liên quan search modal, "Device Detail hiển thị đúng danh sách Group" |
| T17 | `db/seeds.rb` — thêm `GroupMembership.find_or_create_by!(group:, device:)` liên kết vài Group/Device có sẵn cho mỗi Organization (idempotent, chạy lại không tạo trùng — nhất quán cách F5 seed Group). **Không** seed 10.000 dòng ở đây (dữ liệu quy mô lớn là việc của `insert_all` trong T15's spec, không phải seed dev/demo) — chỉ đủ để walkthrough README có nội dung thật cho Group Detail | Data | `api/db/seeds.rb` | T1 | Chạy seed nhiều lần không tạo trùng; nền cho README walkthrough |
| T18 | `types/group.ts` — thêm `devices_count: number` vào `Group`; thêm `GroupDevicesQueryParams { page: number; platform?: DevicePlatform; status?: DeviceStatus }` (tách khỏi `GroupQueryParams`, đúng `F6-frontend.md` §3.1). `GroupQueryParams` không đổi | UI | `web/src/types/group.ts` | — | Hợp đồng cho T23, T31, T33 |
| T19 | `types/device.ts` + `api/devices.ts` — thêm `q?: string` vào `DeviceQueryParams`; thêm `DeviceGroupRef { id: number; name: string }`; thêm `DeviceDetail extends Device { groups: DeviceGroupRef[] }`; `api/devices.ts` đổi `fetchDevice` trả `DeviceDetailResponse { device: DeviceDetail }` (đổi type, không đổi logic gọi). `fetchDeviceList`/`DeviceQueryParams` (tham số) có thêm `q?`, response `DeviceListResponse` **không đổi shape** | UI | `web/src/types/device.ts`, `web/src/api/devices.ts` | — | Hợp đồng cho T27, T29, T34; nền cho T39 |
| T20 | `api/groups.ts` — thêm `fetchGroup(id): Promise<GroupResponse>` (`GET /api/v1/groups/:id`), dùng lại `apiClient` có sẵn. Không đổi 4 hàm hiện có | UI | `web/src/api/groups.ts` | — | Hợp đồng cho T31 |
| T21 | `api/group-memberships.ts` (mới) — `AddGroupDevicesResponse { added_count, devices_count }`; `fetchGroupDevices(groupId, params): Promise<DeviceListResponse>` (GET); `addGroupDevices(groupId, deviceIds): Promise<AddGroupDevicesResponse>` (POST, body phẳng `{device_ids}`); `removeGroupDevice(groupId, deviceId): Promise<void>` (DELETE, 204 không đọc `response.data`). File riêng, không gộp vào `api/groups.ts`/`api/devices.ts` (đối xứng 1 controller BE ↔ 1 file FE, đúng `F6-frontend.md` §3.4) | UI | `web/src/api/group-memberships.ts` (mới) | — | Hợp đồng cho T23, T29, T34 |
| T22 | `stores/groups.ts` — thêm field `lastListLocation: string \| null` vào `GroupsState`, khởi tạo `null` trong `state()`. Không đổi action nào | UI | `web/src/stores/groups.ts` | — | Nền cho T33 ("◀ Quay lại danh sách" của `GroupDetailView`) |
| T23 | `stores/group-memberships.ts` (mới) — state `{ members: Device[], meta: PaginationMeta \| null, loading, error, lastRequestId }`. `fetchMembers(groupId, params)`: cùng khuôn `fetchGroups`/`fetchDevices` (guard `lastRequestId`, giữ `members`/`meta` cũ khi lỗi, fallback message). `addMembers(groupId, deviceIds)`/`removeMember(groupId, deviceId)`: không đụng `loading`/`error` cấp store, `throw` nguyên lỗi lên caller (cùng nguyên tắc `createGroup`/`deleteGroup`) | UI | `web/src/stores/group-memberships.ts` (mới) | T18, T21 | Nền cho T27, T31, T38 |
| T24 | `styles/components.css` — thêm 4 nhóm rule đã chốt ở `F6-frontend.md` §5: `.tabs`/`.tab-item`/`.tab-item.active`/`.tab-item.future` (tab header Group Detail); `.chip-list`/`.chip`/`.chip button` (chip lựa chọn `AsyncSearchSelect`); `.async-search`/`.async-search-dropdown`/`.async-search-option`/`.async-search-option:hover`/`.async-search-option .sub`/`.async-search-empty`/`.async-search-loading`/`.async-search-hint`; `.inline-confirm` (hàng gỡ inline tab Thành viên). Không token màu mới (dùng lại `var(--accent)`/`var(--danger)`/`var(--border)`) | UI | `web/src/styles/components.css` | — | Nền cho T25, T31 |
| T25 | `components/AsyncSearchSelect.vue` (mới, dùng chung — build lần đầu ở F6, viết đủ tổng quát cho F7/F8 tái dùng) — props theo đúng interface `F6-frontend.md` §2.4 (`search: (query) => Promise<AsyncSearchSelectOption[]>`, `mode`, `placeholder`, `debounceMs=300`, `minChars=1`, `modelValue`, `testId`); debounce + cleanup copy cơ chế `SearchInput.vue` (`timer`/`onUnmounted(cancelPending)` — không import lại `SearchInput` vì gắn cứng nút "Xóa tìm kiếm"); không gọi API khi `query.trim().length < minChars` (hint "Nhập từ khóa để tìm..."); loading spinner + guard request cũ về muộn (local `lastRequestId`, không qua Pinia); empty "Không tìm thấy"; chọn multiple = toggle theo `id` không tự đóng dropdown, chọn single = thay thế + tự đóng; chip list dưới input (cả 2 mode) với nút "×"; không cap số lượng chọn ở FE; không phân trang trong dropdown (luôn trang 1); không điều hướng bàn phím (ghi vào Rủi ro) | UI | `web/src/components/AsyncSearchSelect.vue` (mới) | T24 | A22, A23 |
| T26 | Vitest `AsyncSearchSelect.spec.ts` — gõ dưới `minChars` không gọi `search`; gõ đủ, debounce 300ms (fake timers) rồi mới gọi `search` đúng 1 lần với query đã trim; loading state trong lúc `search()` đang chạy; response của request cũ về muộn hơn bị bỏ qua (guard nội bộ); empty → "Không tìm thấy" khi mảng rỗng; `mode="multiple"`: click toggle thêm/bớt trong `modelValue`, emit `update:modelValue`, dropdown không tự đóng; `mode="single"`: click thay thế hoàn toàn `modelValue`, dropdown tự đóng; chip "×" gỡ đúng phần tử khỏi `modelValue` (cả 2 mode); unmount giữa lúc debounce không gọi `search` (timer cleared) | Test | `web/src/components/__tests__/AsyncSearchSelect.spec.ts` | T25 | A22, A23 |
| T27 | `components/GroupMemberAddModal.vue` (mới) — wrapper mỏng `FormModal` bọc `AsyncSearchSelect` (`mode="multiple"`). Props `{ groupId: number }`. `search = (q) => fetchDeviceList({ q, page: 1 }).then(r => r.devices.map(toOption))` (dùng thẳng `api/devices.ts` đã có, `q` mới ở T19); nút submit (`submitLabel` của `FormModal`) disable khi `selected.length === 0` hoặc `submitting`; submit → `groupMembershipsStore.addMembers(groupId, selected.map(o => o.id))`; `200` → `emit('added', {addedCount, devicesCount})`, modal không tự đóng (parent điều khiển); `422` → `baseError` từ `extractFormErrors` (banner trong modal, không đóng, giữ nguyên `selected` — A8/A11/A12/A13 đều render vào 1 banner vì không có input field riêng cho `device_ids`); `500`/network → banner "Có lỗi xảy ra, vui lòng thử lại."; Hủy/Escape/click nền → `emit('cancel')` | UI | `web/src/components/GroupMemberAddModal.vue` (mới) | T19, T23, T25 | Scenario "Thêm Device vào Group từ modal search theo identifier", "Modal search Device không khớp" |
| T28 | Vitest `GroupMemberAddModal.spec.ts` — gõ từ khóa → gọi `fetchDeviceList` với `q` đúng; chọn nhiều → submit gọi `addMembers` với đúng mảng id; nút submit disable khi chưa chọn; 200 → emit `added` đúng payload; 422 (retired-batch giả lập) → banner hiện, modal không đóng (không emit `cancel`/`added`), `selected` giữ nguyên; 500 → banner chung, modal không đóng | Test | `web/src/components/__tests__/GroupMemberAddModal.spec.ts` | T27 | Đồng bộ acceptance A8/A11–A13 phía UI |
| T29 | `components/DeviceGroupAddModal.vue` (mới) — cùng khuôn T27 nhưng `mode="single"`, chiều ngược lại. Props `{ deviceId: number, deviceIdentifier: string }`. `search = (q) => fetchGroupList({ q, page: 1 }).then(r => r.groups.map(toOption))` (tái dùng `q` đã có từ F5, không đổi `api/groups.ts`); nút "Thêm" (không phải "Thêm đã chọn") disable khi `selected.length === 0`; submit → gọi thẳng `addGroupDevices(selected[0].id, [deviceId])` từ `api/group-memberships.ts` (không dựng endpoint riêng, không qua store — đúng nguyên văn SoT §4D bước 1); `200` → `emit('added')`; `404` (group vừa bị xóa giữa search/submit) → `baseError = 'Group đã chọn không còn tồn tại hoặc đã bị xóa.'`, **không đóng modal**; `422` (A27) → `baseError` từ `extractFormErrors`; `500`/network → banner chung | UI | `web/src/components/DeviceGroupAddModal.vue` (mới) | T21, T25 | Scenario "Thêm Group cho Device từ trang Device Detail" |
| T30 | Vitest `DeviceGroupAddModal.spec.ts` — chọn 1 group → submit gọi `addGroupDevices(groupId, [deviceId])`; nút "Thêm" disable khi chưa chọn; 200 → emit `added`; 404 → banner đúng câu, modal không đóng; 422 → banner từ `extractFormErrors`, modal không đóng; 500 → banner chung | Test | `web/src/components/__tests__/DeviceGroupAddModal.spec.ts` | T29 | A27 (phía UI) |
| T31 | `views/groups/GroupDetailView.vue` (mới) — **Header**: `watch(() => route.params.id, loadHeader, { immediate: true })` gọi `fetchGroup` (T20) vào `ref` cục bộ (không qua Pinia, đúng quyết định F4); 404 → toàn trang "Không tìm thấy Group" + nút quay lại (`groupsStore.lastListLocation ?? '/groups'`, dùng field T22); lỗi khác → `ErrorState` chỉ khối header; nút "Sửa" mount `GroupFormModal` (tái dùng nguyên, không sửa) `mode="edit"`, `@saved` → `loadHeader()`; nút "Xóa" mount `ConfirmModal` (tái dùng nguyên) với message đúng công thức `Xóa group "${name}" sẽ gỡ toàn bộ liên kết với ${devices_count} device...`, `204` → toast + `router.push(lastListLocation ?? '/groups')`. **Tab Thành viên**: URL nguồn chân lý `?page=&platform=&status=`; `watch(activeQuery, () => membershipsStore.fetchMembers(groupId, activeQuery), {immediate:true})` (store T23); `FilterBar` platform/status tái dùng `DEVICE_PLATFORMS`/`DEVICE_STATUSES`; `DataTable` 4 cột (Identifier/Name/Platform/Status) + `onRowClick` → `/devices/:id`; cột action "Gỡ khỏi group" → confirm **inline** (không `ConfirmModal`, đúng SoT §4C) → `removeGroupDevice` (T21) → `204` → `Promise.all([loadHeader(), loadMembers()])`; `404` → cùng refetch cả header (dây chuyền nếu Group đã bị xóa); `422` → toast lỗi, không refetch; nút "+ Thêm device vào group" mount `GroupMemberAddModal` (T27), `@added` → đóng modal + toast + về trang 1 + refetch header; empty A18 vs A19 phân biệt bằng `hasActiveFilter`; tab "Policies" nhãn tĩnh mờ `class="tab-item future"`, không `@click` (OQ-FE-2) | UI | `web/src/views/groups/GroupDetailView.vue` (mới) | T18, T20, T22, T23, T24, T27 | Toàn bộ nhóm scenario "Xem chi tiết Group...", "Thêm Device vào Group...", "Gỡ Device khỏi Group...", A17–A19, A28, A29 |
| T32 | `router/index.ts` — thêm `{ path: '/groups/:id', name: 'group-detail', component: GroupDetailView, props: true }` (cùng khuôn `device-detail`, component tự đọc `route.params.id` qua `useRoute()`). Guard `beforeEach` hiện có tự áp dụng, không sửa | UI | `web/src/router/index.ts` | T31 | Nền điều hướng cho mọi scenario Group Detail |
| T33 | `views/groups/GroupListView.vue` — trả nợ F5 theo `F6-frontend.md` §2.0: thêm cột `devices_count` (`{ key: 'devices_count', label: 'Số device', value: (row) => String(row.devices_count) }` giữa `description` và `actions`); truyền `:on-row-click="viewDetail"` cho `DataTable`, bọc cột `actions` bằng `<span @click.stop>`; `rowActions` thêm item thứ 3 "Xem chi tiết" (`testId: 'group-action-view'`); `confirmMessage` đổi thành đúng nguyên văn có số N (`Xóa group "${name}" sẽ gỡ toàn bộ liên kết với ${devices_count} device và policy đang gán cho group này. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.`); thêm `watch(() => route.fullPath, fullPath => { store.lastListLocation = fullPath }, {immediate:true})` | UI | `web/src/views/groups/GroupListView.vue` (sửa) | T18, T22 | Scenario "Xem chi tiết Group từ danh sách Group", "Danh sách Group hiện đúng số lượng device" |
| T34 | `views/devices/DeviceDetailView.vue` — thay khối "Groups đang thuộc" tĩnh bằng thật: `device.value.groups` (từ `DeviceDetail`, T19) render `<ul data-testid="device-detail-groups-list">`/`<li data-testid="device-detail-group-row">` (`RouterLink` tới `/groups/:id` + nút "×"), giữ nguyên `placeholder-box`/testid cũ khi rỗng (A25); nút "+ Thêm vào group" mount `DeviceGroupAddModal` (T29), ẩn khi `device.status === 'retired'` (A26, cùng điều kiện nút "Sửa" có sẵn); nút "×" mỗi dòng → `ConfirmModal` (tái dùng, khác tab Thành viên vì danh sách ngắn) → `removeGroupDevice` (T21, dùng `groupId` của dòng đó) → `204` → `load()` refetch toàn device; `404` → `load()`; `422`/`500` → toast, không refetch; banner retired có sẵn (F4) chỉ thêm điều kiện ẩn 2 nút | UI | `web/src/views/devices/DeviceDetailView.vue` (sửa) | T19, T21, T29 | A24–A27; scenario "Device Detail hiển thị đúng danh sách Group", "Thêm/Gỡ Group cho Device từ Device Detail", "Device retired ẩn toàn bộ thao tác group" |
| T35 | Vitest `GroupDetailView.spec.ts` (mới) — header: mount đọc `route.params.id`, fetch đúng; 404 → "Không tìm thấy Group" + nút quay lại đúng `lastListLocation`; lỗi khác → `ErrorState` chỉ header, không kéo sập tab; Sửa/Xóa mount đúng modal, `204` xóa → điều hướng `/groups`. Tab Thành viên: URL → fetch đúng params; đổi filter → reset trang 1, giữ trang → giữ filter; empty A18 vs A19 hiện đúng nội dung + CTA đúng chỗ; gỡ inline: bấm → hiện "Có, gỡ"/"Hủy" không mở modal to, chưa gọi API; "Hủy" → không request; "Có, gỡ" 204 → toast + refetch cả header lẫn tab; 422 → toast, dòng còn nguyên; "+ Thêm device vào group" mở `GroupMemberAddModal`, `@added` → về trang 1 + refetch header; lỗi tải tab (A28) → `ErrorState` riêng khối tab, header vẫn hoạt động; tab "Policies" là `<span>` tĩnh, không `@click` | Test | `web/src/views/groups/__tests__/GroupDetailView.spec.ts` (mới) | T31, T32 | A17–A19, A28, A29; phần lớn nhóm scenario Group Detail |
| T36 | Vitest `GroupListView.spec.ts` mở rộng — cột `devices_count` render đúng giá trị; click dòng → `router.push('/groups/:id')`; bấm "⋯" không điều hướng (`@click.stop` hoạt động); menu ⋯ giờ có 3 item bao gồm "Xem chi tiết"; message confirm xóa chứa đúng số N; `lastListLocation` được set khi mount/đổi URL | Test | `web/src/views/groups/__tests__/GroupListView.spec.ts` (mở rộng, không sửa case F5 cũ) | T33 | Scenario "Xem chi tiết Group từ danh sách Group", "Danh sách Group hiện đúng số lượng device" |
| T37 | Vitest `DeviceDetailView.spec.ts` mở rộng — khối "Groups đang thuộc" render danh sách thật (không còn tĩnh); rỗng vẫn giữ testid cũ; nút "+ Thêm vào group" mở `DeviceGroupAddModal`, thêm thành công → `load()` refetch; nút "×" mở `ConfirmModal`, xóa thành công → `load()`; device `retired` → ẩn cả nút "+ Thêm vào group" lẫn mọi nút "×", danh sách vẫn hiển thị | Test | `web/src/views/devices/__tests__/DeviceDetailView.spec.ts` (mở rộng, không sửa case F4 cũ) | T34 | A24–A27; scenario liên quan Device Detail |
| T38 | Vitest `stores/__tests__/group-memberships.spec.ts` (mới) — `fetchMembers` set `loading`/ghi `members`+`meta`/xóa `error`; lỗi → `error` có fallback, `members`/`meta` cũ **không** bị xóa; guard `lastRequestId` (response cũ về sau không đè kết quả mới); `addMembers`/`removeMember` `throw` lỗi lên caller, không đụng `loading`/`error`/`members` cấp store | Test | `web/src/stores/__tests__/group-memberships.spec.ts` (mới) | T23 | Nền cho A28, A29 |
| T39 | **Regression gate FE cho T19/T22/T33/T34** (chạm file F2/F4/F5 đã Done): chạy lại toàn bộ `vitest` (đặc biệt `DeviceListView.spec.ts`, `DeviceDetailView.spec.ts` cũ, `DeviceFormModal.spec.ts`, `GroupListView.spec.ts` cũ, `GroupFormModal.spec.ts`, `ConfirmModal.spec.ts`, `stores/devices.spec.ts`, `stores/groups.spec.ts`) + `eslint` + `vue-tsc` — **không sửa spec cũ**; spec đỏ ⇒ sửa code T19/T22/T33/T34, không sửa spec | Test | `web/src/**/__tests__/*` (chỉ chạy, không sửa) | T19, T22, T33, T34 | Bảo toàn acceptance F2/F3/F4/F5 |

Quy tắc chia task giữ nguyên theo `docs/plan/F5-group-crud.md`: Data trước API
cần nó; API trước UI gọi nó; mỗi test (RSpec/Vitest) là task riêng, phụ thuộc
đúng task code nó kiểm tra. **Không** có task riêng cho `types/group.ts` (T18)
/ `types/device.ts` (T19 gộp với `api/devices.ts` vì cùng 1 thay đổi hình
dạng response) — cover gián tiếp qua T35/T36/T37 (cùng lý do F5 đã áp dụng).
Golden rule #3 (viết `.feature` trước) và Gate #4 (Playwright) **vẫn tạm
ngưng** theo đúng tiền lệ F5 — Done của F6 tính theo 3 gate: `rubocop`,
`rspec`, `eslint + vitest`. **Không có task nào** cho
`features/f6-group-membership.feature`/step definitions Playwright.

## Sơ đồ wave

```text
Wave 1 (song song): T1, T4, T6, T18, T19, T20, T21, T22, T24
        │
        ▼
Wave 2 (song song): T2, T5, T7, T8, T12, T13, T17, T23, T25, T33
        │
        ▼
Wave 3 (song song): T3, T9, T10, T16, T26, T27, T29, T36, T38
        │
        ▼
Wave 4 (song song): T11, T14, T28, T30, T31, T34
        │
        ▼
Wave 5 (song song): T15, T32, T37, T39
        │
        ▼
Wave 6: T35
```

Ghi chú: BE (T1–T17) và FE (T18–T39) phần lớn độc lập về file ở 3 wave đầu —
có thể chạy 2 nhánh song song. Đường găng thực chất là 2 nhánh hội tụ muộn:
BE `T1 → T6 → T10 → T11 → T15` (test hoàn chỉnh nhất, cần route + controller
+ dữ liệu thật) và FE `T24 → T25 → T27 → T31 → T32 → T35` (view chính cần
đủ cả component dùng chung, store, css). `T39` (gate FE) và `T15`
(request spec BE lớn nhất) là 2 điểm cần chạy sau cùng của mỗi nhánh trước
khi coi F6 là Done.

## Rủi ro / open question

- **Bẫy #1 — `upsert_all` bỏ qua toàn bộ validate/callback Rails.** Đây là
  lý do unique index DB ở T1 là **bắt buộc**, không phải tùy chọn — nó là lớp
  bảo vệ duy nhất thực sự chạy trên code path chính (`POST .../devices` của
  T11). Nếu implementer "for chắc" viết thêm `validates ... uniqueness` mạnh
  hơn ở model rồi tưởng nó bảo vệ được path `upsert_all` — sai, đã ghi rõ ở
  `F6-db.md` §1b, nhắc lại ở T1/T11 để không ai lặp lại nhầm lẫn này.
- **Bẫy #2 — atomic reject cho retired phải chặn TOÀN BỘ batch**, không phải
  partial success. T11 bước retired-check phải chạy **trước** `upsert_all`
  và dừng hẳn (return sớm) nếu có bất kỳ device retired nào trong
  `valid_ids` — kể cả khi phần lớn `device_ids` khác hợp lệ (A8). Đảo ngược
  logic này (bỏ qua device retired, thêm phần còn lại) là sai theo OQ-3 đã
  chốt, dù nghe "thân thiện" hơn với user.
- **Bẫy #3 — `destroy!`/`delete_all` chọn đúng chỗ, đừng lẫn.** `Group.destroy!`
  (đã có từ F5, không sửa) dùng để trả nợ `dependent: :delete_all` cho
  `group_memberships` (A20) — **không đụng T11's `destroy` action**, vốn
  **phải** dùng `GroupMembership.where(id: membership.id).delete_all` (không
  phải `membership.destroy!`) để lấy `deleted_count` thật, phục vụ đúng A16
  dưới race (OQ-API-2). Nhầm lẫn 2 pattern này (vd dùng `destroy!` ở T11) làm
  mất khả năng phát hiện race, nhưng test thông thường (không có race) vẫn
  xanh — bug âm thầm.
- **Bẫy #4 — cap 500 phải đo trên `raw_ids.size`, trước khi lọc org/coerce.**
  Nếu đo trên `valid_ids.size` (sau khi đã lọc), 1 request 100.000 phần tử
  toàn id rác vẫn "vượt qua" bước cap vì `valid_ids` rỗng/rất nhỏ, rồi mới
  bị chặn ở bước "toàn bộ không hợp lệ" (A11) — không sai về status code
  cuối cùng, nhưng đã lãng phí tính `Integer()`/query DB trên payload khổng
  lồ trước khi từ chối, đúng tinh thần "chặn payload khổng lồ **sớm nhất**"
  mà `F6-api.md` §2.3 bước 5 yêu cầu.
- **Bẫy #5 — N+1 ở 2 chỗ dễ quên**: `GroupsController#index`'s `devices_count`
  (T9 — phải batch qua `GROUP BY`, cấm `group.devices.count` trong `.map`)
  và `GroupDevicesController#index`'s device list (T11 — **không** merge
  `groups` vào từng dòng, khác hẳn `DevicesController#show`). Không scenario
  nào ở SoT §11 assert trực tiếp số query SQL — implementer phải tự kỷ luật,
  reviewer nên kiểm bằng `bullet` gem hoặc đếm query thủ công trong spec.
- **Không có nhánh 403 nào trong toàn bộ F6** (kế thừa CLAUDE.md §4/F2–F5) —
  mọi vi phạm ranh giới org là 404. Nếu đang viết `status: :forbidden` ở
  bất kỳ đâu trong T11 ⇒ sai hướng.
- **`Device` retired bất biến áp dụng cho CẢ gỡ, không chỉ thêm** (A9) — hệ
  quả: 1 Device bị retired trong khi đang là thành viên của Group sẽ **kẹt
  vĩnh viễn** trong Group đó (không gỡ được, không un-retire). Đây là hệ quả
  đã được SoT §12 "Rủi ro/giả định" xác nhận là baseline chấp nhận được khi
  approve — **không** phải bug cần fix ở F6, không viết luồng un-retire.
- **`AsyncSearchSelect.vue` (T25) là component dùng chung F7/F8 sẽ tái sử
  dụng nguyên trạng** — viết đúng interface tổng quát đã chốt ở
  `F6-frontend.md` §2.4 ngay từ đầu (không sửa props sau này); không giới
  hạn số lượng chọn ở FE (cap 500 là hợp đồng server, để 422 trả về thật —
  cùng triết lý "không `maxlength`" F5 đã áp dụng cho input text, giờ áp
  dụng cho search-select).
- **Chạm code của feature đã Done (5 điểm, đều refactor/mở rộng thuần):**
  T4 (`DevicesController` → 2 concern), T12/T13 (`DevicesController#index`/
  `#show` — mở rộng, không đổi field cũ), T19 (`types/device.ts`/
  `api/devices.ts`), T22 (`stores/groups.ts`), T33 (`GroupListView.vue`),
  T34 (`DeviceDetailView.vue`). T5, T39 là 2 gate regression bắt buộc.
  Nguyên tắc: spec cũ đỏ ⇒ sửa code refactor/mở rộng, không sửa spec.
- **Phải ghi vào `DESIGN.md` khi implement xong** (đã chốt ở 3 design, không
  phải quyết định mới): (1) không có bulk-add-theo-filter, không async job
  cho membership (khác F8 — OQ-1); (2) `devices_count` không dùng counter
  cache, luôn `COUNT`/`GROUP BY` trực tiếp (OQ-5); (3) `POST .../devices`
  không trả danh sách id bị lọc âm thầm (chỉ `{added_count, devices_count}`);
  (4) sort tab Thành viên là `devices.created_at DESC, devices.id DESC`,
  không phải `group_memberships.created_at`; (5) `AsyncSearchSelect` không
  hỗ trợ điều hướng bàn phím (giới hạn đã biết, không chặn approve); (6) mục
  "3. AI" nếu có quyết định phát sinh trong lúc code.
- **Seed 10.000 device cho việc kiểm thử/demo hiệu năng** (SoT §10 nhắc lại
  nhiều lần) — quyết định ở plan này: dùng `GroupMembership.insert_all`
  **trong RSpec** (T15) cho test tự động, **không** seed 10.000 dòng vào
  `db/seeds.rb` (T17 chỉ seed vài liên kết nhỏ cho demo/walkthrough). Nếu cần
  demo trực quan quy mô lớn qua UI thật, viết thêm 1 rake task riêng ngoài
  phạm vi 3 gate bắt buộc — không phải nghĩa vụ của plan này.
- **Cập nhật `docs/backlog.md`** (việc văn bản, không chặn implement): dòng
  F5 nên thêm "— **Done**" giống F3/F4 để khớp thực tế code; dòng F6 cập
  nhật cột cuối từ `—` sang link `docs/plan/F6-group-membership.md` sau khi
  file này được ghi.
</content>
