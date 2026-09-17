---
feature_id: F7
title: Policy CRUD (list/create/edit, status)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-17
---

## §1. Meta
- Feature: `F7` — Policy CRUD (list/create/edit, status)
- Dependency: `F0` (Foundation + Login — approved, xem `docs/sot/F0-foundation.md`,
  `docs/design/F0-{db,api,frontend}.md`: `Organization`/`User`, JWT
  `Authenticatable`, Pundit `ApplicationPolicy`, `ApplicationController` với
  `rescue_from ActiveRecord::RecordNotFound` → 404 và envelope 422
  `{"errors": {"<field>": ["<msg>"]}}`, `AppShell`, router guard).
  - F7 **không** phụ thuộc F2–F6 về nghiệp vụ (Policy là resource độc lập,
    không đụng Device/Group ở tầng dữ liệu trong phạm vi F7), nhưng **tái
    dùng nguyên vẹn** các convention/component đã build ở đó (không thiết kế
    lại): pagination/meta của F2, `FormModal.vue` + map lỗi 422 field-level
    của F3, `ActionsMenu.vue` (⋯), `ConfirmModal.vue` của F5,
    `DataTable`/`PaginationBar`/`FilterBar`/`EmptyState`/`ErrorState`/`StatusBadge`/`ToastContainer`.
  - **Lưu ý sequencing (xem OQ-6, OQ-7)**: `docs/backlog.md` xếp `F8`
    (Policy assignment) và `F9` (Policy resolution engine) **sau** F7. Tại
    thời điểm build F7, bảng `policy_assignments` **chưa tồn tại** — mọi nội
    dung của `UI_UX_design.md` §7 phụ thuộc bảng đó (cột "Số nơi đang gán",
    trang Policy Detail với tab "Đang gán cho Group/Device", cảnh báo "Policy
    đang được gán cho N group/device" khi deactivate) **chưa có gì để lấy dữ
    liệu thật** ở F7 — xử lý theo đúng pattern đã chốt ở F5→F6 (không bịa
    field/route rỗng, ghi thành nghĩa vụ carry-over cho F8).
- Nguồn: `PRD.md` §"Nghiệp vụ" → "Policy" (`name, type, configuration (dạng
  cấu trúc, ví dụ JSON), status (active/inactive)`; "gán được cho Group
  và/hoặc Device"; "không gán Policy inactive"; "không gán lẫn Organization"
  — 2 rule "gán" này thuộc F8 nhưng F7 phải mô hình hóa `status`/`type`/
  `configuration` sao cho F8/F9 dùng được ngay) + bảng "Giao diện bắt buộc"
  dòng "Policies" (`Danh sách; tạo / sửa; gán cho group hoặc device` — **không**
  có động từ "xóa", khác hẳn dòng "Groups" liệt kê rõ "tạo / sửa / xóa", xem
  OQ-2) + §"Yêu cầu chỉnh chu" (loading/rỗng/lỗi, validate form, phân trang
  list); `docs/backlog.md` mục F7 ("Policy CRUD (list/create/edit, status)")
  + "Dependency" + "Ngoài phạm vi"; `UI_UX_design.md` §2 (route `/policies`),
  §7.1 (Policy List — layout, search + filter status, cột "Số nơi đang gán",
  modal tạo/sửa với JSON editor có validate cú pháp, cảnh báo khi deactivate),
  §7.2 (Policy Detail — ngoài phạm vi F7, xem OQ-7), §8 (component dùng
  chung), §9 (ma trận Loading/Empty/Error), §10 (validate & thông báo lỗi);
  `CLAUDE.md` §4 (tách Organization tuyệt đối 404-không-403; "không gán
  Policy inactive, không gán Policy khác Organization" — validate ở service
  layer khi F8 build, nhưng `status` phải là field enum đáng tin cậy ngay từ
  F7; công thức resolution ở F9 dựa vào so khớp `type` + tie-break
  `updated_at`/`id` — F7 không được làm gì phá vỡ giả định đó, vd đổi `type`
  không được sinh ra 2 policy trùng ý nghĩa một cách vô tình).

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn **quản lý danh sách
Policy** của tổ chức mình (xem danh sách có phân trang + tìm theo tên + lọc
theo trạng thái, tạo policy mới với tên/loại/cấu hình, sửa các field đó, và
bật/tắt trạng thái `active`/`inactive`) — để có sẵn kho Policy hợp lệ, đã
được kiểm tra dữ liệu đầu vào, phục vụ việc **gán** Policy cho Group/Device ở
F8 và tính **policy đang áp dụng** trên Device ở F9, mà không phải lo Policy
bị thiếu field, trùng tên gây nhầm lẫn, hay mang cấu hình không phải JSON hợp
lệ.

## §3. Scope

**Trong phạm vi:**
- **DB**: bảng `policies` mới (`organization_id` NOT NULL + FK, `name` NOT
  NULL, `type` NOT NULL, `configuration` dạng JSON NOT NULL, `status` NOT
  NULL enum mặc định `active`, timestamps), index phục vụ org-scope + phân
  trang ổn định (`[organization_id, created_at, id]`, đúng pattern
  `devices`/`groups`), unique index composite `[organization_id, name]` (xem
  OQ-1), index hỗ trợ lọc theo `status` (`[organization_id, status]`).
- **Model**: `Policy` (`belongs_to :organization`, validate presence
  `name`/`type`/`configuration`, uniqueness `name` scope `organization_id`,
  enum `status: { active: 0, inactive: 1 }` — cùng cơ chế enum số nguyên đã
  dùng cho `Device#status`), `Organization has_many :policies`.
- **API** (namespace `api/v1`, kế thừa envelope lỗi của F0):
  - `GET /api/v1/policies` — phân trang (`page`/`per_page`, meta y hệt F2) +
    tìm theo tên (`q`) + lọc theo `status` (xem OQ-3).
  - `POST /api/v1/policies` — tạo (name/type/configuration bắt buộc, status
    tùy chọn mặc định `active` — OQ-10).
  - `PATCH /api/v1/policies/:id` — sửa name/type/configuration/status (tất
    cả field đều sửa được trong cùng 1 form, kể cả `type` — xem OQ-4).
  - Mọi action lấy record qua `policy_scope(Policy)` /
    `current_organization.policies`, **không bao giờ** `Policy.find` trần.
- **Authorization**: `PolicyPolicy` (tên class Pundit `PolicyPolicy` cho
  model `Policy` — cần đặt tên rõ ràng để không nhầm với khái niệm
  "Pundit policy", ghi chú trong code) + `PolicyPolicy::Scope`.
- **FE**:
  - Route `/policies` + `views/policies/PolicyListView.vue` (danh sách,
    search, filter status, phân trang, nút "+ Thêm Policy", cột ⋯ với
    "Sửa" + toggle nhanh trạng thái).
  - `components/PolicyFormModal.vue` (tạo/sửa, dựng trên `FormModal.vue` của
    F3, gồm JSON editor (textarea + parse `JSON.parse` khi blur + nút
    "Format") cho `configuration`, select/`status` cho `status`).
  - `stores/policies.ts`, `api/policies.ts`, `types/policy.ts` — cùng khuôn
    với `groups.*`.
  - **Bật mục "Policies" trên sidebar** `AppShell.vue` (đang ở dạng chưa-bật
    theo ghi chú của F0/F5) — nghĩa vụ đã được ghi nợ đích danh cho F7.

**Ngoài phạm vi** (khớp `docs/backlog.md` — không tự thêm):
- **Gán Policy cho Group và/hoặc Device**, bảng `policy_assignments`, async
  job + trạng thái pending/running/done/failed, validate "không gán Policy
  inactive"/"không gán chéo Organization" ở service layer → thuộc **F8**. F7
  tuyệt đối không tạo bảng `policy_assignments`, không thiết kế index cho nó
  (unique `(policy_id, group_id)`/`(policy_id, device_id)` phụ thuộc thiết
  kế idempotent của F8, thiết kế sớm là đoán mò — đúng bài học đã rút ra ở
  F5 với `group_memberships`).
- **Policy resolution engine** (policy đang áp dụng trên Device, xử lý
  conflict cùng `type`) → thuộc **F9**.
- **Trang chi tiết Policy `/policies/:id`** (`UI_UX_design.md` §7.2 — 2 tab
  "Đang gán cho Group"/"Đang gán cho Device") → thuộc F8, vì toàn bộ nội
  dung trang đó là dữ liệu assignment chưa tồn tại ở F7 (xem OQ-7, cùng
  pattern F5 đã áp dụng cho Group Detail).
- **Cột "Số nơi đang gán"** trong bảng danh sách (`UI_UX_design.md` §7.1) →
  không có nguồn dữ liệu ở F7 (chưa có `policy_assignments`); thêm ở F8 (xem
  OQ-6) — cùng lý do đã chốt ở F5 OQ-4 (`devices_count`) và F4 OQ-6.
- **Xóa Policy** (`DELETE`) → PRD/backlog không nhắc tới hành động xóa cho
  Policy (khác Group), F7 **không** làm hard delete, chỉ hỗ trợ chuyển
  `status` sang `inactive` (xem OQ-2).
- Màn hình quản lý Organization (PRD: "Không cần").
- Bất kỳ nghiệp vụ nào không có trong `PRD.md` (versioning cấu hình
  policy, audit log ai sửa policy, schema validation riêng theo từng
  `type`, export...).

## §4. Main flow

**Xem danh sách Policy:**
1. User (đã đăng nhập, `active`) bấm "Policies" trên sidebar → điều hướng
   `/policies`.
2. FE gọi `GET /api/v1/policies?page=1` (đồng bộ `page`/`q`/`status` vào URL
   query string — đúng pattern F2/F5).
3. BE: `policy_scope(Policy)` → lọc theo `q` (nếu có) → lọc theo `status`
   (nếu có) → đếm `total_count` trên relation đã lọc **trước** limit/offset
   → trả `policies[]` + `meta`.
4. FE render `DataTable` (Name | Type | Status | ⋯) + `PaginationBar`.

**Tạo Policy:**
1. Bấm "+ Thêm Policy" → mở `PolicyFormModal` (rỗng, `status` mặc định
   `active` — OQ-10).
2. Nhập name (bắt buộc) + type (bắt buộc) + configuration (JSON, bắt buộc,
   validate cú pháp ở FE khi blur) + status (mặc định active, có thể chọn
   inactive ngay lúc tạo) → Submit → `POST /api/v1/policies`.
3. `201` → đóng modal, toast "Đã tạo policy", refresh danh sách (về page 1
   để thấy ngay policy vừa tạo — cùng quyết định F5 §4).
4. `422` → modal **không** đóng, lỗi bám theo đúng field, giữ nguyên dữ liệu
   user đã nhập (kể cả nội dung JSON đã gõ, không xóa để user gõ lại).

**Sửa Policy:**
1. Trên 1 dòng, mở menu ⋯ → "Sửa" → mở `PolicyFormModal` prefill toàn bộ
   field (kể cả `type`, xem OQ-4) của dòng đó.
2. Submit → `PATCH /api/v1/policies/:id`.
3. `200` → đóng modal, toast "Đã cập nhật policy", refresh **đúng trang hiện
   tại** (giữ `page`/`q`/`status`, không nhảy về page 1 — khác luồng tạo).
4. `422` → như bước 4 của luồng tạo.

**Chuyển trạng thái Policy (active ↔ inactive):**
1. Trên 1 dòng, mở menu ⋯ → "Kích hoạt"/"Vô hiệu hoá" (label đổi theo trạng
   thái hiện tại) — hoặc thực hiện qua field `status` trong `PolicyFormModal`
   (cả hai đường đều gọi cùng `PATCH /api/v1/policies/:id { status: ... }`).
2. `active` → `inactive`: ở F7, **không** hiện cảnh báo "đang được gán cho N
   group/device" vì chưa có bảng assignment để đếm (xem OQ-9 — nghĩa vụ
   carry-over bắt buộc cho F8). `200` → toast "Đã vô hiệu hoá policy".
