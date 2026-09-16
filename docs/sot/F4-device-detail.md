---
feature_id: F4
title: Device detail (info, group đang thuộc, policy đang áp dụng)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

## §1. Meta
- Feature: `F4` — Device detail (info, group đang thuộc, policy đang áp dụng)
- Dependency: `F3` (Device create/edit — approved, xem `docs/sot/F3-device-create-edit.md`,
  `docs/design/F3-{db,api,frontend}.md`; model `Device`, bảng `devices`,
  `DevicePolicy`/`DevicePolicy::Scope`, component `DataTable`/`FilterBar`/
  `PaginationBar`/`EmptyState`/`ErrorState`/`FormModal`/`DeviceFormModal`/
  `StatusBadge` đã tồn tại — F4 **không** đổi schema `devices`, chỉ thêm
  route đọc mới trên nền đó).
  - **Lưu ý sequencing quan trọng** (xem OQ-1): `docs/backlog.md` xếp
    `F5` Group CRUD, `F6` Group membership, `F7` Policy CRUD, `F8` Policy
    assignment, `F9` Policy resolution engine **đều sau** F4 và **không**
    nằm trong dependency của F4. Tại thời điểm F4 được build, bảng `groups`,
    `policies`, `group_memberships`, `policy_assignments` **chưa tồn tại**
    trong schema. `docs/backlog.md` cũng ghi rõ "F9 ... cũng cập nhật lại
    khối 'Policy đang áp dụng' ở panel của F4" — xác nhận đây là chủ ý của
    roadmap: F4 dựng khung trang + khối info thật, 2 khối group/policy dựng
    dạng tĩnh-đúng-hiện-trạng (empty vì thật sự chưa có gì để hiện), F6/F8/F9
    quay lại thay bằng dữ liệu/logic thật mà không cần đổi route hay layout.
- Nguồn: `PRD.md` §"Device", bảng "Giao diện bắt buộc" (dòng "Device detail":
  "Thông tin máy, group đang thuộc, **policy đang áp dụng**"), §"Yêu cầu
  chỉnh chu" (loading/rỗng/lỗi, không nút chết), `docs/backlog.md` mục F4 +
  "Dependency" + "Ngoài phạm vi", `UI_UX_design.md` §4 (Devices List — hành
  vi click row/⋯ "Xem chi tiết" đã vẽ sẵn nhưng F2/F3 cố tình chưa bật) và
  §5 (Trang Device Detail — layout 3 khối, states, retired), `CLAUDE.md` §4
  (org isolation 404-không-403, retired bất biến).

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **xem chi tiết** một
Device (thông tin đầy đủ, danh sách Group đang thuộc, và Policy đang thực áp
dụng lên nó) từ trang Devices List — để hiểu rõ trạng thái và cấu hình hiện
tại của thiết bị đó mà không cần Postman, và để có điểm vào (entry point)
cho các hành động quản lý group/policy trên thiết bị này ở các feature sau.

## §3. Scope
**Trong phạm vi:**
- Route `/devices/:id` + `GET /api/v1/devices/:id` — kích hoạt phần "vào chi
  tiết" mà F2/F3 đã cố tình để dành (`docs/sot/F2-device-list.md` §3,
  `docs/sot/F3-device-create-edit.md` §3 "Ngoài phạm vi").
- Backend: lấy record qua `policy_scope(Device)`/`current_organization.devices`
  (không bao giờ `Device.find` trần), 404 nếu `:id` không tồn tại/thuộc
  Organization khác/không đúng định dạng — tái dùng nguyên vẹn
  `rescue_from ActiveRecord::RecordNotFound` toàn cục đã có từ F0
  (`ApplicationController`), không viết rescue riêng. `DevicePolicy` thêm
  `show?` (kế thừa style `index?`/`create?`/`update?` — luôn `true` cho user
  `active` của org, không phân role nội bộ).
- Response chỉ gồm **thuộc tính của Device** (cùng shape với 1 item trong
  `GET /api/v1/devices` — tái dùng `serialize_device`), **không** thêm field
  giả `groups: []` / `applied_policies: []` vào contract (xem OQ-6) — tránh
  bịa 1 contract mà F6/F8/F9 nhiều khả năng sẽ thiết kế khác đi sau khi có
  SoT/design riêng.
