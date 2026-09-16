---
feature_id: F3
title: Device create/edit + validate (identifier unique trong org)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

## §1. Meta
- Feature: `F3` — Device create/edit + validate (identifier unique trong org)
- Dependency: `F2` (Device list — approved, xem `docs/sot/F2-device-list.md`,
  `docs/design/F2-{db,api,frontend}.md`; model `Device`, bảng `devices`,
  `DevicePolicy`/`DevicePolicy::Scope`, component `DataTable`/`FilterBar`/
  `PaginationBar`/`EmptyState`/`ErrorState` đã tồn tại — F3 **không** đổi
  schema/route `/devices` hiện có, chỉ thêm hành vi ghi dữ liệu lên đúng nền
  đó)
- Nguồn: `PRD.md` §"Device" (field/status/unique/retired bất biến), bảng
  "Giao diện bắt buộc" (dòng "Devices": "tạo / sửa"), §"Chất lượng kỹ thuật",
  §"Yêu cầu chỉnh chu" (validate form, message lỗi từ API hiện ra được),
  `docs/backlog.md` mục F3, `UI_UX_design.md` §4 ("Tạo/Sửa Device" — modal),
  §0 (nguyên tắc chung), §9/§10 (ma trận loading/empty/error, quy tắc validate),
  `CLAUDE.md` §4 (org isolation, unique-per-org, retired bất biến).

**Scope note:** `docs/backlog.md` xếp F2 → F3 → F4 tuần tự. F2 đã cố ý **không**
làm nút "+ Thêm Device", cột hành động `⋯`, hay click-through vào row (tránh
nút chết vì trang đích/modal chưa tồn tại — `docs/sot/F2-device-list.md` §3).
F3 kích hoạt phần "tạo/sửa" của bảng "Giao diện bắt buộc"; phần "vào chi
tiết" (route `/devices/:id`, click-through row) vẫn thuộc F4 và **chưa** được
bật ở F3 — xem thêm §3.

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **tạo mới** một Device
(khai báo identifier/name/platform/os_version) và **sửa** thông tin một
Device đã có (miễn là nó chưa `retired`) — để duy trì đúng danh sách thiết bị
đang được tổ chức tôi quản lý, với validate rõ ràng (identifier không được
trùng trong tổ chức mình, không được sửa thiết bị đã "khóa" ở trạng thái
`retired`) và không bao giờ động chạm tới dữ liệu của Organization khác.

## §3. Scope
**Trong phạm vi:**
- Endpoint `POST /api/v1/devices` (tạo mới) — org-scope tuyệt đối: device
  luôn được gán vào `current_organization`, không nhận `organization_id` từ
  client dưới bất kỳ hình thức nào (kế thừa nguyên tắc đã có ở F2).
- Endpoint `PATCH /api/v1/devices/:id` (sửa) — lấy record qua
  `policy_scope(Device)`/`current_organization.devices` (không bao giờ
  `Device.find` trần), 404 nếu `:id` thuộc Organization khác hoặc không tồn
  tại (không phải 403 — `CLAUDE.md` §4).
- Form Tạo: field `identifier` (bắt buộc), `name` (bắt buộc), `platform`
  (bắt buộc, enum `ios`/`android`/`macos`), `os_version` (tùy chọn). `status`
  **không** hiện trên form tạo, luôn mặc định `active` (server ép, không
  nhận từ client — xem OQ-2).
- Form Sửa: field `name`, `platform`, `os_version`, `status` (enum
  `active`/`inactive`/`retired`) có thể sửa. `identifier` hiển thị nhưng
  **disable** (không sửa được) — xem OQ-1.
- **Retired bất biến** (`CLAUDE.md` §4, invariant bị chấm nặng): mọi yêu cầu
  sửa nhắm tới 1 Device đang có `status == "retired"` bị chặn **toàn bộ**
  (không field nào được đổi), trả `422` rõ ràng — không làm luồng un-retire
  (mặc định theo `docs/backlog.md` "Ngoài phạm vi").