3. `inactive` → `active`: không có rule nào chặn (rule "không gán Policy
   inactive" chỉ áp dụng lúc **gán**, thuộc F8) → `200` → toast "Đã kích
   hoạt policy".

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- **Search theo tên** (`q`): gõ vào ô search → debounce → gọi lại API với
  `q`, **reset về page 1**, cập nhật URL query. Nút "Xóa tìm kiếm" chỉ hiện
  khi đang có `q`/`status`.
- **Filter theo status** (Tất cả / Active / Inactive): chọn select → gọi
  lại API với `status`, **reset về page 1**, cập nhật URL query.
- **Vào thẳng URL `/policies?page=2&status=inactive`**: trang tự đọc query
  string và fetch đúng, không phụ thuộc state từ điều hướng trước đó.
- **Tạo policy khi danh sách đang rỗng**: empty state có CTA "+ Thêm Policy"
  mở đúng modal tạo (không phải nút trang trí).

### 5.2 Edge case
- A1. `GET/PATCH /api/v1/policies/:id` với `:id` thuộc Organization khác
  (đoán ID) → **404**, không phải 403 (`CLAUDE.md` §4).
- A2. `:id` không tồn tại trong hệ thống → **404**.
- A3. `:id` sai định dạng (không phải số nguyên) → **404**, không phải 500
  (tái dùng `rescue_from ActiveRecord::RecordNotFound` toàn cục của F0).
- A4. Tạo/sửa policy với `name` rỗng hoặc chỉ toàn khoảng trắng → **422**,
  lỗi bám field `name`.
- A5. Tạo policy trùng `name` với policy đã có **trong cùng org** → **422**,
  lỗi bám field `name`.
- A6. Tạo policy trùng `name` với policy của **org khác** → **thành công
  (201)** — unique theo organization, không unique toàn hệ thống
  (`CLAUDE.md` §4).
- A7. **Race condition**: 2 request tạo policy cùng `name` trong cùng org
  gần như đồng thời → request thua bị unique index chặn ở tầng DB
  (`ActiveRecord::RecordNotUnique`) → **422 trên field `name`**, không phải
  500.
- A8. Sửa policy giữ nguyên `name` cũ của chính nó (no-op trên name) →
  **200**, không bị báo trùng với chính mình.
- A9. Sửa policy đổi `name` thành tên đang bị policy khác cùng org dùng →
  **422** (cùng message A5).
- A10. `name`/`type` vượt giới hạn độ dài → **422** bám đúng field (xem
  OQ-8).
- A11. Tạo/sửa policy với `type` rỗng hoặc chỉ toàn khoảng trắng → **422**,
  lỗi bám field `type`.
- A12. Tạo/sửa policy **thiếu** `configuration` (không gửi field, hoặc gửi
  `null`) → **422**, lỗi bám field `configuration`.
- A13. Tạo/sửa policy với `configuration` **không phải JSON object hợp lệ**
  (mảng, số, chuỗi, hoặc JSON string không parse được nếu FE gửi raw string)
  → **422**, message "Cấu hình phải là một object JSON hợp lệ." (pending
  OQ-5).
- A14. Sửa `type` của một policy đã tồn tại (kể cả khi giá trị `type` cũ
  đang trùng với policy khác) → **cho phép, 200** — resolution ở F9 luôn
  tính lại theo state hiện tại (hàm thuần, `CLAUDE.md` §4), không có dữ liệu
  cache nào bị "lệch" khi đổi `type`.
- A15. Chuyển `status` từ `active` → `inactive` → **200**, **không** cảnh
  báo/chặn gì ở F7 dù policy đang (giả định) được gán ở nơi khác — vì F7
  chưa có bảng assignment để biết.
- A16. Chuyển `status` từ `inactive` → `active` → **200**, không có rule
  nào chặn (rule "không gán Policy inactive" chỉ áp dụng lúc gán — F8).
- A17. Tạo policy **không truyền** `status` → mặc định lưu `active`
 .
- A18. Tạo policy truyền `status` với giá trị không thuộc enum
  (`active`/`inactive`) → **422**, lỗi bám field `status`.
- A19. Danh sách rỗng vì **org chưa có policy nào** → EmptyState "Chưa có
  policy nào" + CTA "+ Thêm Policy".
- A20. Danh sách rỗng vì **search/filter không khớp** → EmptyState "Không
  tìm thấy policy nào" + nút "Xóa bộ lọc" (không hiện CTA tạo mới gây hiểu
  nhầm rằng org chưa có policy).