- FE: `views/devices/DeviceDetailView.vue` mới — khối Header (identifier,
  `StatusBadge`, name/platform/os_version/last_seen_at, nút "Sửa" mở lại
  nguyên `DeviceFormModal` đã có từ F3), khối "Groups đang thuộc" và khối
  "Policy đang áp dụng" dựng dạng **tĩnh, đúng hiện trạng** (empty state cố
  định, không gọi API riêng, không loading/error riêng cho 2 khối này ở giai
  đoạn F4 — xem OQ-1 và "Rủi ro/giả định").
- Kích hoạt điểm vào từ Devices List: click cả dòng (trừ vùng nút hành động)
  **và** action "Xem chi tiết" cùng điều hướng tới `/devices/:id` (đúng
  `UI_UX_design.md` §4). Cách hiện action "Xem chi tiết" (thêm menu "⋯" gộp
  "Sửa"+"Xem chi tiết", hay giữ 2 nút rời) — xem OQ-2.
- Nút "◀ Quay lại danh sách" — giữ đúng filter/trang đã xem trước đó nếu vào
  từ list, fallback `/devices` (không filter) nếu vào thẳng qua URL (xem
  OQ-5).
- Retired: tái dùng nguyên rule đã có từ F3 (`CLAUDE.md` §4, `DeviceFormModal`
  disable field khi retired) — Device Detail chỉ cần disable/ẩn nút "Sửa" +
  hiện banner xám dựa theo `status` trả về từ chính response detail (không
  cần rule backend mới vì F4 không thêm mutation nào).
- Sau khi Sửa thành công từ Device Detail → refetch lại `GET
  /api/v1/devices/:id` (không phải refresh list) để header cập nhật ngay
  (đặc biệt banner retired phải xuất hiện tức thì nếu vừa đổi status).

**Ngoài phạm vi** (khớp `docs/backlog.md`/`CLAUDE.md` §4 — không tự thêm):
- Tạo bảng `groups`/`policies`/`group_memberships`/`policy_assignments` hay
  bất kỳ migration nào cho Group/Policy — thuộc F5/F6/F7/F8, F4 không đụng
  schema ngoài `devices`.
- Nút "+ Thêm vào group" / gỡ khỏi group (icon "x" cạnh mỗi group) — thuộc
  F6 (Group membership). `UI_UX_design.md` §5 vẽ sẵn nút này trong khối
  Groups nhưng F4 **không** kích hoạt (nút chưa xuất hiện, không phải nút
  disable/chết — tránh vi phạm "không nút chết" bằng cách không vẽ nút đó ra
  cho tới khi có chức năng thật).
- Nút "Gán policy trực tiếp" và toàn bộ khối "Xem tất cả nguồn" (popover/
  accordion giải thích override), banner conflict màu vàng — thuộc F8 (gán)
  và F9 (resolution engine, xử lý conflict theo `CLAUDE.md` §4). F4 chỉ dựng
  khối "Policy đang áp dụng" ở dạng empty tĩnh, chưa có bảng Name/Type/Nguồn/
  Trạng thái vì chưa có dữ liệu nào để hiển thị đúng.
- "⋯" ở header Device Detail (mockup `UI_UX_design.md` §5) — PRD không định
  nghĩa hành động nào khác ngoài "Sửa" cho Device (không có "Xóa Device" ở
  bảng "Giao diện bắt buộc"); F4 **không** render menu "⋯" trống ở header
  (xem OQ-3) — sẽ thêm lại khi feature sau cần 1 action thật.
- Un-retire — mặc định không làm (`CLAUDE.md` §4, `docs/backlog.md`).
- Xóa Device — PRD không liệt kê "xóa" cho trang Devices (khác Groups).

