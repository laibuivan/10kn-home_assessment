---
feature_id: F6
title: Group membership tại scale (thêm/gỡ device, chịu 10.000 device, idempotent)
status: approved   # draft | approved
approver: Lai Bui <lai.bui.vtp@gmail.com>
date: 2026-09-16
---

## §1. Meta
- Feature: `F6` — Group membership tại scale (thêm/gỡ device, chịu 10.000
  device, idempotent)
- Dependency: `F5` (Group CRUD — approved, xem `docs/sot/F5-group-crud.md`:
  `Group` model, `GroupPolicy`, `GroupListView.vue`, `ConfirmModal.vue`,
  `stores/groups.ts`, `api/groups.ts`), `F3` (Device create/edit — approved:
  `Device` model, `DevicePolicy`, `stores/devices.ts`, `api/devices.ts`).
  F6 **không** phụ thuộc F4 theo `docs/backlog.md`, nhưng đụng trực tiếp vào
  trang Device Detail mà F4 đã dựng (xem dưới) vì đó là nơi PRD yêu cầu hiện
  "group đang thuộc" — F4 đã cố tình để khối đó ở dạng tĩnh-rỗng và giao lại
  quyết định contract cho F6 (`docs/sot/F4-device-detail.md` OQ-1, OQ-3,
  OQ-6).
  - **Nghĩa vụ carry-over bắt buộc từ F5** (đã ghi rõ ở `docs/sot/F5-group-crud.md`
    §6 + §12 OQ-3, "Rủi ro/giả định"): khi F6 tạo bảng `group_memberships`,
    **bắt buộc** (a) thêm `has_many :group_memberships, dependent:
    :delete_all` vào `Group`, (b) viết test "xóa Group không để lại
    `group_memberships` mồ côi, Device không bị xóa" — scenario này được
    liệt kê lại nguyên văn ở §11 của SoT này (không còn `(pending OQ-n)`, vì
    giờ đã có bảng thật để chạy).
  - **Nghĩa vụ carry-over từ F4**: response `GET /api/v1/devices/:id` (F4 cố
    tình không thêm field rỗng `groups: []`) và khối "Groups đang thuộc" trên
    trang Device Detail (F4 dựng dạng tĩnh "Chưa thuộc group nào.", nút
    "+ Thêm vào group" chưa tồn tại) — F6 thay bằng dữ liệu/hành vi thật,
    **không đổi route/layout đã chốt** ở F4 trừ khi có lý do kỹ thuật (ghi
    vào §12 nếu có).
