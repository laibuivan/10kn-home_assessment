---
feature_id: F7
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc) — đã xem preview HTML, chốt OQ-FE-1/2/3 trước khi approve
date: 2026-09-17
---

# Thiết kế Frontend — F7

Nguồn: `docs/design/F7-api.md` (approved — 3 endpoint `index/create/update`,
không `show`/`destroy`, envelope lỗi, cái bẫy strong-params của
`configuration`, A1–A31), `docs/design/F7-db.md` (approved —
`Policy::NAME_BLANK_MESSAGE`/`TYPE_BLANK_MESSAGE`/`NAME_TAKEN_MESSAGE`/
`CONFIGURATION_INVALID_MESSAGE`, `configuration` là `jsonb`, length 1–100 cho
`name`/`type`), `docs/sot/F7-policy-crud.md` (approved — §4 main flow, §5 edge
case A1–A31, §6 business rule, §7 UI state, §11 acceptance, §12 cả 10 OQ đã
chốt — **đặc biệt OQ-3**: `type` là combobox có gợi ý, không phải `<select>`
đóng cứng), **`UI_UX_design.md`** (§0 nguyên tắc, §2 IA/routes, §7.1 Policy
List, §8 component dùng chung, §9 ma trận loading/empty/error, §10 validate,
§12 token), `PRD.md` bảng "Giao diện bắt buộc" dòng "Policies" + §"Yêu cầu
chỉnh chu", `docs/design/F5-frontend.md` (precedent gần nhất — SoT F7 §1 nói
F7 tái dùng **nguyên vẹn** mọi component dùng chung mà F5 build lần đầu:
`DataTable`/`PaginationBar`/`FilterBar`/`SearchInput`/`EmptyState`/
`ErrorState`/`FormModal`/`ActionsMenu`/`StatusBadge`/`ToastContainer`), và
**source thật đã đọc trực tiếp** trong `web/src/`:
`views/{devices/DeviceListView,groups/GroupListView}.vue`,
`components/{AppShell,DataTable,FormModal,GroupFormModal,DeviceFormModal,ActionsMenu,SearchInput,FilterBar,StatusBadge,EmptyState,ErrorState}.vue`,
`stores/{groups,devices}.ts`, `api/groups.ts`, `types/{group,device,ui}.ts`,
`utils/{apiError,queryParams}.ts`, `router/index.ts`, `styles/components.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F7-frontend-preview.html` — không approve file `.md` này khi
chưa xem file preview.

## 0. Phạm vi & xác nhận không để lọt nội dung F8

F7 dựng **đúng 1 route mới** (`/policies`) theo `UI_UX_design.md` §2, layout
theo §7.1, nhưng theo đúng SoT §3/§12 (OQ-2, OQ-6, OQ-7), F7 **cố tình bỏ 3
thứ** mà `UI_UX_design.md` §7.1/§7.2 có mô tả — xác nhận tường minh ở đây vì
nhiệm vụ của tài liệu này bao gồm việc không để lọt phạm vi F8:

| `UI_UX_design.md` mô tả | F7 làm gì | Nguồn quyết định |
|---|---|---|
| Cột **"Số nơi đang gán"** trong bảng list | **Không render.** `serialize_policy` (`F7-api.md` §2.7) không trả field này, không có `policy_assignments` để đếm | SoT OQ-6, A30 |
| Trang chi tiết `/policies/:id` (2 tab "Đang gán cho Group/Device") | **Không tạo route, không tạo view.** Không có `GET /api/v1/policies/:id` (`F7-api.md` §1) | SoT OQ-7 |
| Action **"Xóa"** trong menu ⋯ | **Không có.** Không có `DELETE /api/v1/policies/:id` — render 1 mục "Xóa" gọi vào route không tồn tại là nút chết | SoT OQ-2, A29 |
| Action **"Xem chi tiết"** trong menu ⋯ | **Không có** — không có trang để đi tới (khác Group từ F6, nơi trang chi tiết đã tồn tại) | SoT OQ-7, A29 |
| Cảnh báo "Policy đang được gán cho N group/device" khi deactivate | **Không hiện** — chưa có bảng assignment để biết N | SoT OQ-9, A15 |

Hệ quả trực tiếp: bảng Policy List chỉ có **Name │ Type │ Status │ ⋯**; dòng
bảng **không clickable** (không `onRowClick`, không route để đi tới); menu ⋯
chỉ có đúng **2 mục**: "Sửa" và toggle trạng thái ("Kích hoạt"/"Vô hiệu hoá").
F8 (khi thêm `policy_assignments`) phải khôi phục đủ cả 3 thứ trên, đúng tinh
thần đã làm với Group Detail ở F5→F6.

Route/layout khung/component dùng chung của `UI_UX_design.md` là **cố
định** — F7 không đổi `/policies`, không đổi cấu trúc `.shell`, không thay
`DataTable`/`FormModal`/`ActionsMenu`/`FilterBar`/`SearchInput` bằng thứ khác.

### 0.1 Cách hiện thực hoá OQ-3 (combobox `type`) — tóm tắt quyết định

