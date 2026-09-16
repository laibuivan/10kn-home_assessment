---
feature_id: F6
status: approved   # draft | approved
approver: Lai Bui <lai.bui.vtp@gmail.com>
date: 2026-09-16
---

# Thiết kế Frontend — F6

Nguồn: `docs/design/F6-api.md` (approved — 7 endpoint, response shape,
envelope lỗi, A1–A32), `docs/design/F6-db.md` (approved — `group_memberships`,
`Group has_many :group_memberships, dependent: :delete_all`), `docs/sot/F6-
group-membership.md` (approved — §4 main flow A–D, §5 edge case, §6 business
rule, §7 UI state, §9 RBAC, §11 acceptance, §12 8 OQ đã chốt), **`UI_UX_design.md`**
(§0 nguyên tắc, §2 IA/routes, §5 Device Detail, §6.2 Group Detail, §8 component
dùng chung — đặc biệt `AsyncSearchSelect.vue` chưa từng được build,
`ConfirmModal.vue` đã có từ F5, §9 ma trận, §10 validate, §12 token), `PRD.md`
bảng "Giao diện bắt buộc", `docs/design/F5-frontend.md` (approved — format,
quy ước `ConfirmModal`, pattern URL-as-source-of-truth, `firstQueryValue`), và
**source thật đã đọc trực tiếp** trong `web/src/`:
`views/groups/GroupListView.vue`, `views/devices/DeviceDetailView.vue`,
`views/devices/DeviceListView.vue`,
`components/{ConfirmModal,DataTable,FilterBar,PaginationBar,ActionsMenu,
EmptyState,ErrorState,FormModal,GroupFormModal,SearchInput,StatusBadge,
AppShell}.vue`, `stores/{groups,devices}.ts`, `api/{groups,devices,client}.ts`,
`types/{group,device,ui}.ts`, `utils/{apiError,queryParams}.ts`,
`router/index.ts`, `styles/components.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F6-frontend-preview.html` — không approve file `.md` này khi chưa
xem file preview.

## 0. Phạm vi & quyết định vượt khỏi mô tả vắn tắt (cần người duyệt xác nhận nhanh)

Nhiệm vụ giao cho bước `/design F6` mô tả Group Detail vắn tắt là "header
Group + tab Thành viên". `UI_UX_design.md` §6.1/§6.2 vẽ chi tiết hơn — tài
liệu này đi theo **đúng bản vẽ đầy đủ của `UI_UX_design.md`** (route/layout ở
đó là cố định, "không tự đổi trừ khi có lý do kỹ thuật"), tức là **thêm** vài
thứ so với câu mô tả vắn tắt. Liệt kê tường minh để người duyệt chỉ cần gật/lắc
đầu, không phải tự soát lại toàn bộ:

| Bổ sung | Lý do | Chi phí |
|---|---|---|
| Nút **"Sửa"/"Xóa"** ở header Group Detail (`UI_UX_design.md` §6.1: `[Tên group] [Sửa] [Xóa]`) | SoT §3 không nhắc tới nhưng không cấm; bản vẽ layout khung có vẽ | **0 component mới** — tái dùng nguyên `GroupFormModal.vue`/`ConfirmModal.vue` đã build ở F5, chỉ thêm 2 nút + 2 handler ở `GroupDetailView.vue` |
| Group List: **row clickable** (`onRowClick` → `/groups/:id`) | `UI_UX_design.md` §4 áp dụng "click row → detail" cho Devices; Group giờ đã có detail page nên áp dụng đối xứng, nhất quán `DeviceListView` | Tái dùng `DataTable`'s `onRowClick` prop có sẵn |
| Tab "Policies" hiện dạng **nhãn tĩnh, mờ, không phải nút** (giống `.nav-item.future` của sidebar) thay vì không render gì | SoT §3 cho phép cả 2 phương án ("để dạng chưa-bật... hoặc không render"); chọn **có hiện nhãn mờ** vì khớp đúng bản vẽ `UI_UX_design.md` §6.2 ("Tab: [ Thành viên (N) ] [ Policies ]") và tái dùng đúng pattern đã duyệt ở `AppShell.vue`/F0 cho "Policies" sidebar — không phải nút, không `@click`, nên không phải "nút chết" | CSS mới nhỏ, xem §5 |

Nếu người duyệt muốn bỏ bớt Sửa/Xóa header (giữ đúng "chỉ header + tab" như
câu mô tả vắn tắt), xem OQ-FE-2 (§5) — dễ cắt, không ảnh hưởng phần còn lại.

Ngược lại F6 **trả đủ 3 món nợ F5 để lại có chủ đích** (`F5-frontend.md` §0,
SoT F5 OQ-4/OQ-5):

