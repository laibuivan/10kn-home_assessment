---
feature_id: F5
title: Group CRUD (list/create/edit/xóa an toàn)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

## §1. Meta
- Feature: `F5` — Group CRUD (list/create/edit/xóa an toàn)
- Dependency: `F0` (Foundation + Login — approved, xem `docs/sot/F0-foundation.md`,
  `docs/design/F0-{db,api,frontend}.md`: `Organization`/`User`, JWT
  `Authenticatable`, Pundit `ApplicationPolicy`, `ApplicationController` với
  `rescue_from ActiveRecord::RecordNotFound` → 404 và envelope 422
  `{"errors": {"<field>": ["<msg>"]}}`, `AppShell`, router guard).
  - F5 **không** phụ thuộc F2/F3/F4 về nghiệp vụ, nhưng **tái dùng nguyên vẹn**
    các convention và component đã build ở đó (không thiết kế lại):
    pagination/meta + coerce param của F2 (`docs/design/F2-api.md`),
    modal tạo/sửa + map lỗi 422 field-level của F3 (`FormModal.vue`,
    `docs/design/F3-api.md` §0/§5 kể cả `rescue_from
    ActiveRecord::RecordNotUnique`), `ActionsMenu.vue` (⋯) của F4 —
    component này đã được viết sẵn có chủ đích để Groups/Policies dùng lại
    (comment đầu file `web/src/components/ActionsMenu.vue`), cùng
    `DataTable`/`PaginationBar`/`EmptyState`/`ErrorState`/`ToastContainer`.
  - **Lưu ý sequencing (xem OQ-3)**: `docs/backlog.md` xếp `F6` (Group
    membership tại scale) và `F8` (Policy assignment) **sau** F5. Tại thời
    điểm build F5, bảng `group_memberships`, `policies`, `policy_assignments`
    **chưa tồn tại**. Do đó phần "xóa an toàn" ở F5 chốt **hợp đồng hành vi**
    (transaction, `dependent:` tường minh, không FK cascade ngầm) và để lại
    **nghĩa vụ bắt buộc** cho F6/F8 phải hiện thực hóa khi tạo join table —
    ghi rõ ở §6 và §12 "Rủi ro/giả định".
- Nguồn: `PRD.md` §"Nghiệp vụ" → "Group" (name, description; chứa nhiều
  Device; một Device thuộc nhiều Group; **xóa Group không được để dữ liệu
  liên quan bị treo / sai**) + bảng "Giao diện bắt buộc" dòng "Groups"
  ("Danh sách; tạo / sửa / xóa; chi tiết: thêm/gỡ device, gán policy") +
  §"Yêu cầu chỉnh chu" (loading/rỗng/lỗi, validate form, **xóa phải confirm**,
  phân trang list); `docs/backlog.md` mục F5 + "Dependency" + "Ngoài phạm
  vi"; `UI_UX_design.md` §2 (route `/groups`), §6.1 (Group List — layout,
  search theo tên, cột "Số device", action ⋯, nội dung confirm xóa), §8
  (component dùng chung, có `ConfirmModal.vue` chưa từng được build), §9 (ma
  trận Loading/Empty/Error), §10 (validate & thông báo lỗi); `CLAUDE.md` §4
  (tách Organization tuyệt đối 404-không-403; xóa Group không để dữ liệu
  treo).

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **quản lý danh sách
Group** của tổ chức mình (xem danh sách có phân trang + tìm theo tên, tạo
group mới, sửa tên/mô tả, và xóa group một cách an toàn có xác nhận) — để có
đơn vị nhóm thiết bị phục vụ việc gán Policy hàng loạt sau này, và để chắc
chắn rằng xóa một Group chỉ gỡ các liên kết của nó chứ **không** xóa/làm hỏng
Device hay Policy, cũng không để lại dòng join mồ côi trong DB.

## §3. Scope

**Trong phạm vi:**
- **DB**: bảng `groups` mới (`organization_id` NOT NULL + FK, `name` NOT NULL,
  `description` nullable, timestamps), index phục vụ org-scope + phân trang
  ổn định (`[organization_id, created_at, id]`, đúng pattern `devices` của
  F2) và unique index composite `[organization_id, name]` (xem OQ-1) —
  **unique theo organization, không unique toàn hệ thống** (`CLAUDE.md` §4).
- **Model**: `Group` (`belongs_to :organization`, validate presence/length
  `name`, uniqueness `name` scope `organization_id`), `Organization has_many
  :groups`.
- **API** (namespace `api/v1`, kế thừa envelope lỗi của F0):
  - `GET /api/v1/groups` — phân trang (`page`/`per_page`, meta y hệt F2) +
    tìm theo tên (`q`, xem OQ-6).
  - `POST /api/v1/groups` — tạo (name bắt buộc, description tùy chọn).
  - `PATCH /api/v1/groups/:id` — sửa name/description.
  - `DELETE /api/v1/groups/:id` — xóa an toàn (transaction + gỡ join rows,
    xem §6).
  - Mọi action lấy record qua `policy_scope(Group)` /
    `current_organization.groups`, **không bao giờ** `Group.find` trần.
- **Authorization**: `GroupPolicy` + `GroupPolicy::Scope` (Scope là ranh giới
  org thật, giống `DevicePolicy` của F2).
- **FE**:
  - Route `/groups` + `views/groups/GroupListView.vue` (danh sách, search,
    phân trang, nút "+ Thêm Group", cột ⋯ với "Sửa"/"Xóa").
  - `components/GroupFormModal.vue` (tạo/sửa, dựng trên `FormModal.vue` của
    F3, map lỗi 422 field-level).
  - `components/ConfirmModal.vue` — **component dùng chung mới** theo
    `UI_UX_design.md` §8 (title, message, confirmLabel đỏ nếu destructive,
    nút confirm tự disable + spinner khi đang gọi API). Không dùng
    `window.confirm` (`UI_UX_design.md` §10).
  - `stores/groups.ts`, `api/groups.ts`, `types/group.ts` — cùng khuôn với
    `devices.*`.
  - **Bật mục "Groups" trên sidebar** `AppShell.vue`: hiện đang là
    `<span class="nav-item future">` kèm ghi chú "Groups/Policies ẩn ở F0 —
    hiện khi F5/F7 thêm route". F5 biến nó thành `RouterLink` thật **và**
    chuyển highlight "active" từ hard-code sang theo route hiện tại — đây là
    nghĩa vụ đã được F0 ghi nợ đích danh cho F5/F7
    (`docs/design/F0-frontend.md` §5 risk note, comment trong `AppShell.vue`).
    Mục "Policies" vẫn giữ nguyên dạng chưa-bật cho tới F7.

