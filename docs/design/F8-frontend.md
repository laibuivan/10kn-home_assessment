---
feature_id: F8
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-17
---

# Thiết kế Frontend — F8

Nguồn: `docs/design/F8-api.md` (approved — 5 controller mới, `PoliciesController#show`
mở lại, `assignments_count` luôn có ở `serialize_policy`, envelope
`policy_assignment_job`/`policy`/`device`/`policies`/`groups`/`devices`,
`202` cho nhánh Group (async) vs `201` cho nhánh Device (đồng bộ), 404 khi
liên kết không tồn tại, `group: null` khi Group đã bị xóa), `docs/design/F8-db.md`
(approved — Phương án A: `policy_assignments` 2 FK riêng `group_id`/`device_id`
nullable, unique index composite, `policy_assignment_jobs` enum
`pending/running/done/failed`, `processed_count` cosmetic — giữ `0` tới khi
`done` mới nhảy `total_count`, không có "batch thứ N/M" thật để vẽ progress
bar %), `docs/sot/F8-policy-assignment.md` (approved — §4 main flow A–F, §5
A1–A32, §6 business rule, §7 UI state, §12 12 OQ đã chốt), **`UI_UX_design.md`**
§6.2/§6.3 (toàn bộ — UX job async bắt buộc)/§7.1/§7.2/§8/§9/§10/§12,
`docs/design/F7-frontend.md` (precedent gần nhất cho Policy List — §0 của tài
liệu đó tự khai 3 thứ đã cố tình bỏ mà F8 phải mở lại: cột "Số nơi đang gán",
trang `/policies/:id`, action "Xem chi tiết"), `docs/design/F6-frontend.md`
(precedent `AsyncSearchSelect.vue`, `GroupMemberAddModal.vue` — mẫu modal
mỏng bọc `FormModal` + `AsyncSearchSelect`), và **source thật đã đọc trực
tiếp** trong `web/src/`:
`components/{AsyncSearchSelect,GroupMemberAddModal,ConfirmModal,FormModal,ActionsMenu,DataTable,EmptyState,ErrorState,StatusBadge,PolicyFormModal,AppShell}.vue`,
`views/{policies/PolicyListView,groups/GroupDetailView,groups/GroupListView}.vue`,
`stores/{policies,group-memberships}.ts`, `api/{policies,groups,devices}.ts`,
`types/{policy,group,ui}.ts`, `utils/apiError.ts`, `router/index.ts`,
`styles/{tokens,components}.css`.

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F8-frontend-preview.html` — không approve file `.md` này khi
chưa xem file preview.

## 0. Phạm vi & xác nhận không để lọt/không vượt phạm vi

F8 mở lại đúng 3 thứ mà `F7-frontend.md` §0 đã cố tình bỏ (bảng dưới), và
**không** đụng gì tới Device Detail (`/devices/:id` — OQ-11) hay khối
"Policy đang áp dụng" (F9, giữ tĩnh-rỗng đúng SoT F4 OQ-1/OQ-6):

| `UI_UX_design.md` mô tả | F7 đã làm gì | F8 làm gì |
|---|---|---|
| Cột "Số nơi đang gán" | Không render | **Render** — `assignments_count` luôn có ở `serialize_policy` (F8-api.md §2.3) |
| Trang `/policies/:id` (2 tab) | Không tạo | **Tạo** — `PolicyDetailView.vue` mới |
| Action "Xem chi tiết" trong menu ⋯ | Không có | **Thêm lại**, item thứ 3 |
| Cảnh báo N khi deactivate | Không hiện (N giả `0`) | **Hiện N thật** — từ `assignments_count` |

Không tự thêm: route/nút nào ở `/devices/:id` (OQ-11); hiển thị "Policy đang
áp dụng" ở đâu (F9); un-retire Device; role/permission UI nào (không phân
role, SoT §9).

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/policies` | `views/policies/PolicyListView.vue` (**sửa**) | Cột mới, menu ⋯ mở lại "Xem chi tiết", dòng bảng clickable (mới — xem §2.1), confirm N thật khi deactivate |
| `/policies/:id` | `views/policies/PolicyDetailView.vue` (**mới**) | `{ path: '/policies/:id', name: 'policy-detail', component: PolicyDetailView, props: true }` — thêm vào `router/index.ts` ngay sau route `groups/:id`, cùng khuôn `device-detail`/`group-detail` (route guard hiện có tự áp dụng, không sửa `beforeEach`) |
| `/groups/:id` | `views/groups/GroupDetailView.vue` (**sửa**) | Tab "Policies" từ `<span class="tab-item future">` (F6) thành tab thật — xem §2.4 |
| mọi route sau `/login` | `components/AppShell.vue` (**sửa**) | Mount `AsyncJobBanner` stack 1 lần ở đây (global, xem §2.3) — lý do: job có thể được khởi tạo từ Group Detail **hoặc** Policy Detail (2 entry point cùng gọi 1 endpoint), banner phải sống sót khi điều hướng qua lại giữa 2 trang trong 1 SPA session, không chỉ 1 view |
| `/devices/:id` | — | **Không đụng** (OQ-11) |

Component **mới** tại `web/src/components/`:

| Component | Vai trò |
|---|---|
| `AsyncJobBanner.vue` | 1 thẻ banner cho 1 job — hiển thị + emit `retry`/`dismiss`, không tự poll (§2.3) |
| `GroupPolicyAssignModal.vue` | "+ Gán policy" ở Group Detail tab Policies — search Policy `active`, gọi `POST /groups/:id/policy_assignments` |
| `PolicyGroupAssignModal.vue` | "Gán thêm cho Group" ở Policy Detail tab Group — search Group (không giới hạn), gọi **cùng** endpoint trên, chiều ngược lại |
| `PolicyDeviceAssignModal.vue` | "Gán thêm cho Device" ở Policy Detail tab Device — search Device (kể cả `retired`), gọi `POST /policies/:id/device_assignments` |

Component **sửa có chủ đích, tương thích ngược**: `PolicyFormModal.vue`
(thêm bước confirm trước khi submit khi đổi `active → inactive` có
`assignments_count > 0` — §2.6), `types/policy.ts` (thêm field
`assignments_count`), `api/policies.ts` (thêm `fetchPolicy(id)`).

Component **tái dùng nguyên vẹn, không sửa**: `AsyncSearchSelect.vue`,
`ConfirmModal.vue`, `FormModal.vue`, `DataTable.vue`, `PaginationBar.vue`,
`EmptyState.vue`, `ErrorState.vue`, `StatusBadge.vue`, `ActionsMenu.vue`,
`ToastContainer.vue`, `SearchInput.vue`, `FilterBar.vue`.

## 2. Element / Trigger / Action / Notes

Mọi `data-testid` dưới đây là hợp đồng với `acceptance-author`.

