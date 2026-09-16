---
feature_id: F3
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Frontend — F3

Nguồn: `docs/design/F3-api.md` (approved), `docs/design/F3-db.md` (approved),
`docs/sot/F3-device-create-edit.md` (approved), `UI_UX_design.md` (§0 nguyên
tắc, §4 Devices List/modal Tạo-Sửa, §8 component dùng chung, §9 ma trận
loading/empty/error, §10 validate), `docs/design/F2-frontend.md` (approved —
Devices List đang tồn tại, F3 mở rộng chứ không viết lại), `PRD.md` bảng
"Giao diện bắt buộc", `web/src/` hiện có (`AppShell.vue`, `DataTable.vue`,
`FilterBar.vue`, `PaginationBar.vue`, `EmptyState.vue`, `ErrorState.vue`,
`StatusBadge.vue`, `stores/devices.ts`, `api/devices.ts`, `types/device.ts`,
`utils/apiError.ts`, `views/devices/DeviceListView.vue` — tất cả từ F2,
approved; `views/LoginView.vue` từ F0 cho tham khảo pattern submit/banner lỗi
— chưa có `FormModal.vue`/toast nào tồn tại, F3 là feature đầu tiên build cả
2 thứ này).

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F3-frontend-preview.html`.

**Quyết định phạm vi quan trọng — khớp SoT §3:** F3 kích hoạt đúng phần
"tạo/sửa" của mockup đầy đủ ở `UI_UX_design.md` §4 (nút "+ Thêm Device", hành
động "Sửa" theo dòng) — **không** làm cột `⋯` gộp "Sửa"+"Xem chi tiết", **không**
click-through row (route `/devices/:id` thuộc F4, chưa tồn tại — giữ đúng
nguyên tắc "không nút chết" mà chính F2 đã áp dụng cho hành động "Sửa" khi đó
chưa có gì để mở). Thiết kế dưới đây chỉ thêm 1 nút "Sửa" độc lập mỗi dòng.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/devices` | `views/devices/DeviceListView.vue` | Route/component đã tồn tại từ F2. F3 **sửa trong file này** (không route mới): thêm nút "+ Thêm Device" vào `.list-head`, thêm cột `actions` vào `DataTable`, thêm CTA vào biến thể Empty A1, thêm state điều khiển modal (`showModal`, `modalMode`, `modalDevice`) và render `<DeviceFormModal>` có điều kiện. |

Component con **mới** (tại `web/src/components/`, giữ đúng quy ước phẳng —
không tạo thư mục con theo feature, giống `DataTable.vue`/`FilterBar.vue`
hiện có):

| Component | Vai trò |
|---|---|
| `FormModal.vue` | Shell modal dùng chung (`UI_UX_design.md` §8) — backdrop, tiêu đề, banner lỗi `base`/hạ tầng, nút Hủy/Lưu (disable + spinner khi `submitting`), đóng khi bấm backdrop/Escape (trừ khi đang submit). **Không biết gì về field cụ thể** — nội dung form nằm ở default slot, do component gọi nó tự quản lý field-level error (đúng nghĩa "slot form" ở `UI_UX_design.md` §8, không phải FormModal tự bọc lỗi field). Dùng lại được nguyên vẹn cho Group/Policy sau này. |
| `DeviceFormModal.vue` | Feature-specific (F3): bọc `FormModal`, chứa 4 field `identifier`/`name`/`platform`/`os_version` + field `status` (chỉ hiện khi edit). Nhận `mode`/`device` qua prop, tự quản lý `form`/`fieldErrors`/`submitting`, gọi `deviceStore.createDevice`/`updateDevice`, emit `saved`/`close` ra `DeviceListView`. |
| `ToastContainer.vue` | Render stack toast góc dưới màn hình, đọc từ `stores/toast.ts`. Mount **1 lần** ở `AppShell.vue` (mọi trang sau login dùng chung), không phải theo từng view — F3 là feature đầu tiên cần toast nên build ở đây, tái dùng cho F5/F6/F7/F8. |

