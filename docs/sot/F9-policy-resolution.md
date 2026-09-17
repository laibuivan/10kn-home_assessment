---
feature_id: F9
title: Policy resolution engine (policy đang áp dụng trên Device, xử lý conflict cùng type)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (approved by Claude on behalf of user, explicit delegation 2026-09-17)
date: 2026-09-17
---

## §1. Meta
- Feature: `F9` — Policy resolution engine: tính "Policy đang áp dụng" trên 1
  Device = hợp của (policy gán trực tiếp) ∪ (policy của mọi Group đang thuộc),
  lọc `status: active` **tại thời điểm tính**, xử lý conflict cùng `type` với
  kết quả xác định (deterministic), và cập nhật khối "Policy đang áp dụng" ở
  Device Detail (`/devices/:id`) từ trạng thái tĩnh-rỗng sang dữ liệu/logic
  thật.
- Dependency (theo `docs/backlog.md`): `F8` (Policy assignment — approved,
  bảng `policy_assignments` đã tồn tại với đúng 2 cột FK riêng `group_id`/
  `device_id` nullable, CHECK constraint "đúng 1 trong 2 luôn có giá trị",
  unique partial index `(policy_id, group_id)` và `(policy_id, device_id)` —
  xem `api/db/schema.rb` — Phương án A "assignment-level, join-at-read-time"
  đã chốt sẵn chính vì F9 sẽ join tại thời điểm đọc, không denormalize).
  `F6` (Group membership — bảng `group_memberships`, index
  `(group_id, device_id)` unique + index riêng `device_id`). `F4` (Device
  detail — route/layout `/devices/:id` đã chốt, khối "Policy đang áp dụng"
  **cố tình để tĩnh-rỗng**, chờ F9).
  - **Ghi chú carry-over quan trọng nhất từ `docs/sot/F4-device-detail.md`
    §12 "Rủi ro/giả định"**: F4 đã ghi rõ *"cả 3 khối cùng đến từ 1 response
    duy nhất (`GET /api/v1/devices/:id`) nên loading/error được gộp chung...
    F9 (khi thêm tính toán resolution thật, có thể chậm với group 10k
    device) sẽ là lúc tách khối 'Policy đang áp dụng' ra 1 API/loading riêng
    đúng như mockup"* — F9 kế thừa đúng chỉ dẫn này (xem OQ-2, §8).
  - **Ranh giới quan trọng với F8** (đọc kỹ, tránh làm trùng việc): F8 đã
    làm xong toàn bộ phần **ghi** (`POST/DELETE .../policy_assignments`,
    `.../device_assignments`, job async cho Group lớn). F9 **chỉ đọc**
    (`policy_assignments`, `group_memberships`, `policies`) để **tính toán**
    — không thêm/sửa bất kỳ endpoint ghi nào của F8, không đổi schema các
    bảng đó. F9 cũng không phải nơi thêm entry point ghi mới ở Device Detail
    (xem OQ-6, kế thừa `docs/sot/F8-policy-assignment.md` OQ-11).
  - **3 giả định của F8 mà F9 phải xác nhận đúng bằng test thật** (F8 đã
    triển khai theo các giả định này, coi F9 là nơi "trả nợ" chứng minh):
    1. `docs/sot/F8-policy-assignment.md` A11: Policy bị deactivate **trong
       lúc job đang chạy** vẫn tạo ra 1 dòng `policy_assignment`, "không sai
       vì F9 sẽ tự lọc theo `status: active` tại thời điểm tính, không tại
       thời điểm gán" — F9 phải lọc đúng như vậy (xem R1/A10).
    2. A22 (F8): activate lại 1 Policy `inactive` có `policy_assignments` cũ
       → "tự động có hiệu lực trở lại khi F9 tính resolution lần kế tiếp
       (không cần F8 làm gì thêm)" — F9 phải chứng minh đúng bằng test
       (xem A11 của SoT này).
    3. A18 (F8): xóa Group xóa sạch `policy_assignments` liên quan trong
       transaction — F9 phải chứng minh policy từ group đó biến mất khỏi
       resolution của mọi device từng thuộc group đó ngay sau khi xóa (xem
       A12 của SoT này).
- Nguồn: `PRD.md` §"Nghiệp vụ" → "Policy" (đoạn *"Policy thực áp dụng trên
  Device: Device có thể nhận policy từ các Group nó đang thuộc và từ gán
  trực tiếp. Màn hình chi tiết Device phải hiện policy đang áp dụng. Nếu
  cùng type mà configuration khác nhau, xử lý cho ra kết quả xác định và
  giải thích trong tài liệu thiết kế."*) + §"Cách chấm" (dòng "thiết kế chịu
  được group lớn và conflict policy"); `docs/backlog.md` mục F9 + dòng
  "F8 → F9 (F9 cũng cập nhật lại khối 'Policy đang áp dụng' ở panel của
  F4)"; `CLAUDE.md` §4 toàn bộ đoạn "Policy đang áp dụng trên Device" (công
  thức hợp, 3 bước conflict resolution, yêu cầu "hàm thuần của state hiện
  tại"), §3 rule 4 (nêu đích danh "policy-resolution..." là ví dụ pure logic
  bắt buộc TDD ở `api/app/services/`); `UI_UX_design.md` §5 (toàn bộ khối
  "Policy đang áp dụng" — layout bảng, badge nguồn, banner conflict, popover
  "Xem tất cả nguồn"); `docs/sot/F4-device-detail.md` §12 "Rủi ro/giả định"
  (nghĩa vụ tách API/loading riêng); `docs/sot/F8-policy-assignment.md` A11,
  A18, A22, §6 (giữ gán khi deactivate), OQ-11 (không thêm entry point gán ở
  Device Detail).