**Ngoài phạm vi** (khớp `docs/backlog.md` — không tự thêm):
- **Thêm/gỡ Device khỏi Group, bảng `group_memberships`, mọi thao tác hàng
  loạt chịu 10.000 device, idempotency của membership** → thuộc **F6**. F5
  tuyệt đối không tạo bảng join, không thiết kế index cho nó (thiết kế đó
  phụ thuộc yêu cầu scale/idempotent của F6, thiết kế sớm là đoán mò) — xem
  OQ-3.
- **Gán Policy cho Group, bảng `policies`/`policy_assignments`, async job +
  trạng thái pending/running/done/failed** → thuộc **F7/F8**.
- **Trang chi tiết Group `/groups/:id`** (tab Thành viên / tab Policies,
  `UI_UX_design.md` §6.2) → thuộc F6/F8; F5 không render action "Xem chi
  tiết" trong menu ⋯ để không tạo nút chết (`PRD.md` §"Yêu cầu chỉnh chu",
  xem OQ-5).
- **Cột "Số device" (`devices_count`)** trong bảng danh sách
  (`UI_UX_design.md` §6.1) → không có nguồn dữ liệu nào ở F5 (chưa có
  membership); thêm ở F6 (xem OQ-4). Không tạo field rỗng/giả `0` trong
  contract API — cùng lý do đã chốt ở `docs/sot/F4-device-detail.md` OQ-6.
- Màn hình quản lý Organization (PRD: "Không cần").
- Bất kỳ nghiệp vụ nào không có trong `PRD.md` (audit log ai xóa group,
  khôi phục group đã xóa, phân quyền theo role nội bộ org, export...).

## §4. Main flow

**Xem danh sách Group:**
1. User (đã đăng nhập, `active`) bấm "Groups" trên sidebar → điều hướng
   `/groups`.
2. FE gọi `GET /api/v1/groups?page=1` (đồng bộ `page`/`q` vào URL query
   string để share link / F5 giữ nguyên trạng thái — đúng pattern F2).
3. BE: `policy_scope(Group)` → lọc theo `q` (nếu có) → đếm `total_count` trên
   relation đã lọc **trước** limit/offset → trả `groups[]` + `meta`.
4. FE render `DataTable` (Name | Description | ⋯) + `PaginationBar`.

**Tạo Group:**
1. Bấm "+ Thêm Group" → mở `GroupFormModal` (rỗng).
2. Nhập name (bắt buộc) + description (tùy chọn) → Submit → `POST
   /api/v1/groups`.
3. `201` → đóng modal, toast "Đã tạo group", refresh danh sách (về page 1 để
   thấy ngay group vừa tạo — xem OQ-7).
4. `422` → modal **không** đóng, lỗi bám theo đúng field (`name`), giữ nguyên
   dữ liệu user đã nhập.

**Sửa Group:**
1. Trên 1 dòng, mở menu ⋯ → "Sửa" → mở `GroupFormModal` prefill name +
   description của dòng đó.
2. Submit → `PATCH /api/v1/groups/:id`.
3. `200` → đóng modal, toast "Đã cập nhật group", refresh **đúng trang hiện
   tại** (giữ `page`/`q`, không nhảy về page 1 — khác luồng tạo).
4. `422` → như bước 4 của luồng tạo.

**Xóa Group (an toàn, có confirm):**
1. Trên 1 dòng, mở menu ⋯ → "Xóa" → mở `ConfirmModal` (destructive, nút
   "Xóa" đỏ + "Hủy"), nội dung nêu rõ: xóa group sẽ gỡ toàn bộ liên kết của
   group này với device và policy đang gán cho group; **device và policy
   không bị xóa**; hành động không hoàn tác được (xem OQ-2, OQ-4).
2. Bấm "Xóa" → nút disable + spinner → `DELETE /api/v1/groups/:id`.
3. BE trong **một transaction duy nhất**: xóa các join row liên quan tới
   group (`group_memberships`, `policy_assignments` của group — bằng
   `dependent:` tường minh khi các bảng đó tồn tại, xem §6/OQ-3) rồi xóa
   record `groups`. Không dựa vào FK cascade ngầm không khai báo.
4. `204`/`200` → đóng modal, toast "Đã xóa group", refresh danh sách tại
   trang hiện tại (xử lý trang rỗng: xem §5.1).
5. Thất bại → modal đóng/giữ theo loại lỗi (xem §5.2 A12/A13), toast lỗi,
   danh sách **không** bị xóa dòng ở FE khi BE chưa xác nhận (không optimistic
   delete).

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- **Search theo tên** (xem OQ-6): gõ vào ô search → debounce → gọi lại API
  với `q`, **reset về page 1**, cập nhật URL query. Nút "Xóa tìm kiếm" chỉ
  hiện khi đang có `q`.
