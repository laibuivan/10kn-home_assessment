# UI/UX Specification — Device Management Console

> Tài liệu này đặc tả giao diện & tương tác cho FE (Vue SPA) dựa trên PRD "Senior Ruby on Rails – Take-home Assessment".
> Mục tiêu: đủ chi tiết để implement thẳng (component, state, API contract giả định, hành vi khi lỗi/rỗng/loading), không cần hỏi lại thiết kế.

---

## 0. Nguyên tắc thiết kế chung

1. **Không có trang chết / nút chết** — mọi action đều có state loading + success + error.
2. **Không bao giờ render danh sách không giới hạn** — mọi list đều phân trang (server-side), kể cả dropdown chọn device/group nếu số lượng lớn thì phải search/async-select, không load hết vào `<select>`.
3. **Group lớn (10k devices) là first-class concern** — bất kỳ đâu hiển thị số lượng device của 1 group phải dùng `count` từ API (không đếm mảng ở FE), và hành động gán Policy cho Group phải là **async job có trạng thái theo dõi được** (xem mục 6.3).
4. **Feedback tức thời**: mọi submit disable nút + hiện spinner trong nút; toast báo kết quả; lỗi field-level bám theo field, lỗi chung hiện banner trên form.
5. **Consistency**: 1 bộ component dùng chung cho toàn bộ 3 module Devices/Groups/Policies (table, filter bar, pagination, confirm modal, status badge, drawer chi tiết).
6. **Multi-tenant an toàn ở tầng UI**: FE không tự ý truyền `organization_id` trong body/query của bất kỳ request nào — token/session quyết định org, để tránh dev vô tình tạo lỗ hổng IDOR khi build FE. (Backend vẫn phải enforce, nhưng UI không được có input nào cho phép chọn org khác.)

---

## 1. Stack & cấu trúc FE đề xuất

- Vue 3 (Composition API) + Vite + TypeScript
- Pinia (state: `authStore`, `deviceStore`, `groupStore`, `policyStore`, `jobStore`)
- Vue Router (route guard kiểm tra session cho mọi route trừ `/login`)
- Tailwind CSS (utility, dựng nhanh, dễ nhất quán) — hoặc component lib nhẹ nếu Claude Code thấy hợp lý hơn, nhưng **giữ 1 lựa chọn duy nhất, không mix 2 lib UI**.
- Axios instance có interceptor:
  - Tự đính kèm token (Authorization header).
  - Bắt lỗi 401 → redirect `/login` + toast "Phiên đăng nhập hết hạn".
  - Bắt lỗi 422/400 → trả object lỗi field-level lên form.
  - Bắt lỗi 500/network → toast lỗi chung + không phá UI hiện tại.

```
web/src/
  api/            # axios instance + endpoint functions theo resource
  components/     # component dùng chung (xem mục 5)
  stores/
  views/
    LoginView.vue
    devices/DeviceListView.vue
    devices/DeviceDetailView.vue
    groups/GroupListView.vue
    groups/GroupDetailView.vue
    policies/PolicyListView.vue
    policies/PolicyDetailView.vue
  router/
```

---

## 2. Information Architecture / Routes

| Path | Yêu cầu auth | Mô tả |
|---|---|---|
| `/login` | không | Đăng nhập |
| `/devices` | có | Danh sách Device, filter, phân trang, tạo mới (modal) |
| `/devices/:id` | có | Chi tiết Device |
| `/groups` | có | Danh sách Group, tạo/sửa (modal), xóa (confirm) |
| `/groups/:id` | có | Chi tiết Group: thành viên, gán policy |
| `/policies` | có | Danh sách Policy, tạo/sửa (modal) |
| `/policies/:id` | có | Chi tiết Policy: nơi đang được gán (group/device), gán mới |

Layout khung (áp dụng mọi trang trừ `/login`):

