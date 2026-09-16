# Plan — F4 Device detail

## Readiness
- SoT: `docs/sot/F4-device-detail.md` — approved (2026-09-16, lai.bui.vtp@gmail.com).
- Design DB/API/Frontend (`docs/design/F4-{db,api,frontend}.md` +
  `F4-frontend-preview.html`) — cả 3 approved (2026-09-16). Không có quyết
  định nào cần mở lại ở plan này.
- Dependency: F3 (`docs/backlog.md`) — **Done** (`Device` model,
  `DevicePolicy`/`Scope`, `DevicesController#index/create/update`,
  `DeviceFormModal`/`FormModal`/`DataTable`/`FilterBar`/`PaginationBar`/
  `EmptyState`/`ErrorState`/`StatusBadge`/`ToastContainer`,
  `stores/devices.ts`/`stores/toast.ts`, `api/devices.ts`, `types/device.ts`,
  `utils/apiError.ts`, `views/devices/DeviceListView.vue` đều đã tồn tại và
  test xanh). Không có mâu thuẫn giữa SoT và 3 bản thiết kế khi đọc chéo. →
  Sẵn sàng lên plan.

## Quyết định implement-time (không phải open question mới)
- F4 **không có migration** (`F4-db.md` §2) — không đổi `Device` model.
- F4 **không thêm controller mới** — chỉ thêm action `show` vào
  `DevicesController` đã có, thêm `:show` vào `resources :devices`.
- `Device.find("abc")`/id lạ đã xác nhận thực nghiệm raise thẳng
  `ActiveRecord::RecordNotFound` (`F4-db.md` §4, `F4-api.md` intro) — action
  `show` **không cần** guard/validate riêng cho id sai định dạng, chỉ cần
  `policy_scope(Device).find(params[:id])` + rescue toàn cục có sẵn.
- FE: fetch 1 device cho trang chi tiết là **state cục bộ của
  `DeviceDetailView.vue`**, không phải Pinia store action mới (giống
  nguyên tắc F3 áp dụng cho form) — chỉ thêm 1 field nhỏ
  (`lastListLocation`) vào `stores/devices.ts` cho cơ chế "quay lại danh
  sách" (OQ-5), không thêm `loading`/`error`/`device` vào store.