## §2. Summary / User story
Là một user `active` thuộc một Organization, khi tôi mở trang chi tiết một
Device, tôi muốn thấy **chính xác** danh sách Policy đang thực sự áp dụng
lên thiết bị đó (hợp nhất từ mọi Group thiết bị đang thuộc và từ gán trực
tiếp, chỉ tính Policy còn `active`), và nếu có Policy cùng `type` nhưng
`configuration` khác nhau đang tranh nhau áp dụng, tôi muốn biết hệ thống đã
chọn Policy nào thắng và **vì sao** (không bị âm thầm chọn 1 cái ngẫu
nhiên) — để tôi tin tưởng được vào trạng thái bảo mật/cấu hình thực tế của
thiết bị, kể cả khi thiết bị thuộc nhiều Group lớn.

## §3. Scope

**Trong phạm vi:**
- **Service** (`api/app/services/`, pure logic, TDD bắt buộc theo
  `CLAUDE.md` §3 rule 4): 1 service tính "policy đang áp dụng" cho 1 Device
  — input: 1 Device (đã org-scope); output: danh sách kết quả theo từng
  `type` (policy thắng + nguồn + có conflict hay không) và danh sách đầy đủ
  ứng viên (kể cả bị loại) kèm lý do loại, phục vụ "Xem tất cả nguồn". Hàm
  thuần túy đọc DB tại thời điểm gọi, không cache, không side-effect, gọi
  lại nhiều lần với state không đổi phải ra **cùng** kết quả.
- **API**: 1 endpoint mới đọc-only trả kết quả resolution cho 1 Device (xem
  OQ-2 cho việc đây là endpoint riêng hay field mở rộng của
  `GET /api/v1/devices/:id`) — org-scope qua `policy_scope(Device)`, không
  bao giờ `Device.find` trần.
- **FE**: thay khối "Policy đang áp dụng" ở `DeviceDetailView.vue` từ
  empty-tĩnh (F4) sang: bảng Name/Type/Nguồn/Trạng thái theo
  `UI_UX_design.md` §5, banner vàng khi có conflict thật, link/popover "Xem
  tất cả nguồn" liệt kê toàn bộ ứng viên cùng `type` kèm lý do bị loại,
  loading/error/empty riêng cho khối này (không kéo theo Header/Groups).
- **Test**: request spec cho endpoint mới (org isolation, 401, 404), service
  spec thuần (TDD, đủ các nhánh conflict ở §6), 1-2 request spec chứng minh
  lại 3 giả định carry-over từ F8 (A10/A11/A12 ở §5.2).

**Ngoài phạm vi** (khớp `docs/backlog.md` — không tự thêm):
- **Mọi hành động ghi** (gán/gỡ Policy cho Group/Device, tạo/xóa job) —
  toàn bộ thuộc F8, đã xong, F9 không đụng.
- **Entry point gán Policy trực tiếp mới ở Device Detail** (dù
  `UI_UX_design.md` §5 gợi ý nút "Gán policy trực tiếp" bị disable khi
  retired, ngụ ý nút này tồn tại) — `docs/sot/F8-policy-assignment.md`
  OQ-11 đã chủ động không làm và để ngỏ cho "F9 hoặc 1 feature sau"; SoT này
  quyết định **không** làm trong F9 (xem OQ-6) vì `docs/backlog.md` mô tả
  F9 chỉ là "policy resolution engine" + "cập nhật lại khối hiển thị", không
  nhắc thêm hành động ghi mới. Nếu người duyệt muốn thêm, đây là mở rộng
  phạm vi cần quyết định tường minh khi approve.
- **Cache/materialize kết quả resolution** (ví dụ bảng `device_policy_cache`
  hay cột denormalize) — không cần thiết ở quy mô này (xem §10), và vi phạm
  tinh thần "hàm thuần của state hiện tại" nếu cache không được invalidate
  đúng ở mọi nơi ghi (F8) — không tự thêm khi PRD không yêu cầu.
- **Đổi bất kỳ hành vi ghi nào của F8** (vd tự động gỡ `policy_assignment`
  khi Policy deactivate) — F8 đã chốt "giữ gán, ngưng hiệu lực" (F8 OQ-6),
  F9 chỉ là nơi hệ quả đó thể hiện ra khi tính toán, không phải nơi đổi lại
  quyết định đó.
- **Un-retire Device**, **màn hình quản lý Organization** — như mọi SoT
  trước, mặc định không làm (`CLAUDE.md` §4, `docs/backlog.md`).

## §4. Main flow

1. User mở Device Detail (`/devices/:id`). Header + khối "Groups đang
   thuộc" load như F4/F6 hiện tại (không đổi — vẫn qua
   `GET /api/v1/devices/:id`).
2. Song song, FE gọi endpoint resolution mới cho khối "Policy đang áp dụng"
   (loading skeleton riêng cho khối này — xem OQ-2).
3. BE: tìm Device qua `policy_scope(Device).find(params[:id])` (404 nếu
   không tồn tại/thuộc org khác, trước khi chạm business logic) → authorize
   → gọi service resolution.