SoT §12 OQ-3 đã chốt: DB `type` là free-form string, nhưng FE phải hiện field
này dưới dạng **combobox có gợi ý** để hoà giải với `UI_UX_design.md` §7.1
("select, danh sách type cố định theo domain") mà không bịa ra một enum
domain-cứng ngoài đề bài. Quyết định triển khai cụ thể (chi tiết ở §2.1):
**`<input>` gắn `list="…"` trỏ tới một `<datalist>`** — combobox có sẵn của
HTML5, không cần thư viện/JS dropdown tự viết. Danh sách gợi ý = các giá trị
`type` **distinct** lấy từ `store.policies` (dữ liệu list đã fetch sẵn, có
sẵn trong Pinia store khi mở modal) — **không gọi thêm endpoint nào**, đúng
mặc định SoT đã chỉ định. Người dùng vẫn gõ tự do một giá trị không có trong
gợi ý (`<datalist>` không giới hạn giá trị nhập, khác `<select>`). Giới hạn đã
biết của cách này (gợi ý phụ thuộc trang/bộ lọc đang xem) được ghi ở OQ-FE-1
(§5) để người duyệt xác nhận, không âm thầm chấp nhận.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/policies` | `views/policies/PolicyListView.vue` (**mới**) | Khớp `UI_UX_design.md` §2. Thêm vào `router/index.ts`: `{ path: '/policies', name: 'policies', component: PolicyListView }`. Router guard hiện có (`router.beforeEach`) tự áp dụng, **không sửa guard** — chưa đăng nhập mở `/policies` → redirect `/login` (A27). Query string là nguồn chân lý: `?q=&status=&page=` (§3) |
| `/devices`, `/devices/:id`, `/groups`, `/groups/:id` | — | **Không đụng tới** — F7 không sửa view/store/api của Devices/Groups |
| `/policies/:id` | — | **Cố ý không tạo** (SoT OQ-7, §0 trên). Không có nút/link nào trong F7 trỏ tới path này |

Component **mới** tại `web/src/components/` (giữ quy ước phẳng theo feature,
đúng F3/F5 — không tạo thư mục con):

| Component | Vai trò | Ghi chú |
|---|---|---|
| `PolicyFormModal.vue` | Form tạo/sửa Policy | Bọc `FormModal.vue` (F3) — sở hữu field + validate + gọi API. Cùng khuôn `GroupFormModal.vue`/`DeviceFormModal.vue`. Chứa cả combobox `type` (§2.1) và JSON editor `configuration` (§2.2) **inline trong cùng component này** — không tách thành 2 component con riêng, vì cả hai chỉ được dùng ở đúng 1 chỗ (không giống `SearchInput`/`ConfirmModal`, vốn được nhiều feature dùng lại) |

Component **tái dùng nguyên vẹn, không sửa**: `AppShell.vue` (trừ phần nav —
§2.5), `DataTable.vue`, `PaginationBar.vue`, `FilterBar.vue`, `SearchInput.vue`,
`StatusBadge.vue`, `EmptyState.vue`, `ErrorState.vue`, `ActionsMenu.vue`,
`ToastContainer.vue`. Component **sửa có chủ đích, tương thích ngược**:
`FormModal.vue` (thêm 1 prop `wide` — §2.4).

## 2. Element / Trigger / Action / Notes

Mọi `data-testid` dưới đây là **hợp đồng với `acceptance-author`** — đổi tên
sau khi approve = làm RED acceptance test.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `AppShell` — nav "Policies" | click | `RouterLink to="/policies"` → điều hướng `/policies` | `data-testid="nav-policies"`. Thay `<span class="nav-item future">` hiện tại (§2.5). Acceptance "Sidebar có mục Policies dẫn tới trang Policies" |
| `PolicyListView` — mount / đổi `route.query` | mount, `watch(activeQuery, immediate: true)` | `store.fetchPolicies({ q, status, page })` → `GET /api/v1/policies?q=&status=&page=` | Cùng cơ chế `GroupListView`/`DeviceListView`: `activeQuery` là `computed` đọc `route.query`, watch nó (không `deep`). Vào thẳng `/policies?page=2&status=inactive` fetch đúng ngay (SoT §5.1) |
| `PolicyListView` — nút "+ Thêm Policy" (đầu trang) | click | `modalMode='create'; modalPolicy=null; showModal=true` | `data-testid="add-policy-button"`. **Ẩn khi empty-state A19 đang hiện** (A19 có CTA riêng dùng **cùng** testid) — đúng cách F2/F3/F5 xử lý để trang không bao giờ có 2 phần tử cùng testid |
| `SearchInput` — gõ vào ô search | `input`, debounce 300ms | `router.replace({ query: { q: value \|\| undefined, status: activeQuery.status } })` — **bỏ `page`** → reset trang 1 | `data-testid="policy-search-input"`, `clear-test-id="search-clear-button"`, placeholder "Tìm theo tên policy...". Component tái dùng nguyên vẹn từ F5, không sửa |
| `FilterBar` — select "Status" | `change` | `router.replace({ query: { q: activeQuery.q, status: values.status \|\| undefined } })` — **bỏ `page`** | `data-testid="filter-status"` (đúng literal `testId` Device đã dùng cho field `status`, tái dùng qua props — không phải sửa component). Options: `Tất cả` / `active` / `inactive`. Nút "Xóa lọc" tự hiện khi `status` khác rỗng (hành vi có sẵn của `FilterBar`, testid cố định `filter-clear-button` do component tự đặt) — **chỉ xóa `status`, giữ `q`** (xem OQ-FE-2, §5, để người duyệt xác nhận cách chia 2 nút clear độc lập này) |
| `DataTable` — bảng policy | — | Cột: `Name` │ `Type` │ `Status` │ `⋯` (`actions`, `cellClass: 'actions-cell'`) | `test-id="policies-table"`, `row-test-id="policy-row"`. **Không truyền `onRowClick`** → bảng không clickable, không con trỏ pointer (OQ-7: không có trang chi tiết để đi tới — giống Group ở F5, khác Group từ F6) |
| `DataTable` — ô `Status` | — | slot `#cell-status`: `<StatusBadge :status="row.status" />` | Tái dùng `.badge.active`/`.badge.inactive` đã có sẵn trong `components.css` (dùng cho Device) — **không cần CSS badge mới** |
| `ActionsMenu` (mỗi dòng) — trigger "⋯" | click | mở menu của đúng dòng đó | Tái dùng nguyên component, `data-testid="actions-menu-trigger"` |
| `ActionsMenu` — item "Sửa" | click | `modalMode='edit'; modalPolicy=row; showModal=true` | `testId: 'policy-action-edit'`. Prefill từ **dữ liệu dòng đã có trong store**, không gọi `GET /policies/:id` (endpoint không tồn tại — `F7-api.md` §1). `disabled` khi dòng đang trong lúc toggle trạng thái (§2.3) |
| `ActionsMenu` — item toggle trạng thái | click | `toggleStatus(row)` → `PATCH /api/v1/policies/:id { status: <ngược lại> }` trực tiếp, **không mở modal** | `testId: 'policy-action-toggle-status'`. Label = `"Vô hiệu hoá"` nếu `row.status === 'active'`, `"Kích hoạt"` nếu ngược lại (SoT §4, A15/A16). Chi tiết cơ chế single-flight ở §2.3 |
| `ActionsMenu` — danh sách item | — | Đúng **2 item**: "Sửa", toggle trạng thái | Acceptance "Menu hành động của Policy không có Xóa/Xem chi tiết" (A29) — không có item disable-thường-trực, không nút chết |
| `PolicyFormModal` — field `name` | `input` | `clearFieldError('name')` | `data-testid="policy-form-name"`, label "Tên policy". **Không** `maxlength` (bẫy đã ghi ở F5-frontend.md §5 — length limit là hợp đồng server, để scenario A10 chạy được qua UI) |
| `PolicyFormModal` — field `type` (combobox) | `input` | `clearFieldError('type')` | `data-testid="policy-form-type"`, label "Loại (type)". Cơ chế combobox đầy đủ ở §2.1 |
| `PolicyFormModal` — field `configuration` (JSON editor) | `blur` | Parse thử, set/xoá lỗi field, **không tự động format khi lỗi** (SoT §7: giữ nguyên nội dung JSON thô đã gõ) | `data-testid="policy-form-configuration"` (textarea), label "Cấu hình (JSON)". Cơ chế đầy đủ ở §2.2 |
| `PolicyFormModal` — nút "Format" cạnh field `configuration` | click | Parse thử; nếu hợp lệ → ghi đè textarea bằng `JSON.stringify(parsed, null, 2)`; nếu lỗi → giữ nguyên, hiện lỗi | `data-testid="policy-form-configuration-format"`, type="button" (không submit form) |
| `PolicyFormModal` — field `status` | `change` | `clearFieldError('status')` | `data-testid="policy-form-status"`, label "Trạng thái". **Hiện ở cả 2 mode** (khác Device — status chỉ hiện khi edit) vì SoT §4 cho phép chọn `inactive` ngay lúc tạo (OQ-10). `<select>` 2 option `active`/`inactive`, mặc định `active` khi tạo |
| `PolicyFormModal` — submit, mode `create` | sau khi client validate sạch (§2.1/§2.2) | `POST /api/v1/policies` body phẳng `{ name, type, configuration, status }` | `201` → `emit('saved', { mode: 'create', message: 'Đã tạo policy' })`. Không bao giờ gửi `organization_id` (A28) |
| `PolicyFormModal` — submit, mode `edit` | sau khi client validate sạch | `PATCH /api/v1/policies/:id` body **luôn gửi đủ 4 field** `{ name, type, configuration, status }` (không gửi partial) | `200` → `emit('saved', { mode: 'edit', message: 'Đã cập nhật policy' })`. Gửi đủ field kể cả không đổi — đơn giản hơn theo dõi "field nào user thực sự sửa", và không có field nào ở Policy cần phân biệt "không gửi" khỏi "gửi lại giá trị cũ" (khác `description` của Group, nơi gửi `''` có ý nghĩa xóa) |
| `PolicyFormModal` — response `422` | catch | `extractFormErrors(...)` → lỗi bám đúng field (`name`/`type`/`configuration`/`status`), **modal không đóng, dữ liệu đã nhập giữ nguyên** (kể cả JSON thô) | A4/A5/A9/A10/A11/A12/A13/A18. Tái dùng nguyên util của F3, không viết hàm map lỗi mới |
| `PolicyFormModal` — response `500`/network | catch | `baseError = 'Có lỗi xảy ra, vui lòng thử lại.'` → banner đỏ trên đầu form, modal không đóng | `UI_UX_design.md` §9 |
| `PolicyFormModal` — "Hủy" / `Escape` / click nền | click | `emit('cancel')` → parent `showModal = false` | Bị chặn khi `submitting` (hành vi có sẵn của `FormModal`). Không gọi API (A31) |
| `PolicyListView.onSaved` — mode `create` | `saved` event | Đóng modal → toast → về trang 1 giữ nguyên `q`/`status` (đúng cơ chế `onPageChange`/`replaceQuery`) rồi `load()` nếu cần | SoT §4: "refresh về page 1 để thấy ngay policy vừa tạo" |
| `PolicyListView.onSaved` — mode `edit` | `saved` event | Đóng modal → toast → `load()` giữ nguyên `page`/`q`/`status` hiện tại | SoT §4: "refresh đúng trang hiện tại, không nhảy về page 1 — khác luồng tạo" |
| `PaginationBar` | click ‹ / › | `router.replace({ query: { q, status, page: page===1 ? undefined : String(page) } })` | Tái dùng nguyên component. Đổi trang giữ nguyên `q` **và** `status` |
| `ErrorState` — nút "Thử lại" | click | `load()` | A25. `data-testid="retry-button"` (có sẵn trong component) |

