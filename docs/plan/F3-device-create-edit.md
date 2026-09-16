# Plan — F3 Device create/edit + validate

## Readiness
- SoT: `docs/sot/F3-device-create-edit.md` — approved (2026-09-16, lai.bui.vtp@gmail.com).
- Design DB/API/Frontend (`docs/design/F3-{db,api,frontend}.md` +
  `F3-frontend-preview.html`) — cả 3 approved (2026-09-16). Đọc kỹ cả 3, không
  có quyết định nào cần mở lại ở plan này.
- Dependency: F2 (`docs/backlog.md`) — **Done** (schema `devices`, `Device`
  model, `DevicePolicy`/`Scope`, `DevicesController#index`,
  `DataTable`/`FilterBar`/`PaginationBar`/`EmptyState`/`ErrorState`,
  `stores/devices.ts`, `api/devices.ts`, `types/device.ts`,
  `utils/apiError.ts`, `views/devices/DeviceListView.vue` đều đã tồn tại và
  test xanh).
- Không có mâu thuẫn giữa SoT và 3 bản thiết kế khi đọc chéo. → Sẵn sàng lên
  plan.

## Quyết định implement-time (không phải open question mới)
- F3 **không có migration** (`F3-db.md` §2) — mọi thay đổi Data-layer chỉ là
  Ruby code trong `Device` model đã tồn tại.
- F3 **không thêm controller/route namespace mới** — chỉ thêm 2 action vào
  `DevicesController` đã có, thêm 2 method vào route `resources :devices`.
- Backend `create`/`update` viết trên cùng 1 file
  (`api/app/controllers/api/v1/devices_controller.rb`) nên T5/T6 dưới đây
  không có phụ thuộc code chéo nhau (dùng chung `ENUM_ERROR`/`invalid_enum?`/
  `serialize_device` đã có từ F2) nhưng sửa cùng file — implementer làm tuần
  tự trong thực tế dù plan xếp cùng wave.
- 3 component FE mới (`FormModal.vue`, `DeviceFormModal.vue`,
  `ToastContainer.vue`) và `stores/toast.ts` xếp Layer "UI" theo đúng quy ước
  `docs/plan/F2-device-list.md`.