## 2. Element / Trigger / Action / Notes

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `.list-head` — nút "+ Thêm Device" (mới) | click | `modalMode = 'create'; modalDevice = null; showModal = true` | Luôn enable (không có điều kiện chặn tạo mới — SoT §9, mọi user active đều tạo được). |
| `EmptyState` biến thể A1 (org chưa có device, không do filter) — CTA "+ Thêm Device" (mới, SoT §7) | click | Y hệt nút trên | Biến thể A2 (rỗng do filter) **không** đổi — vẫn chỉ có "Xóa lọc" như F2 (`UI_UX_design.md` §9: CTA theo đúng lý do rỗng, thêm cả 2 nút vào A2 sẽ gây nhiễu vì org đã có device, chỉ đang bị lọc hết). |
| `DataTable` — cột `actions` (mới) — nút "Sửa" trên dòng `status != retired` | click | `modalMode = 'edit'; modalDevice = row; showModal = true` | Prefill từ đúng object `row` đã có sẵn trong `store.devices` — **không** gọi thêm API (SoT §4 Sửa bước 1, `F3-api.md` §5 "không thêm action `show`"). |
| `DataTable` — cột `actions` — nút "Sửa" trên dòng `status == retired` | hover | Không có action (disabled) | Bọc trong `<span class="tooltip-wrap" title="Thiết bị đã retired, không thể sửa">` quanh `<button disabled>` — dùng `title` gốc của trình duyệt thay vì component tooltip riêng (không có trong `UI_UX_design.md` §8 danh sách component dùng chung, thêm 1 component mới cho riêng việc này là over-engineering). `title` đặt trên `<span>` bọc ngoài (không phải trên chính `<button disabled>`) vì 1 số trình duyệt không nổi tooltip trên phần tử disabled. |
| `DeviceFormModal` mount (`mode: 'edit'`) | mount | Khởi tạo `form` từ `props.device` (đã có sẵn, truyền tay từ `DataTable` row) | Không loading state — đúng SoT §7 "không có loading state riêng cho mở modal Sửa". `identifier` field: `<input :value="form.identifier" disabled>`. |
| `DeviceFormModal` mount (`mode: 'create'`) | mount | `form` khởi tạo rỗng, `status` không có trong `form`/UI (ẩn hẳn field, không phải disable) | Khớp SoT §3 "status không hiện trên form tạo". |
| `DeviceFormModal` — input bất kỳ | `input`/`change` | Xóa lỗi field-level cũ của đúng field đó khỏi `fieldErrors` (nếu có) | Không xóa `baseError` (lỗi retired/hạ tầng gắn với cả request, không gắn 1 field — sửa 1 input không làm request cũ "đúng" trở lại cho tới khi submit lại). |
| `FormModal` — nút "Lưu" (submit form) | click / `Enter` trong input | `onSubmit()` ở `DeviceFormModal`: (1) chạy `clientValidate()`, dừng nếu có lỗi (không gọi API); (2) nếu qua, `submitting = true`, gọi `deviceStore.createDevice`/`updateDevice`; (3) thành công → `emit('saved', { mode, message })`; (4) thất bại → map lỗi qua `extractFormErrors`, set `fieldErrors`/`baseError`, **không** đóng modal | Nút disable + `data-busy` (spinner) suốt lúc `submitting === true`; `onSubmit` tự `return` sớm nếu `submitting` đã `true` (chặn double-submit dù user cố click/Enter nhiều lần — SoT §7). |
| `FormModal` — nút "Hủy" / click backdrop / phím `Escape` | click / `keydown.esc` | `emit('cancel')` → `DeviceListView.closeModal()`: `showModal = false` | **Vô hiệu hoá khi `submitting === true`** (quyết định mới, không có trong SoT nhưng hợp lý — tránh đóng modal giữa chừng 1 request đang bay, để tránh trạng thái mồ côi; xem §5). Không gọi API, không có thay đổi tới danh sách (SoT §5.1). |
| `DeviceListView` — nhận `@saved` từ `DeviceFormModal` | event | `showModal = false; toastStore.push(message); load()` | `load()` là hàm đã có sẵn từ F2 (`store.fetchDevices(activeQuery.value)`) — refetch **đúng filter/trang hiện tại trong URL**, không đổi query, không nhảy trang (SoT §5.1). Nếu record vừa sửa không còn khớp filter (vd chuyển `active` → `retired` khi đang lọc `active`) nó biến mất khỏi bảng sau refetch — hành vi đúng, không phải bug (SoT §5.1). |
| `ToastContainer` — mỗi toast | mount | Tự `setTimeout` gọi `toastStore.dismiss(id)` sau ~3s | Toast cũng có nút "×" đóng tay ngay (không bắt buộc chờ hết 3s) — theo tinh thần "không trang/element chết" `UI_UX_design.md` §0.1 áp cho mọi affordance hiện ra. |