4. Service:
   a. Lấy tập ứng viên = (mọi `PolicyAssignment` có `device_id = device.id`)
      ∪ (mọi `PolicyAssignment` có `group_id` thuộc tập group hiện tại của
      device, qua `group_memberships`) — join `Policy` để lấy `type`,
      `configuration`, `status`, `updated_at`.
   b. Nhóm ứng viên theo `type`.
   c. Với mỗi nhóm: lọc còn lại ứng viên có `policy.status == active`. Nếu
      rỗng sau lọc → `type` đó không xuất hiện trong kết quả (A9).
   d. Nếu còn ≥1 ứng viên active: chọn **policy thắng** theo thứ tự ưu
      tiên cố định (`CLAUDE.md` §4, R2–R4 ở §6): trực tiếp trên Device
      thắng qua Group → giữa các Group, `policy.updated_at` mới nhất thắng
      → hòa thì `policy.id` nhỏ hơn thắng. Áp dụng thứ tự này để **luôn**
      ra đúng 1 policy thắng cho 1 `type`, kể cả khi các ứng viên
      `configuration` giống hệt nhau (xem OQ-1).
   e. Đánh dấu `type` đó "có conflict" khi tồn tại ≥2 ứng viên **active**
      với `configuration` khác nhau (so sánh nội dung, không phải khác
      `id`) — đây là tín hiệu hiện banner cảnh báo, độc lập với việc hệ
      thống đã tự resolve xong hay chưa.
5. Trả về JSON: danh sách theo `type` (policy thắng, nguồn, cờ conflict) +
   danh sách đầy đủ ứng viên mỗi `type` (kể cả bị loại/`inactive`) kèm lý do
   loại, phục vụ "Xem tất cả nguồn" (xem §8 — chốt shape ở `/design`).
6. FE render bảng theo `UI_UX_design.md` §5: mỗi dòng = 1 `type` với policy
   thắng, badge nguồn ("Trực tiếp" / "Từ group: <tên>"), cột "Trạng thái"
   (xem OQ-7). `type` có conflict → banner vàng đầu khối + dòng đó có chỉ
   báo mở "Xem tất cả nguồn". Không có ứng viên nào → EmptyState "Chưa có
   policy nào áp dụng."

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- Kết quả không phụ thuộc thứ tự query (`ORDER BY` bất kỳ ở tầng ứng viên
  không ảnh hưởng policy thắng — logic chọn thắng chạy trên toàn bộ tập ứng
  viên, không phải "ứng viên đầu tiên gặp").
- Popover "Xem tất cả nguồn" mở lazy khi user click (không load sẵn toàn bộ
  chi tiết ứng viên nếu response đã tách shape gọn/đầy đủ ở `/design`).

### 5.2 Edge case
- A1. Device không thuộc group nào, không có gán trực tiếp → `applied
  policies` rỗng, EmptyState "Chưa có policy nào áp dụng."
- A2. Chỉ có 1 Policy gán trực tiếp, `active`, không thuộc group nào → 1
  dòng kết quả, nguồn "Trực tiếp", không conflict.
- A3. Chỉ có 1 Policy gán qua 1 Group, `active` → 1 dòng, nguồn "Từ group:
  &lt;tên group&gt;".
- A4. Gán trực tiếp `type` A + gán qua group `type` B (khác `type`) → 2
  dòng riêng biệt, không conflict giữa chúng (khác `type` không cạnh
  tranh).
- A5. Gán trực tiếp + gán qua group **cùng `type`, cùng `configuration`**
  (2 bản ghi Policy khác `id`) → không phải conflict thật theo định nghĩa
  `CLAUDE.md` §4 ("configuration khác nhau"), **không** hiện banner; nhưng
  vẫn phải chọn đúng 1 dòng hiển thị — áp dụng cùng thứ tự ưu tiên (trực
  tiếp thắng) để chọn (xem OQ-1, R2 ở §6 áp dụng cho cả trường hợp này).
- A6. Gán qua 2 Group khác nhau, cùng `type`, `configuration` **khác
  nhau**, không có gán trực tiếp → dòng thắng = Policy có `updated_at` mới
  nhất (R3); banner conflict hiện; "Xem tất cả nguồn" liệt kê dòng thua với
  lý do "Ưu tiên thấp hơn (updated_at cũ hơn)".
- A7. Giống A6 nhưng `updated_at` của 2 Policy **bằng nhau tuyệt đối** →
  Policy `id` nhỏ hơn thắng (R4), tie-break xác định tuyệt đối, không phụ
  thuộc thứ tự trả về từ query.
- A8. Gán trực tiếp + gán qua ≥2 Group, cùng `type`, tồn tại ít nhất 1 cặp
  `configuration` khác nhau trong toàn bộ ứng viên → **trực tiếp luôn
  thắng** bất kể so sánh `updated_at` giữa các Group (R2 áp dụng trước R3);
  banner vẫn hiện vì có ≥2 `configuration` khác nhau trong tập ứng viên.
- A9. Toàn bộ ứng viên của 1 `type` đều `inactive` (không còn bản `active`
  nào) → `type` đó **không xuất hiện** trong bảng kết quả (R1, lọc theo
  `status: active` tại thời điểm tính — carry-over F8 A11).