- Validate **identifier unique trong Organization** (không unique toàn hệ
  thống) cho cả tạo mới lẫn (không áp dụng cho sửa vì identifier bất biến khi
  sửa) — message lỗi tiếng Việt rõ ràng theo `UI_UX_design.md` §10.
- Kích hoạt UI: nút "+ Thêm Device" (mở modal tạo), hành động "Sửa" theo
  từng dòng trong bảng Devices List (mở modal sửa, disable kèm tooltip nếu
  device `retired` — `UI_UX_design.md` §4 dòng 128), modal tạo/sửa dùng
  chung 1 component (`FormModal.vue` theo `UI_UX_design.md` §8), toast báo
  kết quả, lỗi field-level bám field + banner chung cho lỗi không thuộc 1
  field cụ thể (`UI_UX_design.md` §0.4, §9, §10).
  - Empty state của Devices List (F2 A1: "Không có thiết bị nào") nay có
    thêm CTA "+ Thêm Device" — F2 SoT §7 đã ghi rõ đây là phần "F3 sẽ bổ
    sung".
- Pundit: `DevicePolicy` thêm `create?`/`update?` (kế thừa style `index?` đã
  có — không phân role nội bộ org, luôn `true` cho user `active` của org),
  `Scope#resolve` tái dùng nguyên vẹn từ F2 cho việc tìm record khi sửa.

**Ngoài phạm vi** (khớp `docs/backlog.md`/`CLAUDE.md` §4 — không tự thêm):
- "Xem chi tiết" / click-through vào `/devices/:id`, cột `⋯` gộp cả "Sửa" và
  "Xem chi tiết" như mockup đầy đủ ở `UI_UX_design.md` §4 — route detail
  chưa tồn tại (F4). F3 chỉ thêm 1 hành động "Sửa" độc lập theo dòng, **không**
  làm menu `⋯`, **không** click-through row (đúng nguyên tắc "không nút
  chết" — `UI_UX_design.md` §0.1, cùng cách F2 đã làm với chính hành động
  "Sửa" trước đây).
- Xóa Device — bảng "Giao diện bắt buộc" của PRD chỉ liệt kê "tạo / sửa" cho
  trang Devices (khác Groups có "xóa" rõ ràng) — không tự thêm quyền xóa
  Device.
- Un-retire (đổi `retired` về `active`/`inactive`) — mặc định không làm
  (`CLAUDE.md` §4, `docs/backlog.md`).
- Gán Group/Policy cho Device qua form này — thuộc F6 (group membership) và
  F8 (policy assignment), không phải F3.
- Sửa/hiển thị `last_seen_at` qua form tạo/sửa — đây là field hệ thống tự ghi
  nhận (device tự báo cáo), PRD không mô tả bất kỳ luồng nhập tay nào cho
  field này; F3 không tự bịa thêm 1 cơ chế cập nhật `last_seen_at`.
- Import hàng loạt (bulk create) Device — PRD không nhắc tới.
- Đổi schema/field mới ngoài những gì F2 đã định nghĩa cho `Device` — F3
  dùng nguyên model hiện có.

## §4. Main flow
**Tạo mới:**
1. User (đã đăng nhập, org `active`) đang ở `/devices`, bấm "+ Thêm Device"
   → modal Tạo mở ra với form trống (`identifier`, `name`, `platform`,
   `os_version`; không có field `status`).
2. User nhập dữ liệu, bấm "Lưu" → FE validate client-side cơ bản (required,
   platform phải chọn 1 giá trị hợp lệ) trước khi gọi API.
3. FE gọi `POST /api/v1/devices` với body đã nhập; nút "Lưu" disable + hiện
   spinner trong lúc chờ (`UI_UX_design.md` §0.4).
4. BE tạo `Device` thuộc `current_organization`, ép `status = active`, chạy
   validate (presence, platform/status enum, identifier unique trong org).
5. Thành công (`201`) → FE đóng modal, hiện toast "Đã tạo device", refresh
   danh sách tại đúng filter/trang hiện tại (`UI_UX_design.md` §4).