## Task breakdown

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | `Device` model: đổi message uniqueness `identifier` sang tiếng Việt, thêm hằng `IDENTIFIER_TAKEN_MESSAGE`/`RETIRED_IMMUTABLE_MESSAGE`, thêm 2 `before_validation on: :update` (`block_all_changes_when_retired` khai trước, dùng `status_was`+`throw(:abort)`+`errors.add(:base, ...)`; `restore_immutable_identifier` khai sau, dùng `identifier_was`) | Data | `api/app/models/device.rb` | — | A1 (message), A8, A11, OQ-3 (no-op vẫn chặn) |
| T2 | RSpec model spec mở rộng: message uniqueness đúng tiếng Việt; `restore_immutable_identifier` giữ nguyên identifier gốc dù gán khác; `block_all_changes_when_retired` chặn mọi update khi `status_was == "retired"` (kể cả no-op), lỗi nằm ở `errors[:base]`, không chạy tiếp validate khác; chuyển **vào** retired (status_was == "active") vẫn cho qua | Test | `api/spec/models/device_spec.rb` | T1 | A6, A7, A8, A11, OQ-3 |
| T3 | `DevicePolicy`: thêm `create?`/`update?` luôn `true` | API | `api/app/policies/device_policy.rb` | — | SoT §9 |
| T4 | RSpec policy spec mở rộng: `create?`/`update?` luôn `true` kể cả với device `retired` (business rule không nằm ở Pundit) | Test | `api/spec/policies/device_policy_spec.rb` | T3 | SoT §9 |
| T5 | `DevicesController#create`: strong params `create_params` (`identifier`,`name`,`platform`,`os_version`, không permit `status`/`organization_id`), guard `invalid_enum?(create_params[:platform], Device.platforms.keys)` trước khi build, `current_organization.devices.build(create_params)`, `rescue_from ActiveRecord::RecordNotUnique, with: :render_identifier_taken` cục bộ trong controller | API | `api/app/controllers/api/v1/devices_controller.rb` | T1, T3 | A1, A2, A3, A4, A9, A12, main flow "Tạo thành công" |
| T6 | `DevicesController#update`: `device = policy_scope(Device).find(params[:id])`, `authorize device`, strong params `update_params` (`name`,`platform`,`os_version`,`status`, không permit `identifier`/`organization_id`), guard enum `platform`+`status` gộp 1 lần trước `device.update`, `device.update(update_params)` → 200/422 qua `serialize_device`/`render_validation_errors` có sẵn | API | `api/app/controllers/api/v1/devices_controller.rb` | T1, T3 | A5, A6, A7, A8, A9, A10 (qua policy_scope), A11 |
| T7 | `routes.rb`: đổi `resources :devices, only: [ :index ]` → `only: [ :index, :create, :update ]` | API | `api/config/routes.rb` | T5, T6 | — |
| T8 | RSpec request spec — `POST /api/v1/devices` (describe block mới, cùng file F2): tạo thành công + status mặc định active bỏ qua client gửi retired, trùng identifier cùng org (A1), trùng org khác OK (A2), thiếu field gộp nhiều lỗi (A3), platform sai enum (A4), organization_id bị bỏ qua (A9), race condition `RecordNotUnique` → 422 giống hệt A1 (A12), 401 không token (A14) | Test | `api/spec/requests/api/v1/devices_spec.rb` | T7 | A1, A2, A3, A4, A9, A12, A14, SoT §11 scenario 1/2/3/4/7/12/14/16 |
| T9 | RSpec request spec — `PATCH /api/v1/devices/:id` (describe block mới): sửa thành công field cho phép (A6), chuyển vào retired thành công (A7), chặn hoàn toàn khi đã retired kể cả no-op — lỗi ở `base` (A8), status sai enum (A5), identifier bị bỏ qua dù gửi khác (A11), 404 cross-org (A10), 401 token hết hạn (A14) | Test | `api/spec/requests/api/v1/devices_spec.rb` | T7 | A5, A6, A7, A8, A10, A11, A14, SoT §11 scenario 6/8/9/10/11/13/17 |
| T10 | `types/device.ts` — thêm `DeviceCreatePayload` (`identifier`,`name`,`platform`,`os_version?`), `DeviceUpdatePayload` (`name?`,`platform?`,`os_version?`,`status?`), khớp đúng strong params T5/T6 | UI | `web/src/types/device.ts` | — | — |
| T11 | `api/devices.ts` — thêm `createDevice(payload)` (`POST /api/v1/devices`), `updateDevice(id, payload)` (`PATCH /api/v1/devices/:id`), body phẳng | UI | `web/src/api/devices.ts` | T10 | — |
| T12 | `stores/devices.ts` — thêm action `createDevice`/`updateDevice`, không có `loading`/`error` riêng ở store (lỗi ném nguyên vẹn cho caller xử lý, giống `authStore.login`) | UI | `web/src/stores/devices.ts` | T11 | — |
| T13 | `utils/apiError.ts` — thêm `extractFormErrors(error, genericFallback)` (không sửa `extractErrorMessage` hiện có): key `base` → `baseError`, key khác → `fieldErrors`, không có body → `genericFallback` | UI | `web/src/utils/apiError.ts` | — | A13 (banner "Có lỗi xảy ra..."), A8/OQ-4 (key `base`) |
| T14 | `stores/toast.ts` (mới) — Pinia store `toasts`/`nextId`, action `push(message, variant)` (tự `setTimeout` dismiss 3s), `dismiss(id)` | UI | `web/src/stores/toast.ts` | — | Toast "Đã tạo device"/"Đã cập nhật device" |
| T15 | `styles/components.css` — thêm class mới theo đúng danh sách `F3-frontend.md` §5: `.tooltip-wrap`, `.actions-cell`, `.field.has-error input/select` + `.field-error`, `.field input:disabled/select:disabled`, tổng quát hoá `.btn[data-busy="true"] .spinner`/`.btn .spinner`/`.btn[data-busy="true"] .btn-label`, `.toast-stack`/`.toast` | UI | `web/src/styles/components.css` | — | Không có scenario riêng — hạ tầng style cho T16/T17/T19/T20 |
| T16 | `components/FormModal.vue` (mới, generic shell) — backdrop, tiêu đề, banner `baseError` phía trên slot, nút Hủy/Lưu (`data-busy`), đóng khi backdrop/Escape **trừ khi `submitting`**, default slot chứa form | UI | `web/src/components/FormModal.vue` | T15 | A8 (banner), A13 (banner + modal không đóng), SoT §5.1 (Hủy không gọi API) |
| T17 | `components/ToastContainer.vue` (mới) — `v-for` stack từ `toastStore.toasts`, nút "×" đóng tay | UI | `web/src/components/ToastContainer.vue` | T14, T15 | Toast stack nhiều toast chồng nhau |
| T18 | `AppShell.vue` — mount `<ToastContainer>` 1 lần (mọi trang sau login) | UI | `web/src/components/AppShell.vue` | T17 | — |
| T19 | `components/DeviceFormModal.vue` (mới, feature-specific) — bọc `FormModal`, field `identifier` (disabled ở edit)/`name`/`platform` (`<select>` có `""` mặc định ở create)/`os_version`/`status` (chỉ hiện ở edit), `form`/`fieldErrors`/`baseError`/`submitting` local state, `clientValidate()`, `onSubmit` chặn double-submit, gọi `deviceStore.createDevice`/`updateDevice`, map lỗi qua `extractFormErrors`, emit `saved`/`cancel` | UI | `web/src/components/DeviceFormModal.vue` | T10, T12, T13, T16 | Toàn bộ SoT §4 (main flow tạo/sửa), A1, A3, A4, A5, A8, A13 |
| T20 | `views/devices/DeviceListView.vue` — nút "+ Thêm Device" ở `.list-head`, cột `actions` trong `DataTable` (nút "Sửa"; disabled + `<span title="...">` khi `status == retired`), CTA "+ Thêm Device" ở biến thể Empty A1 (A2 giữ nguyên chỉ "Xóa lọc"), state `showModal`/`modalMode`/`modalDevice`, render `<DeviceFormModal v-if="showModal">`, handler `@saved` → đóng modal + `toastStore.push(message)` + `load()` (giữ nguyên filter/trang hiện tại từ URL) | UI | `web/src/views/devices/DeviceListView.vue` | T19, T14, T15 | SoT §11 scenario 1/8/9/18, §5.1 (refetch đúng filter/trang) |
| T21 | Vitest `components/__tests__/FormModal.spec.ts` — render slot, banner khi có `baseError`, đóng khi backdrop/Escape, **không** đóng khi `submitting=true`, nút Lưu disable+`data-busy` khi `submitting` | Test | `web/src/components/__tests__/FormModal.spec.ts` | T16 | A13, SoT §5.1 |
| T22 | Vitest `components/__tests__/DeviceFormModal.spec.ts` — prefill đúng theo `mode`/`device`, ẩn `status` ở create/hiện ở edit, `identifier` disabled ở edit, `clientValidate` chặn submit khi thiếu field (không gọi API), input xóa lỗi field cũ không xóa `baseError`, submit thành công emit `saved` với message đúng theo mode, submit lỗi 422 field-level → `fieldErrors` hiển thị đúng field không đóng modal, submit lỗi `base` → banner, double-submit bị chặn | Test | `web/src/components/__tests__/DeviceFormModal.spec.ts` | T19 | A1, A3, A4, A5, A8, A13, SoT §11 scenario 1/4/8/9 |
| T23 | Vitest `stores/__tests__/toast.spec.ts` — `push` thêm toast + tự `dismiss` sau 3s (fake timers), `dismiss` xoá đúng id, nhiều toast xếp chồng | Test | `web/src/stores/__tests__/toast.spec.ts` | T14 | Toast stack |
| T24 | Vitest `stores/__tests__/devices.spec.ts` mở rộng — `createDevice`/`updateDevice` gọi đúng hàm `api/devices.ts` và trả `response.device`, ném lỗi nguyên vẹn khi API thất bại (không catch) | Test | `web/src/stores/__tests__/devices.spec.ts` | T12 | — |
| T25 | Vitest `views/devices/__tests__/DeviceListView.spec.ts` mở rộng — nút "+ Thêm Device" mở modal `create`, nút "Sửa" mở modal `edit` prefill từ đúng row (không gọi API thêm), nút "Sửa" disabled + `title` đúng cho row `retired` (SoT scenario 18), `@saved` đóng modal + toast + `load()` giữ nguyên `activeQuery` hiện tại (không đổi URL), CTA "+ Thêm Device" ở Empty A1 mở modal | Test | `web/src/views/devices/__tests__/DeviceListView.spec.ts` | T20 | SoT §11 scenario 1/8/9/18, §5.1 |