- A21. `page` vượt quá số trang hiện có → **200 + mảng rỗng**, không 404
  (đúng quyết định đã chốt ở F2/F5).
- A22. `page`/`per_page` không phải số nguyên dương → **422** field-level.
- A23. `per_page` vượt ngưỡng tối đa (100) → clamp im lặng về 100, không báo
  lỗi.
- A24. `status` filter truyền giá trị không hợp lệ (không phải
  `active`/`inactive`/rỗng) → **422** field-level trên query param, không
  âm thầm trả về danh sách rỗng/toàn bộ.
- A25. Lỗi hạ tầng khi tải danh sách (500/network) → ErrorState trong khu
  vực bảng + nút "Thử lại", search/filter bar vẫn dùng được, không trang
  trắng.
- A26. Gọi bất kỳ endpoint policies nào **không có token** hoặc token hết
  hạn/không hợp lệ → **401** (tái dùng `Authenticatable` của F0).
- A27. User **chưa đăng nhập** mở thẳng `/policies` → router guard redirect
  `/login`.
- A28. FE **không bao giờ** gửi `organization_id` trong body/query của bất
  kỳ request policies nào; BE **không nhận** `organization_id` từ request
  (strong params không permit) — org do token quyết định.
- A29. Menu hành động ⋯ của 1 dòng Policy **không** có action "Xóa" và
  **không** có action "Xem chi tiết" (không tạo nút dẫn tới trang không tồn
  tại) — chỉ có "Sửa" và toggle trạng thái.
- A30. Bảng danh sách Policy **không** render cột "Số nơi đang gán" ở F7
  (không có nguồn dữ liệu thật, không bịa `0`/`—` giả).
- A31. Đóng modal tạo/sửa (nút "Hủy"/click nền/`Escape`) khi đang có dữ liệu
  chưa lưu → đóng modal, **không** gọi API, policy còn nguyên trạng thái cũ.