6. Thất bại (`422`) → modal **không đóng**, lỗi field-level hiện ngay dưới
   field tương ứng, giữ nguyên dữ liệu user đã nhập để sửa lại.

**Sửa:**
1. User bấm "Sửa" trên 1 dòng device có `status != retired` → modal Sửa mở
   ra, prefill từ dữ liệu dòng đó (đã có sẵn trong response list, **không**
   cần gọi thêm API); `identifier` hiển thị nhưng disable, `status` hiển thị
   và sửa được.
2. User đổi 1 hoặc nhiều field cho phép, bấm "Lưu" → FE validate client-side
   cơ bản rồi gọi `PATCH /api/v1/devices/:id` với body chỉ gồm field cho
   phép sửa.
3. BE tìm record qua `policy_scope(Device)` (404 nếu không thuộc org hiện
   tại) → **kiểm tra retired trước tiên**: nếu `status` hiện tại (trước khi
   áp thay đổi) là `retired` → chặn toàn bộ, trả `422` ngay, không chạy
   validate field nào khác.
4. Nếu không retired: chạy validate (platform/status enum, name presence),
   áp thay đổi.
5. Thành công (`200`) → đóng modal, toast "Đã cập nhật device", refresh danh
   sách tại đúng filter/trang hiện tại.
6. Thất bại (`422`) → modal không đóng, lỗi hiện theo field (validate
   thường) hoặc banner chung (chặn vì retired — không phải lỗi của 1 field
   cụ thể).

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- User mở modal Tạo/Sửa rồi bấm "Hủy" (hoặc đóng modal) → không gọi API,
  không có thay đổi nào tới danh sách.
- Nút "Sửa" trên dòng có `status == retired` bị **disable sẵn** kèm tooltip
  "Thiết bị đã retired, không thể sửa" (`UI_UX_design.md` §4 dòng 128) —
  user không mở được modal Sửa cho device này từ UI, dù backend vẫn phải tự
  chặn độc lập nếu request tới thẳng API (không dựa vào FE disable —
  `CLAUDE.md` §4 "validate ở service layer, không chỉ ở UI").
- Sau khi tạo/sửa thành công, danh sách refresh **đúng filter/trang hiện
  tại** (không tự nhảy về trang chứa record vừa tạo/sửa) — nếu kết quả
  khiến record đó không còn khớp filter đang áp (vd sửa `status` từ
  `active` sang `retired` trong khi đang lọc `status=active`), record biến
  mất khỏi view hiện tại — đây là hành vi đúng, không phải lỗi.

### 5.2 Edge case
- A1. Tạo Device với `identifier` đã tồn tại trong **cùng** Organization →
  `422`, lỗi field-level trên `identifier`.
- A2. Tạo Device với `identifier` trùng với 1 Device thuộc Organization
  **khác** → tạo **thành công** bình thường (unique theo org, không unique
  toàn hệ thống — `CLAUDE.md` §4).
- A3. Tạo Device thiếu field bắt buộc (`identifier`/`name`/`platform` trống)
  → `422` với lỗi field-level cho **từng** field thiếu, gộp chung 1 response
  (không dừng ở field đầu tiên rồi bỏ qua field còn lại).
- A4. Tạo hoặc Sửa Device với `platform` không nằm trong enum hợp lệ (vd
  `platform=windows`) → `422` field-level trên `platform`, không để lộ lỗi
  hạ tầng (`ArgumentError`/500) khi giá trị lạ chạm tới enum của
  ActiveRecord.
- A5. Sửa Device với `status` không nằm trong enum hợp lệ (vd
  `status=deleted`) → `422` field-level trên `status`, tương tự A4.
- A6. Sửa 1 Device đang **không** `retired`, đổi field cho phép
  (`name`/`platform`/`os_version`) → thành công, `identifier` không đổi dù
  có gửi hay không.
- A7. Sửa 1 Device đang **không** `retired`, đổi `status` sang `retired` →
  thành công (đây là luồng "chuyển VÀO retired", khác với sửa 1 record ĐÃ
  `retired`).