### 2.1 `PolicyListView.vue` (sửa)

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `DataTable` cột mới `assignments_count` | — | Chèn giữa `Status` và `⋯`, đúng thứ tự ASCII table `UI_UX_design.md` §7.1 (`Name │ Type │ Status │ Số nơi đang gán │ ⋯`) | `{ key: 'assignments_count', label: 'Số nơi đang gán', value: (row) => String(row.assignments_count) }` — plain value, không `cellClass` riêng (cùng cách `devices_count` của Group đã làm, không phải số cần `tabular-nums` nổi bật) |
| `DataTable` — dòng bảng | click | `router.push(`/policies/${policy.id}`)` | **Quyết định mới** (không có trong F7, hợp lý hoá bằng route detail giờ đã tồn tại): dòng bảng trở thành clickable, đúng đúng pattern `GroupListView` đã làm ở F6 khi `/groups/:id` ra đời (`:on-row-click="viewDetail"`). Cột `actions` phải bọc `<span @click.stop>` quanh `ActionsMenu` (copy nguyên workaround đã có ở `GroupListView` — không có nó, mở menu ⋯ sẽ vô tình điều hướng luôn) |
| `ActionsMenu` — item mới "Xem chi tiết" | click | `router.push(`/policies/${policy.id}`)` | `testId: 'policy-action-view'`, thêm làm item **thứ 3** (sau "Sửa", toggle trạng thái) — đúng thứ tự Group đã dùng (edit, action-đặc-thù, view cuối). A28 |
| `ActionsMenu` — item toggle trạng thái | click | Xem §2.1.1 (thay `toggleStatus` cũ) | Không còn PATCH thẳng vô điều kiện — giờ có nhánh confirm |

#### 2.1.1 Toggle trạng thái — thêm nhánh confirm khi deactivate có N > 0

```ts
const pendingDeactivate = ref<Policy | null>(null) // policy đang chờ xác nhận deactivate

const DEACTIVATE_WARNING = (n: number) =>
  `Policy đang được gán cho ${n} group/device. Chuyển sang inactive sẽ khiến ` +
  `các nơi này không còn được tính là policy đang áp dụng, nhưng liên kết gán ` +
  `vẫn được giữ nguyên — nếu kích hoạt lại, các nơi này có hiệu lực trở lại ngay.`

async function toggleStatus(policy: Policy) {
  if (isToggling(policy.id)) return
  const nextStatus: PolicyStatus = policy.status === 'active' ? 'inactive' : 'active'
  // A20/A21/A22: chỉ deactivate (active -> inactive) VÀ N > 0 mới cần hỏi lại.
  // Activate lại (A22) không bao giờ cần confirm — không mất gì để cảnh báo.
  if (nextStatus === 'inactive' && policy.assignments_count > 0) {
    pendingDeactivate.value = policy
    return
  }
  await doToggleStatus(policy, nextStatus)
}

async function doToggleStatus(policy: Policy, nextStatus: PolicyStatus) {
  togglingIds.value = [...togglingIds.value, policy.id]
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

async function confirmDeactivate() {
  const policy = pendingDeactivate.value
  if (!policy) return
  pendingDeactivate.value = null
  await doToggleStatus(policy, 'inactive')
}
```

- `<ConfirmModal v-if="pendingDeactivate" title="Chuyển Policy sang inactive?" :message="DEACTIVATE_WARNING(pendingDeactivate.assignments_count)" confirm-label="Chuyển sang inactive" :on-confirm="confirmDeactivate" test-id="policy-deactivate-confirm" ... @cancel="pendingDeactivate = null" />` — không `destructive` (không phải hành động xoá dữ liệu, chỉ đổi trạng thái — giữ nút xanh `btn-primary`, đúng phân biệt màu đã dùng ở F5 cho "Xóa" (đỏ) vs hành động thường (xanh)).
- A20 (N=0): giữ nguyên `doToggleStatus` gọi trực tiếp, không hiện gì — đúng
  hành vi F7 cũ.
- Nhánh **activate** (`inactive → active`, A22): không confirm dù N bao
  nhiêu — không có invariant nào bị đe doạ khi activate lại.

### 2.2 `PolicyDetailView.vue` (mới)

**Layout** (đúng `UI_UX_design.md` §7.2):

```
◀ Quay lại
[Tên policy]  Badge(status)  Type: xxx        [Sửa]
Cấu hình (JSON, code block, nút Copy)

Tab: [ Đang gán cho Group (N) ] [ Đang gán cho Device (N) ]
```

| Element | Trigger | Action | Notes |
|---|---|---|---|
| Mount / đổi `route.params.id` | mount, `watch(() => route.params.id, loadHeader, { immediate: true })` | `GET /api/v1/policies/:id` (hàm mới `fetchPolicy` ở `api/policies.ts`) | Cùng cơ chế header của `GroupDetailView` — 1 record, fetch thẳng vào `ref`, không qua Pinia store. 404 → `headerNotFound = true` → `EmptyState` "Không tìm thấy Policy" + link "◀ Quay lại danh sách" (`policy-detail-back-link`, về `/policies`) |
| Header — `policy-detail-name`/`policy-detail-type` | — | Text tĩnh | `<StatusBadge :status="policy.status" />` không testid riêng (component hiện có không nhận prop này — đủ query bằng class `.badge.<status>` nếu acceptance cần) |
| Header — nút "Sửa" | click | Mở `PolicyFormModal` mode `edit`, `:policy="policy"` | `data-testid="policy-detail-edit-button"`. Sau `saved` → đóng modal, toast, `loadHeader()` lại (name/type/status/configuration có thể đổi — §2.6 xử lý luôn nhánh confirm deactivate nếu cần) |
| Header — code block `configuration` | — | `<pre class="code-block">{{ JSON.stringify(policy.configuration, null, 2) }}</pre>` | `data-testid="policy-detail-configuration"`, dùng `.json-editor`-style monospace (CSS mới `.code-block`, xem §5 CSS) |
| Header — nút "Copy" | click | `navigator.clipboard.writeText(JSON.stringify(policy.configuration, null, 2))` → toast "Đã copy cấu hình" | `data-testid="policy-detail-configuration-copy"`. Lỗi clipboard (hiếm, quyền trình duyệt) → toast lỗi "Không copy được, vui lòng thử lại." — không throw ra console |
| Tab "Đang gán cho Group (N)" | click | `activeTab = 'group'` | `data-testid="policy-detail-tab-group"`, tab **mặc định active**. N = `groupAssignments.meta?.total_count ?? '…'` (đã load ngay khi mount, song song header — §4-D bước 2 của SoT) |
| Tab "Đang gán cho Device (N)" | click (lần đầu) | `activeTab = 'device'`; nếu `!deviceAssignments.loadedOnce` → `loadDeviceAssignments()` | `data-testid="policy-detail-tab-device"`. **Lazy load** — chỉ fetch lần click đầu tiên (SoT §4-D: "tránh 3 request không cần thiết cùng lúc"). N hiện `…` cho tới khi load xong lần đầu, sau đó luôn hiện số thật (kể cả khi rời rồi quay lại tab, dùng cache trong store, không refetch lại trừ khi có mutation ở chính tab đó) |
| Tab Group — nút "Gán thêm cho Group" | click | Mở `PolicyGroupAssignModal` | `data-testid="policy-group-assign-button"`. `:disabled="policy.status === 'inactive'"`, `:title="policy.status === 'inactive' ? 'Policy không active, không thể gán.' : undefined"` (A25) |
| Tab Device — nút "Gán thêm cho Device" | click | Mở `PolicyDeviceAssignModal` | `data-testid="policy-device-assign-button"`. Cùng disable/tooltip logic trên |
| Tab Group — mỗi dòng, nút "Gỡ" | click | Mở `ConfirmModal` (title "Gỡ policy khỏi group?", message `Gỡ policy "${policy.name}" khỏi group "${row.name}"?`) | `testId: 'policy-group-remove-button'`. Xác nhận → `DELETE /api/v1/policies/:id/group_assignments/...` — **XEM LƯU Ý DƯỚI**: F8-api.md §1 không có `DELETE .../policies/:id/group_assignments/:group_id`, chỉ có `DELETE /api/v1/groups/:id/policy_assignments/:policy_id`. Gỡ từ tab Group của Policy Detail phải gọi **đúng endpoint đó**, đảo tham số: `deleteGroupPolicyAssignment(row.id, policy.id)` (row là Group, `policy.id` là Policy hiện tại) — 1 hàm API dùng chung cho cả 2 entry point (Group Detail gỡ + Policy Detail tab Group gỡ), không có hàm riêng "policy_group_assignments" nào để xoá |
| Tab Device — mỗi dòng, nút "Gỡ" | click | `ConfirmModal` (message `Gỡ policy "${policy.name}" khỏi device "${row.identifier}"?`) | `testId: 'policy-device-remove-button'`. Xác nhận → `DELETE /api/v1/policies/:id/device_assignments/:device_id` |
| `ErrorState`/`EmptyState` mỗi tab | — | Độc lập hoàn toàn theo tab (§4-D bước 3, A28-tương-đương) | Tab Group lỗi không kéo sập tab Device và ngược lại — 2 state riêng (`groupAssignments.error`/`deviceAssignments.error`) |