- `ActionsMenu.vue` (mới) thay nút "Sửa" rời trên Devices List — dùng lại
  được ngay cho Groups/Policies list sau này (OQ-2).

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | `DevicePolicy`: thêm `show?` luôn `true` (giữ style `index?`/`create?`/`update?`) | API | `api/app/policies/device_policy.rb` | — | SoT §9 |
| T2 | RSpec policy spec mở rộng: `show?` luôn `true` kể cả device `retired` | Test | `api/spec/policies/device_policy_spec.rb` | T1 | SoT §9 |
| T3 | `DevicesController#show`: `device = policy_scope(Device).find(params[:id])`, `authorize device`, `render json: { device: serialize_device(device) }` — tái dùng nguyên `serialize_device` đã có, không strong params (không input ngoài `:id`) | API | `api/app/controllers/api/v1/devices_controller.rb` | T1 | A1, A2, A3, main flow "thành công" |
| T4 | `routes.rb`: đổi `resources :devices, only: [ :index, :create, :update ]` → thêm `:show` | API | `api/config/routes.rb` | T3 | — |
| T5 | RSpec request spec — `GET /api/v1/devices/:id` (describe block mới, cùng file F2/F3): thành công trả đủ field (khớp `serialize_device`), 404 id thuộc org khác (A1), 404 id không tồn tại (A2), 404 id sai định dạng — vd `"abc"` (A3), 401 không token (A13), 401 token hết hạn | Test | `api/spec/requests/api/v1/devices_spec.rb` | T3, T4 | A1, A2, A3, A13, SoT §11 scenario 2/3/4/13/14 |
| T6 | `utils/apiError.ts` — thêm `isNotFoundError(error)` (kiểm tra `response?.status === 404`), không sửa hàm hiện có | UI | `web/src/utils/apiError.ts` | — | Rẽ nhánh `notFound` ở T13 |
| T7 | `api/devices.ts` — thêm `fetchDevice(id: number \| string)` (`GET /api/v1/devices/:id`), tái dùng interface `DeviceResponse` hiện có (export nếu chưa) | UI | `web/src/api/devices.ts` | — | — |
| T8 | `stores/devices.ts` — thêm field `lastListLocation: string \| null` vào state (khởi tạo `null`), không thêm action mới | UI | `web/src/stores/devices.ts` | — | OQ-5 (nền cho T11/T13) |
| T9 | `components/ActionsMenu.vue` (mới) — dropdown "⋯" dùng chung, prop `items: { key, label, onClick, disabled?, disabledTitle?, testId? }[]`, tự quản lý `open`, đóng khi click ngoài/`Escape` (cùng cơ chế `AppShell.vue`) | UI | `web/src/components/ActionsMenu.vue` | T10 | Nền cho SoT scenario 8/9 |
| T10 | `styles/components.css` — thêm `.dropdown-trigger`/`.dropdown-menu`/`.dropdown-menu.open`/`.dropdown-item`/`.dropdown-item:disabled` (phỏng `.user-btn`/`.user-dd`), `.detail-header`/`.detail-grid`/`.detail-block`, `.neutral-banner`, `.detail-back` (theo đúng danh sách `F4-frontend.md` §5) | UI | `web/src/styles/components.css` | — | Hạ tầng style cho T9/T13 |
| T11 | `views/devices/DeviceListView.vue` — truyền `onRowClick` cho `DataTable` (điều hướng `/devices/:id`), đổi cột `actions` từ nút "Sửa" rời sang `<span @click.stop><ActionsMenu :items="rowActions(row)" /></span>` (2 item: Sửa — disabled+tooltip khi retired, Xem chi tiết), `watch(() => route.fullPath, ..., { immediate: true })` ghi `store.lastListLocation` | UI | `web/src/views/devices/DeviceListView.vue` | T9, T8 | A9, A10, SoT §11 scenario 8/9, §5.1 (nền OQ-5) |
| T12 | `views/devices/DeviceDetailView.vue` (mới) — đọc `route.params.id`, `load()` gọi `fetchDevice` (state cục bộ `device`/`loadingDetail`/`notFound`/`loadError`), `watch(() => route.params.id, load, { immediate: true })`; Header (identifier/`StatusBadge`/name/platform/os_version/last_seen_at + nút "Sửa" ẩn khi retired + banner `.neutral-banner` khi retired); 2 khối tĩnh Groups/Policy (dùng `EmptyState` con); `EmptyState` toàn trang khi `notFound`; `ErrorState` khi `loadError`; skeleton (`.skeleton-cell`) khi `loadingDetail`; nút "◀ Quay lại danh sách" → `devicesStore.lastListLocation ?? '/devices'`; mở lại `DeviceFormModal` (tái dùng nguyên từ F3) cho "Sửa", `@saved` → đóng modal + toast + `load()` (refetch, không refresh list) | UI | `web/src/views/devices/DeviceDetailView.vue` | T6, T7, T8, T10 | A1–A8, A11, A13, A14, toàn bộ main flow §4 |
| T13 | `router/index.ts` — thêm `{ path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true }` | UI | `web/src/router/index.ts` | T12 | A11, A14 (guard hiện có tự áp dụng) |
| T14 | Vitest `components/__tests__/ActionsMenu.spec.ts` — render items, click item gọi đúng `onClick` + đóng menu, item `disabled` không gọi `onClick` + hiện `title`, đóng khi click ngoài/`Escape` | Test | `web/src/components/__tests__/ActionsMenu.spec.ts` | T9 | Nền cho A9/A10 |
| T15 | Vitest `views/devices/__tests__/DeviceListView.spec.ts` mở rộng — click dòng (ngoài vùng actions) điều hướng đúng `/devices/:id` (A9), click item "Xem chi tiết" điều hướng đúng, không đồng thời trigger row click (A10, kiểm tra `router.push` gọi đúng 1 lần), item "Sửa" trong menu vẫn mở modal edit prefill đúng (giữ hành vi cũ), `route.fullPath` ghi vào `store.lastListLocation` khi mount/đổi filter | Test | `web/src/views/devices/__tests__/DeviceListView.spec.ts` | T11, T13 | A9, A10, SoT §11 scenario 8/9 |
| T16 | Vitest `views/devices/__tests__/DeviceDetailView.spec.ts` — render thành công đủ field + 2 khối empty tĩnh (SoT scenario 1); retired ẩn nút Sửa + hiện banner (scenario 5); không retired hiện nút Sửa mở đúng `DeviceFormModal` prefill (scenario 6); sửa thành công → `load()` refetch, banner retired xuất hiện ngay (scenario 7); 404 → `EmptyState` toàn trang + nút quay lại (scenario 3/4); lỗi khác → `ErrorState` + "Thử lại" gọi lại `load()` (scenario 12); nút quay lại dùng `lastListLocation` khi có, fallback `/devices` khi không (scenario 10/11) | Test | `web/src/views/devices/__tests__/DeviceDetailView.spec.ts` | T12, T13 | Toàn bộ SoT §11 (phần UI) |

Quy tắc chia task giữ nguyên theo `docs/plan/F3-device-create-edit.md`: Data
trước API cần nó; API trước UI gọi nó; mỗi test (RSpec/Vitest) là task riêng,
phụ thuộc đúng task code nó kiểm tra. Không có task riêng cho
`stores/devices.ts`'s `lastListLocation` (T8) vì đây chỉ là 1 field state
đơn giản, được cover gián tiếp qua T15/T16 — thêm 1 unit test Pinia riêng chỉ
cho 1 field gán trực tiếp là thừa (không phải "pure logic" theo nghĩa
`CLAUDE.md` §3 rule 4).