- A8. Sửa 1 Device **đang** `retired` — bất kỳ field nào, kể cả gửi lại
  đúng giá trị hiện có (no-op) → toàn bộ request bị chặn, `422`, không field
  nào bị đổi (xem OQ-3, OQ-4).
- A9. Gửi kèm `organization_id` khác trong body khi tạo/sửa (cố tình) → bị
  bỏ qua hoàn toàn, device luôn thuộc `current_organization` của token đang
  dùng — không có cách nào qua param này khiến device thuộc/bị đọc bởi org
  khác.
- A10. Gọi `PATCH /api/v1/devices/:id` với `:id` thuộc Organization khác
  (đoán ID) → `404` (không phải `403` — `CLAUDE.md` §4, không lộ sự tồn
  tại của resource).
- A11. Gửi `identifier` khác giá trị hiện có trong body khi sửa (dù FE đã
  disable field) → bị bỏ qua, `identifier` giữ nguyên giá trị ban đầu, **không**
  phải lỗi (server không tin tưởng riêng vào việc FE disable input — xem
  OQ-1).
- A12. Race condition: 2 request tạo Device cùng `identifier` trong cùng
  Organization gần như đồng thời (đụng độ qua mặt validate tầng ứng dụng) →
  chỉ 1 request thành công; request còn lại nhận `422` lỗi trùng identifier
  giống hệt A1 (không phải `500` do vi phạm unique index ở DB — index
  `(organization_id, identifier)` đã có sẵn từ F2).
- A13. Lỗi hạ tầng (500/network) khi submit form → banner đỏ trên đầu form
  "Có lỗi xảy ra, vui lòng thử lại." (`UI_UX_design.md` §9), modal **không**
  tự đóng, dữ liệu user đã nhập không bị mất.
- A14. Gọi API tạo/sửa Device không có `Authorization` header hoặc token hết
  hạn/không hợp lệ → `401` (tái sử dụng `Authenticatable` concern đã có từ
  F0, không thiết kế lại).

## §6. Business rule & validation
- **Org-scope tuyệt đối** (`CLAUDE.md` §4): tạo mới luôn gán
  `current_organization`; sửa luôn tìm record qua `policy_scope(Device)`/
  `current_organization.devices`. Input hợp lệ: response chỉ thao tác trên
  Device của org gắn với token đang dùng. Input bị chặn: `organization_id`
  từ client bị bỏ qua (A9); `:id` thuộc org khác → 404, không 403 (A10).