### 2.1 Combobox `type` — cơ chế cụ thể (OQ-3)

```html
<div class="field" :class="{ 'has-error': fieldErrorText('type') }">
  <label for="policy-form-type">Loại (type)</label>
  <input
    id="policy-form-type"
    v-model="form.type"
    type="text"
    list="policy-type-suggestions"
    data-testid="policy-form-type"
    placeholder="vd. password, wifi, device_lock..."
    autocomplete="off"
    @input="clearFieldError('type')"
  />
  <datalist id="policy-type-suggestions">
    <option v-for="t in typeSuggestions" :key="t" :value="t" />
  </datalist>
  <span v-if="fieldErrorText('type')" class="field-error" data-testid="field-error-type">
    {{ fieldErrorText('type') }}
  </span>
</div>
```

```ts
const policiesStore = usePoliciesStore()

/**
 * Gợi ý combobox — distinct `type` từ chính dữ liệu list ĐÃ có sẵn trong
 * store lúc modal mở (SoT OQ-3: "lấy từ chính API list/tạo policy, không
 * cần endpoint riêng"). Đây là 1 computed đọc reactive state của
 * `policiesStore`, không phải prop — modal đọc thẳng store giống cách
 * `GroupFormModal`/`DeviceFormModal` đọc thẳng store của chúng để gọi API.
 */
const typeSuggestions = computed(() =>
  Array.from(new Set(policiesStore.policies.map((p) => p.type))).sort(),
)
```