**Lưu ý quan trọng đã sửa ở trên**: endpoint gỡ Group↔Policy chỉ tồn tại
dưới path `/groups/:id/policy_assignments/:policy_id` (F8-api.md §1 bảng
endpoint — không có path đối xứng dưới `/policies`). Vì vậy nút "Gỡ" ở
**Policy Detail tab Group** và nút "Gỡ" ở **Group Detail tab Policies** gọi
**cùng một hàm** `deleteGroupPolicyAssignment(groupId, policyId)` — chỉ khác
nơi `groupId`/`policyId` nào là "cố định" (id trang hiện tại) và cái nào lấy
từ dòng đang gỡ. Đây không phải trùng lặp code cần tách thêm — 1 hàm `api/`
dùng đúng 1 endpoint, gọi từ 2 chỗ, giống cách `deleteGroupDevice` (F6) chỉ
có 1 hàm dù có thể được gọi từ nhiều view.

### 2.3 `AsyncJobBanner.vue` (component mới) + `stores/jobs.ts` (store mới)

**Vị trí hiển thị — quyết định thiết kế quan trọng**: mount **1 lần** trong
`AppShell.vue` (global), không mount riêng ở `GroupDetailView`/`PolicyDetailView`.
Lý do: endpoint tạo job (`POST /groups/:id/policy_assignments`) được gọi từ
**2 entry point khác nhau** — Group Detail (tab Policies) **và** Policy
Detail (tab Group, chiều ngược lại) — 1 job có thể được khởi tạo từ Policy
Detail rồi user điều hướng sang Group Detail của group đó (hoặc ngược lại)
trong cùng session SPA; banner phải theo dõi được xuyên trang, không biến
mất/tái tạo mỗi lần đổi route. Pinia store là singleton sống suốt session
(chỉ mất khi F5/đóng tab) — mount điểm hiển thị ở tầng layout chung
(`AppShell`) khai thác đúng đặc tính đó.

```html
<!-- AppShell.vue — thêm vào cuối template, cạnh <ToastContainer /> -->
<div class="job-banner-stack" data-testid="job-banner-stack">
  <AsyncJobBanner
    v-for="job in jobsStore.jobs"
    :key="job.id"
    :job="job"
    @retry="jobsStore.retry(job)"
    @dismiss="jobsStore.dismiss(job.id)"
  />
</div>
```

#### 2.3.1 `stores/jobs.ts`

```ts
interface JobsState {
  /** Mới nhất ở đầu mảng — banner mới luôn xuất hiện trên cùng. */
  jobs: PolicyAssignmentJob[]
  timers: Record<number, ReturnType<typeof setInterval>>
}

export const useJobsStore = defineStore('jobs', {
  state: (): JobsState => ({ jobs: [], timers: {} }),
  actions: {
    /** Thêm/thay job vào danh sách theo dõi, tự bật poll nếu còn pending/running. */
    track(job: PolicyAssignmentJob) {
      const idx = this.jobs.findIndex((j) => j.id === job.id)
      if (idx === -1) this.jobs = [job, ...this.jobs]
      else this.jobs = this.jobs.map((j) => (j.id === job.id ? job : j))
      this.ensurePolling(job.id)
    },

    ensurePolling(jobId: number) {
      if (this.timers[jobId]) return // đã có timer, không tạo trùng
      const job = this.jobs.find((j) => j.id === jobId)
      if (!job || job.status === 'done' || job.status === 'failed') return
      this.timers[jobId] = setInterval(async () => {
        try {
          const response = await fetchPolicyAssignmentJob(jobId)
          const updated = response.policy_assignment_job
          this.jobs = this.jobs.map((j) => (j.id === jobId ? updated : j))
          if (updated.status === 'done' || updated.status === 'failed') this.stopPolling(jobId)
        } catch {
          // Poll lỗi tạm thời (network) — im lặng thử lại lần sau, KHÔNG dừng
          // timer và KHÔNG toast (đúng UI_UX_design.md §9: lỗi hạ tầng ở 1
          // khối nhỏ không kéo sập trải nghiệm; job vẫn chạy ở server, chỉ
          // FE tạm mất khả năng theo dõi 1 nhịp 2s).
        }
      }, 2000)
    },

    stopPolling(jobId: number) {
      clearInterval(this.timers[jobId])
      delete this.timers[jobId]
    },

    /** Re-attach khi mount Group Detail — SoT A17/§4-A bước 7. */
    async reattachForGroup(groupId: number) {
      const response = await fetchGroupPolicyAssignmentJobs(groupId, { status: ['pending', 'running'] })
      response.policy_assignment_jobs.forEach((job) => this.track(job))
    },

    /** OQ-9 (F8-db/SoT): re-enqueue toàn bộ từ đầu, KHÔNG resume. */
    async retry(job: PolicyAssignmentJob) {
      if (!job.group) return // Group đã bị xóa — không còn gì để gọi lại (xem §2.3.3)
      const response = await createGroupPolicyAssignment(job.group.id, job.policy.id)
      this.dismiss(job.id)
      this.track(response.policy_assignment_job)
    },

    dismiss(jobId: number) {
      this.stopPolling(jobId)
      this.jobs = this.jobs.filter((j) => j.id !== jobId)
    },
  },
})
```

