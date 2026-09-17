---
feature_id: F9
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (approved by Claude on behalf of user, explicit delegation 2026-09-17)
date: 2026-09-17
---

# Thiết kế Frontend — F9

Nguồn: `docs/design/F9-api.md` (approved — response shape §2.3, 2 `excluded_reason`
cố định §3, không phân trang §2.2, service `Devices::PolicyResolver`),
`docs/sot/F9-policy-resolution.md` (approved — §4 main flow, §5 A1–A20, §7 UI
state, §11 18 Scenario canonical, §12 OQ-1..OQ-7 đã chốt), **`UI_UX_design.md`**
§5 (layout 3-khối Device Detail, khối "Policy đang áp dụng" — bảng
Name/Type/Nguồn/Trạng thái, banner vàng, popover/accordion "Xem tất cả nguồn"),
§8 (component dùng chung), §9 (ma trận loading/empty/error), §12 (design
tokens), `docs/design/F4-frontend.md` (approved — layout 3-khối gốc, khối
Policy để tĩnh-rỗng chờ F9, `.detail-grid`/`.detail-block` đã có),
`docs/design/F8-frontend.md` (approved — văn phong, pattern reuse
`StatusBadge`/`ErrorState`, cách đặt tên biến/testid), `PRD.md` bảng "Giao
diện bắt buộc", và source thật đã đọc trực tiếp trong `web/src/`:
`views/devices/DeviceDetailView.vue`, `components/{StatusBadge,EmptyState,
ErrorState,DeviceGroupAddModal}.vue`, `types/{device,policy,policyAssignment,
ui}.ts`, `api/devices.ts`, `utils/apiError.ts`, `styles/{tokens,components}.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F9-frontend-preview.html`.

## 0. Phạm vi & xác nhận không vượt phạm vi

F9 sửa **đúng 1 khối** đã tồn tại (đang tĩnh-rỗng từ F4) ở 1 trang đã tồn tại
(`/devices/:id`) — không thêm route, không thêm entry point ghi nào (OQ-6),
không đụng khối Header/"Groups đang thuộc" (vẫn nguyên như F4/F6):

| `UI_UX_design.md` §5 mô tả | Trạng thái trước F9 (F4) | F9 làm gì |
|---|---|---|
| Bảng Name/Type/Nguồn/Trạng thái | Placeholder tĩnh "Chưa có policy nào áp dụng." | **Dựng thật** — fetch `GET /devices/:id/applied_policies`, render bảng |
| Banner vàng khi conflict | Không có | **Thêm** — `.warning-banner` đầu khối khi có ≥1 `type` conflict |
| Link/accordion "Xem tất cả nguồn" | Không có | **Thêm** — accordion mở ngay trong bảng (xem §0.1 lý do chọn accordion thay vì popover nổi) |
| Loading/error riêng cho khối | Không có (khối này trước nay chỉ có 1 trạng thái: tĩnh-rỗng) | **Tách hẳn** — component mới tự fetch, tự quản `loading`/`error`, độc lập với Header/Groups (đúng carry-over F4 §12, OQ-2) |

### 0.1 Quyết định: accordion inline, không dùng popover nổi (`position: absolute`)

`UI_UX_design.md` §5 cho phép cả 2 ("popover/accordion"). Chọn **accordion
inline** (mở thêm 1 `<tr>` ngay dưới dòng `type` trong chính bảng) thay vì
popover nổi kiểu `ActionsMenu`, vì:
- `ActionsMenu` (F4) đã tự ghi nhận rủi ro "không dùng `<Teleport>`... có thể
  bị cắt nếu `.table-wrap` cắt theo trục dọc" (`docs/design/F4-frontend.md`
  §5) — nội dung "Xem tất cả nguồn" có thể dài (nhiều candidate), rủi ro cắt
  còn cao hơn 1 dropdown menu ngắn.
- Accordion không cần `z-index`/tính toán vị trí, không có rủi ro bị `.table-
  wrap { overflow-x: auto }` cắt theo trục dọc.
