---
feature_id: F5
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Frontend — F5

Nguồn: `docs/design/F5-api.md` (approved — 4 endpoint, response shape, envelope
lỗi, A1–A25), `docs/design/F5-db.md` (approved — `Group::NAME_BLANK_MESSAGE`,
`Group::NAME_TAKEN_MESSAGE`, length 100/500, `description` blank → `NULL`),
`docs/sot/F5-group-crud.md` (approved — §4 main flow, §5 edge case, §6 business
rule, §7 UI state, §11 acceptance, §12 OQ-1…OQ-8), **`UI_UX_design.md`** (§0
nguyên tắc, §2 IA/routes + layout khung, §6.1 Group List, §8 component dùng
chung, §9 ma trận loading/empty/error, §10 validate, §12 token), `PRD.md` bảng
"Giao diện bắt buộc" dòng "Groups" + §"Yêu cầu chỉnh chu",
`docs/design/F2-frontend.md` / `F3-frontend.md` / `F4-frontend.md` (approved —
pattern URL-as-source-of-truth, FormModal, ActionsMenu), và **source thật đã đọc
trực tiếp** trong `web/src/`: `views/devices/DeviceListView.vue`,
`components/{AppShell,DataTable,PaginationBar,FilterBar,EmptyState,ErrorState,FormModal,DeviceFormModal,ActionsMenu,ToastContainer}.vue`,
`stores/{devices,toast,auth}.ts`, `api/{client,devices}.ts`,
`types/{device,ui}.ts`, `utils/apiError.ts`, `router/index.ts`,
`styles/components.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F5-frontend-preview.html` — không approve file `.md` này khi chưa
xem file preview.

## 0. Phạm vi & sai khác có chủ đích so với `UI_UX_design.md` §6.1

F5 dựng **đúng 1 route mới** (`/groups`) theo `UI_UX_design.md` §2, layout theo
§6.1, nhưng **cố tình bỏ 2 thứ** mà §6.1 có mô tả — đây là quyết định đã chốt ở
SoT, không phải thiếu sót, và **phải ghi lại trong `DESIGN.md`**:

| §6.1 mô tả | F5 làm gì | Nguồn quyết định |
|---|---|---|
| Cột **"Số device"** (`devices_count`) | **Không render**. Bảng chỉ có `Name │ Description │ ⋯`. API F5 cố ý không trả `devices_count` (`F5-api.md` §2.5) nên FE không có nguồn dữ liệu; đếm ở FE bị `UI_UX_design.md` §0.3 cấm | SoT OQ-4 |
| Action **"Xem chi tiết"** trong menu ⋯ + trang `/groups/:id` | **Không render**, **không thêm route**. Menu ⋯ chỉ có "Sửa"/"Xóa" — render một mục disable sẽ là "nút chết" (`PRD.md` §"Yêu cầu chỉnh chu", `UI_UX_design.md` §0.1) | SoT OQ-5 |
| Câu confirm xóa có số N device | Bỏ số N, dùng câu không có số (§2.1) | SoT OQ-4 |

F6 (membership) **bắt buộc khôi phục đủ cả 3** thứ trên. Ngược lại, F5 **thêm**
một thứ §6.1 để ngỏ ("có thể chỉ cần search theo tên"): ô search `q` có debounce
+ sync URL (SoT OQ-6).