- **Không polling-per-component** — cố tình đặt trong store, không trong
  `AsyncJobBanner.vue`: component chỉ hiển thị + emit ý định người dùng
  (`retry`/`dismiss`); store là nơi duy nhất biết "đang có bao nhiêu job đang
  chạy" và giữ vòng đời `setInterval` sống đúng bằng vòng đời session, không
  bị hủy khi component unmount lúc đổi route (điều sẽ xảy ra nếu banner mount
  cục bộ mỗi trang).
- **Lỗi poll không làm rơi job khỏi danh sách theo dõi** — chỉ dừng khi
  server xác nhận `done`/`failed` thật.
- Không có action "dừng poll toàn bộ khi logout" trong bản thiết kế này —
  ghi ở §5 (rủi ro nhỏ, không chặn).

#### 2.3.2 `AsyncJobBanner.vue`

```ts
const props = defineProps<{ job: PolicyAssignmentJob }>()
const emit = defineEmits<{ retry: [job: PolicyAssignmentJob]; dismiss: [jobId: number] }>()

const expanded = ref(false) // "Xem chi tiết" khi failed — không có route job riêng để điều hướng tới

/**
 * `processed_count` là cosmetic (F8-db.md OQ-DB-1/F8-api.md §4.1): giữ 0
 * suốt pending/running, nhảy thẳng total_count khi done. KHÔNG vẽ progress
 * bar %-theo-thời-gian-thực dựa vào field này — chỉ hiện spinner + tổng số
 * thiết bị (N), đúng tinh thần "Phương án A không có khái niệm batch thứ
 * N/M" đã ghi rõ ở F8-api.md §4.1.
 */
const groupLabel = computed(() => props.job.group?.name ?? '(group đã bị xóa)')

let autoHideTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.job.status,
  (status) => {
    if (status === 'done') {
      autoHideTimer = setTimeout(() => emit('dismiss', props.job.id), 4000)
    }
  },
  { immediate: true },
)
onUnmounted(() => { if (autoHideTimer) clearTimeout(autoHideTimer) })
```

| Trạng thái | Màu/icon | Nội dung | Nút |
|---|---|---|---|
| `pending` | trung tính, spinner | `Đang chờ xử lý policy "<policy.name>" cho group "<groupLabel>"...` | không nút (chưa có gì để đóng/thử lại) |
| `running` | trung tính/accent, spinner | `Đang gán policy "<policy.name>" cho <total_count> thiết bị...` | không nút |
| `done` | xanh (`--success`) | `Đã gán policy "<policy.name>" cho <total_count> thiết bị.` | "Đóng" (`dismiss`) — cũng tự ẩn sau 4s nếu không bấm |
| `failed`, `group` còn | đỏ (`--danger`) | `Gán policy "<policy.name>" cho group "<groupLabel>" thất bại.` + (mở rộng) `error_message` | "Xem chi tiết" (toggle `expanded`), "Thử lại" (`retry`), "Đóng" (`dismiss`) |
| `failed`, `group` là `null` | đỏ | Cùng câu trên, `groupLabel` = "(group đã bị xóa)"; `error_message` thường đã là "Group đã bị xóa" (server tự set — F8-db.md §1c) | **Không có "Thử lại"** (không còn group để gọi lại — nút bị ẩn hẳn, không phải disable-với-tooltip, vì không có hành động nào để chờ), chỉ "Xem chi tiết"/"Đóng" |

`data-testid="async-job-banner"` trên khối gốc (nhiều instance cùng testid —
chấp nhận được, đây là 1 stack có thể có N banner cùng lúc, acceptance test
query theo `job.id` qua `data-job-id` phụ nếu cần phân biệt), `async-job-banner-retry`,
`async-job-banner-dismiss`, `async-job-banner-details-toggle`.

#### 2.3.3 Vì sao "Thử lại" luôn re-enqueue toàn bộ (không resume)

Đúng SoT §12 OQ-9: `retry()` gọi lại **chính** `createGroupPolicyAssignment`
(cùng hàm API mà `GroupPolicyAssignModal`/`PolicyGroupAssignModal` dùng) —
không có hàm "resume" riêng nào. Vì job đã `failed` (không còn `pending`/
`running`), backend **không dedupe** (OQ-5 chỉ dedupe theo `pending`/
`running`) → luôn tạo **job mới**; `upsert_all on_duplicate: :skip` ở server
đảm bảo các dòng đã xử lý ở lần chạy trước không bị nhân đôi (A14).

### 2.4 `GroupDetailView.vue` — tab Policies (sửa/hoàn thiện)

Hiện tại (đọc source thật, F6): tab Policies là `<span class="tab-item
future" title="Có ở F7">Policies</span>` — **placeholder tĩnh, không có nội
dung**, và tab Thành viên là `<span class="tab-item active">` (không phải
button — không switch được vì chỉ có 1 tab thật). F8 phải:

1. Đổi cả 2 `<span>` thành `<button type="button">` thật, thêm `activeTab`.
2. Dựng nội dung tab Policies từ đầu (chưa có gì để "hoàn thiện", đúng như
   ghi chú trong nhiệm vụ — xác nhận ở đây, không phải giả định sai).

```ts
const activeTab = ref<'members' | 'policies'>('members') // không sync URL — xem OQ-FE-1 (§5)
const groupPoliciesLoadedOnce = ref(false)

function selectTab(tab: 'members' | 'policies') {
  activeTab.value = tab
  if (tab === 'policies' && !groupPoliciesLoadedOnce.value) loadGroupPolicies()
}
```

| Element | Trigger | Action | Notes |
|---|---|---|---|
| Tab "Thành viên (N)" | click | `selectTab('members')` | `data-testid="group-detail-members-tab"` — N vẫn từ `group.devices_count` (không đổi so với F6) |
| Tab "Policies" | click (lần đầu) | `selectTab('policies')` → lazy load | `data-testid="group-detail-policies-tab"`. **Không có "(N)"** — đúng ASCII layout `UI_UX_design.md` §6.2 (`Tab: [ Thành viên (N) ]  [ Policies ]`, không có số ở Policies) |
| Mount trang | mount | `jobsStore.reattachForGroup(groupId)` (song song `loadHeader()`) | A17/§6.3 điểm 6 — chạy **bất kể tab nào đang active**, để banner hiện lại ngay cả khi user đang xem tab Thành viên |
| Tab Policies — nút "+ Gán policy" | click | Mở `GroupPolicyAssignModal` | `data-testid="group-policy-assign-button"`. **Không** ẩn/disable theo trạng thái Policy nào (khác 2 nút ở Policy Detail) — vì modal search đã tự lọc `status=active`, không có Policy nào "chưa active" để chặn ở đây |
| Tab Policies — mỗi dòng, nút "Gỡ" | click | `ConfirmModal` (title "Gỡ policy khỏi group?", message `Gỡ policy "${row.name}" khỏi group "${group.name}"? Thiết bị trong group sẽ không còn nhận policy này qua group (không ảnh hưởng policy gán trực tiếp cho từng device).`) | `testId: 'group-policy-remove-button'`. Xác nhận → `deleteGroupPolicyAssignment(groupId, row.id)` → `204` → đóng modal, toast "Đã gỡ policy" (SoT §4-C literal), refetch tab |
| `EmptyState` tab Policies | — | Group chưa gán Policy nào | title "Group chưa được gán Policy nào.", CTA "+ Gán policy" (cùng testid nút đầu tab, ẩn nút đầu khi empty đang hiện — đúng pattern A19 mọi nơi khác) |
| `ErrorState` tab Policies | — | Lỗi tải | Độc lập với tab Thành viên (không kéo sập) |