| F5 đã bỏ | F6 khôi phục |
|---|---|
| Cột "Số device" | Thêm cột `devices_count` vào `GroupListView.vue` (API F6 đã trả field này ở mọi response Group) |
| Action "Xem chi tiết" + route `/groups/:id` | Thêm route, thêm lại action trong `ActionsMenu` |
| Câu confirm xóa không có số N | Thêm `<devices_count>` vào message, đúng nguyên văn `UI_UX_design.md` §6.1 |

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/groups/:id` | `views/groups/GroupDetailView.vue` (**mới**) | `router/index.ts` thêm `{ path: '/groups/:id', name: 'group-detail', component: GroupDetailView, props: true }` — cùng khuôn `device-detail` (F4), kể cả chi tiết "khai `props: true` nhưng component tự đọc `route.params.id` qua `useRoute()`, không đọc prop `id`", giữ đúng quy ước đã có ở `DeviceDetailView.vue`. Router guard hiện có tự áp dụng, không sửa |
| `/groups` | `views/groups/GroupListView.vue` | **Sửa** — cột `devices_count`, row clickable, action "Xem chi tiết", message xóa có N (xem §2.0) |
| `/devices/:id` | `views/devices/DeviceDetailView.vue` | **Sửa** — khối "Groups đang thuộc" thật thay chỗ tĩnh của F4 (xem §2.5) |
| `/devices` | `views/devices/DeviceListView.vue` | **Không đụng.** `q` được thêm vào API nhưng **không** có ô search mới ở trang này (SoT OQ-7: `q` chỉ phục vụ modal F6; trang Devices List giữ nguyên như F2/F3, việc thêm search cho chính trang này là phạm vi khác nếu có) |

Component **mới** tại `web/src/components/` (phẳng, không thư mục con — đúng
quy ước F3/F4/F5):

| Component | Vai trò | Dùng ở |
|---|---|---|
| `AsyncSearchSelect.vue` | **Component dùng chung**, build lần đầu ở F6 (`UI_UX_design.md` §8) — debounce search, chọn 1 hoặc nhiều, loading/empty trong dropdown | `GroupMemberAddModal`, `DeviceGroupAddModal`; viết đủ tổng quát để F7/F8 (tìm Policy/Group/Device khi gán Policy) tái dùng không sửa |
| `GroupMemberAddModal.vue` | Modal "+ Thêm device vào group" (Group Detail, tab Thành viên) | `GroupDetailView.vue` |
| `DeviceGroupAddModal.vue` | Modal "+ Thêm vào group" (Device Detail) | `DeviceDetailView.vue` |

Component tái dùng nguyên vẹn, không sửa: `ConfirmModal.vue`, `FormModal.vue`,
`DataTable.vue`, `FilterBar.vue`, `PaginationBar.vue`, `EmptyState.vue`,
`ErrorState.vue`, `StatusBadge.vue`, `GroupFormModal.vue`, `ActionsMenu.vue`.

## 2. Element / Trigger / Action / Notes

Mọi `data-testid` dưới đây là hợp đồng với `acceptance-author` — đổi tên sau
khi approve = làm RED acceptance test.

### 2.0 `GroupListView.vue` — thay đổi (trả nợ F5)

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `columns` | — | Thêm cột `{ key: 'devices_count', label: 'Số device', value: (row) => String(row.devices_count) }` giữa `description` và `actions` | Khớp thứ tự `UI_UX_design.md` §6.1 "Name │ Description │ Số device │ ⋯". `devices_count` giờ có trong `Group` type (F6-api.md serialize_group luôn trả field này, kể cả index) |
| `DataTable` — bảng group | — | Truyền `:on-row-click="viewDetail"` | Khác F5 (không truyền gì). `viewDetail(group) { router.push(`/groups/${group.id}`) }` — đúng đối xứng `DeviceListView.viewDetail` |
| `DataTable` — cột `actions` | click | Bọc `<span @click.stop>` quanh `ActionsMenu` | **Bắt buộc** giờ hàng đã clickable — thiếu `@click.stop` thì bấm "⋯" sẽ vô tình điều hướng luôn (đúng cách `DeviceListView` đã làm) |
| `rowActions(group)` | — | 3 item: "Sửa", "Xóa", **"Xem chi tiết"** (mới) | `testId: 'group-action-view'`, `onClick: () => viewDetail(group)`. Thứ tự khớp `UI_UX_design.md` §6.1 "Sửa, Xóa, Xem chi tiết" |
| `confirmMessage` (computed) | — | Đổi thành `` `Xóa group "${target.name}" sẽ gỡ toàn bộ liên kết với ${target.devices_count} device và policy đang gán cho group này. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.` `` | **Đúng nguyên văn** `UI_UX_design.md` §6.1 (khác F5: F5 bỏ số N — SoT F6 §3 yêu cầu khôi phục) |
| `watch(() => route.fullPath, ...)` (mới) | mount, mọi lần URL đổi | `store.lastListLocation = fullPath` | **Thêm mới** — `GroupDetailView`'s "◀ Quay lại danh sách" cần nó, y hệt cơ chế `DeviceListView` đã có cho F4. `stores/groups.ts` thêm field `lastListLocation: string \| null` |

### 2.1 `GroupDetailView.vue` — header

| Element | Trigger | Action | Notes |
|---|---|---|---|
| mount / đổi `route.params.id` | `watch(() => route.params.id, loadHeader, { immediate: true })` | `GET /api/v1/groups/:id` (hàm `fetchGroup` mới trong `api/groups.ts`) | State **local** (`ref`), không qua Pinia — đúng quyết định F4 đã chốt cho `DeviceDetailView` ("state của 1 record không cần store"). Độc lập với tab (§2.2) — lỗi 1 khối không kéo khối kia (A28) |
| `headerNotFound` (404) | catch, `isNotFoundError` | Toàn trang chuyển "Không tìm thấy Group" | `EmptyState` title "Không tìm thấy Group" + nút "◀ Quay lại danh sách" (`data-testid="group-detail-back-link"`, `:to="groupsStore.lastListLocation ?? '/groups'"`) — **không** fetch tab khi header 404 (group chắc chắn không thuộc org, tab cũng sẽ 404, không cần gọi thêm) |
| `headerError` (≠404) | catch | `ErrorState` **chỉ ở khối header**, tab vẫn tự fetch độc lập bên dưới | A28's nửa còn lại: nếu chính header lỗi hạ tầng (hiếm hơn tab, nhưng đối xứng) thì tab vẫn hoạt động |
| header — tên, mô tả | render | `data-testid="group-detail-name"` / `"group-detail-description"` | `description` null → hiện `"Không có mô tả"` (không phải `—` — đây là câu văn đầy đủ trên trang chi tiết, khác ô bảng cắt ngắn của list) |
| nút "Sửa" | click | Mount `GroupFormModal` `mode="edit"` `:group="group"` | `data-testid="group-detail-edit-button"`. Xem §0 — bổ sung theo `UI_UX_design.md` §6.1 |
| `GroupFormModal` — `@saved` | 200 | `closeEditModal(); toast(message); loadHeader()` | Refetch header (không phải toàn trang) để tên/mô tả cập nhật ngay |
| `GroupFormModal` — `@missing` | 404 (group bị xóa bởi phiên khác) | `closeEditModal(); toast('Group không tồn tại hoặc đã bị xóa', 'error'); headerNotFound = true` | Chuyển hẳn sang trang "Không tìm thấy" thay vì chỉ toast — đang đứng ngay trên trang chi tiết của chính group đó, tiếp tục hiện nội dung cũ sẽ sai |
| nút "Xóa" | click | `confirmDeleteGroup = true` (mount `ConfirmModal`) | `data-testid="group-detail-delete-button"` |
| `ConfirmModal` (xóa) | mount | title "Xóa group?"; message = **đúng công thức §2.0** dùng `group.value.devices_count` | Tái dùng 100% component, không sửa |
| `ConfirmModal` — `onConfirm` — `204` | await xong | `toast('Đã xóa group'); router.push(groupsStore.lastListLocation ?? '/groups')` | Không còn gì để ở lại trang này |
| — `404` | catch, `isNotFoundError` | `toast('Group không tồn tại hoặc đã bị xóa', 'error'); router.push(...)` | Đã mất, rời trang luôn (khác nhánh 404 lúc **sửa** — sửa thì còn cái để hiện "không tìm thấy" tại chỗ, xóa thì đích đến vốn dĩ đã là rời trang) |
| — `500`/network | catch, còn lại | `toast('Không xóa được group, vui lòng thử lại.', 'error')`, **giữ `ConfirmModal` mở** | Đúng pattern F5 A13 |

### 2.2 `GroupDetailView.vue` — tab "Thành viên"

URL là nguồn chân lý (§3.4): `/groups/:id?page=&platform=&status=` — cùng cơ
chế `DeviceListView`. Query `tab=` (nếu có trong URL, theo ví dụ SoT §5.1
`?tab=members&page=3&platform=ios`) được **đọc nhưng không dùng để rẽ nhánh**
(chỉ có 1 tab hoạt động ở F6) — không lỗi, không 422 nếu thiếu/khác giá trị;
F7 sẽ là nơi thực sự dùng giá trị này.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| "Tab: Thành viên (N)" | render | Nhãn **tĩnh** (không phải nút — chỉ 1 tab hoạt động, không giả vờ clickable) | `N` = `group.value?.devices_count` (từ header, không phải `meta.total_count` của tab — 2 giá trị luôn khớp nhau ở trạng thái ổn định nhưng header là nguồn hiển thị chính vì tab có thể đang lỗi/loading trong khi header đã có số) |
| "Policies" | render | Nhãn **tĩnh, mờ** (`class="tab-item future"`), không `@click`, có `title="Có ở F7"` | Xem §0 — đối xứng `.nav-item.future` của `AppShell`, không phải nút chết vì không có handler nào bị vô hiệu hóa, chỉ là chưa tồn tại |
| mount / đổi `activeQuery` | `watch(activeQuery, () => membershipsStore.fetchMembers(groupId, activeQuery), { immediate: true })` | `GET /api/v1/groups/:id/devices?page=&platform=&status=` | `groupId` lấy từ `route.params.id`, ép `Number` 1 lần (dùng lại làm key). Guard `lastRequestId` giống `devices`/`groups` store (debounce không áp dụng ở tab này — chỉ có filter select, không có search text) |
| `FilterBar` (platform/status) | change | `router.replace({ query: { platform, status } })` — **bỏ `page`** | Tái dùng y hệt `DeviceListView` — cùng `DEVICE_PLATFORMS`/`DEVICE_STATUSES`, cùng testid `filter-platform`/`filter-status` (2 trang khác nhau, không xung đột vì Playwright scope theo trang) |
| `DataTable` — bảng thành viên | — | Cột: `Identifier │ Name │ Platform │ Status │ ⋯` (action) | `test-id="group-members-table"`, `row-test-id="group-member-row"`. **Đúng 4 cột dữ liệu** theo SoT §4A bước 4 (không có OS Version/Last seen — khác `DeviceListView`) |
| `DataTable` — `onRowClick` | click | `router.push('/devices/' + device.id)` | Nhất quán "click row → detail" toàn dự án; cột action cần `@click.stop` (như §2.0) |
| Cột action — nút "Gỡ khỏi group" | click | `confirmRemoveId = device.id` (state cục bộ, không mount modal to) | `data-testid="group-member-remove-button"`. **Inline, không `ConfirmModal`** — đúng SoT §4C bước 1 "confirm nhỏ dạng inline, không modal to" |
| Cột action, khi `confirmRemoveId === device.id` | render | Thay nút trên bằng: text "Gỡ khỏi group?" + nút "Có, gỡ" (đỏ, nhỏ) + nút "Hủy" | `data-testid="group-member-remove-confirm"` / `"group-member-remove-cancel"`. "Hủy" → `confirmRemoveId = null`, không gọi API (A23-tương-đương cho luồng này — không phát sinh request) |
| "Có, gỡ" | click | `removingId = device.id` (disable + spinner nhỏ trong nút, chặn double-click — A16 phía UI) → `DELETE /api/v1/groups/:id/devices/:device_id` | `:disabled="removingId === device.id" :data-busy="removingId === device.id"` — tái dùng class `.btn`/`.spinner` có sẵn, không CSS mới cho phần này |
| — `204` | await xong | `confirmRemoveId = null; removingId = null; toast('Đã gỡ thiết bị khỏi group'); await Promise.all([loadHeader(), loadMembers()])` | `loadMembers()` tự xử lý lùi trang nếu trang hiện tại rỗng (giống F5 §3.4). `loadHeader()` refetch để `devices_count` đúng ngay — không cộng trừ thủ công ở FE (`UI_UX_design.md` §0.3) |
| — `404` (A14 — đã bị gỡ trước đó, hoặc group đã bị xóa) | catch, `isNotFoundError` | `confirmRemoveId = null; removingId = null; toast('Thiết bị không còn là thành viên của group này.', 'error'); await Promise.all([loadHeader(), loadMembers()])` | **Vẫn refetch cả header** — nếu nguyên nhân là group đã bị xóa (không chỉ riêng membership), `loadHeader()` sẽ tự 404 và chuyển trang sang "Không tìm thấy Group" (hiệu ứng dây chuyền đúng, không cần code riêng cho case này) |
| — `422` (A9 — device retired) | catch | `confirmRemoveId = null; removingId = null; toast(errorMessage, 'error')` | **Không** refetch — dòng vẫn còn nguyên đúng như server thấy (A9: "Device vẫn còn là thành viên"). `errorMessage = extractErrorMessage(error, 'Không gỡ được thiết bị, vui lòng thử lại.')` |
| — `500`/network | catch, còn lại | `confirmRemoveId = null; removingId = null; toast('Không gỡ được thiết bị, vui lòng thử lại.', 'error')` | A29 — không refetch, dòng còn nguyên |
| Nút "+ Thêm device vào group" (đầu tab, cạnh "Thành viên (N)") | click | `showAddModal = true` | `data-testid="add-devices-button"`. **Ẩn** khi empty-state A19 đang hiện (A19 có CTA riêng dùng **cùng** testid — đúng convention F3/F5 "không 2 phần tử cùng testid") |
| Empty A19 (Group chưa có device thật, không do filter) | `!loading && meta && meta.total_count === 0 && !hasActiveFilter` | `EmptyState` "Group chưa có thiết bị nào" + CTA "+ Thêm device vào group" | `hasActiveFilter = !!platform \|\| !!status`, đúng công thức `DeviceListView` |
| Empty A18 (filter không khớp) | `!loading && meta && meta.total_count === 0 && hasActiveFilter` | `EmptyState` "Không tìm thấy thiết bị" + nút "Xóa lọc" (`data-testid="filter-clear-button"` — có sẵn từ `FilterBar`, hoặc nút riêng gọi `router.replace({query:{}})`) | **Không** có CTA thêm — tránh hiểu nhầm group rỗng (đúng A18/A19 phân biệt SoT §7) |
| Error tải tab (A28) | `membershipsStore.error` | `ErrorState` trong **đúng khối tab**, không đụng header | `data-testid="error-banner"` (mặc định của `ErrorState`) — chỉ khối tab biến mất, header vẫn hiện tên/mô tả |
| `PaginationBar` | click | `router.replace({ query: { platform, status, page } })` | Giữ nguyên filter khi đổi trang, đúng pattern chuẩn |

### 2.3 `GroupMemberAddModal.vue` (mới)

Wrapper mỏng: `FormModal` (shell có sẵn) bọc `AsyncSearchSelect` (mode
`multiple`, tìm Device qua `q`).

| Element | Trigger | Action | Notes |
|---|---|---|---|
| props | mount | `{ groupId: number }` | Không nhận `device` list hiện có của group — không loại trừ device đã là thành viên khỏi kết quả search (SoT OQ-7) |
| `AsyncSearchSelect` | gõ, debounce 300ms | `search = (q) => fetchDeviceList({ q, page: 1 }).then(r => r.devices.map(toOption))` | `toOption(d) = { id: d.id, label: d.identifier, sublabel: `${d.name} · ${d.platform}` }`. `mode="multiple"`, `test-id="group-member-add-search"` |
| nút "Thêm đã chọn" (`submitLabel` của `FormModal`) | click | disable khi `selected.length === 0` **hoặc** `submitting` | `data-testid="group-member-add-submit"` — đúng A22 "nút disable khi chưa chọn gì" |
| submit | click (đã có ≥1 chọn) | `groupMembershipsStore.addMembers(groupId, selected.map(o => o.id))` → `POST /api/v1/groups/:id/devices { device_ids }` | |
| — `200` | await xong | `emit('added', { addedCount, devicesCount })` → parent: đóng modal, `toast(`Đã thêm ${addedCount} thiết bị vào group`)`, `Promise.all([loadHeader(), loadMembers()])` (về trang 1) | SoT §4B bước 4. `loadMembers()` cần reset `page` về 1 trước khi gọi (giống F5's "tạo group thành công → về trang 1") |
| — `422` | catch | `baseError.value = result.fieldErrors.device_ids?.[0] ?? result.baseError` (dùng `extractFormErrors`) — **modal không đóng**, `selected` giữ nguyên | A8 (retired trong batch, message liệt kê identifier — nằm trong `errors.base`), A11 (không còn id hợp lệ), A12 (vượt cap), A13 (rỗng) — tất cả đều render vào **1 banner** vì modal không có input field riêng cho `device_ids` để bám theo (không phải input text, là kết quả search-select) |
| — `500`/network | catch | `baseError.value = 'Có lỗi xảy ra, vui lòng thử lại.'` | Modal không đóng |
| "Hủy" / Escape / click nền | — | `emit('cancel')` (chặn khi `submitting`, hành vi có sẵn của `FormModal`) | |

### 2.4 `AsyncSearchSelect.vue` (component dùng chung, build lần đầu ở F6)

Đây là phần **phải viết đủ tổng quát**: F7/F8 tái dùng cho tìm Policy khi gán
cho Group/Device. Quyết định thiết kế + lý do:

```ts
export interface AsyncSearchSelectOption {
  id: number
  /** Dòng chính (identifier, tên...). */
  label: string
  /** Dòng phụ nhỏ hơn, xám — tùy chọn (tên+platform của device, mô tả group...). */
  sublabel?: string
}