- **Không phải `<select>`**: `<input list="...">` cho phép gõ giá trị bất kỳ
  không có trong `<datalist>` — đúng yêu cầu "cho phép gõ giá trị mới nếu org
  chưa có type nào phù hợp" (SoT §12 OQ-3).
- **Không có thư viện/JS dropdown tự viết**: HTML5 `<datalist>` là combobox
  gốc trình duyệt — nhất quán tinh thần "textarea + nút Format thay vì thư
  viện nặng" mà `UI_UX_design.md` §7.1 đã gợi ý cho JSON editor, áp dụng luôn
  cho combobox này.
- **Giới hạn đã biết** (nguồn gợi ý chỉ là `store.policies` — trang/bộ lọc
  đang xem, không phải toàn bộ org nếu đang lọc `q`/`status` hoặc org có > 1
  trang): xem OQ-FE-1 (§5).
- `autocomplete="off"` để trình duyệt không trộn gợi ý `<datalist>` với gợi ý
  autofill riêng của trình duyệt (2 nguồn gợi ý chồng nhau gây rối UI).

### 2.2 JSON editor `configuration` — cơ chế cụ thể

```ts
const CONFIGURATION_INVALID_MESSAGE = 'Cấu hình phải là một object JSON hợp lệ.' // = Policy::CONFIGURATION_INVALID_MESSAGE (F7-db.md §1), cùng câu chữ dù lỗi chặn ở client hay server

/** Trả object đã parse nếu hợp lệ, hoặc lỗi — dùng chung cho blur/Format/submit, một nguồn duy nhất. */
function parseConfiguration(): { value: Record<string, unknown> | null; error: string | null } {
  const raw = form.configurationRaw.trim()
  if (!raw) return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  }
  return { value: parsed as Record<string, unknown>, error: null }
}

function onConfigurationBlur() {
  const { error } = parseConfiguration()
  if (error) fieldErrors.value = { ...fieldErrors.value, configuration: [error] }
  else clearFieldError('configuration')
}

function onFormat() {
  const { value, error } = parseConfiguration()
  if (error) {
    fieldErrors.value = { ...fieldErrors.value, configuration: [error] }
    return
  }
  form.configurationRaw = JSON.stringify(value, null, 2)
  clearFieldError('configuration')
}
```

- **Chặn submit khi JSON lỗi cú pháp** (SoT §7): `clientValidate()` (chạy
  trước mọi submit, cùng cơ chế `name`/`type` rỗng) gọi lại
  `parseConfiguration()` và thêm lỗi `configuration` nếu có — **không chỉ dựa
  vào blur đã chạy hay chưa** (user có thể bấm "Lưu" ngay mà chưa từng blur
  khỏi textarea). Một nguồn duy nhất (`parseConfiguration`) cho cả 3 nơi gọi
  (blur / Format / submit) — tránh 3 bản logic parse lệch nhau.
- **object rỗng `{}` hợp lệ** (SoT §6, A12 phân biệt "thiếu/`null`" khỏi
  "hợp lệ nhưng rỗng"): `raw.trim() === '{}'` parse ra `{}`, `typeof {} ===
  'object'`, `!Array.isArray({})` → không lỗi.
- **Rỗng hoàn toàn** (`raw.trim() === ''`) dùng **chung message**
  `CONFIGURATION_INVALID_MESSAGE` với "sai cú pháp" — không tách thành 2
  message ("thiếu" vs "không hợp lệ") vì SoT không yêu cầu phân biệt ở UI
  (A12/A13 đều 422 field `configuration`, server cũng gộp chung 1
  `CONFIGURATION_INVALID_MESSAGE`, `F7-api.md` §2.4 bảng cuối).
- **Mảng/số/chuỗi hợp lệ về cú pháp JSON nhưng không phải object** (vd
  `["a","b"]`, `5`, `"just a string"`) → cùng lỗi này (A13) — check
  `typeof parsed !== 'object' || Array.isArray(parsed)` phủ đủ cả 2 nhánh.
- **Không tự động format khi lỗi** (SoT §7 UI state): `onConfigurationBlur`
  chỉ set lỗi, không đụng `form.configurationRaw` — giữ nguyên nội dung user
  đã gõ để họ tự sửa, đúng yêu cầu "giữ nguyên nội dung JSON thô đã gõ, không
  xóa để user gõ lại".
- **Giá trị khởi tạo** — `create`: `form.configurationRaw = ''` (rỗng,
  placeholder gợi ý `'{\n  "key": "value"\n}'` chỉ là hint hiển thị, không
  phải giá trị thật — textarea rỗng thật sự cho tới khi user gõ). `edit`:
  `form.configurationRaw = JSON.stringify(props.policy!.configuration, null,
  2)` — pretty-print lại từ giá trị server trả (jsonb không giữ format gốc,
  `F7-db.md` §1b đã ghi nhận, không phải hồi quy của FE).
- Markup:
  ```html
  <div class="field" :class="{ 'has-error': fieldErrorText('configuration') }">
    <div class="field-label-row">
      <label for="policy-form-configuration">Cấu hình (JSON)</label>
      <button type="button" class="btn btn-secondary btn-sm" data-testid="policy-form-configuration-format" @click="onFormat">
        Format
      </button>
    </div>
    <textarea
      id="policy-form-configuration"
      v-model="form.configurationRaw"
      rows="8"
      class="json-editor"
      data-testid="policy-form-configuration"
      placeholder='{&#10;  "key": "value"&#10;}'
      @input="clearFieldError('configuration')"
      @blur="onConfigurationBlur"
    ></textarea>
    <span v-if="fieldErrorText('configuration')" class="field-error" data-testid="field-error-configuration">
      {{ fieldErrorText('configuration') }}
    </span>
  </div>
  ```