```
┌─────────────────────────────────────────────┐
│ Topbar: Logo | Org name (readonly)  ...  User▾ Logout │
├───────────┬─────────────────────────────────┤
│ Sidebar   │  Content area (view hiện tại)   │
│ - Devices │                                 │
│ - Groups  │                                 │
│ - Policies│                                 │
└───────────┴─────────────────────────────────┘
```
- Sidebar item active = highlight.
- Topbar hiện tên Organization của user đang đăng nhập (để reviewer tự xác nhận không lẫn org khi bấm qua lại 2 tài khoản seed).

---

## 3. Trang: Login

**Mục đích**: đăng nhập bằng tài khoản seed, sai thì báo lỗi rõ.

**Layout**: form căn giữa màn hình, card nhỏ.
- Input `email`
- Input `password` (toggle show/hide)
- Nút "Đăng nhập" (disabled khi đang submit, hiện spinner trong nút)
- Banner lỗi phía trên form khi sai (không dùng `alert()`)

**States**
- Idle: form trống, nút enable khi cả 2 field có giá trị hợp lệ định dạng (email regex cơ bản; không cần validate mạnh vì server sẽ trả lỗi thật).
- Submitting: disable input + nút, spinner trong nút.
- Error: 
  - 401 (sai email/password) → banner: "Email hoặc mật khẩu không đúng."
  - 403 (user không `active`) → banner: "Tài khoản đã bị vô hiệu hóa, liên hệ quản trị viên."
  - network/500 → banner: "Không thể kết nối máy chủ, thử lại sau."
- Success: lưu token vào store (không lưu ở nơi dễ lộ ngoài chuẩn — localStorage chấp nhận được cho bài test, nêu rõ trong DESIGN.md), redirect `/devices`.

**Ghi chú test thủ công**: trang login phải cho phép reviewer thấy rõ tài khoản seed org A không login được nếu gõ sai org (dùng đúng email/password thì login vào đúng org tương ứng — không có chỗ nào để chọn org, org được suy ra từ email).

---

## 4. Trang: Devices List (`/devices`)

**Layout**
```
[ Devices ]                                   [+ Thêm Device]
┌ Filter bar ────────────────────────────────────────────┐
│ Platform: [Tất cả▾]   Status: [Tất cả▾]   [Xóa lọc]     │
└──────────────────────────────────────────────────────┘
┌ Table ──────────────────────────────────────────────────┐
│ Identifier | Name | Platform | OS Version | Status | Last seen | ⋯ │
│ ...rows... (click row → /devices/:id)                    │
└──────────────────────────────────────────────────────────┘
[ Pagination: ‹ 1 2 3 … 42 › ]   Hiển thị 1–20 / 837
```

**Filter bar**
- `Platform`: select (Tất cả / ios / android / macos)
- `Status`: select (Tất cả / active / inactive / retired)
- Filter thay đổi → gọi lại API với query param, reset về page 1, cập nhật URL query string (để share link / F5 giữ filter).
- "Xóa lọc" chỉ hiện khi có filter đang áp dụng.

**Table**
- Cột `Status`: badge màu (active=xanh lá, inactive=xám, retired=đỏ nhạt/khóa icon).
- Cột hành động `⋯`: "Sửa" (mở modal edit), "Xem chi tiết".
- Nếu device `retired`: nút "Sửa" disable với tooltip "Thiết bị đã retired, không thể sửa" (trừ khi có luồng un-retire — nếu Claude Code implement un-retire, thêm action "Un-retire" ở đây và ghi vào DESIGN.md).

**Tạo/Sửa Device** — modal (không cần trang riêng):
- Field: identifier (bắt buộc, disable khi edit vì unique-per-org & thường không đổi sau khi tạo — quyết định này ghi vào DESIGN.md), name, platform (select), os_version, status (select, chỉ hiện khi edit — tạo mới mặc định `active`).
- Validate client-side cơ bản (required, platform hợp lệ), lỗi server (vd trùng identifier trong org) hiện ngay dưới field tương ứng bằng cách map lỗi 422 trả về theo field name.
- Submit thành công → đóng modal, toast "Đã tạo/cập nhật device", refresh list tại đúng trang hiện tại.