Route/layout khung/component dùng chung của `UI_UX_design.md` là **cố định** —
F5 không đổi `/groups`, không đổi cấu trúc `.shell`/`.sidebar`/`.topbar`, không
thay `DataTable`/`PaginationBar`/`EmptyState`/`ErrorState`/`FormModal`/
`ActionsMenu` bằng thứ khác.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/groups` | `views/groups/GroupListView.vue` (**mới**) | Đường dẫn file khớp `UI_UX_design.md` §1. Thêm vào `router/index.ts`: `{ path: '/groups', name: 'groups', component: GroupListView }`. Router guard hiện có (`router.beforeEach`) tự áp dụng — chưa đăng nhập mở `/groups` → redirect `/login` (A21), **không sửa guard**. Query string là nguồn chân lý: `?q=&page=` (§3). Không `props: true` (không có route param) |
| `/devices`, `/devices/:id` | `views/devices/*` | **Không đụng tới** — F5 không sửa view/store/api của Devices |
| `/groups/:id` | — | **Cố ý không tạo** (SoT OQ-5). Không có nút/link nào trong F5 trỏ tới path này |

Component **mới** tại `web/src/components/` (giữ quy ước phẳng, không tạo thư
mục con theo feature — đúng F3/F4):

| Component | Vai trò | Ghi chú |
|---|---|---|
| `ConfirmModal.vue` | Modal xác nhận **dùng chung** cho mọi hành động xóa/gỡ | `UI_UX_design.md` §8 đã định nghĩa sẵn (title, message, confirmLabel đỏ nếu destructive, `onConfirm` async tự disable) nhưng **chưa từng được build** — F5 là nơi build lần đầu. Đặc tả đầy đủ ở §2.1 vì F6 (gỡ device khỏi group) / F8 (gỡ policy) phải dùng lại **không sửa một dòng nào** |
| `GroupFormModal.vue` | Form tạo/sửa Group | Bọc `FormModal.vue` của F3 (không viết lại shell modal), sở hữu field + validate + gọi API. Cùng khuôn `DeviceFormModal.vue` |
| `SearchInput.vue` | Ô search có debounce + nút xóa | **Mở rộng có chủ đích** ngoài bảng §8 — xem OQ-FE-1 (§5) để người duyệt chốt: (a) build shared component, hay (b) inline trong `GroupListView` |

Component **tái dùng nguyên vẹn, không sửa**: `AppShell.vue` (trừ phần nav —
§2.2), `DataTable.vue`, `PaginationBar.vue`, `EmptyState.vue`, `ErrorState.vue`,
`FormModal.vue`, `ActionsMenu.vue`, `ToastContainer.vue`. `ActionsMenu.vue`
được F4 viết sẵn có chủ đích cho Groups/Policies (comment đầu file) — F5 là
lần đầu xác nhận điều đó đúng: **truyền `items` khác, không sửa component**.

## 2. Element / Trigger / Action / Notes

Mọi `data-testid` dưới đây là **hợp đồng với `acceptance-author`** — đổi tên sau
khi approve = làm RED acceptance test.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `AppShell` — nav "Groups" | click | `RouterLink to="/groups"` → điều hướng `/groups` | `data-testid="nav-groups"`. Thay `<span class="nav-item future">` hiện tại (§2.2). Acceptance "Sidebar có mục Groups dẫn tới trang Groups" |
| `GroupListView` — mount / đổi `route.query` | mount, `watch(activeQuery, immediate: true)` | `store.fetchGroups({ q, page })` → `GET /api/v1/groups?q=&page=` | Cùng cơ chế `DeviceListView`: `activeQuery` là `computed` đọc `route.query`, watch nó (không `deep`). Vào thẳng `/groups?page=3&q=sales` fetch đúng ngay (SoT §5.1) |
| `GroupListView` — nút "+ Thêm Group" (đầu trang) | click | `modalMode='create'; modalGroup=null; showModal=true` | `data-testid="add-group-button"`. **Ẩn khi empty-state A14 đang hiện** (A14 có CTA riêng dùng **cùng** testid) — đúng cách F3 xử lý để trang không bao giờ có 2 phần tử cùng testid |
| `SearchInput` — gõ vào ô search | `input`, debounce **300ms** | `router.replace({ query: { q: value.trim() \|\| undefined } })` — **bỏ hẳn key `page`** → reset về trang 1 | `data-testid="group-search-input"`, placeholder "Tìm theo tên group...". `replace` chứ không `push` (gõ 10 ký tự không được đẻ 10 entry lịch sử). Trim trước khi gửi; chuỗi chỉ-khoảng-trắng = không lọc (`F5-api.md` §2.1 — BE cũng normalize y hệt, 2 lớp nhất quán) |
| `SearchInput` — Enter | `keydown.enter` | Flush debounce, áp dụng ngay | Không submit form nào (ô search không nằm trong `<form>`) |
| `SearchInput` — nút "Xóa tìm kiếm" (chỉ hiện khi `q` khác rỗng) | click | `router.replace({ query: {} })` → `q` và `page` cùng biến mất | `data-testid="search-clear-button"` (SoT §5.1 "chỉ hiện khi đang có `q`" → không có nút chết) |
| `DataTable` — bảng group | — | Cột: `Name` │ `Description` │ `⋯` (`actions`, `cellClass: 'actions-cell'`) | `test-id="groups-table"`, `row-test-id="group-row"`. **Không truyền `onRowClick`** → bảng không clickable, không con trỏ pointer (OQ-5: không có trang chi tiết để đi tới) |
| `DataTable` — ô `Description` | — | slot `#cell-description`: `<span class="cell-truncate" :title="row.description ?? undefined">{{ row.description ?? '—' }}</span>` | `description` có thể tới 500 ký tự → cắt 1 dòng bằng CSS, full text ở tooltip (§5 CSS mới). `null` → `'—'` (đúng `emptyValue` mặc định của `DataTable`, nhất quán F2) — **không bao giờ hiện chữ "null"** (A25). Xem §5 ghi chú cho `acceptance-author` |
| `ActionsMenu` (mỗi dòng) — trigger "⋯" | click | mở menu của đúng dòng đó | Tái dùng nguyên component F4, `data-testid="actions-menu-trigger"`. Không cần `@click.stop` bọc ngoài như F4 vì `<tr>` ở đây **không** có `onRowClick` |
| `ActionsMenu` — item "Sửa" | click | `modalMode='edit'; modalGroup=row; showModal=true` | `testId: 'group-action-edit'`. Prefill từ **dữ liệu dòng đã có trong store**, không gọi `GET /groups/:id` (endpoint đó không tồn tại — `F5-api.md` §1) |
| `ActionsMenu` — item "Xóa" | click | `confirmTarget = row` (mount `ConfirmModal` bằng `v-if`) | `testId: 'group-action-delete'`. **Chưa phát sinh request nào** (A23) |
| `ActionsMenu` — danh sách item | — | Đúng **2 item**: "Sửa", "Xóa" | Acceptance "Menu hành động của Group chỉ có các hành động đã có thật" — không có "Xem chi tiết", không item disable (OQ-5) |
| `GroupFormModal` — field `name` | `input` | `clearFieldError('name')` | `data-testid="group-form-name"`, label "Tên group". **Không đặt thuộc tính `maxlength`** — xem §5 (bẫy: `maxlength=100` làm scenario A10 không thể chạy qua UI) |
| `GroupFormModal` — field `description` | `input` | `clearFieldError('description')` | `data-testid="group-form-description"`, `<textarea rows="3">`, label "Mô tả (tùy chọn)", hint "Tối đa 500 ký tự". Cũng **không** `maxlength` |
| `GroupFormModal` — submit, client validate | click "Lưu" / submit form | Nếu `name.trim()` rỗng → `fieldErrors.name = ["Tên group không được để trống"]`, **không gọi API** | A4. Dùng **đúng câu chữ** `Group::NAME_BLANK_MESSAGE` của BE (`F5-db.md` §1) để user thấy 1 message duy nhất dù lỗi chặn ở client hay server — khác F3 (client dùng `"can't be blank"` tiếng Anh) vì ở F5 BE đã có message tiếng Việt tường minh |
| `GroupFormModal` — submit, mode `create` | sau khi client validate sạch | `POST /api/v1/groups` body phẳng `{ name, description? }` — `description` **bị bỏ khỏi body khi rỗng** (`undefined` → axios không gửi) | `201` → `emit('saved', { mode: 'create', message: 'Đã tạo group' })`. Không bao giờ gửi `organization_id` (A22, `UI_UX_design.md` §0.6) |
| `GroupFormModal` — submit, mode `edit` | sau khi client validate sạch | `PATCH /api/v1/groups/:id` body `{ name, description }` — `description` **luôn được gửi, kể cả chuỗi rỗng** | `200` → `emit('saved', { mode: 'edit', message: 'Đã cập nhật group' })`. **Khác create có chủ đích**: gửi `''` là cách duy nhất để *xóa* mô tả (BE normalize `''` → `NULL`, `F5-api.md` §2.3); nếu bỏ field đi thì PATCH partial sẽ giữ nguyên mô tả cũ và nút "xóa mô tả" thành nút chết |
| `GroupFormModal` — response `422` | catch | `extractFormErrors(error, 'Có lỗi xảy ra, vui lòng thử lại.')` → lỗi bám đúng field `name`/`description`, **modal không đóng, dữ liệu đã nhập giữ nguyên** | A4/A5/A7/A9/A10. Tái dùng nguyên util của F3, **không viết hàm map lỗi mới**. `name` trùng → hiện "Tên group này đã tồn tại trong tổ chức của bạn." dưới field `name`; A5 và A7 (race) không phân biệt được ở FE — đúng thiết kế (`F5-api.md` §2.2) |
| `GroupFormModal` — response `404` (chỉ mode edit) | catch, `isNotFoundError(error)` | `emit('missing')` → parent: đóng modal, toast lỗi "Group không tồn tại hoặc đã bị xóa", refetch list | A12 nhánh **sửa**. Bắt riêng trước nhánh 422/500: nếu để `extractFormErrors` xử lý thì banner sẽ hiện nguyên chữ `"Not found"` tiếng Anh của API |
| `GroupFormModal` — response `500`/network | catch | `baseError = 'Có lỗi xảy ra, vui lòng thử lại.'` → banner đỏ **trên đầu form**, modal không đóng | `UI_UX_design.md` §9. `extractFormErrors` đã tự chặn không hiển thị body của lỗi ≥500 |
| `GroupFormModal` — "Hủy" / `Escape` / click nền | click | `emit('cancel')` → parent `showModal = false` | Bị chặn khi `submitting` (hành vi có sẵn của `FormModal`) |
| `ConfirmModal` (xóa) — nội dung | mount | title "Xóa group?"; message: `Xóa group "<tên>" sẽ gỡ toàn bộ liên kết của group này với device và policy đang gán. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.` | **Đúng nguyên văn SoT OQ-4** (không có số N). Acceptance assert 2 ý: "không thể hoàn tác" + "device và policy không bị xóa" |
| `ConfirmModal` — nút "Xóa" (destructive) | click | `submitting = true` → `await onConfirm()` | `data-testid="confirm-modal-confirm"`, class `btn btn-danger`. Nút tự disable + spinner ⇒ **double-click chỉ 1 request** (A24) — đảm bảo ở tầng component, không phải ở từng màn hình gọi nó |
| `GroupListView.handleDeleteConfirm` — `204` | await xong | `confirmTarget = null` (đóng modal) → `toast.push('Đã xóa group')` → `load()` (refetch **đúng trang & q hiện tại**) | SoT §4 luồng Xóa bước 4. **Không optimistic delete**: dòng chỉ biến mất sau khi list mới về (SoT §4 bước 5) |
| `GroupListView.handleDeleteConfirm` — `404` | catch, `isNotFoundError` | `confirmTarget = null` → `toast.push('Group không tồn tại hoặc đã bị xóa', 'error')` → `load()` | A12 nhánh **xóa**. Đóng modal vì thử lại cũng vô nghĩa; refetch để dòng ma biến mất |
| `GroupListView.handleDeleteConfirm` — `500`/network | catch, còn lại | **Giữ modal mở**, `toast.push('Không xóa được group, vui lòng thử lại.', 'error')`, nút "Xóa" tự enable lại | A13 + SoT §7 ("toast lỗi; với 404 thì refresh"). Dòng vẫn còn trên bảng (không refetch, không xóa ở FE) → khớp acceptance "Group vẫn còn trong danh sách". Message **cố định theo status**, không dùng `extractErrorMessage` — tránh đổ nội dung 500 của server ra UI |
| `ConfirmModal` — "Hủy" / `Escape` / click nền | click | `emit('cancel')` → `confirmTarget = null` | A23 — **không phát sinh request nào**. Bị chặn khi `submitting` |
| `PaginationBar` | click ‹ / › | `router.replace({ query: { q, page: page===1 ? undefined : String(page) } })` | Tái dùng nguyên component F2. Đổi trang **giữ nguyên `q`** (đối xứng với "đổi `q` reset page") |
| `ErrorState` — nút "Thử lại" | click | `load()` | A19. `data-testid="retry-button"` (có sẵn trong component) |

### 2.1 Đặc tả `ConfirmModal.vue` (component dùng chung — build lần đầu ở F5)

Đây là phần **phải viết đủ tổng quát ngay từ F5**: F6 (gỡ device khỏi group) và
F8 (gỡ/ gán policy) sẽ dùng lại **không được phép sửa** component này.

```ts
const props = withDefaults(defineProps<{
  title: string
  message: string
  /** Nhãn nút xác nhận. Mặc định trung tính — mỗi chỗ gọi tự đặt ("Xóa", "Gỡ khỏi group"...). */
  confirmLabel?: string
  cancelLabel?: string
  /** true → nút xác nhận dùng `btn-danger` (đỏ). false → `btn-primary`. */
  destructive?: boolean
  /** Hành động thật. Có thể async; ConfirmModal await nó. */
  onConfirm: () => Promise<unknown> | unknown
  testId?: string
  confirmTestId?: string
  cancelTestId?: string
}>(), {
  confirmLabel: 'Xác nhận',
  cancelLabel: 'Hủy',
  destructive: false,
  /* các testId: undefined */
})