const props = withDefaults(defineProps<{
  /**
   * Fetcher do caller cung cấp — AsyncSearchSelect không biết gì về endpoint
   * cụ thể (Device/Group/Policy...), giữ đúng cách DataTable tách khỏi
   * nguồn dữ liệu. Gọi lại mỗi lần debounce settle với query đã trim.
   */
  search: (query: string) => Promise<AsyncSearchSelectOption[]>
  mode?: 'single' | 'multiple'
  placeholder?: string
  debounceMs?: number
  /** Số ký tự tối thiểu trước khi gọi search — mặc định 1 (không tự tải "tất cả" khi ô trống, org có thể có hàng nghìn record). */
  minChars?: number
  /** Controlled: caller sở hữu danh sách đã chọn để tự đọc lại lúc submit. */
  modelValue: AsyncSearchSelectOption[]
  testId?: string
}>(), {
  mode: 'multiple',
  placeholder: 'Tìm kiếm...',
  debounceMs: 300,
  minChars: 1,
  testId: undefined,
})

const emit = defineEmits<{ 'update:modelValue': [AsyncSearchSelectOption[]] }>()
```

Hành vi bắt buộc:

1. **Debounce + cleanup giống hệt `SearchInput.vue`** (không import lại được
   vì `SearchInput` gắn cứng UI nút "Xóa tìm kiếm" không phù hợp dropdown —
   copy đúng cơ chế `timer`/`onUnmounted(cancelPending)`, ghi lại lý do không
   tái dùng thẳng component kia).
2. **Không gọi API khi `query.trim().length < minChars`** — dropdown hiện gợi
   ý "Nhập từ khóa để tìm..." thay vì danh sách/spinner. Tránh ngầm bật tính
   năng "browse toàn bộ danh sách" mà SoT không yêu cầu (org có thể có hàng
   nghìn Device).
3. **Loading**: trong lúc `search()` đang chạy, dropdown hiện spinner +
   "Đang tìm..." (`data-testid="${testId}-loading"`). Request cũ về muộn hơn
   request mới bị bỏ qua (cùng cơ chế `lastRequestId` các store khác dùng,
   nhưng cục bộ trong component vì không có Pinia state nào cần chia sẻ).
4. **Empty**: sau khi có kết quả, nếu mảng rỗng → "Không tìm thấy"
   (`data-testid="${testId}-empty"`) — đúng A22/A23.
5. **Chọn — `mode="multiple"`**: click 1 dòng kết quả → toggle trong
   `modelValue` (thêm nếu chưa có, bỏ nếu đã có — so theo `id`), `emit`
   `update:modelValue`. Dropdown **không tự đóng** sau khi chọn (cho chọn
   tiếp nhiều dòng).
6. **Chọn — `mode="single"`**: click 1 dòng → `modelValue` bị **thay thế**
   hoàn toàn bởi `[option]` đó, dropdown tự đóng (đóng = ẩn danh sách kết
   quả, ô input vẫn còn, có thể gõ lại để đổi lựa chọn).
7. **Danh sách đã chọn** hiện dưới ô input dạng "chip" (`data-testid="${testId}-selected-chip"`),
   mỗi chip có nút "×" (`data-testid="${testId}-selected-remove"`) gỡ khỏi
   `modelValue` — dùng cho **cả 2 mode** (mode single thì chip chỉ có 0 hoặc 1
   phần tử). Đây là nơi duy nhất user thấy rõ đang chọn gì, đặc biệt quan
   trọng khi kết quả search đổi liên tục.
8. **Không giới hạn số lượng chọn ở FE** cho `mode="multiple"` (cap 500 của
   OQ-2 là hợp đồng server, để 422 trả về thật khi vượt — cùng triết lý
   "không `maxlength`" đã chốt ở F5-frontend.md §5 cho lý do tương tự).
9. **Không phân trang trong dropdown** — luôn lấy trang 1 mặc định (20 kết
   quả) của endpoint được gọi; nếu không thấy, user gõ từ khóa cụ thể hơn.
   Chấp nhận được vì đây là ô tìm-để-chọn, không phải danh sách duyệt hết
   (`UI_UX_design.md` §0.2 áp dụng đúng tinh thần "không load hết vào
   `<select>`", search đã thay thế việc đó).
10. **Không điều hướng bàn phím (arrow keys)** — ngoài phạm vi acceptance
    hiện có (A22/A23 chỉ yêu cầu empty state + submit disable khi chưa chọn);
    ghi vào Rủi ro (§5) như giới hạn đã biết, không chặn approve.

### 2.5 `DeviceDetailView.vue` — khối "Groups đang thuộc" (thay tĩnh bằng thật)

Không thêm loading/error riêng — dữ liệu `groups` đến **cùng** response
`GET /api/v1/devices/:id` đã có (F6-api.md §2.6: nhúng thẳng), nên chia sẻ
nguyên `loadingDetail`/`loadError`/`notFound` hiện có của trang, không có gì
mới ở tầng fetch.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `device.value.groups` | render | Danh sách thật thay `placeholder-box` tĩnh cũ | `Device` type đổi thành `DeviceDetail` (extends `Device`, thêm `groups: DeviceGroupRef[]`) — chỉ áp dụng cho response của `fetchDevice`, không đụng `Device` dùng ở list/create/update |
| `device.value.groups.length === 0` | render | Giữ nguyên `placeholder-box` "Chưa thuộc group nào." | `data-testid="device-detail-groups-empty"` (testid cũ **giữ nguyên tên** — trước đây luôn hiện vì luôn rỗng, giờ chỉ hiện đúng lúc rỗng thật — A25) |
| `device.value.groups.length > 0` | render | `<ul data-testid="device-detail-groups-list">`, mỗi group `<li data-testid="device-detail-group-row">` | Mỗi dòng: `<RouterLink :to="'/groups/' + g.id">{{ g.name }}</RouterLink>` + nút "×" (ẩn khi retired, xem dưới) |
| nút "+ Thêm vào group" (trên block) | click | `showAddGroupModal = true` | `data-testid="device-detail-add-group-button"`. **Ẩn** khi `device.status === 'retired'` (A26) — cùng điều kiện nút "Sửa" ở header đã có sẵn |
| nút "×" mỗi dòng group | click | `removeTarget = { groupId: g.id, groupName: g.name }` → mount `ConfirmModal` | `data-testid="device-detail-group-remove-button"`. **Ẩn** khi retired (A26). Dùng `ConfirmModal` (khác tab Thành viên — ở đây danh sách ngắn, không phải bảng lớn, và `UI_UX_design.md` §5 không cấm modal như §6.2 đã cấm cho tab) |
| `ConfirmModal` — nội dung | mount | title "Gỡ khỏi group?"; message `` `Gỡ thiết bị "${device.identifier}" khỏi group "${removeTarget.groupName}"?` `` | |
| `ConfirmModal` — `onConfirm` | — | `DELETE /api/v1/groups/${removeTarget.groupId}/devices/${device.id}` | |
| — `204` | await xong | `removeTarget = null; toast('Đã gỡ thiết bị khỏi group'); load()` (refetch device) | `load()` đã có sẵn (F4) — kéo lại toàn bộ device kể cả `groups` mới |
| — `404`/`422`/`500` | catch | `removeTarget = null; toast(message, 'error')` **giữ nguyên không refetch cho 422/500**; **có refetch cho 404** (`load()`) vì 404 nghĩa là liên kết đã không còn — hiển thị lại đúng thực tế | Cùng logic đã áp cho tab Thành viên (§2.2), thu nhỏ vì danh sách này không phân trang |
| Banner retired | đã có sẵn (F4) | Không đổi — chỉ **thêm điều kiện** ẩn 2 nút trên vào cùng banner đã có | `data-testid="device-detail-retired-banner"` không đổi |

### 2.6 `DeviceGroupAddModal.vue` (mới)

Wrapper mỏng, cùng khuôn §2.3 nhưng `mode="single"` và chiều ngược lại.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| props | mount | `{ deviceId: number, deviceIdentifier: string }` | |
| `AsyncSearchSelect` | gõ | `search = (q) => fetchGroupList({ q, page: 1 }).then(r => r.groups.map(toOption))` | `toOption(g) = { id: g.id, label: g.name, sublabel: g.description ?? undefined }`. `mode="single"`, tái dùng nguyên `fetchGroupList` đã có từ F5 (không endpoint mới) |
| nút "Thêm" | click | disable khi `selected.length === 0` | Label "Thêm" (không phải "Thêm đã chọn" — chỉ chọn 1, số nhiều không hợp câu chữ) |
| submit | — | `addGroupDevices(selected[0].id, [deviceId])` → `POST /api/v1/groups/:group_id/devices { device_ids: [deviceId] }` | **Không** dựng endpoint riêng — gọi lại đúng API F6 đã có, đúng SoT §4D bước 1 "không dựng API riêng cho chiều này" |
| — `200` | await xong | `emit('added')` → parent: đóng modal, `toast('Đã thêm vào group')`, `load()` (refetch device) | |
| — `404` (group đã bị xóa giữa lúc search và submit) | catch, `isNotFoundError` | `baseError.value = 'Group đã chọn không còn tồn tại hoặc đã bị xóa.'` | **Không** đóng modal — user chọn group khác trong cùng phiên tìm kiếm |
| — `422` (A27 — chặn dù UI đã ẩn nút khi retired; hoặc device vừa bị chuyển retired giữa lúc modal mở) | catch | `baseError.value = result.fieldErrors.device_ids?.[0] ?? result.baseError` | Double-check ở BE vẫn là điểm test bắt buộc dù nút UI đã ẩn |
| — `500`/network | catch | `baseError.value = 'Có lỗi xảy ra, vui lòng thử lại.'` | |

## 3. State management

### 3.1 `types/group.ts` — mở rộng

```ts
export interface Group {
  id: number
  name: string
  description: string | null
  /** MỚI (F6) — mọi response Group (index/show/create/update) đều trả field này (F6-api.md §1 "một serialize_group duy nhất"). */
  devices_count: number
  created_at: string
  updated_at: string
}