## Sơ đồ wave

```text
Wave 1 (song song): T1, T3, T10, T13, T14, T15
        │
        ▼
Wave 2 (song song): T2, T4, T5, T6, T11, T16, T17, T23
        │
        ▼
Wave 3 (song song): T7, T12, T18, T21
        │
        ▼
Wave 4 (song song): T8, T9, T19, T24
        │
        ▼
Wave 5 (song song): T20, T22
        │
        ▼
Wave 6: T25
```

## Ghi chú wiring cho `/acceptance F3` (không phải task-table item, chỉ để scope acceptance-author)

SoT §11 có 18 scenario. Theo đúng 3 bản thiết kế đã approve, nhiều scenario
**không reachable qua thao tác UI bình thường** (form chỉ có `<select>` sinh
giá trị hợp lệ, `identifier` disabled ở edit, `status` ẩn ở create, nút "Sửa"
đã disable cho row retired) — các scenario này nên viết step **gọi thẳng
API** trong `.feature` (đúng pattern F2 đã dùng, vd "When tôi gọi device list
API với platform ..."), không cố lái qua browser:

- **Chỉ reachable/nên test qua API trực tiếp** (không có đường UI hợp lệ):
  scenario 5 (platform sai enum), 6 (status sai enum khi sửa), 7 (status ép
  active, bỏ qua client gửi), 10 (chặn sửa khi đã retired — nút đã disable),
  11 (identifier bất biến — field đã disable), 12 (organization_id bị bỏ
  qua — không phải form field), 13 (404 cross-org — modal Sửa chỉ mở từ row
  có sẵn của org mình), 14 (race condition — bản chất là 2 request đồng
  thời), 16 và 17 (401 không token / token hết hạn).
- **UI-driven đầy đủ qua browser** (modal/toast/nút thật): scenario 1 (tạo
  thành công + toast), 2 (trùng identifier cùng org — client không chặn field
  này, request thật sự tới API, field error hiện dưới input), 8 (sửa thành
  công), 9 (sửa chuyển sang retired), 15 (lỗi hạ tầng — cần mock 500/network
  qua Playwright route interception, kiểm tra banner + modal không đóng + dữ
  liệu còn nguyên), 18 (nút Sửa disable + tooltip `title`).
- **Có thể đi qua UI nhưng đơn giản hơn nếu test qua API** (không bắt buộc
  UI): scenario 3 (trùng identifier org khác vẫn tạo được — cần dựng 2 org).

## Rủi ro / open question

- **`Pundit::NotAuthorizedError` rescue vẫn không cần thêm ở F3** — dù F2's
  plan (`docs/plan/F2-device-list.md`, Rủi ro) từng dự đoán "F3 sẽ là nơi tự
  nhiên cần bổ sung": xác nhận lại là **không đúng** cho F3 cụ thể, vì
  `DevicePolicy#create?`/`#update?` luôn `true` (SoT §9 — business rule
  retired nằm ở model, không phải Pundit) — `Pundit::NotAuthorizedError`
  vẫn không bao giờ thực sự raise. Ghi nhận lại để plan của feature **sau**
  F3 (feature đầu tiên có role/authorization thật, có thể F5+) mới là nơi
  cần bổ sung `rescue_from` này ở `ApplicationController` — không tự thêm ở
  F3 để tránh mở rộng scope không có test.
- **OQ-DB1 (chưa chốt, chỉ khuyến nghị giữ hiện trạng)**: `F3-db.md` §4 để
  ngỏ câu hỏi có Việt-hoá toàn bộ message validate (`name`/`platform`/
  `status`) hay chỉ riêng `identifier`. Plan này **giữ nguyên khuyến nghị**
  của `F3-db.md` (chỉ Việt-hoá `identifier`, các field khác giữ message
  mặc định tiếng Anh của Rails) — T1/T2/T8/T9 viết theo giả định này. Nếu
  người duyệt muốn đổi trước khi build, cần quyết định thêm — ảnh hưởng cả
  F2 lẫn F3 request spec assertions.
- **Danh sách class CSS cần thêm ở T15** (`F3-frontend.md` §5) khá dài và dễ
  bỏ sót nếu implementer chỉ đọc code component mà không đọc design doc —
  nêu lại nguyên văn trong task T15 ở trên; khuyến nghị implement T15 **trước
  khi** viết T16/T17/T19/T20 (đúng thứ tự wave) để tránh phải quay lại vá CSS
  giữa chừng.
- **Tooltip dùng `title` gốc trình duyệt (không phải component riêng)** —
  đã chốt ở `F3-frontend.md` §5, chỉ nêu lại để `acceptance-author`/
  `slice-implementer` biết Playwright kiểm tra qua `getAttribute('title')`,
  không phải chờ tooltip UI hiện ra.
- **Đóng modal (Hủy/backdrop/Escape) bị khoá khi `submitting === true`** —
  quyết định suy luận thêm ở `F3-frontend.md` §5 (không có trong SoT gốc),
  đã approve nhưng implementer cần nhớ áp dụng đúng ở T16 (nút Hủy) và
  handler backdrop/Escape, không chỉ riêng nút Lưu.
- **404 cross-org khi sửa (A10) không có UI copy riêng** (`F3-frontend.md`
  §4/§5) — `DeviceFormModal` sẽ hiện nguyên message "Not found" nếu path này
  vô tình chạm tới qua UI (không nên xảy ra bình thường); T22 không cần test
  riêng cho case này ở tầng component (đã test đủ ở T9 request spec) — nêu
  lại để không ai thêm test Vitest thừa cho 1 path không reachable.
- **Tổ hợp lỗi enum + retired cùng lúc không có scenario nào ở SoT §11**
  (`F3-api.md` §5) — T9 không cần test case "vừa status sai enum vừa device
  retired"; nếu review muốn thêm sau, đây là mở rộng ngoài scope F3 hiện tại,
  không phải thiếu sót của plan này.
- **T5/T6 sửa cùng 1 file** (`devices_controller.rb`) — xếp cùng wave 2 vì
  không phụ thuộc code lẫn nhau, nhưng thực tế implementer sẽ làm tuần tự
  trong cùng 1 lần sửa file (không phải 2 PR song song thật) — chỉ là thứ tự
  logic, không phải giới hạn kỹ thuật.
- Trước khi `slice-implementer` bắt đầu: `acceptance-author` viết
  `features/f3-device-create-edit.feature` (RED) trước — bước 4 của
  `/feature F3`, không nằm trong bảng T-task trên (chỉ dành cho
  unit/integration/component test), theo đúng ghi chú "wiring cho
  `/acceptance F3`" ở trên.