## §4. Main flow
**Vào trang chi tiết:**
1. User (đã đăng nhập, org `active`) đang ở `/devices` (có thể đang áp
   filter/trang bất kỳ), click vào 1 dòng device (hoặc bấm action "Xem chi
   tiết") → điều hướng `/devices/:id`.
2. FE gọi `GET /api/v1/devices/:id`, hiện skeleton loading toàn trang trong
   lúc chờ.
3. BE tìm record qua `policy_scope(Device)` (404 nếu không thuộc org hiện
   tại/không tồn tại/id sai định dạng), trả về thuộc tính Device.
4. Thành công (`200`) → FE render Header (identifier/StatusBadge/name/
   platform/os_version/last_seen_at + nút "Sửa" nếu không retired) và 2 khối
   tĩnh "Groups đang thuộc"/"Policy đang áp dụng" ở trạng thái empty.
5. Thất bại `404` → trang "Không tìm thấy thiết bị" kèm nút quay lại danh
   sách (không lộ lý do cụ thể là sai org hay không tồn tại).
6. Thất bại `401` → router guard redirect `/login` (tái dùng cơ chế F0).
7. Thất bại `500`/network → error state toàn trang, banner đỏ + nút "Thử
   lại" (gọi lại bước 2).

**Sửa từ Device Detail:**
1. User bấm "Sửa" (chỉ hiện khi `status != retired`) → mở `DeviceFormModal`
   đã có từ F3, prefill từ dữ liệu detail hiện có (không cần gọi thêm API).
2. Submit thành công → đóng modal, toast "Đã cập nhật device", FE gọi lại
   `GET /api/v1/devices/:id` để refresh toàn bộ Header (không refresh list
   vì đang không ở list).
3. Submit thất bại (`422`) → xử lý y hệt F3 (modal không đóng, lỗi field-
   level/banner chung).

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- User bấm "◀ Quay lại danh sách" → về `/devices` giữ nguyên filter/trang đã
  xem trước đó nếu điều hướng tới từ list; nếu user vào thẳng bằng URL
  `/devices/:id` (không có lịch sử điều hướng hợp lệ trong app) → về
  `/devices` không filter (xem OQ-5).
- User gõ thẳng URL `/devices/:id` vào trình duyệt (không qua click từ
  list) → trang vẫn tự fetch đúng bằng id trên route param, không phụ thuộc
  state từ trang list (không có gì đảm bảo user đã từng mở `/devices`).

### 5.2 Edge case
- A1. `GET /api/v1/devices/:id` với `:id` thuộc Organization khác (đoán ID)
  → `404`, không phải `403` (`CLAUDE.md` §4, không lộ sự tồn tại resource).
- A2. `GET /api/v1/devices/:id` với `:id` không tồn tại trong hệ thống →
  `404`.
- A3. `GET /api/v1/devices/:id` với `:id` sai định dạng (vd không phải số
  nguyên) → `404` (không phải `500`/lỗi hạ tầng lộ ra ngoài) — tái dùng
  `rescue_from ActiveRecord::RecordNotFound` toàn cục, xác nhận Postgres
  adapter không raise `StatementInvalid` trước khi rescue kịp bắt.
- A4. Device đang `retired` → Header ẩn/disable nút "Sửa", hiện banner xám
  "Thiết bị đã retired — không thể chỉnh sửa." (đọc trực tiếp từ `status`
  trong response detail, không phụ thuộc dữ liệu từ list).
- A5. Device không `retired` → nút "Sửa" hoạt động bình thường, mở đúng
  `DeviceFormModal`, prefill đầy đủ.
- A6. Sửa thành công từ Device Detail, kể cả đổi `status` sang `retired` →
  sau khi đóng modal, Header refetch và banner retired xuất hiện ngay lập
  tức, không cần user tự F5 lại trang.
- A7. Khối "Groups đang thuộc" luôn ở trạng thái empty tĩnh "Chưa thuộc
  group nào." ở giai đoạn F4 (đúng thực tế vì Group model chưa tồn tại),
  không gọi API riêng, không có loading spinner riêng cho khối này.
- A8. Khối "Policy đang áp dụng" tương tự A7, empty tĩnh "Chưa có policy nào
  áp dụng.", không gọi API riêng.
- A9. Click vào 1 dòng ở Devices List (ngoài vùng nút hành động) → điều
  hướng `/devices/:id` của đúng device đó.
- A10. Bấm action "Xem chi tiết" (dù hiện dưới dạng menu "⋯" hay nút rời —
  xem OQ-2) trên 1 dòng ở Devices List → điều hướng `/devices/:id`, click
  vào action này **không** đồng thời trigger điều hướng của A9 (chặn event
  bubble lên dòng).
- A11. Vào thẳng `/devices/:id` bằng URL (không qua click từ list, không có
  dữ liệu sẵn từ Pinia store) → trang vẫn load đúng, tự fetch bằng id trên
  route param.
- A12. Lỗi hạ tầng (`500`/network) khi gọi `GET /api/v1/devices/:id` → error
  state cho toàn trang (không tách riêng từng khối — khác với mô tả 3-khối-
  độc-lập ở `UI_UX_design.md` §5, xem "Rủi ro/giả định"), banner đỏ + nút
  "Thử lại", không để trang trắng, không spinner treo vô hạn.
- A13. Gọi `GET /api/v1/devices/:id` không có `Authorization` header hoặc
  token hết hạn/không hợp lệ → `401` (tái dùng `Authenticatable` concern có
  sẵn từ F0).
- A14. User chưa đăng nhập cố truy cập thẳng `/devices/:id` → router guard
  redirect `/login` (tái dùng guard có sẵn từ F0, cùng cơ chế F2/F3 đang
  dùng cho `/devices`).

## §6. Business rule & validation
- **Org-scope tuyệt đối** (`CLAUDE.md` §4): `GET /api/v1/devices/:id` luôn
  tìm record qua `policy_scope(Device)`. Input hợp lệ: chỉ trả về Device
  thuộc org gắn với token đang dùng. Input bị chặn: `:id` thuộc org khác
  hoặc không tồn tại hoặc sai định dạng → `404`, không `403` (A1–A3).
- **RBAC không phân role nội bộ org** (kế thừa F0/F2/F3): mọi user `active`
  của org được xem chi tiết bất kỳ Device nào thuộc org mình — `DevicePolicy
  #show?` luôn `true`, `Scope#resolve` tái dùng nguyên vẹn từ F2/F3.
  Input bị chặn: user `inactive`/không có token hợp lệ → `401` (A13), chưa
  đăng nhập → redirect `/login` (A14).
- **Retired bất biến** (`CLAUDE.md` §4): F4 không thêm mutation mới, chỉ tái
  xác nhận UI đọc đúng `status` để ẩn/disable "Sửa" + hiện banner (A4);
  backend chặn sửa retired đã có sẵn từ F3 (không lặp lại rule ở F4).
- **Không bịa dữ liệu Group/Policy**: response `GET /api/v1/devices/:id`
  không có field `groups`/`applied_policies` (F4 chưa có model tương ứng) —
  2 khối FE hiển thị empty tĩnh dựa trên thực tế chưa có tính năng, không
  dựa trên field rỗng giả từ API (xem OQ-1, OQ-6).

## §7. UI state
- Loading: skeleton toàn trang (Header + 2 khối) lúc gọi `GET
  /api/v1/devices/:id` lần đầu; không loading riêng từng khối ở F4 (xem
  "Rủi ro/giả định" — khác `UI_UX_design.md` §5, sẽ tách khi F6/F9 thêm API
  riêng cho từng khối).
- Empty: khối "Groups đang thuộc"/"Policy đang áp dụng" luôn hiện text empty
  tĩnh ("Chưa thuộc group nào."/"Chưa có policy nào áp dụng.") — đây là
  trạng thái duy nhất có thể có ở F4, không phải 1 trong nhiều trạng thái.
- Error: `404` → trang "Không tìm thấy thiết bị" (không phải banner, thay
  hẳn nội dung trang) + nút quay lại danh sách; `500`/network → banner đỏ
  toàn trang + nút "Thử lại"; `401` → redirect `/login`.
- Success: Header hiện đầy đủ thông tin + nút "Sửa" (nếu không retired) hoặc
  banner retired (nếu retired).

## §8. Data & API touchpoint
- Model/field liên quan: `Device` (đã có từ F2, không đổi schema).
- Endpoint dự kiến: `GET /api/v1/devices/:id` (mới, chốt shape response +
  case lỗi ở `/design F4`).
- Route FE mới: `/devices/:id` → `DeviceDetailView.vue`.
- Route/component F2/F3 bị sửa: `DeviceListView.vue`/`DataTable.vue` thêm
  hành vi click row + action "Xem chi tiết" (chi tiết UI ở `/design F4`).

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), thuộc org của device, `status
  == active` mới gọi được `GET /api/v1/devices/:id` thành công.