## §6. Business rule & validation

- **Org-scope tuyệt đối** (`CLAUDE.md` §4). Input hợp lệ: mọi query đi qua
  `policy_scope(Policy)` / `current_organization.policies`; list chỉ chứa
  policy của org gắn với token. Input bị chặn: `:id` của org khác / không
  tồn tại / sai định dạng → **404, không 403** (A1–A3); `organization_id`
  gửi từ client bị bỏ qua hoàn toàn (A28).
- **`name` bắt buộc**. Input hợp lệ: chuỗi không rỗng sau khi trim. Input bị
  chặn: rỗng/chỉ khoảng trắng → 422 field `name` (A4).
- **`name` unique trong Organization** (xem OQ-1 — phương án khuyến nghị).
  Input hợp lệ: tên chưa dùng trong org hiện tại; **trùng với tên của org
  khác vẫn hợp lệ** (A6). Input bị chặn: trùng tên trong cùng org → 422
  field `name` (A5, A9). Bảo vệ 2 lớp: validate ở model **và** unique index
  composite `[organization_id, name]` ở DB để chặn race (A7).
- **`type` bắt buộc**, không giới hạn giá trị cứng (xem OQ-3). Input hợp lệ:
  chuỗi không rỗng sau khi trim, trong giới hạn độ dài (OQ-8). Input bị
  chặn: rỗng/chỉ khoảng trắng → 422 field `type` (A11). `type` **sửa được
  sau khi tạo** (xem OQ-4, A14) — không có rule nào khoá field này lại vì
  policy resolution (F9) luôn tính lại từ state hiện tại.
- **`configuration` bắt buộc, phải là JSON object hợp lệ** (xem OQ-5). Input
  hợp lệ: object JSON (kể cả object rỗng `{}` — không cấm, chỉ cấm thiếu
  field hoặc sai kiểu). Input bị chặn: thiếu/`null` → 422 (A12); không phải
  object (mảng/số/chuỗi/JSON lỗi cú pháp) → 422 (A13). **Không** validate
  schema theo từng `type` cụ thể (PRD không cho danh sách type/schema tương
  ứng, tự bịa ra sẽ là nghiệp vụ ngoài đề bài).
- **`status` là enum `active`/`inactive`**, mặc định `active` khi tạo mới
  nếu không truyền (A17, OQ-10). Input bị chặn: giá trị ngoài enum → 422
  field `status` (A18). **Không có rule nào ở F7 chặn việc đổi status** theo
  cả 2 chiều (A15, A16) — rule "không gán Policy inactive" (`CLAUDE.md` §4)
  chỉ có hiệu lực tại **thời điểm gán** (F8), F7 chỉ có nghĩa vụ đảm bảo
  field `status` đáng tin cậy để F8 kiểm tra.
- **Không hard delete Policy** (xem OQ-2 — phương án khuyến nghị): chỉ có
  cơ chế chuyển `status` sang `inactive` để "vô hiệu hoá" một Policy, không
  xóa record. Không có endpoint `DELETE /api/v1/policies/:id` (A29).