/** MỚI — GET /api/v1/groups/:id (F6-api.md §2.1). Cùng envelope { group } với create/update — dùng lại GroupResponse, không khai type riêng. */
// (không cần interface mới — GroupResponse đã đúng shape)

/** Query params cho GET /api/v1/groups/:id/devices — tách khỏi GroupQueryParams (khác endpoint, khác field). */
export interface GroupDevicesQueryParams {
  page: number
  platform?: DevicePlatform
  status?: DeviceStatus
}
```

`GroupQueryParams` (dùng cho `GET /groups` ở `GroupListView`) **không đổi**
— vẫn `{ q?, page }`, chỉ `Group` (kiểu trả về) có thêm field.

### 3.2 `types/device.ts` — mở rộng

```ts
export interface DeviceQueryParams {
  platform?: DevicePlatform
  status?: DeviceStatus
  /** MỚI (F6) — chỉ AsyncSearchSelect/GroupMemberAddModal gửi field này; DeviceListView không đổi, không thêm ô search (SoT OQ-7). */
  q?: string
  page: number
}

/** MỚI — { id, name } của 1 Group trong khối "Groups đang thuộc". */
export interface DeviceGroupRef {
  id: number
  name: string
}

/** MỚI — shape thật của GET /api/v1/devices/:id (F6-api.md §2.6): Device + groups. Chỉ dùng ở DeviceDetailView; list/create/update vẫn dùng Device trần (không có field này). */
export interface DeviceDetail extends Device {
  groups: DeviceGroupRef[]
}
```

`api/devices.ts` — `fetchDevice` đổi kiểu trả về:

```ts
export interface DeviceDetailResponse { device: DeviceDetail }
export async function fetchDevice(id: number | string): Promise<DeviceDetailResponse> { ... }
```

`fetchDeviceList` **không đổi chữ ký** — chỉ `DeviceQueryParams` (tham số vào)
có thêm `q?`, response (`DeviceListResponse`) không đổi shape (F6-api.md §2.5:
"Không đổi shape, chỉ thêm 1 filter").

### 3.3 `api/groups.ts` — thêm 1 hàm

```ts
/** GET /api/v1/groups/:id — mới ở F6 (F5 cố tình không có show — F5 OQ-5). */
export async function fetchGroup(id: number | string): Promise<GroupResponse> {
  const response = await apiClient.get<GroupResponse>(`/api/v1/groups/${id}`)
  return response.data
}
```

### 3.4 `api/group-memberships.ts` (mới) — sub-resource `groups/:id/devices`

```ts
export interface AddGroupDevicesResponse { added_count: number; devices_count: number }