const emit = defineEmits<{ cancel: []; error: [unknown] }>()
```

Hành vi bắt buộc:

1. **Single-flight**: `submitting` là state **nội bộ** của ConfirmModal.
   `run()` mở đầu bằng `if (submitting.value) return` → click 2 lần chỉ 1
   request (A24), và **mọi** màn hình dùng lại đều được đảm bảo này miễn phí.
2. **Disable + spinner trong nút** khi đang chạy — dùng đúng cơ chế CSS đã có:
   `:disabled="submitting" :data-busy="submitting"` + `<span class="btn-label">`
   / `<span class="spinner">` (giống `FormModal`), **không viết CSS spinner mới**.
   Nút "Hủy" cũng disable khi đang chạy.
3. **Không tự đóng.** ConfirmModal không biết thao tác thành công hay thất bại
   nghĩa là gì — parent quyết định đóng bằng `v-if` (đúng cách `FormModal` +
   `DeviceFormModal` đã làm ở F3). Nhờ vậy nhánh "lỗi 500 → giữ modal mở để thử
   lại" (A13) không cần thêm prop nào.
4. **Đóng bằng `Escape` / click nền / nút Hủy → `emit('cancel')`**, nhưng
   **bị chặn khi `submitting`** (tránh bỏ lại 1 request đang bay mà không còn
   chỗ render kết quả — đúng lý do đã ghi ở `FormModal`). Listener `keydown`
   đăng ký ở `onMounted`, gỡ ở `onUnmounted`.
5. **Không dùng `window.confirm`** (`UI_UX_design.md` §10) — đây là lý do
   component này tồn tại.
6. **Lưới an toàn cho lỗi**: `try { await props.onConfirm() } catch (e) { emit('error', e) } finally { submitting = false }`.
   Hợp đồng chính là "parent tự xử lý mọi kết quả trong `onConfirm`" (ở F5
   `handleDeleteConfirm` luôn `try/catch`); `catch` ở đây chỉ để một promise bị
   reject không trở thành unhandled rejection in ra console (`UI_UX_design.md`
   §10 cấm để `console.error` sót lại). Parent không bắt buộc lắng nghe `error`.
7. **A11y tối thiểu**: `role="dialog"`, `aria-modal="true"`,
   `aria-labelledby` trỏ tới `<h3>`; khi mount **focus vào nút "Hủy"** (không
   phải nút xác nhận) — mặc định an toàn cho hộp thoại destructive, tránh
   Enter vô tình xóa mất dữ liệu.
8. **Markup dùng lại nguyên class có sẵn**: `.modal-backdrop` / `.modal` /
   `.modal h3` / `.modal p` / `.modal .actions` — **không thêm CSS mới nào** cho
   component này.

### 2.2 Thay đổi bắt buộc ở `AppShell.vue` (nợ kỹ thuật F0 ghi đích danh F5)

`AppShell.vue` hiện hard-code `class="nav-item active"` cho Devices và để Groups
/Policies là `<span class="nav-item future">`, kèm comment nợ đích danh F5/F7
(`docs/design/F0-frontend.md` §5). F5 phải trả **cả hai** nửa của món nợ, nếu
chỉ làm nửa đầu thì sidebar sẽ sáng "Devices" khi đang ở `/groups` — lỗi nhìn
thấy ngay và đã có acceptance scenario bắt.

| Thay đổi | Chi tiết |
|---|---|
| Bật nav Groups | `<span class="nav-item future">Groups</span>` → `<RouterLink to="/groups" class="nav-item" active-class="active" data-testid="nav-groups">` |
| Bỏ highlight hard-code | `<RouterLink to="/devices" class="nav-item active">` → `<RouterLink to="/devices" class="nav-item" active-class="active" data-testid="nav-devices">` |
| Policies | **Giữ nguyên** `<span class="nav-item future">` cho tới F7 (chưa có route → không được là link) |
| `.sidebar-note` | Sửa chữ "Groups/Policies ẩn ở F0 — hiện khi F5/F7 thêm route" → "Policies hiện khi F7 thêm route" |
| Comment nợ kỹ thuật | Xóa comment F0 (đã trả xong phần Groups), thay bằng 1 dòng ngắn: chỉ còn Policies chờ F7 |

**Cơ chế highlight — chọn `active-class="active"` của `RouterLink`** thay vì tự
so `route.path`:

- `router-link-active` (mà `active-class` đổi tên thành `active`) match theo
  **tiền tố route** → `/devices/:id` vẫn giữ sáng mục "Devices" ở trang chi tiết
  F4. Nếu tự viết `route.path === '/devices'` thì trang chi tiết mất highlight —
  một hồi quy của F4 do F5 gây ra.
- Không cần `import { useRoute }` vào `AppShell`, không thêm `computed` nào →
  diff nhỏ nhất có thể trên file mà mọi trang đều dùng.
- Tương đương về mặt kết quả với "highlight theo route hiện tại" mà SoT §3 yêu
  cầu; nếu người duyệt muốn tường minh bằng `route.path`, xem OQ-FE-3 (§5).

## 3. State management

### 3.1 `types/group.ts` (mới) — khớp **đúng** `F5-api.md` §2.5, không thêm/bịa field

```ts
export interface Group {
  id: number
  name: string
  description: string | null   // null khi không có mô tả — API không bao giờ trả ""
  created_at: string
  updated_at: string
}
// KHÔNG có devices_count (OQ-4), KHÔNG có organization_id (F5-api.md §2.5)