- Test bằng Playwright/Vitest đơn giản hơn (không phải giả lập click-outside-
  to-close của popover).

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/devices/:id` | `views/devices/DeviceDetailView.vue` (**sửa**) | Không đổi route/props. Chỉ thay nội dung khối "Policy đang áp dụng" (dòng ~243–251 hiện tại) từ placeholder tĩnh sang `<AppliedPoliciesBlock :device-id="device.id" />`. |

Component con **mới** (tại `web/src/components/`, giữ quy ước phẳng):

| Component | Vai trò |
|---|---|
| `AppliedPoliciesBlock.vue` | Toàn bộ khối "Policy đang áp dụng": tự fetch `GET /devices/:id/applied_policies`, tự quản `loading`/`error`/`empty`/`success`, render bảng + banner conflict + accordion "Xem tất cả nguồn". Nhận đúng 1 prop `deviceId: number`, không emit gì (F9 không có hành động ghi — OQ-6). |

Không có component nào khác cần sửa (`StatusBadge.vue`, `ErrorState.vue`
dùng nguyên, không đổi prop).

## 2. Element / Trigger / Action / Notes

Mọi `data-testid` dưới đây tiếp nối đúng tiền tố `device-detail-policies-*`
đã có từ F4 (khối này vốn đã có `device-detail-policies-empty`) — không đổi
tiền tố sang `applied-policies-*` dù tên component mới là `AppliedPoliciesBlock`,
để nhất quán với quy ước testid theo **trang** đã thiết lập ở F4 (`device-
detail-groups-*`, `device-detail-group-*`), không theo tên component.

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `DeviceDetailView` — khối "Policy đang áp dụng" | render (trong nhánh `v-else-if="device"`, sau khi Header/Groups đã có `device`) | `<AppliedPoliciesBlock :device-id="device.id" />` | Xem §3 lý do mount ở đây (không mount song song tuyệt đối với `fetchDevice`) — vẫn thoả "2 loading/error độc lập" vì `AppliedPoliciesBlock` tự fetch/tự quản state riêng ngay khi mount, không đợi gì thêm từ `DeviceDetailView`. |
| `AppliedPoliciesBlock` — mount / đổi `deviceId` | mount, `watch(() => props.deviceId, load, { immediate: true })` | `fetchAppliedPolicies(deviceId)` (hàm mới, `api/devices.ts`) | Scenario 1–14, 18 (SoT §11). Cùng cơ chế watch-not-onMounted đã dùng ở `DeviceDetailView.load` (F4) — phòng khi tương lai có link điều hướng thẳng giữa 2 `/devices/:id` khác nhau tái dùng component (Vue Router không remount khi chỉ đổi param). |
| `AppliedPoliciesBlock` — đang tải | trước khi response về | Hiện skeleton riêng (2 dòng giả, dùng lại `.skeleton-cell`) | `data-testid="device-detail-policies-loading"`. Không dùng skeleton của Header (khác class, khác kích thước — mô phỏng hàng bảng, không mô phỏng header). |
| `AppliedPoliciesBlock` — lỗi tải (500/network/404-hiếm) | response lỗi | `error.value = extractErrorMessage(...)`, render `<ErrorState>` | `data-testid="device-detail-policies-error"` bọc ngoài `<ErrorState :message="error" @retry="load" />`. Scenario "Lỗi tải khối Policy đang áp dụng không kéo sập trang" (SoT §11, A20) — component này độc lập hoàn toàn với `loadingDetail`/`loadError` của `DeviceDetailView`, lỗi ở đây **không** ảnh hưởng Header/Groups. 404 hiếm gặp (race — xem §5) xử lý **giống hệt** lỗi khác, không có UI "not found" riêng cho khối này (khác page-level 404 của `DeviceDetailView`). |
| `AppliedPoliciesBlock` — tải xong, `applied_policies` rỗng | response `200 {applied_policies: []}` | Render placeholder rỗng | `data-testid="device-detail-policies-empty"` (testid giữ nguyên từ F4). Text **giữ nguyên literal F4**: "Chưa có policy nào áp dụng." Scenario 1 (A1). |
| `AppliedPoliciesBlock` — banner conflict | derived: `conflictCount = items.filter(i => i.conflict).length > 0` | Render `.warning-banner` đầu khối | `data-testid="device-detail-policies-conflict-banner"`. Text khoá cứng: `` Đã tự động chọn policy ưu tiên cao hơn cho {N} loại đang xung đột. `` (N = `conflictCount`, số nhiều/ít không chia động từ tiếng Việt nên không cần logic số ít/nhiều riêng). Scenario 6/7/8 (A6/A7/A8), R8. |
| `AppliedPoliciesBlock` — bảng, mỗi dòng `type` | — | 1 `<tr>` / phần tử `applied_policies[]` | `data-testid="device-detail-policies-row"`. 4 cột đúng `UI_UX_design.md` §5 + OQ-7: `entry.policy.name` (Name) · `entry.type` (Type, `.mono`) · badge nguồn + cờ conflict (Nguồn) · `<StatusBadge :status="entry.policy.status" />` (Trạng thái — luôn "active", đúng OQ-7 giữ 4 cột mockup dù giá trị cố định). |
| — cột Nguồn, badge | — | `<span class="chip">{{ sourceLabel(entry.source) }}</span>` | `data-testid="device-detail-policies-source"`. `sourceLabel`: `kind === 'direct' ? 'Trực tiếp' : `Từ group: ${source.group?.name}`` — literal đúng `UI_UX_design.md` §5. Tái dùng class `.chip` (đã có, dùng cho tag ở `AsyncSearchSelect`) thay vì tạo class badge mới — cùng hình dạng pill mong muốn, không tốn CSS mới (xem §5). Scenario 2/3 (A2/A3), Scenario 13 (A13, OQ-3 — `source` đã là group nhỏ nhất do BE tự chọn ở sort key, FE chỉ hiển thị nguyên). |
| — cột Nguồn, cờ conflict | `entry.conflict === true` | `<span class="conflict-flag" title="...">⚠</span>` cạnh badge nguồn | `data-testid="device-detail-policies-conflict-flag"`. Tooltip: "Đang có xung đột giữa các policy cùng type này — xem 'Xem tất cả nguồn'." Chỉ là chỉ báo trực quan bổ sung ở cấp dòng — banner đầu khối đã là cảnh báo chính (R8: banner độc lập với việc đã resolve xong). |
| — link "Xem tất cả nguồn" | `entry.candidates.length > 1` | `<button class="link-btn" @click="toggleCandidates(entry.type)">Xem tất cả nguồn ({{ entry.candidates.length }})</button>` | `data-testid="device-detail-policies-view-sources"`. **Chỉ hiện khi có ≥2 candidate** — xem §5 lý do lệch nhẹ so với câu chữ `UI_UX_design.md` §5 ("mỗi dòng... và một link"). `aria-expanded="isExpanded(entry.type)"`. Khi đang mở, label đổi thành "Ẩn nguồn". |
| — accordion mở | click link ở trên | `toggleCandidates(entry.type)` (thêm/bớt khỏi `expandedTypes` — mảng string cục bộ, không phải Set, tránh lỗi reactivity Set) | Mở thêm 1 `<tr>` ngay dưới, `colspan="4"`, chứa `<ul class="candidate-list">`. `data-testid="device-detail-policies-candidates"`. Scenario "Popover Xem tất cả nguồn liệt kê đầy đủ ứng viên kèm lý do loại" (OQ-4). |
| — mỗi dòng trong accordion | — | `<li>` cho từng `candidates[]` | `data-testid="device-detail-policies-candidate-row"`. Nội dung: `c.name` · badge nguồn (`.chip`, cùng `sourceLabel`, tái dùng cho `c.source`) · kết quả: `c.included ? 'Đang áp dụng' (badge xanh, tái dùng .badge.active) : c.excluded_reason` (text màu `--text-muted`, literal thẳng từ API — không map/dịch lại, đúng F9-api.md §2.3 "prose tiếng Việt thẳng từ API, không phải code cho FE map"). `key` bắt buộc là `${c.policy_id}-${c.source.kind}-${c.source.group?.id ?? 'direct'}` (không phải `policy_id` đơn — A13 có 2 dòng cùng `policy_id`, khác `group`). |
| `AppliedPoliciesBlock` — Device đang `retired` | — (không rẽ nhánh nào) | Không có xử lý đặc biệt — component không nhận `device.status`, chỉ nhận `deviceId` | Scenario "Device retired vẫn hiển thị đúng resolution" (A14) tự động đúng **vì component không biết gì về status của Device** — không cần code phòng thủ, tránh coupling không cần thiết (component chỉ cần `deviceId`, không cần cả object `Device`). |

## 3. State management

### 3.1 Vì sao `AppliedPoliciesBlock` mount trong nhánh `v-else-if="device"` (không phải song song tuyệt đối từ đầu trang)

SoT §4 bước 2 dùng chữ "song song" cho việc gọi endpoint resolution. Thiết kế
này **không** khởi động request `applied_policies` tại đúng thời điểm
`DeviceDetailView` mount (trước khi `fetchDevice` trả lời) — nó khởi động
ngay khi `fetchDevice` (Header) **thành công**, tức là track theo cùng
`v-else-if="device"` hiện có (F4). Đây là quyết định có chủ đích, không phải
sai sót:

- **Tránh 2 lớp UI "not found" chồng nhau**: nếu `AppliedPoliciesBlock` fetch
  ngay từ đầu bằng `route.params.id` (độc lập hoàn toàn với `fetchDevice`),
  và Device không tồn tại/khác org, **cả 2** request đều trả 404 — trang sẽ
  phải xử lý 404 ở 2 nơi (page-level của `DeviceDetailView` VÀ block-level
  của `AppliedPoliciesBlock`) trong khi F4 đã chốt UI 404 là **thay toàn bộ
  trang** (không còn Header/Groups/Policy nào render). Mount sau khi
  `fetchDevice` thành công đảm bảo `AppliedPoliciesBlock` **chỉ tồn tại**
  trong đúng nhánh trang đã xác nhận Device có thật + đúng org — khớp đúng
  logic đã duyệt ở F4, không cần sửa lại cấu trúc nhánh `v-else-if`.
- **Chi phí `fetchDevice` (Header) rẻ** (1 query Device + 1 join Group,
  F6-api.md) so với `applied_policies` (join `policy_assignments` × `group_
  memberships` × `policies` + thuật toán resolve, F9-db.md) — phần "song
  song" mà SoT thực sự nhắm tới là **tách chi phí tính resolution ra khỏi
  đường tải Header**, không phải bắt buộc literal cùng 1 millisecond bắt đầu.
  Đợi thêm 1 round-trip nhỏ (Header) trước khi bắt đầu round-trip lớn
  (resolution) không vi phạm tinh thần "khối chậm không kéo theo khối khác
  chậm" — Header **không** đợi resolution xong (điều F4's cấu trúc cũ mới
  thực sự vi phạm, vì trước F9 nó chưa tồn tại request này), và resolution
  **không** đợi gì thêm ngoài 1 response Header đã nhanh sẵn.
- **2 loading/error state vẫn hoàn toàn độc lập** (đúng yêu cầu SoT/OQ-2):
  `loadingDetail`/`loadError` (Header/Groups) và `loading`/`error` bên trong
  `AppliedPoliciesBlock` không đọc/ghi lẫn nhau, không có state nào chờ state
  kia để render UI riêng của mình. Lỗi ở khối Policy không set
  `DeviceDetailView.loadError` và ngược lại — đúng A20.

Đây là điểm cần người duyệt xác nhận (không mặc định đúng) — nếu muốn true
parallel (chấp nhận 404 có thể hiện ở cả object bị unmount ngay khi page
detect 404), đó là thay đổi cấu trúc `v-else-if` hiện có, ghi ở §5.

### 3.2 `types/appliedPolicy.ts` (mới)

```ts
/**
 * Shapes returned by `GET /api/v1/devices/:id/applied_policies` — mirrors
 * docs/design/F9-api.md §2.3 exactly (no extra/renamed fields).
 */