/** GET /api/v1/groups/:id/devices — trả đúng envelope { devices, meta } như DeviceListResponse. */
export async function fetchGroupDevices(
  groupId: number | string,
  params: GroupDevicesQueryParams,
): Promise<DeviceListResponse> {
  const response = await apiClient.get<DeviceListResponse>(`/api/v1/groups/${groupId}/devices`, { params })
  return response.data
}

/** POST /api/v1/groups/:id/devices — body phẳng { device_ids }, response phẳng (không bọc), đúng F6-api.md §0. */
export async function addGroupDevices(
  groupId: number | string,
  deviceIds: number[],
): Promise<AddGroupDevicesResponse> {
  const response = await apiClient.post<AddGroupDevicesResponse>(`/api/v1/groups/${groupId}/devices`, {
    device_ids: deviceIds,
  })
  return response.data
}

/** DELETE /api/v1/groups/:id/devices/:device_id — 204, không đọc response.data. */
export async function removeGroupDevice(groupId: number | string, deviceId: number): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${groupId}/devices/${deviceId}`)
}
```

File riêng (không gộp vào `api/groups.ts`/`api/devices.ts`) vì đây là 1
sub-resource với controller riêng ở BE (`GroupDevicesController`,
`F6-api.md` mở đầu) — giữ đối xứng 1-controller-BE ↔ 1-file-FE, đúng cách
`api/groups.ts`/`api/devices.ts` đã tách theo controller.