**States**
- Loading: skeleton rows (5 dòng xám nhấp nháy), giữ filter bar hiển thị bình thường (không loading toàn trang).
- Empty (không có device nào / filter không match): illustration/icon nhẹ + text "Không có thiết bị nào" + nếu đang có filter thì thêm nút "Xóa lọc".
- Error (API fail): banner đỏ trong khu vực bảng: "Không tải được danh sách thiết bị." + nút "Thử lại". Không để trang trắng, không spinner treo vô hạn (timeout ~15s tự chuyển sang error state).

---

## 5. Trang: Device Detail (`/devices/:id`)

**Layout** — 3 khối:
```
◀ Quay lại danh sách
┌ Header ──────────────────────────────────────────┐
│ [identifier]  Badge(status)                       │
│ name · platform · os_version · last_seen_at       │
│                                    [Sửa] [⋯]       │
└────────────────────────────────────────────────────┘
┌ Groups đang thuộc ───────┐ ┌ Policy đang áp dụng ───┐
│ - Group A (link)         │ │ Bảng: Name | Type |     │
│ - Group B (link)         │ │ Nguồn (Group X / Trực   │
│ [+ Thêm vào group]       │ │ tiếp) | Trạng thái       │
│                          │ │                          │
└──────────────────────────┘ │ ⚠ Conflict banner nếu có │
                              └──────────────────────────┘
```

**Khối "Policy đang áp dụng"** (quan trọng nhất theo PRD):
- Liệt kê **policy hiệu lực cuối cùng theo từng `type`**, không chỉ liệt kê raw list.
- Mỗi dòng: `type`, tên policy thắng, **nguồn** (badge: "Trực tiếp" hoặc "Từ group: <tên group>"), và một link "Xem tất cả nguồn" mở popover/accordion liệt kê toàn bộ policy cùng `type` đang gán (kể cả policy bị override) kèm lý do bị loại (vd "Bị ghi đè bởi gán trực tiếp" / "Ưu tiên thấp hơn theo rule X" — rule cụ thể do backend quyết định và phải khớp với DESIGN.md).
- Nếu có conflict cùng `type` mà không tự động resolve rõ ràng, hiện banner cảnh báo màu vàng ở đầu khối, không được im lặng chọn 1 cái ngẫu nhiên mà không giải thích trên UI.
- Nếu device chưa có policy nào → empty state nhỏ: "Chưa có policy nào áp dụng."

**Khối "Groups đang thuộc"**:
- List tên group (link tới `/groups/:id`), nút "Thêm vào group" mở modal chọn group (search-as-you-type, không load hết list group vào 1 dropdown nếu nhiều).
- Mỗi group trong list có nút "x" để gỡ khỏi group → confirm nhỏ trước khi gỡ.

**Retired device**:
- Nếu `status = retired`: ẩn/disable toàn bộ nút "Sửa", "Thêm vào group", "Gỡ khỏi group", "Gán policy trực tiếp"; hiện banner xám: "Thiết bị đã retired — không thể chỉnh sửa." (+ nút Un-retire nếu có implement).

**States**: loading (skeleton cho cả 3 khối độc lập — khối policy có thể load chậm hơn khối info vì phải tính toán, nên tách loading riêng từng khối), error riêng từng khối (1 khối lỗi không kéo sập cả trang), 404 (device không tồn tại hoặc thuộc org khác) → trang "Không tìm thấy thiết bị" với nút quay lại danh sách (đây cũng là điểm kiểm tra chống leak chéo org: id của org khác phải trả 404, không phải 403 lộ thông tin tồn tại).

---

## 6. Trang: Groups

### 6.1 Group List (`/groups`)