**Refetch khi job xong** — vì Phương án A chỉ tạo dòng `policy_assignments`
thật (Group↔Policy) **trong lúc job `running`**, danh sách tab Policies
**không** cập nhật ngay lúc `POST` trả `202` (job còn `pending`) — nó chỉ
đúng sau khi job `done`:

```ts
const seenDoneJobIds = new Set<number>()
watch(
  () => jobsStore.jobs,
  (jobs) => {
    const justDone = jobs.filter(
      (j) => j.status === 'done' && j.group?.id === groupId.value && !seenDoneJobIds.has(j.id),
    )
    justDone.forEach((j) => seenDoneJobIds.add(j.id))
    if (justDone.length === 0) return
    if (activeTab.value === 'policies') loadGroupPolicies()
    else groupPoliciesLoadedOnce.value = false // tab đang không active -> refetch khi user quay lại
  },
  { deep: true },
)
```

- `seenDoneJobIds` (module-scope trong component, không cần reactive) chặn
  refetch lặp lại mỗi lần `jobsStore.jobs` đổi vì lý do khác (banner khác
  cập nhật cũng làm mảng đổi reference).
- Nếu tab Policies **đang** active khi job xong → refetch ngay, user thấy
  policy mới xuất hiện không cần tự bấm gì.
- Nếu **không** active → đặt lại cờ `loadedOnce = false`, buộc
  `selectTab('policies')` lần sau phải load lại (không dùng data cache cũ).

### 2.5 3 modal mới — `GroupPolicyAssignModal.vue` / `PolicyGroupAssignModal.vue` / `PolicyDeviceAssignModal.vue`

Cả 3 đều là **wrapper mỏng** quanh `FormModal` + `AsyncSearchSelect`, đúng
khuôn `GroupMemberAddModal.vue` (F6) — không thêm cơ chế mới nào ngoài
`AsyncSearchSelect`/`FormModal` đã có.

#### 2.5.1 `GroupPolicyAssignModal.vue` (Group Detail → chọn Policy)

```ts
const props = defineProps<{ groupId: number; assignedPolicyIds: number[] }>()
const emit = defineEmits<{ assigned: [job: PolicyAssignmentJob]; cancel: [] }>()

const selected = ref<AsyncSearchSelectOption[]>([])

/** Chỉ Policy `active` xuất hiện trong kết quả tìm (5.1) — filter ở chính request, không lọc lại ở FE. */
async function searchActivePolicies(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchPolicyList({ q: query, status: 'active', page: 1 })
  return response.policies.map((p) => ({ id: p.id, label: p.name, sublabel: p.type }))
}

/** 5.1 — cảnh báo không chặn, dựa trên list ĐÃ có sẵn ở tab Policies (không gọi API mới). */
const isDuplicate = computed(() =>
  selected.value.length > 0 && props.assignedPolicyIds.includes(selected.value[0].id),
)

async function onSubmit() {
  if (submitting.value || selected.value.length === 0) return
  submitting.value = true
  baseError.value = null
  try {
    const response = await createGroupPolicyAssignment(props.groupId, selected.value[0].id)
    emit('assigned', response.policy_assignment_job)
  } catch (error) {
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.policy_id?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
```

- `mode="single"` cho `AsyncSearchSelect` (chỉ chọn 1 Policy/lần — khác
  `GroupMemberAddModal` vốn `multiple`).
- Cảnh báo trùng: `<div v-if="isDuplicate" class="warning-banner">Policy này
  đã được gán cho group. Gán lại sẽ không tạo trùng.</div>` (literal SoT
  §5.1) — render **trong** modal, dưới `AsyncSearchSelect`, **không** chặn
  nút "Gán" (chỉ là cảnh báo, submit vẫn hoạt động — server tự idempotent).
- Parent (`GroupDetailView`) truyền `assignedPolicyIds="groupPolicies.items.map(p => p.id)"`.
- Submit thành công: `emit('assigned', job)` → parent đóng modal,
  `jobsStore.track(job)` — **không toast** ở bước này (banner đã là feedback
  đủ, tránh 2 tầng thông báo cho 1 việc chưa xong — quyết định ghi ở §4).

#### 2.5.2 `PolicyGroupAssignModal.vue` (Policy Detail → chọn Group)

Đối xứng — search Group (không lọc trạng thái, Group không có field
`status`), gọi **cùng hàm** `createGroupPolicyAssignment(selectedGroupId,
props.policyId)` (tham số đảo ngược so với §2.5.1). Cảnh báo trùng dùng
`assignedGroupIds` (từ `policyGroups.items` đã load ở tab Group). Message
cảnh báo đổi ngôi một chút cho đúng ngữ cảnh: `"Group này đã được gán Policy
'<policy.name>'. Gán lại sẽ không tạo trùng."`.

#### 2.5.3 `PolicyDeviceAssignModal.vue` (Policy Detail → chọn Device, đồng bộ)

```ts
const props = defineProps<{ policyId: number; policyName: string }>()
const emit = defineEmits<{ assigned: [device: Device]; cancel: [] }>()

const selected = ref<AsyncSearchSelectOption[]>([])
/** Cache Device đầy đủ theo id — AsyncSearchSelect chỉ trả {id,label,sublabel},
 * cần status thật để chặn sớm ở FE (xem lý do dưới). */
const devicesById = ref<Map<number, Device>>(new Map())

async function searchDevices(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchDeviceList({ q: query, page: 1 })
  response.devices.forEach((d) => devicesById.value.set(d.id, d))
  return response.devices.map((d) => ({
    id: d.id,
    label: d.identifier,
    // Gắn nhãn "retired" ngay trong dropdown — minh bạch hơn, đúng lý do SoT
    // 5.1 đã nêu cho việc KHÔNG ẩn device retired khỏi kết quả tìm.
    sublabel: d.status === 'retired' ? `${d.name} · retired` : `${d.name} · ${d.platform}`,
  }))
}

const selectedDevice = computed<Device | null>(() =>
  selected.value.length > 0 ? devicesById.value.get(selected.value[0].id) ?? null : null,
)
const RETIRED_POLICY_MESSAGE = 'Thiết bị đã retired, không thể gán policy trực tiếp.' // = Device::RETIRED_POLICY_MESSAGE
const selectedIsRetired = computed(() => selectedDevice.value?.status === 'retired')
const canSubmit = computed(() => selected.value.length > 0 && !selectedIsRetired.value)

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    const response = await createPolicyDeviceAssignment(props.policyId, selected.value[0].id)
    emit('assigned', response.device)
  } catch (error) {
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.device_id?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
```