- **CSS mới** (thêm vào `styles/components.css`, chỉ dùng token đã có):
  `.json-editor { font-family: var(--font-mono); font-size: 12.5px; }` (đúng
  quy ước `UI_UX_design.md` §12 — mọi nơi hiển thị JSON dùng `IBM Plex Mono`);
  `.field-label-row { display: flex; align-items: center; justify-content:
  space-between; gap: 8px; }`; `.btn-sm { padding: 4px 9px; font-size: 12px;
  }` (nút "Format" nhỏ hơn nút hành động chính, không cạnh tranh thị giác với
  "Lưu"/"Hủy").

### 2.3 Toggle trạng thái qua ActionsMenu — không qua modal

```ts
const togglingIds = ref<number[]>([])
function isToggling(id: number): boolean {
  return togglingIds.value.includes(id)
}

const TOGGLE_FAILED_MESSAGE = 'Không cập nhật được trạng thái, vui lòng thử lại.'

async function toggleStatus(policy: Policy) {
  if (isToggling(policy.id)) return // single-flight per row (đối xứng A24 của ConfirmModal)
  togglingIds.value = [...togglingIds.value, policy.id]
  const nextStatus: PolicyStatus = policy.status === 'active' ? 'inactive' : 'active'
  try {
    await store.updatePolicy(policy.id, { status: nextStatus })
    toastStore.push(nextStatus === 'active' ? 'Đã kích hoạt policy' : 'Đã vô hiệu hoá policy')
    load()
  } catch (error) {
    toastStore.push(extractErrorMessage(error, TOGGLE_FAILED_MESSAGE), 'error')
  } finally {
    togglingIds.value = togglingIds.value.filter((id) => id !== policy.id)
  }
}
```

- **Vì sao không dùng `ConfirmModal`**: SoT §4/§7 không yêu cầu xác nhận
  trước khi đổi trạng thái ở F7 (không có cảnh báo "đang gán cho N nơi" —
  OQ-9), và cả 2 chiều (A15/A16) đều là thao tác **không phá huỷ dữ liệu**
  (khác Xóa Group) — thêm `ConfirmModal` ở đây là bước xác nhận thừa không
  có trong đặc tả, sẽ bị coi là tự ý thêm UX không được yêu cầu.
- **Không optimistic update**: `store.policies` chỉ đổi sau khi `load()`
  refetch thành công — nhất quán nguyên tắc "không tự sửa state ở FE trước
  khi có xác nhận từ server" đã áp dụng cho Group xóa (F5) và Group sửa (F5).
- **Single-flight per row, không phải toàn bảng**: dùng mảng id thay vì 1
  boolean toàn cục — user có thể toggle 2 dòng khác nhau gần như đồng thời mà
  không bị khoá chéo, nhưng bấm 2 lần lên **cùng 1 dòng** trong lúc request
  đầu còn bay thì bị chặn (`isToggling` guard đầu hàm). Item "Sửa" của **đúng
  dòng đang toggle** cũng bị disable (tránh mở form edit rồi submit đè lên
  1 request PATCH khác đang chạy cho cùng record).
- **Lỗi không có nhánh 404 riêng**: khác `handleDeleteConfirm` của Group (nơi
  404 nghĩa là "đã bị ai đó xóa"), Policy F7 không có hành động xóa nào tồn
  tại trong hệ thống nên 404 ở đây về lý thuyết không thể xảy ra trong phạm
  vi F7 — không code nhánh cho 1 tình huống SoT không liệt kê, giữ hàm đơn
  giản; `extractErrorMessage` đã tự xử lý mọi status khác một cách hợp lý nếu
  nó vẫn xảy ra do lý do hạ tầng.

### 2.4 Thay đổi tương thích ngược ở `FormModal.vue` — prop `wide`

`.modal { max-width: 360px }` (CSS hiện có) đủ cho Group/Device, nhưng JSON
editor 8 dòng monospace + nút Format cần rộng hơn để không bị bó hẹp khó đọc.
Thêm đúng 1 prop mới, mặc định giữ nguyên hành vi cũ cho mọi caller hiện tại:

```ts
// FormModal.vue — thêm vào defineProps hiện có
wide?: boolean   // default: false
```

```html
<!-- FormModal.vue template — thêm class động lên .modal -->
<form class="modal" :class="{ 'modal-wide': wide }" @submit.prevent="$emit('submit')">
```

```css
/* styles/components.css — thêm, không sửa .modal gốc */
.modal.modal-wide { max-width: 480px; }
```

`PolicyFormModal` là caller **duy nhất** truyền `:wide="true"`;
`GroupFormModal`/`DeviceFormModal` không đổi (prop mặc định `false` →
`modal-wide` không được thêm → CSS/hành vi y hệt trước khi có F7). Đây là
kiểu thay đổi giống F6 đã làm với `submitDisabled` trên `FormModal` — mở rộng
có kiểm soát, không phải viết lại.

### 2.5 Thay đổi bắt buộc ở `AppShell.vue` (nợ kỹ thuật F0/F5 ghi đích danh F7)

`AppShell.vue` hiện tại (đã đọc trực tiếp) còn `<span class="nav-item
future">Policies</span>` + `<div class="sidebar-note">Policies hiện khi F7
thêm route</div>`. F7 là feature cuối cùng trả nợ này:

| Thay đổi | Chi tiết |
|---|---|
| Bật nav Policies | `<span class="nav-item future">Policies</span>` → `<RouterLink to="/policies" class="nav-item" :class="{ active: isSectionActive('/policies') }" data-testid="nav-policies"><span class="ic">▢</span> Policies</RouterLink>` |
| `.sidebar-note` | **Xóa hẳn div này** — sau F7 không còn `nav-item.future` nào trong app, không còn nợ kỹ thuật nào cần ghi chú |
| `isSectionActive` | **Không sửa** — hàm hiện có (`route.path === prefix \|\| route.path.startsWith(prefix + '/')`) áp dụng nguyên vẹn cho `/policies` vì F7 không có route con `/policies/:id` để cần phân biệt gì thêm |