import type { PolicyStatus } from './policy'

export interface AppliedPolicySource {
  kind: 'direct' | 'group'
  group: { id: number; name: string } | null
}

/** The winning policy at top level — `status` is always "active" (R1), kept typed rather than hardcoded (F9-api.md §2.3). */
export interface AppliedPolicySummary {
  id: number
  name: string
  type: string
  configuration: Record<string, unknown>
  status: PolicyStatus
}

export interface AppliedPolicyCandidate {
  policy_id: number
  name: string
  configuration: Record<string, unknown>
  status: PolicyStatus
  source: AppliedPolicySource
  included: boolean
  /** Exactly one of the 2 fixed strings from F9-api.md §3 when `included` is false; `null` when true. Rendered verbatim, never mapped. */
  excluded_reason: string | null
}

export interface AppliedPolicyEntry {
  type: string
  policy: AppliedPolicySummary
  source: AppliedPolicySource
  conflict: boolean
  candidates: AppliedPolicyCandidate[]
}

export interface AppliedPoliciesResponse {
  applied_policies: AppliedPolicyEntry[]
}
```

Không tái dùng `Policy`/`PolicySummary` (`types/policy.ts`/`types/
policyAssignment.ts`) cho `AppliedPolicySummary`/`AppliedPolicyCandidate` —
2 shape này không có `assignments_count` (không liên quan) và có field riêng
(`policy_id` thay vì `id` ở candidates, đúng chữ F9-api.md §2.3) — dùng
chung sẽ ép field không tồn tại/sai tên, tách riêng đúng tinh thần "type
khớp response, không đoán".

### 3.3 `api/devices.ts` (mở rộng, thêm 1 hàm mới)

```ts
import type { AppliedPoliciesResponse } from '../types/appliedPolicy'