- **Quyết định chặn sớm ở FE** (task yêu cầu ghi rõ lý do): khi user chọn 1
  Device có `status === 'retired'`, nút "Gán" bị **disable** (`canSubmit`
  false) và banner cảnh báo tĩnh hiện `RETIRED_POLICY_MESSAGE` ngay — **không
  chờ gọi API rồi nhận 422**. Lý do: (a) dữ liệu `status` của Device đã có
  sẵn trong chính response search vừa trả về (`DeviceSerializable` 7 field,
  F6-api.md — không cần request phụ để biết), chặn sớm không tốn thêm
  round-trip; (b) phản hồi tức khắc tốt hơn UX so với đợi request thất bại;
  (c) message dùng **đúng literal** server (`Device::RETIRED_POLICY_MESSAGE`)
  nên nếu vì lý do nào đó (race — device bị retired giữa lúc search và lúc
  submit) request vẫn đi qua backend và backend vẫn tự chặn lại đúng bằng
  422 cùng message (A26-tương-đương, double-check không phụ thuộc UI) — FE
  chặn sớm là **tối ưu UX**, không phải **thay thế** cho validate server.
  `PolicyDeviceAssignModal` vẫn xử lý nhánh `422 base` trong `catch` như mọi
  modal khác (phòng hờ race đó), không giả định chặn-ở-FE là đủ.
- Submit thành công (`201`): đóng modal, toast **literal SoT** "Đã gán policy
  cho device", refetch tab Device (`fetchPolicyDeviceAssignments` lại).

## 3. State management

### 3.1 `types/policy.ts` (sửa) — thêm `assignments_count`

```ts
export interface Policy {
  id: number
  name: string
  type: string
  configuration: Record<string, unknown>
  status: PolicyStatus
  /** MỚI ở F8 — luôn có ở mọi response (index/show/create/update), F8-api.md §2.3. */
  assignments_count: number
  created_at: string
  updated_at: string
}
```

`PolicyResponse`/`PolicyListResponse` không đổi shape (vẫn bọc `policy`/
`policies`+`meta`) — chỉ field bên trong `Policy` đổi.

### 3.2 `types/policyAssignment.ts` (mới)

```ts
import type { PolicyStatus } from './policy'

/** Field tối giản trả về từ GET /groups/:id/policy_assignments — F8-api.md §1. */
export interface PolicySummary {
  id: number
  name: string
  type: string
  status: PolicyStatus
}

/** Field tối giản trả về từ GET /policies/:id/group_assignments — F8-api.md §2.13. */
export interface GroupSummary {
  id: number
  name: string
}
```

### 3.3 `types/policyAssignmentJob.ts` (mới)

```ts
import type { PaginationMeta } from './ui'

/** OQ-1 (SoT) — 4 giá trị enum thật, không phải label UX minh họa của UI_UX_design.md. */
export const POLICY_ASSIGNMENT_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export type PolicyAssignmentJobStatus = (typeof POLICY_ASSIGNMENT_JOB_STATUSES)[number]

export interface PolicyAssignmentJob {
  id: number
  status: PolicyAssignmentJobStatus
  total_count: number
  /** Cosmetic — 0 suốt pending/running, nhảy = total_count khi done (F8-api.md §4.1). KHÔNG dùng để vẽ progress bar %. */
  processed_count: number
  error_message: string | null
  policy: { id: number; name: string }
  /** `null` khi Group đã bị xóa (F8-db.md §1c) — status vẫn đọc được là "failed". */
  group: { id: number; name: string } | null
  created_at: string
  updated_at: string
}

export interface PolicyAssignmentJobResponse {
  policy_assignment_job: PolicyAssignmentJob
}

export interface PolicyAssignmentJobListResponse {
  policy_assignment_jobs: PolicyAssignmentJob[]
  meta: PaginationMeta
}
```

### 3.4 `api/policies.ts` (sửa) — thêm `fetchPolicy`

```ts
/** GET /api/v1/policies/:id — mới ở F8 (F7 OQ-7). Không qua Pinia store —
 * 1 record, cùng cách GroupDetailView gọi `fetchGroup` trực tiếp. */
export async function fetchPolicy(id: number | string): Promise<{ policy: Policy }> {
  const response = await apiClient.get<{ policy: Policy }>(`/api/v1/policies/${id}`)
  return response.data
}
```

### 3.5 `api/policyAssignments.ts` (mới)

```ts
// Group -> Policy (Group Detail tab Policies, và Policy Detail tab Group gọi ngược)
export async function fetchGroupPolicyAssignments(groupId: number, params: { page: number }):
  Promise<{ policies: PolicySummary[]; meta: PaginationMeta }>
export async function createGroupPolicyAssignment(groupId: number, policyId: number):
  Promise<PolicyAssignmentJobResponse> // 202
export async function deleteGroupPolicyAssignment(groupId: number, policyId: number): Promise<void> // 204

// Job re-attach / poll
export async function fetchGroupPolicyAssignmentJobs(
  groupId: number,
  params: { status?: PolicyAssignmentJobStatus[]; page?: number },
): Promise<PolicyAssignmentJobListResponse> // `status` join bằng "," khi build query string
export async function fetchPolicyAssignmentJob(jobId: number): Promise<PolicyAssignmentJobResponse>

// Policy -> Device (đồng bộ)
export async function fetchPolicyDeviceAssignments(policyId: number, params: { page: number }):
  Promise<{ devices: Device[]; meta: PaginationMeta }>
export async function createPolicyDeviceAssignment(policyId: number, deviceId: number):
  Promise<{ device: Device }> // 201
export async function deletePolicyDeviceAssignment(policyId: number, deviceId: number): Promise<void> // 204

// Policy -> Group (đọc — dùng ở Policy Detail tab Group)
export async function fetchPolicyGroupAssignments(policyId: number, params: { page: number }):
  Promise<{ groups: GroupSummary[]; meta: PaginationMeta }>
```

Tất cả đi qua `apiClient` có sẵn, không tạo instance mới. `status` của
`fetchGroupPolicyAssignmentJobs` build thành `?status=pending,running` (join
`,`) — đúng định dạng F8-api.md §2.7/§6 đã chốt (không dùng `status[]=`).

### 3.6 `stores/policyAssignments.ts` (mới)

3 slice độc lập, mỗi slice tự `loading`/`error`/`meta`/`lastRequestId`, cùng
khuôn `stores/group-memberships.ts` — không dùng chung 1 `loading` cho cả 3
vì 3 tab có thể ở 3 trạng thái khác nhau cùng lúc (Policy Detail tab Group
loaded, tab Device đang loading lần đầu):

```ts
interface ListSlice<T> {
  items: T[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  lastRequestId: number
}

interface PolicyAssignmentsState {
  /** GroupDetailView tab Policies — policy đang gán cho 1 group. */
  groupPolicies: ListSlice<PolicySummary>
  /** PolicyDetailView tab Group — group đang gán 1 policy. */
  policyGroups: ListSlice<GroupSummary>
  /** PolicyDetailView tab Device — device đang gán trực tiếp 1 policy. */
  policyDevices: ListSlice<Device>
}
```