- Nguồn: `PRD.md` §"Nghiệp vụ" → "Group" ("chứa nhiều Device; một Device
  thuộc nhiều Group") + "**Group có thể rất lớn (cỡ 10.000 devices)**" (đoạn
  này PRD viết trong ngữ cảnh gán Policy, nhưng `docs/backlog.md` mục F6 mở
  rộng rõ ràng yêu cầu "chịu 10.000 device, idempotent" sang chính việc
  thêm/gỡ membership — xem §10, §12 OQ-1) + bảng "Giao diện bắt buộc" dòng
  "Groups" ("chi tiết: thêm/gỡ device") + dòng "Device detail" ("group đang
  thuộc"); `docs/backlog.md` mục F6 + "Dependency"; `UI_UX_design.md` §5
  (khối "Groups đang thuộc" + banner retired ở Device Detail), §6.2 (Group
  Detail — tab Thành viên, modal thêm device, nút gỡ inline), §6.3 (chỉ áp
  dụng cho gán Policy — **không** thuộc F6, xem §3 "Ngoài phạm vi"), §8
  (`AsyncSearchSelect.vue`, `ConfirmModal.vue` dùng lại); `CLAUDE.md` §4
  (tách Organization tuyệt đối, Device retired bất biến — "không đổi
  group... khi status == retired", xóa Group không để dữ liệu treo, group
  lớn phải dùng `upsert_all` trên unique index để idempotent — đoạn này ghi
  rõ "xem thiết kế DB chi tiết ở F6/F8", tức F6 là nơi thiết lập lần đầu
  pattern `upsert_all` + unique index cho join table, F8 tái dùng cho
  `policy_assignments`).

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **quản lý thành viên
của một Group** — thêm nhiều Device vào Group cùng lúc và gỡ từng Device ra
khỏi Group, xem từ cả hai phía (trang chi tiết Group lẫn trang chi tiết
Device) — để tổ chức Device thành đơn vị nhóm phục vụ gán Policy hàng loạt
sau này (F8), mà vẫn dùng được mượt khi một Group có tới hàng chục nghìn
Device, thao tác lặp lại không tạo dữ liệu trùng, và không bao giờ đổi được
membership của một Device đã `retired`.

## §3. Scope

**Trong phạm vi:**
- **DB**: bảng `group_memberships` mới — join table thuần `group_id`/`device_id`
  (FK NOT NULL cả hai), unique index composite `[group_id, device_id]` (chặn
  trùng ở tầng DB, phục vụ `upsert_all` idempotent), index trên `device_id`
  riêng (phục vụ truy vấn ngược "group nào chứa Device X" từ Device Detail).
  Không có cột `source`/`status` (khác `policy_assignments` của F8 — bảng
  này chỉ diễn tả "Device X đang là thành viên Group Y", không có khái niệm
  "qua đâu" hay "còn hiệu lực không").
- **Model**: `GroupMembership` (`belongs_to :group`, `belongs_to :device`,
  validate uniqueness `device_id` scope `group_id` — bảo vệ 2 lớp giống mọi
  unique khác trong dự án). `Group has_many :group_memberships, dependent:
  :delete_all; has_many :devices, through: :group_memberships`. `Device
  has_many :group_memberships; has_many :groups, through:
  :group_memberships` (chưa cần `dependent:` phía Device vì PRD không có
  luồng xóa Device — chốt kỹ ở `/design`).
- **API** (namespace `api/v1`, kế thừa envelope lỗi/pagination của F0/F2):
  - `GET /api/v1/groups/:id` — chi tiết 1 Group (name, description,
    `devices_count`) — endpoint F5 đã cố tình bỏ qua (F5 OQ-5), F6 bổ sung
    vì Group Detail giờ có nội dung thật.
  - `GET /api/v1/groups/:id/devices` — danh sách Device thuộc Group, phân
    trang server-side + filter `platform`/`status` (tái dùng contract F2).
  - `POST /api/v1/groups/:id/devices` — thêm nhiều Device vào Group cùng lúc
    (`device_ids: [...]`), bulk + idempotent bằng `upsert_all` trên unique
    index `[group_id, device_id]`.
  - `DELETE /api/v1/groups/:id/devices/:device_id` — gỡ 1 Device khỏi Group.
  - `GET /api/v1/devices` — bổ sung tham số tìm kiếm `q` (ILIKE trên
    `identifier` hoặc `name`) phục vụ modal "+ Thêm device vào group" (F2
    từng cố tình bỏ qua search, hẹn "feature riêng" — xem OQ-7).
  - `GET /api/v1/devices/:id` — bổ sung field `groups: [{id, name}]` vào
    response (F4 để trống, giao quyết định cho F6 — xem OQ-6).
  - Mọi action lấy Group qua `policy_scope(Group)` /
    `current_organization.groups`, lấy Device (path hoặc trong
    `device_ids`) qua `current_organization.devices` — **không bao giờ**
    `Group.find`/`Device.find` trần.
- **Authorization**: `GroupPolicy` mở rộng thêm action liên quan tới
  membership (`show?`, và action tương ứng cho thêm/gỡ), Scope không đổi so
  với F5.
- **FE**:
  - Route `/groups/:id` + `views/groups/GroupDetailView.vue` (header +
    tab "Thành viên"; tab "Policies" **không** làm ở F6 — xem "Ngoài phạm
    vi").
  - Bật lại action "Xem chi tiết" trong menu ⋯ của `GroupListView.vue` (F5
    đã cố tình bỏ, ghi nợ ở F5 OQ-5).
  - Thêm cột "Số device" (`devices_count`) vào `GroupListView.vue` và số
    lượng `<N>` vào nội dung confirm xóa Group (F5 đã cố tình bỏ, ghi nợ ở
    F5 OQ-4).
  - `components/AsyncSearchSelect.vue` — component dùng chung mới
    (`UI_UX_design.md` §8), dùng cho modal "+ Thêm device vào group" (search
    theo identifier/name) và modal "+ Thêm vào group" ở Device Detail
    (search Group theo tên, tái dùng `q` đã có từ F5).
  - `views/devices/DeviceDetailView.vue` — thay khối "Groups đang thuộc"
    tĩnh (F4) bằng dữ liệu thật: danh sách Group (link `/groups/:id`), nút
    "+ Thêm vào group", nút "x" gỡ từng Group (confirm nhỏ); ẩn/disable toàn
    bộ khi Device `retired` (banner "Thiết bị đã retired — không thể chỉnh
    sửa." — layout này `UI_UX_design.md` §5 đã vẽ sẵn, F4 chưa nối hành vi).
  - `stores/group-memberships.ts` (hoặc gộp vào `stores/groups.ts`/`devices.ts`
    — chốt ở `/design`), `api/group-memberships.ts` (hoặc thêm hàm vào
    `api/groups.ts`/`api/devices.ts`).

**Ngoài phạm vi** (khớp `docs/backlog.md` — không tự thêm):
- **Tab "Policies" ở Group Detail, gán Policy cho Group/Device, async job
  `AsyncJobBanner.vue`, endpoint `policy_assignments`** (`UI_UX_design.md`
  §6.2 khối "Tab Policies", §6.3 toàn bộ) → thuộc **F7/F8**. F6 chỉ dựng tab
  "Thành viên"; nếu dựng khung tab "Policies" thì để dạng chưa-bật (không
  nút chết) giống cách F5 xử lý sidebar "Policies" ở F0, **hoặc** không
  render tab đó cho tới F8 — chốt cụ thể ở `/design F6`.
  - **Quan trọng**: async job (Solid Queue + trạng thái
    pending/running/done/failed) theo `CLAUDE.md` §4 là yêu cầu bắt buộc
    cho **gán Policy cho Group** (F8), **không phải** cho thêm/gỡ Device
    khỏi Group (F6) — xem OQ-1 để biết vì sao F6 không cần kiến trúc job
    tương tự.
- **Bulk add theo filter** ("thêm tất cả Device khớp điều kiện X vào Group"
  không qua chọn tay từng dòng) — `UI_UX_design.md` §6.2 mô tả tính năng này
  là **tùy chọn** ("nếu có"), không phải yêu cầu bắt buộc của PRD. F6 không
  làm — xem OQ-1.
- **Xóa Device** — không có trong PRD (đã chốt ở `docs/sot/F4-device-detail.md`
  OQ-3), nên không có luồng "membership bị dọn khi Device bị xóa".
- Màn hình quản lý Organization (PRD: "Không cần").
- Bất kỳ nghiệp vụ nào không có trong `PRD.md` (giới hạn số Group tối đa 1
  Device được thuộc, audit log ai thêm/gỡ, import CSV hàng loạt...).

## §4. Main flow

**A. Xem chi tiết Group + danh sách thành viên:**
1. Từ Group List, bấm vào 1 dòng (hoặc mở menu ⋯ → "Xem chi tiết") → điều
   hướng `/groups/:id`.
2. FE gọi song song `GET /api/v1/groups/:id` (header) và
   `GET /api/v1/groups/:id/devices?page=1` (tab "Thành viên", mặc định
   active).
3. BE: Group không thuộc org hiện tại / không tồn tại / id sai định dạng →
   404 cho cả hai request → FE hiện trang "Không tìm thấy Group" + nút quay
   lại danh sách.
4. FE render header (tên, mô tả, "Thành viên (`devices_count`)") + tab Thành
   viên: `DataTable` (Identifier | Name | Platform | Status | hành động "Gỡ
   khỏi group") + `FilterBar` (platform/status) + `PaginationBar`.

**B. Thêm Device vào Group (từ Group Detail):**
1. Bấm "+ Thêm device vào group" → mở modal `AsyncSearchSelect` (rỗng, ô
   tìm kiếm theo identifier/name).
2. Gõ từ khóa → debounce → `GET /api/v1/devices?q=...` (org-scoped, không
   load hết danh sách Device).
3. Chọn nhiều Device (checkbox, tối đa số lượng ở OQ-2) → "Thêm đã chọn" →
   `POST /api/v1/groups/:id/devices {device_ids: [...]}`.
4. `200` → đóng modal, toast "Đã thêm N thiết bị vào group", refresh tab
   Thành viên (về trang 1) và `devices_count` ở header.
5. `422` (có Device `retired` trong lựa chọn — xem OQ-3) → modal **không**
   đóng, liệt kê rõ identifier các Device bị chặn, giữ nguyên lựa chọn để
   user bỏ chọn Device retired rồi thử lại.

**C. Gỡ Device khỏi Group (từ Group Detail):**
1. Trên 1 dòng trong tab Thành viên, bấm "Gỡ khỏi group" → confirm nhỏ dạng
   inline (không modal to, theo `UI_UX_design.md` §6.2).
2. Xác nhận → `DELETE /api/v1/groups/:id/devices/:device_id`.
3. Thành công → toast "Đã gỡ thiết bị khỏi group", refresh tab (xử lý trang
   cuối trống bằng cách tự lùi trang, giống pattern F5 §5.1).
4. `422` (Device đang `retired`) → toast lỗi rõ ràng, dòng vẫn còn nguyên
   trong danh sách.

**D. Thêm/gỡ Group từ Device Detail (chiều ngược lại, cùng API):**
1. Ở khối "Groups đang thuộc" (Device Detail), bấm "+ Thêm vào group" → mở
   modal `AsyncSearchSelect` tìm Group theo tên (tái dùng `q` đã có từ F5) →
   chọn → gọi lại **đúng** `POST /api/v1/groups/:group_id/devices
   {device_ids: [device hiện tại]}` (không dựng API riêng cho chiều này —
   một nguồn sự thật duy nhất cho business rule thêm/gỡ).
2. Thành công → đóng modal, toast, khối "Groups đang thuộc" refresh (gọi lại
   `GET /api/v1/devices/:id`).
3. Mỗi Group trong khối có nút "x" → confirm nhỏ → `DELETE
   /api/v1/groups/:group_id/devices/:device_id` → refresh khối.
4. Nếu Device đang `retired`: toàn bộ nút "+ Thêm vào group"/"x" bị
   ẩn/disable, hiện banner xám "Thiết bị đã retired — không thể chỉnh sửa."
   (danh sách Group đang thuộc vẫn hiển thị, chỉ đọc).

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- **Filter platform/status trong tab Thành viên**: đổi filter → gọi lại API
  với param tương ứng, **reset về page 1**, đồng bộ URL query (tái dùng
  pattern F2/F5).
- **Vào thẳng URL `/groups/:id?tab=members&page=3&platform=ios`**: trang tự
  đọc query string và fetch đúng.
- **Group chưa có Device nào** (mới tạo ở F5): tab Thành viên hiện empty
  state thật (không do filter) kèm CTA "+ Thêm device vào group".
- **Gỡ dòng cuối cùng của trang > 1** trong tab Thành viên: sau khi gỡ
  thành công, nếu trang hiện tại trả về rỗng mà `current_page > 1` → tự lùi
  về `current_page - 1` (đúng pattern F5 §5.1).

### 5.2 Edge case
- A1. `GET /api/v1/groups/:id` với `:id` thuộc Organization khác (đoán ID)
  → **404**, không 403.
- A2. `GET /api/v1/groups/:id/devices` với Group thuộc org khác → **404**,
  không lộ danh sách Device của Group đó.
- A3. `POST /api/v1/groups/:id/devices` với Group thuộc org khác → **404**,
  không tạo membership nào (kể cả nếu `device_ids` hợp lệ trong org của
  người gọi).
- A4. `DELETE /api/v1/groups/:id/devices/:device_id` với Group thuộc org
  khác → **404**.
- A5. `:id` (Group) không tồn tại trong hệ thống, hoặc sai định dạng (không
  phải số nguyên) → **404**, không 500 — áp dụng cho cả 4 endpoint mới.
- A6. Thêm 1 Device **đã là thành viên** của Group (gọi lại thao tác cũ) →
  **200**, idempotent — không tạo dòng `group_memberships` trùng,
  `devices_count` không tăng thêm.
- A7. Thêm nhiều Device cùng lúc, trong đó có cả Device đã là thành viên lẫn
  Device mới → cả hai loại đều "thành công" trong response, nhưng chỉ Device
  mới làm `devices_count` tăng (kiểm chứng được bằng số liệu trước/sau).
- A8. Thêm Device đang `status = retired` vào Group → **422**, response liệt
  kê rõ identifier các Device bị chặn; **toàn bộ request bị từ chối** (kể cả
  Device hợp lệ khác trong cùng request không được thêm) — xem OQ-3.
- A9. Gỡ Device đang `status = retired` khỏi Group → **422** ("Thiết bị đã
  retired, không thể thay đổi group") — Device vẫn còn là thành viên sau
  lệnh gỡ thất bại (`CLAUDE.md` §4 — retired bất biến áp dụng cho cả thêm
  **và** gỡ, không chỉ thêm).
- A10. `device_ids` trong request thêm chứa id thuộc **Organization khác**
  hoặc **không tồn tại** → id đó bị lọc âm thầm (không add, không báo lỗi
  riêng cho id đó — không lộ sự tồn tại của resource); các `device_id` hợp
  lệ khác trong cùng request vẫn được thêm bình thường — xem OQ-4.
- A11. Request thêm mà **toàn bộ** `device_ids` đều không hợp lệ (org khác /
  không tồn tại) sau khi lọc → **422** ("Không có thiết bị hợp lệ nào được
  chọn"), không tạo gì.
- A12. Request thêm vượt quá giới hạn số lượng `device_ids` cho 1 lần gọi →
  **422** ("Chọn tối đa `<N>` thiết bị mỗi lần"), không thêm bất kỳ Device
  nào (từ chối toàn bộ, không cắt bớt âm thầm) — xem OQ-2.
- A13. Request thêm với `device_ids` rỗng hoặc thiếu field → **422** bám
  field `device_ids`.
- A14. Gỡ 1 Device **hiện không phải thành viên** của Group (chưa từng thêm,
  hoặc đã bị gỡ trước đó bởi phiên khác) → **404** — xem OQ-8.
- A15. **Race condition thêm**: 2 request thêm cùng 1 Device vào cùng Group
  gần như đồng thời → không tạo 2 dòng `group_memberships` trùng (unique
  index `[group_id, device_id]` + `upsert_all` xử lý êm ở tầng DB), cả hai
  request đều nhận **200** thành công, không request nào nhận 500.
- A16. **Race condition gỡ** (double-click nút "Gỡ khỏi group"): request thứ
  2 nhận **404** (đã bị gỡ bởi request thứ nhất), không 500; chỉ 1 hiệu ứng
  xảy ra trên dữ liệu.
- A17. Tab Thành viên của 1 Group có **10.000 Device** → danh sách phân
  trang server-side (không render hết 10.000 dòng ra DOM), filter
  platform/status hoạt động đúng trên tập đã org-scope + group-scope, tổng
  số đúng ở `meta.total_count`.
- A18. Filter platform/status trong tab Thành viên không khớp Device nào →
  EmptyState "Không tìm thấy thiết bị" + nút xóa filter (khác nội dung với
  A19 — không gây hiểu nhầm Group chưa có Device nào).
- A19. Group **thật sự chưa có Device nào** (không do filter) → EmptyState
  "Group chưa có thiết bị nào" + CTA "+ Thêm device vào group".
- A20. **Xóa Group đang có Device là thành viên** (kể cả tới 10.000 dòng) →
  toàn bộ `group_memberships` của Group đó bị xóa trong **cùng transaction**
  với việc xóa `groups` record (`dependent: :delete_all`, không FK cascade
  ngầm); Device **không** bị xóa; không còn dòng `group_memberships` mồ côi
  — đây là **scenario carry-over bắt buộc từ F5** (`docs/sot/F5-group-crud.md`
  §12 OQ-3 phương án (a)), giờ có bảng thật để chạy được.
- A21. Sau khi xóa Group thành công, các Device từng thuộc Group đó **không
  còn** hiện Group đó trong khối "Groups đang thuộc" ở Device Detail (hệ quả
  trực tiếp của A20, kiểm chứng từ phía Device).
- A22. Modal search Device (thêm vào group) gõ từ khóa không khớp Device nào
  → dropdown hiện "Không tìm thấy"; nút "Thêm đã chọn" disable khi chưa chọn
  gì.
- A23. Modal search Group (từ Device Detail, "+ Thêm vào group") gõ từ khóa
  không khớp Group nào → tương tự A22 (tái dùng `q` đã có từ F5).
- A24. 1 Device thuộc **nhiều Group cùng lúc** (không giới hạn số lượng) —
  hợp lệ, đúng PRD "một Device thuộc nhiều Group".
- A25. Device Detail hiển thị đúng danh sách Group đang thuộc (link tới
  `/groups/:id`), kể cả trường hợp 0 group ("Chưa thuộc group nào." — thay
  bằng dữ liệu thật, không còn hard-code tĩnh của F4).
- A26. Device `retired`: khối "Groups đang thuộc" ở Device Detail ẩn/disable
  nút "+ Thêm vào group" và mọi nút "x" gỡ; hiện banner "Thiết bị đã retired
  — không thể chỉnh sửa."; danh sách Group đang thuộc vẫn hiển thị (chỉ
  đọc, không có nút thao tác).
- A27. Cố tình gọi thẳng API thêm/gỡ group cho Device đang `retired` (bỏ qua
  UI đã disable, vd qua devtools) → **vẫn bị chặn ở BE** (422 — trùng A8/A9)
  — double-check bắt buộc ở backend, không chỉ chặn ở UI (`UI_UX_design.md`
  §10 tinh thần chung).
- A28. Lỗi hạ tầng (500/network) khi tải tab Thành viên → `ErrorState` riêng
  trong khối tab đó + nút "Thử lại"; khối header Group (tên/mô tả) và các
  khối khác của Device Detail (nếu có) **không** bị kéo sập theo.
- A29. Lỗi hạ tầng khi thêm/gỡ Device → toast lỗi; modal (nếu đang thêm)
  không đóng, dòng (nếu đang gỡ) vẫn còn nguyên — không optimistic update.
- A30. Gọi bất kỳ endpoint mới nào (`groups/:id`, `groups/:id/devices`,
  `devices?q=`) **không có token** hoặc token hết hạn/không hợp lệ →
  **401**.
- A31. `organization_id` gửi kèm trong bất kỳ request nào của F6 (kể cả
  trong mảng `device_ids`, cố lồng field lạ) đều bị bỏ qua — org của Group
  đích và của Device xác định hoàn toàn qua token + record đã lưu, không
  qua input.
- A32. RBAC — không phân role nội bộ Organization (nhất quán F0–F5): mọi
  user `active` của org đều thêm/gỡ được membership của Group thuộc org
  mình.

## §6. Business rule & validation

- **Org-scope tuyệt đối trên cả hai phía Group và Device** (`CLAUDE.md` §4):
  `Group` lấy qua `policy_scope(Group)`/`current_organization.groups`;
  `device_ids`/`:device_id` lấy qua `current_organization.devices`. Input
  hợp lệ: cả Group đích và mọi Device tham chiếu đều thuộc org của token.
  Input bị chặn: Group thuộc org khác → 404 (A1–A4); Device thuộc org khác
  trong `device_ids` → lọc âm thửng, không lỗi riêng, không add (A10, A11).
- **Membership unique theo cặp `(group_id, device_id)`, không unique kiểu
  khác**: validate ở model + unique index composite `[group_id, device_id]`
  ở DB (2 lớp, đúng `CLAUDE.md` §4 "composite unique index + validate ở
  model"). Input hợp lệ: cặp chưa tồn tại → tạo mới; cặp đã tồn tại → no-op
  thành công (A6, A7, A15). Input bị chặn: không có khái niệm "bị chặn" ở
  đây — race condition được DB tự xử lý êm, không phải lỗi nghiệp vụ.
- **Device `retired` bất biến áp dụng cho membership** (`CLAUDE.md` §4 —
  "không đổi group... khi status == retired"): Input hợp lệ: Device
  `active`/`inactive` → thêm/gỡ bình thường. Input bị chặn: Device
  `retired` → 422 cho cả thêm (A8) và gỡ (A9), chặn ở **service layer**
  (không chỉ UI — A27), atomic cho request bulk (không thêm 1 phần khi có
  Device retired lẫn trong batch — xem OQ-3).
- **Idempotent bulk-write**: `POST .../devices` dùng `upsert_all` trên
  unique index `[group_id, device_id]` (không phải N lệnh `INSERT` +
  validate tuần tự) — gọi lại y hệt 1 request nhiều lần cho **cùng kết quả**
  (không nhân đôi dữ liệu, không lỗi ở lần gọi lại) — đúng yêu cầu PRD "kết
  quả đúng... không gán trùng vô hạn nếu thao tác lại" áp dụng cho membership
  giống hệt tinh thần đã chốt cho gán Policy.
- **Giới hạn số lượng `device_ids` mỗi request thêm** (OQ-2) — chặn payload
  vô hạn/DoS nhẹ qua request đơn lẻ đồng bộ, không phải giới hạn nghiệp vụ.
  Input hợp lệ: số lượng ≤ ngưỡng. Input bị chặn: vượt ngưỡng → 422, không
  thêm gì (A12).
- **Xóa Group không để dữ liệu treo (nghĩa vụ carry-over từ F5)**: `Group
  has_many :group_memberships, dependent: :delete_all` — xóa Group xóa sạch
  `group_memberships` liên quan trong cùng transaction, Device **không bao
  giờ** bị xóa theo (A20, A21). Không dựa vào `ON DELETE CASCADE` ngầm ở FK.
- **Phân trang bắt buộc** cho `GET /api/v1/groups/:id/devices` (PRD: "phân
  trang list, không render 10.000 dòng"): kế thừa nguyên contract F2/F5 —
  `page`/`per_page` (mặc định 20/tối đa 100), `meta{current_page, per_page,
  total_count, total_pages}`, `total_count` đếm trên relation đã
  group-scope + filter trước limit/offset, page vượt cuối → 200 rỗng, param
  không hợp lệ → 422 field-level (A17).
- **Auth** (kế thừa F0): Bearer token của user `active` → hợp lệ; thiếu/sai/
  hết hạn → 401 (A30).
- **RBAC không phân role nội bộ org** (kế thừa F0–F5): mọi user `active`
  của org được thêm/gỡ membership của Group thuộc org mình (A32).
- **Không liên quan tới F6** (ghi ra để khỏi bị nhầm là thiếu): rule "không
  gán Policy inactive/chéo org" và toàn bộ logic resolve conflict Policy
  không phát sinh ở F6 vì F6 không đụng tới `policies`/`policy_assignments`
  — thuộc F7/F8/F9.

## §7. UI state
Theo `UI_UX_design.md` §5 (Device Detail), §6.2 (Group Detail), §9 (ma trận
dùng chung) — chỉ liệt kê điểm phải khớp business rule ở §6:
- **Loading** Group Detail: header và tab "Thành viên" load **độc lập**
  (skeleton riêng từng khối) — lỗi 1 khối không kéo sập khối kia (A28).
- **Loading** modal thêm Device/Group: spinner trong dropdown khi đang gọi
  `q`, nút "Thêm đã chọn" disable khi chưa chọn gì hoặc đang submit.
- **Loading** gỡ inline: nút "Gỡ khỏi group" tự disable + spinner nhỏ trong
  lúc gọi API, không cho bấm lại (chặn A16 từ phía UI, backend vẫn phải tự
  chặn được — A16 là test tầng API).
- **Empty** Group chưa có Device thật sự (A19): "Group chưa có thiết bị
  nào" + CTA "+ Thêm device vào group".
- **Empty** do filter không khớp (A18): "Không tìm thấy thiết bị" + nút xóa
  filter, **không** hiện CTA thêm (tránh hiểu nhầm Group rỗng).
- **Empty** kết quả search trong modal (A22, A23): "Không tìm thấy" ngay
  trong dropdown, không phải toàn màn hình.
- **Error** tải tab Thành viên (A28): `ErrorState` trong khối tab + "Thử
  lại", header Group vẫn hoạt động.
- **Error** thêm Device có retired (A8): banner đỏ/list lỗi trong modal liệt
  kê rõ identifier bị chặn, modal không đóng, lựa chọn còn nguyên để sửa.
- **Error** thêm/gỡ khác (500/network, A29): toast lỗi, không đóng modal
  (khi thêm) / dòng còn nguyên (khi gỡ).
- **Error** 404 (Group/Device không còn tồn tại/khác org, A1–A5, A14): toast
  "không tồn tại hoặc đã bị gỡ" + refresh khối liên quan.
- **Retired banner** (A26): khối "Groups đang thuộc" ở Device Detail hiện
  banner xám + ẩn/disable mọi nút thao tác, danh sách vẫn hiển thị chỉ đọc.
- **Success**: toast tương ứng ("Đã thêm N thiết bị vào group" / "Đã gỡ
  thiết bị khỏi group") + danh sách/`devices_count` cập nhật đúng ngay.
- **404 trang** Group Detail khi `:id` sai org/không tồn tại: trang "Không
  tìm thấy Group" + nút quay lại danh sách (đúng pattern Device Detail đã
  có ở F4).
- **Không `console.error`/`console.log` sót lại**, không nút chết
  (`UI_UX_design.md` §10, `PRD.md` §"Yêu cầu chỉnh chu").

## §8. Data & API touchpoint
*(dự kiến — chốt chính thức ở `/design F6`)*
- Bảng mới: `group_memberships` — `id`, `group_id` (FK NOT NULL),
  `device_id` (FK NOT NULL), `created_at`, `updated_at`. Index:
  `[group_id, device_id]` unique, `[device_id]` (truy vấn ngược từ Device).
- Quan hệ: `Group has_many :group_memberships, dependent: :delete_all;
  has_many :devices, through: :group_memberships`. `Device has_many
  :group_memberships; has_many :groups, through: :group_memberships`.
- Endpoint dự kiến:
  - `GET /api/v1/groups/:id` → `200 { group: { id, name, description,
    devices_count, created_at, updated_at } }` / `404`.
  - `GET /api/v1/groups/:id/devices?page=&per_page=&platform=&status=` →
    `200 { devices: [...], meta: {...} }` (device shape kế thừa F2/F3) /
    `404` (Group sai org/không tồn tại) / `422` (param phân trang sai).
  - `POST /api/v1/groups/:id/devices` (body `{device_ids: [...]}`) → `200
    { added_count, devices_count }` (chốt hình dạng response chi tiết —
    kể cả có liệt kê id bị lọc/bị chặn hay không — ở `/design`) / `404`
    (Group sai org) / `422` (retired trong batch — OQ-3; vượt cap — OQ-2;
    device_ids rỗng/không hợp lệ toàn bộ — OQ-4, A11, A13).
  - `DELETE /api/v1/groups/:id/devices/:device_id` → `204`/`200` (chốt ở
    `/design`, cùng tinh thần F5) / `404` (Group sai org, Device không phải
    thành viên — OQ-8) / `422` (Device retired).
  - `GET /api/v1/devices?q=&page=&per_page=&platform=&status=` — thêm `q`
    (ILIKE `identifier` hoặc `name`, org-scoped) vào endpoint đã có của F2.
  - `GET /api/v1/devices/:id` — thêm field `groups: [{id, name}]` vào
    response đã có của F4.
  - Lỗi: `401`/`404`/`422` — nguyên envelope của F0.
- Policy: `GroupPolicy` bổ sung action cho `show?`/thêm/gỡ membership (giá
  trị `true`, ranh giới thật ở `Scope#resolve` — không phân role nội bộ).
- FE mới: route `/groups/:id`, `views/groups/GroupDetailView.vue`,
  `components/AsyncSearchSelect.vue`.
- FE sửa: `views/groups/GroupListView.vue` (bật "Xem chi tiết", thêm cột "Số
  device"), `components/ConfirmModal.vue`/nội dung confirm xóa Group (thêm
  số `<N>`), `views/devices/DeviceDetailView.vue` (khối "Groups đang thuộc"
  thật), `router/index.ts` (thêm route `/groups/:id`).

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), `status == active`, mới gọi
  được các endpoint membership; thiếu/sai token → 401.
- Không phân role nội bộ org (nhất quán F0–F5): mọi user active của org đều
  thêm/gỡ được membership của Group thuộc org mình.
- Org-scope check bắt buộc ở **mọi** action, trên **cả hai phía** tham
  chiếu (Group lẫn Device): `policy_scope(Group).find(params[:id])` cho
  Group, `current_organization.devices.where(id: device_ids)` cho Device —
  không bao giờ `Group.find`/`Device.find` trần. Sai org (bên nào cũng vậy)
  → 404 hoặc lọc âm thầm tùy loại tham chiếu (xem §6, OQ-4).
- Test bắt buộc riêng: org A không đọc được tab Thành viên của Group org B
  (404); org A không thêm được Device của chính mình vào Group của org B
  (404, không tạo membership); org A không thể lợi dụng endpoint thêm để
  "kéo" Device của org B vào Group của mình bằng cách đoán `device_id`
  (id đó bị lọc âm thầm, không add — A10).

## §10. Non-functional (performance/scale)
- **Đây là invariant trung tâm của F6** (`docs/backlog.md`: "chịu 10.000
  device, idempotent"). Các điểm phải đúng ở quy mô 1 Group ~10.000 Device:
  - `GET .../devices` (tab Thành viên): luôn phân trang server-side, không
    bao giờ trả toàn bộ 10.000 dòng trong 1 response; `total_count` đếm
    bằng `COUNT` trên relation đã scope, không load hết rồi `.size`.
  - `POST .../devices` (thêm hàng loạt): dùng **1 câu lệnh** `upsert_all`
    thay vì N lệnh `INSERT`/validate tuần tự trong vòng lặp Ruby — số lượng
    Device mỗi request bị chặn ở ngưỡng nhỏ (OQ-2) nên **không cần** enqueue
    Solid Queue job cho thao tác này (khác gán Policy ở F8) — xem OQ-1 để
    biết lý do không làm bulk-by-filter (thứ thật sự cần async).
  - `DELETE` Group (thừa hưởng từ F5, giờ có bảng thật): `dependent:
    :delete_all` trên `group_memberships` là **1 câu lệnh** `DELETE ... WHERE
    group_id = ?`, có index trên `group_id` (unique index
    `[group_id, device_id]` đã phủ đủ làm index tra cứu theo `group_id`) —
    xóa cả 10.000 dòng vẫn là 1 statement, chấp nhận chạy **đồng bộ trong
    request** (không cần chuyển sang xóa bất đồng bộ — trả lời câu hỏi mở
    F5 đã để ngỏ ở §10 SoT F5).
  - `q` trên `GET /api/v1/devices` dùng `ILIKE` — chấp nhận sequential scan
    trong phạm vi org (đã có `organization_id` ở đầu index để thu hẹp),
    cùng tinh thần rủi ro đã ghi nhận ở F5 cho search Group — ghi vào
    `DESIGN.md`, không tối ưu sớm (trigram index) khi chưa có số liệu.
- Seed data cho việc kiểm thử/demo quy mô 10.000 Device trong 1 Group (hoặc
  script riêng) nên được chuẩn bị ở bước `/plan`/implementation, không phải
  quyết định nghiệp vụ của SoT — ghi chú lại đây để không quên khi viết
  `README.md` walkthrough/test hiệu năng.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Xem chi tiết Group hiện đúng danh sách thành viên
  Given Organization "Acme Inc." có Group "Sales Team" với Device "IOS-001" và "AND-002" là thành viên
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Group "Sales Team"
  Then tôi thấy Device "IOS-001" và "AND-002" trong tab Thành viên

Scenario: Xem chi tiết Group của Organization khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/groups/:id" với id của Group "Globex Ops"
  Then tôi nhận về lỗi "404"

Scenario: Xem tab Thành viên của Group thuộc Organization khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Ops" với Device là thành viên
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/groups/:id/devices" với id của Group "Globex Ops"
  Then tôi nhận về lỗi "404"

Scenario: Thêm Device vào Group thuộc Organization khác không tạo được membership
  Given Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc." có Device "IOS-001"
  When tôi gọi "POST /api/v1/groups/:id/devices" với id của Group "Globex Ops" và device_ids gồm "IOS-001"
  Then tôi nhận về lỗi "404"
  And Group "Globex Ops" vẫn không có thành viên nào

Scenario: Gỡ Device khỏi Group thuộc Organization khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Ops" với Device "GLX-001" là thành viên
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "DELETE /api/v1/groups/:id/devices/:device_id" với id của Group "Globex Ops" và Device "GLX-001"
  Then tôi nhận về lỗi "404"
  And Device "GLX-001" vẫn còn là thành viên của Group "Globex Ops"

Scenario: Thêm Device đã là thành viên vào Group không tạo bản ghi trùng
  Given Organization "Acme Inc." có Group "Sales Team" với Device "IOS-001" đã là thành viên
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids gồm "IOS-001"
  Then tôi nhận về "200"
  And số lượng thành viên của Group "Sales Team" không đổi

Scenario: Thêm nhiều Device, trong đó có cả Device mới lẫn Device đã là thành viên
  Given Organization "Acme Inc." có Group "Sales Team" với Device "IOS-001" đã là thành viên
  And Organization "Acme Inc." có Device "AND-002" chưa thuộc Group nào
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids gồm "IOS-001" và "AND-002"
  Then tôi nhận về "200"
  And Group "Sales Team" có cả "IOS-001" và "AND-002" là thành viên
  And số lượng thành viên của Group "Sales Team" chỉ tăng thêm 1

Scenario: Thêm Device đang retired vào Group bị chặn toàn bộ request
  Given Organization "Acme Inc." có Group "Sales Team"
  And Organization "Acme Inc." có Device "RET-001" đang retired và Device "AND-002" đang active
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids gồm "RET-001" và "AND-002"
  Then tôi nhận về lỗi "422"
  And Group "Sales Team" không có thành viên nào được thêm, kể cả "AND-002"

Scenario: Gỡ Device đang retired khỏi Group bị chặn
  Given Organization "Acme Inc." có Group "Sales Team" với Device "RET-001" đang retired là thành viên
  When tôi gọi "DELETE /api/v1/groups/:id/devices/:device_id" với Device "RET-001"
  Then tôi nhận về lỗi "422"
  And Device "RET-001" vẫn còn là thành viên của Group "Sales Team"

Scenario: device_ids thuộc Organization khác bị lọc âm thầm khi thêm hàng loạt
  Given Organization "Acme Inc." có Group "Sales Team"
  And Organization "Acme Inc." có Device "AND-002"
  And Organization "Globex Corp." có Device "GLX-001"
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids gồm "AND-002" và id của "GLX-001"
  Then tôi nhận về "200"
  And Group "Sales Team" chỉ có "AND-002" là thành viên mới
  And Organization "Globex Corp." không có Group nào chứa "GLX-001" ngoài dự kiến ban đầu

Scenario: Tất cả device_ids không hợp lệ bị chặn với thông báo rõ
  Given Organization "Acme Inc." có Group "Sales Team"
  And Organization "Globex Corp." có Device "GLX-001"
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids chỉ gồm id của "GLX-001"
  Then tôi nhận về lỗi "422"
  And Group "Sales Team" không có thành viên nào

Scenario: Vượt giới hạn số lượng device_ids mỗi lần thêm bị chặn
  Given Organization "Acme Inc." có Group "Sales Team"
  And tôi có nhiều device_id hợp lệ vượt quá giới hạn cho phép mỗi request
  When tôi gọi "POST /api/v1/groups/:id/devices" với số lượng device_ids vượt giới hạn
  Then tôi nhận về lỗi "422"
  And Group "Sales Team" không có thành viên nào được thêm

Scenario: Gửi device_ids rỗng khi thêm bị chặn
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids rỗng
  Then tôi nhận về lỗi "422" ở field "device_ids"

Scenario: Gỡ Device không phải thành viên trả về 404
  Given Organization "Acme Inc." có Group "Sales Team" và Device "AND-002" chưa thuộc Group này
  When tôi gọi "DELETE /api/v1/groups/:id/devices/:device_id" với Device "AND-002"
  Then tôi nhận về lỗi "404"

Scenario: Hai request thêm cùng Device vào cùng Group đồng thời không tạo bản ghi trùng
  Given Organization "Acme Inc." có Group "Sales Team" và Device "AND-002"
  When hai request thêm "AND-002" vào Group "Sales Team" được gửi đồng thời
  Then cả hai request đều nhận về "200"
  And Group "Sales Team" chỉ có đúng 1 dòng thành viên cho "AND-002"

Scenario: Hai request gỡ cùng Device khỏi cùng Group đồng thời không lỗi 500
  Given Organization "Acme Inc." có Group "Sales Team" với Device "AND-002" là thành viên
  When hai request gỡ "AND-002" khỏi Group "Sales Team" được gửi đồng thời
  Then đúng một request nhận về thành công và request còn lại nhận về "404"
  And Device "AND-002" không còn là thành viên của Group "Sales Team"

Scenario: Tab Thành viên phân trang khi Group có nhiều Device, không render hết
  Given Organization "Acme Inc." có Group "Sales Team" với 10000 Device là thành viên
  When tôi gọi "GET /api/v1/groups/:id/devices" với page "1"
  Then tôi nhận về "200" với tối đa 20 Device trên trang này
  And "meta.total_count" bằng 10000

Scenario: Filter platform trong tab Thành viên không khớp hiện empty state riêng
  Given Organization "Acme Inc." có Group "Sales Team" chỉ có Device platform "ios" là thành viên
  When tôi mở tab Thành viên của Group "Sales Team" và lọc theo platform "android"
  Then tôi thấy thông báo "Không tìm thấy thiết bị"

Scenario: Group chưa có Device nào hiện empty state kèm CTA thêm device
  Given Organization "Acme Inc." có Group "Sales Team" chưa có thành viên nào
  When tôi mở trang chi tiết Group "Sales Team"
  Then tôi thấy thông báo "Group chưa có thiết bị nào"
  And tôi thấy nút "+ Thêm device vào group"

Scenario: Xóa Group không để lại group_memberships mồ côi và không xóa Device
  Given Organization "Acme Inc." có Group "Sales Team" với Device "IOS-001" và "AND-002" là thành viên
  When tôi xóa Group "Sales Team" thành công
  Then không còn bản ghi group_memberships nào trỏ tới Group "Sales Team"
  And Device "IOS-001" và "AND-002" vẫn tồn tại

Scenario: Xóa Group khiến Device không còn hiện Group đó trong danh sách "Groups đang thuộc"
  Given Organization "Acme Inc." có Group "Sales Team" với Device "IOS-001" là thành viên
  When tôi xóa Group "Sales Team" thành công
  And tôi mở trang chi tiết Device "IOS-001"
  Then tôi không thấy Group "Sales Team" trong khối "Groups đang thuộc"

Scenario: Thêm Device vào Group từ modal search theo identifier
  Given Organization "Acme Inc." có Group "Sales Team" và Device "IOS-001"
  When tôi mở trang chi tiết Group "Sales Team", tìm device theo "IOS-001" và thêm vào group
  Then tôi thấy toast "Đã thêm 1 thiết bị vào group"
  And Device "IOS-001" xuất hiện trong tab Thành viên

Scenario: Modal search Device không khớp từ khóa hiện empty state riêng
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở modal thêm device và tìm với từ khóa không khớp Device nào
  Then tôi thấy thông báo "Không tìm thấy" trong dropdown

Scenario: Device Detail hiển thị đúng danh sách Group đang thuộc bằng dữ liệu thật
  Given Organization "Acme Inc." có Device "IOS-001" là thành viên của Group "Sales Team"
  When tôi mở trang chi tiết Device "IOS-001"
  Then tôi thấy Group "Sales Team" trong khối "Groups đang thuộc"

Scenario: Device chưa thuộc Group nào hiện đúng trạng thái rỗng thật
  Given Organization "Acme Inc." có Device "AND-002" chưa thuộc Group nào
  When tôi mở trang chi tiết Device "AND-002"
  Then tôi thấy thông báo "Chưa thuộc group nào."

Scenario: Thêm Group cho Device từ trang Device Detail
  Given Organization "Acme Inc." có Device "AND-002" chưa thuộc Group nào
  And Organization "Acme Inc." có Group "Engineering"
  When tôi mở trang chi tiết Device "AND-002" và thêm vào Group "Engineering"
  Then tôi thấy Group "Engineering" trong khối "Groups đang thuộc"

Scenario: Gỡ Group khỏi Device từ trang Device Detail
  Given Organization "Acme Inc." có Device "AND-002" đang thuộc Group "Engineering"
  When tôi mở trang chi tiết Device "AND-002" và gỡ Group "Engineering"
  Then tôi không còn thấy Group "Engineering" trong khối "Groups đang thuộc"

Scenario: Device retired ẩn toàn bộ thao tác group trên Device Detail
  Given Organization "Acme Inc." có Device "RET-001" đang retired và đang thuộc Group "Sales Team"
  When tôi mở trang chi tiết Device "RET-001"
  Then tôi thấy banner "Thiết bị đã retired — không thể chỉnh sửa."
  And tôi không thấy nút "+ Thêm vào group" hay nút gỡ group nào hoạt động được
  And tôi vẫn thấy Group "Sales Team" trong danh sách

Scenario: Gọi thẳng API thêm group cho Device retired vẫn bị chặn dù UI đã ẩn nút
  Given Organization "Acme Inc." có Device "RET-001" đang retired
  And Organization "Acme Inc." có Group "Sales Team"
  When tôi gọi "POST /api/v1/groups/:id/devices" với device_ids gồm "RET-001"
  Then tôi nhận về lỗi "422"

Scenario: Lỗi hạ tầng khi tải tab Thành viên không kéo sập cả trang Group Detail
  Given API "GET /api/v1/groups/:id/devices" đang trả lỗi 500
  When tôi mở trang chi tiết Group "Sales Team"
  Then tôi thấy thông báo lỗi cùng nút "Thử lại" trong khối tab Thành viên
  And tôi vẫn thấy tên và mô tả Group "Sales Team" ở khối header

Scenario: Gọi API membership mà không có token
  When tôi gọi "GET /api/v1/groups/:id/devices" mà không có Authorization header
  Then tôi nhận về lỗi "401"

Scenario: Gửi organization_id trong request thêm device không đổi được org đích
  Given tôi là user active thuộc Organization "Acme Inc." có Group "Sales Team" và Device "AND-002"
  When tôi gọi "POST /api/v1/groups/:id/devices" kèm organization_id của Organization "Globex Corp."
  Then Device "AND-002" được thêm vào Group "Sales Team" thuộc Organization "Acme Inc."

Scenario: Danh sách Group hiện đúng số lượng device đang là thành viên
  Given Organization "Acme Inc." có Group "Sales Team" với 3 Device là thành viên
  When tôi mở trang danh sách Groups
  Then tôi thấy cột "Số device" của Group "Sales Team" hiển thị "3"

Scenario: devices_count cập nhật ngay sau khi thêm và gỡ device
  Given Organization "Acme Inc." có Group "Sales Team" với 3 Device là thành viên
  When tôi thêm 1 Device mới vào Group "Sales Team"
  Then cột "Số device" của Group "Sales Team" hiển thị "4"
  When tôi gỡ 1 Device khỏi Group "Sales Team"
  Then cột "Số device" của Group "Sales Team" hiển thị "3"

Scenario: Xem chi tiết Group từ danh sách Group
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở menu hành động của Group "Sales Team" và chọn "Xem chi tiết"
  Then tôi được điều hướng tới trang chi tiết Group "Sales Team"
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | `docs/backlog.md` mô tả F6 là "thêm/gỡ device, **chịu 10.000 device, idempotent**", còn `UI_UX_design.md` §6.2 mô tả tính năng "thêm hàng loạt theo filter" (chọn tất cả device khớp 1 điều kiện, không qua chọn tay từng dòng) là **tùy chọn** ("nếu có"). F6 có làm bulk-add-theo-filter (cần kiến trúc async job giống §6.3) không, hay chỉ hỗ trợ multi-select tường minh (bounded, đồng bộ)? | **Không làm bulk-add-theo-filter.** Chỉ hỗ trợ chọn tay nhiều Device qua modal search (checkbox), giới hạn số lượng mỗi request (OQ-2), xử lý đồng bộ bằng `upsert_all`. Lý do: PRD chỉ bắt buộc async job (queued/running/done/failed) cho **gán Policy cho Group lớn** (`PRD.md` dòng 58, 82 — đều nói "Policy", không nói "membership"); yêu cầu "chịu 10.000 device" của F6 được đáp ứng đầy đủ qua (a) tab Thành viên luôn phân trang server-side dù Group có 10.000 thành viên, và (b) `upsert_all` + unique index đảm bảo thêm/gỡ idempotent dù Group đã lớn — không cần thêm 1 tầng job/polling UI cho việc này, tránh phình phạm vi F6 khi F8 đã phải làm việc đó cho Policy. Nếu chọn **có làm**: cần thiết kế thêm bảng job/trạng thái riêng cho membership (hoặc tái dùng cơ chế F8 sớm hơn dự kiến), sửa §3/§8/§10 và các scenario `(pending OQ-1)`. | **Chọn phương án khuyến nghị: không làm bulk-add-theo-filter.** Giữ nguyên §3/§8/§10 như đã viết. |
| OQ-2 | Giới hạn số lượng `device_ids` tối đa cho 1 request `POST .../devices`? PRD không nói con số cụ thể (đây là giới hạn kỹ thuật, không phải nghiệp vụ). | **500** device_id/request. Đây là quy ước để giữ request đồng bộ nhanh và tránh payload khổng lồ, không phải yêu cầu nghiệp vụ — nếu approve muốn số khác, chỉ cần sửa hằng số ở `/design`, không ảnh hưởng scenario (viết theo "vượt giới hạn cho phép", không hard-code số). | **500** device_id/request, đúng khuyến nghị. |
| OQ-3 | Khi request thêm nhiều Device có lẫn Device `retired` — chặn **toàn bộ** request (atomic reject, không thêm gì kể cả Device hợp lệ khác) hay bỏ qua Device retired và vẫn thêm các Device hợp lệ còn lại (partial success)? | **Chặn toàn bộ (atomic reject)**, trả 422 liệt kê rõ identifier Device retired bị chặn. Lý do: "Device retired bất biến" là invariant nặng ký nhất liên quan tới Device (`CLAUDE.md` §4); âm thầm bỏ qua 1 phần dễ khiến user tưởng nhầm toàn bộ lựa chọn đã được xử lý trong khi thực ra một phần bị loại, rủi ro report/audit sai. Ngược lại, Device thuộc org khác/không tồn tại (OQ-4) là lỗi input (đoán ID), không phải vi phạm nghiệp vụ của chính Device hợp lệ, nên xử lý khác nhau (lọc âm thầm) là hợp lý. Nếu chọn **partial success**: sửa scenario `(pending OQ-3)`, response cần trả rõ danh sách bị bỏ qua kèm lý do. | **Chặn toàn bộ (atomic reject)**, đúng khuyến nghị. |
| OQ-4 | `device_ids` trong request thêm chứa id thuộc Organization khác hoặc không tồn tại (đoán ID) — nên báo lỗi riêng cho id đó hay lọc âm thầm (không lộ sự tồn tại của resource, đúng tinh thần `CLAUDE.md` §4 "404 không phải 403")? | **Lọc âm thầm**: id không thuộc `current_organization.devices` bị bỏ qua như thể không tồn tại, không có message riêng cho từng id; các id hợp lệ khác trong cùng request vẫn được thêm. Nếu **sau khi lọc** không còn id hợp lệ nào → 422 chung ("Không có thiết bị hợp lệ nào được chọn") — đây là lỗi về tổng thể request (không có gì để làm), không phải leak thông tin về từng id cụ thể. Nếu chọn **báo lỗi riêng theo từng id** (vd trả danh sách id "not found"): cân nhắc kỹ có làm lộ sự tồn tại của Device ở org khác qua timing/message hay không trước khi chọn — cần ghi rõ lý do trong `DESIGN.md` nếu đi hướng này. | **Lọc âm thầm**, đúng khuyến nghị (nhất quán "404 không phải 403" ở CLAUDE.md §4). |
| OQ-5 | `devices_count` hiển thị ở Group List (F5 đã bỏ, giao lại cho F6 — F5 OQ-4) tính bằng cột `counter_cache` (duy trì qua AR callback) hay `COUNT` trực tiếp (subquery/join) mỗi lần list? Vì thêm hàng loạt dùng `upsert_all` (bỏ qua AR callback) nên `counter_cache` mặc định của Rails **sẽ bị lệch** nếu không tự tay cập nhật cùng transaction. | **`COUNT` trực tiếp** (không dùng `counter_cache`). Lý do: tránh rủi ro lệch số do `upsert_all` bỏ qua callback (phải nhớ tự `UPDATE groups SET devices_count = devices_count + ...` thủ công trong mọi chỗ ghi — dễ quên, dễ lệch khi có thêm chỗ ghi mới ở F8/F9); ở quy mô Group hiện tại (hàng chục–hàng trăm Group/trang danh sách), `COUNT`/`LEFT JOIN` trên `group_memberships` đã có unique index `[group_id, device_id]` là đủ nhanh — cùng tinh thần chấp nhận đánh đổi đã có ở F5 (search `q` không có index riêng). Nếu chọn `counter_cache`: phải tự quản lý cập nhật thủ công trong **cùng transaction** với `upsert_all`/`delete`, ghi rõ trong `DESIGN.md` mọi nơi có thể làm lệch số. | **`COUNT` trực tiếp**, đúng khuyến nghị. |
| OQ-6 | Response `GET /api/v1/devices/:id` (F4 để trống, giao quyết định cho F6 — F4 OQ-6) nên **nhúng thẳng** field `groups: [{id, name}]` vào response, hay tách **endpoint riêng** `GET /api/v1/devices/:id/groups` (có phân trang)? | **Nhúng thẳng** `groups: [{id, name}]` vào response `GET /api/v1/devices/:id`. Lý do: số Group mà 1 Device thuộc về thường nhỏ (không có yêu cầu/kỳ vọng nào trong PRD về 1 Device thuộc hàng nghìn Group — khác chiều ngược lại là 1 Group có hàng nghìn Device), không cần phân trang riêng; nhúng thẳng tránh 1 round-trip network thừa khi mở Device Detail. Nếu chọn tách endpoint riêng: sửa §8, thêm 1 scenario gọi endpoint đó, và FE phải gọi thêm 1 request khi mở Device Detail. | **Nhúng thẳng** `groups: [{id, name}]`, đúng khuyến nghị. |
| OQ-7 | F2 (Device list) từng cố tình **không** làm search theo `identifier`/`name` (F2 OQ-3: "nếu sau này cần, làm feature riêng"). F6 cần search Device (theo `identifier`/`name`) để phục vụ modal "+ Thêm device vào group" — có nên bổ sung `q` **thẳng vào** `GET /api/v1/devices` đã có (tái dùng, ảnh hưởng cả trang Devices List) hay tạo **endpoint riêng** chỉ phục vụ modal này (vd `GET /api/v1/groups/:group_id/devices/search`)? | **Bổ sung `q` vào `GET /api/v1/devices` đã có** (ILIKE trên `identifier` hoặc `name`, org-scoped, tùy chọn — không truyền `q` thì hành vi y hệt F2 hiện tại, không phá contract cũ). Lý do: đây chính là "feature riêng" mà F2 OQ-3 đã hẹn, tái dùng đúng pattern `q` đã có ở Group (F5) thay vì tạo 1 endpoint hẹp chỉ dùng 1 lần; không ảnh hưởng trang Devices List vì `q` là tùy chọn. Nếu chọn endpoint riêng dưới `groups/:group_id/devices/search`: cần cân nhắc có nên loại Device đã là thành viên ra khỏi kết quả tìm kiếm hay không (F6 baseline: **không** loại, vì thêm lại Device đã là thành viên là no-op vô hại — idempotent). | **Bổ sung `q` vào `GET /api/v1/devices` đã có**, đúng khuyến nghị; không loại Device đã là thành viên khỏi kết quả search. |
| OQ-8 | `DELETE /api/v1/groups/:id/devices/:device_id` khi Device đó **hiện không phải thành viên** của Group (chưa từng thêm, hoặc đã bị gỡ trước đó) — trả **404** (nhất quán pattern F5 "xóa cái đã không còn = 404", A12 của F5) hay **204 idempotent no-op** (nhất quán tinh thần "idempotent" của chính F6)? | **404**, nhất quán với cách F5 xử lý xóa-lại-lần-2 một resource (F5 A12) — giữ đúng 1 pattern lỗi "thao tác trên thứ không còn tồn tại → 404" xuyên suốt dự án, thay vì để `DELETE` một số resource là 404-khi-đã-mất và resource khác lại là 204-no-op tùy tiện. Khái niệm "idempotent" bắt buộc theo `CLAUDE.md` §4 áp dụng cho thao tác **ghi hàng loạt** (`upsert_all`, gọi lại không nhân đôi) — không nhất thiết áp dụng cho việc gỡ 1 Device đơn lẻ qua `DELETE` theo `:device_id` cụ thể trong URL, vốn về bản chất là "xóa 1 resource theo id" giống hệt các `DELETE` khác trong dự án. Nếu chọn 204 no-op: sửa scenario `(pending OQ-8)`, và cần nhất quán lại cách `DELETE /api/v1/groups/:id` (F5) xử lý case tương tự để không có 2 chuẩn khác nhau trong cùng dự án. | **404**, đúng khuyến nghị. |

**Rủi ro/giả định:**
- **Hệ quả thực tế của "Device retired bất biến áp dụng cho cả gỡ"**: một khi Device bị chuyển `retired` trong khi đang là thành viên của 1 hoặc nhiều Group, Device đó **kẹt vĩnh viễn** trong các Group đó (không gỡ được) cho tới khi có luồng un-retire (mặc định: không làm — `CLAUDE.md` §4). Đây là hệ quả trực tiếp, đúng chữ của `CLAUDE.md` §4 ("không đổi group... khi status == retired"), không phải lựa chọn riêng của F6. **Đã xác nhận khi approve**: giữ đúng cách đọc chữ CLAUDE.md (áp dụng cho cả gỡ), chấp nhận hệ quả kẹt vĩnh viễn này làm baseline — không đổi sang "chỉ chặn thêm mới, gỡ vẫn được".
- **`AsyncSearchSelect.vue`** là component dùng chung **chưa từng được build** (`UI_UX_design.md` §8) — F6 là nơi build lần đầu (dùng cho cả tìm Device lẫn tìm Group), nên phải viết đủ tổng quát để F7/F8 (tìm Policy/Group/Device khi gán Policy) dùng lại không phải sửa: debounce input, gọi API `q` truyền vào qua prop, chọn 1 hoặc nhiều (tùy chế độ), loading trong dropdown, empty state "Không tìm thấy".
- **Response shape của `POST /api/v1/groups/:id/devices`** (OQ-4 khuyến nghị lọc âm thầm id không hợp lệ) chưa chốt có nên trả về `skipped_count`/danh sách id bị lọc hay không — nếu hoàn toàn im lặng, FE không có cách hiển thị "đã lọc bớt X id không hợp lệ" cho user (trường hợp thực tế hiếm vì FE luôn build `device_ids` từ kết quả search đã org-scope, chỉ có giá trị phòng thủ chống request giả mạo trực tiếp) — chốt chi tiết response shape ở `/design`, không phải quyết định nghiệp vụ.
- Việc chuẩn bị dữ liệu/seed cỡ 10.000 Device trong 1 Group để chứng minh yêu cầu hiệu năng (PRD §"Cách chấm": "thiết kế chịu được group lớn") thuộc trách nhiệm `/plan`/implementation của F6, không phải nội dung SoT, nhưng cần được nhắc lại ở đó để không bị quên.

**Đã approve (2026-09-16, Lai Bui):** cả 8 OQ chốt theo đúng phương án khuyến
nghị (xem cột "Quyết định" ở bảng trên). Toàn bộ 9 scenario từng mang tag
`(pending OQ-n)` ở §11 đã được rà lại và bỏ tag — không có scenario nào cần
sửa nội dung vì tất cả đều đã viết sẵn đúng theo phương án khuyến nghị.
