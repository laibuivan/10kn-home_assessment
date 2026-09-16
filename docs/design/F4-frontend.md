---
feature_id: F4
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Frontend — F4

Nguồn: `docs/design/F4-api.md` (approved), `docs/design/F4-db.md` (approved),
`docs/sot/F4-device-detail.md` (approved), `UI_UX_design.md` (§0 nguyên tắc,
§4 Devices List, §5 Device Detail, §8 component dùng chung, §9 ma trận
loading/empty/error), `docs/design/F3-frontend.md` (approved — Devices List +
modal Tạo/Sửa đang tồn tại, F4 mở rộng chứ không viết lại), `PRD.md` bảng
"Giao diện bắt buộc", `web/src/` hiện có (đã đọc trực tiếp source, không suy
đoán): `views/devices/DeviceListView.vue`, `components/DataTable.vue` (đã có
sẵn prop `onRowClick` + class `.is-clickable`, **chưa được dùng** — F2/F3 cố
tình không truyền, xem `docs/design/F2-frontend.md` §5), `components/
DeviceFormModal.vue`/`FormModal.vue`, `stores/devices.ts`, `api/devices.ts`,
`types/device.ts`, `utils/apiError.ts`, `components/EmptyState.vue`/
`ErrorState.vue`/`StatusBadge.vue`, `components/AppShell.vue` (mẫu dropdown
`.user-menu`/`.user-dd` sẵn có để tham khảo cho `ActionsMenu` mới),
`router/index.ts`, `styles/components.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F4-frontend-preview.html`.