## 3. State management

- **`stores/devices.ts`** (mở rộng, không đổi state hiện có từ F2):
  - Thêm 2 action mới, **không** có `loading`/`error` riêng ở tầng store cho
    chúng (khác với `fetchDevices`) — lỗi/loading của create/update là state
    **cục bộ của `DeviceFormModal`** (giống cách `LoginView.vue` tự giữ
    `submitting`/`errorMessage` riêng thay vì đặt vào `authStore`), vì đây là
    lỗi/trạng thái của 1 lần submit form, không phải state cần chia sẻ giữa
    nhiều component:
    ```ts
    async createDevice(payload: DeviceCreatePayload): Promise<Device> {
      const response = await createDevice(payload) // api/devices.ts
      return response.device
    }
    async updateDevice(id: number, payload: DeviceUpdatePayload): Promise<Device> {
      const response = await updateDevice(id, payload)
      return response.device
    }
    ```
    Ném lỗi nguyên vẹn (không catch) — `DeviceFormModal` là nơi quyết định
    hiển thị gì, giống nguyên tắc `authStore.login` đã áp dụng ở F0.
- **`api/devices.ts`** (mở rộng): thêm `createDevice(payload)` →
  `apiClient.post('/api/v1/devices', payload)`, `updateDevice(id, payload)` →
  `apiClient.patch(`/api/v1/devices/${id}`, payload)`. Body gửi phẳng, đúng
  `F3-api.md` §0/§1 (không bọc `{ device: {...} }` ở request — chỉ response
  mới bọc).
- **`types/device.ts`** (mở rộng): thêm `DeviceCreatePayload` (`identifier`,
  `name`, `platform`, `os_version?`), `DeviceUpdatePayload` (`name?`,
  `platform?`, `os_version?`, `status?`) — khớp đúng strong params `F3-api.md`
  §2.1/§2.2 (FE **không tự thêm** `organization_id`/`id` vào các type này, để
  không có chỗ nào lỡ gán nhầm — `UI_UX_design.md` §0.6).
- **`utils/apiError.ts`** (mở rộng, thêm hàm mới — **không sửa**
  `extractErrorMessage` hiện có, để không ảnh hưởng F0/F2 đã test xanh):
  ```ts
  export function extractFormErrors(
    error: unknown,
    genericFallback: string,
  ): { fieldErrors: Record<string, string[]>; baseError: string | null } {
    const body = (error as ErrorWithResponse | undefined)?.response?.data
    if (body?.errors) {
      const fieldErrors: Record<string, string[]> = {}
      let baseError: string | null = null
      for (const [key, messages] of Object.entries(body.errors)) {
        if (key === 'base') baseError = messages[0] ?? null
        else fieldErrors[key] = messages
      }
      return { fieldErrors, baseError }
    }
    if (body?.error) return { fieldErrors: {}, baseError: body.error }
    return { fieldErrors: {}, baseError: genericFallback }
  }
  ```
  Đây là điểm quyết định chính khớp `F3-api.md` §0/OQ-4: key `base` → biến
  thành `baseError` (render banner ở `FormModal`); key khác → giữ nguyên
  trong `fieldErrors` (render dưới field tương ứng ở `DeviceFormModal`);
  không có `body.errors` lẫn `body.error` (network/timeout, không response
  body) → `baseError = genericFallback` ("Có lỗi xảy ra, vui lòng thử lại." —
  A13).