**Ghi chú quan trọng cho implementer**: code thật của `AppShell.vue` **đã
lệch khỏi** `F5-frontend.md` §2.2 (tài liệu đó nói dùng `active-class` của
`RouterLink`, nhưng code thật dùng hàm `isSectionActive` tường minh — đúng
phương án B mà `F5-frontend.md` OQ-FE-3 đã nêu làm phương án thay thế). Thiết
kế F7 này bám theo **code thật**, không bám theo văn bản `F5-frontend.md` —
đúng nguyên tắc `frontend-designer` phải đọc source thật, không chỉ đọc thiết
kế cũ.

### Router (`router/index.ts`)

```ts
import PolicyListView from '../views/policies/PolicyListView.vue'
// ...
{ path: '/policies', name: 'policies', component: PolicyListView },
```

Thêm đúng 1 dòng route + 1 import, cùng vị trí tương đối (sau khối
`groups`) — không sửa `router.beforeEach` (guard hiện có đã tổng quát cho mọi
route ngoài `/login`).

## 3. State management

### 3.1 `types/policy.ts` (mới) — khớp **đúng** `F7-api.md` §2.7, không thêm/bịa field

```ts
import type { PaginationMeta } from './ui'

export const POLICY_STATUSES = ['active', 'inactive'] as const
export type PolicyStatus = (typeof POLICY_STATUSES)[number]

export interface Policy {
  id: number
  name: string
  type: string
  /** Luôn 1 object JSON (jsonb) — không bao giờ mảng/scalar/null (F7-db.md §1). */
  configuration: Record<string, unknown>
  status: PolicyStatus
  created_at: string
  updated_at: string
}
// KHÔNG có `organization_id` (F7-api.md §2.7), KHÔNG có `assignments_count`
// (SoT OQ-6 — carry-over F8).

export interface PolicyListResponse {
  policies: Policy[]
  meta: PaginationMeta
}

/** Envelope dùng chung cho create/update — resource luôn bọc trong `policy`. */
export interface PolicyResponse {
  policy: Policy
}

/** Query params view gửi đi; `per_page` cố ý vắng mặt → dùng default 20 của server. */
export interface PolicyQueryParams {
  q?: string
  status?: PolicyStatus
  page: number
}

/**
 * Body cho `POST /api/v1/policies` — phẳng, không bọc `{ policy: {...} }`.
 * `status` tùy chọn (server default `active` nếu vắng mặt — OQ-10), nhưng
 * form F7 **luôn gửi** nó (select có giá trị mặc định sẵn, không có state
 * "chưa chọn") nên type ở đây để required cho đúng những gì FE thực sự gửi.
 */
export interface PolicyCreatePayload {
  name: string
  type: string
  configuration: Record<string, unknown>
  status: PolicyStatus
}

/**
 * Body cho `PATCH /api/v1/policies/:id`. Server chấp nhận partial, nhưng
 * `PolicyFormModal` (sửa qua form) và `toggleStatus` (sửa nhanh qua menu ⋯)
 * là 2 caller khác nhau gửi 2 tập field khác nhau — union optional đúng thực
 * tế, không ép cả 4 field bắt buộc.
 */
export interface PolicyUpdatePayload {
  name?: string
  type?: string
  configuration?: Record<string, unknown>
  status?: PolicyStatus
}

export function isPolicyStatus(value: unknown): value is PolicyStatus {
  return typeof value === 'string' && (POLICY_STATUSES as readonly string[]).includes(value)
}
```

### 3.2 `api/policies.ts` (mới) — 3 hàm, đúng 3 endpoint, không hơn

```ts
export async function fetchPolicyList(params: PolicyQueryParams): Promise<PolicyListResponse>
  // GET /api/v1/policies — axios tự bỏ param undefined
export async function createPolicy(payload: PolicyCreatePayload): Promise<PolicyResponse>
  // POST /api/v1/policies — body phẳng
export async function updatePolicy(id: number, payload: PolicyUpdatePayload): Promise<PolicyResponse>
  // PATCH /api/v1/policies/:id
```

Đi qua `apiClient` có sẵn (Bearer token + 401 → `/login` tự động). **Không**
tạo `fetchPolicy(id)` (không có `show`, `F7-api.md` §1) — form Sửa prefill từ
dòng đã có trong store, toggle trạng thái đọc `row.status` trực tiếp từ
`DataTable`.

### 3.3 `stores/policies.ts` (mới) — cùng khuôn `stores/groups.ts`, đơn giản hơn (không `deleteGroup`)

```ts
interface PoliciesState {
  policies: Policy[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  lastRequestId: number
}
```

| Action | Endpoint | Ghi chú |
|---|---|---|
| `fetchPolicies(params)` | `GET /api/v1/policies` | Sở hữu `loading`/`error` của **danh sách**. Giữ nguyên `policies`/`meta` cũ khi refetch lỗi (không làm trắng bảng). Guard `lastRequestId` (search debounce + đổi status filter gần như đồng thời có thể bắn 2 request sát nhau) |
| `createPolicy(payload)` | `POST /api/v1/policies` | **Không** set `loading`/`error` của store — lỗi `throw` nguyên vẹn để `PolicyFormModal` tự map 422 field-level (nguyên tắc đã chốt ở `F3-frontend.md` §3) |
| `updatePolicy(id, payload)` | `PATCH /api/v1/policies/:id` | Như trên. Dùng **chung** bởi cả `PolicyFormModal` (sửa qua form, gửi đủ 4 field) lẫn `PolicyListView.toggleStatus` (sửa nhanh, chỉ gửi `status`) — 1 action, 2 caller, đúng thực tế "PATCH vốn đã partial" |

**Không có `lastListLocation`** (khác `stores/groups.ts` từ F6) — F7 không có
trang chi tiết để quay lại từ đó.

## 4. Empty / loading / error / success