- **Xóa dòng cuối cùng của trang > 1**: sau khi xóa thành công, refetch trang
  hiện tại; nếu trang đó trả về rỗng mà `current_page > 1` → tự lùi về trang
  `current_page - 1` (không để user nhìn thấy trang trắng "không có group
  nào" trong khi vẫn còn dữ liệu ở trang trước).
- **Vào thẳng URL `/groups?page=3&q=sales`**: trang tự đọc query string và
  fetch đúng, không phụ thuộc state từ điều hướng trước đó (giống F2).
- **Tạo group khi danh sách đang rỗng**: empty state có CTA "+ Thêm Group"
  mở đúng modal tạo (không phải nút trang trí).

### 5.2 Edge case
- A1. `GET/PATCH/DELETE /api/v1/groups/:id` với `:id` thuộc Organization
  khác (đoán ID) → **404**, không phải 403 (`CLAUDE.md` §4 — không lộ sự tồn
  tại của resource).
- A2. `:id` không tồn tại trong hệ thống → **404**.
- A3. `:id` sai định dạng (không phải số nguyên) → **404**, không phải 500 —
  tái dùng `rescue_from ActiveRecord::RecordNotFound` toàn cục của F0 (đã
  xác nhận ở `docs/design/F4-db.md` §4 rằng id phi số không rơi xuống DB
  thành `StatementInvalid`).
- A4. Tạo/sửa group với `name` rỗng hoặc chỉ toàn khoảng trắng → **422**,
  lỗi bám field `name` ("Tên group không được để trống").
- A5. Tạo group trùng `name` với group đã có **trong cùng org** → **422**,
  lỗi bám field `name` ("Tên group này đã tồn tại trong tổ chức của bạn.")
  — xem OQ-1.
- A6. Tạo group trùng `name` với group của **org khác** → **thành công
  (201)** — unique theo organization, không unique toàn hệ thống
  (`CLAUDE.md` §4).
- A7. **Race condition**: 2 request tạo group cùng `name` trong cùng org gần
  như đồng thời → request thua bị unique index chặn ở tầng DB
  (`ActiveRecord::RecordNotUnique`) → **422 trên field `name`**, không phải
  500 — tái dùng đúng pattern đã có cho `Device#identifier`
  (`docs/design/F3-api.md` §5).
- A8. Sửa group giữ nguyên `name` cũ của chính nó (no-op trên name) →
  **200**, không bị báo trùng với chính mình.
- A9. Sửa group đổi `name` thành tên đang bị group khác cùng org dùng →
  **422** (cùng message A5).
- A10. `name`/`description` vượt giới hạn độ dài → **422** bám đúng field
  (xem OQ-8).
- A11. Xóa group **đang có device và/hoặc policy gán** → vẫn xóa được (PRD
  không cấm), nhưng phải gỡ sạch join row trong cùng transaction; **device
  và policy không bị xóa** (kiểm tra được: số lượng device/policy trước và
  sau khi xóa group không đổi). Ở F5 (chưa có join table) đây là **hợp đồng
  hành vi + nghĩa vụ regression test bắt buộc cho F6/F8** — xem OQ-3.
- A12. Xóa/sửa một group mà **user khác vừa xóa xong** (record không còn) →
  **404**; FE hiện toast "Group không tồn tại hoặc đã bị xóa" rồi refresh
  danh sách (không để dòng ma nằm lại trên bảng).
- A13. `DELETE` thất bại do lỗi hạ tầng (500/network) → group **vẫn còn
  nguyên** (transaction rollback, không xóa nửa vời), FE giữ dòng đó trên
  bảng, toast lỗi, không đóng im lặng.
- A14. Danh sách rỗng vì **org chưa có group nào** → EmptyState "Chưa có
  group nào" + CTA "+ Thêm Group".
- A15. Danh sách rỗng vì **search không khớp** → EmptyState "Không tìm thấy
  group nào" + nút "Xóa tìm kiếm" (không hiện CTA tạo mới gây hiểu nhầm
  rằng org chưa có group).
- A16. `page` vượt quá số trang hiện có → **200 + mảng rỗng** (đúng quyết
  định đã chốt ở F2), không 404.
- A17. `page`/`per_page` không phải số nguyên dương → **422** field-level
  (`page`/`per_page`), tái dùng nguyên coercion của F2.
- A18. `per_page` vượt ngưỡng tối đa (100) → clamp im lặng về 100 (đúng F2
  OQ-1), không báo lỗi.
- A19. Lỗi hạ tầng khi tải danh sách (500/network) → ErrorState trong khu vực
  bảng + nút "Thử lại", search bar vẫn dùng được, không trang trắng, không
  spinner treo vô hạn.
- A20. Gọi bất kỳ endpoint groups nào **không có token** hoặc token hết
  hạn/không hợp lệ → **401** (tái dùng `Authenticatable` của F0).
- A21. User **chưa đăng nhập** mở thẳng `/groups` → router guard redirect
  `/login`.
- A22. FE **không bao giờ** gửi `organization_id` trong body/query của bất kỳ
  request groups nào; BE **không nhận** `organization_id` từ request (strong
  params không permit) — org do token quyết định (`UI_UX_design.md` §0.6,
  `CLAUDE.md` §4).
- A23. Bấm "Hủy" hoặc đóng `ConfirmModal` → **không** gọi API, group còn
  nguyên.
- A24. Nhấn "Xóa" 2 lần liên tiếp (double-click) trong ConfirmModal → chỉ
  phát sinh **1** request (nút tự disable khi đang chạy), không sinh 2 lần
  xóa / 2 toast.
- A25. Description để trống khi tạo → **hợp lệ (201)**, lưu `null`/chuỗi
  rỗng nhất quán, danh sách hiển thị ô mô tả trống (không hiện chữ "null").

## §6. Business rule & validation

- **Org-scope tuyệt đối** (`CLAUDE.md` §4). Input hợp lệ: mọi query đi qua
  `policy_scope(Group)` / `current_organization.groups`; list chỉ chứa group
  của org gắn với token. Input bị chặn: `:id` của org khác / không tồn tại /
  sai định dạng → **404, không 403** (A1–A3); `organization_id` gửi từ client
  bị bỏ qua hoàn toàn (A22).
- **`name` bắt buộc**. Input hợp lệ: chuỗi không rỗng sau khi trim. Input bị
  chặn: rỗng/chỉ khoảng trắng → 422 field `name` (A4).
- **`name` unique trong Organization** (xem OQ-1 — phương án khuyến nghị).
  Input hợp lệ: tên chưa dùng trong org hiện tại; **trùng với tên của org
  khác vẫn hợp lệ** (A6). Input bị chặn: trùng tên trong cùng org → 422 field
  `name` (A5, A9). Bảo vệ 2 lớp: validate ở model **và** unique index
  composite `[organization_id, name]` ở DB để chặn race (A7) — đúng
  `CLAUDE.md` §4 ("composite unique index + validate ở model").
- **`description` tùy chọn** (A25), có giới hạn độ dài (OQ-8).
- **Giới hạn độ dài** `name`/`description` → 422 bám đúng field (A10, OQ-8).
- **Xóa Group không để dữ liệu treo** (`CLAUDE.md` §4 — invariant nặng ký
  nhất của F5):
  - Xóa group + mọi join row liên quan (`group_memberships` và
    `policy_assignments` có `group_id` này) phải nằm trong **cùng một
    transaction**: hoặc xóa sạch, hoặc không xóa gì (A13).
  - Khai báo **tường minh** bằng `has_many ..., dependent: :delete_all` trên
    `Group`; **không** dựa vào `ON DELETE CASCADE` ngầm ở FK.
  - **Device và Policy không bao giờ bị xóa theo** — chỉ liên kết bị gỡ
    (A11); đây là nội dung phải nói đúng như vậy trong confirm modal.
  - **Nghĩa vụ carry-over bắt buộc (OQ-3)**: ở F5 hai bảng join chưa tồn
    tại nên rule này chưa có gì để thực thi. F6 (khi tạo
    `group_memberships`) và F8 (khi tạo `policy_assignments`) **bắt buộc**
    (a) thêm `has_many ... dependent: :delete_all` tương ứng vào `Group`, và
    (b) thêm test "xóa group không để lại join row mồ côi, không xóa
    device/policy" vào suite. SoT/design của F6 và F8 phải nhắc lại nghĩa vụ
    này; `DESIGN.md` ghi rõ đây là hợp đồng chốt từ F5.