- **`DeviceFormModal.vue`** local state (không phải Pinia — cùng triết lý
  `LoginView.vue`):
  - `form: reactive` — giá trị field hiện tại, khởi tạo theo `mode`/`device`.
  - `fieldErrors: ref<Record<string, string[]>>({})` — hợp nhất lỗi
    client-validate (trước submit) và lỗi field-level từ server (sau submit),
    dùng chung 1 chỗ hiển thị.
  - `baseError: ref<string | null>(null)`.
  - `submitting: ref(false)`.
  - `clientValidate()`: `identifier` bắt buộc (chỉ mode `create`, vì
    `edit` không có input này), `name` bắt buộc (cả 2 mode), `platform` bắt
    buộc chọn 1 giá trị (cả 2 mode) — do 3 field này dùng `<select>`/`<input>`
    có validate ngay tại FE trước khi chạm API (SoT §4 bước 2/2'). `platform`
    dùng `<select>` với option trống `"-- Chọn --"` (`value=""`) làm giá trị
    mặc định ở mode `create`, nên "chưa chọn" phân biệt được với "chọn nhầm"
    — không cần validate enum riêng vì `<select>` chỉ sinh ra giá trị hợp lệ
    có sẵn trong `DEVICE_PLATFORMS`/`DEVICE_STATUSES` (tái dùng đúng hằng số
    đã có ở `types/device.ts` từ F2, không tự liệt kê lại).
- **`stores/toast.ts`** (mới):
  ```ts
  interface ToastItem { id: number; message: string; variant: 'success' | 'error' }
  export const useToastStore = defineStore('toast', {
    state: () => ({ toasts: [] as ToastItem[], nextId: 1 }),
    actions: {
      push(message: string, variant: 'success' | 'error' = 'success') {
        const id = this.nextId++
        this.toasts.push({ id, message, variant })
        setTimeout(() => this.dismiss(id), 3000)
      },
      dismiss(id: number) {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      },
    },
  })
  ```
  F3 chỉ dùng `variant: 'success'` (2 message theo SoT §11: "Đã tạo device" /
  "Đã cập nhật device") — `variant: 'error'` để sẵn cho feature sau (F6/F8 có
  thể cần toast lỗi cho action khác ngoài form, vd job failed).
- **`DeviceListView.vue`** thêm local state: `showModal: ref(false)`,
  `modalMode: ref<'create' | 'edit'>('create')`, `modalDevice: ref<Device | null>(null)`.
  Modal render bằng `v-if="showModal"` (không `v-show`) — mỗi lần mở là
  **mount lại từ đầu** `DeviceFormModal`, nên component tự có state sạch
  (không cần code riêng để "reset form" khi đổi từ sửa device A sang tạo mới
  — unmount/mount tự lo việc đó, đơn giản hơn watcher).

## 4. Empty / loading / error / success

Kế thừa nguyên ma trận đã lập ở `docs/design/F2-frontend.md` §4 cho phần
list/table (không đổi) — dưới đây chỉ phần **mới** của F3 (modal tạo/sửa):

- **Mở modal (create/edit)**: không loading — tạo mở form trống ngay,
  sửa prefill ngay từ dữ liệu row có sẵn (SoT §7).
- **Submit — đang chờ response**: nút "Lưu" disable + spinner trong nút
  (class `.btn[data-busy="true"]`, cùng pattern `.submit-btn[data-busy]` đã
  có ở `LoginView`/`components.css`, tổng quát hoá thêm cho `.btn` — xem §5).
  Nút "Hủy" cũng disable trong lúc này (ngăn đóng modal giữa chừng 1 request
  đang bay).
- **Lỗi field-level (422 thường — A1/A3/A4/A5/A12, hoặc lỗi client-validate
  trước submit)**: text đỏ ngay dưới field tương ứng + viền field chuyển đỏ
  (`.field.has-error`), modal không đóng, `submitting` trả về `false`. Nhiều
  field lỗi cùng lúc hiện đồng thời (A3 — không dừng ở field đầu).
- **Lỗi banner "chặn vì retired" (A8, key `base`)**: banner đỏ trên đầu form
  (bên trong `FormModal`, phía trên slot), message y hệt tooltip disable
  "Thiết bị đã retired, không thể sửa" — nhất quán 1 câu duy nhất giữa UI
  disable và lỗi API thật (OQ-4). Trên thực tế case này **không thể xảy ra
  qua thao tác FE bình thường** (nút "Sửa" của dòng retired đã disable từ
  trước, không mở được modal) — đường này chỉ có ý nghĩa nếu có bug tương lai
  làm nút vô tình enable, hoặc test gọi thẳng API; `DeviceFormModal` vẫn phải
  xử lý đúng vì không được "chỉ dựa vào FE disable" (`CLAUDE.md` §4).
- **Lỗi hạ tầng (A13 — network/500, không có `body.errors`/`body.error`)**:
  banner đỏ "Có lỗi xảy ra, vui lòng thử lại." — cùng vị trí banner với case
  retired-block (đều đi qua `baseError`), modal không đóng, `form` (reactive,
  không bị đụng tới khi lỗi) giữ nguyên dữ liệu user đã nhập.
- **404 (A10 — sửa device org khác)**: không có UI copy riêng — về mặt thao
  tác FE bình thường, modal Sửa chỉ mở được từ 1 row đã có sẵn trong
  `store.devices` (luôn thuộc org hiện tại), nên case này **không reachable**
  qua UI thật; nếu `body.error` trả về (vd test gọi thẳng), rơi vào nhánh
  `extractFormErrors` "có `body.error`" → hiện luôn message đó ("Not found")
  làm banner — chấp nhận được vì không có test E2E nào lái qua UI cho case
  này (SoT §11 scenario tương ứng test ở tầng API).
- **401**: không xử lý riêng ở `DeviceFormModal` — interceptor toàn cục
  (`api/client.ts`, F0) tự redirect `/login` trước khi component kịp render
  gì thêm; hành vi kế thừa nguyên vẹn.
- **Thành công**: `DeviceFormModal` emit `saved` → `DeviceListView` đóng
  modal, `toastStore.push(...)`, `load()` refetch đúng filter/trang hiện tại
  (SoT §4 bước 5, §5.1).
- **Empty state A1 (Devices List)**: nay có thêm CTA "+ Thêm Device" (SoT §7,
  F2 SoT §7 đã chừa chỗ) — xem §2.

## 5. Rủi ro / open question

- **`FormModal.vue`/toast là component dùng chung mới, cần thêm class CSS
  mới vào `web/src/styles/components.css`** (kế thừa quy ước F2 "không tạo
  file CSS riêng theo component" — `docs/design/F2-frontend.md` §5): implementer
  cần thêm (chưa có sẵn):
  - `.tooltip-wrap { display: inline-block; }` — bọc nút "Sửa" disabled.
  - `.actions-cell { text-align: right; }` cho `<td>` cột `actions`.
  - `.field.has-error input, .field.has-error select { border-color: var(--danger); }`
    và `.field-error { color: var(--danger); font-size: 12px; }` — lỗi
    field-level (chưa tồn tại, F0/F2 chưa có form nào hiện lỗi field-level).
  - `.field input:disabled, .field select:disabled { opacity: 0.6; cursor: not-allowed; }`
    — style cho `identifier` disabled ở mode edit.
  - Tổng quát hoá spinner-trong-nút: hiện `.submit-btn[data-busy="true"] .spinner`
    chỉ áp cho riêng class `.submit-btn` của `LoginView`. Thêm rule tương tự
    cho `.btn[data-busy="true"] .spinner { display: inline-block; }` +
    `.btn .spinner { display: none; }` + `.btn[data-busy="true"] .btn-label { display: none; }`
    để nút "Lưu" trong `FormModal` dùng lại đúng 1 kiểu spinner, không viết
    CSS riêng.
  - `.toast-stack { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 30; }`
    và `.toast { ... }` (nền `--surface`, viền theo `variant`) — chưa có sẵn
    (F0/F2 không cần toast vì không có action ghi dữ liệu nào thành công).
  Không có rủi ro nghiệp vụ ở đây, chỉ là danh sách việc CSS cụ thể để
  `slice-implementer` không bỏ sót khi code — nêu rõ theo đúng tinh thần
  `docs/design/F2-frontend.md` §5 đã làm với `components.css`.
- **Tooltip dùng `title` gốc của trình duyệt, không phải 1 component riêng**:
  `UI_UX_design.md` §8 không liệt kê component "Tooltip" trong bảng dùng
  chung — quyết định dùng `title` là cách đơn giản nhất khớp đúng phạm vi,
  đủ để Playwright kiểm tra qua `getAttribute('title')`. Nếu người duyệt
  muốn 1 tooltip thật (hiện khi hover, style theo token), đây là thay đổi
  UI mới ngoài phạm vi F3, nêu ở đây để xác nhận trước khi implement.
- **Đóng modal (Hủy/backdrop/Escape) bị khoá khi `submitting === true`**:
  không phải quyết định có trong SoT (SoT §5.1 chỉ nói "bấm Hủy → không gọi
  API, không thay đổi") — đây là suy luận thêm để tránh trạng thái mồ côi
  (user đóng modal giữa lúc request đang bay, rồi response 201/422 về sau đó
  không còn nơi hiển thị). Khuyến nghị giữ nguyên (khớp tinh thần "no dead
  interaction" `UI_UX_design.md` §0.4); nêu rõ để người duyệt xác nhận không
  muốn hành vi khác (vd cho phép đóng, âm thầm bỏ qua response trễ).
- **404 cross-org khi sửa (A10) không có UI copy riêng vì không reachable
  qua FE bình thường** (giải thích ở §4) — nếu review muốn 1 message tiếng
  Việt cụ thể hơn "Not found" mặc định từ `render_not_found` (`F3-api.md`
  §3), cần quyết định thêm (vd `extractFormErrors` tự dịch "Not found" →
  "Không tìm thấy thiết bị này." khi `error === 'Not found'`) — chưa làm ở
  bản này vì không có scenario E2E nào lái qua UI cho case này, thêm logic
  dịch riêng cho 1 trường hợp không test được là over-engineering; flag lại
  đây nếu người duyệt muốn làm cho chắc.
- **Tổ hợp lỗi enum + retired cùng lúc** (đã nêu ở `F3-api.md` §5, nêu lại
  góc nhìn FE): vì FE chỉ mở modal Sửa cho device chưa retired, và
  `platform`/`status` luôn là `<select>` sinh giá trị hợp lệ, tổ hợp lỗi này
  chỉ xảy ra qua gọi API trực tiếp — không có UI path nào cần thiết kế thêm.
- **Không làm "confirm khi đổi status sang retired"** (đúng quyết định OQ-6
  đã approve ở SoT — 1 lần "Lưu" thông thường, không thêm `ConfirmModal`).
- **Toast chỉ 1 instance tại 1 thời điểm khả dĩ chồng nhau nếu user thao tác
  rất nhanh** (tạo xong bấm luôn "+ Thêm Device" tạo tiếp) — `ToastContainer`
  thiết kế theo dạng stack (`v-for`), nên nhiều toast xếp chồng là hành vi
  đúng, không phải bug — không cần giới hạn số lượng ở scope F3.