| Action | Endpoint | Ghi chú |
|---|---|---|
| `fetchGroupPolicies(groupId, params)` | `GET /groups/:id/policy_assignments` | Ghi vào slice `groupPolicies` |
| `assignPolicyToGroup(groupId, policyId)` | `POST /groups/:id/policy_assignments` | **Không** ghi vào `groupPolicies` — chỉ trả `PolicyAssignmentJob` để caller `jobsStore.track()`; danh sách chỉ đúng sau khi job `done` (§2.4) |
| `unassignPolicyFromGroup(groupId, policyId)` | `DELETE /groups/:id/policy_assignments/:policy_id` | Không tự cập nhật `groupPolicies.items` — caller tự `fetch` lại sau khi `204` (nhất quán "không optimistic update" toàn app) |
| `fetchPolicyGroups(policyId, params)` | `GET /policies/:id/group_assignments` | Ghi vào slice `policyGroups` |
| `fetchPolicyDevices(policyId, params)` | `GET /policies/:id/device_assignments` | Ghi vào slice `policyDevices` |
| `assignDeviceToPolicy(policyId, deviceId)` | `POST /policies/:id/device_assignments` | Trả `Device` (đồng bộ, không job) |
| `unassignDeviceFromPolicy(policyId, deviceId)` | `DELETE /policies/:id/device_assignments/:device_id` | — |

Mọi mutation (`assign*`/`unassign*`) **không** set `loading`/`error` cấp
store — lỗi `throw` nguyên vẹn để component gọi tự xử lý (đúng nguyên tắc đã
lặp lại từ F3: 1 submission thuộc về nơi gọi nó).

### 3.7 `stores/jobs.ts` — xem §2.3.1 (đã viết đầy đủ ở trên, không lặp lại)

## 4. Empty / loading / error / success

| Tình huống | Hiển thị | Nguồn |
|---|---|---|
| Policy List — loading lần đầu/refetch | Không đổi so với F7 (`DataTable` skeleton/overlay) | F7-frontend.md §4 |
| Policy List — dòng bảng giờ clickable | Con trỏ pointer qua `.data-table.is-clickable` (đã có sẵn từ F2, tự áp dụng khi có `onRowClick`) | §2.1, có sẵn |
| Policy Detail — header loading | Skeleton 2 dòng (tên + type/status), cùng cơ chế `GroupDetailView` header | §2.2 |
| Policy Detail — header 404 | `EmptyState` "Không tìm thấy Policy" + link về `/policies` | §2.2 |
| Policy Detail — tab Group/Device loading lần đầu | `DataTable` skeleton (component tự làm, không cần code thêm) | — |
| Policy Detail — tab Group/Device lỗi | `ErrorState` + "Thử lại" — **độc lập từng tab** | SoT §4-D bước 3 |
| Policy Detail — tab Group rỗng (A24) | `EmptyState` "Chưa gán cho Group nào." | A24 literal |
| Policy Detail — tab Device rỗng (A24) | `EmptyState` "Chưa gán trực tiếp cho Device nào." | A24 literal |
| Policy Detail — nút "Gán thêm" khi Policy `inactive` (A25) | `disabled` + `title="Policy không active, không thể gán."` | A25/A26 |
| Modal gán Policy cho Group — Policy đã gán rồi (5.1) | `.warning-banner` không chặn submit | 5.1 literal |
| Modal gán Device — chọn Device `retired` | Nút "Gán" disable + `.error-banner` hiện `RETIRED_POLICY_MESSAGE` ngay khi chọn (chặn sớm FE) | §2.5.3 |
| Modal gán Device — 422 (race hoặc bypass) | `extractFormErrors` → `base` → banner đỏ trên form | A7/A26 |
| Job `pending`/`running` | `AsyncJobBanner` trung tính + spinner, sticky góc dưới, global | §2.3.2 |
| Job `done` | Banner xanh, tự ẩn sau 4s, nút "Đóng" | §2.3.2 |
| Job `failed`, có Group | Banner đỏ, không tự ẩn, "Xem chi tiết"/"Thử lại"/"Đóng" | §2.3.2 |
| Job `failed`, Group `null` | Banner đỏ, **không có "Thử lại"** | A10/§2.3.2 |
| Group Detail — reattach job khi mount (A17) | Có job → banner hiện lại ngay; không có job → không banner, không lỗi | A17 |
| Group Detail tab Policies rỗng | `EmptyState` "Group chưa được gán Policy nào." + CTA "+ Gán policy" | §2.4 |
| Group Detail tab Policies — job vừa `done` | Tự refetch nếu tab đang active; nếu không, refetch khi user quay lại tab | §2.4 |
| Deactivate Policy — N > 0 (A21) | `ConfirmModal` với N thật, không `destructive` | §2.1.1 |
| Deactivate Policy — N = 0 (A20) | Không hiện gì, PATCH thẳng | A20 |
| Success gán Group (submit) | Đóng modal → **không toast** → banner đảm nhiệm feedback | §2.5.1, quyết định ghi ở đây |
| Success gán Device (đồng bộ) | Đóng modal → toast "Đã gán policy cho device" (literal SoT) → refetch tab | §4-B bước 4 |
| Success gỡ Policy khỏi Group/Device | Đóng modal → toast "Đã gỡ policy" (literal SoT, dùng chung cả 2 chiều) → refetch danh sách tương ứng | §4-C bước 3 |
| Success copy configuration | Toast "Đã copy cấu hình" | §2.2 |
| 401 bất kỳ lúc nào | Interceptor có sẵn — không đổi | Kế thừa F0 |

**Vì sao không toast khi bắt đầu job (chỉ toast khi Device đồng bộ xong)**:
với nhánh Group, việc "gán" chưa thực sự xảy ra tại thời điểm modal đóng
(`202`, job còn `pending`) — 1 toast "Đã gán..." lúc này sẽ là **thông tin
sai** (chưa xong). Banner tự thân đã đủ vai trò thông báo tiến trình +
kết quả cuối (`done`/`failed`) — thêm toast riêng chỉ tạo 2 tầng thông báo
cho cùng 1 sự kiện, không có trong SoT/`UI_UX_design.md` yêu cầu thêm.

## 5. Rủi ro / open question

### OQ-FE-1 (xác nhận, không chặn) — Tab state ở `GroupDetailView`/`PolicyDetailView` không sync URL

`activeTab` là `ref` cục bộ, không đọc/viết `route.query.tab`. Hệ quả: F5 lại
trang khi đang ở tab Policies (Group Detail) hoặc tab Device (Policy Detail)
sẽ **về lại tab mặc định** (Thành viên/Group), và không thể gửi link trực
tiếp tới 1 tab cụ thể. Không có scenario nào ở SoT §11 hay mô tả nào ở
`UI_UX_design.md` §6.2/§7.2 yêu cầu deep-link tới tab — cả 2 chỉ vẽ layout
"Tab: [...] [...]" không nói gì về URL. Giữ đơn giản (state cục bộ) tránh
thêm 1 lớp đồng bộ URL không được yêu cầu, nhất quán cách F7 đã từ chối thêm
phức tạp không cần thiết (OQ-FE-2/OQ-FE-3 của F7).

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** giữ
local state, không sync URL. Có thể đổi sau nếu người duyệt muốn deep-link
— thay đổi cục bộ trong 2 view, không ảnh hưởng API/store.