**Layout**: giống Devices List nhưng đơn giản hơn (không cần filter phức tạp, có thể chỉ cần search theo tên).
```
[ Groups ]                                    [+ Thêm Group]
[ Search theo tên... ]
┌ Table ─────────────────────────────────────┐
│ Name | Description | Số device | ⋯          │
└──────────────────────────────────────────────┘
[ Pagination ]
```
- Cột "Số device" lấy từ `devices_count` do API trả sẵn (không FE tự đếm).
- Hành động `⋯`: Sửa, Xóa, Xem chi tiết.
- **Xóa Group**: confirm modal bắt buộc, nội dung rõ ràng: "Xóa group '<tên>' sẽ gỡ toàn bộ liên kết với <N> device và policy đang gán cho group này. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác." → nút "Xóa" màu đỏ, nút "Hủy". Sau khi xóa: toast + refresh list.

### 6.2 Group Detail (`/groups/:id`)

**Layout** — 2 tab hoặc 2 khối:
```
◀ Quay lại
[Tên group]  [Sửa] [Xóa]
Mô tả: ...

Tab: [ Thành viên (N) ]  [ Policies ]
```

**Tab Thành viên**:
- Table phân trang device thuộc group (server-side, vì có thể 10.000 dòng) — **dùng cùng component table/pagination với Devices List**.
- Có filter platform/status ngay trong tab này (tái dùng filter bar).
- Nút "+ Thêm device vào group": mở modal với ô search device theo identifier/name (debounce, gọi API search, không load hết), chọn nhiều (checkbox) → "Thêm đã chọn". Với group cực lớn, không cho "thêm tất cả device trong hệ thống" bằng 1 click không giới hạn mà không xác nhận số lượng — nếu có tính năng "thêm hàng loạt theo filter", phải hiện rõ số lượng sẽ bị ảnh hưởng trước khi confirm và chạy async giống mục 6.3.
- Mỗi row có nút "Gỡ khỏi group" (confirm nhỏ dạng inline, không cần modal to).

**Tab Policies (Policy gán cho Group)**:
- List policy đang gán cho group (name, type, status).
- Nút "+ Gán policy" → mở modal chọn policy (chỉ hiện policy `status = active`, search theo tên) → confirm → **kích hoạt async job** (xem 6.3) vì group có thể rất lớn.
- Nút gỡ policy khỏi group: confirm modal.

### 6.3 Gán Policy cho Group lớn — UX bắt buộc theo PRD

Đây là điểm chấm điểm quan trọng: "user hiểu được việc đang chạy / đã xong / thất bại".

**Flow**:
1. User chọn policy trong modal "Gán policy" → bấm "Gán".
2. FE gọi API tạo job (vd `POST /groups/:id/policy_assignments` trả về `{ job_id, status: "queued" }`) — **không** block UI chờ xử lý xong toàn bộ 10.000 device trong 1 request đồng bộ.
3. Đóng modal, hiện **toast/banner sticky** dạng "job tracker" ở góc dưới màn hình (giống banner upload file):
   ```
   ⏳ Đang gán policy "Security Baseline" cho 8,420 thiết bị...   [Xem]
   ```
4. FE poll trạng thái job định kỳ (vd mỗi 2s, dùng `GET /jobs/:job_id`) hoặc qua ActionCable nếu Claude Code chọn implement — **poll đơn giản là đủ, ưu tiên chắc chắn hơn realtime**.
5. Banner cập nhật theo trạng thái job:
   - `queued` → "Đang chờ xử lý..."
   - `running` → progress nếu backend trả `processed/total` (progress bar); nếu backend không trả tiến độ chi tiết thì tối thiểu hiện spinner + "Đang xử lý...".
   - `completed` → banner chuyển xanh: "✅ Đã gán policy cho 8,420 thiết bị." tự ẩn sau vài giây, có nút "Đóng".
   - `failed` (một phần hoặc toàn phần) → banner đỏ: "⚠ Gán policy thất bại (hoặc thất bại một phần: x/8420). [Xem chi tiết] [Thử lại]". Không được im lặng nuốt lỗi.