/**
 * GET /api/v1/devices/:id/applied_policies — docs/design/F9-api.md §1.
 * Tách khỏi `fetchDevice` có chủ đích (OQ-2) — endpoint riêng cho khối
 * "Policy đang áp dụng" có loading/error độc lập (§3.1).
 */
export async function fetchAppliedPolicies(deviceId: number | string): Promise<AppliedPoliciesResponse> {
  const response = await apiClient.get<AppliedPoliciesResponse>(`/api/v1/devices/${deviceId}/applied_policies`)
  return response.data
}
```

### 3.4 `components/AppliedPoliciesBlock.vue` — state cục bộ (không Pinia)

Cùng triết lý F3/F4 đã áp dụng cho fetch đơn lẻ không cần chia sẻ: không
component nào khác trên trang cần đọc lại `applied_policies`.

```ts
const props = defineProps<{ deviceId: number }>()

const GENERIC_ERROR_MESSAGE = 'Không tải được policy đang áp dụng.'

const items = ref<AppliedPolicyEntry[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const expandedTypes = ref<string[]>([])

async function load() {
  loading.value = true
  error.value = null
  try {
    const response = await fetchAppliedPolicies(props.deviceId)
    items.value = response.applied_policies
  } catch (err) {
    // 404 hiếm (race — Device bị xóa giữa lúc Header load xong và lúc khối
    // này fetch) xử lý CHUNG với lỗi khác — không có UI "not found" riêng
    // cho 1 khối con (xem §5), khác `isNotFoundError` cách DeviceDetailView dùng.
    error.value = extractErrorMessage(err, GENERIC_ERROR_MESSAGE)
  } finally {
    loading.value = false
  }
}

watch(() => props.deviceId, load, { immediate: true })

const conflictCount = computed(() => items.value.filter((i) => i.conflict).length)

function isExpanded(type: string): boolean {
  return expandedTypes.value.includes(type)
}

function toggleCandidates(type: string) {
  const idx = expandedTypes.value.indexOf(type)
  if (idx === -1) expandedTypes.value.push(type)
  else expandedTypes.value.splice(idx, 1)
}

function sourceLabel(source: AppliedPolicySource): string {
  return source.kind === 'direct' ? 'Trực tiếp' : `Từ group: ${source.group?.name ?? '(đã xóa)'}`
}
```

- `source.group?.name ?? '(đã xóa)'` — phòng thủ thuần TypeScript (Group
  không thể bị xóa mà vẫn còn trong response, F9 tự loại nó ở tầng service
  theo A12/Scenario 12 — nhánh này lý thuyết không bao giờ chạy, chỉ để
  thoả kiểu `string | null`, không phải xử lý nghiệp vụ thật).
- `expandedTypes` là mảng string, không phải `Set` — tránh lỗi reactivity
  kinh điển của Vue với `Set`/`Map` (cần gán lại instance mới để trigger
  update) khi có thể dùng mảng đơn giản với `indexOf`/`splice`.

## 4. Empty / loading / error / success

| Tình huống | Hiển thị | Nguồn |
|---|---|---|
| Đang tải lần đầu / đổi `deviceId` | Skeleton riêng 2 dòng (`.skeleton-cell`), **không** chờ chung Header/Groups | SoT §7 "Loading", OQ-2 |
| Lỗi tải (500/network) | `ErrorState` + "Thử lại" (gọi lại `load()`), Header/Groups vẫn hiển thị bình thường | SoT §7 "Error", A20, Scenario "Lỗi tải khối Policy đang áp dụng không kéo sập trang" |
| `applied_policies` rỗng | Placeholder "Chưa có policy nào áp dụng." | SoT §7 "Empty", A1, Scenario 1 |
| Có kết quả, không conflict | Bảng 4 cột, không banner | SoT §7 "Success — không conflict", Scenario 2/3/4/5/13/14 |
| Có kết quả, có conflict | Banner vàng đầu khối + cờ `⚠` ở dòng liên quan + "Xem tất cả nguồn" khả dụng | SoT §7 "Success — có conflict", R8, Scenario 6/7/8 |
| "Xem tất cả nguồn" mở | Accordion liệt kê mọi candidate (`active` thắng/thua + `inactive`), mỗi dòng có lý do rõ ràng khi bị loại | SoT §7 "Popover/accordion", OQ-4, Scenario popover |
| Device retired | Không đổi gì — component không biết `device.status` | A14, Scenario "Device retired vẫn hiển thị đúng resolution" |
| Gọi lại nhiều lần, state không đổi | UI render lại y hệt (không có yếu tố random/thứ tự phía FE — thứ tự mảng giữ nguyên từ response, không tự sort lại ở FE) | R5, Scenario "Gọi lại resolution nhiều lần cho cùng state ra cùng kết quả" |

### Bảng ánh xạ Scenario canonical (SoT §11) → element/testid cụ thể

| # | Scenario (SoT §11) | Element/testid |
|---|---|---|
| 1 | Không có policy nào áp dụng | `device-detail-policies-empty` |
| 2 | 1 policy gán trực tiếp | 1 `device-detail-policies-row`, `device-detail-policies-source` = "Trực tiếp" |
| 3 | 1 policy qua Group | `device-detail-policies-source` = "Từ group: Sales Laptops" |
| 4 | 2 type khác nhau, không conflict | 2 `device-detail-policies-row`, không `device-detail-policies-conflict-banner` |
| 5 | Trực tiếp + group cùng config, không phải conflict thật | 1 dòng, nguồn "Trực tiếp", không banner (nhưng `candidates.length === 2` → link "Xem tất cả nguồn" **vẫn hiện** vì có 2 candidate, dù `conflict: false`) |
| 6 | Conflict 2 group, `updated_at` khác | `device-detail-policies-conflict-banner` hiện, dòng thắng = Wifi New |
| 7 | Hòa `updated_at`, `id` nhỏ hơn thắng | Dòng thắng = Wifi X (FE không tính lại, chỉ hiển thị `policy` BE đã chọn) |
| 8 | Trực tiếp thắng dù group mới hơn | Dòng thắng = Wifi Direct, banner vẫn hiện (`conflict: true` độc lập việc đã chọn xong) |
| 9 | Toàn bộ candidate `inactive` | Không có `device-detail-policies-row` nào cho `type` đó (BE tự loại khỏi mảng, FE không lọc gì thêm) |
| 10 | Deactivate policy đang thắng | Lần `load()` kế tiếp, dòng biến mất — không cần code riêng, chỉ là kết quả response mới |
| 11 | Activate lại | Lần `load()` kế tiếp, dòng xuất hiện lại |
| 12 | Xóa Group | Lần `load()` kế tiếp, dòng biến mất |
| 13 | Cùng 1 policy qua 2 Group | 1 `device-detail-policies-row`, `device-detail-policies-view-sources` mở ra 2 `device-detail-policies-candidate-row` cùng `included: true` |
| 14 | Device retired | Không có nhánh riêng — xem bảng trên |
| 15/16 | 404 org khác / không tồn tại | Không xảy ra ở tầng `AppliedPoliciesBlock` trong luồng bình thường (component chỉ mount sau khi `fetchDevice` đã xác nhận 200 — xem §3.1); nếu race hiếm xảy ra, rơi vào nhánh lỗi chung `device-detail-policies-error` |
| 17 | 401 | Interceptor toàn cục có sẵn (kế thừa F0), không xử lý riêng ở component này |
| 18 | Gọi lại 2 lần, state không đổi | Không có state FE nào (sort/cache) có thể làm 2 lần render khác nhau — FE render thẳng mảng theo thứ tự response |
| popover | "Xem tất cả nguồn" liệt kê đủ, kèm lý do | `device-detail-policies-candidates` → 3 `device-detail-policies-candidate-row` (thắng/thua active/inactive) |
| A20 | Lỗi tải không kéo sập trang | `device-detail-policies-error` hiện, `detail-header`/Groups không đổi |

## 5. Rủi ro / open question

- **Ngưỡng "chỉ hiện link 'Xem tất cả nguồn' khi `candidates.length > 1`"**
  — lệch nhẹ so với câu chữ `UI_UX_design.md` §5 ("Mỗi dòng... và một link
  'Xem tất cả nguồn'" đọc như thể **mọi** dòng đều có link). Lý do kỹ thuật:
  khi `candidates.length === 1` (chỉ có đúng ứng viên thắng, không ứng viên
  nào khác — Scenario 2/3), mở accordion ra sẽ chỉ lặp lại đúng 1 dòng đã
  thấy ở bảng chính, không thêm thông tin gì — vi phạm nguyên tắc "không nút
  chết/vô nghĩa" mà chính `EmptyState.vue`/F2-frontend.md §5 đã áp dụng
  trong toàn bộ codebase này. Đây là điểm cần người duyệt xác nhận đồng ý
  hoặc yêu cầu hiện link ở **mọi** dòng bất kể `candidates.length` (thay đổi
  1 điều kiện `v-if`, không ảnh hưởng gì khác).
- **Tái dùng `.chip` cho badge nguồn** (thay vì tạo `.source-badge` mới) —
  `.chip` vốn được thiết kế cho tag chọn trong `AsyncSearchSelect` (có nút
  "x" ẩn danh bên trong khi cần), nhưng hình dạng pill nền `--surface-2` phù
  hợp trực quan với badge nguồn không cần thêm CSS mới. Không dùng `.badge`
  (đã có, nhưng 3 biến thể màu `active/inactive/retired` của nó mang ngữ
  nghĩa **trạng thái**, không phù hợp cho "nguồn" — nguồn không phải trạng
  thái tốt/xấu).
- **Accordion inline thay vì popover nổi** — đã giải thích ở §0.1, đây là
  điểm khác biệt rõ ràng nhất so với chữ "popover" trong `UI_UX_design.md`
  §5 dù tài liệu đó tự cho phép cả 2 lựa chọn ("popover/accordion").
- **`AppliedPoliciesBlock` mount sau khi `fetchDevice` thành công, không
  mount song song tuyệt đối từ đầu trang** — giải thích đầy đủ ở §3.1, cần
  người duyệt xác nhận đây vẫn đúng tinh thần OQ-2/carry-over F4 §12 dù
  không phải "song song theo đúng nghĩa đen milisecond đầu tiên".
- **404 hiếm của riêng `AppliedPoliciesBlock` xử lý như lỗi chung, không có
  UI "not found" riêng** — vì component này không mount được nếu Device thật
  sự không tồn tại/khác org (đã bị chặn ở page-level trước đó); nhánh này
  chỉ có thể xảy ra do race hiếm (Device bị xóa đúng giữa 2 request), chấp
  nhận UX "Thử lại" chung là đủ, không cần phân biệt.
- **`configuration` không hiển thị trong bảng chính lẫn accordion** — SoT §8/
  F9-api.md §2.3 trả `configuration` ở cả `policy` (top-level) và mỗi
  `candidate`, nhưng không có scenario/mockup nào yêu cầu hiển thị nó ở khối
  này (khác Policy Detail, F8, nơi `configuration` là nội dung chính của
  trang). Không hiển thị để giữ bảng gọn đúng 4 cột mockup — nếu người duyệt
  muốn xem nhanh `configuration` ngay tại đây (vd để so sánh 2 candidate
  xung đột), đây là bổ sung nhỏ (thêm 1 dòng JSON rút gọn trong accordion),
  không ảnh hưởng API/type đã định nghĩa (field đã sẵn có).
- **Không polling/refresh tự động** — F9 không có write action nào từ chính
  trang này có thể làm dữ liệu resolution đổi (đúng OQ-6), nên không cần cơ
  chế tự refetch định kỳ hay theo sự kiện nào khác — user chỉ thấy dữ liệu
  mới khi tự tải lại trang hoặc gọi `load()` qua "Thử lại". Nếu 1 feature
  khác sau này thêm hành động ghi ảnh hưởng resolution ngay tại Device
  Detail, đó là lúc cần thêm cơ chế refetch — ngoài phạm vi F9.