### OQ-FE-2 (đã biết, chấp nhận được — không chặn) — Không có cơ chế re-attach job khi bắt đầu từ Policy Detail rồi F5

`stores/jobs.ts.reattachForGroup(groupId)` chỉ được gọi từ
`GroupDetailView.onMounted`, dùng `GET /groups/:id/policy_assignment_jobs`
(scoped theo `group_id` — đúng F8-api.md §1, đây là **endpoint duy nhất** có
trong hợp đồng đã approve; không có `GET /policies/:id/policy_assignment_jobs`
tương đương). Hệ quả: nếu user khởi tạo job từ **Policy Detail** (tab Group,
`PolicyGroupAssignModal`) rồi **F5 ngay trang đó** trước khi job xong, Pinia
store `jobs` bị reset (mất theo dõi cục bộ) và Policy Detail **không có
đường nào** để tự re-attach lại job đó (không biết `group_id` nào cần hỏi
nếu không lưu lại, và dù biết cũng không có endpoint scoped theo `policy_id`
để hỏi). Job vẫn chạy đúng ở server (không mất dữ liệu, không sai kết quả)
— chỉ mất khả năng **hiển thị** banner cho tới khi user mở **đúng trang
Group Detail** của group đó (nơi re-attach vẫn hoạt động bình thường).

- **(a) Chấp nhận giới hạn này** — đúng theo hợp đồng API đã approve
  (`F8-api.md` không có endpoint scoped-theo-policy cho job), không đòi thêm
  endpoint mới ngoài phạm vi đã chốt. Log lại như 1 giới hạn đã biết.
- **(b) Thêm `GET /api/v1/policies/:id/policy_assignment_jobs`** — đối xứng
  với endpoint Group — nhưng đây là thay đổi **API contract đã approve**,
  ngoài phạm vi 1 bản thiết kế Frontend được sửa một mình; phải quay lại
  `/design F8-api` để thêm, không tự quyết ở đây.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** chọn
**(a)** — chấp nhận giới hạn, không mở lại `F8-api.md` chỉ vì 1 kịch bản
hiếm (F5 đúng lúc job đang chạy, đúng lúc đang ở Policy Detail chứ không
phải Group Detail). Không mất dữ liệu, chỉ mất hiển thị tạm thời — người
dùng mở lại Group Detail của group đó sẽ thấy banner tái xuất hiện đúng như
A17 vẫn quy định.

### OQ-FE-3 (xác nhận, không chặn) — `AsyncJobBanner` không hiện progress bar %

`processed_count` cosmetic (giữ `0` tới khi `done`, F8-api.md §4.1) —
banner ở trạng thái `running` chỉ hiện spinner + tổng số thiết bị (N), không
có thanh progress %/x-trên-y "đang chạy". Đây **không phải** thiếu sót FE —
backend (Phương án A) không có cơ chế cập nhật tiến độ giữa chừng để FE đọc.
Nếu muốn progress bar thật, cần đổi thiết kế DB/job (chi tiết theo batch) ở
`/design F8-db`/`F8-api` trước — ngoài phạm vi sửa 1 mình ở đây.

**Quyết định (2026-09-17, qua Claude Code, theo ủy quyền của user):** giữ
spinner + N, không progress bar %, đúng như hợp đồng API đã approve.

### Rủi ro đã biết / ghi chú bàn giao (không cần quyết định)

- **CSS mới cần thêm vào `styles/components.css`** khi implement (không
  bịa token màu mới, chỉ dùng token đã có ở `tokens.css`):
  - `.job-banner-stack { position: fixed; right: 20px; bottom: 20px; z-index: 50; display: flex; flex-direction: column; gap: 10px; max-width: 340px; }`
  - `.job-banner { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 20px rgba(15,23,33,0.14); font-size: 13px; display: flex; flex-direction: column; gap: 8px; }`
  - `.job-banner.status-done { border-color: color-mix(in srgb, var(--success) 35%, var(--border)); }`
  - `.job-banner.status-failed { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); }`
  - `.code-block { font-family: var(--font-mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }`
  - Không cần CSS mới cho tabs/dropdown/warning-banner — đã có sẵn
    (`.tabs`/`.tab-item`/`.dropdown-menu`/`.warning-banner`).
- **`jobsStore` không tự dừng timer khi logout** — nếu người dùng logout
  giữa lúc có job đang poll, `setInterval` tiếp tục chạy tới khi hết session
  JS (không leak qua lần load trang mới vì Pinia reset khi F5/đóng tab).
  Rủi ro thấp (không gọi API nào cần quyền cao hơn "đọc 1 job của org mình",
  và token hết hạn thì request tự 401 rồi bị bỏ qua) — có thể thêm
  `jobsStore.$reset()` (dừng hết timer trước khi filter) vào `auth.logout()`
  nếu người duyệt muốn dứt điểm, không bắt buộc theo SoT/UI_UX_design.md.
- **`PolicyFormModal.vue` — thêm confirm deactivate y hệt §2.1.1**: modal
  edit hiện tại submit thẳng khi bấm "Lưu". F8 thêm 1 bước: nếu
  `form.status === 'inactive' && props.policy!.status === 'active' &&
  props.policy!.assignments_count > 0` → chặn `onSubmit` thật, hiện
  `<ConfirmModal>` đè lên (`pendingDeactivateConfirm = true`) với đúng
  `DEACTIVATE_WARNING(props.policy!.assignments_count)`; xác nhận mới thực
  sự gọi `policiesStore.updatePolicy`. Không lặp lại toàn bộ code — dùng
  đúng hàm `DEACTIVATE_WARNING` đã viết ở §2.1.1 (export từ 1 file dùng
  chung nhỏ, ví dụ `utils/policyMessages.ts`, để 2 nơi gọi không copy-paste
  literal).
- **Không phát hiện mâu thuẫn nào khác** giữa SoT F8 / `F8-api.md` /
  `UI_UX_design.md` ngoài điểm đã tự giải quyết ở SoT §12 OQ-1 (tên trạng
  thái job) — không cần dừng lại hỏi thêm ngoài 3 OQ-FE ở trên.

**Đã approve (2026-09-17, qua Claude Code, theo ủy quyền của user):** đã xem
`docs/design/F8-frontend-preview.html` (publish qua Artifact — màu/token
khớp chính xác `web/src/styles/tokens.css`, tương tác demo đúng như văn bản
tả). Đồng ý với cả 3 OQ-FE theo quyết định đã ghi trong file (không sync tab
lên URL; chấp nhận giới hạn re-attach job khi khởi tạo từ Policy Detail rồi
F5; không có progress bar %). `status` ở đầu file đã set `approved`. Cả 3
bản thiết kế (DB, API, Frontend) của F8 đều đã `approved` — sẵn sàng cho
`/plan F8`.