6. Nếu user rời trang Group detail trong lúc job đang chạy rồi quay lại (hoặc F5), trang phải tự kiểm tra "có job đang chạy cho group này không" (gọi API list job theo group) để re-attach banner tracker, không mất trạng thái theo dõi.
7. **Idempotency ở UI**: nếu user bấm "Gán" lại policy đã được gán/đang gán cho group đó, hiện cảnh báo trước "Policy này đã được gán cho group. Gán lại sẽ không tạo trùng." (backend đảm bảo idempotent, FE chỉ cần không chặn nhưng thông báo rõ để tránh hiểu lầm).

Component job tracker này nên là 1 component dùng chung `AsyncJobBanner.vue`, có thể tái dùng nếu sau này có job async khác.

---

## 7. Trang: Policies

### 7.1 Policy List (`/policies`)

**Layout**: giống Group List.
```
[ Policies ]                                   [+ Thêm Policy]
[ Search ]   Status: [Tất cả▾]
┌ Table: Name | Type | Status | Số nơi đang gán | ⋯ ┐
[ Pagination ]
```
- "Số nơi đang gán" = tổng số group + device đang gán trực tiếp (từ API).

**Tạo/Sửa Policy** — modal:
- name, type (select, danh sách type cố định theo domain — liệt kê rõ trong DESIGN.md), status (active/inactive), `configuration` — **dùng JSON editor có validate cú pháp** (textarea + parse JSON.parse khi blur, hiện lỗi "JSON không hợp lệ" nếu sai, không cho submit khi JSON lỗi cú pháp). Có thể dùng component đơn giản (textarea + nút "Format") thay vì thư viện nặng nếu Claude Code muốn tối giản.
- Khi sửa policy đang `active` → `inactive`: cảnh báo "Policy đang được gán cho N group/device. Chuyển sang inactive sẽ khiến các nơi này không còn nhận policy này." (xác nhận trước khi lưu) — quyết định hành vi cụ thể (giữ gán nhưng ngưng hiệu lực, hay gỡ gán) ghi trong DESIGN.md.

### 7.2 Policy Detail (`/policies/:id`)

**Layout**:
```
◀ Quay lại
[Tên policy]  Badge(status)  Type: xxx        [Sửa]
Configuration (JSON, hiển thị dạng code block, có nút Copy)

Tab: [ Đang gán cho Group (N) ] [ Đang gán cho Device (N) ]
```
- Tab Group: list group đang gán policy này, nút "Gán thêm cho group" (search group, chỉ cho chọn nếu policy `active`; nếu policy `inactive`, nút bị disable với tooltip "Policy không active, không thể gán").
- Tab Device: tương tự, list + gán trực tiếp cho device cụ thể (search theo identifier).
- Gán policy `inactive` phải bị chặn ở UI (disable) **và** phải test rằng nếu bằng cách nào đó gọi thẳng API vẫn bị chặn ở backend — ghi rõ đây là double-check trong DESIGN.md.

---

## 8. Component dùng chung (bắt buộc build 1 lần, tái dùng khắp nơi)

| Component | Dùng ở đâu | Ghi chú |
|---|---|---|
| `DataTable.vue` | Devices/Groups/Policies list, Group members tab | Props: columns, rows, loading, error, onRowClick; slot cho cột action |
| `PaginationBar.vue` | mọi list | Hiện "Hiển thị x–y / tổng", nút prev/next + nhảy trang, disable khi loading |
| `FilterBar.vue` | Devices list, Group members tab | select-based filter, đồng bộ với URL query |
| `StatusBadge.vue` | Device/Policy status | map màu theo giá trị |
| `ConfirmModal.vue` | mọi hành động xóa/gỡ | props: title, message, confirmLabel (đỏ nếu destructive), onConfirm (async, tự disable khi đang xử lý) |
| `FormModal.vue` | Tạo/sửa Device/Group/Policy | slot form, xử lý lỗi field-level từ response 422 |
| `AsyncSearchSelect.vue` | chọn device/group/policy trong modal gán | debounce input, gọi API search, hiển thị loading trong dropdown, empty state "Không tìm thấy" |
| `AsyncJobBanner.vue` | gán policy cho group lớn | mục 6.3 |
| `EmptyState.vue` | mọi list/khối rỗng | icon + text + optional CTA |
| `ErrorState.vue` | mọi khối lỗi | text + nút "Thử lại" |
| `Toast` (dùng lib nhỏ hoặc tự viết) | mọi thao tác thành công/thất bại | auto-dismiss, có thể xếp chồng |