export interface GroupListResponse { groups: Group[]; meta: PaginationMeta }
export interface GroupResponse { group: Group }

/** Query params view gửi đi; `per_page` cố ý vắng mặt → dùng default 20 của server (đúng F2). */
export interface GroupQueryParams { q?: string; page: number }

export interface GroupCreatePayload { name: string; description?: string }
export interface GroupUpdatePayload { name?: string; description?: string }
```

`PaginationMeta` (`{ current_page, per_page, total_count, total_pages }`) —
shape **giống hệt** `DeviceListMeta` đang có; xem OQ-FE-2 (§5) để chốt tách
dùng chung hay khai lại.

### 3.2 `api/groups.ts` (mới) — 4 hàm, đúng 4 endpoint, không hơn

```ts
export async function fetchGroupList(params: GroupQueryParams): Promise<GroupListResponse>
  // GET /api/v1/groups  — axios tự bỏ param `undefined`, nên q rỗng = "tất cả"
export async function createGroup(payload: GroupCreatePayload): Promise<GroupResponse>
  // POST /api/v1/groups — body phẳng, KHÔNG bọc { group: ... } (F5-api.md §0)
export async function updateGroup(id: number, payload: GroupUpdatePayload): Promise<GroupResponse>
  // PATCH /api/v1/groups/:id