- Không phân role nội bộ org (giống toàn bộ F0/F2/F3) — `DevicePolicy#show?`
  luôn `true` cho user active của org, org-scope là ranh giới thật (qua
  `Scope#resolve`).
- Org-scope check bắt buộc: `policy_scope(Device)`/`current_organization
  .devices`, không bao giờ `Device.find` trần (`CLAUDE.md` §4).

## §10. Non-functional (performance/scale)
- Không liên quan tới group/list lớn ở phạm vi F4 (chỉ fetch 1 record theo
  primary key, đã có index). Cân nhắc hiệu năng cho "Policy đang áp dụng"
  (tính toán trên group lớn) thuộc phạm vi F9, không phải F4.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Xem chi tiết Device thành công
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy đầy đủ thông tin: identifier, name, platform, os_version, status, last_seen_at
  And tôi thấy khối "Groups đang thuộc" hiện "Chưa thuộc group nào."
  And tôi thấy khối "Policy đang áp dụng" hiện "Chưa có policy nào áp dụng."

Scenario: Xem chi tiết Device thuộc Organization khác trả về 404
  Given Organization "Globex Corp." có Device "IPHONE-777"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/devices/:id" với id của Device "IPHONE-777"
  Then tôi nhận về lỗi "404"

Scenario: Xem chi tiết Device không tồn tại trả về 404
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Device với id không tồn tại trong hệ thống
  Then tôi thấy trang "Không tìm thấy thiết bị"
  And tôi thấy nút quay lại danh sách