- A10. 1 Policy đang được tính là "thắng" cho 1 `type` bị chuyển sang
  `inactive` (F8 giữ nguyên `policy_assignment`, không tự gỡ) → lần tính
  resolution **kế tiếp** tự động loại Policy đó khỏi kết quả `type` tương
  ứng, không cần thao tác thêm ở F9 (carry-over F8 A11, "hàm thuần của
  state hiện tại").
- A11. Policy `inactive` ở A10 sau đó được activate lại → tự động xuất hiện
  trở lại ở lần tính kế tiếp, không cần gán lại (carry-over F8 A22).
- A12. Group đang được gán 1 Policy bị xóa (F8 dọn `policy_assignments`
  trong transaction) → lần tính resolution sau cho mọi Device từng thuộc
  Group đó không còn tính Policy đó nữa (carry-over F8 A18), tự động, không
  cần F9 làm gì thêm.
- A13. Device thuộc 2 Group, **cả 2 Group đều gán cùng đúng 1 Policy** (cùng
  `policy_id`, không phải 2 bản ghi Policy khác nhau cùng `type`) → không
  phải "conflict cùng type" (chỉ có 1 bản ghi Policy tham gia) — bảng kết
  quả chỉ hiện **1 dòng** cho `type` đó, nguồn hiển thị theo tie-break xác
  định (xem OQ-3), "Xem tất cả nguồn" liệt kê đủ các Group đang đóng góp
  cùng Policy đó.
- A14. Device đang `retired` → khối "Policy đang áp dụng" vẫn hiển thị đúng
  kết quả resolution như Device `active` (không có ngoại lệ đọc-dữ-liệu
  cho `retired`) — chỉ các nút **hành động ghi** (nếu có, hiện không có ở
  F9 theo OQ-6) mới bị ẩn/disable theo layout đã chốt ở F4, không phải dữ
  liệu hiển thị.
- A15. Gọi endpoint resolution cho Device thuộc **org khác** (đoán id) →
  **404**, không phải 403 (`CLAUDE.md` §4).
- A16. Gọi endpoint resolution với `:id` không tồn tại hoặc sai định dạng →
  **404** (rescue toàn cục `ActiveRecord::RecordNotFound`).
- A17. Không có token / token hết hạn khi gọi endpoint resolution → **401**.
- A18. Gọi lại endpoint resolution nhiều lần liên tiếp khi state DB không
  đổi → luôn ra **đúng cùng một kết quả** (`CLAUDE.md` §4 "hàm thuần của
  state hiện tại") — test bằng cách gọi 2 lần liên tiếp, so sánh kết quả
  giống hệt (không có yếu tố ngẫu nhiên/thứ tự không xác định nào lọt vào
  service).
- A19. Cột "Số nơi đang gán" ở Policy List (F8) — không bị ảnh hưởng bởi
  F9, khác khái niệm với "đang áp dụng thực tế trên Device" (1 policy có
  thể "gán cho N nơi" nhưng "áp dụng" trên 1 Device cụ thể chỉ tính khi
  Device đó thực sự thuộc phạm vi gán và Policy còn active) — ghi chú để
  tránh nhầm lẫn, không cần test chéo 2 tính năng.
- A20. Khối "Policy đang áp dụng" gặp lỗi tải (500/network) → hiện
  `ErrorState` + "Thử lại" riêng cho khối này, **không** kéo sập khối
  Header/"Groups đang thuộc" hay cả trang (đúng pattern F4 đã chốt cho 3
  khối độc lập).

## §6. Business rule & validation
*(F9 chỉ đọc — không có hành động ghi mới, nên "Input bị chặn" ở đây mang
nghĩa "trường hợp bị loại khỏi kết quả tính toán", không phải lỗi validate
422 như các feature trước.)*

- **R1 — Công thức hợp nhất** (`CLAUDE.md` §4): Policy đang áp dụng trên 1
  Device = hợp của (policy gán trực tiếp cho Device) ∪ (policy gán cho mọi
  Group Device **đang** thuộc tại thời điểm tính), lọc còn `policy.status ==
  active` tại đúng thời điểm tính (không phải thời điểm gán — A9, A10,
  A11).
- **R2 — Ưu tiên 1: trực tiếp thắng group** (`CLAUDE.md` §4): khi cùng
  `type` mà `configuration` khác nhau (hoặc kể cả giống nhau, để chọn dòng
  hiển thị — xem OQ-1), ứng viên gán **trực tiếp** trên Device luôn thắng
  mọi ứng viên đến từ Group, không cần so sánh gì thêm (A8).
- **R3 — Ưu tiên 2: giữa nhiều Group, `updated_at` mới nhất thắng**
  (`CLAUDE.md` §4): chỉ áp dụng khi không có ứng viên trực tiếp nào tham
  gia `type` đó, và có ≥2 Group đóng góp Policy khác nhau cùng `type` (A6).
- **R4 — Tie-break cuối: `id` nhỏ hơn thắng** (`CLAUDE.md` §4): chỉ khi R3
  vẫn hòa (`updated_at` bằng nhau tuyệt đối) — tie-break xác định tuyệt
  đối, không phụ thuộc thứ tự query (A7).
- **R5 — Hàm thuần của state hiện tại** (`CLAUDE.md` §4): không cache kết
  quả giữa các lần gọi, không side-effect nào làm thay đổi kết quả lần gọi
  sau nếu state DB không đổi; gọi lại nhiều lần ra cùng kết quả (A18).
- **R6 — Không đổi dữ liệu ghi** (ranh giới F8/F9): service/API của F9
  tuyệt đối không tạo/sửa/xóa `policy_assignments`, `policy_assignment_jobs`
  hay bất kỳ bảng nào của F8 — chỉ đọc.
- **R7 — Org-scope tuyệt đối** (`CLAUDE.md` §4): Device được lấy qua
  `policy_scope(Device)`/`current_organization.devices`, không bao giờ
  `Device.find(params[:id])` trần; sai org → 404 (A15).
- **R8 — Conflict-banner độc lập với việc "đã resolve xong"**: hệ thống
  **luôn** tự resolve ra đúng 1 kết quả xác định (R2–R4 không bao giờ để
  hòa vô hạn), nhưng vẫn phải **hiện banner cảnh báo** khi có ≥2
  `configuration` khác nhau thật sự trong tập ứng viên active của 1 `type` —
  không được "im lặng chọn 1 cái mà không giải thích" (PRD, `UI_UX_design.md`
  §5).

## §7. UI state
Theo `UI_UX_design.md` §5 (khối "Policy đang áp dụng"):
- **Loading**: skeleton riêng cho khối này (không chờ chung với Header/
  Groups — xem OQ-2, `docs/sot/F4-device-detail.md` §12).
- **Empty**: không có ứng viên active nào ở bất kỳ `type` nào → text nhỏ
  "Chưa có policy nào áp dụng." (A1).
- **Error**: `ErrorState` + "Thử lại" riêng cho khối này, không kéo sập
  trang (A20).
- **Success — có kết quả, không conflict**: bảng Name | Type | Nguồn |
  Trạng thái, mỗi dòng 1 `type`, không banner.
- **Success — có conflict**: banner vàng đầu khối ("Đã tự động chọn policy
  ưu tiên cao hơn cho N loại đang xung đột." — nội dung chính xác chốt ở
  `/design frontend`) + dòng liên quan có chỉ báo mở "Xem tất cả nguồn".
- **Popover/accordion "Xem tất cả nguồn"**: liệt kê toàn bộ ứng viên cùng
  `type` (kể cả bị loại vì `inactive` hoặc thua tie-break), mỗi dòng có lý
  do loại rõ ràng (không để trống lý do) — xem OQ-4.
- **Retired device**: khối vẫn hiển thị dữ liệu bình thường (A14), không
  ẩn/làm mờ nội dung — chỉ khác ở việc F9 không thêm nút hành động ghi nào
  (OQ-6).

## §8. Data & API touchpoint
*(dự kiến — chốt chính thức ở `/design F9-db` + `/design F9-api`)*
- **Không thêm bảng/cột DB mới** — F9 chỉ đọc `policy_assignments`
  (`group_id`/`device_id`/`policy_id`), `group_memberships`
  (`group_id`/`device_id`), `policies` (`type`/`configuration`/`status`/
  `updated_at`/`id`), tất cả đã tồn tại từ F6/F7/F8.
- **Service mới** (`api/app/services/`, tên dự kiến
  `Devices::PolicyResolver` hoặc tương đương) — input 1 `Device`, output
  cấu trúc gồm: theo từng `type` → `{ policy: {id, name, type,
  configuration}, source: {kind: "direct"|"group", group: {id, name}|nil},
  conflict: boolean, candidates: [{policy_id, name, configuration, status,
  source, included: boolean, excluded_reason: string|nil}] }`. TDD bắt buộc
  (`CLAUDE.md` §3 rule 4) — viết spec thuần trước, đủ nhánh R2–R4 + A5–A13.
- **API endpoint mới** (xem OQ-2 cho vị trí chính xác — khuyến nghị endpoint
  riêng): `GET /api/v1/devices/:id/applied_policies` — org-scope qua
  `policy_scope(Device)`, trả cấu trúc từ service ở trên dưới dạng JSON.
- **Policy Pundit**: tái dùng `DevicePolicy#show?` hiện có (không phân role,
  chỉ org-scope) — không cần policy mới nếu endpoint được coi là 1 phần của
  "xem chi tiết Device".
- **FE mới/sửa**: `DeviceDetailView.vue` (thay khối tĩnh bằng fetch thật +
  bảng + banner + popover), `api/devices.ts` (hàm gọi endpoint mới),
  `types/appliedPolicy.ts` (type mới cho response), có thể tái dùng
  `EmptyState`/`ErrorState` đã có từ F2–F4.

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), `status == active`, gọi được
  endpoint resolution mới; thiếu/sai token → 401 (A17).
- Không phân role nội bộ org (kế thừa F0–F8): mọi user `active` của org xem
  được resolution của mọi Device thuộc org mình.
- Org-scope check bắt buộc: Device lấy qua `policy_scope(Device)`, sai org
  → 404, không 403 (A15, R7). Test riêng: org A không xem được resolution
  của Device thuộc org B qua id đoán được.

## §10. Non-functional (performance/scale)
- **Chi phí tính resolution cho 1 Device KHÔNG phụ thuộc kích thước Group**
  (khác hẳn F6/F8): 1 Device chỉ thuộc một số Group hữu hạn (do người quản
  trị gán thủ công, thực tế nhỏ — không phải 10.000), nên chi phí truy vấn
  tỉ lệ với **số Group Device đang thuộc** và **số Policy assignment liên
  quan tới các Group đó**, không tỉ lệ với **số Device khác** trong cùng
  Group. Group 10.000 device không làm chậm việc tính resolution cho 1
  Device cụ thể.
- **Index sẵn có đủ dùng** (không cần index mới): `group_memberships` có
  index `device_id` (F6) để tìm Group của Device; `policy_assignments` có
  index `device_id`, `group_id`, `(organization_id, policy_id)` (F8) để
  join theo cả 2 nhánh trực tiếp/group.
- **Không cache** (xem §3 "Ngoài phạm vi") — tính lại mỗi request, đơn giản
  và đảm bảo đúng "hàm thuần của state hiện tại" (R5) mà không cần cơ chế
  invalidate cache ở mọi nơi F8 ghi dữ liệu. Nếu sau này đo được cần cache
  (không kỳ vọng ở quy mô bài test), đó là cải tiến ngoài phạm vi hiện tại,
  ghi vào rủi ro production còn lại của `DESIGN.md`.
- **Tách endpoint/loading riêng** cho khối "Policy đang áp dụng" (OQ-2) —
  đúng tinh thần `UI_UX_design.md` §5 và ghi chú carry-over từ F4: khối này
  có chi phí tính toán khác hẳn khối info/groups (join + resolve logic),
  nên tách để 1 khối chậm không làm chậm cả trang.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Device không có policy nào áp dụng hiện empty state
  Given Organization "Acme Inc." có Device "IPHONE-001" không thuộc group nào và không được gán policy trực tiếp
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy khối "Policy đang áp dụng" hiện "Chưa có policy nào áp dụng."

Scenario: Device chỉ có 1 policy gán trực tiếp hiện đúng nguồn Trực tiếp
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active
  And Device "IPHONE-001" được gán trực tiếp Policy "Security Baseline"
  And Device "IPHONE-001" không thuộc group nào
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy 1 dòng Policy "Security Baseline" với nguồn "Trực tiếp"

Scenario: Device chỉ nhận policy qua Group hiện đúng nguồn Từ group
  Given Organization "Acme Inc." có Policy "Security Baseline" đang active được gán cho Group "Sales Laptops"
  And Device "IPHONE-001" thuộc Group "Sales Laptops" và không được gán trực tiếp policy nào
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy 1 dòng Policy "Security Baseline" với nguồn "Từ group: Sales Laptops"

Scenario: Hai policy khác type không xung đột
  Given Device "IPHONE-001" được gán trực tiếp Policy "Wifi Config" type "wifi"
  And Device "IPHONE-001" thuộc Group "Sales Laptops" đang được gán Policy "Password Rule" type "password"
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy 2 dòng riêng biệt cho type "wifi" và type "password"
  And tôi không thấy banner cảnh báo conflict

Scenario: Trực tiếp và group cùng type cùng configuration không tính là conflict thật
  Given Device "IPHONE-001" được gán trực tiếp Policy "Wifi A" type "wifi" configuration giống hệt Policy "Wifi B"
  And Device "IPHONE-001" thuộc Group "Sales Laptops" đang được gán Policy "Wifi B" type "wifi"
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy dòng type "wifi" hiện Policy "Wifi A" với nguồn "Trực tiếp"
  And tôi không thấy banner cảnh báo conflict

Scenario: Conflict cùng type giữa 2 group không có gán trực tiếp — updated_at mới nhất thắng
  Given Device "IPHONE-001" thuộc Group "Group A" đang được gán Policy "Wifi Old" type "wifi" cập nhật lúc 2026-01-01
  And Device "IPHONE-001" thuộc Group "Group B" đang được gán Policy "Wifi New" type "wifi" configuration khác Policy "Wifi Old" cập nhật lúc 2026-06-01
  And Device "IPHONE-001" không được gán trực tiếp policy type "wifi" nào
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy dòng type "wifi" hiện Policy "Wifi New" thắng
  And tôi thấy banner cảnh báo conflict

Scenario: Conflict hòa updated_at giữa 2 group — id nhỏ hơn thắng
  Given Device "IPHONE-001" thuộc Group "Group A" đang được gán Policy id nhỏ hơn "Wifi X" type "wifi" cập nhật cùng thời điểm với Policy "Wifi Y"
  And Device "IPHONE-001" thuộc Group "Group B" đang được gán Policy id lớn hơn "Wifi Y" type "wifi" configuration khác Policy "Wifi X"
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy dòng type "wifi" hiện Policy "Wifi X" thắng

Scenario: Trực tiếp luôn thắng dù group có updated_at mới hơn
  Given Device "IPHONE-001" được gán trực tiếp Policy "Wifi Direct" type "wifi" cập nhật lúc 2026-01-01
  And Device "IPHONE-001" thuộc Group "Sales Laptops" đang được gán Policy "Wifi Group" type "wifi" configuration khác Policy "Wifi Direct" cập nhật lúc 2026-06-01
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy dòng type "wifi" hiện Policy "Wifi Direct" thắng
  And tôi thấy banner cảnh báo conflict

Scenario: Type chỉ còn candidate inactive không xuất hiện trong kết quả
  Given Device "IPHONE-001" thuộc Group "Sales Laptops" đang được gán Policy "Old Wifi" type "wifi" đang inactive
  And Device "IPHONE-001" không có candidate active nào type "wifi"
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi không thấy dòng nào cho type "wifi"

Scenario: Deactivate policy đang thắng khiến nó biến mất khỏi resolution lần tính kế tiếp
  Given Device "IPHONE-001" được gán trực tiếp Policy "Security Baseline" đang active, hiện đang thắng type "wifi"
  When Policy "Security Baseline" chuyển sang inactive
  And tôi mở lại trang chi tiết Device "IPHONE-001"
  Then tôi không còn thấy Policy "Security Baseline" trong khối "Policy đang áp dụng"

Scenario: Activate lại policy làm nó xuất hiện trở lại không cần gán lại
  Given Device "IPHONE-001" từng được gán trực tiếp Policy "Security Baseline" trước khi Policy chuyển inactive
  And Policy "Security Baseline" đang inactive nhưng liên kết gán vẫn còn
  When Policy "Security Baseline" chuyển lại thành active
  And tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy Policy "Security Baseline" xuất hiện trở lại trong khối "Policy đang áp dụng"

Scenario: Xóa Group loại bỏ policy của group đó khỏi resolution của device từng thuộc group
  Given Device "IPHONE-001" thuộc Group "Sales Laptops" đang được gán Policy "Security Baseline"
  And Device "IPHONE-001" không được gán trực tiếp Policy "Security Baseline"
  When Group "Sales Laptops" bị xóa
  And tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi không còn thấy Policy "Security Baseline" trong khối "Policy đang áp dụng"

Scenario: Cùng 1 policy được gán qua 2 group không bị coi là conflict
  Given Device "IPHONE-001" thuộc Group "Group A" và Group "Group B"
  And cả Group "Group A" và Group "Group B" đều đang được gán đúng 1 Policy "Security Baseline"
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy đúng 1 dòng cho Policy "Security Baseline"
  And tôi không thấy banner cảnh báo conflict

Scenario: Device retired vẫn hiển thị đúng resolution
  Given Device "IPHONE-001" đang retired và được gán trực tiếp Policy "Security Baseline" từ trước khi retired
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi thấy Policy "Security Baseline" vẫn hiện trong khối "Policy đang áp dụng"

Scenario: Xem resolution của Device thuộc org khác trả về 404
  Given Organization "Globex Corp." có Device "GLOBEX-DEV" với id 77
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/devices/77/applied_policies"
  Then tôi nhận về "404"

Scenario: Xem resolution của Device không tồn tại trả về 404
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/devices/999999/applied_policies"
  Then tôi nhận về "404"

Scenario: Không có token bị từ chối khi xem resolution
  When tôi gọi "GET /api/v1/devices/1/applied_policies" không kèm token
  Then tôi nhận về "401"

Scenario: Gọi lại resolution nhiều lần cho cùng state ra cùng kết quả
  Given Device "IPHONE-001" đang có kết quả resolution xác định gồm nhiều type
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi gọi "GET /api/v1/devices/:id/applied_policies" 2 lần liên tiếp mà không có thay đổi dữ liệu nào ở giữa
  Then cả 2 lần gọi trả về kết quả giống hệt nhau

Scenario: Popover Xem tất cả nguồn liệt kê đầy đủ ứng viên kèm lý do loại
  Given Device "IPHONE-001" có conflict type "wifi" giữa Policy "Wifi New" (thắng) và Policy "Wifi Old" (thua) và Policy "Wifi Inactive" đang inactive
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở "Xem tất cả nguồn" cho type "wifi" ở trang chi tiết Device "IPHONE-001"
  Then tôi thấy Policy "Wifi New" được đánh dấu là policy đang áp dụng
  And tôi thấy Policy "Wifi Old" kèm lý do "Ưu tiên thấp hơn"
  And tôi thấy Policy "Wifi Inactive" kèm lý do "Policy đang inactive, không được tính hiệu lực"

Scenario: Lỗi tải khối Policy đang áp dụng không kéo sập trang
  Given API "GET /api/v1/devices/:id/applied_policies" trả về lỗi hạ tầng 500
  And tôi là user active thuộc Organization của Device "IPHONE-001"
  When tôi mở trang chi tiết Device "IPHONE-001"
  Then tôi vẫn thấy khối Header và "Groups đang thuộc" hiển thị bình thường
  And khối "Policy đang áp dụng" hiện trạng thái lỗi kèm nút "Thử lại"
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | `CLAUDE.md` §4 định nghĩa "conflict" là "cùng `type`, `configuration` khác nhau". Khi 2+ ứng viên cùng `type` nhưng `configuration` **giống hệt nhau** (2 bản ghi Policy khác `id`), đây không phải conflict thật — nhưng bảng kết quả chỉ hiện 1 dòng/`type` nên vẫn cần chọn 1 policy để hiển thị. Áp dụng đúng thứ tự ưu tiên R2–R4 cho cả trường hợp không-conflict-thật này, hay dùng luật khác (vd ưu tiên theo tên A-Z)? | Áp dụng **đúng cùng thứ tự ưu tiên R2–R4** một cách nhất quán, bất kể có phải conflict thật hay không — đơn giản hơn (1 luật chọn duy nhất cho mọi trường hợp "nhiều ứng viên 1 type"), và tránh có 2 bộ luật chọn khác nhau cho 2 tình huống nhìn bên ngoài giống nhau (FE/reviewer không cần phân biệt). Banner cảnh báo vẫn chỉ hiện khi `configuration` thật sự khác nhau (R8), tách biệt rõ "chọn dòng hiển thị" và "có nên cảnh báo". | **Theo khuyến nghị.** Áp dụng R2–R4 nhất quán cho mọi trường hợp nhiều ứng viên cùng `type`, bất kể có conflict thật hay không. |
| OQ-2 | Endpoint cho khối "Policy đang áp dụng" — **endpoint riêng** `GET /api/v1/devices/:id/applied_policies` (đúng chỉ dẫn carry-over từ `docs/sot/F4-device-detail.md` §12, cho phép loading/error tách biệt thật sự) hay **mở rộng inline** `GET /api/v1/devices/:id` (giống cách F6 đã inline `groups`)? | **Endpoint riêng.** F4 đã ghi rõ ý định "F9 ... sẽ là lúc tách khối Policy đang áp dụng ra 1 API/loading riêng đúng như mockup" — đây là quyết định đã được dự liệu trước, không phải chọn ngẫu nhiên; đồng thời chi phí tính resolution (join + logic chọn thắng) khác hẳn về bản chất so với `device.groups` (1 join đơn giản), nên tách ra giúp response `GET /devices/:id` không bị chậm/phình theo độ phức tạp resolution, và khối UI có trạng thái loading/error độc lập thật sự như `UI_UX_design.md` §5 mô tả. | **Theo khuyến nghị.** Endpoint riêng `GET /api/v1/devices/:id/applied_policies`. |
| OQ-3 | Khi 1 Device nhận **đúng 1 Policy** (cùng `policy_id`) qua ≥2 Group cùng lúc (A13) — hiển thị nguồn thế nào ở dòng chính (badge "Từ group: X")? | Hiển thị **1 Group duy nhất** ở badge chính, chọn theo `group_id` nhỏ hơn (tie-break xác định, cùng tinh thần R4), và liệt kê đầy đủ mọi Group đang đóng góp trong "Xem tất cả nguồn". Tránh badge dài dòng liệt kê nhiều tên group ngay dòng chính, giữ bảng gọn theo mockup, chi tiết đầy đủ vẫn có ở popover. | **Theo khuyến nghị.** Badge chính = group_id nhỏ nhất, đầy đủ ở popover. |
| OQ-4 | "Xem tất cả nguồn" có nên liệt kê cả ứng viên đã bị loại vì Policy `inactive`, hay chỉ liệt kê ứng viên `active` bị thua tie-break? | **Liệt kê cả 2 loại** (bị loại vì `inactive` và bị thua tie-break dù `active`), mỗi dòng có lý do loại riêng biệt, rõ ràng — đúng tinh thần minh bạch của `UI_UX_design.md` §5 ("kể cả policy bị override ... kèm lý do bị loại") và giúp user hiểu vì sao 1 Policy họ biết là "đã gán" lại không thấy áp dụng (vd do quên activate lại). | **Theo khuyến nghị.** Liệt kê cả ứng viên `inactive` và ứng viên `active` thua tie-break, mỗi dòng có lý do loại riêng. |
| OQ-5 | Không sử dụng — số thứ tự dự phòng, không có nội dung (giữ khoảng đánh số liền mạch với F8 để tránh nhầm lẫn khi tham chiếu chéo giữa các SoT). | — | — |
| OQ-6 | F8 OQ-11 đã chủ động không thêm entry point "Gán policy trực tiếp" ở Device Detail và để ngỏ cho "F9 hoặc 1 feature sau". F9 có nên làm luôn (tái dùng `PolicyDeviceAssignModal` đã có từ F8) không? | **Không làm trong F9.** `docs/backlog.md` mô tả phạm vi F9 là "Policy resolution engine" + "cập nhật lại khối hiển thị Policy đang áp dụng" — không nhắc thêm hành động ghi mới; thêm entry point ghi mới ở đây là mở rộng phạm vi ngoài mô tả backlog, nên để ngỏ tiếp cho 1 quyết định tường minh sau nếu người duyệt muốn, tránh tự ý phình phạm vi F9 (vốn đã đủ phức tạp về logic resolution). | **Theo khuyến nghị.** Không làm trong F9, để ngỏ cho feature sau nếu cần. |
| OQ-7 | Cột "Trạng thái" trong bảng theo mockup `UI_UX_design.md` §5 (`Name | Type | Nguồn | Trạng thái`) — vì chỉ Policy `active` mới xuất hiện ở đây (theo R1), cột này hiển thị nội dung gì cho có ý nghĩa? | Hiển thị `policy.status` (luôn là "active" theo định nghĩa lọc R1) như badge nhất quán với Policy List/Detail (F7/F8) — giữ đúng 4 cột như mockup dù giá trị luôn cố định, thay vì tự sáng tạo cột khác ngoài mockup. Nếu người duyệt muốn thay bằng chỉ báo "Có xung đột"/"Không xung đột" per-row thay vì lặp lại "active" vô nghĩa, đây là thay đổi nhỏ so với mockup cần ghi rõ lý do kỹ thuật/UX khi `/design frontend`. | **Theo khuyến nghị.** Giữ cột "Trạng thái" = `policy.status` badge, đúng 4 cột mockup. |

**Rủi ro/giả định:**
- **OQ-1 và R8 phải nhất quán với nhau khi approve**: nếu người duyệt chọn
  khác khuyến nghị OQ-1 (vd không áp dụng R2–R4 khi configuration giống
  hệt, mà dùng luật khác để chọn dòng hiển thị), phải sửa lại scenario "Trực
  tiếp và group cùng type cùng configuration không tính là conflict thật"
  ở §11 cho khớp.
- **Không polymorphic/denormalize thêm bất kỳ dữ liệu nào** — nếu benchmark
  thực tế ở `/design F9-api` cho thấy resolution quá chậm với dữ liệu seed
  lớn, cân nhắc thêm cache có kiểm soát là quyết định ngoài phạm vi SoT này,
  cần quay lại approve riêng (không tự thêm khi implement).
- Giả định **không có role nội bộ Organization** (nhất quán F0–F8).
- Giả định Policy `updated_at` là mốc thời gian đáng tin cậy cho tie-break
  R3 (không có cột riêng kiểu "priority"/"effective_at" nào khác trong
  schema hiện tại — nếu `/design` phát hiện cần thêm, đó là mở rộng ngoài
  phạm vi PRD hiện tại).

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật, bỏ tag, rồi mới set `status: approved` ở đầu file.
