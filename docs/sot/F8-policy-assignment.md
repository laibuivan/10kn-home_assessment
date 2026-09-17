---
feature_id: F8
title: Policy assignment (gán Group và/hoặc Device; chặn inactive/chéo org; chịu group lớn, có trạng thái job)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-17
---

## §1. Meta
- Feature: `F8` — Policy assignment (gán Policy cho Group và/hoặc Device;
  chặn `inactive`/chéo org; chịu Group lớn tới 10.000 device; theo dõi được
  trạng thái job async).
- Dependency (theo `docs/backlog.md`): `F6` (Group membership — approved,
  bảng `group_memberships`, pattern `upsert_all` + unique index composite +
  idempotent lần đầu được thiết lập ở đây, `AsyncSearchSelect.vue` dùng
  chung), `F7` (Policy CRUD — approved, bảng `policies`, model `Policy` với
  enum `status: active/inactive`, `type` free-form string, `configuration`
  jsonb, `PolicyPolicy`), `F4` (Device detail — approved, layout 3 khối,
  khối "Policy đang áp dụng" **cố tình để tĩnh-rỗng**, giao quyết định
  contract cho F9 theo đúng backlog dòng 30: *"F8 → F9 (F9 cũng cập nhật lại
  khối 'Policy đang áp dụng' ở panel của F4)"*).
  - **Xác nhận ranh giới quan trọng nhất của F8 (đọc kỹ trước khi code)**: F8
    chỉ làm phần **gán** (tạo/xóa liên kết Policy↔Group, Policy↔Device) và hạ
    tầng job async cho việc gán vào Group lớn. F8 **không** làm "policy
    resolution engine" (tính hợp của policy trực tiếp ∪ policy từ group,
    xử lý conflict cùng `type`, tie-break `updated_at`/`id`) — toàn bộ phần
    đó là **F9**, đúng `docs/backlog.md` dòng 18 ("F9 | Policy resolution
    engine ... | F8"). Hệ quả trực tiếp: **F8 không đụng route/component
    Device Detail** (`/devices/:id`) — khối "Policy đang áp dụng" ở đó vẫn
    giữ nguyên trạng thái tĩnh-rỗng đã chốt ở `docs/sot/F4-device-detail.md`
    OQ-1/OQ-6 cho tới khi F9 làm. F8 chỉ thêm màn hình/API ở phía
    **Policies** (list + detail mới) và **Groups** (tab Policies ở Group
    Detail).
  - **3 nghĩa vụ carry-over bắt buộc từ F7** (`docs/sot/F7-policy-crud.md`
    §12 OQ-6, OQ-7, OQ-9 — F8 phải trả đủ cả 3, không được bỏ quên):
    1. **OQ-6**: thêm cột/field "Số nơi đang gán" (`assignments_count`) vào
       `GET /api/v1/policies` (list) — tổng số Group + số Device đang gán
       trực tiếp cho policy đó, tính ở API (không FE tự đếm), N+1-safe (xem
       §10).
    2. **OQ-7**: dựng thật trang `Policy Detail` (`/policies/:id`) với 2 tab
       "Đang gán cho Group (N)" / "Đang gán cho Device (N)" theo
       `UI_UX_design.md` §7.2 — mỗi tab có list phân trang + hành động
       gán thêm/gỡ.
    3. **OQ-9**: khi chuyển 1 Policy đang `active` → `inactive`, hiện cảnh
       báo thật "Policy đang được gán cho N group/device..." với N chính
       xác (không phải số giả `0`), và F8 phải **quyết định hành vi cụ
       thể** (giữ gán nhưng ngưng hiệu lực, hay gỡ gán) — xem §6, OQ-6 (số
       trong bảng OQ của SoT này, không phải OQ-6 của F7) và ghi vào
       `DESIGN.md`.
  - **Nghĩa vụ carry-over từ F6** (`docs/sot/F6-group-membership.md` §12
    OQ-1, `docs/design/F6-api.md` §4 "Ranh giới async job ... thuộc F8"):
    F6 đã chủ động **không** xây kiến trúc job/polling cho thêm-gỡ device
    khỏi group, với lý do rõ ràng "PRD chỉ bắt buộc async job cho gán Policy
    cho Group lớn" — nghĩa là **toàn bộ nghĩa vụ dựng Solid Queue job +
    bảng theo dõi trạng thái + API poll + `AsyncJobBanner.vue`** dồn vào F8,
    không được chia sẻ ngược lại cho F6.
  - **Nghĩa vụ kỹ thuật chưa ai làm**: Solid Queue **chưa** có trong
    `api/Gemfile` (không tìm thấy gem hay `config.active_job.queue_adapter`
    nào được set ở `api/config/environments/*.rb`) — F8 là feature đầu tiên
    cần Solid Queue thật, nên phải cài đặt (gem, `bin/rails
    solid_queue:install`, migration cho các bảng `solid_queue_*`, cấu hình
    adapter cho từng environment kể cả `test`) như một phần công việc, không
    phải thứ "đã có sẵn" như `CLAUDE.md` §1 ngụ ý ("đi kèm mặc định Rails
    8") — ghi rõ ở `DESIGN.md` khi implement.
- Nguồn: `PRD.md` §"Nghiệp vụ" → "Policy" (`gán được cho Group và/hoặc
  Device`; `không gán Policy inactive`; `không gán lẫn Organization`) +
  đoạn "Group có thể rất lớn (cỡ 10.000 devices). Gán Policy cho Group vẫn
  phải dùng được: UI không treo, hệ thống không sập, kết quả đúng (không
  thiếu thiết bị, không gán trùng vô hạn nếu thao tác lại)" + bảng "Giao
  diện bắt buộc" dòng "Groups" (`chi tiết: ... gán policy`) và dòng
  "Policies" (`gán cho group hoặc device`) + §"Yêu cầu chỉnh chu" (dòng
  "gán policy cho group lớn: user hiểu được là việc đang chạy/đã xong/thất
  bại — không phải bấm xong không biết gì"); `docs/backlog.md` mục F8 +
  "Dependency" (dòng 29-30) + "Ngoài phạm vi" (dòng 32-39); `CLAUDE.md` §4
  toàn bộ đoạn "Group lớn (10k devices) phải dùng được" (Solid Queue job,
  `upsert_all`, unique index, idempotent, trạng thái job) và đoạn "Không gán
  Policy inactive, không gán Policy khác Organization" — **không** đoạn
  "Policy đang áp dụng trên Device"/conflict (đoạn đó thuộc F9, F8 chỉ đọc
  để không thiết kế gì phá vỡ giả định "hàm thuần của state hiện tại" của
  F9); `UI_UX_design.md` §6.2 (Group Detail tab Policies), §6.3 (toàn bộ —
  UX job async bắt buộc), §7.1/§7.2 (Policy List cột "Số nơi đang gán",
  Policy Detail 2 tab), §8 (`AsyncSearchSelect.vue`, `AsyncJobBanner.vue`),
  §9 (dòng "Job async"), §10; `docs/sot/F7-policy-crud.md` §12 OQ-6/OQ-7/
  OQ-9 (carry-over); `docs/sot/F6-group-membership.md` §12 OQ-1 +
  `docs/design/F6-api.md` §4 (ranh giới job thuộc F8); `docs/sot/F4-device-detail.md`
  §12 OQ-1/OQ-6 (Device Detail giữ nguyên tĩnh-rỗng, không phải việc của F8).

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **gán một Policy cho
một Group** (áp dụng cho toàn bộ device trong group đó, kể cả group có tới
10.000 device) **hoặc gán trực tiếp cho một Device cụ thể**, gỡ gán khi
không cần nữa, và luôn biết được việc gán vào Group lớn đang chạy/đã xong/
thất bại (không phải bấm xong rồi không biết gì) — để chuẩn bị dữ liệu gán
đúng, không trùng, không lẫn Organization, không gán Policy đã ngừng dùng,
làm nền cho F9 tính "Policy đang áp dụng trên Device" một cách chính xác và
nhất quán.

## §3. Scope

**Trong phạm vi:**
- **DB**: bảng `policy_assignments` mới (gán Policy↔Group và Policy↔Device —
  xem OQ-2 để biết 2 phương án shape khác nhau, khuyến nghị Phương án A:
  assignment-level, không denormalize), bảng theo dõi job async mới (tạm gọi
  `policy_assignment_jobs`, xem OQ-3), migration cài đặt Solid Queue (bảng
  `solid_queue_*` do gem sinh ra).
- **Model/service**:
  - `PolicyAssignment` (Group hoặc Device đích qua polymorphic hoặc 2 FK
    tùy OQ-2), unique index đảm bảo idempotent.
  - `PolicyAssignmentJob` (hoặc tên tương đương) theo dõi
    `pending/running/done/failed` (tên chuẩn — xem OQ-1) + tiến độ
    (`total_count`/`processed_count`) khi có thể.
  - 1 Solid Queue Job (`GroupPolicyAssignmentJob` hoặc tương đương) — nhận
    `policy_id` + `group_id`, `upsert_all` bulk theo batch, cập nhật trạng
    thái job.
  - Service layer validate (không chỉ ở controller/UI):
    "Policy phải `active`", "Group/Device phải cùng Organization với
    Policy", "Device không được `retired`" khi gán trực tiếp.
  - `Policy has_many :policy_assignments`; `Group`/`Device` bổ sung
    association tương ứng (xem `Group` model hiện tại đã có comment nợ sẵn:
    *"F8 still owes `has_many :policy_assignments, dependent: :delete_all`
    once that table exists"*).
- **API** (namespace `api/v1`, kế thừa envelope lỗi/pattern F0–F7):
  - Gán/gỡ Policy cho Group (từ tab Policies ở Group Detail, đồng thời là
    nơi Policy Detail tab Group gọi ngược lại):
    - `GET /api/v1/groups/:id/policy_assignments` — list Policy đang gán
      cho Group (name/type/status), phân trang nếu cần.
    - `POST /api/v1/groups/:id/policy_assignments` (`{policy_id}`) — enqueue
      job, trả về job info ngay (`202` hoặc `201`, xem `/design`).
    - `DELETE /api/v1/groups/:id/policy_assignments/:policy_id` — gỡ 1
      Policy khỏi Group, **đồng bộ** trong request (xem OQ-8 — Phương án A
      làm việc này rẻ, không phụ thuộc số device trong group).
  - Gán/gỡ Policy trực tiếp cho Device (từ tab Device ở Policy Detail —
    xem OQ-11 cho việc **không** thêm entry point ở Device Detail):
    - `GET /api/v1/policies/:id/device_assignments` — list Device đang được
      gán trực tiếp policy này, phân trang.
    - `POST /api/v1/policies/:id/device_assignments` (`{device_id}`) — gán
      **đồng bộ** (bounded, 1 device — xem OQ-7).
    - `DELETE /api/v1/policies/:id/device_assignments/:device_id` — gỡ,
      đồng bộ.
  - Xem Group đang gán 1 Policy (Policy Detail tab Group):
    - `GET /api/v1/policies/:id/group_assignments` — list Group đang gán
      policy này, phân trang.
  - Theo dõi job async:
    - `GET /api/v1/policy_assignment_jobs/:id` — poll trạng thái 1 job.
    - `GET /api/v1/groups/:id/policy_assignment_jobs?status=pending,running`
      — re-attach banner khi user rời/quay lại trang Group Detail
      (`UI_UX_design.md` §6.3 điểm 6).
  - Mở rộng response đã có:
    - `GET /api/v1/policies` (list) — thêm `assignments_count`.
    - `GET /api/v1/policies/:id` — **endpoint mới** (F7 chủ động không làm,
      OQ-7 của F7) — trả đủ field Policy + phục vụ header trang Detail.
  - Mọi action lấy resource qua `current_organization.policies` /
    `current_organization.groups` / `current_organization.devices` /
    `current_organization.<bảng job/assignment mới>` — **không bao giờ**
    `Model.find` trần.
- **Authorization**: mở rộng `PolicyPolicy` (action mới cho detail/gỡ gán),
  mở rộng `GroupPolicy` (action mới cho tab Policies), policy Pundit mới
  cho `PolicyAssignmentJob` nếu cần (org-scope là chính, không phân role).
- **FE**:
  - Route `/policies/:id` + `views/policies/PolicyDetailView.vue` (2 tab).
  - `components/AsyncJobBanner.vue`, `components/AsyncSearchSelect.vue`
    (tái dùng ở modal gán policy cho group và gán device trực tiếp).
  - `stores/jobs.ts` (poll định kỳ, re-attach khi load trang).
  - Cập nhật `PolicyListView.vue` (cột "Số nơi đang gán", cảnh báo thật khi
    deactivate), `GroupDetailView.vue` (tab Policies thật thay chỗ trống).
  - Menu ⋯ ở Policy List thêm action "Xem chi tiết" (đã bị chặn ở F7 A29 vì
    chưa có trang — giờ có rồi, phải mở lại).

**Ngoài phạm vi** (khớp `docs/backlog.md` — không tự thêm):
- **Policy resolution engine** — tính "Policy đang áp dụng trên Device"
  (hợp trực tiếp ∪ group, lọc `status: active` tại thời điểm tính, xử lý
  conflict cùng `type` với tie-break `updated_at`/`id`) → **F9**. F8 chỉ tạo
  dữ liệu (`policy_assignments`) để F9 đọc, không tự tính hợp/conflict.
- **Khối "Policy đang áp dụng" trên Device Detail** (`/devices/:id`) → giữ
  nguyên tĩnh-rỗng, thuộc F9 (`docs/backlog.md` dòng 30). F8 không thêm
  route/API/component nào cho Device Detail.
- **Un-retire Device** — mặc định không làm (`CLAUDE.md` §4). Device
  `retired` vẫn bất biến về group/policy trong F8: không gán/gỡ Policy trực
  tiếp cho Device `retired` (kế thừa đúng invariant F3/F6).
- **Màn hình quản lý Organization** (PRD: "Không cần").
- **Bulk-add-theo-filter cho membership**, **role nội bộ org**, **audit
  log**, **versioning Policy configuration** — không có trong PRD, không tự
  bịa.

## §4. Main flow

**A. Gán Policy cho Group (async, group có thể tới 10.000 device):**
1. Từ Group Detail (`/groups/:id`), tab "Policies", bấm "+ Gán policy" → mở
   modal `AsyncSearchSelect` chỉ hiển thị Policy `status = active` của org
   mình (search theo tên, debounce, không load hết list).
2. Chọn 1 Policy → bấm "Gán" → FE gọi
   `POST /api/v1/groups/:id/policy_assignments { policy_id }`.
3. BE: validate org-scope (group + policy cùng org qua
   `current_organization.groups`/`.policies`, sai org → 404 trước khi chạm
   business rule) → validate `policy.active?` (không, → 422) → validate
   Group không "mồ côi" (tồn tại) → **enqueue** Solid Queue job, tạo bản ghi
   `policy_assignment_job` với `status: pending`, `total_count` = số device
   hiện có trong group lúc enqueue → trả về ngay job info (không chờ xử lý
   xong).
4. FE đóng modal, hiện `AsyncJobBanner` sticky: "Đang gán policy '<tên>'
   cho N thiết bị...".
5. Job chạy nền: `status → running`, `upsert_all` theo batch trên unique
   index `(policy_id, group_id)` (1 dòng duy nhất cho cặp Policy↔Group ở
   Phương án A — xem OQ-2, không phải 1 dòng/device), cập nhật
   `processed_count`/tiến độ nếu thiết kế có (xem `/design`).
6. FE poll `GET /api/v1/policy_assignment_jobs/:id` mỗi ~2s, cập nhật banner
   theo trạng thái (`pending`/`running`/`done`/`failed` — tên chuẩn, xem
   OQ-1) cho tới khi kết thúc (`done`/`failed`), banner tự ẩn sau vài giây
   nếu `done`, giữ + nút "Xem chi tiết"/"Thử lại" nếu `failed`.
7. Nếu user rời trang rồi quay lại khi job còn `pending`/`running`: FE gọi
   `GET /api/v1/groups/:id/policy_assignment_jobs?status=pending,running`
   để re-attach banner, không mất trạng thái theo dõi.

**B. Gán Policy trực tiếp cho 1 Device (đồng bộ, bounded):**
1. Từ Policy Detail (`/policies/:id`), tab "Đang gán cho Device", bấm
   "+ Gán thêm cho Device" (chỉ hiện nếu `policy.active?`, disable +
   tooltip nếu `inactive` — xem §6) → mở modal `AsyncSearchSelect` tìm
   Device theo identifier/name (chỉ Device của org mình, không giới hạn
   thêm — kể cả Device `retired` **xuất hiện trong kết quả tìm** nhưng bị
   chặn ở bước xác nhận vì rule "retired bất biến", xem A-item).
2. Chọn Device → xác nhận → `POST /api/v1/policies/:id/device_assignments
   { device_id }`.
3. BE validate org-scope (policy + device cùng org) → `policy.active?` →
   `device` không `retired` → `upsert_all` **1 dòng** (nhanh, không cần
   job) → `201`/`200` ngay trong request.
4. FE toast "Đã gán policy cho device", tab Device refresh.

**C. Gỡ Policy khỏi Group / gỡ gán trực tiếp khỏi Device (đồng bộ cả hai):**
1. Từ tab Policies (Group Detail) hoặc tab Group/Device (Policy Detail),
   bấm "x"/"Gỡ" trên 1 dòng → `ConfirmModal`.
2. Xác nhận → `DELETE .../policy_assignments/:policy_id` (phía Group) hoặc
   `DELETE .../device_assignments/:device_id` (phía Policy→Device) — **1
   dòng DB duy nhất bị xóa ở cả hai trường hợp** (Phương án A: gỡ khỏi
   Group không phụ thuộc số device đang thuộc group, vì không có fan-out
   để dọn — xem OQ-2/OQ-8), chạy đồng bộ trong request, không cần job.
3. Toast "Đã gỡ policy" + refresh danh sách tương ứng.

**D. Xem Policy Detail (2 tab):**
1. Từ Policy List, click 1 dòng hoặc mở menu ⋯ → "Xem chi tiết" → điều
   hướng `/policies/:id`.
2. FE gọi `GET /api/v1/policies/:id` (header: name/type/status/
   configuration) song song với `GET /api/v1/policies/:id/group_assignments`
   (tab Group, mặc định active) — tab Device chỉ fetch khi user click sang
   (lazy load, tránh 3 request không cần thiết cùng lúc).
3. Mỗi tab tự loading/empty/error riêng (1 tab lỗi không kéo sập tab khác
   hay cả trang — cùng pattern F4 đã chốt cho 3 khối Device Detail).

**E. Xem cột "Số nơi đang gán" ở Policy List:**
1. `GET /api/v1/policies` trả thêm `assignments_count` mỗi policy (tính ở
   API bằng aggregate query, không N+1 — xem §10).
2. FE render cột này trong `DataTable`, không tự đếm ở FE.

**F. Cảnh báo khi deactivate 1 Policy đang được gán (F7 OQ-9 carry-over):**
1. User mở `PolicyFormModal` (sửa) hoặc bấm toggle nhanh trên Policy đang
   `active` → chuyển `status` sang `inactive`.
2. FE đã có `assignments_count` từ list (hoặc gọi lại `GET
   /api/v1/policies/:id` nếu vào từ Detail) → nếu `> 0`, hiện confirm:
   "Policy đang được gán cho N group/device. Chuyển sang inactive sẽ khiến
   các nơi này không còn được tính là policy đang áp dụng, nhưng liên kết
   gán vẫn được giữ nguyên — nếu kích hoạt lại, các nơi này có hiệu lực trở
   lại ngay." (nội dung chính xác chốt ở `/design frontend`, xem OQ-6 để
   biết hành vi backend tương ứng).
3. Xác nhận → `PATCH /api/v1/policies/:id { status: inactive }` — **không**
   xóa/gỡ bất kỳ `policy_assignment` nào (xem §6, OQ-6) → `200`.

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- **Gán lại Policy đã gán cho đúng Group đó** (idempotency ở UI): FE hiện
  cảnh báo trước "Policy này đã được gán cho group. Gán lại sẽ không tạo
  trùng." dựa trên danh sách đã có ở tab Policies (không cần endpoint mới),
  BE vẫn cho enqueue (job mới hoặc trả job cũ — xem OQ-5), `upsert_all`
  đảm bảo không nhân đôi dòng.
- **Search Policy trong modal gán** chỉ trả `status = active` — Policy
  `inactive` không xuất hiện trong kết quả tìm (chặn ngay từ UI, không chỉ
  disable sau khi chọn).
- **Search Group/Device trong modal gán** không giới hạn theo trạng thái
  (Group nào cũng chọn được; Device `retired` **có thể xuất hiện** trong
  kết quả tìm khi gán trực tiếp, nhưng bị chặn ở bước xác nhận/submit — lý
  do: ẩn hẳn khỏi kết quả tìm sẽ khiến reviewer tưởng hệ thống thiếu Device,
  chặn rõ ràng ở bước sau minh bạch hơn).

### 5.2 Edge case
- A1. Gán Policy cho Group của **org khác** (đoán `group_id`) → **404**,
  không phải 403 (`CLAUDE.md` §4).
- A2. Gán Policy **của org khác** cho Group org mình (đoán `policy_id`) →
  **404** trên chính field `policy_id` (org-scope qua
  `current_organization.policies`, policy không tồn tại trong scope đó).
- A3. Gán Policy trực tiếp cho Device của **org khác** (đoán `device_id`)
  → **404**.
- A4. Gán Policy **của org khác** cho Device org mình → **404** (giống A2,
  áp cho nhánh Device).
- A5. Gán Policy **`inactive`** cho Group → **422**, message rõ ràng ("Chỉ
  gán được Policy đang active."), không enqueue job.
- A6. Gán Policy **`inactive`** trực tiếp cho Device → **422**, cùng
  message A5.
- A7. Gán Policy trực tiếp cho Device **đang `retired`** → **422**
  (`RETIRED_GROUP_MESSAGE`-style, kế thừa đúng pattern F6 A8/A9/A27 —
  "Device retired bất biến" áp dụng cho cả gán policy, không chỉ group).
- A8. Gán Policy cho Group mà Group đó chứa **cả Device `retired` lẫn
  Device active** → **cho phép, job chạy bình thường trên toàn Group**
  (rule "retired bất biến" chỉ áp dụng ở **gán trực tiếp cho 1 Device cụ
  thể**; ở Phương án A, gán cho Group là 1 dòng Policy↔Group, không đụng
  trực tiếp tới Device nào cả — F9 mới là nơi quyết định policy từ group có
  áp dụng lên 1 Device `retired` cụ thể hay không, không phải F8 — ghi rõ
  ranh giới này trong `DESIGN.md`).
- A9. Gỡ Policy khỏi Group mà Group đó không thực sự đang gán Policy đó
  (`DELETE` trên cặp chưa từng tồn tại) → **404** (không có gì để gỡ), hoặc
  **204 idempotent** nếu SoT chọn coi gỡ-cái-không-tồn-tại là no-op thành
  công (xem OQ-4).
- A10. Enqueue job gán Policy cho Group **rồi Group bị xóa** trước khi job
  chạy xong → job phát hiện Group không còn tồn tại, chuyển `status:
  failed` với lý do rõ ràng ("Group đã bị xóa"), **không** crash worker,
  **không** để job treo mãi ở `running`.
- A11. Enqueue job gán Policy cho Group **rồi Policy bị chuyển
  `inactive`** trong lúc job đang `running`/`pending` → job **vẫn hoàn
  thành** theo trạng thái Policy lúc **enqueue** (không kiểm tra lại giữa
  chừng — nhất quán với việc F8 không tự gỡ assignment khi deactivate, xem
  OQ-6), kết quả cuối là 1 dòng `policy_assignment` cho cặp đó dù Policy đã
  `inactive` — không sai vì F9 sẽ tự lọc theo `status: active` **tại thời
  điểm tính**, không tại thời điểm gán.
- A12. **Race condition**: 2 request gán cùng `(policy_id, group_id)` gần
  như đồng thời → cả 2 job (nếu không dedupe theo OQ-5) đều `upsert_all`
  an toàn vào cùng 1 dòng, không tạo 2 dòng trùng nhờ unique index; nếu có
  dedupe (OQ-5) → request thứ 2 nhận lại chính `job_id` của request thứ
  nhất.
- A13. **Chạy lại job đã `done` cho đúng `(policy_id, group_id)`** (user
  bấm "Gán" lại) → tạo/chạy job mới, `upsert_all` **không nhân đôi** dòng
  đã có (idempotent, `CLAUDE.md` §4).
- A14. Job **thất bại một phần** (vd lỗi giữa batch thứ N/M) → `status:
  failed`, giữ lại `processed_count` đã xử lý thành công (những dòng đã
  `upsert_all` không bị rollback lùi — idempotent nên chạy lại an toàn),
  banner hiện "thất bại một phần: x/N" + nút "Thử lại" (xem OQ-9 cho cơ chế
  retry).
- A15. Poll `GET /api/v1/policy_assignment_jobs/:id` với job thuộc **org
  khác** → **404**.
- A16. Poll job **id không tồn tại** → **404**.
- A17. `GET /api/v1/groups/:id/policy_assignment_jobs` gọi khi Group **không
  có job nào đang chạy** → **200, mảng rỗng** (FE không hiện banner nào,
  không lỗi).
- A18. Xóa 1 Group đang **có Policy được gán** (`policy_assignments` tồn
  tại cho group đó) → transaction xóa cả `group_memberships` **và**
  `policy_assignments` liên quan tới group, không để mồ côi
  (`has_many :policy_assignments, dependent: :delete_all` bổ sung vào
  `Group`, nghĩa vụ đã được model hiện tại "ghi nợ" sẵn trong comment) —
  Device và Policy **không** bị xóa.
- A19. Xóa Group đang có **job pending/running** cho group đó → job kết
  thúc theo A10 (`failed`, lý do "Group đã bị xóa"), không phụ thuộc thứ tự
  xóa `group_memberships`/`policy_assignments` trước hay sau.
- A20. Deactivate 1 Policy đang **không** được gán ở đâu (`assignments_count
  == 0`) → **không** hiện cảnh báo (N=0, chuyển thẳng, giống hành vi F7 đã
  có).
- A21. Deactivate 1 Policy đang được gán → cảnh báo đúng N (xem §4-F,
  OQ-6) → xác nhận → `200`, **không** gỡ assignment.
- A22. Activate lại 1 Policy `inactive` đang có `policy_assignments` cũ (từ
  trước khi deactivate) → `200`, các assignment cũ **tự động có hiệu lực
  trở lại** khi F9 tính resolution lần kế tiếp (không cần F8 làm gì thêm —
  hệ quả tự nhiên của "hàm thuần của state hiện tại", `CLAUDE.md` §4).
- A23. Policy List — cột "Số nơi đang gán" hiện đúng tổng Group + Device
  trực tiếp, **không tính trùng** nếu 1 Device vừa được gán trực tiếp vừa
  thuộc 1 Group cũng được gán policy đó (2 dòng riêng biệt, đếm là 2, không
  gộp — vì đây là "số **nơi** đang gán", không phải "số Device chịu ảnh
  hưởng", 2 khái niệm khác nhau và F8 chỉ cần cái đầu).
- A24. Policy Detail — tab Group/Device rỗng (chưa gán ở đâu) → EmptyState
  riêng từng tab ("Chưa gán cho Group nào."/"Chưa gán trực tiếp cho Device
  nào.").
- A25. Policy Detail của Policy **`inactive`** → cả 2 nút "Gán thêm" đều
  **disable** kèm tooltip "Policy không active, không thể gán." — vẫn xem
  được danh sách đã gán từ trước (chỉ chặn gán **mới**, không ẩn dữ liệu
  cũ).
- A26. Gọi thẳng API gán Policy `inactive` (bypass UI, disable ở FE không
  đủ) → **422** ở BE — double-check bắt buộc (`CLAUDE.md` §4: "validate ở
  service layer, không chỉ ở UI").
- A27. `:id` sai định dạng ở bất kỳ endpoint mới nào (`policies/:id`,
  `policy_assignment_jobs/:id`, `.../device_assignments/:device_id`...) →
  **404**, không phải 500 (tái dùng `rescue_from
  ActiveRecord::RecordNotFound` toàn cục).
- A28. Menu ⋯ ở Policy List **bật lại** action "Xem chi tiết" (F7 A29 đã
  chặn vì chưa có trang — giờ F8 làm rồi, phải mở, không được để nút chết ở
  chiều ngược lại).
- A29. Không token / hết hạn ở bất kỳ endpoint mới nào → **401**.
- A30. FE không gửi `organization_id` ở bất kỳ request nào trong toàn bộ
  luồng gán/gỡ/poll job (kế thừa nguyên tắc F0–F7).
- A31. RBAC — không phân role: mọi user `active` của org gán/gỡ được, kể
  cả gỡ Policy do **user khác trong org** gán trước đó (không có khái niệm
  "chỉ người gán mới được gỡ" — PRD không nhắc quyền chi tiết).
- A32. `GET /api/v1/policies` (list) khi **chưa có `policy_assignments`
  nào cho org** → `assignments_count: 0` cho mọi policy (không lỗi, không
  N/A).

## §6. Business rule & validation

- **Org-scope tuyệt đối ở cả 2 phía** (`CLAUDE.md` §4): mọi endpoint gán/gỡ
  lấy **cả Policy và Group/Device đích** qua
  `current_organization.<assoc>`. Input hợp lệ: cả 2 resource cùng org với
  token. Input bị chặn: 1 trong 2 (hoặc cả 2) thuộc org khác/không tồn tại
  → **404** trên field tương ứng, không 403 (A1–A4).
- **Không gán Policy `inactive`** (`PRD.md`, `CLAUDE.md` §4): input hợp lệ:
  Policy `status == active` tại thời điểm gán. Input bị chặn: `inactive` →
  422, validate ở **service layer** (không chỉ disable UI) — test riêng
  bằng cách gọi thẳng API (A5, A6, A26).
- **Device `retired` bất biến khi gán trực tiếp** (`CLAUDE.md` §4, kế thừa
  F3/F6): input hợp lệ: Device `status != retired`. Input bị chặn: Device
  `retired` → 422 (A7). **Không** áp dụng rule này lên "gán cho Group chứa
  device retired" (A8) — quyết định phạm vi: rule chỉ chặn hành động ghi
  trực tiếp lên 1 Device, không chặn hành động ghi lên Group (F9 xử lý việc
  policy từ group có áp dụng lên device retired hay không, ngoài phạm vi
  F8).
- **Idempotent, không gán trùng vô hạn** (`PRD.md`, `CLAUDE.md` §4): input
  hợp lệ: gán lại 1 cặp đã tồn tại → không tạo dòng mới, `upsert_all` trên
  unique index composite (A12, A13). Bảo vệ 2 lớp: validate ở service +
  unique index ở DB để chặn race.
- **Group lớn không xử lý đồng bộ trong request** (`PRD.md`,
  `CLAUDE.md` §4): gán Policy cho Group → luôn qua Solid Queue job, API trả
  `job_id` ngay, **không** block request tới khi xử lý hết device. Gỡ
  Policy khỏi Group **không** thuộc rule này (xem OQ-8 — Phương án A làm
  cho việc gỡ là 1 dòng, không tỉ lệ với số device).
- **Gán trực tiếp cho 1 Device xử lý đồng bộ** (xem OQ-7): vì bounded (1
  device/request), không cần job — input hợp lệ trả `200`/`201` ngay
  trong request, không có trạng thái `pending`/`running` cho nhánh này.
- **Deactivate Policy không tự gỡ assignment** (F7 OQ-9, xem OQ-6): input
  hợp lệ: chuyển `active → inactive` khi đang có `policy_assignments` →
  vẫn `200`, `policy_assignments` giữ nguyên. Lý do: `CLAUDE.md` §4 quy
  định F9 lọc theo `status: active` **tại thời điểm tính**, nên giữ nguyên
  assignment của Policy `inactive` không gây sai — chỉ đơn giản là F9 sẽ bỏ
  qua nó cho tới khi active lại. Input **cần cảnh báo** (không phải chặn):
  FE hiện confirm với N chính xác trước khi cho submit (§4-F).
- **Xóa Group dọn sạch `policy_assignments` liên quan** (`CLAUDE.md` §4 —
  "xóa Group không để dữ liệu treo"): transaction xóa
  `group_memberships` **và** `policy_assignments` của group đó, dùng
  `dependent: :delete_all` tường minh trên `Group`, không dựa FK cascade
  ngầm (A18). Device và Policy không bị ảnh hưởng.
- **RBAC không phân role nội bộ org** (kế thừa F0–F7): mọi user `active`
  của org gán/gỡ/xem được assignment của org mình (A31).
- **Không liên quan tới F8** (ghi ra để khỏi nhầm là thiếu): công thức hợp
  nhất + conflict resolution (`CLAUDE.md` §4 đoạn "Policy đang áp dụng trên
  Device") không phát sinh ở F8 — F8 chỉ ghi dữ liệu gán, không tính toán
  gì trên dữ liệu đó.

## §7. UI state
Theo `UI_UX_design.md` §6.2, §6.3 (đầy đủ), §7.1, §7.2, §9 — chỉ liệt kê
điểm phải khớp business rule ở §6:
- **Job async — 4 trạng thái** (`UI_UX_design.md` §6.3, tên chuẩn theo
  OQ-1): banner sticky đổi nội dung/màu theo `pending` ("Đang chờ xử
  lý..."), `running` (progress nếu có `processed/total`, else spinner),
  `done` (xanh, tự ẩn sau vài giây, nút "Đóng"), `failed` (đỏ, không tự ẩn,
  nút "Xem chi tiết"/"Thử lại"). Re-attach khi load lại trang Group Detail
  nếu còn job `pending`/`running` (A17).
- **Modal gán Policy cho Group**: chỉ hiện Policy `active` trong kết quả
  search (5.1); cảnh báo idempotent nếu Policy đã gán cho group đó (5.1).
- **Modal gán Policy trực tiếp cho Device**: disable hoàn toàn (không mở
  được modal) nếu Policy đang `inactive`, tooltip "Policy không active,
  không thể gán." (A25); Device `retired` xuất hiện trong kết quả tìm
  nhưng bị chặn kèm message rõ khi chọn/submit (5.1, A7).
- **Policy List**: cột "Số nơi đang gán" hiện `assignments_count` (A23);
  menu ⋯ mở lại action "Xem chi tiết" (A28); confirm deactivate hiện N thật
  khi `N > 0`, không hiện gì khi `N = 0` (A20, A21).
- **Policy Detail**: 2 tab load/error độc lập (§4-D); mỗi tab EmptyState
  riêng (A24); nút "Gán thêm" ở cả 2 tab disable khi Policy `inactive`
  (A25).
- **Group Detail — tab Policies**: list Policy đang gán + `AsyncJobBanner`
  khi có job đang chạy cho group này; nút gỡ có `ConfirmModal`.
- **Error** hạ tầng (500/network) ở bất kỳ khối mới nào: `ErrorState` +
  "Thử lại", không kéo sập trang/tab khác.
- **Không `console.error` sót lại, không nút chết** (bật lại "Xem chi
  tiết" đúng lúc có trang thật — A28; không thêm nút nào ở Device Detail).

## §8. Data & API touchpoint
*(dự kiến — chốt chính thức ở `/design F8-db` + `/design F8-api`, xem
OQ-2/OQ-3 cho 2 hướng thiết kế bảng chưa chốt)*
- Bảng mới `policy_assignments` (Phương án A khuyến nghị — xem OQ-2):
  `id`, `organization_id`, `policy_id` (FK), `assignable_type` (`"Group"` |
  `"Device"`), `assignable_id`, timestamps. Unique index composite
  `(policy_id, assignable_type, assignable_id)` — tương đương 2 unique
  index tách riêng `(policy_id, group_id)`/`(policy_id, device_id)` nếu
  chọn 2 FK riêng thay vì polymorphic (chi tiết chốt ở `/design`).
- Bảng mới theo dõi job (tên/field dự kiến — xem OQ-3): `id`,
  `organization_id`, `policy_id`, `group_id`, `status` (enum
  `pending/running/done/failed`, xem OQ-1), `total_count`,
  `processed_count`, `error_message`, timestamps. Index
  `[group_id, status]` (phục vụ re-attach A17), `[organization_id]`.
- Quan hệ: `Policy has_many :policy_assignments, dependent: :restrict...`
  (không hard-delete Policy nên chưa cần `dependent:` xóa — F7 OQ-2 đã
  chốt); `Group has_many :policy_assignments, dependent: :delete_all`
  (nghĩa vụ đã "ghi nợ" trong `Group` model hiện tại); `Device has_many
  :policy_assignments` (không cần `dependent:` vì PRD không có xóa Device).
- Endpoint dự kiến (đầy đủ ở §3, tóm lại):
  - `GET/POST /api/v1/groups/:id/policy_assignments`,
    `DELETE /api/v1/groups/:id/policy_assignments/:policy_id`.
  - `GET/POST /api/v1/policies/:id/device_assignments`,
    `DELETE /api/v1/policies/:id/device_assignments/:device_id`.
  - `GET /api/v1/policies/:id/group_assignments`.
  - `GET /api/v1/policy_assignment_jobs/:id`,
    `GET /api/v1/groups/:id/policy_assignment_jobs`.
  - `GET /api/v1/policies/:id` (mới), `GET /api/v1/policies` (+
    `assignments_count`).
- Policy Pundit: mở rộng `PolicyPolicy` (`show?` cho detail),
  `GroupPolicy` (action tab Policies), policy mới cho assignment/job
  resource (org-scope là chính).
- FE mới: route `/policies/:id`, `views/policies/PolicyDetailView.vue`,
  `components/AsyncJobBanner.vue`, `components/AsyncSearchSelect.vue` (nếu
  chưa build ở F6 — xác nhận lại khi bắt đầu `/design`), `stores/jobs.ts`,
  `api/policyAssignments.ts`, `types/policyAssignment.ts`,
  `types/policyAssignmentJob.ts`.
- FE sửa: `PolicyListView.vue` (cột mới, cảnh báo thật, menu ⋯), router
  (thêm route detail), `GroupDetailView.vue` (tab Policies thật).

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), `status == active`, mới gọi
  được mọi endpoint mới của F8; thiếu/sai token → 401 (A29).
- Không phân role nội bộ org (nhất quán F0–F7): mọi user active của org
  gán/gỡ/xem assignment và job của org mình, kể cả gỡ assignment do người
  khác trong org tạo (A31).
- Org-scope check bắt buộc ở **cả 2 phía** của mọi action gán/gỡ (Policy
  **và** Group/Device đích), cả ở job/poll endpoint — không bao giờ
  `Model.find(params[:id])` trần (`CLAUDE.md` §4). Sai org bất kỳ phía nào
  → 404 (A1–A4, A15).
- Test bắt buộc riêng: org A không gán được Policy của mình cho Group/
  Device của org B (và ngược lại), không đọc được job của org khác.

## §10. Non-functional (performance/scale)
- **Group tới 10.000 device** (`PRD.md`): gán Policy cho Group **không xử
  lý đồng bộ trong request** — enqueue Solid Queue job, `upsert_all` theo
  batch (kích thước batch cụ thể chốt ở `/design`, không chốt số ở SoT —
  xem OQ-10). Phương án A (khuyến nghị, OQ-2) giúp việc này rẻ tuyệt đối:
  gán cho Group luôn là **1 dòng ghi** (`policy_id` + `group_id`), không
  tỉ lệ với số device trong group — hoàn toàn khác với việc F6 phải
  `upsert_all` N dòng `group_memberships` khi thêm N device. Bulk-write chỉ
  còn cần thiết nếu chọn Phương án B (fan-out).
- **Gỡ Policy khỏi Group** — với Phương án A, cũng là 1 dòng `DELETE`,
  không phụ thuộc kích thước group (xem OQ-8) — không cần job.
- **`assignments_count` trên Policy List** — phải tính bằng **aggregate
  query** (đếm gộp theo `policy_id`, ví dụ `GROUP BY policy_id` hoặc
  subquery/`COUNT` trên bảng `policy_assignments`), **không** N+1 (không
  gọi `policy.policy_assignments.count` riêng cho mỗi dòng trong loop khi
  render 1 trang danh sách — chốt kỹ thuật cụ thể ở `/design api`).
- **Job re-attach** (`GET .../policy_assignment_jobs?status=...`) — index
  `[group_id, status]` để tránh scan toàn bảng job khi 1 group có lịch sử
  nhiều job.
- **Idempotent tuyệt đối** (`CLAUDE.md` §4): chạy lại job (retry) hoặc bấm
  gán lại nhiều lần không tạo dòng trùng, nhờ unique index + `upsert_all` —
  đây là yêu cầu chấm điểm quan trọng ("kết quả đúng ... không gán trùng vô
  hạn nếu thao tác lại").
- **Solid Queue chưa cấu hình** (xem §1) — rủi ro hạ tầng cần xử lý trước
  khi có job thật chạy được cả ở dev/test (test suite RSpec cần adapter
  test phù hợp, ví dụ `:test`/inline cho spec không phải chờ worker thật).

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Gán Policy cho Group nhỏ chạy async và hoàn thành thành công
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Group "Sales Laptops" với 3 device
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán Policy "Security Baseline" cho Group "Sales Laptops"
  Then tôi nhận về job với status "pending"
  And sau khi job xử lý xong, job có status "done"
  And Group "Sales Laptops" đang gán Policy "Security Baseline"

Scenario: Gán Policy cho Group của org khác trả về 404
  Given Organization "Globex Corp." có Group "Globex Devices" với id 42
  And Organization "Acme Inc." có Policy "Security Baseline" đang active
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "POST /api/v1/groups/42/policy_assignments" với policy_id của "Security Baseline"
  Then tôi nhận về "404"

Scenario: Gán Policy của org khác cho Group org mình trả về 404
  Given Organization "Globex Corp." có Policy "Globex Lockdown" với id 99
  And Organization "Acme Inc." có Group "Sales Laptops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "POST /api/v1/groups/:id/policy_assignments" với policy_id 99 cho Group "Sales Laptops"
  Then tôi nhận về "404"

Scenario: Gán trực tiếp Policy của org khác cho Device org mình trả về 404
  Given Organization "Globex Corp." có Policy "Globex Lockdown" với id 99
  And Organization "Acme Inc." có Device "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "POST /api/v1/policies/99/device_assignments" với device_id của "IPHONE-001"
  Then tôi nhận về "404"

Scenario: Gán trực tiếp Policy cho Device của org khác trả về 404
  Given Organization "Globex Corp." có Device "IPHONE-999" với id 55
  And Organization "Acme Inc." có Policy "Security Baseline" đang active
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "POST /api/v1/policies/:id/device_assignments" với device_id 55 cho Policy "Security Baseline"
  Then tôi nhận về "404"

Scenario: Gán Policy inactive cho Group bị chặn
  Given Organization "Acme Inc." có Policy "Old WiFi" đang inactive
  And Organization "Acme Inc." có Group "Sales Laptops"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán Policy "Old WiFi" cho Group "Sales Laptops"
  Then tôi nhận về "422"

Scenario: Gán Policy inactive trực tiếp cho Device bị chặn
  Given Organization "Acme Inc." có Policy "Old WiFi" đang inactive
  And Organization "Acme Inc." có Device "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán trực tiếp Policy "Old WiFi" cho Device "IPHONE-001"
  Then tôi nhận về "422"

Scenario: Gán trực tiếp Policy cho Device đang retired bị chặn
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Device "IPHONE-001" đang retired
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán trực tiếp Policy "Security Baseline" cho Device "IPHONE-001"
  Then tôi nhận về "422"

Scenario: Gán Policy cho Group chứa device retired vẫn thành công
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Group "Mixed Group" chứa 1 device active và 1 device retired
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán Policy "Security Baseline" cho Group "Mixed Group"
  Then job hoàn thành với status "done"
  And Group "Mixed Group" đang gán Policy "Security Baseline"

Scenario: Gán lại Policy đã gán cho cùng Group không tạo trùng
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Group "Sales Laptops" đã được gán Policy "Security Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán lại Policy "Security Baseline" cho Group "Sales Laptops"
  Then job hoàn thành với status "done"
  And Group "Sales Laptops" chỉ có đúng 1 liên kết với Policy "Security Baseline"

Scenario: Chạy lại việc gán Policy cho Group nhiều lần không nhân đôi liên kết
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Group "Sales Laptops" với 50 device
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gán Policy "Security Baseline" cho Group "Sales Laptops" 3 lần liên tiếp
  Then Group "Sales Laptops" chỉ có đúng 1 liên kết với Policy "Security Baseline"

Scenario: Job gán Policy cho Group bị xóa giữa lúc đang chạy chuyển sang failed
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Organization "Acme Inc." có Group "Sales Laptops"
  And một job gán Policy "Security Baseline" cho Group "Sales Laptops" đang "pending"
  When Group "Sales Laptops" bị xóa trước khi job xử lý
  Then job chuyển sang status "failed"

Scenario: Poll job của org khác trả về 404
  Given Organization "Globex Corp." có 1 job gán policy với id 7
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policy_assignment_jobs/7"
  Then tôi nhận về "404"

Scenario: Poll job không tồn tại trả về 404
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policy_assignment_jobs/999999"
  Then tôi nhận về "404"

Scenario: Xem lại job đang chạy khi quay lại trang Group Detail
  Given Organization "Acme Inc." có Group "Sales Laptops"
  And một job gán policy cho Group "Sales Laptops" đang ở status "running"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Group "Sales Laptops"
  Then tôi thấy banner theo dõi job đang "running"

Scenario: Group không có job nào đang chạy không hiện banner
  Given Organization "Acme Inc." có Group "Sales Laptops" không có job nào đang chạy
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Group "Sales Laptops"
  Then tôi không thấy banner theo dõi job nào

Scenario: Xóa Group đang có Policy gán không để dữ liệu treo
  Given Organization "Acme Inc." có Group "Sales Laptops" đang được gán Policy "Security Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi xóa Group "Sales Laptops"
  Then Group "Sales Laptops" không còn tồn tại
  And không còn liên kết policy_assignment nào tham chiếu tới Group "Sales Laptops"
  And Policy "Security Baseline" vẫn còn tồn tại

Scenario: Gỡ Policy khỏi Group thành công
  Given Organization "Acme Inc." có Group "Sales Laptops" đang được gán Policy "Security Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gỡ Policy "Security Baseline" khỏi Group "Sales Laptops"
  Then tôi nhận về thành công
  And Group "Sales Laptops" không còn gán Policy "Security Baseline"

Scenario: Gỡ Policy trực tiếp khỏi Device thành công
  Given Organization "Acme Inc." có Device "IPHONE-001" đang được gán trực tiếp Policy "Security Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gỡ Policy "Security Baseline" khỏi Device "IPHONE-001"
  Then tôi nhận về thành công
  And Device "IPHONE-001" không còn được gán trực tiếp Policy "Security Baseline"

Scenario: Deactivate Policy không đang được gán không cảnh báo
  Given Organization "Acme Inc." có Policy "Unused Policy" đang active và chưa gán ở đâu
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi chuyển Policy "Unused Policy" sang inactive
  Then tôi nhận về "200"

Scenario: Deactivate Policy đang được gán vẫn thành công và không tự gỡ liên kết
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Policy "Security Baseline" đang được gán cho Group "Sales Laptops" và Device "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi chuyển Policy "Security Baseline" sang inactive
  Then tôi nhận về "200"
  And Group "Sales Laptops" vẫn còn liên kết policy_assignment với Policy "Security Baseline"
  And Device "IPHONE-001" vẫn còn liên kết policy_assignment với Policy "Security Baseline"

Scenario: Activate lại Policy sau khi deactivate giữ nguyên các liên kết cũ
  Given Organization "Acme Inc." có Policy "Security Baseline" đang inactive
  And Policy "Security Baseline" đang được gán cho Group "Sales Laptops" từ trước khi deactivate
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi chuyển Policy "Security Baseline" sang active
  Then tôi nhận về "200"
  And Group "Sales Laptops" vẫn còn liên kết policy_assignment với Policy "Security Baseline"

Scenario: Cột Số nơi đang gán hiện đúng tổng Group và Device trực tiếp
  Given Organization "Acme Inc." có Policy "Security Baseline"
  And Policy "Security Baseline" đang được gán cho 2 Group và 3 Device trực tiếp
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi thấy Policy "Security Baseline" có "Số nơi đang gán" bằng 5

Scenario: Policy chưa gán ở đâu hiện Số nơi đang gán bằng 0
  Given Organization "Acme Inc." có Policy "Unused Policy" chưa gán ở đâu
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi thấy Policy "Unused Policy" có "Số nơi đang gán" bằng 0

Scenario: Xem Policy Detail với 2 tab Group và Device
  Given Organization "Acme Inc." có Policy "Security Baseline" đang gán cho Group "Sales Laptops" và Device "IPHONE-001"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Policy "Security Baseline"
  Then tôi thấy tab "Đang gán cho Group" có Group "Sales Laptops"
  And tôi thấy tab "Đang gán cho Device" có Device "IPHONE-001"

Scenario: Policy Detail của org khác trả về 404
  Given Organization "Globex Corp." có Policy "Globex Lockdown" với id 42
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies/42"
  Then tôi nhận về "404"

Scenario: Policy Detail rỗng khi chưa gán ở đâu
  Given Organization "Acme Inc." có Policy "Unused Policy" chưa gán ở đâu
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Policy "Unused Policy"
  Then tôi thấy tab "Đang gán cho Group" hiện "Chưa gán cho Group nào."
  And tôi thấy tab "Đang gán cho Device" hiện "Chưa gán trực tiếp cho Device nào."

Scenario: Nút gán thêm bị disable khi Policy đang inactive
  Given Organization "Acme Inc." có Policy "Old WiFi" đang inactive
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Policy "Old WiFi"
  Then nút "Gán thêm cho Group" bị disable
  And nút "Gán thêm cho Device" bị disable

Scenario: Menu hành động của Policy List có action Xem chi tiết
  Given Organization "Acme Inc." có Policy "Security Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở menu hành động của Policy "Security Baseline"
  Then tôi thấy hành động "Xem chi tiết"

Scenario: Không có token bị từ chối ở endpoint gán policy cho group
  When tôi gọi "POST /api/v1/groups/1/policy_assignments" không kèm token
  Then tôi nhận về "401"

Scenario: Không có token bị từ chối ở endpoint gán trực tiếp cho device
  When tôi gọi "POST /api/v1/policies/1/device_assignments" không kèm token
  Then tôi nhận về "401"

Scenario: RBAC — user khác trong cùng org vẫn gỡ được policy do người khác gán
  Given Organization "Acme Inc." có Group "Sales Laptops" được User "alice@acme.test" gán Policy "Security Baseline"
  And tôi là User "bob@acme.test" active thuộc Organization "Acme Inc."
  When tôi gỡ Policy "Security Baseline" khỏi Group "Sales Laptops"
  Then tôi nhận về thành công
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | **Tên chuẩn của 4 trạng thái job** — 3 nguồn tài liệu dùng 3 tên khác nhau cho cùng khái niệm: `docs/backlog.md` mục F8 viết `"running/done/failed"` (thiếu trạng thái khởi tạo); `CLAUDE.md` §4 viết `"pending/running/done/failed"`; `UI_UX_design.md` §6.3/§9 viết `"queued/running/completed/failed"`. Đây không phải mâu thuẫn SoT-vs-UI_UX_design đơn thuần (mục cần dừng lại theo `CLAUDE.md` §5) mà là mâu thuẫn giữa 3 nguồn — không tự chọn âm thầm. | Dùng đúng 4 giá trị của **`CLAUDE.md` §4** làm tên field/enum bắt buộc ở DB/API: **`pending / running / done / failed`** — vì `CLAUDE.md` là tài liệu điều hành cấp cao nhất của repo này (§1: "Tài liệu điều hành cho Claude Code"), và là bộ 4 giá trị đầy đủ nhất (backlog thiếu `pending`). `UI_UX_design.md` dùng `queued/completed` chỉ là **mô tả UX minh họa** (label hiển thị), không phải tên field/enum bắt buộc — FE map hiển thị tiếng Việt hoặc label riêng ("Đang chờ xử lý...", "Đã gán policy cho N thiết bị.") từ giá trị enum thật `pending/running/done/failed`, không đổi tên field theo UI_UX_design.md. Nếu chọn dùng tên khác (vd theo backlog hoặc UI_UX_design.md nguyên văn): phải sửa lại cả 2 tài liệu nguồn còn lại để nhất quán trong `DESIGN.md`, và sửa mọi scenario `(pending OQ-1)` ở §11. | **Chốt theo khuyến nghị.** Enum DB/API: `pending/running/done/failed`. `UI_UX_design.md` §6.3/§9 (`queued/completed`) chỉ là label UX minh họa, không đổi field — ghi rõ trong `DESIGN.md` khi implement (mâu thuẫn 3 nguồn đã xử lý tường minh, không âm thầm chọn). |
| OQ-2 | **Shape DB của `policy_assignments`** — câu `CLAUDE.md` §4 "`upsert_all` trên unique index `(policy_id, group_id)` / `(policy_id, device_id)` (mỗi device một dòng `policy_assignments` với `source: group/direct`)" đọc được theo 2 cách khác nhau. **Phương án A — assignment-level (không denormalize)**: 2 loại dòng độc lập — dòng `(policy_id, group_id)` cho gán Group, dòng `(policy_id, device_id)` cho gán trực tiếp Device. "Policy đang áp dụng trên 1 device" là kết quả **join tại thời điểm đọc** (qua `group_memberships`) — việc của F9. **Phương án B — device-level (fan-out)**: gán Policy cho 1 Group tạo ra **N dòng** `(policy_id, device_id, source: "group", source_group_id)` (N = số device trong group lúc gán) để F9 đọc thẳng theo `device_id` không cần join. | **Phương án A.** Lý do: (a) tách rời rõ ràng F8 (gán) và F9 (resolution), đúng ranh giới `docs/backlog.md`; (b) tránh vấn đề đồng bộ lại khi group membership thay đổi — F6 đã chốt (OQ-1) **không cần biết gì về policy**, chọn B sẽ buộc F6 phải biết cả `policy_assignments` để fan-out/thu hồi mỗi khi thêm/gỡ device khỏi group, tăng coupling ngược F6↔F8 và có nguy cơ dữ liệu "lệch" nếu quên đồng bộ; (c) `CLAUDE.md` §4 yêu cầu resolution là "hàm thuần của state hiện tại" — join-at-read-time thỏa mãn tự nhiên, fan-out phải tự đảm bảo bằng tay (dễ vỡ). Chi phí: F9 phải join qua `group_memberships`, nhưng bảng đó đã có index `(group_id, device_id)` từ F6 và số group 1 device thuộc thường nhỏ — chấp nhận được. Lợi ích phụ: gán/gỡ Policy cho Group ở Phương án A luôn là **1 dòng ghi/xóa**, không tỉ lệ với số device trong group (xem §10) — rẻ hơn Phương án B ở chính use-case "group lớn" mà PRD nhấn mạnh. Đây là khuyến nghị cho `/design F8-db` xác nhận, không phải chốt cứng ở SoT. | **Chốt theo khuyến nghị.** Phương án A (assignment-level, join-at-read-time). |
| OQ-3 | Có cần 1 bảng **riêng** theo dõi trạng thái job (`policy_assignment_jobs`) hay tận dụng bảng nội bộ của Solid Queue (`solid_queue_jobs`)? | **Có, bảng riêng.** Bảng nội bộ của Solid Queue là chi tiết triển khai của queue backend (schema/API có thể đổi giữa các phiên bản gem, không thiết kế để expose qua REST API công khai theo hợp đồng ổn định `pending/running/done/failed`). 1 bảng nghiệp vụ riêng (`policy_assignment_jobs` hoặc tên tương đương) cho phép API poll ổn định, không phá vỡ nếu đổi queue backend sau này, và lưu được field nghiệp vụ (`total_count`/`processed_count`/`group_id`/`policy_id`) mà Solid Queue không có khái niệm tương đương. | **Chốt theo khuyến nghị.** Bảng nghiệp vụ riêng `policy_assignment_jobs`. |
| OQ-4 | `DELETE` gỡ Policy khỏi Group/Device khi liên kết đó **không tồn tại** (đã gỡ từ trước, hoặc chưa từng gán) → trả 404 (chuẩn REST, coi là "resource không tồn tại") hay 204 idempotent (coi gỡ-cái-không-có là no-op thành công)? | **404** — nhất quán với cách F6 xử lý `DELETE devices/:device_id` khi device không thuộc group (không có tiền lệ trả 204 cho "xóa cái không có" trong repo này), và giữ tín hiệu rõ ràng cho FE biết state đã đổi so với UI đang hiển thị (vd 2 tab mở đồng thời, 1 tab gỡ trước). Nếu chọn 204: sửa A9 và scenario liên quan, đảm bảo nhất quán với mọi `DELETE` khác trong dự án (rủi ro: khác hành vi F5 `DELETE /groups/:id` vốn luôn tồn tại resource trước khi xóa nên chưa có tiền lệ trực tiếp). | **Chốt theo khuyến nghị.** 404 khi liên kết không tồn tại. |
| OQ-5 | Gán Policy cho Group khi đã có 1 job **`pending`/`running`** cho đúng cặp `(policy_id, group_id)` — tạo job mới (chạy song song, cả 2 đều `upsert_all` an toàn nhờ idempotent) hay trả lại `job_id` của job đang chạy (dedupe ở tầng tạo job)? | **Dedupe — trả lại job hiện có.** Tạo job trùng lặp không sai về kết quả cuối (idempotent) nhưng lãng phí (2 job cùng quét lại toàn bộ group), và có thể gây hiểu nhầm ở FE (2 banner cho cùng 1 việc nếu mở 2 tab). Nếu chọn cho phép song song: đơn giản hơn khi implement (không cần query "job đang chạy cho cặp này"), nhưng phải đảm bảo FE không tự nhân đôi banner. | **Chốt theo khuyến nghị.** Dedupe, trả lại `job_id` của job `pending`/`running` hiện có cho cùng cặp. |
| OQ-6 | Hành vi cụ thể khi deactivate 1 Policy đang được gán (nghĩa vụ carry-over từ F7 OQ-9: "giữ gán nhưng ngưng hiệu lực" hay "gỡ gán")? | **Giữ gán nhưng ngưng hiệu lực** (không tự xóa `policy_assignments` khi deactivate). Lý do: `CLAUDE.md` §4 quy định F9 lọc theo `status: active` **tại thời điểm tính** — nghĩa là giữ nguyên assignment của Policy `inactive` không gây kết quả sai, F9 tự bỏ qua nó; ngược lại nếu **tự gỡ** khi deactivate thì khi activate lại, toàn bộ liên kết cũ mất sạch, buộc user phải gán lại từ đầu (bad UX, đặc biệt với Group 10.000 device — phải chạy lại job async chỉ vì lỡ tay deactivate rồi activate lại). Nếu chọn "gỡ gán": cần thêm logic dọn `policy_assignments` trong transaction cùng lúc `PATCH status: inactive`, và với Group lớn phải quyết định gỡ đồng bộ hay cũng cần job riêng — phình phạm vi đáng kể. | **Chốt theo khuyến nghị.** Giữ gán, ngưng hiệu lực — không tự gỡ `policy_assignments` khi deactivate. |
| OQ-7 | Gán Policy trực tiếp cho **1 Device** — xử lý đồng bộ (như đã viết ở §4-B/§6) hay cũng qua Solid Queue job giống Group? | **Đồng bộ.** PRD chỉ bắt buộc async job cho trường hợp "Group có thể rất lớn" — gán trực tiếp luôn bounded ở 1 device/request, không có rủi ro "UI treo/hệ thống sập" mà PRD lo ngại. Bắt job cho use-case này là phình phạm vi không cần thiết và tạo UX chậm hơn (phải đợi poll) cho 1 thao tác vốn tức thời. | **Chốt theo khuyến nghị.** Đồng bộ, không qua job. |
| OQ-8 | Gỡ Policy khỏi Group (`DELETE .../groups/:id/policy_assignments/:policy_id`) — đồng bộ hay cũng cần job như gán? | **Đồng bộ** — chỉ đúng nếu chọn **Phương án A** ở OQ-2 (gỡ = xóa 1 dòng `(policy_id, group_id)`, không phụ thuộc số device trong group). Nếu OQ-2 chọn Phương án B (fan-out), câu trả lời phải đổi thành "cần job" (xóa N dòng theo device) — 2 quyết định này **phải nhất quán với nhau**, không chốt OQ-8 độc lập với OQ-2. | **Chốt theo khuyến nghị.** Đồng bộ (nhất quán với OQ-2 = Phương án A). |
| OQ-9 | Cơ chế **retry** khi job `failed` (một phần hoặc toàn phần) — nút "Thử lại" ở FE gọi lại từ đầu (re-enqueue toàn bộ group) hay resume từ điểm dừng (`processed_count`)? | **Re-enqueue toàn bộ từ đầu.** `upsert_all` là idempotent nên xử lý lại các dòng đã thành công chỉ là no-op rẻ (ghi lại giá trị giống nhau), đơn giản hơn nhiều so với việc theo dõi chính xác "đã xử lý tới đâu" để resume đúng — đặc biệt khi nguồn gây `failed` có thể là lỗi tạm thời (DB timeout) không liên quan gì tới vị trí đã xử lý. Nếu chọn resume: cần lưu offset/cursor tin cậy và xử lý đúng trường hợp danh sách device trong group đã đổi giữa lần chạy đầu và lần retry. | **Chốt theo khuyến nghị.** Re-enqueue toàn bộ từ đầu. |
| OQ-10 | Kích thước **batch** khi `upsert_all` cho Group 10.000 device — chốt số cụ thể ở đâu? | **Không chốt số ở SoT** — đây là chi tiết kỹ thuật thuần (không ảnh hưởng nghiệp vụ/kết quả cuối, chỉ ảnh hưởng thời gian chạy/độ dài transaction), để `/design F8-db`/`/design F8-api` quyết định dựa trên benchmark thực tế (gợi ý khởi điểm: 500–2.000 dòng/batch, tương tự cap 500 device/request đã dùng ở F6). | **Chốt theo khuyến nghị.** Không chốt số ở SoT, để `/design` quyết theo benchmark. |
| OQ-11 | **Điểm vào (entry point)** cho "gán Policy trực tiếp cho Device" — chỉ từ Policy Detail (`UI_UX_design.md` §7.2, tab Device), hay cũng cần thêm nút ở Device Detail (`UI_UX_design.md` §5 liệt kê "Gán policy trực tiếp" là 1 trong các nút bị disable khi device retired, ngụ ý nút này tồn tại ở Device Detail nhưng §5 không mô tả layout/hành vi chi tiết của nó)? | **Chỉ từ Policy Detail.** `docs/backlog.md` mục F8 ghi rõ trang PRD liên quan là "Policies (gán), Groups (chi tiết)" — **không có** "Device detail" trong danh sách, và `docs/sot/F4-device-detail.md` đã chốt layout/route Device Detail không đổi trừ lý do kỹ thuật rõ ràng. F8 **không thêm gì vào Device Detail**. Câu chữ ở `UI_UX_design.md` §5 ("ẩn/disable nút ... Gán policy trực tiếp") được coi là mô tả **hướng tới tương lai** (khi F9 hoặc 1 feature sau vẽ lại khối "Policy đang áp dụng" có thể thêm entry point ngược từ đó), không phải nghĩa vụ của F8 — ghi rõ như 1 rủi ro/giả định, không tự thêm route mới ở Device Detail. | **Chốt theo khuyến nghị.** Chỉ entry point từ Policy Detail; không thêm gì ở Device Detail. |
| OQ-12 | `assignable_type`/2-FK — nếu chọn Phương án A (OQ-2), dùng **polymorphic** (`assignable_type` + `assignable_id`) hay **2 cột FK riêng** (`group_id` nullable + `device_id` nullable, đúng 1 trong 2 luôn có giá trị)? | **2 cột FK riêng** (không polymorphic) — cho phép 2 unique index tách biệt và rõ ràng đúng như câu chữ `CLAUDE.md` §4 ("`(policy_id, group_id)` / `(policy_id, device_id)`"), tránh phức tạp không cần thiết của polymorphic association (mất FK constraint thật ở DB, khó thêm CHECK constraint "đúng 1 trong 2 cột có giá trị"). Đây là chi tiết DB thuần, chốt chính thức ở `/design F8-db`. | **Chốt theo khuyến nghị.** 2 cột FK riêng (`group_id`/`device_id` nullable), không polymorphic. |

**Rủi ro/giả định:**
- **Mâu thuẫn 3 nguồn về tên trạng thái job (OQ-1)** — đã dừng lại và nêu rõ
  theo đúng tinh thần `CLAUDE.md` §5 (dù đây là mâu thuẫn giữa 3 tài liệu,
  không chỉ SoT-vs-`UI_UX_design.md`), chưa tự chọn. Ảnh hưởng trực tiếp
  tới tên field/enum ở DB + API + FE store — phải chốt **trước** khi bắt
  đầu `/design F8-db`, vì đổi tên enum sau khi đã code sẽ tốn công sửa
  nhiều lớp.
- **2 phương án shape DB (OQ-2)** ảnh hưởng trực tiếp tới OQ-8 (gỡ Policy
  khỏi Group đồng bộ hay cần job) và tới độ phức tạp coupling F6↔F8 — phải
  chốt cùng lúc với OQ-8, không tách rời.
- **Solid Queue chưa được cài đặt trong repo** (xem §1) — rủi ro tiến độ
  thực tế (không phải rủi ro nghiệp vụ) cần xử lý ngay khi bắt đầu
  `/design`/`/plan F8`, không phải giả định "đã có sẵn" như cách
  `CLAUDE.md` §1 nói về stack.
- Giả định **không có role nội bộ Organization** (nhất quán F0–F7).
- `policy_assignments` không có cột `status` riêng (khác `status` của
  chính `Policy`) — 1 dòng assignment chỉ biểu diễn "liên kết đang tồn
  tại", không tự mang trạng thái hiệu lực (hiệu lực suy ra từ
  `policy.status` tại thời điểm F9 tính, đúng OQ-6). Nếu `/design` phát
  hiện cần cột `status` riêng cho assignment (vd để hỗ trợ "tạm ngưng 1
  assignment cụ thể mà không đổi status của cả Policy"), đó là mở rộng
  ngoài phạm vi PRD hiện tại — không tự thêm khi chưa có yêu cầu.

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật, bỏ tag, rồi mới set `status: approved` ở đầu file.

**Đã approve (2026-09-17, qua Claude Code, theo ủy quyền của user):** toàn bộ
12 OQ chốt theo phương án khuyến nghị (bảng trên); mọi tag `(pending OQ-n)` ở
§11 đã được rà lại và gỡ bỏ (nội dung scenario giữ nguyên vì đã viết đúng theo
phương án khuyến nghị từ đầu); 2 mâu thuẫn đa-nguồn (OQ-1 tên trạng thái job,
OQ-2 shape DB `policy_assignments`) đã được giải quyết tường minh thay vì bỏ
trống, đúng yêu cầu `CLAUDE.md` §5. `status` ở đầu file đã set `approved`.
Cho phép tiến hành `/design F8` (DB → API → Frontend, mỗi bản cần approve
trước khi sang bước sau) → `/plan F8` → implement theo TDD/3-gate
(`CLAUDE.md` §3).