### 3.5 `stores/group-memberships.ts` (mới)

```ts
interface GroupMembershipsState {
  members: Device[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  lastRequestId: number
}

export const useGroupMembershipsStore = defineStore('group-memberships', {
  state: (): GroupMembershipsState => ({
    members: [], meta: null, loading: false, error: null, lastRequestId: 0,
  }),
  actions: {
    async fetchMembers(groupId: number, params: GroupDevicesQueryParams): Promise<void> { /* cùng khuôn fetchGroups/fetchDevices — request-id guard, giữ members/meta cũ khi lỗi */ },
    async addMembers(groupId: number, deviceIds: number[]): Promise<AddGroupDevicesResponse> { /* throw nguyên lỗi lên caller — cùng nguyên tắc createGroup/createDevice */ },
    async removeMember(groupId: number, deviceId: number): Promise<void> { /* throw nguyên lỗi */ },
  },
})
```

**Vì sao store riêng, không gộp vào `stores/groups.ts` hay `stores/devices.ts`
(SoT §8 để ngỏ, chốt ở đây):** dữ liệu (`members: Device[]`, phân trang riêng
theo group) không khớp state shape của 2 store kia (`groups: Group[]` /
`devices: Device[]` là danh sách **toàn org**, không group-scoped) — nhét vào
1 trong 2 sẽ phải thêm field kiểu `groupDevices`/`groupMeta` sống chung với
state không liên quan, dễ nhầm khi 1 trang khác vô tình đọc nhầm state của
tab Group Detail. Đúng tinh thần OQ-API-1 (BE) đã áp dụng cho
`GroupDevicesController`: sub-resource mới có state riêng, dùng lại type
(`Device`, `PaginationMeta`) chứ không dùng lại store.

