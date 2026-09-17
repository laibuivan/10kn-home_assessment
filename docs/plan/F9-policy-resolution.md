# Plan — F9 Policy resolution engine (policy đang áp dụng trên Device, xử lý conflict cùng `type`)

## Readiness

- SoT: `docs/sot/F9-policy-resolution.md` — **approved** (2026-09-17,
  lai.bui.vtp@gmail.com). §11 có 20 `Scenario:` (đánh số S1–S20 dưới đây theo
  thứ tự xuất hiện — SoT tự gọi là "18 canonical" ở đầu §11 nhưng đếm trực
  tiếp trong file ra 20 khối `Scenario:`; không phải mâu thuẫn cần dừng lại,
  chỉ là lệch số đếm trong chính SoT, plan này bám đủ cả 20). Cả 7 Open
  Question (§12) đã chốt "theo khuyến nghị" — plan **không** mở lại OQ nào.
- Design DB/API/Frontend: `docs/design/F9-db.md`, `docs/design/F9-api.md`,
  `docs/design/F9-frontend.md` (+ `F9-frontend-preview.html`) — **cả 3 đã
  approved** (2026-09-17). Plan kế thừa nguyên các quyết định đã chốt tường
  minh trong 3 file, không tự chọn khác:
  - `F9-db.md` §3.1: **không migration mới**, query plan 2–4 câu SQL cố định
    (không phụ thuộc kích thước Group), lọc `status: active` ở **tầng
    Ruby**, không ở SQL (để giữ candidate `inactive` phục vụ "Xem tất cả
    nguồn").
  - `F9-api.md` §1: endpoint riêng `GET /api/v1/devices/:id/applied_policies`
    (member route, không nested resource), tái dùng `DevicePolicy#show?`
    gọi **tường minh** (`authorize device, :show?`, không phải `authorize
    device` trần — action thật là `index`).
  - `F9-api.md` §2.2: **không phân trang** (`applied_policies` không có
    `meta`).
  - `F9-api.md` §2.3: response là **mảng** `applied_policies: [...]`, mỗi
    phần tử có field `type` tường minh (không phải object keyed-by-type);
    `policy` top-level có thêm `status` (mở rộng nhỏ so với SoT §8, có lý do
    OQ-7); `candidates[].policy_id` (không phải `id`).
  - `F9-api.md` §2.5: thuật toán chọn thắng là **1 sort key duy nhất 4 phần
    tử** — `[device_id.present? ? 0 : 1, -policy.updated_at.to_f,
    policy_id, group_id || Float::INFINITY]` — phần tử thứ 4 (`group_id`)
    là bổ sung bắt buộc so với R2–R4 gốc của `CLAUDE.md`/SoT, cần cho A13
    (2 Group cùng gán đúng 1 Policy) để không phụ thuộc thứ tự trả về của
    SQL (vi phạm R5/A18 nếu thiếu) — **đây là chi tiết dễ bị bỏ sót nhất
    nếu chỉ đọc SoT mà không đọc `F9-api.md` §2.5**.
  - `F9-api.md` §3: 2 hằng số `EXCLUDED_REASON_INACTIVE` /
    `EXCLUDED_REASON_LOWER_PRIORITY` đặt **trong service**, khớp nguyên văn
    2 chuỗi ở Scenario canonical (không thêm "(updated_at cũ hơn)" như câu
    chữ A6 ở §5.2 — §11 canonical thắng).
  - `F9-api.md` §6.1: `load_candidates` bước 1 (tìm group Device thuộc)
    phải thêm `.joins(:group).merge(current_organization.groups)` — lớp
    phòng vệ cross-org thứ 2 dạng **filter im lặng**, không phải `raise`
    (nhất quán với F6/F8, không phải quyết định mới cần hỏi lại).
  - `F9-frontend.md` §0.1: **accordion inline** (không popover nổi
    `position: absolute`) — mở thêm 1 `<tr colspan="4">` ngay dưới dòng
    `type`.
  - `F9-frontend.md` §3.1: `AppliedPoliciesBlock` mount **sau khi
    `fetchDevice` (Header) đã thành công** (trong nhánh `v-else-if="device"`
    có sẵn từ F4), không fetch song song tuyệt đối từ đầu trang — tránh 2
    lớp UI "not found" chồng nhau.
  - `F9-frontend.md` §2: mọi `data-testid` tiếp nối tiền tố
    `device-detail-policies-*` đã có từ F4 (**không** đổi sang
    `applied-policies-*`) — `device-detail-policies-empty` phải **giữ
    nguyên** testid cũ dù nay do component con render.
  - `F9-frontend.md` §5: link "Xem tất cả nguồn" chỉ hiện khi
    `candidates.length > 1` (không hiện khi chỉ có đúng 1 candidate — lệch
    nhẹ có chủ đích so với câu chữ mockup).
- Dependency (`docs/backlog.md` dòng 18): F9 phụ thuộc **F8 — đã Done**
  (xác nhận trực tiếp, không chỉ theo backlog):
  - `api/db/schema.rb` đã có đủ `policy_assignments` (2 FK nullable
    `group_id`/`device_id`, CHECK "đúng 1 trong 2", 2 unique partial index,
    2 index đơn `group_id`/`device_id`), `group_memberships` (unique
    `(group_id, device_id)` + index đơn `device_id`), `policies`
    (`type`/`configuration`/`status`/`updated_at`) — **không cần migration
    nào cho F9**, đúng kết luận `F9-db.md` §2.
  - `api/app/models/{policy_assignment,group_membership,policy,device,
    group}.rb` đã có sẵn associations cần dùng (`Group#policy_assignments
    dependent: :delete_all` từ F8 — nền cho A12).
  - `api/app/policies/device_policy.rb` đã có `show?` → `true` không điều
    kiện — tái dùng nguyên, không sửa.
  - `api/spec/factories/{devices,groups,group_memberships,policies,
    policy_assignments}.rb` đã đủ trait cần (`policy_assignment` bắt buộc
    trait `:for_group`/`:for_device`; `policy` có trait `:inactive`,
    `configuration`/`status`/`updated_at` set trực tiếp qua `create(:policy,
    ...)`) — **không cần factory mới cho F9**.
  - **Xác nhận không trùng tên với bất kỳ thứ gì F9 sẽ tạo** (kiểm tra trực
    tiếp, không suy đoán):
    - `api/app/services/` hiện chỉ có `json_web_token.rb` — chưa có thư mục
      `devices/`, chưa có `policy_resolver.rb` ở bất kỳ đâu.
    - `api/app/controllers/api/v1/` chưa có `device_applied_policies_controller.rb`.
    - `api/config/routes.rb`: `resources :devices, only: [:index, :show,
      :create, :update]` **chưa có** khối `member do ... end` nào (khác
      `groups`/`policies`) — F9 là feature đầu tiên thêm route con cho
      `devices`, đúng dự đoán `F9-api.md` §1.
    - `web/src/types/` chưa có `appliedPolicy.ts`; `web/src/components/`
      chưa có `AppliedPoliciesBlock.vue`; `web/src/api/devices.ts` chưa có
      `fetchAppliedPolicies`.
    - `web/src/views/devices/DeviceDetailView.vue` dòng ~244–251 vẫn là
      placeholder tĩnh `device-detail-policies-empty` y hệt mô tả F4/F9-SoT;
      `web/src/views/devices/__tests__/DeviceDetailView.spec.ts` dòng 114
      hiện assert thẳng testid đó — **sẽ cần sửa cùng lúc T10** (xem T11).
- Cross-check SoT ↔ 3 design: không phát hiện mâu thuẫn mới — không có OQ
  nghiệp vụ nào còn treo. → **Sẵn sàng build.**

## Quy trình áp dụng cho plan này (`CLAUDE.md` §3/§5)

- Golden rule #3 (viết `.feature` trước) **đang tạm ngưng** → không có task
  nào cho `features/f9-policy-resolution.feature`/step definitions.
- Gate #4 (Playwright) tạm ngưng → Done cho F9 đo bằng **3 gate bắt buộc**:
  `rubocop`, `rspec`, `eslint + vitest` (T13, wave cuối, chặn Done).
- **Rule #4 (TDD bắt buộc cho pure logic `api/app/services/`) áp dụng trực
  tiếp cho `Devices::PolicyResolver`** — đây chính là service `CLAUDE.md`
  §3 rule 4 nêu đích danh làm ví dụ. **T1 (service spec, RED) phải đứng
  trước T2 (service code, GREEN)** — không viết `policy_resolver.rb` trước
  khi `policy_resolver_spec.rb` đã đỏ vì `NameError`/chưa có class.
- `CLAUDE.md` §4: **request spec (T5) phải có case org-isolation riêng, kỳ
  vọng 404 không phải 403** — Device thuộc org khác (id đoán được) → 404.
  Controller (T4) **không bao giờ** `Device.find(params[:id])` trần — luôn
  `policy_scope(Device).find(params[:id])`.

### Bảng tra scenario (SoT §11 → ký hiệu dùng trong plan)

| # | Scenario (SoT §11) | Rule/A-item liên quan |
|---|---|---|
| S1 | Device không có policy nào áp dụng → empty state | A1, §2.4 (mảng rỗng, 200) |
| S2 | 1 policy gán trực tiếp → nguồn "Trực tiếp" | A2 |
| S3 | 1 policy qua Group → nguồn "Từ group: X" | A3 |
| S4 | 2 policy khác `type` không xung đột | A4 |
| S5 | Trực tiếp + group cùng `type` cùng `configuration` → không phải conflict thật, vẫn chọn 1 dòng (OQ-1) | A5, R2, OQ-1 |
| S6 | Conflict 2 group, `updated_at` khác nhau → mới nhất thắng | A6, R3 |
| S7 | Hòa `updated_at` → `id` nhỏ hơn thắng | A7, R4 |
| S8 | Trực tiếp luôn thắng dù group `updated_at` mới hơn | A8, R2 |
| S9 | `type` chỉ còn candidate `inactive` → không xuất hiện | A9, R1 |
| S10 | Deactivate policy đang thắng → biến mất lần tính kế tiếp | A10, R5 |
| S11 | Activate lại → xuất hiện lại không cần gán lại | A11 |
| S12 | Xóa Group → policy của group đó biến mất | A12, F8 `dependent: :delete_all` |
| S13 | Cùng 1 `policy_id` qua 2 Group → không phải conflict, badge = group nhỏ nhất | A13, OQ-3, sort key phần tử 4 |
| S14 | Device `retired` vẫn hiển thị đúng resolution | A14 |
| S15 | Device org khác (đoán id) → 404 | A15, R7 |
| S16 | Device không tồn tại → 404 | A16 |
| S17 | Không token → 401 | A17 |
| S18 | Gọi lại 2 lần liên tiếp, state không đổi → kết quả giống hệt | A18, R5 |
| S19 | Popover "Xem tất cả nguồn" liệt kê đủ, kèm lý do loại (`EXCLUDED_REASON_*`) | OQ-4 |
| S20 | Lỗi tải khối Policy đang áp dụng không kéo sập trang | A20 |

## Task breakdown

### Backend — service, TDD (wave 1–2)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T1 | **RSpec `Devices::PolicyResolver` — viết TRƯỚC code, chạy RED** (chưa có `policy_resolver.rb` → `NameError`, xác nhận RED thật). Cover đủ: R1 (hợp trực tiếp ∪ group, lọc active), R2 (trực tiếp thắng group — S8), R3 (updated_at mới nhất thắng — S6), R4 (id nhỏ hơn thắng khi hòa updated_at — S7), sort key phần tử 4/OQ-3 (S13 — cùng policy_id qua 2 group, badge = group_id nhỏ nhất, cả 2 `included: true`), R8/`conflict` độc lập với đã-resolve-xong (S6/S8 conflict:true, S5 conflict:false dù có 2 candidate), A9 (toàn inactive → type biến mất — S9), A5/OQ-1 (cùng type cùng configuration, không conflict, vẫn áp dụng R2–R4 để chọn dòng hiển thị — S5), shape `candidates[]` đủ field + đúng 2 `excluded_reason` cố định + thứ tự active-trước-inactive-sau (S19), R5/A18 gọi 2 lần liên tiếp state không đổi → output bằng nhau tuyệt đối kể cả thứ tự mảng (S18), sort theo `type` alphabet ở tầng ngoài cùng. Dùng factory có sẵn (`policy_assignment` trait `:for_group`/`:for_device`, `policy` set `updated_at`/`configuration`/`status` trực tiếp qua `create(:policy, updated_at: ...)`) | Test (TDD, RED) | `api/spec/services/devices/policy_resolver_spec.rb` | — | S1–S13, S18, S19 |
| T2 | **Implement `Devices::PolicyResolver` — GREEN**, đúng interface/thuật toán `F9-api.md` §2.5: `initialize(device)`, `#call` trả `Array<Hash>` đúng shape §2.3, `load_candidates` (2 query chính + `.joins(:group).merge(current_organization.groups)` ở bước tìm `group_ids` — §6.1 phòng vệ cross-org, dùng `current_organization` = `device.organization`), `includes(:policy, :group)` bắt buộc (tránh N+1), sort key 4 phần tử đúng nguyên văn §2.5, 2 hằng số `EXCLUDED_REASON_INACTIVE`/`EXCLUDED_REASON_LOWER_PRIORITY`. Chạy `bundle exec rspec` lại T1 tới khi GREEN, không sửa spec để né code khó | Logic (`api/app/services/`) | `api/app/services/devices/policy_resolver.rb` | T1 | S1–S13, S18, S19 |

### Backend — route & controller (wave 1, 3)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T3 | Route: thêm `member do get "applied_policies", to: "device_applied_policies#index" end` vào `resources :devices` (`F9-api.md` §1 — feature đầu tiên thêm `member do` cho `devices`, giữ `params[:id]` = Device, không đổi thành `:device_id`) | API | `api/config/routes.rb` | — | Nền cho T4 |
| T4 | `Api::V1::DeviceAppliedPoliciesController#index` — `include Authenticatable` (401, controller này **không** kế thừa nó từ `ApplicationController`), `device = policy_scope(Device).find(params[:id])` → `authorize device, :show?` (tường minh — action thật là `index`, `DevicePolicy#index?` có nghĩa khác) → `results = Devices::PolicyResolver.new(device).call` → `render json: { applied_policies: results }`. Không `Paginatable`, không `record_seen!` | API | `api/app/controllers/api/v1/device_applied_policies_controller.rb` | T2, T3 | S1, S14–S17, S20 |

### Backend — request spec (wave 4)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T5 | Request spec `device_applied_policies_spec.rb`: happy path đủ shape JSON đúng §2.3 (field cấp top + `candidates[]`), empty → `200 {"applied_policies": []}` (S1), Device `retired` vẫn trả đúng (S14), **org-isolation task riêng, kỳ vọng 404 không 403** (S15 — Device thuộc org khác, id đoán được), Device không tồn tại → 404 (S16), không token → 401 (S17), gọi lại endpoint 2 lần liên tiếp không đổi state → response body giống hệt (S18, so sánh JSON, không chỉ status), **3 test tích hợp trả nợ carry-over F8** (A10/A11/A12 — deactivate policy đang thắng biến mất ở lần gọi kế tiếp / S10; activate lại xuất hiện lại / S11; xóa Group xóa luôn policy của group đó khỏi resolution / S12 — dựng qua HTTP thật, không chỉ unit test ở T1) | Test | `api/spec/requests/api/v1/device_applied_policies_spec.rb` | T4 | S1, S10–S12, S14–S18 |

### Frontend — types/api client (wave 1–2, song song hoàn toàn với backend)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T6 | `types/appliedPolicy.ts` mới — đúng `F9-frontend.md` §3.2: `AppliedPolicySource`, `AppliedPolicySummary` (có `status`), `AppliedPolicyCandidate` (`policy_id` không phải `id`), `AppliedPolicyEntry`, `AppliedPoliciesResponse`. Type dựa thẳng trên contract đã chốt ở `F9-api.md` §2.3 (approved) — **không cần chờ backend chạy thật** | FE types | `web/src/types/appliedPolicy.ts` | — | Hợp đồng cho T7–T9 |
| T7 | `api/devices.ts` (mở rộng) — thêm `fetchAppliedPolicies(deviceId): Promise<AppliedPoliciesResponse>` gọi `GET /api/v1/devices/:id/applied_policies` | FE api | `web/src/api/devices.ts` | T6 | Nền cho T8, T10, T11 |

### Frontend — component (wave 3–4)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T8 | `components/AppliedPoliciesBlock.vue` mới — prop `deviceId: number` duy nhất, không emit; `watch(() => props.deviceId, load, { immediate: true })`; state cục bộ `items`/`loading`/`error`/`expandedTypes` (mảng string, không `Set`); skeleton riêng (`device-detail-policies-loading`); `ErrorState` + "Thử lại" riêng (`device-detail-policies-error`, A20/S20); empty placeholder **giữ nguyên literal + testid cũ** "Chưa có policy nào áp dụng." (`device-detail-policies-empty`, S1); banner `.warning-banner` khi `conflictCount > 0` (`device-detail-policies-conflict-banner`, text đúng literal `F9-frontend.md` §2, S6/S7/S8); bảng 4 cột (Name/Type/Nguồn/Trạng thái, `device-detail-policies-row`), badge nguồn `.chip` + `sourceLabel()` (S2/S3/S13), cờ conflict `⚠` cấp dòng (`device-detail-policies-conflict-flag`); accordion inline `toggleCandidates(type)` chỉ hiện link khi `candidates.length > 1` (`device-detail-policies-view-sources`, `device-detail-policies-candidates`, `device-detail-policies-candidate-row`), `key` = `${policy_id}-${source.kind}-${source.group?.id ?? 'direct'}` (bắt buộc cho S13 — 2 dòng cùng `policy_id` khác `group`), text `excluded_reason` render thẳng không map lại (S19). Không đọc `device.status` (component không nhận prop này — S14 tự đúng) | FE component | `web/src/components/AppliedPoliciesBlock.vue` | T6, T7 | S1–S9, S13, S18–S20 |
| T9 | Vitest `AppliedPoliciesBlock.spec.ts` — mock `fetchAppliedPolicies`: (a) loading state (assert skeleton hiện trước khi promise resolve), (b) empty → testid + text đúng literal (S1), (c) error → `ErrorState` hiện, click "Thử lại" gọi lại `fetchAppliedPolicies` lần 2 (S20), (d) success không conflict → không banner, đủ số dòng (S2–S4), (e) success có conflict → banner đúng text + N, cờ `⚠` ở dòng liên quan (S6/S7/S8), (f) accordion: link chỉ hiện khi `candidates.length > 1`, click mở/đóng đúng `aria-expanded`, mỗi `candidate-row` hiện đúng `included`/`excluded_reason` literal từ API không bị dịch lại (S19), (g) A13 — 2 candidate cùng `policy_id` khác `group` vẫn render 2 `candidate-row` riêng (key không đụng) | Test | `web/src/components/__tests__/AppliedPoliciesBlock.spec.ts` | T8 | S1–S9, S13, S19, S20 |

### Frontend — mount vào Device Detail (wave 4–5)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T10 | `DeviceDetailView.vue` (sửa) — thay khối `<div data-testid="device-detail-policies-empty">...</div>` tĩnh (dòng ~244–251) bằng `<AppliedPoliciesBlock :device-id="device.id" />`, đặt trong đúng nhánh `v-else-if="device"` sau khối Groups (không mount song song tuyệt đối với `fetchDevice`, đúng `F9-frontend.md` §3.1); cập nhật comment đầu file ("Policy đang áp dụng is still the static empty state until F9" → phản ánh trạng thái mới); import `AppliedPoliciesBlock` | FE view | `web/src/views/devices/DeviceDetailView.vue` | T8 | Main flow SoT §4 |
| T11 | Vitest `DeviceDetailView.spec.ts` (sửa) — test hiện tại (dòng ~104–116) mock `../../../api/devices` **chưa có** `fetchAppliedPolicies`; phải: (a) thêm `fetchAppliedPolicies: vi.fn()` vào `vi.mock('../../../api/devices', ...)`, (b) mock resolve `{ applied_policies: [] }` cho case happy-path hiện có, (c) thêm `await flushPromises()` thứ 2 (child component tự fetch async sau khi `device` có giá trị — 1 tick không đủ), (d) assertion `device-detail-policies-empty` giữ nguyên (testid không đổi, chỉ đổi nơi render) — regression, không phải test mới; **không** cần thêm case conflict/error ở đây (đã cover đủ tại T9, tránh test trùng 2 lớp) | Test | `web/src/views/devices/__tests__/DeviceDetailView.spec.ts` | T10 | S1 (regression, integration) |

### Docs (wave 5)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T12 | `DESIGN.md` — điền mục "## Tính policy đang áp dụng và conflict" (hiện là `TODO`, dòng 87–91): thuật toán thật (hợp trực tiếp ∪ group, lọc active tại thời điểm đọc, sort key 4 phần tử, ví dụ A13), tham chiếu `F9-db.md`/`F9-api.md`; thêm mục con `### F9 (Policy resolution engine...)` vào "## AI" (tool/chỗ AI làm/chỗ tự thiết kế/chỗ AI sai đã sửa — theo đúng khuôn F5–F8 đã có) | Docs | `DESIGN.md` | T1–T11 | — |

**Rubocop/ESLint/Prettier**: điều kiện hoàn tất ngầm định của mọi task có
code ở trên (T1–T11) — mỗi task Done kèm chạy sạch trên đúng file nó sửa.

### Gate cuối (wave 6, chặn Done)

| # | Task | Layer | File | Phụ thuộc | Acceptance scenario |
|---|---|---|---|---|---|
| T13 | Chạy **3 gate bắt buộc** toàn cục (không chỉ file mới): `rubocop`, `rspec` (toàn bộ suite, không chỉ `spec/services`/`spec/requests` mới — xác nhận không phá test cũ của F0–F8), `eslint + vitest` (toàn bộ, không chỉ file mới). Playwright/E2E tạm ngưng, không chạy. Phải xanh cả 3 mới coi F9 Done | Gate | — | T1–T12 | — |

## Sơ đồ wave

```text
Wave 1 (song song): T1, T3, T6
        │
        ▼
Wave 2 (song song): T2, T7
        │
        ▼
Wave 3 (song song): T4, T8
        │
        ▼
Wave 4 (song song): T5, T9, T10
        │
        ▼
Wave 5 (song song): T11, T12
        │
        ▼
Wave 6: T13
```

- **Wave 1**: T1 (service spec, RED — không cần code có sẵn, chỉ cần
  factory đã tồn tại), T3 (route, độc lập), T6 (FE types — dựa thẳng vào
  contract đã approved ở `F9-api.md` §2.3, không cần chờ backend) — cả 3
  không phụ thuộc lẫn nhau.
- **Wave 2**: T2 (service GREEN, cần T1 đỏ trước — TDD), T7 (FE api
  function, cần type T6).
- **Wave 3**: T4 (controller, cần service T2 + route T3), T8 (FE component,
  cần type + api function T6/T7 — **chạy song song với T4**, đúng lý do đã
  áp dụng ở plan F8: "contract API đã cố định từ design docs approved,
  không cần chờ backend chạy thật mới viết được FE").
- **Wave 4**: T5 (request spec, cần controller thật T4), T9 (component
  Vitest, cần component thật T8), T10 (mount vào `DeviceDetailView`, cần
  component thật T8) — 3 task độc lập nhau, chạy song song.
- **Wave 5**: T11 (sửa `DeviceDetailView.spec.ts`, cần T10 đã mount xong),
  T12 (`DESIGN.md`, viết sau cùng để phản ánh đúng quyết định thật, không
  phải suy đoán trước khi code xong).
- **Wave 6**: T13 — gate cuối, chặn Done, chạy sau khi mọi wave code+test
  xong.

## Rủi ro / open question

**Không có rủi ro/open question nghiệp vụ nào cần quyết định trước khi
build** — cả 3 bản design (`F9-db.md`, `F9-api.md`, `F9-frontend.md`) đã tự
đối chiếu SoT, tự phát hiện và giải quyết mọi điểm mơ hồ (OQ-1..OQ-7 ở SoT,
cộng câu hỏi mở về cross-org filter ở `F9-db.md` §4 đã được `F9-api.md` §6.1
chốt), không còn `Scenario: ... (pending OQ-n)` nào trong SoT §11. Mọi quyết
định đã chốt ở design — plan chỉ cần bám đúng.

Vài điểm cần implementer không lặng lẽ bỏ qua (không phải OQ mới, chỉ là chi
tiết dễ bị lướt qua khi code nhanh):

1. **Sort key 4 phần tử, không phải 3** (`F9-api.md` §2.5) — nếu chỉ implement
   đúng R2–R4 của `CLAUDE.md`/SoT gốc (3 phần tử: `device_id.present?` →
   `updated_at` → `policy_id`) mà thiếu phần tử thứ 4 (`group_id`), scenario
   S13 (A13 — cùng 1 `policy_id` qua 2 Group) sẽ **flaky theo thứ tự trả về
   của SQL** thay vì xác định tuyệt đối — vi phạm R5/A18. T1 phải có test
   riêng cho đúng case này (2 Group, cùng `policy_id`, đảo thứ tự tạo record
   giữa 2 lần chạy spec để phát hiện nếu code phụ thuộc thứ tự ngầm).
2. **`device-detail-policies-empty` testid phải giữ nguyên nguyên văn** khi
   chuyển từ `DeviceDetailView.vue` sang `AppliedPoliciesBlock.vue` — T11
   (sửa spec cũ) sẽ tự phát hiện nếu lệch, nhưng lưu ý viết T8 đúng ngay từ
   đầu để tránh phải quay lại sửa 2 chỗ.
3. **`load_candidates` bước 1 (group_ids) phải có `.joins(:group).merge
   (current_organization.groups)`** — nếu code theo đúng câu chữ gốc
   `F9-db.md` §3.1 (chưa có lớp phòng vệ này) mà bỏ qua bản cập nhật ở
   `F9-api.md` §6.1, sẽ thiếu 1 lớp phòng vệ cross-org đã được chốt tường
   minh (dù rủi ro thực tế thấp vì invariant ghi-thời-điểm của F6/F8) — T2
   phải implement đúng bản đã cập nhật ở `F9-api.md`, không phải bản gốc ở
   `F9-db.md`.
4. **`DeviceDetailView.spec.ts` (T11) dễ bị quên** vì nó là 1 dòng sửa nhỏ
   trong 1 test đã pass từ F4/F6/F8 — nếu bỏ qua, suite sẽ đỏ ngay khi T10
   merge (mock `fetchAppliedPolicies` không tồn tại → component con throw
   khi gọi hàm `undefined`), không phải lỗi logic mới mà chỉ là quên cập
   nhật mock — nhắc lại ở đây để không bị bỏ sót giữa các wave.
5. **Số đếm scenario SoT §11 tự ghi "18 canonical" nhưng đếm thực tế ra 20
   khối `Scenario:`** — không phải lỗi cần sửa SoT (ngoài phạm vi plan),
   chỉ ghi chú để review không hoang mang khi thấy S1–S20 trong plan này
   thay vì S1–S18.