Scenario: Xem chi tiết Device với id sai định dạng không làm lộ lỗi hạ tầng
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/devices/:id" với id không phải số nguyên hợp lệ
  Then tôi nhận về lỗi "404", không phải "500"

Scenario: Device retired ẩn nút Sửa và hiện banner bất biến
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "retired"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi không thấy nút "Sửa" hoạt động được
  And tôi thấy banner "Thiết bị đã retired — không thể chỉnh sửa."

Scenario: Device không retired hiện nút Sửa và mở đúng form sửa của F3
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  When tôi mở trang chi tiết Device "IPHONE-001" và bấm "Sửa"
  Then form sửa mở ra với dữ liệu được prefill đúng từ Device "IPHONE-001"

Scenario: Sửa thành công từ trang chi tiết cập nhật Header ngay lập tức
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  And tôi đang ở trang chi tiết Device "IPHONE-001"
  When tôi sửa status của Device đó thành "retired" và lưu thành công
  Then tôi thấy toast "Đã cập nhật device"
  And banner "Thiết bị đã retired — không thể chỉnh sửa." xuất hiện ngay trên trang, không cần tải lại trang

Scenario: Click vào 1 dòng ở Devices List điều hướng tới trang chi tiết
  Given Organization "Acme Inc." có Device "IPHONE-001"
  When tôi ở trang Devices List và click vào dòng của Device "IPHONE-001"
  Then tôi được điều hướng tới trang chi tiết của đúng Device "IPHONE-001"

Scenario: Action "Xem chi tiết" trên Devices List điều hướng tới trang chi tiết
  Given Organization "Acme Inc." có Device "IPHONE-001"
  When tôi ở trang Devices List và bấm action "Xem chi tiết" của dòng Device "IPHONE-001"
  Then tôi được điều hướng tới trang chi tiết của đúng Device "IPHONE-001"
  And hành động này không đồng thời kích hoạt điều hướng của việc click dòng

Scenario: Vào thẳng URL chi tiết Device không qua danh sách vẫn tải đúng dữ liệu
  Given Organization "Acme Inc." có Device "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở thẳng URL "/devices/:id" của Device "IPHONE-001" trên trình duyệt
  Then tôi thấy đầy đủ thông tin của đúng Device "IPHONE-001"

Scenario: Quay lại danh sách giữ nguyên filter và trang đã xem trước đó
  Given tôi đang ở Devices List với filter platform "ios" ở trang 2
  When tôi click vào 1 dòng device rồi bấm "◀ Quay lại danh sách"
  Then tôi quay về Devices List với filter platform "ios" ở trang 2, không bị reset

Scenario: Lỗi hạ tầng khi tải trang chi tiết hiện banner và cho thử lại
  Given API "GET /api/v1/devices/:id" đang trả lỗi 500/network
  When tôi mở trang chi tiết 1 Device
  Then tôi thấy banner lỗi cùng nút "Thử lại", không phải trang trắng

Scenario: Gọi API chi tiết Device mà không có token
  When tôi gọi "GET /api/v1/devices/:id" mà không có Authorization header
  Then tôi nhận về lỗi "401"

Scenario: Gọi API chi tiết Device bằng token đã hết hạn
  Given tôi có một token đã hết hạn
  When tôi gọi "GET /api/v1/devices/:id" bằng token đó
  Then tôi nhận về lỗi "401"

Scenario: Chưa đăng nhập truy cập thẳng URL chi tiết Device bị chuyển hướng
  Given tôi chưa đăng nhập
  When tôi mở thẳng URL "/devices/:id" trên trình duyệt
  Then tôi bị chuyển hướng tới trang đăng nhập