`GroupDetailView.vue` gọi `fetchGroup` (header) **trực tiếp từ `api/groups.ts`**
vào 1 `ref` cục bộ — không qua Pinia, đúng quyết định F4 đã chốt cho
`DeviceDetailView` ("state của 1 record không cần store toàn cục").

### 3.6 `stores/groups.ts` — thêm 1 field

```ts
interface GroupsState {
  // ...không đổi...
  /** MỚI (F6) — full path (kèm query) lần cuối GroupListView hiện trên màn hình, để GroupDetailView's "◀ Quay lại danh sách" khôi phục đúng filter/trang. F5 từng nói "không cần" (OQ-5, chưa có detail page) — giờ có rồi. */
  lastListLocation: string | null
}
```

Cùng cơ chế và lý do `devices.lastListLocation` (F4).

### 3.7 URL là nguồn chân lý cho tab Thành viên

```ts
const groupId = computed(() => Number(route.params.id))

const activeQuery = computed<GroupDevicesQueryParams>(() => {
  const parsedPage = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const rawPlatform = firstQueryValue(route.query.platform)
  const rawStatus = firstQueryValue(route.query.status)
  return {
    page,
    platform: isDevicePlatform(rawPlatform) ? rawPlatform : undefined,
    status: isDeviceStatus(rawStatus) ? rawStatus : undefined,
  }
})
```

Giống hệt công thức `DeviceListView`/`GroupListView` — tái dùng
`firstQueryValue`, `isDevicePlatform`, `isDeviceStatus` đã có, không viết lại.
Đổi filter → bỏ `page` (reset trang 1). Đổi trang → giữ filter. Tự lùi trang
khi trang rỗng — tái dùng đúng watcher `store.meta` đã viết ở F5 §3.4 (2
nhánh: `page > total_pages` và `total_count === 0 && page > 1`), áp cho
`membershipsStore.meta`.

## 4. Empty / loading / error / success

Áp `UI_UX_design.md` §9 cho F6 (khớp SoT §7). Bảng dưới chỉ liệt kê điểm
**riêng của F6** — các dòng đã có ở F2/F3/F4/F5 (skeleton, overlay refetch,
toast success/error chung...) không lặp lại.

| Tình huống | Hiển thị | Nguồn |
|---|---|---|
| Header Group đang tải | Skeleton 2 dòng (tên + mô tả), giống khuôn `DeviceDetailView` hiện có | UI_UX_design.md §5 (tương tự) |
| Header Group 404 | Toàn trang "Không tìm thấy Group" + nút quay lại | SoT §7 dòng cuối |
| Header Group lỗi hạ tầng | `ErrorState` **chỉ khối header** | A28 (nửa header) |
| Tab Thành viên đang tải lần đầu | Skeleton rows trong `DataTable`, filter bar vẫn hiện | §9 dòng 1 |
| Tab Thành viên tải lại (đổi filter/trang/sau mutation) | Overlay mờ đè bảng cũ | §9 dòng 2 |
| Tab Thành viên lỗi (A28) | `ErrorState` trong khối tab, header vẫn hoạt động | SoT §7, A28 |
| Empty A19 (group chưa có thiết bị) | "Group chưa có thiết bị nào" + CTA "+ Thêm device vào group" | A19 |
| Empty A18 (filter không khớp) | "Không tìm thấy thiết bị" + "Xóa lọc", không CTA thêm | A18 |
| Gỡ inline — đang chờ xác nhận | Nút đổi thành "Gỡ khỏi group?" + "Có, gỡ"/"Hủy" ngay trong ô, không mở modal | SoT §4C, §7 |
| Gỡ inline — đang gọi API | Nút "Có, gỡ" disable + spinner nhỏ, không cho bấm lại | SoT §7, A16 (phía UI) |
| Gỡ inline — 422 (device retired, A9) | Toast lỗi, dòng còn nguyên, không đóng gì (không có gì để đóng) | A9 |
| Modal thêm device — đang tìm (`AsyncSearchSelect`) | Spinner trong dropdown | A22/A23 (phần loading) |
| Modal thêm device — không khớp | "Không tìm thấy" trong dropdown, không phải toàn màn hình | A22/A23 |
| Modal thêm device — nút submit | Disable khi chưa chọn gì **hoặc** đang submit | A22 |
| Modal thêm device — 422 (A8 retired-batch / A11 / A12 / A13) | Banner đỏ **trong modal**, liệt kê rõ (nếu là A8, identifier nằm sẵn trong message server trả), modal không đóng, lựa chọn giữ nguyên | SoT §7 "Error thêm Device có retired" |
| Modal thêm device — 500/network | Banner đỏ chung "Có lỗi xảy ra, vui lòng thử lại.", modal không đóng | §9 |
| Modal thêm group (Device Detail) — 404 (group vừa bị xóa) | Banner "Group đã chọn không còn tồn tại hoặc đã bị xóa.", modal không đóng | Rủi ro biết trước, §2.6 |
| Groups đang thuộc — Device retired (A26) | Banner xám (đã có từ F4) + ẩn "+ Thêm vào group" và mọi nút "×"; danh sách vẫn hiển thị, chỉ đọc | A26 |
| Groups đang thuộc — gọi thẳng API bỏ qua UI ẩn (A27) | Vẫn 422 ở BE — không có gì FE cần làm thêm để test này pass (double-check ở BE) | A27 |
| Success thêm device vào group | Đóng modal → toast `Đã thêm N thiết bị vào group` → tab về trang 1 + `devices_count` header cập nhật | SoT §4B |
| Success gỡ device khỏi group | Toast `Đã gỡ thiết bị khỏi group` → tab refetch (tự lùi trang nếu cần) + header cập nhật | SoT §4C |
| Success thêm group cho device | Đóng modal → toast `Đã thêm vào group` → khối "Groups đang thuộc" refetch (qua `load()` device) | SoT §4D |
| Success gỡ group khỏi device | Toast `Đã gỡ thiết bị khỏi group` → khối refetch | SoT §4D |
| Xóa Group từ trang chi tiết — 204 | Toast "Đã xóa group" → điều hướng về `/groups` (giữ filter cũ nếu có) | §2.1 |
| 401 bất kỳ lúc nào | Interceptor có sẵn — không đổi | Kế thừa F0 |