- **Identifier**: bắt buộc khi tạo, unique **trong Organization** (không
  unique toàn hệ thống). Input hợp lệ: chuỗi không trùng bất kỳ Device nào
  khác **cùng org** (được phép trùng Device ở org khác — A2). Input bị chặn:
  trùng trong cùng org (A1, A12) → `422` message tiếng Việt rõ ràng theo
  `UI_UX_design.md` §10 (vd: "Identifier này đã tồn tại trong tổ chức của
  bạn."). **Bất biến sau khi tạo** (OQ-1): input gửi kèm khi sửa bị bỏ qua,
  không lỗi, không đổi (A11).
- **Name**: bắt buộc cả khi tạo lẫn sửa. Input bị chặn: trống (A3).
- **Platform**: bắt buộc khi tạo, enum `ios`/`android`/`macos`. Input bị
  chặn: trống khi tạo (A3), giá trị ngoài enum khi tạo hoặc sửa (A4).
- **Status**: **không** nhận từ client khi tạo — server luôn ép `active`
  (OQ-2). Khi sửa: enum `active`/`inactive`/`retired`. Input bị chặn: giá
  trị ngoài enum (A5).
- **os_version**: tùy chọn, không có ràng buộc enum, không bắt buộc (kế thừa
  nguyên trạng từ F2 — không thêm ràng buộc mới).
- **Retired bất biến** (`CLAUDE.md` §4 — invariant cốt lõi bị chấm nặng):
  input hợp lệ = sửa 1 Device có `status` hiện tại **khác** `retired` (A6,
  A7). Input bị chặn = sửa (bất kỳ field nào, kể cả no-op) 1 Device có
  `status` hiện tại **là** `retired` (A8) → `422` rõ ràng, không phải lỗi
  của 1 field cụ thể (xem OQ-3, OQ-4), không có luồng un-retire (mặc định
  theo `docs/backlog.md`).
- **Auth** (kế thừa F0, không phải rule mới của F3): input hợp lệ = Bearer
  token của user `active`; input bị chặn = thiếu/sai/hết hạn token → `401`
  (A14).

## §7. UI state
Theo `UI_UX_design.md` §0.4, §9, §10 — không lặp lại chi tiết, chỉ liệt kê
điểm phải khớp business rule ở §6:
- **Mở modal Sửa**: không có loading state riêng — dữ liệu prefill từ row
  đã có sẵn trong response list (F2), không gọi thêm API `GET`.
- **Submit** (tạo hoặc sửa): nút "Lưu" disable + spinner trong nút trong lúc
  chờ response; không cho bấm "Lưu" lần 2 khi đang chờ (chặn double-submit).
- **Lỗi validate field-level** (422 thường — A1, A3, A4, A5): lỗi hiện ngay
  dưới field tương ứng theo key trả về từ API, modal không đóng.
- **Lỗi chặn vì retired** (A8): banner đỏ trên đầu form (không map field cụ
  thể — không có field nào "sai", cả request bị từ chối), modal không đóng.
- **Lỗi hạ tầng** (A13): banner đỏ "Có lỗi xảy ra, vui lòng thử lại." trên
  đầu form, modal không đóng, dữ liệu đã nhập giữ nguyên.
- **Thành công**: đóng modal, toast xác nhận ("Đã tạo device" / "Đã cập nhật
  device"), danh sách refresh tại đúng filter/trang hiện tại (§5.1).
- **Empty state Devices List** (kế thừa F2 A1): nay có thêm CTA "+ Thêm
  Device" (F2 SoT §7 đã chừa chỗ cho F3 bổ sung).
- **Nút "Sửa" trên device `retired`**: disable + tooltip, không phải trạng
  thái lỗi — là trạng thái tĩnh của UI theo dữ liệu hiện có.

## §8. Data & API touchpoint
- Model: `Device` đã tồn tại từ F2 (`api/app/models/device.rb`,
  `api/db/schema.rb`) — F3 **không** đổi schema/field, chỉ thêm code path
  ghi dữ liệu (validate hiện có: presence `identifier`/`name`/`platform`/
  `status`, uniqueness `identifier` scope `organization_id` — tái dùng
  nguyên vẹn, có thể cần thêm 1 validation mới cho "retired bất biến", chốt
  cụ thể ở `/design F3` DB).
- Endpoint dự kiến:
  - `POST /api/v1/devices` — body: `identifier`, `name`, `platform`,
    `os_version` (optional); server tự gán `organization_id` +
    `status = active`, bỏ qua field khác nếu client gửi kèm (A9, OQ-2) →
    `201` + device serialize (shape giống item trong `GET /devices` đã
    chốt ở `docs/design/F2-api.md` §1) hoặc `422`.
  - `PATCH /api/v1/devices/:id` — body: subset của `name`, `platform`,
    `os_version`, `status`; `identifier`/`organization_id` bị bỏ qua nếu
    gửi kèm (A9, A11, OQ-1) → `200` + device serialize, `422` (validate
    hoặc chặn retired), hoặc `404` (cross-org, A10).
  - Shape lỗi cụ thể cho "chặn vì retired" (key nào trong `errors`, hay dùng
    envelope `{"error": "..."}` khác) — chốt ở `/design F3` API (xem OQ-4).
- Pundit: `DevicePolicy` thêm `create?` (luôn `true` cho user `active`,
  không phân role — giữ style `index?` đã có), `update?` (luôn `true` cho
  user `active` — quyết định "được sửa hay không vì retired" là business
  rule ở tầng model/service, **không** phải authorization theo role, nên
  không đặt trong `update?` — tránh nhầm 404/403; giữ đúng CLAUDE.md §4:
  chặn retired phải trả `422`, không phải `403`/`404`). `Scope#resolve` tái
  dùng nguyên vẹn từ F2 cho việc `policy_scope(Device).find(params[:id])`.
- Auth: tái dùng `Authenticatable` concern đã có từ F0 — không thiết kế lại.

## §9. RBAC / Authorization
- Không có role trong nội bộ 1 Organization (kế thừa quyết định F0/F2 — xem
  `docs/sot/F0-foundation.md` §3/§9, `docs/sot/F2-device-list.md` §9). Mọi
  user `active` của 1 org có quyền tạo/sửa Device của org đó như nhau,
  không phân biệt.
- Authorization thực chất là 2 lớp: (1) org-scope check bắt buộc — mọi
  request `POST`/`PATCH` không bao giờ tạo/đọc/sửa Device của org khác (A9,
  A10, §6); (2) business rule "retired bất biến" nằm ở tầng model/service
  (không phải Pundit `update?`) — trả `422`, không `403`, để không lẫn với
  authorization thật. Đây tiếp tục là điểm bị chấm nặng theo `PRD.md`
  §"Cách chấm" — phải có test riêng cho cross-org (404) và cho retired-block
  (422) tách biệt nhau.

## §10. Non-functional (performance/scale)
- Tạo/sửa là ghi 1 record đơn lẻ, không liên quan tới kịch bản "Group 10.000
  device" của `CLAUDE.md` §4 (đó là F6/F8) — không có ngưỡng hiệu năng đặc
  biệt cần thiết kế ở F3.
- Race condition tạo trùng identifier (A12) đã được chặn ở tầng DB (unique
  index `(organization_id, identifier)` có sẵn từ F2) — không cần
  lock/transaction ứng dụng phức tạp, chỉ cần rescue exception vi phạm
  unique index thành `422` cùng message với validate thường (không để lộ
  `500`).

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Tạo Device thành công với dữ liệu hợp lệ
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo mới Device với identifier "IPHONE-001", name "iPhone của Alice", platform "ios"
  Then Device được tạo thành công thuộc Organization "Acme Inc."
  And Device mới có status mặc định "active"
  And tôi thấy toast "Đã tạo device"

Scenario: Tạo Device thất bại vì identifier trùng trong cùng Organization
  Given Organization "Acme Inc." đã có Device với identifier "IPHONE-001"
  When tôi tạo mới Device khác cũng với identifier "IPHONE-001" trong "Acme Inc."
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho "identifier"

Scenario: Tạo Device thành công dù identifier trùng với Device ở Organization khác
  Given Organization "Globex Corp." đã có Device với identifier "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc." (chưa có Device nào identifier này)
  When tôi tạo mới Device với identifier "IPHONE-001" trong "Acme Inc."
  Then Device được tạo thành công thuộc "Acme Inc."

Scenario: Tạo Device thất bại vì thiếu field bắt buộc
  When tôi tạo mới Device mà không điền "identifier", "name" và "platform"
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho cả 3 field đó

Scenario: Tạo hoặc sửa Device thất bại vì platform không hợp lệ
  When tôi tạo mới Device với platform "windows" (không nằm trong enum hợp lệ)
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho "platform"

Scenario: Sửa Device thất bại vì status không hợp lệ
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  When tôi sửa Device đó với status "deleted" (không nằm trong enum hợp lệ)
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho "status"

Scenario: Tạo Device luôn mặc định status active, bỏ qua status client gửi
  When tôi tạo mới Device hợp lệ và cố gắng gửi kèm status "retired" trong request
  Then Device được tạo thành công với status "active", không phải "retired"

Scenario: Sửa Device thành công khi device chưa retired
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  When tôi sửa name, platform và os_version của Device đó
  Then Device được cập nhật thành công với dữ liệu mới
  And tôi thấy toast "Đã cập nhật device"

Scenario: Sửa Device chuyển status sang retired thành công
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "active"
  When tôi sửa status của Device đó thành "retired"
  Then Device được cập nhật thành công với status "retired"

Scenario: Sửa Device bị chặn hoàn toàn khi device đã retired
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "retired"
  When tôi cố gắng sửa bất kỳ field nào của Device đó, kể cả gửi lại đúng giá trị hiện có
  Then tôi nhận về lỗi "422" báo rằng thiết bị đã retired, không thể sửa
  And không field nào của Device thực sự bị thay đổi

Scenario: Không thể đổi identifier khi sửa Device dù cố gửi giá trị khác
  Given Organization "Acme Inc." có Device với identifier "IPHONE-001" đang status "active"
  When tôi gửi request sửa Device đó kèm identifier mới "IPHONE-999"
  Then request vẫn thành công nhưng identifier của Device vẫn là "IPHONE-001"

Scenario: Tạo hoặc sửa Device bỏ qua organization_id client gửi kèm
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gửi request tạo Device kèm organization_id của Organization "Globex Corp."
  Then Device được tạo thành công thuộc "Acme Inc.", không phải "Globex Corp."

Scenario: Sửa Device thuộc Organization khác trả về 404
  Given Organization "Globex Corp." có Device "IPHONE-777"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "PATCH /api/v1/devices/:id" với id của Device "IPHONE-777"
  Then tôi nhận về lỗi "404"

Scenario: Tạo Device đồng thời với cùng identifier chỉ 1 request thành công
  Given Organization "Acme Inc." chưa có Device nào identifier "IPHONE-001"
  When 2 request tạo Device cùng identifier "IPHONE-001" trong "Acme Inc." được gửi gần như đồng thời
  Then chỉ 1 request thành công "201"
  And request còn lại nhận lỗi "422" kèm thông báo lỗi field-level cho "identifier"

Scenario: Lỗi hạ tầng khi submit form giữ nguyên dữ liệu đã nhập
  Given API tạo Device đang trả lỗi 500/network
  When tôi submit form tạo Device với dữ liệu hợp lệ
  Then tôi thấy banner lỗi "Có lỗi xảy ra, vui lòng thử lại." trên đầu form
  And modal không tự đóng, dữ liệu tôi đã nhập vẫn còn nguyên

Scenario: Gọi API tạo Device mà không có token
  When tôi gọi "POST /api/v1/devices" mà không có Authorization header
  Then tôi nhận về lỗi "401"

Scenario: Gọi API sửa Device bằng token đã hết hạn
  Given tôi có một token đã hết hạn
  When tôi gọi "PATCH /api/v1/devices/:id" bằng token đó
  Then tôi nhận về lỗi "401"

Scenario: Nút Sửa bị disable trên danh sách cho Device đã retired
  Given Organization "Acme Inc." có Device "IPHONE-001" đang status "retired"
  When tôi mở trang Devices List
  Then nút "Sửa" của dòng Device đó bị disable
  And tôi thấy tooltip "Thiết bị đã retired, không thể sửa" khi hover vào nút đó
```

## §12. Decisions & Open questions
| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | `identifier` có được sửa sau khi tạo không (ở tầng backend, không chỉ FE disable field)? `UI_UX_design.md` §4 đã disable field này ở FE nhưng không nói backend có tự chặn độc lập hay không. | Không — `identifier` bất biến sau khi tạo. Backend bỏ qua/không cho phép đổi `identifier` ở action sửa (strong params không permit field này cho update), dù client cố gửi giá trị khác cũng không có tác dụng, không báo lỗi (đơn giản, khớp UI, và không dựa vào FE disable làm hàng rào bảo vệ duy nhất — `CLAUDE.md` §4). | Đồng ý theo khuyến nghị. |
| OQ-2 | Form Tạo không hiện field `status` (`UI_UX_design.md` §4: "mặc định active"), nhưng nếu client (API trực tiếp, không qua FE) vẫn gửi kèm `status` khác thì xử lý sao? | Backend luôn ép `status = active` khi tạo mới, bỏ qua hoàn toàn giá trị `status` client gửi (strong params không permit field này cho action create) — không báo lỗi, chỉ âm thầm dùng giá trị mặc định, khớp đúng hành vi form (field không hiện thì không có gì để "gửi sai"). | Đồng ý theo khuyến nghị. |
| OQ-3 | Khi sửa 1 Device đang `retired`, có coi trường hợp gửi lại **y nguyên** giá trị hiện có (no-op, không thực sự đổi gì) là ngoại lệ được phép không? | Không có ngoại lệ — chặn **toàn bộ** update (kể cả no-op) khi `status` hiện tại là `retired`. Đơn giản, đúng nghĩa đen "bất biến" của `CLAUDE.md` §4, và tránh phải cài logic diff phức tạp (so sánh từng field cũ/mới) mà PRD không yêu cầu. | Đồng ý theo khuyến nghị. |
| OQ-4 | Lỗi khi cố sửa Device `retired` hiển thị dạng field-level hay banner chung, và message chính xác là gì? PRD/`UI_UX_design.md` không cho câu chữ cụ thể cho lỗi API (chỉ có tooltip disable ở FE). | Banner chung (không map field cụ thể — đây không phải lỗi của 1 input mà là toàn bộ request bị từ chối; hình dạng JSON chính xác — key `base` trong `errors`, hay envelope `{"error": "..."}` riêng — chốt ở `/design F3` API). Tái dùng **nguyên văn** câu tooltip đã có ở `UI_UX_design.md` §4 dòng 128: "Thiết bị đã retired, không thể sửa" — giữ nhất quán 1 câu duy nhất giữa chặn ở UI (disable) và chặn ở API (422). | Đồng ý theo khuyến nghị; hình dạng JSON cụ thể chốt ở `/design F3` API. |
| OQ-5 | Field nào được phép sửa ở Edit ngoài `status`? Có field nào (dù device chưa retired) vẫn không được sửa? | `name`, `platform`, `os_version`, `status` đều sửa được khi device chưa `retired`; `identifier` không bao giờ sửa được (OQ-1); `last_seen_at`/`organization_id` không expose qua form (hệ thống tự quản, ngoài phạm vi PRD hiện tại — xem §3 "Ngoài phạm vi"). | Đồng ý theo khuyến nghị. |
| OQ-6 | Có cần confirm modal khi sửa Device đổi `status` (đặc biệt là chuyển sang `retired`), tương tự PRD yêu cầu "xóa phải confirm"? PRD chỉ nói rõ confirm cho hành động xóa; F3 không có xóa Device. | Không cần confirm riêng — đổi `status` trong form Sửa vẫn là 1 lần "Lưu" thông thường (không phải hành động phá hủy dữ liệu tức thời như xóa). Nếu sau này muốn cảnh báo thêm khi chuyển sang `retired` (vì sẽ khóa mọi sửa đổi sau đó), có thể bổ sung ở giai đoạn sau nhưng PRD không bắt buộc. | Đồng ý theo khuyến nghị. |
| OQ-7 | Tạo và Sửa dùng chung 1 modal component hay tách 2 form riêng biệt? | Dùng chung 1 `FormModal.vue` (đã định nghĩa ở `UI_UX_design.md` §8), field set thay đổi theo mode (`create`: ẩn `status`; `edit`: disable `identifier`, hiện `status`) — tránh trùng lặp code, đúng tinh thần "modal (không cần trang riêng)" của `UI_UX_design.md` §4. | Đồng ý theo khuyến nghị. |

**Đã approve:** tất cả OQ-1..OQ-7 chốt theo đúng phương án khuyến nghị (không
có thay đổi so với đề xuất của `analyst`); 3 scenario từng gắn tag
`(pending OQ-n)` ở §11 đã bỏ tag, giữ nguyên nội dung vì khớp quyết định
thật.