## Sơ đồ wave

```text
Wave 1 (song song): T1, T6, T7, T8, T10
        │
        ▼
Wave 2 (song song): T2, T3, T9, T12
        │
        ▼
Wave 3 (song song): T4, T11, T13, T14
        │
        ▼
Wave 4 (song song): T5, T15, T16
```

## Ghi chú wiring cho `/acceptance F4` (không phải task-table item)

SoT §11 có 15 scenario. Khác F3 (nhiều path bị chặn bởi client-side
validate/disabled input nên phải test qua API), **F4 hầu hết reachable qua
UI thật** vì bản chất là điều hướng + đọc dữ liệu, không có form validate
phức tạp:

- **UI-driven đầy đủ qua browser**: scenario 1 (xem chi tiết thành công),
  3 (404 — vào thẳng URL id không tồn tại), 4 (404 — vào thẳng URL id sai
  định dạng), 5 (retired ẩn Sửa + banner), 6 (không retired hiện Sửa, mở
  đúng form), 7 (sửa xong Header cập nhật ngay), 8 (click dòng điều hướng),
  9 (action "Xem chi tiết" điều hướng), 10 (vào thẳng URL không qua list),
  11 (quay lại danh sách giữ filter/trang), 15 (chưa đăng nhập bị redirect).
- **Cần Playwright route interception** (mock response): scenario 12 (lỗi
  hạ tầng khi tải — mock 500/network cho `GET /devices/:id`, kiểm tra banner
  + nút "Thử lại", cùng kỹ thuật F3 đã dùng cho scenario lỗi hạ tầng của
  nó).
- **Chỉ reachable/nên test qua API trực tiếp**: scenario 2 (404 cross-org —
  không có đường UI nào dẫn user org A tới id của org B để test qua click),
  13 (401 không token), 14 (401 token hết hạn).

## Rủi ro / open question

- **`ActionsMenu` là component mới quan trọng nhất của F4** (`F4-frontend.md`
  §5) — T9 nên làm sớm (wave 1 phụ thuộc trực tiếp là T10, không phụ thuộc
  gì khác) vì cả T11 (list) lẫn T14/T15 (test) đều cần nó; không có rủi ro
  logic phức tạp, chỉ cần đúng hành vi outside-click-closes/Escape đã có tiền
  lệ ở `AppShell.vue`.
- **T12 (`DeviceDetailView.vue`) là task lớn nhất** — gộp nhiều trạng thái
  (loading/404/error/success + retired banner + modal sửa) trong 1 file,
  giống quy mô `DeviceListView.vue` ở F2/F3. Không tách nhỏ hơn vì các
  trạng thái này chia sẻ chung 1 lần fetch (`load()`), tách file sẽ phải
  truyền state qua lại phức tạp hơn không cần thiết cho quy mô 1 view.
  Không tạo `NotFoundState`/`RetiredBanner` component riêng — SoT/design đã
  xác nhận tái dùng `EmptyState` (404) và 1 CSS class mới `.neutral-banner`
  (retired) là đủ, thêm component cho 2 trường hợp dùng đúng 1 lần mỗi cái
  là over-engineering.
- **`lastListLocation` chỉ sống trong phiên SPA** (Pinia, không
  `sessionStorage`) — nếu user reload trang chi tiết trực tiếp (F5 trình
  duyệt), giá trị mất, nút "Quay lại danh sách" fallback `/devices` không
  filter. Đây là hành vi đã approve ở SoT OQ-5 (A11: "không có gì đảm bảo
  user đã từng mở `/devices`"), không phải bug — T16 cần test rõ cả 2
  nhánh (có `lastListLocation` / không có) để tránh future-regression vô
  tình đổi thành luôn fallback `/devices`.
- **T5 (request spec `show`) cần seed 2 Organization** để test A1 (404
  cross-org) — tái dùng đúng pattern `FactoryBot` 2-org đã có sẵn từ F2/F3
  (`create(:organization)` thứ 2 + `create(:device, organization: other_org)`),
  không cần factory/trait mới.
- **Không có task riêng cho việc đổi `DataTable.vue`** — component này đã
  hỗ trợ sẵn `onRowClick`/`.is-clickable` từ F2 (chưa từng dùng tới), F4 chỉ
  cần *truyền* prop ở T11, không sửa file `DataTable.vue` — xác nhận lại ở
  đây để implementer không tưởng nhầm cần sửa component dùng chung.
- Trước khi `slice-implementer` bắt đầu: `acceptance-author` viết
  `features/f4-device-detail.feature` (RED) trước — bước 4 của `/feature F4`,
  không nằm trong bảng T-task trên, theo đúng ghi chú "wiring cho
  `/acceptance F4`" ở trên.