## 5. Rủi ro / open question

### OQ-FE-1 (đã xác nhận, 2026-09-16, Lai Bui) — Sửa/Xóa ở header Group Detail

**Quyết định: giữ**, đúng khuyến nghị (chi phí gần 0, đúng bản vẽ
`UI_UX_design.md` §6.1).

### OQ-FE-2 (đã xác nhận, 2026-09-16, Lai Bui) — Tab "Policies" hiện nhãn mờ hay ẩn hẳn?

**Quyết định: hiện nhãn mờ** (đối xứng `.nav-item.future`), đúng khuyến nghị —
khớp bản vẽ `UI_UX_design.md` §6.2, không phải nút chết vì không có `@click`.

### OQ-FE-3 (đã xác nhận, 2026-09-16, Lai Bui) — Modal "+ Thêm vào group" ở Device Detail: chọn 1 hay nhiều Group?

**Quyết định: `mode="single"`**, đúng nguyên văn SoT §4D bước 1 và đúng
khuyến nghị — tránh bịa thêm state "thành công một phần" mà SoT không có
acceptance nào bao.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **Message lỗi 422 chính xác của `POST .../devices`** (`DEVICE_IDS_BLANK_MESSAGE`,
  `DEVICE_IDS_CAP_MESSAGE`, `NO_VALID_DEVICES_MESSAGE`, và chuỗi ghép trong
  atomic-reject retired) là hằng số Ruby chưa được viết nguyên văn ra trong
  `F6-api.md` (chỉ có tên hằng). FE **không cần biết trước** — `extractFormErrors`
  chỉ render nguyên văn bất kể nội dung, đúng nguyên tắc "không tự dịch/ánh xạ
  message ở FE" đã chốt từ F5. `acceptance-author`/implementer chỉ cần đảm bảo
  chuỗi hiển thị **không rỗng và không phải tiếng Anh sống sượng** — nội dung cụ
  thể xác nhận khi code BE viết ra.
- **`AsyncSearchSelect` không hỗ trợ điều hướng bàn phím** (mục 10, §2.4) —
  chấp nhận được cho scope acceptance hiện có; nếu F7/F8 cần (vd danh sách
  Policy dài), bổ sung sau không phá props hiện tại (thuần thêm handler nội
  bộ).
- **`GroupDetailView` fetch header và tab độc lập, không tuần tự** — cả 2
  `watch(..., { immediate: true })` chạy song song ngay khi mount (đúng "gọi
  song song" SoT §4A bước 2), **trừ** trường hợp header 404 thì tab **không**
  được gọi (tối ưu — group không thuộc org thì tab chắc chắn cũng 404, gọi
  thêm chỉ tốn round-trip). Đây là 1 tối ưu nhỏ so với "luôn song song tuyệt
  đối", không ảnh hưởng acceptance vì kết quả cuối (trang "Không tìm thấy
  Group") giống hệt.
- **`devices_count` không bao giờ được cộng/trừ thủ công ở FE** — mọi thay đổi
  (thêm/gỡ) đều refetch header (`GET /groups/:id`) lấy số thật, đúng
  `UI_UX_design.md` §0.3. Chi phí thêm 1 request nhỏ mỗi lần thêm/gỡ, chấp
  nhận được (cùng đánh đổi F6-api.md §5 đã ghi nhận cho `GET /groups` index).
- **CSS mới cần thêm vào `styles/components.css`** (không tạo file riêng —
  quy ước từ F2):
  - `.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 16px 0; }` /
    `.tab-item { padding: 8px 4px; font-size: 13.5px; font-weight: 500; color: var(--text-muted); border-bottom: 2px solid transparent; }` /
    `.tab-item.active { color: var(--text); border-color: var(--accent); }` /
    `.tab-item.future { opacity: 0.4; cursor: default; }` — tab header Group Detail.
  - `.chip-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }` /
    `.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 100px; padding: 4px 6px 4px 10px; }` /
    `.chip button { background: none; border: none; cursor: pointer; color: var(--text-faint); font-size: 13px; line-height: 1; padding: 0 2px; }` — chip lựa chọn trong `AsyncSearchSelect`.
  - `.async-search { position: relative; }` /
    `.async-search-dropdown { position: absolute; z-index: 6; top: calc(100% + 4px); left: 0; right: 0; max-height: 240px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 20px rgba(15,23,33,0.12); }` /
    `.async-search-option { display: flex; flex-direction: column; gap: 2px; padding: 8px 11px; cursor: pointer; }` /
    `.async-search-option:hover { background: var(--surface-2); }` /
    `.async-search-option .sub { font-size: 11.5px; color: var(--text-faint); }` /
    `.async-search-empty, .async-search-loading, .async-search-hint { padding: 12px; font-size: 12.5px; color: var(--text-muted); text-align: center; }`
  - `.inline-confirm { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }` — hàng "Gỡ khỏi group? [Có, gỡ] [Hủy]" trong tab Thành viên.
  - **Không cần token màu mới** — mọi màu dùng lại `var(--accent)`/`var(--danger)`/`var(--border)` đã có (`UI_UX_design.md` §12 giữ nguyên).
- **`GroupListView`'s `viewDetail`/row-click và `DeviceListView`'s tương ứng
  giờ trùng tên/hành vi** — không tách hàm dùng chung vì mỗi view chỉ có 1
  dòng (`router.push(...)`), tách ra sẽ thêm 1 file cho 2 dòng code, không
  đáng.
- **Không phát hiện mâu thuẫn nào giữa SoT / `F6-api.md` / `UI_UX_design.md`**
  ngoài 3 điểm đã chủ động nêu ở §0/OQ-FE-1/OQ-FE-2/OQ-FE-3 (đều là "SoT để
  ngỏ, UI_UX_design.md vẽ cụ thể hơn" — không phải xung đột thật, không cần
  dừng lại chờ quyết định trước khi viết tài liệu này).