- **Giới hạn độ dài** `name`/`type` → 422 bám đúng field (A10, OQ-8).
- **Phân trang bắt buộc** (`PRD.md`: "phân trang list, không render 10.000
  dòng"): kế thừa nguyên contract của F2/F5 — `page` mặc định 1, `per_page`
  mặc định 20 / tối đa 100 (clamp im lặng, A23), `meta{current_page,
  per_page, total_count, total_pages}`, `total_count` đếm trên relation đã
  lọc & đã org-scope trước khi limit/offset, page vượt cuối → 200 rỗng
  (A21), param không hợp lệ → 422 field-level (A22, A24).
- **Auth** (kế thừa F0, không phải rule mới): Bearer token của user `active`
  → hợp lệ; thiếu/sai/hết hạn → 401 (A26); chưa đăng nhập ở FE → redirect
  `/login` (A27).
- **RBAC không phân role nội bộ org** (kế thừa F0/F2/F3/F4/F5): mọi user
  `active` của org được list/tạo/sửa policy của org mình — `PolicyPolicy`
  các action đều `true`, ranh giới thật nằm ở `Scope#resolve`.
- **Không liên quan tới F7** (ghi ra để khỏi bị nhầm là thiếu): rule "không
  gán Policy inactive/chéo org" (validate khi **gán**) và "policy đang áp
  dụng trên Device, xử lý conflict cùng type" không phát sinh ở F7 vì F7
  không đụng tới `policy_assignments` hay Device — chúng thuộc F8/F9. F7
  chỉ có nghĩa vụ mô hình hóa `type`/`configuration`/`status` đúng để 2
  feature đó dùng được ngay không phải sửa schema.

## §7. UI state
Theo `UI_UX_design.md` §7.1 + §9 (ma trận dùng chung) — chỉ liệt kê điểm
phải khớp business rule ở §6:
- **Loading** (lần đầu): skeleton rows, giữ nguyên khung search/filter bar
  + nút "+ Thêm Policy" để không giật layout.
- **Loading** (đổi trang/search/filter/refresh sau mutation): overlay mờ
  lên bảng cũ + spinner nhỏ, **không** xóa trắng bảng rồi mới vẽ lại.
- **Loading** (trong modal): nút submit disable + spinner trong nút; không
  cho đóng modal giữa chừng bằng cách bấm lại.
- **Empty** không do search/filter (A19): "Chưa có policy nào" + CTA
  "+ Thêm Policy".
- **Empty** do search/filter (A20): "Không tìm thấy policy nào" + nút "Xóa
  bộ lọc".
- **Error** tải danh sách (A25): ErrorState + "Thử lại", search/filter bar
  vẫn hoạt động.
- **Error** form 422: lỗi hiện dưới đúng field (`name`/`type`/
  `configuration`/`status`), modal giữ nguyên dữ liệu đã nhập (kể cả nội
  dung JSON thô đã gõ, không tự động format/xóa khi lỗi).
- **Error** form 500/network: banner đỏ trên đầu form ("Có lỗi xảy ra, vui
  lòng thử lại."), modal không đóng.
- **Error** JSON không hợp lệ ở `configuration` (client-side, trước khi gọi
  API): hiện lỗi "JSON không hợp lệ" ngay dưới textarea khi blur, **chặn
  submit** (không cho gọi API với JSON lỗi cú pháp).
- **Success**: toast tương ứng ("Đã tạo policy" / "Đã cập nhật policy" /
  "Đã kích hoạt policy" / "Đã vô hiệu hoá policy") + bảng đã cập nhật, giữ
  đúng `page`/`q`/`status` theo luồng ở §4.
- **Không `console.error`/`console.log` sót lại**, không nút chết
  (`UI_UX_design.md` §10, `PRD.md` §"Yêu cầu chỉnh chu").

## §8. Data & API touchpoint
*(dự kiến — chốt chính thức ở `/design F7`)*
- Model/bảng mới: `policies` — `id`, `organization_id` (FK, NOT NULL),
  `name` (NOT NULL), `type` (NOT NULL), `configuration` (json/jsonb, NOT
  NULL), `status` (integer enum, NOT NULL, default `active`), `created_at`,
  `updated_at`. Index: `[organization_id, created_at, id]` (phân trang ổn
  định), `[organization_id, name]` unique (OQ-1), `[organization_id,
  status]` (lọc theo status).
- Quan hệ: `Organization has_many :policies`; `Policy belongs_to
  :organization`. (`has_many :policy_assignments` — F8.)
- Endpoint dự kiến:
  - `GET /api/v1/policies?page=&per_page=&q=&status=` → `{ policies: [...],
    meta: {...} }`
  - `POST /api/v1/policies` (body phẳng `{name, type, configuration,
    status}`, `status` tùy chọn) → `201 { policy: {...} }`
  - `PATCH /api/v1/policies/:id` → `200 { policy: {...} }`
  - Lỗi: `401` / `404` (`{error: "Not found"}`) / `422`
    (`{errors: {field: [msg]}}`) — nguyên envelope của F0.
- Policy (Pundit): `PolicyPolicy` (`index?/create?/update?` → `true`) +
  `Scope#resolve` → `user.organization.policies`.
- FE mới: route `/policies`, `views/policies/PolicyListView.vue`,
  `components/PolicyFormModal.vue`, `stores/policies.ts`,
  `api/policies.ts`, `types/policy.ts`.
- FE sửa: `router/index.ts` (thêm route), `components/AppShell.vue` (bật
  nav "Policies").

## §9. RBAC / Authorization
- Chỉ user đã đăng nhập (`Authenticatable`), `status == active`, mới gọi
  được các endpoint policies; thiếu/sai token → 401.
- Không phân role nội bộ org (nhất quán F0–F5): mọi user active của org đều
  list/tạo/sửa được policy của org mình, kể cả đổi `status`.
- Org-scope check bắt buộc ở **mọi** action: `policy_scope(Policy)` /
  `current_organization.policies` — không bao giờ `Policy.find(params[:id])`
  trần (`CLAUDE.md` §4). Sai org → 404.
- Test bắt buộc riêng cho resource Policy: org A **không** đọc/sửa được
  policy của org B, kỳ vọng 404.

## §10. Non-functional (performance/scale)
- F7 **không** đụng tới bài toán 10.000 device/group (đó là F8/F9). Số
  lượng Policy trong 1 org được coi là nhỏ (hàng chục), nhưng danh sách
  **vẫn bắt buộc phân trang server-side** theo PRD, không FE-side.
- `total_count` đếm bằng `COUNT` trên relation đã org-scope + đã lọc, không
  load hết record ra rồi `.size`.
- `configuration` là JSON — nếu dùng cột `json` (không phải `jsonb`), không
  query được theo nội dung bên trong; F7 không cần query theo nội dung
  `configuration` nên việc này không chặn F7, nhưng nên cân nhắc `jsonb` từ
  đầu (chốt ở `/design`) vì F9 (policy resolution) so sánh
  `configuration` giữa các policy cùng `type` — `jsonb` cho phép so sánh
  bằng (`=`) hiệu quả hơn `json` (text-based).
- Search `q` (ILIKE) và filter `status`: quy mô Policy nhỏ, chấp nhận
  sequential scan trong phạm vi 1 org — ghi nhận rủi ro production đã biết
  trong `DESIGN.md`, không tối ưu sớm.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Xem danh sách Policy của org mình
  Given Organization "Acme Inc." có các Policy "Password Baseline" và "WiFi Corp"
  And Organization "Globex Corp." có Policy "Globex Lockdown"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi thấy Policy "Password Baseline" và Policy "WiFi Corp" trong danh sách
  And tôi không thấy Policy "Globex Lockdown"

Scenario: Truy cập trực tiếp Policy của org khác trả về 404, không phải 403
  Given Organization "Globex Corp." có Policy "Globex Lockdown" với id 42
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies/42"
  Then tôi nhận về "404"

Scenario: Sửa Policy của org khác trả về 404
  Given Organization "Globex Corp." có Policy "Globex Lockdown" với id 42
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "PATCH /api/v1/policies/42" với name "Hacked"
  Then tôi nhận về "404"

Scenario: id không tồn tại trả về 404
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies/999999"
  Then tôi nhận về "404"

Scenario: id sai định dạng trả về 404, không phải 500
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies/abc"
  Then tôi nhận về "404"

Scenario: Tạo Policy với name rỗng bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với name "" type "password" configuration hợp lệ
  Then tôi nhận về "422"
  And lỗi bám vào field "name"

Scenario: Tạo Policy trùng tên trong cùng org bị từ chối
  Given Organization "Acme Inc." đã có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy mới với name "Password Baseline"
  Then tôi nhận về "422"
  And lỗi bám vào field "name"

Scenario: Tạo Policy trùng tên ở org khác vẫn thành công
  Given Organization "Globex Corp." đã có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy mới với name "Password Baseline"
  Then tôi nhận về "201"

Scenario: Race condition tạo trùng tên đồng thời không tạo ra 2 bản ghi
  Given tôi là user active thuộc Organization "Acme Inc."
  When 2 request tạo Policy cùng name "Password Baseline" được gửi gần như đồng thời
  Then đúng 1 request nhận "201"
  And request còn lại nhận "422" bám field "name"

Scenario: Sửa Policy giữ nguyên tên của chính nó không bị báo trùng
  Given Organization "Acme Inc." có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi sửa Policy "Password Baseline" và giữ nguyên name "Password Baseline"
  Then tôi nhận về "200"

Scenario: name/type vượt giới hạn độ dài bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với name dài hơn giới hạn cho phép
  Then tôi nhận về "422"
  And lỗi bám vào field "name"

Scenario: Tạo Policy với type rỗng bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với name hợp lệ và type ""
  Then tôi nhận về "422"
  And lỗi bám vào field "type"

Scenario: Tạo Policy thiếu configuration bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với name và type hợp lệ nhưng không có configuration
  Then tôi nhận về "422"
  And lỗi bám vào field "configuration"

Scenario: Tạo Policy với configuration không phải JSON object bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với configuration là "\"just a string\""
  Then tôi nhận về "422"
  And lỗi bám vào field "configuration"

Scenario: Sửa type của Policy đã tồn tại vẫn được chấp nhận
  Given Organization "Acme Inc." có Policy "Password Baseline" với type "password"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi sửa type của Policy "Password Baseline" thành "password_v2"
  Then tôi nhận về "200"
  And Policy "Password Baseline" có type "password_v2"

Scenario: Chuyển Policy đang active sang inactive không cảnh báo ở F7
  Given Organization "Acme Inc." có Policy "Password Baseline" đang active
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi chuyển status của Policy "Password Baseline" sang inactive
  Then tôi nhận về "200"
  And Policy "Password Baseline" có status "inactive"

Scenario: Chuyển Policy đang inactive sang active thành công
  Given Organization "Acme Inc." có Policy "Password Baseline" đang inactive
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi chuyển status của Policy "Password Baseline" sang active
  Then tôi nhận về "200"
  And Policy "Password Baseline" có status "active"

Scenario: Tạo Policy không truyền status mặc định là active
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với name và type hợp lệ, không truyền status
  Then tôi nhận về "201"
  And Policy vừa tạo có status "active"

Scenario: Tạo Policy với status không thuộc enum bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi tạo Policy với status "archived"
  Then tôi nhận về "422"
  And lỗi bám vào field "status"

Scenario: Danh sách Policy rỗng vì org chưa có policy nào
  Given Organization "Acme Inc." chưa có Policy nào
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi thấy thông báo "Chưa có policy nào"
  And tôi thấy nút "+ Thêm Policy"

Scenario: Danh sách Policy rỗng vì search không khớp
  Given Organization "Acme Inc." có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi tìm kiếm Policy với từ khóa "khong-ton-tai"
  Then tôi thấy thông báo "Không tìm thấy policy nào"
  And tôi không thấy nút "+ Thêm Policy" trong khu vực kết quả rỗng

Scenario: Lọc danh sách theo status
  Given Organization "Acme Inc." có Policy "Password Baseline" đang active
  And Organization "Acme Inc." có Policy "Old WiFi" đang inactive
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi lọc danh sách Policies theo status "inactive"
  Then tôi thấy Policy "Old WiFi"
  And tôi không thấy Policy "Password Baseline"

Scenario: Trang vượt quá số trang hiện có trả về danh sách rỗng
  Given Organization "Acme Inc." có 3 Policy
  When tôi gọi "GET /api/v1/policies" với page "99"
  Then tôi nhận về "200" với danh sách policy rỗng

Scenario: Tham số phân trang không hợp lệ bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies" với page "abc"
  Then tôi nhận về "422"

Scenario: per_page vượt ngưỡng tối đa bị giới hạn im lặng
  Given Organization "Acme Inc." có 150 Policy
  When tôi gọi "GET /api/v1/policies" với per_page "1000"
  Then tôi nhận về "200"
  And meta trả về per_page tối đa cho phép (100)

Scenario: status filter với giá trị không hợp lệ bị từ chối
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi gọi "GET /api/v1/policies" với status "archived"
  Then tôi nhận về "422"

Scenario: Lỗi hạ tầng khi tải danh sách hiện ErrorState
  Given API "/api/v1/policies" trả lỗi 500
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi thấy thông báo lỗi và nút "Thử lại"

Scenario: Gọi API policies không có token bị từ chối
  When tôi gọi "GET /api/v1/policies" không kèm token
  Then tôi nhận về "401"

Scenario: Chưa đăng nhập mở thẳng trang Policies bị chuyển hướng
  Given tôi chưa đăng nhập
  When tôi mở "/policies"
  Then tôi được chuyển hướng tới trang "/login"

Scenario: Menu hành động của Policy không có nút Xóa hoặc Xem chi tiết
  Given Organization "Acme Inc." có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở menu hành động của Policy "Password Baseline"
  Then tôi thấy hành động "Sửa" và hành động đổi trạng thái
  And tôi không thấy hành động "Xóa"
  And tôi không thấy hành động "Xem chi tiết"

Scenario: Danh sách Policy không hiển thị cột Số nơi đang gán
  Given Organization "Acme Inc." có Policy "Password Baseline"
  And tôi là user active thuộc Organization "Acme Inc."
  When tôi mở trang Policies
  Then tôi không thấy cột "Số nơi đang gán" trong bảng
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | `Policy.name` có **unique trong Organization** không? PRD không nói rõ (khác `User.email`/`Device.identifier` được nói rõ). | **Có** — unique theo `organization_id` (validate model + unique index composite `[organization_id, name]`), case-sensitive, cùng lý do và cùng cơ chế đã chốt cho `Group.name` ở F5 OQ-1 (tránh 2 policy trùng tên gây mơ hồ khi chọn gán ở F8). Trùng tên giữa 2 org khác nhau vẫn hợp lệ. Nếu chọn **không** unique: bỏ index + validate, sửa/bỏ 5 scenario `(pending OQ-1)`. | **Chốt theo khuyến nghị.** Unique `[organization_id, name]`, case-sensitive. |
| OQ-2 | Policy có **xóa được (hard delete)** không, hay chỉ có `status`? | **Không xóa** — PRD liệt kê hành động cho Policy chỉ là "tạo/sửa" + gán (`Danh sách; tạo / sửa; gán cho group hoặc device`), **không có động từ "xóa"**, khác hẳn dòng Group ("tạo / sửa / xóa"). Đây là tín hiệu chủ đích của đề bài, không phải thiếu sót. Nếu Policy bị xóa hẳn trong khi đang được F8 gán cho hàng nghìn device, phải xử lý dọn `policy_assignments` phức tạp không cần thiết — "vô hiệu hoá" (`status = inactive`) đã đủ để đạt mục đích nghiệp vụ. Nếu chọn **cho xóa**: bổ sung `DELETE /api/v1/policies/:id`, quyết định số phận `policy_assignments` liên quan (chặn xóa nếu đang gán, hay xóa cascade), sửa scenario `(pending OQ-2)`. | **Chốt theo khuyến nghị.** Không hard delete, chỉ status toggle. |
| OQ-3 | `type` là **free-form string** hay **enum cố định theo domain**? `UI_UX_design.md` §7.1 gợi ý "select, danh sách type cố định theo domain — liệt kê rõ trong DESIGN.md", nhưng PRD không cho danh sách giá trị cụ thể. | **Free-form string** ở tầng DB (không enum DB), validate presence + độ dài (OQ-8). Lý do: PRD không cho danh sách type cụ thể của domain này — tự đặt ra 1 enum cứng (vd "password"/"wifi"/"device_lock") là bịa nghiệp vụ ngoài đề, có rủi ro sai với ý đồ reviewer. F9 (resolution) chỉ cần so khớp `type` bằng chuỗi, không quan tâm nội dung cụ thể, nên free-form không ảnh hưởng tính đúng của F9. FE có thể gợi ý datalist từ các `type` đã tồn tại trong org (autocomplete) để tránh gõ sai chính tả tạo ra 2 type "giống nhau" một cách vô tình — quyết định UI chi tiết chốt ở `/design F7`. Nếu chọn **enum cố định**: phải liệt kê rõ danh sách giá trị trong `DESIGN.md` và migrate lại nếu thiếu giá trị sau này. | **Chốt theo khuyến nghị, kèm cách hòa giải mâu thuẫn với `UI_UX_design.md` §7.1** (xem "Rủi ro/giả định" bên dưới): DB **free-form string**, không enum cứng. FE hiện field `type` dưới dạng **combobox** (input có gợi ý dropdown, không phải `<select>` đóng cứng danh sách) — nạp gợi ý từ các giá trị `type` **đã tồn tại trong org hiện tại** (distinct, lấy từ chính API list/tạo policy, không cần endpoint riêng), cho phép gõ giá trị mới nếu org chưa có type nào phù hợp. Đây được coi là cách hiện thực hoá tinh thần "select, danh sách cố định theo domain" của `UI_UX_design.md` mà không bịa ra một enum domain-specific ngoài đề bài (PRD không cho danh sách). Phải ghi rõ quyết định và lý do này trong `DESIGN.md` §"3. AI"/phần thiết kế F7 khi implement, đúng yêu cầu `CLAUDE.md` §5 về việc xử lý mâu thuẫn SoT/UI_UX_design.md một cách tường minh, không âm thầm chọn. |
| OQ-4 | `type` có được **sửa sau khi tạo** không, khi F9's conflict resolution key theo `type`? | **Có, cho sửa tự do** — `UI_UX_design.md` §7.1 thiết kế modal tạo/sửa gồm cả field `type` trong cùng 1 form, ngụ ý editable. Về nghiệp vụ: `CLAUDE.md` §4 quy định "Policy đang áp dụng trên Device" **phải là hàm thuần của state hiện tại** — nghĩa là F9 luôn tính lại từ dữ liệu hiện tại, không cache kết quả cũ, nên đổi `type` của 1 policy không để lại "dữ liệu ma" nào cần dọn. Nếu chọn **khóa `type` sau khi tạo** (chỉ cho sửa khi chưa được gán ở F8): cần thêm field/service kiểm tra "đã có assignment chưa" — phức tạp hơn không có lợi ích nghiệp vụ rõ ràng, và tạo phụ thuộc ngược từ F7 vào bảng của F8. | **Chốt theo khuyến nghị.** `type` sửa tự do sau khi tạo, không khóa field. |
| OQ-5 | `configuration` bắt buộc hay optional? Validate ở mức nào? | **Bắt buộc**, phải là JSON **object** hợp lệ (object rỗng `{}` được chấp nhận, nhưng thiếu field / `null` / không phải object thì bị chặn). **Không** validate schema riêng theo từng `type` — PRD chỉ nói "configuration (dạng cấu trúc, ví dụ JSON)", không cho biết cấu trúc cụ thể theo type nào, tự đặt ra schema là bịa nghiệp vụ. Nếu chọn **optional** (cho phép thiếu, default `{}`): sửa scenario A12 `(pending OQ-5)`, và cần quyết định `configuration: {}` có coi là "khác configuration" với `configuration: {}` khác hay không khi F9 so sánh conflict. | **Chốt theo khuyến nghị.** Bắt buộc, phải là JSON object hợp lệ, không validate schema theo `type`. |
| OQ-6 | Danh sách Policy có hiện cột **"Số nơi đang gán"** ở F7 không? (`UI_UX_design.md` §7.1) | **Không** — chưa có bảng `policy_assignments` ở F7 nên không có nguồn dữ liệu thật; bịa số `0`/`—` sẽ gây hiểu nhầm là đã tính đúng. Thêm ở F8 khi có `policy_assignments` (đếm ở API, không FE tự đếm) — cùng pattern đã chốt ở F5 OQ-4 (`devices_count`) và F4 OQ-6. Nếu chọn thêm ngay `assignments_count: 0`: sửa scenario `(pending OQ-6)`, ghi rõ trong design API rằng giá trị luôn 0 cho tới F8. | **Chốt theo khuyến nghị.** Không hiện cột này ở F7; nghĩa vụ carry-over cho F8. |
| OQ-7 | Có làm trang chi tiết Policy `/policies/:id` ở F7 không? (`UI_UX_design.md` §7.2 — 2 tab gán Group/Device) | **Không** — toàn bộ nội dung trang đó (2 tab "Đang gán cho Group/Device") là dữ liệu assignment chưa tồn tại ở F7; dựng ở F7 sẽ là trang gần như trống, cùng lý do và cùng quyết định đã áp dụng cho Group Detail ở F5 OQ-5. Menu ⋯ ở F7 không render action "Xem chi tiết" (tránh nút chết). F8 thêm route + nội dung thật. Nếu chọn làm ở F7: bổ sung route + `GET /api/v1/policies/:id`, sửa scenario `(pending OQ-7)`. | **Chốt theo khuyến nghị.** Không làm Policy Detail ở F7; nghĩa vụ carry-over cho F8. |
| OQ-8 | Giới hạn độ dài `name`/`type`? PRD không nói. | `name`: bắt buộc, sau trim dài **1–100** ký tự (nhất quán F5 OQ-8). `type`: bắt buộc, sau trim dài **1–100** ký tự. Đây là quy ước chặn dữ liệu rác, không phải yêu cầu nghiệp vụ — có thể đổi số cụ thể khi `/design` mà không ảnh hưởng scenario (viết theo "dài hơn giới hạn cho phép"). | **Chốt theo khuyến nghị.** `name`/`type`: 1–100 ký tự sau trim. |
| OQ-9 | Khi deactivate 1 Policy đang `active`, F7 có cần cảnh báo "đang được gán cho N group/device" không? (`UI_UX_design.md` §7.1 mô tả cảnh báo này) | **Không ở F7** — chưa có `policy_assignments` nên N luôn = 0, hiện cảnh báo với số giả gây hiểu nhầm. **Nghĩa vụ carry-over bắt buộc cho F8**: khi có bảng `policy_assignments`, F8 phải bổ sung cảnh báo thật kèm số lượng chính xác trước khi cho phép deactivate, và quyết định hành vi cụ thể (giữ gán nhưng ngưng hiệu lực, hay gỡ gán) — ghi trong `DESIGN.md` của F8. Nghĩa vụ này phải được nhắc lại trong SoT F8. | **Chốt theo khuyến nghị.** Không cảnh báo ở F7; nghĩa vụ carry-over ghi rõ trong SoT F8 khi brainstorm F8. |
| OQ-10 | `status` mặc định là gì khi tạo Policy không truyền field này? | **`active`** — nhất quán với `Device#status` (`default: 0` = active trong schema hiện tại) và với kỳ vọng thông thường "tạo xong dùng được ngay", giảm thao tác thừa cho user (không phải bấm thêm 1 bước để kích hoạt policy vừa tạo). | **Chốt theo khuyến nghị.** Mặc định `active`. |

**Rủi ro/giả định:**
- **Xung đột với `UI_UX_design.md` §7.1 — ĐÃ QUYẾT ĐỊNH (2026-09-17, qua
  Claude Code, theo ủy quyền của user)**, theo đúng yêu cầu `CLAUDE.md` §5
  ("Mâu thuẫn giữa SoT và `UI_UX_design.md` → dừng lại, báo cáo, không tự
  chọn" — đã dừng lại, báo cáo qua §12 OQ-3, và người có thẩm quyền (user,
  ủy quyền cho Claude Code trong phiên) đã ra quyết định thay vì để trống):
  `UI_UX_design.md` §7.1 viết `type` là "select, danh sách type cố định
  theo domain — liệt kê rõ trong DESIGN.md", nhưng PRD.md không cho bất kỳ
  danh sách type cụ thể nào của domain này (chỉ nói `name, type,
  configuration, status`) — tự bịa ra một enum (vd "password"/"wifi") là
  nghiệp vụ ngoài đề. **Quyết định**: giữ `type` free-form string ở DB (OQ-3),
  nhưng FE hiện field này dưới dạng **combobox có gợi ý** (không phải input
  text trơn, không phải `<select>` đóng cứng) — nạp gợi ý từ các giá trị
  `type` distinct đã tồn tại trong org, cho phép gõ mới. Đây là cách hiện
  thực hoá tinh thần "chọn từ danh sách" của `UI_UX_design.md` mà không cần
  một enum domain cứng không có nguồn trong PRD. Phải ghi lại quyết định +
  lý do này trong `DESIGN.md` (mục thiết kế F7 và mục "3. AI") khi implement,
  không được lặng lẽ chọn 1 trong 2 hướng lúc code.
- Cột "Số nơi đang gán" và trang Policy Detail (`UI_UX_design.md` §7.1,
  §7.2) bị hoãn toàn bộ sang F8 (OQ-6, OQ-7) — sai khác có chủ đích so với
  tài liệu UI/UX nền, phải ghi vào `DESIGN.md` khi implement F7 và phải
  được F8 khôi phục đầy đủ, đúng tinh thần đã làm với Group Detail ở
  F5→F6.
- Cảnh báo "đang được gán cho N group/device" khi deactivate
  (`UI_UX_design.md` §7.1) bị hoãn sang F8 (OQ-9) — nếu F8 quên bổ sung,
  invariant "không gán Policy inactive" sẽ chỉ được validate ở backend mà
  không có cảnh báo trước ở UI, vẫn đúng nghiệp vụ nhưng trải nghiệm kém
  hơn thiết kế gốc.
- Giả định **không có role nội bộ Organization** (mọi user active đều
  tạo/sửa được policy) — nhất quán F0–F5 và PRD không nhắc tới role.
- `configuration` dùng cột JSON ở DB — quyết định `json` vs `jsonb` chốt ở
  `/design F7-db`, nhưng SoT khuyến nghị `jsonb` để F9 so sánh
  `configuration` hiệu quả hơn (xem §10).

**Đã approve (2026-09-17, qua Claude Code, theo ủy quyền của user):** toàn bộ
10 OQ chốt theo phương án khuyến nghị (bảng trên); mọi tag `(pending OQ-n)` ở
§11 đã được rà lại và gỡ bỏ; mâu thuẫn OQ-3 với `UI_UX_design.md` §7.1 đã được
giải quyết tường minh (xem trên) thay vì bỏ trống. `status` ở đầu file đã set
`approved`.