---

## 9. Ma trận Loading / Empty / Error (áp dụng chung, không lặp lại ở từng trang)

| Tình huống | Hiển thị |
|---|---|
| List đang tải lần đầu | Skeleton rows, giữ nguyên khung filter/nút để không giật layout |
| List tải lại do đổi filter/trang | Overlay mờ nhẹ lên bảng cũ + spinner nhỏ góc, KHÔNG xóa trắng bảng cũ rồi mới hiện (tránh giật) |
| List không có data | EmptyState với CTA phù hợp ("+ Thêm Device" nếu chưa từng có device nào; "Xóa lọc" nếu do filter) |
| List lỗi tải | ErrorState + nút Thử lại, giữ filter bar hoạt động |
| Form submit lỗi validate (422) | Lỗi hiện dưới từng field tương ứng theo key trả về từ API |
| Form submit lỗi khác (500/network) | Banner đỏ trên đầu form: "Có lỗi xảy ra, vui lòng thử lại." |
| Xóa | Luôn qua `ConfirmModal`, nút xác nhận disable + spinner khi đang gọi API, đóng modal + toast khi xong |
| Trang chi tiết với id không tồn tại/khác org | Trang 404 nội bộ, không throw lỗi trắng trang |
| Job async (gán policy group lớn) | Xem mục 6.3 đầy đủ 4 trạng thái queued/running/completed/failed |

---

## 10. Validate & thông báo lỗi — quy tắc chung

- Mọi field bắt buộc: viền đỏ + text lỗi ngay dưới field khi blur hoặc submit.
- Lỗi trùng dữ liệu unique (identifier trùng trong org, email trùng...) phải hiển thị đúng field đó, message rõ ràng bằng tiếng Việt, vd: "Identifier này đã tồn tại trong tổ chức của bạn."
- Không dùng `alert()`/`confirm()` JS mặc định ở bất kỳ đâu — dùng modal/toast tự viết để nhất quán style và test được bằng Playwright/Cypress nếu cần.
- Không để `console.error`/`console.log` sót lại trong code production (ESLint rule `no-console` nên bật).

---

## 11. Ghi chú bàn giao cho Claude Code

- Ưu tiên implement đủ 7 trang + component dùng chung trước, sau đó mới polish visual.
- API contract cụ thể (field name, response shape, mã lỗi) sẽ do phần backend (Rails) quyết định trước — FE nên định nghĩa 1 lớp `types/` (TypeScript interfaces) khớp với response Rails serializer, và một file `api/index.ts` tập trung toàn bộ endpoint để dễ sửa khi backend đổi field.
- Toàn bộ quyết định thiết kế có ảnh hưởng nghiệp vụ trong tài liệu này (vd: hành vi khi inactive 1 policy đang được gán, cơ chế resolve conflict cùng-type, có/không có un-retire) phải được đối chiếu và note lại trong `DESIGN.md` của phần backend để nhất quán giữa 2 tài liệu.
- Nếu thời gian hạn chế, có thể gộp trang Tạo/Sửa vào modal (đã thiết kế theo hướng này ở trên) thay vì route riêng, để giảm số màn hình nhưng vẫn đủ chức năng theo PRD.