**Quyết định phạm vi quan trọng — khớp SoT §3/OQ-1:** F4 kích hoạt route
`/devices/:id` + điểm vào từ Devices List (click row, action "Xem chi tiết").
Trang chi tiết render đủ 3 khối theo layout `UI_UX_design.md` §5, nhưng khối
"Groups đang thuộc" và "Policy đang áp dụng" ở dạng **tĩnh, luôn empty**
(không gọi API riêng, không có state loading/error riêng cho 2 khối này) —
F6/F9 sẽ quay lại thay nội dung 2 khối này bằng dữ liệu/logic thật.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/devices/:id` | `views/devices/DeviceDetailView.vue` (mới) | Tên file + đường dẫn khớp đúng cấu trúc đề xuất ở `UI_UX_design.md` §1. Thêm vào `router/index.ts`: `{ path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true }` — route guard hiện có (`router.beforeEach`) tự áp dụng cho route mới này, không cần sửa gì (mọi path khác `/login` đã bị chặn nếu chưa đăng nhập). |
| `/devices` | `views/devices/DeviceListView.vue` | **Sửa trong file này** (không route mới): truyền `onRowClick` cho `DataTable` (điều hướng `/devices/:id`), đổi cột `actions` từ 1 nút "Sửa" rời sang `ActionsMenu` (2 mục: Sửa, Xem chi tiết — OQ-2), thêm cơ chế nhớ "vị trí list gần nhất" cho nút quay lại ở trang chi tiết (xem §3). |

Component con **mới** (tại `web/src/components/`, giữ đúng quy ước phẳng —
không tạo thư mục con theo feature):

| Component | Vai trò |
|---|---|
| `ActionsMenu.vue` | Dropdown "⋯" dùng chung (`UI_UX_design.md` §4 "Cột hành động `⋯`", §6.1 Groups list cũng cần đúng pattern này — build 1 lần, dùng lại được ngay khi F5/F7 tới, đúng khuyến nghị OQ-2). Nhận prop `items: ActionsMenuItem[]` (`{ key, label, onClick, disabled?, disabledTitle?, testId? }`), tự quản lý `open`/đóng khi click ra ngoài hoặc `Escape` — cùng cơ chế `AppShell.vue` đã dùng cho `.user-menu`/`.user-dd` (tham khảo, không tái dùng chung 1 component vì `AppShell`'s dropdown là 1-instance-toàn-trang, còn `ActionsMenu` cần nhiều instance độc lập, mỗi dòng bảng 1 cái). Item `disabled` render `<button disabled :title="disabledTitle">` bọc trong `<span class="tooltip-wrap">` — tái dùng đúng pattern tooltip đã có ở F3 cho "Sửa" trên device retired (`docs/design/F3-frontend.md` §2), chuyển từ đứng riêng sang thành 1 item trong menu. |

## 2. Element / Trigger / Action / Notes

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `DeviceListView` — `DataTable` (nhận thêm `on-row-click`, mới) | click vào 1 `<tr>` (ngoài vùng `actions`) | `router.push({ path: '/devices/' + row.id })` (A9) | `DataTable` đã có sẵn prop `onRowClick`/class `.is-clickable` từ F2 (chưa từng dùng) — F4 chỉ cần truyền, không sửa `DataTable.vue`. |
| `DeviceListView` — cột `actions` (đổi từ nút "Sửa" rời sang `ActionsMenu`, mới) | — | render `<span @click.stop><ActionsMenu :items="rowActions(row)" /></span>` | **`@click.stop` bắt buộc** trên span bọc ngoài — chặn click vào trigger "⋯"/item trong menu nổi bọt lên `<tr>` gây double-navigate (A10). `rowActions(row)` trả 2 item: `{ key: 'edit', label: 'Sửa', onClick: () => openEditModal(row), disabled: row.status === 'retired', disabledTitle: RETIRED_EDIT_BLOCKED_MESSAGE, testId: 'device-action-edit' }`, `{ key: 'view', label: 'Xem chi tiết', onClick: () => router.push('/devices/' + row.id), testId: 'device-action-view' }` — thứ tự đúng `UI_UX_design.md` §4 ("Sửa" trước, "Xem chi tiết" sau). |
| `ActionsMenu` — nút trigger "⋯" | click | toggle `open` | `data-testid="actions-menu-trigger"` (dùng chung, phân biệt theo `rowTestId` của `<tr>` cha khi cần trong Playwright — `closest('[data-testid="device-row"]')`). |
| `ActionsMenu` — 1 item | click | gọi `item.onClick()`, đóng menu (`open = false`) | Item `disabled` không gọi `onClick`. |
| `ActionsMenu` — click ra ngoài / `Escape` | click bên ngoài / `keydown.esc` | đóng menu | Cùng cơ chế `document.addEventListener('click'/'keydown', ...)` + `onUnmounted` cleanup như `AppShell.vue`/`FormModal.vue` đã làm. |
| `DeviceDetailView` — mount | mount | đọc `route.params.id`, gọi `fetchDevice(id)` (API mới, `api/devices.ts`) | State **cục bộ trong component** (`device`, `loadingDetail`, `notFound`, `loadError`), **không** đưa vào Pinia store — không có component nào khác cần đọc lại device đang xem (đúng nguyên tắc F3-frontend.md §3 đã áp dụng cho form: state không cần chia sẻ thì không đặt vào store toàn cục). |
| `DeviceDetailView` — nút "◀ Quay lại danh sách" | click | `router.push(backLocation)` | `backLocation` = `store.lastListLocation` (ghi lại lần cuối `DeviceListView` được mount/đổi query — xem §3) nếu có, fallback `/devices` (OQ-5, A12/§5.1). |
| `DeviceDetailView` — nút "Sửa" (chỉ hiện khi `status != retired`) | click | mở `DeviceFormModal` (tái dùng nguyên từ F3), `mode: 'edit'`, `device: device` | Giống hệt cách `DeviceListView` mở modal Sửa — copy nguyên state pattern (`showModal`/`modalMode`/`modalDevice`), khác 1 điểm duy nhất ở `onSaved` (xem dưới). |
| `DeviceFormModal` — sau khi lưu thành công (`@saved`) trên trang chi tiết | event | `showModal = false; toastStore.push(message); load()` | **Khác `DeviceListView`**: gọi lại `load()` của chính `DeviceDetailView` (refetch `GET /devices/:id`), **không** gọi `fetchDevices` (list) — SoT §4 "Sửa từ Device Detail" bước 2, A6. Header (StatusBadge, banner retired) cập nhật ngay theo response mới, không cần user tự tải lại trang. |
| Device đang `retired` (đọc từ `device.value.status` sau khi load) | — (derived) | Ẩn hẳn nút "Sửa" (không render, không phải disable — khác với trên list, ở đây không cần tooltip vì không có gì để hover), hiện banner xám "Thiết bị đã retired — không thể chỉnh sửa." | A4. Class `.warning-banner`-style nhưng màu xám trung tính, không phải đỏ/vàng — cần thêm biến thể CSS mới (xem §5), vì `.error-banner`/`.warning-banner` hiện có đều mang màu cảnh báo/lỗi, không hợp ngữ nghĩa "thông tin trung tính" của banner này. |
| Khối "Groups đang thuộc" | — (tĩnh) | Render cố định `EmptyState` con (title "Chưa thuộc group nào.", không CTA, không icon lớn — dùng biến thể nhỏ gọn hơn `EmptyState` chuẩn vì đây là 1 khối trong trang, không phải toàn bộ nội dung trang) | A7. Không gọi API, không loading/error riêng (SoT OQ-1). |
| Khối "Policy đang áp dụng" | — (tĩnh) | Render cố định text "Chưa có policy nào áp dụng." | A8. Tương tự A7. |
| `DeviceDetailView` — lỗi `404` khi load | response 404 | `notFound.value = true`, thay toàn bộ nội dung trang bằng `EmptyState` (title "Không tìm thấy thiết bị", description ngắn, slot chứa nút "Quay lại danh sách") | A1/A2/A3 — dùng chung 1 UI cho cả 3 case (không phân biệt lý do, đúng `CLAUDE.md` §4). Tái dùng nguyên `EmptyState.vue` đã có, không tạo component "NotFound" riêng. |
| `DeviceDetailView` — lỗi `500`/network khi load | response lỗi khác 404 | `loadError.value = extractErrorMessage(...)`, render `ErrorState` (tái dùng nguyên, có sẵn nút "Thử lại" gọi lại `load()`) | A12. |
| `DeviceDetailView` — đang load lần đầu | mount, trước khi response về | Hiện skeleton (dùng lại `.skeleton-cell` đã có ở `components.css`/`DataTable.vue`, không viết CSS mới) thay cho Header + 2 khối | Không loading riêng từng khối ở F4 (khác mockup §5, xem SoT "Rủi ro/giả định" — đã approve chấp nhận sai khác này). |

## 3. State management

- **`api/devices.ts`** (mở rộng, thêm 1 hàm mới):
  ```ts
  /** Response envelope — F4-api.md §0: giống hệt create/update, bọc trong `device`. */
  export async function fetchDevice(id: number | string): Promise<DeviceResponse> {
    const response = await apiClient.get<DeviceResponse>(`/api/v1/devices/${id}`)
    return response.data
  }
  ```
  Không thêm type response mới — tái dùng `DeviceResponse` (interface hiện
  đã có, dùng nội bộ cho `createDevice`/`updateDevice`; cần export thêm nếu
  chưa export, hoặc định nghĩa lại 1 dòng giống hệt tại chỗ dùng — implementer
  quyết định lúc code, không phải quyết định thiết kế).
- **`utils/apiError.ts`** (mở rộng, thêm 1 hàm nhỏ, không sửa hàm hiện có):
  ```ts
  export function isNotFoundError(error: unknown): boolean {
    return (error as ErrorWithResponse | undefined)?.response?.status === 404
  }
  ```
  Dùng ở `DeviceDetailView` để rẽ nhánh `notFound` (UI thay hẳn nội dung
  trang) khỏi các lỗi khác (`loadError`, banner + "Thử lại") — 2 UI hoàn toàn
  khác nhau (§7 SoT), không thể dùng chung 1 `extractErrorMessage` như list.
- **`stores/devices.ts`** (mở rộng — chỉ thêm 1 field nhỏ cho cơ chế "quay
  lại danh sách", **không** thêm state/action cho việc fetch 1 device — xem
  lý do "không đưa vào store" ở §2):
  ```ts
  interface DevicesState {
    // ...state hiện có từ F2 không đổi...
    lastListLocation: string | null
  }
  // state(): => ({ ..., lastListLocation: null })
  ```
  `DeviceListView.vue` ghi vào field này mỗi khi route (`/devices` + query)
  thay đổi:
  ```ts
  watch(() => route.fullPath, (fullPath) => { store.lastListLocation = fullPath }, { immediate: true })
  ```
  `DeviceDetailView.vue` đọc `store.lastListLocation ?? '/devices'` cho nút
  "◀ Quay lại danh sách" (OQ-5) — đặt ở Pinia (không phải `sessionStorage`)
  vì chỉ cần sống trong phiên SPA hiện tại, không cần sống qua reload trang
  (reload trang chi tiết trực tiếp vốn dĩ không có "danh sách trước đó" để
  nhớ — fallback `/devices` là đúng cho case này, khớp A11).
- **`DeviceDetailView.vue`** local state (không phải Pinia — cùng triết lý F3
  đã áp dụng cho form, áp dụng lần đầu cho 1 fetch đơn lẻ):
  ```ts
  const device = ref<Device | null>(null)
  const loadingDetail = ref(true)
  const notFound = ref(false)
  const loadError = ref<string | null>(null)

  async function load() {
    loadingDetail.value = true
    notFound.value = false
    loadError.value = null
    try {
      const response = await fetchDevice(route.params.id as string)
      device.value = response.device
    } catch (error) {
      if (isNotFoundError(error)) notFound.value = true
      else loadError.value = extractErrorMessage(error, GENERIC_LOAD_ERROR)
    } finally {
      loadingDetail.value = false
    }
  }

  watch(() => route.params.id, load, { immediate: true })
  ```
  `watch(() => route.params.id, ...)` (không phải `onMounted`) — cùng đề
  phòng navigate thẳng giữa 2 trang chi tiết khác nhau (Vue Router tái dùng
  component khi chỉ đổi param, không remount) dù F4 chưa có UI nào tự điều
  hướng kiểu đó (link "Xem tất cả nguồn"/group link thuộc F6/F9) — làm đúng
  ngay từ đầu để không phải sửa lại khi F6/F9 thêm link `/devices/:id` khác
  trỏ vào chính view này.
  - `showModal`/`modalMode`/`modalDevice` — copy nguyên state pattern từ
    `DeviceListView.vue` (chỉ cần `mode: 'edit'`, không cần `'create'` ở
    trang chi tiết — không có nút "+ Thêm Device" ở đây).
  - `backLocation = computed(() => devicesStore.lastListLocation ?? '/devices')`.

## 4. Empty / loading / error / success

- **Loading (lần đầu vào trang)**: skeleton thay cho toàn bộ Header + 2 khối
  (không loading riêng từng khối — xem SoT "Rủi ro/giả định", sai khác có
  chủ đích với `UI_UX_design.md` §5). Dùng lại `.skeleton-cell` (đã có) bọc
  trong vài dòng `<div>` mô phỏng layout Header (identifier, name, v.v.) —
  không cần component skeleton riêng, y hệt cách `DataTable` đã dùng class
  này cho `skeleton-row`.
- **404** (A1/A2/A3): thay **toàn bộ** nội dung trang (kể cả không còn nút
  "◀ Quay lại danh sách" ở vị trí header — nút quay lại nằm trong slot của
  chính `EmptyState` lúc này) bằng `EmptyState` — title "Không tìm thấy thiết
  bị", description "Thiết bị này không tồn tại hoặc bạn không có quyền xem.",
  slot chứa `<RouterLink :to="backLocation" class="btn btn-secondary">◀ Quay
  lại danh sách</RouterLink>`.
- **500/network** (A12): `ErrorState` với message từ `extractErrorMessage`
  (fallback "Không tải được thông tin thiết bị."), nút "Thử lại" gọi lại
  `load()` — tái dùng y hệt component/pattern F2 đã dùng cho list.
- **Success**: Header hiện đầy đủ 6 field + `StatusBadge` (tái dùng), nút
  "Sửa" (nếu không retired) hoặc banner retired (nếu retired); 2 khối
  Groups/Policy hiện empty tĩnh (§2).
- **Sau khi Sửa thành công từ trang chi tiết**: `load()` chạy lại → có 1
  khoảnh khắc `loadingDetail = true` (skeleton lại) trước khi dữ liệu mới về
  — chấp nhận được (thời gian rất ngắn, 1 request đơn), không cần giữ dữ
  liệu cũ hiển thị mờ như `DataTable`'s `showOverlay` (over-engineering cho
  1 trang chi tiết đơn, khác list vốn có nhiều dòng dễ "giật" khi thay toàn
  bộ bằng skeleton).
- **Không có state riêng cho 2 khối Groups/Policy** (SoT OQ-1) — chúng không
  bao giờ ở trạng thái loading/error/success khác nhau ở F4, chỉ luôn 1
  trạng thái empty tĩnh, kể cả khi Header đang loading/error (2 khối này chỉ
  render khi Header cũng đã render thành công, vì cả 3 cùng nằm trong
  `v-else` sau khi qua được `loadingDetail`/`notFound`/`loadError`).

## 5. Rủi ro / open question

- **CSS mới cần thêm vào `styles/components.css`** (kế thừa quy ước "không
  tạo file CSS riêng theo component" — `docs/design/F2-frontend.md` §5):
  - `.detail-header { ... }`, `.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }` (+ `@media` thu về 1 cột trên màn hẹp, cùng breakpoint `640px` đã dùng ở `.shell`) — layout 3-khối theo `UI_UX_design.md` §5.
  - `.neutral-banner { ...màu xám trung tính... }` — banner retired ở trang
    chi tiết **không** nên dùng `.warning-banner` (màu vàng, ngữ nghĩa "cảnh
    báo cần chú ý") hay `.error-banner` (đỏ, ngữ nghĩa "lỗi") vì "device đã
    retired" là 1 trạng thái ổn định, không phải lỗi — cần 1 biến thể riêng,
    dùng `--text-muted`/`--surface-2` (token đã có) thay vì thêm token màu
    mới.
  - `.dropdown-trigger`, `.dropdown-menu`, `.dropdown-menu.open`,
    `.dropdown-item`, `.dropdown-item:disabled` — style cho `ActionsMenu`,
    phỏng theo đúng `.user-btn`/`.user-dd`/`.user-dd.open` đã có ở
    `AppShell.vue` nhưng đặt tên tổng quát hơn (không gắn với "user") để
    dùng lại được cho Groups/Policies list sau này (đúng tinh thần OQ-2).
  - Không cần thêm gì cho skeleton Header (tái dùng `.skeleton-cell`) hay
    `EmptyState`/`ErrorState` (đã tổng quát sẵn).
- **`ActionsMenu` là component mới quan trọng nhất của F4** (khác `F4-api.md`,
  vốn gần như không có gì mới) — rủi ro chính nằm ở accessibility/UX cơ bản:
  nhiều instance trên cùng 1 trang (1 mỗi dòng bảng) đều tự lắng nghe
  `document click`/`keydown`, có thể hơi tốn (không đáng kể với ≤20 dòng/
  trang — pagination đã giới hạn). Không tự giới hạn "chỉ 1 menu mở tại 1
  thời điểm" bằng cơ chế phức tạp (event bus/store) — outside-click-closes
  của từng instance đã tự nhiên đảm bảo mở menu B thì menu A đóng ngay khi
  click ra ngoài để mở B (khoảnh khắc 2 menu cùng mở giữa 2 lần click không
  quan sát được trong thực tế thao tác người dùng).
- **`ActionsMenu` không dùng `<Teleport>`** — dropdown menu render tại chỗ
  (`position: absolute` trong `.tooltip-wrap`-style wrapper `position:
  relative`), có thể bị cắt (`overflow: hidden`) nếu `DataTable`'s
  `.table-wrap` (đã có `overflow-x: auto`) cắt theo trục dọc ở màn hẹp. Rủi
  ro chấp nhận được ở scope F4 (bảng Devices hiện chỉ 7 cột, không quá rộng
  để cần scroll ngang thường xuyên) — nếu review thấy bị cắt thật khi test
  thủ công, đây là điểm cần quay lại thêm `<Teleport to="body">`, không phải
  lỗi thiết kế nghiêm trọng cần chặn approve.
- **`fetchDevice` nhận `id` kiểu `number | string`** (khác các hàm khác nhận
  `number`) — vì `route.params.id` luôn là `string` (Vue Router), truyền
  thẳng không ép kiểu, tránh 1 bước `Number(...)` không cần thiết (BE nhận gì
  cũng được vì Rails tự parse `params[:id]` từ URL, luôn là string ở tầng
  HTTP dù route khác có convention nhận `number`).
- **Không thêm field `groups`/`applied_policies` vào `types/device.ts`**
  (khớp `F4-api.md` §5/OQ-6) — 2 khối FE không đọc field nào từ `Device` cho
  nội dung của chúng, nội dung là text tĩnh hard-code trong template.
- **`EmptyState` dùng lại cho cả "danh sách rỗng" (F2) lẫn "device không tìm
  thấy" (F4) lẫn "khối Groups/Policy rỗng" (F4)** — xác nhận component đủ
  tổng quát cho cả 3 cách dùng (chỉ khác `title`/`description`/slot), không
  cần biến thể/prop mới nào ở chính `EmptyState.vue`.