Áp `UI_UX_design.md` §9 + SoT §7 cho F7. Không có thao tác async chạy nền nào
(không job, không poll — `F7-api.md` §4).

| Tình huống | Hiển thị | Nguồn |
|---|---|---|
| **Loading lần đầu** (chưa có dòng nào) | `DataTable` tự render skeleton rows; `.list-head` + `SearchInput` + `FilterBar` vẫn hiển thị bình thường → không giật layout | SoT §7, §9 dòng 1 |
| **Loading khi đổi trang/search/filter/refetch sau mutation** | Overlay mờ + spinner đè lên bảng cũ (hành vi có sẵn `DataTable`) | SoT §7, §9 dòng 2 |
| **Loading trong modal** (tạo/sửa) | Nút "Lưu" disable + spinner, nút "Hủy" disable, `Escape`/click nền không đóng được | SoT §7, `FormModal` có sẵn |
| **Loading khi toggle trạng thái** | Item ActionsMenu tương ứng **và** "Sửa" của đúng dòng đó bị disable (§2.3); không có spinner riêng trên item (giới hạn có chủ đích của `ActionsMenu` hiện tại — không sửa component để thêm state loading per-item, xem OQ-FE-3 §5) | Mới ở F7 |
| **Empty A19** — org chưa có policy nào (`total_count === 0` và **không có** `q`/`status` đang áp dụng) | `EmptyState` title **"Chưa có policy nào"**, slot = nút **"+ Thêm Policy"** (`data-testid="add-policy-button"`). Nút đầu trang bị ẩn lúc này | A19, SoT §11 |
| **Empty A20** — search/filter không khớp (`total_count === 0` và **có** `q` và/hoặc `status`) | `EmptyState` title **"Không tìm thấy policy nào"**, description "Thử từ khóa/bộ lọc khác.", slot = nút **"Xóa bộ lọc"** (`data-testid="empty-state-clear-button"`) → `replaceQuery({})` (xóa **cả** `q` **và** `status` — an toàn khi không biết chắc điều kiện nào gây ra 0 kết quả, đúng cách `DeviceListView` xử lý "Xóa lọc"). **Không** có CTA tạo mới | A20, SoT §11 |
| Phân biệt A19/A20 | Bằng state `q`/`status` của chính FE (`hasActiveQuery = !!q \|\| !!status`) — API trả response giống hệt nhau cho 2 case, không có cờ `searched` (`F7-api.md` §2.1, cùng pattern F5) | — |
| **Empty chỉ hiện sau khi đã có response** | `showEmptyState = !store.loading && store.meta !== null && store.meta.total_count === 0` | §9 |
| **Error tải danh sách (A25)** | `ErrorState` + nút "Thử lại" → `load()`. `SearchInput`/`FilterBar` vẫn dùng được, không trang trắng | A25, §9 |
| **Error form 422** | Lỗi hiện dưới đúng field (`field-error-name`/`field-error-type`/`field-error-configuration`/`field-error-status`), modal giữ nguyên dữ liệu đã nhập kể cả JSON thô | A4/A5/A9/A10/A11/A12/A13/A18, §9 |
| **Error form 500/network** | Banner đỏ trên đầu form: "Có lỗi xảy ra, vui lòng thử lại.", modal không đóng | §9 |
| **Error toggle trạng thái** | Toast lỗi "Không cập nhật được trạng thái, vui lòng thử lại." (hoặc message server nếu có), **không** đóng gì (không có gì để đóng — không qua modal), dòng vẫn hiện trạng thái cũ vì không optimistic update | Mới ở F7 |
| **Success tạo** | Đóng modal → toast "Đã tạo policy" → về trang 1, giữ `q`/`status` | SoT §4 |
| **Success sửa (qua form)** | Đóng modal → toast "Đã cập nhật policy" → refetch đúng trang/`q`/`status` hiện tại | SoT §4 |
| **Success toggle trạng thái** | Toast "Đã kích hoạt policy" / "Đã vô hiệu hoá policy" (theo chiều chuyển) → refetch đúng trang/`q`/`status` hiện tại | SoT §4 |
| **401 bất kỳ lúc nào** | Interceptor `api/client.ts` có sẵn: xóa token + redirect `/login` | A26 |
| **Chưa đăng nhập mở `/policies`** | `router.beforeEach` có sẵn → redirect `/login` | A27 |

Toast dùng nguyên `useToastStore().push(message, variant)` + `ToastContainer`
đã mount trong `AppShell` — không sửa store toast.

## 5. Rủi ro / open question

### OQ-FE-1 (cần người duyệt chốt) — Gợi ý combobox chỉ phủ dữ liệu đã tải, không phải toàn org

§0.1/§2.1 lấy `typeSuggestions` từ `store.policies` — đúng dữ liệu **đang có
trong store lúc modal mở**, tức là **trang hiện tại đã fetch**, dưới **bộ lọc
`q`/`status` đang áp dụng** (nếu có). Với org "hàng chục" policy (SoT §10) và
`per_page` mặc định 20, trường hợp phổ biến (mở `/policies` không filter) đã
phủ gần hết/toàn bộ type của org trên trang 1. Nhưng nếu org có > 20 policy
và đang đứng ở trang 2, hoặc đang lọc `status=inactive`/gõ `q`, gợi ý sẽ
**thiếu** các `type` chỉ xuất hiện ở trang khác/bị filter loại.