export async function deleteGroup(id: number): Promise<void>
  // DELETE /api/v1/groups/:id — 204, body rỗng: KHÔNG đọc response.data
```

Tất cả đi qua `apiClient` có sẵn (`api/client.ts`) → tự gắn Bearer token và tự
xử lý 401 → redirect `/login` (A20). **Không tạo axios instance mới.**
**Tuyệt đối không có** `fetchGroup(id)` — endpoint `show` không tồn tại
(`F5-api.md` §1); form Sửa prefill từ dòng đã có trong store.

### 3.3 `stores/groups.ts` (mới) — cùng khuôn `stores/devices.ts`

```ts
interface GroupsState {
  groups: Group[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  lastRequestId: number   // response cũ về muộn không được đè response mới
}
```

| Action | Endpoint | Ghi chú |
|---|---|---|
| `fetchGroups(params)` | `GET /api/v1/groups` | Sở hữu `loading`/`error` (state của **danh sách**, nhiều nơi cùng đọc). Giữ nguyên `groups`/`meta` cũ khi refetch lỗi (không làm trắng bảng — SoT §7). Guard `lastRequestId` **quan trọng hơn ở F5 so với F2**: gõ search có debounce vẫn có thể bắn 2 request sát nhau |
| `createGroup(payload)` | `POST /api/v1/groups` | **Không** set `loading`/`error` của store; lỗi được `throw` nguyên vẹn để `GroupFormModal` tự map 422 field-level — đúng nguyên tắc đã chốt ở `F3-frontend.md` §3 (state của 1 lần submit thuộc về component sở hữu form) |
| `updateGroup(id, payload)` | `PATCH /api/v1/groups/:id` | Như trên |
| `deleteGroup(id)` | `DELETE /api/v1/groups/:id` | Như trên (lỗi throw lên cho `GroupListView`). **Không** tự xóa phần tử khỏi `state.groups` — không optimistic delete (SoT §4 bước 5); danh sách chỉ đổi sau `fetchGroups` kế tiếp |

`lastListLocation` (F4) **không** cần bản sao cho Groups — F5 không có trang chi
tiết để quay lại.

### 3.4 URL là nguồn chân lý cho `q` + `page`

Giống hệt `DeviceListView` (`F2-frontend.md` §3): store giữ **dữ liệu**,
`route.query` giữ **"đang xem cái gì"** → reload/back-button không bao giờ lệch
với bảng đang hiển thị, và link `/groups?page=3&q=sales` share được (SoT §5.1).

```ts
const activeQuery = computed<GroupQueryParams>(() => {
  const parsed = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
  const q = (firstQueryValue(route.query.q) ?? '').trim()
  return { q: q || undefined, page }
})
```

- `firstQueryValue` (`?page=1&page=2` → lấy giá trị đầu) **copy đúng** helper đã
  có trong `DeviceListView` — xem OQ-FE-4 (§5) về việc nâng lên `utils/`.
- `page` rác trong URL (`?page=abc`) bị **sanitize về 1 ở FE**, không gửi đi →
  A17 (422 `page`) là hợp đồng API, không phải trạng thái người dùng bình
  thường nhìn thấy; đúng quyết định F2 OQ-FE-1/2.
- Mọi cập nhật dùng `router.replace` (không `push`).
- Đổi `q` → **bỏ key `page`** (reset trang 1, SoT §5.1). Đổi `page` → **giữ `q`**.
- Tạo group thành công → `router.replace({ query: { q } })` (về trang 1, **giữ
  nguyên `q`**) rồi `load()`; sort `created_at DESC` (OQ-7) đảm bảo group mới
  đứng đầu trang 1. Nếu `q` đang lọc và tên mới không khớp `q`, group vừa tạo
  sẽ **không** xuất hiện dù toast báo thành công — hệ quả chấp nhận được, giống
  hệt điều F3 đã chốt cho filter Devices; **không** tự ý xóa `q` của người dùng.
- Sửa/xóa thành công → giữ nguyên `q` **và** `page`, chỉ `load()` lại (SoT §4).
- **Tự lùi trang khi trang hiện tại rỗng** (SoT §5.1 "xóa dòng cuối của trang >
  1"): tái dùng watcher `store.meta` của `DeviceListView`, mở rộng 1 nhánh:
  ```
  if (meta.total_pages > 0 && page > meta.total_pages) → về trang meta.total_pages
  if (meta.total_count === 0 && page > 1)              → về trang 1   // nhánh mới
  ```
  Nhánh 2 xử lý trường hợp xóa hết sạch group ở trang > 1 (`total_pages` = 0),
  nơi công thức của F2 sẽ đứng im và để lại một trang trắng.

## 4. Empty / loading / error / success

Áp `UI_UX_design.md` §9 cho F5 (SoT §7). Không có thao tác async chạy nền nào ở
F5 (không job, không poll — `F5-api.md` §4).

| Tình huống | Hiển thị | Nguồn |
|---|---|---|
| **Loading lần đầu** (chưa có dòng nào) | `DataTable` tự render **skeleton rows**; `.list-head` + ô search vẫn hiển thị bình thường → không giật layout. Bảng **không** mang `data-testid="groups-table"` khi đang skeleton (hành vi có sẵn của `DataTable`: chờ bảng = chờ dữ liệu thật) | §9 dòng 1 |
| **Loading khi đổi trang / search / refetch sau mutation** | Overlay mờ + spinner **đè lên bảng cũ**, không xóa trắng rồi vẽ lại (hành vi có sẵn `DataTable`: `rows.length > 0 && loading`) | §9 dòng 2, SoT §7 |
| **Loading trong modal** (tạo/sửa) | Nút "Lưu" disable + spinner trong nút, nút "Hủy" disable, `Escape`/click nền không đóng được | `FormModal` có sẵn |
| **Loading trong ConfirmModal** (xóa) | Nút "Xóa" disable + spinner, "Hủy" disable, không đóng được giữa chừng | §2.1 |
| **Empty A14** — org chưa có group nào (`total_count === 0` **và** `q` rỗng) | `EmptyState` title **"Chưa có group nào"**, description "Organization này chưa có Group nào.", slot = nút **"+ Thêm Group"** (`data-testid="add-group-button"`, mở đúng modal tạo — không phải nút trang trí). Nút "+ Thêm Group" ở đầu trang **bị ẩn** lúc này | A14, SoT §11 |
| **Empty A15** — search không khớp (`total_count === 0` **và** `q` khác rỗng) | `EmptyState` title **"Không tìm thấy group nào"**, description "Thử từ khóa khác hoặc xóa tìm kiếm.", slot = nút **"Xóa tìm kiếm"** (`data-testid="empty-state-clear-search-button"`). **Không** có CTA tạo mới (tránh hiểu nhầm org chưa có group nào) | A15, SoT §11 |
| Phân biệt A14 / A15 | Bằng **state `q` của chính FE** — API trả response giống hệt nhau cho 2 case và cố ý không có cờ `searched` (`F5-api.md` §3). FE **không** yêu cầu thêm field nào từ server | `F5-api.md` §5 |
| **Empty chỉ hiện sau khi đã có response** | `showEmptyState = !loading && meta !== null && meta.total_count === 0` | §9 (đang loading thì skeleton, không phải "chưa có group nào") |
| **Error tải danh sách (A19)** | `ErrorState` (message từ store, fallback "Không tải được danh sách group.") + nút "Thử lại" → `load()`. **Ô search vẫn dùng được**, không trang trắng, không spinner treo | A19, §9 |
| **Error form 422** | Lỗi hiện **dưới đúng field** (`field-error-name` / `field-error-description`), modal giữ nguyên dữ liệu đã nhập | A4/A5/A9/A10, §9 |
| **Error form 500/network** | Banner đỏ **trên đầu form**: "Có lỗi xảy ra, vui lòng thử lại.", modal không đóng | §9 |
| **Error sửa — 404 (A12)** | Đóng modal + toast lỗi "Group không tồn tại hoặc đã bị xóa" + refetch list | A12 |
| **Error xóa — 404 (A12)** | Đóng ConfirmModal + toast lỗi "Group không tồn tại hoặc đã bị xóa" + refetch list (dòng ma biến mất) | A12, SoT §7 |
| **Error xóa — 500/network (A13)** | Toast lỗi "Không xóa được group, vui lòng thử lại.", **giữ ConfirmModal mở** để thử lại, **không** refetch, dòng vẫn còn trên bảng | A13, SoT §4 bước 5 |
| **Success tạo** | Đóng modal → toast "Đã tạo group" → về trang 1 (giữ `q`) → group mới đứng đầu bảng | SoT §4, OQ-7 |
| **Success sửa** | Đóng modal → toast "Đã cập nhật group" → refetch **đúng trang + `q` hiện tại** | SoT §4 |
| **Success xóa** | Đóng ConfirmModal → toast "Đã xóa group" → refetch trang hiện tại (tự lùi trang nếu trang rỗng — §3.4) | SoT §4/§5.1 |
| **401 bất kỳ lúc nào** | Interceptor `api/client.ts` có sẵn: xóa token + `window.location.assign('/login')` | A20 |
| **Chưa đăng nhập mở `/groups`** | `router.beforeEach` có sẵn → redirect `/login` | A21 |

Toast dùng nguyên `useToastStore().push(message, variant)` + `ToastContainer`
đã mount trong `AppShell` — F5 là feature **đầu tiên** dùng `variant: 'error'`
(store đã viết sẵn cho việc này từ F3, không cần sửa store).

## 5. Rủi ro / open question

### OQ-FE-1 (cần người duyệt chốt) — Ô search: component dùng chung hay inline?

`UI_UX_design.md` §8 **không** có component search trong bảng component dùng
chung (`FilterBar.vue` chỉ là select-based, không debounce), nhưng §6.1 (Groups)
và §7.1 (Policies) đều vẽ một ô `[ Search ]`.

- **(a) Tạo `components/SearchInput.vue`** — props `modelValue`,
  `placeholder`, `debounceMs = 300`, `testId`, `clearTestId`; emit
  `change(value)` (đã debounce + trim) và `clear`. Tự hiện nút "Xóa tìm kiếm"
  khi có giá trị. — **Khuyến nghị.** F7 (Policy list) cần đúng ô này; logic
  debounce + timer cleanup (`onUnmounted`) là chỗ dễ rò rỉ nếu copy 2 lần, và
  hành vi "reset page khi đổi search" sẽ lệch nhau nếu mỗi màn hình tự viết.
- **(b) Inline trong `GroupListView.vue`** — ít file hơn, nhưng F7 gần như chắc
  chắn phải copy lại nguyên khối.
- **(c) Mở rộng `FilterBar.vue` nhận filter kiểu `text`** — **không khuyến
  nghị**: `FilterBar` là component đã approve ở F2 với ngữ nghĩa "select đổi
  là áp dụng ngay"; nhét ô text có debounce vào sẽ đổi hợp đồng của một
  component đang được Devices list dùng, kéo theo phải chạy lại toàn bộ vitest
  + acceptance F2 mà không thu được gì.

**Quyết định (approve):** chọn **(a)** — build `components/SearchInput.vue`
dùng chung.

### OQ-FE-2 (cần người duyệt chốt) — `PaginationMeta` dùng chung hay khai lại?

`meta` của `GET /groups` **giống hệt từng ký tự** `DeviceListMeta` trong
`types/device.ts`.

- **(a) Thêm `PaginationMeta` vào `types/ui.ts`**, `types/group.ts` dùng nó, và
  đổi `DeviceListMeta` thành `export type DeviceListMeta = PaginationMeta` —
  **khuyến nghị.** Thay đổi **thuần type-level, không có runtime** (build ra
  JS y hệt), rủi ro hồi quy ~0, và đây cũng là lựa chọn mà `F5-api.md` §5
  OQ-API-1 đã chốt cho phía BE (tách `Paginatable` concern) — 2 tầng nhất quán
  với nhau.
- **(b) Khai lại `GroupListMeta` trong `types/group.ts`** — không đụng file của
  F2, đổi lại có 2 định nghĩa cùng shape.

**Quyết định (approve):** chọn **(a)** — thêm `PaginationMeta` vào
`types/ui.ts`, `DeviceListMeta` thành alias. Nhất quán với quyết định tách
`Paginatable` ở BE (`F5-api.md` §5 OQ-API-1).

### OQ-FE-3 (xác nhận, không chặn) — Cơ chế highlight sidebar

§2.2 chọn `active-class="active"` của `RouterLink` thay vì so sánh `route.path`
thủ công, vì nó giữ được highlight "Devices" khi đang ở `/devices/:id` (F4).
Nếu người duyệt muốn tường minh theo `route.path` như SoT §3 diễn đạt, cách
tương đương là `:class="{ active: route.path.startsWith('/devices') }"` —
**phải dùng `startsWith`, không phải `===`**, nếu không sẽ làm hồi quy trang chi
tiết Device của F4.

**Quyết định (approve):** giữ nguyên `active-class="active"` của `RouterLink`
như đề xuất.

### OQ-FE-4 (xác nhận, không chặn) — `firstQueryValue` bị "khóa" trong `DeviceListView`

Helper `firstQueryValue` hiện là hàm module-scope trong `DeviceListView.vue`;
`GroupListView` cần đúng nó. Khuyến nghị: **chuyển sang
`web/src/utils/queryParams.ts`** và cho cả 2 view import (refactor thuần, 6
dòng) — cùng lý do đã chốt cho `Paginatable` ở BE. Nếu người duyệt muốn diff của
F5 không chạm file F2, copy 3 dòng cũng chấp nhận được (rủi ro lệch gần như
bằng 0 vì hàm không có state).

**Quyết định (approve):** chuyển `firstQueryValue` sang
`web/src/utils/queryParams.ts`, dùng chung cho cả 2 view.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **Bẫy `maxlength`**: **không** đặt `maxlength="100"`/`maxlength="500"` lên 2
  input của `GroupFormModal`. Nghe thì "chỉnh chu" hơn, nhưng nó khiến scenario
  A10 ("Tên hoặc mô tả vượt giới hạn độ dài bị chặn") **không thể chạy qua UI**
  — Playwright gõ 150 ký tự thì trình duyệt tự cắt còn 100 và request trở nên
  hợp lệ, test xanh giả. Giới hạn độ dài là hợp đồng của server (422 field-
  level); FE chỉ validate `name` rỗng ở client (chặn 1 request chắc chắn hỏng),
  còn lại để server trả lỗi thật — đúng `UI_UX_design.md` §11 ("message lỗi từ
  API hiện ra được").
- **Ghi chú cho `acceptance-author` về A25**: ô mô tả trống render `—` (em dash,
  `emptyValue` mặc định của `DataTable`, nhất quán với Devices list F2). SoT
  §11 viết "ô mô tả hiển thị trống" — scenario nên assert **"không hiển thị chữ
  `null`"** (đúng ý A25: chỉ có một cách biểu diễn "không có mô tả"), **không**
  assert chuỗi rỗng tuyệt đối, nếu không sẽ RED vì `—`. Nếu người duyệt muốn ô
  thật sự trống, chỉ cần truyền `:empty-value="''"` cho `DataTable` — nhưng khi
  đó Groups list sẽ khác Devices list về mặt thị giác.
- **Message lỗi trộn 2 ngôn ngữ trong cùng 1 form**: `name` rỗng → "Tên group
  không được để trống" (tiếng Việt), `name` > 100 → "is too long (maximum is
  100 characters)" (tiếng Anh, mặc định Rails). Đã được `F5-api.md` §5 OQ-API-2
  **approve giữ nguyên** — FE chỉ render nguyên văn message server trả về,
  **không** tự dịch/ánh xạ ở FE (làm vậy sẽ tạo nguồn chân lý thứ hai cho câu
  chữ lỗi). Ghi vào `DESIGN.md` như một hạn chế đã biết.
- **CSS mới cần thêm vào `styles/components.css`** (giữ quy ước "không tạo file
  CSS riêng theo component" — `F2-frontend.md` §5):
  - `.search-row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }`
    và `.search-row .field { width: 280px; }` — hàng search của Group list
    (không dùng `.filter-bar` vì đó là khung của select-filter F2).
  - `.cell-truncate { display: block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
    — cột Description (tối đa 500 ký tự) không được làm vỡ layout bảng.
  - **Không cần CSS mới cho `ConfirmModal`** (dùng lại `.modal*` + `.btn-danger`
    đã có từ F0/F3) và không cần token màu mới (`UI_UX_design.md` §12 giữ
    nguyên).
- **`ConfirmModal` không dùng `<Teleport>`**, `.modal-backdrop` đã là
  `position: fixed; z-index: 20` trong `components.css` nên vẫn phủ toàn màn
  hình dù được mount bên trong `AppShell` — đúng cách `FormModal` đang chạy ở
  F3. Toast (`z-index: 30`) nằm **trên** modal → toast lỗi ở nhánh A13 vẫn đọc
  được khi ConfirmModal còn mở (đã kiểm tra bằng giá trị z-index thật trong
  `components.css`, không phải suy đoán).
- **Debounce + phân trang cùng lúc**: gõ search trong lúc request trang cũ chưa
  về → `lastRequestId` trong store đảm bảo response cũ không đè kết quả mới.
  Timer debounce phải được `clearTimeout` ở `onUnmounted` (nếu không, rời trang
  giữa lúc gõ sẽ gọi `router.replace` trên một view đã unmount).
- **Không bịa thêm endpoint**: FE chỉ gọi đúng 4 endpoint của `F5-api.md` §1.
  Không có chỗ nào trong thiết kế này cần dữ liệu mà API chưa có (`devices_count`
  đã bị loại khỏi UI cùng lúc với việc loại khỏi contract) — không có yêu cầu
  đổi contract nào gửi ngược lại `api-designer`.
- **Không phát hiện mâu thuẫn nào giữa SoT / `F5-api.md` / `UI_UX_design.md`**
  ngoài 2 sai khác **đã được SoT chốt trước** ở §0 (cột "Số device", action "Xem
  chi tiết") — không có điểm nào cần dừng lại để hỏi.