```

## §12. Decisions & Open questions
| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | Group/Policy model chưa tồn tại khi build F4 (F5–F9 nằm sau, không phải dependency của F4). Khối "Groups đang thuộc"/"Policy đang áp dụng" nên xử lý sao? | Dựng khung trang + component thật theo đúng layout `UI_UX_design.md` §5, nhưng nội dung 2 khối này ở dạng empty tĩnh (không gọi API riêng, không tạo schema Group/Policy) — F6 (groups)/F9 (policy resolution) quay lại thay bằng dữ liệu/logic thật mà không đổi route/layout đã chốt. | Đồng ý theo khuyến nghị. |
| OQ-2 | Cách hiện action "Xem chi tiết" trên Devices List — thêm menu "⋯" gộp "Sửa"+"Xem chi tiết" đúng mockup `UI_UX_design.md` §4, hay giữ 2 nút rời (đơn giản hơn, F3 đã có "Sửa" đứng riêng)? | Đổi sang menu "⋯" dùng chung (component mới, tái dùng được ngay cho Groups §6.1/Policies list sau này — đỡ phải đổi lại UI 1 lần nữa khi F5/F7 tới). | Đồng ý theo khuyến nghị. |
| OQ-3 | Nút "⋯" ở header Device Detail (mockup §5) hiện chưa có action thật nào (PRD không có "Xóa Device"). Có render menu này (trống/disable) không? | Không render — vi phạm "không nút chết"; thêm lại khi F6/F8 có action thật cần đặt ở đó (hoặc xác nhận các nút đó vốn nằm trong từng khối bên dưới, không phải trong "⋯" header). | Đồng ý theo khuyến nghị. |
| OQ-4 | Sửa Device từ trang chi tiết — mở modal riêng hay tái dùng nguyên `DeviceFormModal` đã có từ F3? | Tái dùng nguyên vẹn `DeviceFormModal`/`FormModal` từ F3, chỉ đổi hành vi sau khi lưu thành công (refetch detail thay vì refresh list). | Đồng ý theo khuyến nghị. |
| OQ-5 | "◀ Quay lại danh sách" có giữ filter/trang đã xem trước đó không? | Có — dùng lại query string đã lưu (giống cách F2 lưu filter vào URL), fallback `/devices` không filter nếu vào thẳng bằng URL chi tiết (không có lịch sử điều hướng hợp lệ trong app). | Đồng ý theo khuyến nghị. |
| OQ-6 | Response `GET /api/v1/devices/:id` có nên thêm field rỗng `groups: []`/`applied_policies: []` ngay từ F4 để tránh đổi contract sau (F6/F8/F9)? | Không thêm — giữ response chỉ gồm thuộc tính Device; tránh bịa 1 contract mà feature sau có thể cần thiết kế khác (vd `applied_policies` có thể cần field `source`/`overridden_by` phức tạp hơn 1 mảng rỗng). FE tự vẽ empty tĩnh dựa trên thực tế chưa có tính năng, không dựa vào field response. | Đồng ý theo khuyến nghị. |

**Rủi ro/giả định:**
- `UI_UX_design.md` §5 mô tả loading/error **tách riêng cho cả 3 khối** (vì
  khối policy giả định phải tính toán, có thể chậm hơn khối info). Ở F4,
  cả 3 khối cùng đến từ 1 response duy nhất (`GET /api/v1/devices/:id`) nên
  loading/error được gộp chung cho toàn trang — đây là sai khác có chủ đích
  so với mockup, cần ghi vào `DESIGN.md` khi implement; F9 (khi thêm tính
  toán resolution thật, có thể chậm với group 10k device) sẽ là lúc tách
  khối "Policy đang áp dụng" ra 1 API/loading riêng đúng như mockup.
- Nếu approve chọn KHÔNG theo khuyến nghị OQ-1 (vd muốn F4 đã tạo sẵn bảng
  `groups`/`policies` rỗng để F5–F9 khỏi phải migrate lại) thì đây là thay
  đổi phạm vi đáng kể, cần quay lại chỉnh `docs/backlog.md` (dependency của
  F5/F7 sẽ phải thêm F4) trước khi `/design F4`.

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật, bỏ tag, rồi mới set `status: approved` ở đầu file. (Ghi
chú: ở bản draft này, mọi scenario được viết thẳng theo phương án khuyến
nghị và **không** gắn tag `(pending OQ-n)` vì không có nhánh hành vi khác
nhau rõ rệt giữa các phương án ở mức acceptance criteria — trừ khi approve
chọn khác khuyến nghị, lúc đó cần bổ sung/sửa scenario tương ứng, đặc biệt
OQ-2 sẽ đổi cách UI test tìm action "Xem chi tiết" trong step definition.)