- **Hard delete, không soft-delete** (xem OQ-2 — phương án khuyến nghị):
  group đã xóa biến mất khỏi mọi danh sách và mọi truy vấn, `GET/PATCH/DELETE`
  lại chính id đó trả 404 (A12).
- **Xóa phải confirm** (`PRD.md` §"Yêu cầu chỉnh chu"): mọi lệnh xóa chỉ được
  phát sinh sau khi user xác nhận trong `ConfirmModal` (A23), và chỉ 1 request
  cho 1 lần xác nhận (A24). Không dùng `window.confirm`.
- **Phân trang bắt buộc** (`PRD.md`: "phân trang list, không render 10.000
  dòng"): kế thừa nguyên contract của F2 — `page` mặc định 1, `per_page` mặc
  định 20 / tối đa 100 (clamp im lặng, A18), `meta{current_page, per_page,
  total_count, total_pages}`, `total_count` đếm trên relation đã lọc & đã
  org-scope trước khi limit/offset, page vượt cuối → 200 rỗng (A16), param
  không hợp lệ → 422 field-level (A17).
- **Auth** (kế thừa F0, không phải rule mới): Bearer token của user `active`
  → hợp lệ; thiếu/sai/hết hạn → 401 (A20); chưa đăng nhập ở FE → redirect
  `/login` (A21).
- **RBAC không phân role nội bộ org** (kế thừa F0/F2/F3/F4): mọi user
  `active` của org được list/tạo/sửa/xóa group của org mình — `GroupPolicy`
  các action đều `true`, ranh giới thật nằm ở `Scope#resolve`.
- **Không liên quan tới F5** (ghi ra để khỏi bị nhầm là thiếu): rule "Device
  retired bất biến" và "không gán Policy inactive / chéo org" không phát
  sinh ở F5 vì F5 không đụng tới Device lẫn Policy — chúng thuộc F6/F8.

## §7. UI state
Theo `UI_UX_design.md` §6.1 + §9 (ma trận dùng chung) — chỉ liệt kê điểm
phải khớp business rule ở §6:
- **Loading** (lần đầu): skeleton rows, giữ nguyên khung search bar + nút
  "+ Thêm Group" để không giật layout.
- **Loading** (đổi trang/search/refresh sau mutation): overlay mờ lên bảng
  cũ + spinner nhỏ, **không** xóa trắng bảng rồi mới vẽ lại.
- **Loading** (trong modal): nút submit / nút "Xóa" disable + spinner trong
  nút; không cho đóng modal giữa chừng bằng cách bấm lại.
- **Empty** không do search (A14): "Chưa có group nào" + CTA "+ Thêm Group".
- **Empty** do search (A15): "Không tìm thấy group nào" + nút "Xóa tìm kiếm".
- **Error** tải danh sách (A19): ErrorState + "Thử lại", search bar vẫn hoạt
  động.
- **Error** form 422: lỗi hiện dưới đúng field (`name`/`description`), modal
  giữ nguyên dữ liệu đã nhập.
- **Error** form 500/network: banner đỏ trên đầu form ("Có lỗi xảy ra, vui
  lòng thử lại."), modal không đóng.
- **Error** xóa (A12/A13): toast lỗi; với 404 thì refresh lại danh sách.
- **Success**: toast tương ứng ("Đã tạo group" / "Đã cập nhật group" / "Đã
  xóa group") + bảng đã cập nhật, giữ đúng `page`/`q` theo luồng ở §4.
- **Không `console.error`/`console.log` sót lại**, không nút chết
  (`UI_UX_design.md` §10, `PRD.md` §"Yêu cầu chỉnh chu").

## §8. Data & API touchpoint
*(dự kiến — chốt chính thức ở `/design F5`)*
- Model/bảng mới: `groups` — `id`, `organization_id` (FK, NOT NULL), `name`
  (NOT NULL), `description` (nullable), `created_at`, `updated_at`.
  Index: `[organization_id, created_at, id]` (phân trang ổn định),
  `[organization_id, name]` unique (OQ-1).
- Quan hệ: `Organization has_many :groups`; `Group belongs_to :organization`.
  (`has_many :group_memberships/:devices` — F6; `has_many
  :policy_assignments` — F8.)
- Endpoint dự kiến:
  - `GET /api/v1/groups?page=&per_page=&q=` → `{ groups: [...], meta: {...} }`
  - `POST /api/v1/groups` (body phẳng `{name, description}`, đúng convention
    không bọc `group:` của F3) → `201 { group: {...} }`
  - `PATCH /api/v1/groups/:id` → `200 { group: {...} }`
  - `DELETE /api/v1/groups/:id` → `204` (hoặc `200`, chốt ở `/design`)
  - Lỗi: `401` / `404` (`{error: "Not found"}`) / `422`
    (`{errors: {field: [msg]}}`) — nguyên envelope của F0.
- Policy: `GroupPolicy` (`index?/create?/update?/destroy?` → `true`) +
  `Scope#resolve` → `user.organization.groups`.
- FE mới: route `/groups`, `views/groups/GroupListView.vue`,
  `components/GroupFormModal.vue`, `components/ConfirmModal.vue` (dùng
  chung), `stores/groups.ts`, `api/groups.ts`, `types/group.ts`.
- FE sửa: `router/index.ts` (thêm route), `components/AppShell.vue` (bật nav
  "Groups" + highlight theo route thay cho hard-code).

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), `status == active`, mới gọi
  được các endpoint groups; thiếu/sai token → 401.
- Không phân role nội bộ org (nhất quán F0–F4): mọi user active của org đều
  list/tạo/sửa/xóa được group của org mình.
- Org-scope check bắt buộc ở **mọi** action, kể cả `DELETE`:
  `policy_scope(Group).find(params[:id])` / `current_organization.groups` —
  không bao giờ `Group.find(params[:id])` trần (`CLAUDE.md` §4). Sai org →
  404.
- Test bắt buộc riêng cho resource Group: org A **không** đọc/sửa/xóa được
  group của org B, cả 3 động từ, kỳ vọng 404.

## §10. Non-functional (performance/scale)
- F5 **không** đụng tới bài toán 10.000 device/group (đó là F6/F8). Số lượng
  Group trong 1 org được coi là nhỏ (hàng chục–hàng trăm), nhưng danh sách
  **vẫn bắt buộc phân trang server-side** theo PRD, không FE-side.
- `total_count` đếm bằng `COUNT` trên relation đã org-scope + đã lọc, không
  load hết record ra rồi `.size` — tránh vỡ khi số group tăng.
- Search `q`: partial match không dùng được index B-tree thông thường; ở
  quy mô Group hiện tại chấp nhận sequential scan trong phạm vi 1 org
  (đã có `organization_id` ở đầu index để thu hẹp). Ghi nhận là rủi ro
  production đã biết trong `DESIGN.md`, không tối ưu sớm (trigram index) khi
  chưa có số liệu.
- `DELETE` group: ở F5 là xóa 1 row nên tức thời. **Cảnh báo cho F6/F8**:
  khi `group_memberships` có thể tới 10.000 dòng/group, `dependent:
  :delete_all` là một lệnh `DELETE ... WHERE group_id = ?` — cần index trên
  `group_id` và cân nhắc thời gian giữ transaction; nếu vượt ngưỡng chấp
  nhận được thì F6 phải quyết định chuyển sang xóa bất đồng bộ (cùng cơ chế
  job/trạng thái với gán policy). Không giải quyết ở F5, nhưng phải được
  nêu lại trong SoT F6.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Xem danh sách Group của org mình
  Given Organization "Acme Inc." có các Group "Sales Team" và "Engineering"
  And Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Groups
  Then tôi thấy Group "Sales Team" và Group "Engineering" trong danh sách
  And tôi không thấy Group "Globex Ops"

Scenario: Danh sách Group phân trang, không render toàn bộ
  Given Organization "Acme Inc." có 25 Group
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Groups
  Then tôi thấy 20 Group trên trang 1
  And tôi thấy thanh phân trang cho biết tổng 25 Group

Scenario: Trang vượt quá số trang hiện có trả về danh sách rỗng
  Given Organization "Acme Inc." có 3 Group
  When tôi gọi "GET /api/v1/groups" với page "99"
  Then tôi nhận về "200" với danh sách group rỗng

Scenario: Tham số phân trang không hợp lệ bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/groups" với page "abc"
  Then tôi nhận về lỗi "422" ở field "page"

Scenario: Org chưa có group nào hiện empty state kèm CTA tạo mới
  Given Organization "Acme Inc." chưa có Group nào
  When tôi mở trang Groups
  Then tôi thấy thông báo "Chưa có group nào"
  And tôi thấy nút "+ Thêm Group"

Scenario: Tìm group theo tên
  Given Organization "Acme Inc." có các Group "Sales Team" và "Engineering"
  When tôi mở trang Groups và tìm với từ khóa "sales"
  Then tôi thấy Group "Sales Team" trong danh sách
  And tôi không thấy Group "Engineering"

Scenario: Tìm kiếm không khớp hiện empty state riêng kèm nút xóa tìm kiếm
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở trang Groups và tìm với từ khóa "khong-ton-tai"
  Then tôi thấy thông báo "Không tìm thấy group nào"
  And tôi thấy nút "Xóa tìm kiếm"

Scenario: Tạo Group thành công
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Groups và tạo Group với tên "Sales Team" và mô tả "Đội kinh doanh"
  Then tôi thấy toast "Đã tạo group"
  And tôi thấy Group "Sales Team" trong danh sách

Scenario: Group vừa tạo hiện ngay ở đầu danh sách
  Given Organization "Acme Inc." đã có 3 Group
  When tôi tạo Group "Group Mới Nhất" thành công
  Then Group "Group Mới Nhất" đứng đầu danh sách ở trang 1

Scenario: Tạo Group không có mô tả vẫn hợp lệ
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Group với tên "Sales Team" và bỏ trống mô tả
  Then Group "Sales Team" được tạo thành công
  And ô mô tả của Group "Sales Team" hiển thị trống

Scenario: Tạo Group với tên rỗng bị chặn
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Group với tên chỉ gồm khoảng trắng
  Then tôi nhận về lỗi "422" ở field "name"
  And form vẫn mở với dữ liệu tôi đã nhập

Scenario: Tạo Group trùng tên trong cùng Organization bị chặn
  Given Organization "Acme Inc." đã có Group "Sales Team"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Group với tên "Sales Team"
  Then tôi nhận về lỗi "422" ở field "name"
  And tôi thấy message "Tên group này đã tồn tại trong tổ chức của bạn."

Scenario: Hai Organization khác nhau được phép trùng tên Group
  Given Organization "Globex Corp." đã có Group "Sales Team"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Group với tên "Sales Team"
  Then Group "Sales Team" được tạo thành công trong Organization "Acme Inc."

Scenario: Hai request tạo Group trùng tên đồng thời không tạo bản ghi trùng
  Given tôi là user active thuộc Organization "Acme Inc."
  When hai request tạo Group cùng tên "Sales Team" được gửi đồng thời
  Then chỉ một request thành công
  And request còn lại nhận lỗi "422" ở field "name", không phải "500"

Scenario: Tên hoặc mô tả vượt giới hạn độ dài bị chặn
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Group với tên dài hơn giới hạn cho phép
  Then tôi nhận về lỗi "422" ở field "name"

Scenario: Sửa tên và mô tả Group thành công
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi sửa Group "Sales Team" thành tên "Sales APAC" với mô tả "Khu vực APAC"
  Then tôi thấy toast "Đã cập nhật group"
  And tôi thấy Group "Sales APAC" trong danh sách

Scenario: Sửa Group mà giữ nguyên tên cũ của chính nó vẫn hợp lệ
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi sửa Group "Sales Team" giữ nguyên tên và chỉ đổi mô tả
  Then Group được cập nhật thành công

Scenario: Sửa Group thành tên đã bị Group khác trong org dùng bị chặn
  Given Organization "Acme Inc." có Group "Sales Team" và Group "Engineering"
  When tôi sửa Group "Engineering" thành tên "Sales Team"
  Then tôi nhận về lỗi "422" ở field "name"

Scenario: Xóa Group phải qua bước xác nhận
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở trang Groups và chọn xóa Group "Sales Team"
  Then tôi thấy hộp thoại xác nhận xóa nêu rõ hành động không thể hoàn tác
  And Group "Sales Team" vẫn còn trong danh sách

Scenario: Hủy hộp thoại xác nhận không xóa Group
  Given Organization "Acme Inc." có Group "Sales Team"
  And tôi đang mở hộp thoại xác nhận xóa Group "Sales Team"
  When tôi bấm "Hủy"
  Then Group "Sales Team" vẫn còn trong danh sách

Scenario: Xóa Group thành công sau khi xác nhận
  Given Organization "Acme Inc." có Group "Sales Team"
  And tôi đang mở hộp thoại xác nhận xóa Group "Sales Team"
  When tôi xác nhận xóa
  Then tôi thấy toast "Đã xóa group"
  And Group "Sales Team" không còn trong danh sách

Scenario: Group đã xóa biến mất hoàn toàn, không truy cập lại được
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi xóa Group "Sales Team" thành công
  And tôi gọi "PATCH /api/v1/groups/:id" với id của Group "Sales Team"
  Then tôi nhận về lỗi "404"

Scenario: Hộp thoại xác nhận nói rõ device và policy không bị xóa
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở hộp thoại xác nhận xóa Group "Sales Team"
  Then nội dung xác nhận nêu rõ chỉ liên kết bị gỡ, device và policy không bị xóa

# Scenario dưới đây KHÔNG thuộc acceptance criteria của F5 (quyết định OQ-3,
# phương án a): group_memberships/policy_assignments chưa tồn tại ở F5 nên
# không thể chạy được. Giữ lại ở đây làm đặc tả hợp đồng hành vi — nghĩa vụ
# triển khai + viết test tương đương này chuyển cho F6 (group_memberships) và
# F8 (policy_assignments); mỗi SoT đó phải nhắc lại scenario này cho phần join
# table nó sở hữu, và DESIGN.md phải ghi rõ nguồn gốc từ F5.
# Scenario: Xóa Group không để lại dữ liệu liên kết treo và không xóa device/policy
#   Given Organization "Acme Inc." có Group "Sales Team" đang có device là thành viên và có policy được gán cho group
#   When tôi xóa Group "Sales Team" thành công
#   Then không còn bản ghi liên kết nào trỏ tới Group "Sales Team"
#   And các device đó vẫn tồn tại
#   And các policy đó vẫn tồn tại

Scenario: Xóa Group thất bại do lỗi hạ tầng không xóa nửa vời
  Given Organization "Acme Inc." có Group "Sales Team"
  And API xóa group đang trả lỗi 500
  When tôi xác nhận xóa Group "Sales Team"
  Then tôi thấy thông báo lỗi
  And Group "Sales Team" vẫn còn trong danh sách

Scenario: Xóa Group đã bị người khác xóa trước đó
  Given Organization "Acme Inc." có Group "Sales Team"
  And Group "Sales Team" vừa bị xóa bởi một phiên làm việc khác
  When tôi xác nhận xóa Group "Sales Team"
  Then tôi thấy thông báo group không tồn tại hoặc đã bị xóa
  And danh sách được tải lại và không còn Group "Sales Team"

Scenario: Bấm xác nhận xóa hai lần chỉ gửi một request
  Given Organization "Acme Inc." có Group "Sales Team"
  And tôi đang mở hộp thoại xác nhận xóa Group "Sales Team"
  When tôi bấm nút xác nhận xóa hai lần liên tiếp
  Then chỉ có một request xóa được gửi đi

Scenario: Xóa dòng cuối cùng của trang sau cùng tự lùi về trang trước
  Given Organization "Acme Inc." có 21 Group và tôi đang ở trang 2
  When tôi xóa Group duy nhất đang hiển thị ở trang 2
  Then tôi được đưa về trang 1 với danh sách còn lại
  And tôi không thấy trang trắng

Scenario: Xem Group của Organization khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/groups" và liệt kê kết quả
  Then tôi không thấy Group "Globex Ops"

Scenario: Sửa Group của Organization khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "PATCH /api/v1/groups/:id" với id của Group "Globex Ops"
  Then tôi nhận về lỗi "404"

Scenario: Xóa Group của Organization khác trả về 404 và không xóa gì
  Given Organization "Globex Corp." có Group "Globex Ops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "DELETE /api/v1/groups/:id" với id của Group "Globex Ops"
  Then tôi nhận về lỗi "404"
  And Group "Globex Ops" vẫn tồn tại trong Organization "Globex Corp."

Scenario: Truy cập Group với id không tồn tại trả về 404
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "PATCH /api/v1/groups/:id" với id không tồn tại trong hệ thống
  Then tôi nhận về lỗi "404"

Scenario: Truy cập Group với id sai định dạng không làm lộ lỗi hạ tầng
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "DELETE /api/v1/groups/:id" với id không phải số nguyên hợp lệ
  Then tôi nhận về lỗi "404", không phải "500"

Scenario: Gửi organization_id trong request tạo Group không đổi được org đích
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "POST /api/v1/groups" kèm organization_id của Organization "Globex Corp."
  Then Group được tạo thuộc Organization "Acme Inc."
  And Organization "Globex Corp." không có thêm group nào

Scenario: Gọi API groups mà không có token
  When tôi gọi "GET /api/v1/groups" mà không có Authorization header
  Then tôi nhận về lỗi "401"

Scenario: Gọi API groups bằng token đã hết hạn
  Given tôi có một token đã hết hạn
  When tôi gọi "GET /api/v1/groups" bằng token đó
  Then tôi nhận về lỗi "401"

Scenario: Chưa đăng nhập truy cập thẳng trang Groups bị chuyển hướng
  Given tôi chưa đăng nhập
  When tôi mở thẳng URL "/groups" trên trình duyệt
  Then tôi bị chuyển hướng tới trang đăng nhập

Scenario: Lỗi hạ tầng khi tải danh sách Group hiện banner và cho thử lại
  Given API "GET /api/v1/groups" đang trả lỗi 500
  When tôi mở trang Groups
  Then tôi thấy thông báo lỗi cùng nút "Thử lại", không phải trang trắng

Scenario: Sidebar có mục Groups dẫn tới trang Groups
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi đang ở trang Devices và bấm mục "Groups" trên sidebar
  Then tôi được điều hướng tới trang Groups
  And mục "Groups" trên sidebar được đánh dấu đang chọn

Scenario: Menu hành động của Group chỉ có các hành động đã có thật
  Given Organization "Acme Inc." có Group "Sales Team"
  When tôi mở menu hành động của Group "Sales Team"
  Then tôi thấy hành động "Sửa" và "Xóa"
  And tôi không thấy hành động nào chưa hoạt động được
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | `Group.name` có **unique trong Organization** không? PRD chỉ nói rõ unique cho `User.email` và `Device.identifier`, **không** nói gì về tên Group. Nếu unique thì so sánh phân biệt hoa/thường hay không? | **Có** — unique theo `organization_id` (validate ở model + unique index composite `[organization_id, name]`), **phân biệt hoa/thường** (case-sensitive) để đồng nhất với `Device.identifier` của F3 và tránh phải thêm functional index `lower(name)`. Lý do: F6/F8 và mọi acceptance test đều định danh group bằng tên; hai group trùng tên trong cùng org khiến UI và test mơ hồ (user không phân biệt được chọn cái nào khi gán policy). Trùng tên **giữa 2 org khác nhau** vẫn hợp lệ (`CLAUDE.md` §4). Nếu chọn **không** unique: bỏ index + validate, sửa/bỏ 5 scenario gắn `(pending OQ-1)`. Nếu chọn **case-insensitive**: cần index trên `lower(name)` + normalize khi so sánh, và scenario "Sales Team" vs "sales team" phải được thêm mới. | **Chọn theo khuyến nghị**: Có, unique theo `organization_id`, case-sensitive. |
| OQ-2 | **Hard delete hay soft delete** Group? | **Hard delete**. PRD chỉ nói "xóa" và yêu cầu "không để dữ liệu liên quan bị treo/sai"; `UI_UX_design.md` §6.1 đã viết sẵn nội dung confirm "Hành động không thể hoàn tác" — tức là đã ngả hẳn về hard delete. Soft delete sẽ kéo theo việc mọi query của F6/F8/F9 phải nhớ lọc `deleted_at IS NULL` (rủi ro leak dữ liệu đã xóa lớn hơn lợi ích khôi phục, mà PRD không yêu cầu khôi phục). Nếu chọn soft delete: phải bổ sung `default_scope`/scope tường minh, quyết định số phận join row (gỡ hay giữ), và sửa scenario `(pending OQ-2)` + nội dung confirm modal. | **Chọn theo khuyến nghị**: Hard delete. |
| OQ-3 | "Xóa Group không để dữ liệu treo" (`CLAUDE.md` §4) là **invariant nặng nhất của F5**, nhưng tại thời điểm F5 build, `group_memberships` (F6) và `policy_assignments` (F8) **chưa tồn tại** → rule chưa có gì để thực thi và chưa test end-to-end được. F5 có nên tạo sẵn bảng join không? | **Không tạo sớm.** Giữ đúng thứ tự backlog (F6 sở hữu `group_memberships` vì schema/index của nó bị chi phối bởi yêu cầu 10k device + idempotent; F8 sở hữu `policy_assignments` với unique index `(policy_id, group_id)`/`(policy_id, device_id)` theo `CLAUDE.md` §4) — thiết kế trước khi có SoT của chúng là đoán mò và gần như chắc chắn phải migrate lại. Đổi lại, F5 **chốt hợp đồng hành vi** ở §6 và **ghi nợ tường minh**: F6 và F8 bắt buộc (a) thêm `has_many ..., dependent: :delete_all` vào `Group`, (b) thêm test "xóa group → không còn join row mồ côi, device/policy vẫn còn". Nghĩa vụ này phải xuất hiện lại trong SoT của F6 và F8 và trong `DESIGN.md`. Scenario `(pending OQ-3)` ở §11 vì vậy sẽ **RED cho tới F6/F8** — xem "Rủi ro/giả định" để biết cách xử lý. | **Chọn theo khuyến nghị + phương án (a)**: không tạo sớm bảng join; scenario liên quan không phải acceptance criteria của F5, ghi thành nghĩa vụ carry-over bắt buộc cho SoT/design F6 và F8 + `DESIGN.md`. |
| OQ-4 | `UI_UX_design.md` §6.1 quy định nội dung confirm xóa có **số lượng N device** ("sẽ gỡ toàn bộ liên kết với &lt;N&gt; device..."), kéo theo API list phải trả `devices_count`. Ở F5 chưa có membership nên N luôn = 0. Làm gì? | Ở F5: **bỏ số N khỏi câu confirm** và **không thêm field `devices_count` vào contract** (dùng câu không có số: "Xóa group '&lt;tên&gt;' sẽ gỡ toàn bộ liên kết của group này với device và policy đang gán. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác."), đồng thời **không render cột "Số device"** trong bảng. F6 bổ sung `devices_count` (đếm ở API, không FE tự đếm — `UI_UX_design.md` §0.3) vào cả cột bảng lẫn câu confirm. Lý do: cùng nguyên tắc đã chốt ở `docs/sot/F4-device-detail.md` OQ-6 — không bịa field rỗng/giả vào contract cho feature sau. Nếu chọn thêm `devices_count: 0` ngay từ F5: sửa scenario `(pending OQ-4)` và ghi vào design API rằng giá trị luôn 0 cho tới F6. | **Chọn theo khuyến nghị**: bỏ số N khỏi câu confirm, không thêm `devices_count` vào contract F5. |
| OQ-5 | Có làm trang chi tiết Group `/groups/:id` ở F5 không (action "Xem chi tiết" trong menu ⋯ theo `UI_UX_design.md` §6.1)? | **Không** — toàn bộ nội dung của trang đó (tab Thành viên, tab Policies, `UI_UX_design.md` §6.2) thuộc F6/F8; dựng ở F5 sẽ là một trang gần như trống. Menu ⋯ ở F5 chỉ có "Sửa" và "Xóa"; **không** render action "Xem chi tiết" disable (tránh nút chết — `PRD.md` §"Yêu cầu chỉnh chu"). F6 thêm route + action. Khác với F4 (nơi trang chi tiết Device vẫn có khối Header thông tin thật để hiển thị), ở đây name/description đã hiển thị đủ ngay trên bảng danh sách nên trang chi tiết chưa mang thêm thông tin nào. Nếu chọn làm ở F5: bổ sung route `/groups/:id` + `GET /api/v1/groups/:id` vào §3/§8, thêm scenario tương ứng, sửa scenario `(pending OQ-5)`. | **Chọn theo khuyến nghị**: không làm trang chi tiết ở F5; menu ⋯ chỉ có "Sửa"/"Xóa". |
| OQ-6 | Có làm **search theo tên** (`q`) ngay ở F5 không? `UI_UX_design.md` §6.1 nói "có thể chỉ cần search theo tên" (không dứt khoát); `PRD.md` chỉ bắt buộc filter cho trang Devices, với Groups chỉ yêu cầu "Danh sách; tạo/sửa/xóa". | **Có làm**, dạng tối giản: param `q`, so khớp **một phần, không phân biệt hoa/thường** trên `name` (`ILIKE %q%`), trim khoảng trắng, rỗng = "tất cả", **reset về page 1** khi đổi `q`, đồng bộ vào URL query. Lý do: reviewer cần tìm nhanh 1 group giữa danh sách phân trang khi kiểm tra F6/F8 mà không phải bấm qua nhiều trang, và chi phí thực hiện gần như bằng 0 (tái dùng nguyên khung filter/URL-sync của F2). Nếu chọn **không** làm: bỏ 2 scenario `(pending OQ-6)`, bỏ nút "Xóa tìm kiếm" khỏi empty state ở §7/A15, và empty state chỉ còn 1 biến thể. | **Chọn theo khuyến nghị**: có làm search `q` (ILIKE, reset page 1, sync URL). |
| OQ-7 | **Thứ tự sắp xếp mặc định** của danh sách Group: `created_at DESC, id DESC` (nhất quán với Devices list của F2, group mới tạo nằm ngay đầu trang 1) hay `name ASC` (tự nhiên hơn với danh bạ tên)? | **`created_at DESC, id DESC`** — nhất quán với F2, và quan trọng hơn là sau khi tạo group mới, user thấy ngay kết quả ở đầu trang 1 (feedback tức thời, `UI_UX_design.md` §0.4) thay vì phải đi tìm theo alphabet. Tie-break bằng `id` để thứ tự **xác định tuyệt đối**, không phụ thuộc thứ tự trả về của Postgres. Nếu chọn `name ASC`: sửa scenario `(pending OQ-7)` (group mới tạo **không** còn đảm bảo đứng đầu) và đổi luồng "sau khi tạo → về page 1" ở §4 thành "refresh trang hiện tại + toast chỉ dẫn". | **Chọn theo khuyến nghị**: `created_at DESC, id DESC`. |
| OQ-8 | **Giới hạn độ dài** `name` và `description`? PRD không nói. | `name`: bắt buộc, sau khi trim dài **1–100** ký tự. `description`: tùy chọn, tối đa **500** ký tự, trim, chuỗi rỗng lưu thành `NULL` cho nhất quán. Lý do: chặn dữ liệu rác/DoS nhẹ và giữ bảng danh sách không vỡ layout; 2 con số này là quy ước, không phải yêu cầu nghiệp vụ, nên nếu approve muốn số khác thì chỉ cần sửa con số ở design DB (scenario `(pending OQ-8)` viết theo "dài hơn giới hạn cho phép" nên không phụ thuộc con số cụ thể). | **Chọn theo khuyến nghị**: name 1–100 ký tự, description tối đa 500 ký tự. |

**Rủi ro/giả định:**
- **(Quan trọng — quyết định cách viết acceptance test)** Scenario "Xóa Group
  không để lại dữ liệu liên kết treo..." `(pending OQ-3)` **không thể xanh ở
  F5** vì `group_memberships`/`policy_assignments` chưa tồn tại. Golden rule
  #3 (`CLAUDE.md` §3) cấm sửa acceptance test cho pass, và gate #4 yêu cầu
  Playwright full suite xanh trước khi Done → **không được** để scenario này
  nằm RED vĩnh viễn trong suite của F5. Hai cách xử lý, cần chốt khi approve
  (gợi ý: chọn (a)):
  (a) **Không** đưa scenario đó vào `features/f5-group-crud.feature`; thay
      vào đó ghi thành **nghĩa vụ bắt buộc** trong SoT/design của F6 và F8
      (mỗi feature đó tự viết scenario xóa-group-không-treo-dữ-liệu cho phần
      join table mà nó tạo ra) + ghi vào `DESIGN.md`. F5 chỉ test được phần
      nó thực sự sở hữu: transaction + group biến mất + 404 sau khi xóa.
  (b) Đưa vào feature file của F5 và gắn tag Playwright `@skip`/`@wip` với
      lý do ghi rõ — rủi ro: tag bị quên gỡ, invariant nặng nhất của đề bài
      trôi mất.
- `UI_UX_design.md` §6.1 mô tả cột "Số device" và action "Xem chi tiết" —
  F5 cố tình **không** làm cả hai (OQ-4, OQ-5). Đây là sai khác có chủ đích
  so với tài liệu UI/UX nền, phải ghi vào `DESIGN.md` khi implement và phải
  được F6 khôi phục đầy đủ.
- `ConfirmModal.vue` là component dùng chung **chưa từng được build**
  (`UI_UX_design.md` §8) — F5 là nơi build lần đầu, nên phải viết đủ tổng
  quát để F6 (gỡ device khỏi group), F8 (gỡ policy) dùng lại không phải sửa:
  props `title`/`message`/`confirmLabel`/`destructive`, `onConfirm` async tự
  disable + spinner, đóng bằng `Escape`/click nền, không `window.confirm`.
- `AppShell.vue` đang hard-code `class="nav-item active"` cho Devices và có
  ghi chú nợ kỹ thuật đích danh F5/F7. Nếu F5 chỉ thêm `RouterLink` mà quên
  đổi highlight theo route, sidebar sẽ sáng "Devices" cả khi đang ở
  `/groups` → lỗi UI nhìn thấy ngay. Đã đưa thành 1 scenario ở §11.
- `q` dùng `ILIKE %...%` không tận dụng được index — chấp nhận ở quy mô
  Group hiện tại, ghi nhận là rủi ro production đã biết trong `DESIGN.md`
  (§10).
- Giả định **không có role nội bộ Organization** (mọi user active đều xóa
  được group) — nhất quán F0–F4 và PRD không nhắc tới role. Nếu reviewer kỳ
  vọng "chỉ admin mới xóa được group" thì đó là scope mới, phải quay lại
  sửa SoT F0 trước.

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật, bỏ tag, rồi mới set `status: approved` ở đầu file.
Danh sách scenario đang mang tag: OQ-1 (5 scenario), OQ-2 (1), OQ-3 (1 —
đọc kỹ mục "Rủi ro/giả định" đầu tiên trước khi quyết), OQ-4 (1), OQ-5 (1),
OQ-6 (2), OQ-7 (1), OQ-8 (1).