- **(a) Giữ nguyên — derive từ `store.policies` (đã chọn ở §2.1).**
  Không thêm network request nào, đúng nghĩa đen chỉ dẫn SoT ("lấy từ chính
  API list/tạo policy, không cần endpoint riêng"). Nhược điểm: gợi ý có thể
  thiếu trong trường hợp org lớn + đang filter. Chấp nhận được vì đây chỉ là
  **gợi ý tiện lợi** (không phải validation) — gõ type không có trong gợi ý
  vẫn hợp lệ, không có rule nào bị vi phạm.
- **(b) Gọi thêm 1 request nền `GET /api/v1/policies?per_page=100`** (không
  filter) riêng cho mục đích lấy distinct type, cache lại trong store, gọi
  lại khi list view mount lần đầu — độc lập với trang/filter đang xem trên
  bảng. Không cần endpoint mới (vẫn dùng đúng `GET /api/v1/policies`), nhưng
  tốn thêm 1 network round-trip mỗi lần vào trang Policies, và có thể vẫn
  thiếu nếu org > 100 policy (dù SoT §10 nói "hàng chục" nên hiếm khi chạm
  ngưỡng này).

**Khuyến nghị**: giữ **(a)** — đơn giản hơn, đúng chữ nghĩa SoT, và giới hạn
đã biết không vi phạm business rule nào (type vẫn free-form, gõ gì cũng được
— SoT §12 OQ-3 xác nhận rõ "cho phép gõ giá trị mới"). Cần người duyệt xác
nhận vì đây là lựa chọn UX có đánh đổi, không phải điều SoT ép buộc theo 1
hướng duy nhất.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** chọn
**(a)**, giữ nguyên. Không đáng đánh đổi 1 network round-trip thêm mỗi lần
vào trang cho một tính năng thuần gợi ý (không phải validation).

### OQ-FE-2 (xác nhận, không chặn) — 2 nút "xóa" độc lập cho `q` và `status`

SoT §5.1 chỉ viết chung "Nút 'Xóa tìm kiếm' chỉ hiện khi đang có `q`/`status`"
mà không mô tả rõ có 1 nút gộp hay 2 nút riêng. Thiết kế này chọn **giữ 2 cơ
chế độc lập, mỗi component tự quản** — đúng nguyên tắc "tái dùng nguyên vẹn,
không thiết kế lại" của SoT §1:

- `SearchInput`'s nút "Xóa tìm kiếm" (đã có sẵn, không sửa) — chỉ hiện khi
  `q` khác rỗng, chỉ xóa `q`, giữ nguyên `status`.
- `FilterBar`'s nút "Xóa lọc" (đã có sẵn, không sửa) — chỉ hiện khi `status`
  khác rỗng, chỉ xóa `status`, giữ nguyên `q`.
- Riêng CTA trong `EmptyState` của biến thể A20 (§4) xóa **cả 2 cùng lúc**
  (`replaceQuery({})`) vì tại thời điểm đó không cần phân biệt filter nào là
  "thủ phạm" gây ra 0 kết quả — đúng cách `DeviceListView` đã làm cho biến
  thể "empty do filter" của nó.

**Đề xuất giữ nguyên cách này** (không cần 1 nút gộp mới) — nếu người duyệt
muốn 1 nút "Xóa tất cả" duy nhất thay vì 2 nút độc lập, đây là thay đổi UI
nhỏ, không ảnh hưởng API/store.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** giữ
nguyên 2 cơ chế độc lập — nhất quán với `SearchInput`/`FilterBar` đã dùng ở
Device/Group, không cần thay đổi UI mới cho riêng F7.

### OQ-FE-3 (xác nhận, không chặn) — Không thêm state loading per-item vào `ActionsMenu`

§2.3/§4 chọn disable "Sửa" + item toggle của **đúng dòng đang toggle** thay
vì thêm spinner trong chính item đó, vì `ActionsMenuItem` (interface hiện có
trong `ActionsMenu.vue`) chỉ có `disabled`/`disabledTitle`, không có
`loading`. Thêm 1 trạng thái mới vào component dùng chung này chỉ để phục vụ
1 use case duy nhất (F7 toggle) là mở rộng không cần thiết — item bị disable
+ menu tự đóng sau click đã đủ để tránh double-submit (A24-tương-đương), chỉ
thiếu phản hồi thị giác "đang xử lý" ngay tại chỗ (nhưng toast xuất hiện rất
nhanh sau đó vì đây là mutation 1 record, không phải job async).

**Đề xuất giữ nguyên** — nếu người duyệt muốn spinner tại chỗ, cần mở rộng
`ActionsMenuItem` (thêm `loading?: boolean`) và sửa template `ActionsMenu.vue`
— việc nhỏ nhưng đụng vào component đã dùng ở 3 nơi (Devices/Groups/Policies),
nên xin xác nhận trước khi làm.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** giữ
nguyên — không mở rộng `ActionsMenuItem` cho 1 use case duy nhất; disable +
toast nhanh là đủ, không đáng đổi việc sửa 1 component dùng chung ở 3 nơi.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **`configuration` không giữ format gốc client gõ** (`F7-db.md` §1b) — khi
  mở lại form Sửa, textarea hiện bản `JSON.stringify(..., null, 2)` do FE tự
  pretty-print từ giá trị server trả, không phải nguyên văn user đã gõ lúc
  tạo/sửa lần trước. Chấp nhận theo đúng quyết định đã ghi ở tầng DB.
- **`PATCH` từ `PolicyFormModal` luôn gửi đủ 4 field** (không giống Group,
  nơi `PATCH` chỉ gửi field đang sửa theo ngữ nghĩa cụ thể của `description`)
  — vì form Policy luôn hiện đủ 4 field cùng lúc (không có field nào ẩn theo
  mode như `identifier`/`status` của Device), gửi đủ là tự nhiên nhất, không
  cần thiết kế "chỉ gửi field đã đổi" (diff-based PATCH) mà SoT/API không yêu
  cầu.
- **Không có index nào tối ưu cho combobox** — `typeSuggestions` là
  `computed` chạy `Array.from(new Set(...))` mỗi lần `store.policies` đổi,
  chấp nhận được vì "org nhỏ, hàng chục policy" (SoT §10), không cần
  memoize/debounce thêm.
- **Không phát hiện mâu thuẫn nào khác** giữa SoT / `F7-api.md` /
  `UI_UX_design.md` ngoài 3 sai khác đã được SoT chốt trước ở §0 (cột "Số nơi
  đang gán", trang chi tiết, action Xóa) và điểm hoà giải OQ-3 (combobox) đã
  nêu ở §0.1 — không có điểm nào cần dừng lại để hỏi thêm ngoài 3 OQ-FE ở
  trên.
