---
feature_id: F2
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

# Thiết kế Frontend — F2

Nguồn: `docs/design/F2-api.md` (approved), `docs/sot/F2-device-list.md`
(approved), `UI_UX_design.md` (§0 nguyên tắc, §1 stack, §2 IA/layout, §4
Devices List, §8 component dùng chung, §9 ma trận loading/empty/error, §10
validate, §12 design tokens), `PRD.md` bảng "Giao diện bắt buộc",
`web/src/` hiện có (`AppShell.vue`, `stores/auth.ts`, `api/client.ts`,
`router/index.ts`, `views/LoginView.vue`, `views/devices/DeviceListView.vue`
placeholder — tất cả từ F0, approved).

**Preview trực quan (bắt buộc, duyệt cùng lúc với file này):**
`docs/design/F2-frontend-preview.html`.

**Quyết định phạm vi quan trọng — khớp SoT §3 "Ngoài phạm vi", lệch có chủ
đích với mockup đầy đủ ở `UI_UX_design.md` §4:** mockup §4 vẽ layout **đầy đủ**
của Devices List (bao gồm nút `[+ Thêm Device]` và cột hành động `⋯` với
"Sửa"/"Xem chi tiết") — đó là đặc tả **gộp cả F2+F3+F4**. F2 SoT §3 đã quyết
định (và approved) rằng F2 chỉ làm slice đọc-only: filter + table + pagination
— **không** có nút "+ Thêm Device", **không** click-through vào row, **không**
cột `⋯`, vì trang đích (`/devices/:id`) và modal tạo/sửa chưa tồn tại (đúng
nguyên tắc "không nút chết" — `UI_UX_design.md` §0.1). Thiết kế dưới đây tuân
theo SoT, không tự vẽ lại các phần đó — xem thêm §5 Rủi ro bên dưới.

**Component dùng chung mới**: `UI_UX_design.md` §8 định nghĩa `DataTable.vue`,
`PaginationBar.vue`, `FilterBar.vue`, `StatusBadge.vue`, `EmptyState.vue`,
`ErrorState.vue` nhưng **chưa file nào tồn tại** trong `web/src/components/`
(chỉ có `AppShell.vue` từ F0). F2 là feature đầu tiên thật sự build 6
component này — thiết kế props ở đây phải đủ tổng quát để F3 (Groups/Policies
list), F4 (detail — ErrorState/EmptyState theo khối), F5 (Group list),
F6/F7 tái dùng nguyên vẹn, không phải sửa lại props theo nhu cầu riêng của F2.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/devices` | `views/devices/DeviceListView.vue` | Route đã tồn tại từ F0 (bọc `AppShell`), F2 **thay nội dung placeholder** bằng bảng thật — không đổi route/`AppShell`. Sidebar "Devices" chuyển từ `nav-item active` (F0 hard-code) sang **active theo route thật** (`RouterLink` đã dùng `class="active"` tĩnh ở F0 — F2 không cần sửa vì `/devices` vẫn là route duy nhất tồn tại; F5/F7 mới là nơi phải đổi sang active-theo-route khi có ≥2 route thật, đã ghi ở `F0-frontend.md` §5 rủi ro, không lặp lại ở đây). |

Component con dùng trong `DeviceListView.vue` (mới, tại `web/src/components/`):

| Component | Vai trò trong F2 |
|---|---|
| `FilterBar.vue` | Select Platform + Select Status + nút "Xóa lọc" (điều kiện) |
| `DataTable.vue` | Bảng 6 cột (Identifier/Name/Platform/OS Version/Status/Last seen), `onRowClick` **không truyền** ở F2 |
| `StatusBadge.vue` | Render badge cột Status, dùng lại class `.badge.active/.inactive/.retired` đã có sẵn ở `components.css` |
| `PaginationBar.vue` | "Hiển thị x–y / tổng" + prev/next + số trang |
| `EmptyState.vue` | 2 biến thể nội dung (A1 không CTA, A2 có nút "Xóa lọc") |
| `ErrorState.vue` | Banner đỏ + nút "Thử lại" (A11) |

## 2. Element / Trigger / Action / Notes

| Element | Trigger | Action | Notes |
|---|---|---|---|
| `DeviceListView` mount | mount lần đầu / điều hướng vào `/devices` | Đọc `route.query` (`platform`, `status`, `page`), **sanitize** rồi gọi `deviceStore.fetchDevices({ platform, status, page })` | Sanitize (xem §5 OQ-FE-1/2): giá trị `platform`/`status` không nằm trong enum → bỏ qua (coi như "tất cả"), không gửi lên API; `page` không phải số nguyên dương → mặc định `1`. Đây là bước làm **trước khi gọi API**, không phải xử lý lỗi 422 trả về. |
| `route.query` đổi (back/forward button, hoặc do chính view `router.replace`) | watcher trên `route.query` | Re-chạy đúng logic sanitize + `fetchDevices` ở trên | Đảm bảo URL luôn là **nguồn sự thật duy nhất** cho filter/trang hiện tại — store không tự giữ state filter riêng để tránh lệch với URL (xem §3). |
| `FilterBar` — select Platform | `change` | Đọc giá trị mới, `router.replace({ query: { ...currentQuery, platform: value \|\| undefined, page: undefined } })` | Đổi filter **luôn reset về page 1** (bỏ hẳn key `page` khỏi query thay vì set `=1`, để URL gọn — cả 2 cách đều hợp lệ, chọn cách này) — SoT §5.1. `router.replace` (không `push`) để mỗi lần đổi filter không tạo thêm 1 entry lịch sử trình duyệt riêng (tránh User bấm Back phải bấm nhiều lần mới thoát trang Devices). |
| `FilterBar` — select Status | `change` | Y hệt Platform ở trên | Kết hợp filter là AND tự nhiên vì cả 2 key cùng nằm trong 1 query object (A3). |
| `FilterBar` — nút "Xóa lọc" | click | `router.replace({ query: {} })` | Chỉ **hiện nút này khi** `route.query.platform` hoặc `route.query.status` có giá trị (SoT §5.1, `UI_UX_design.md` §4). |
| `PaginationBar` — nút Prev/Next/số trang | click | `router.replace({ query: { ...currentQuery, page: n === 1 ? undefined : String(n) } })` | **Giữ nguyên filter hiện tại** (SoT §5.1) — chỉ đổi key `page`. Disable khi `loading` hoặc khi `n` ngoài `[1, meta.total_pages]`. |
| `DataTable` — row | — (không có trigger) | — | **Không click-through** (quyết định SoT §3, xem đầu file) — `onRowClick` prop không truyền, row không có `cursor: pointer`/hover-highlight (xem lưu ý CSS ở §5). |
| `ErrorState` — nút "Thử lại" | click | Gọi lại đúng `fetchDevices` với params hiện tại (không đổi URL) | A11 — filter bar vẫn hoạt động bình thường trong lúc bảng đang lỗi (SoT §7). |
| `EmptyState` — nút "Xóa lọc" (chỉ ở biến thể A2) | click | Giống hệt nút "Xóa lọc" của `FilterBar` — `router.replace({ query: {} })` | A2 — chỉ hiện khi danh sách rỗng **và** đang có filter áp dụng. |

## 3. State management

- **`stores/devices.ts`** (Pinia, theo đúng pattern `stores/auth.ts`):
  - State: `devices: Device[]`, `meta: DeviceListMeta \| null`,
    `loading: boolean`, `error: string \| null`.
  - **Không** giữ `filters`/`page` trong store — `route.query` (Vue Router) là
    nguồn sự thật duy nhất cho filter/trang hiện tại (tránh 2 nguồn state lệch
    nhau khi F5 reload hoặc back/forward). `DeviceListView` đọc `route.query`,
    truyền tường minh vào action mỗi lần gọi.
  - Action `fetchDevices({ platform?, status?, page }: DeviceQueryParams): Promise<void>`:
    - `loading = true`, giữ nguyên `devices`/`meta` cũ trong lúc loading (để
      `DataTable` tự quyết định skeleton vs. overlay theo `rows.length`, xem
      §4).
    - Gọi `fetchDeviceList(params)` (hàm ở `api/devices.ts`, dùng lại
      `apiClient` có sẵn — **không** tạo axios instance mới).
    - Thành công: set `devices = response.devices`, `meta = response.meta`,
      `error = null`.
    - Thất bại: set `error = <message>` (dùng lại logic trích message từ
      response 422/`{error}`/network — xem ghi chú refactor ở §5), **giữ
      nguyên** `devices`/`meta` cũ (không xóa trắng bảng khi lỗi xảy ra lúc
      đổi trang — nhất quán với ma trận loading/error `UI_UX_design.md` §9,
      dù trong trường hợp lỗi ErrorState sẽ che bảng cũ bằng banner, không
      hiển thị đồng thời).
    - `loading = false` ở `finally`.
  - Không có `hydrate()`/persist nào cho store này — dữ liệu list luôn fetch
    mới mỗi lần route đổi, không cache giữa các lần điều hướng (đủ dùng cho
    scope bài test, không tối ưu thêm).
- **`api/devices.ts`** (mới): 1 hàm `fetchDeviceList(params: { platform?: string; status?: string; page: number }): Promise<DeviceListResponse>` gọi `apiClient.get('/api/v1/devices', { params })`. Không set `per_page` — xem OQ-FE-3 (§5): F2 không có UI chọn `per_page`, luôn dùng default server-side (`20`).
- **`types/device.ts`** (mới): `Device`, `DeviceListMeta`, `DeviceListResponse`, `DevicePlatform`, `DeviceStatus` — khớp tuyệt đối shape đã approved ở `docs/design/F2-api.md` §1 (không tự thêm/bớt field).
- **`DeviceListView.vue`** local state: computed `activeQuery` (đọc + sanitize `route.query`), computed `hasActiveFilter` (dùng cho hiển thị nút "Xóa lọc" + chọn biến thể EmptyState A1 vs A2), watcher gọi `deviceStore.fetchDevices`.
- List lớn: phân trang thật qua query `page`/`per_page` (server-side, `DataTable` chỉ render đúng `meta.per_page` dòng của trang hiện tại, không bao giờ tự tải hết rồi cắt ở FE).

## 4. Empty / loading / error / success

Theo `UI_UX_design.md` §9, cụ thể hoá cho F2:

- **Loading — lần tải đầu tiên** (`loading === true && devices.length === 0`):
  `DataTable` render 5 dòng skeleton (xám, nhấp nháy nhẹ), `FilterBar` vẫn
  hiển thị bình thường (select không disable — cho phép đổi filter ngay cả
  khi đang tải, request cũ bị bỏ qua kết quả nếu request mới đã gửi — không
  cần AbortController ở scope F2, tần suất thao tác thấp, chấp nhận race
  hiếm gặp).
- **Loading — đổi filter/trang** (`loading === true && devices.length > 0`):
  overlay mờ nhẹ lên bảng cũ (giữ nguyên dòng cũ, không xóa trắng), spinner
  nhỏ góc trên bảng. `PaginationBar` disable nút prev/next/số trang trong lúc
  này (tránh double-click gây 2 request chồng nhau).
- **Empty — A1 (org chưa có device nào, không do filter)**: `hasActiveFilter === false && meta.total_count === 0` → `EmptyState` icon + text "Không có thiết bị nào", **không** slot CTA (F2 chưa có "+ Thêm Device" — SoT §7).
- **Empty — A2 (filter không match)**: `hasActiveFilter === true && meta.total_count === 0` → `EmptyState` cùng icon, text khác (vd "Không tìm thấy thiết bị nào khớp bộ lọc.") + slot nút "Xóa lọc".
- **Error — A11** (`error !== null`): `ErrorState` thay cho bảng — banner đỏ "Không tải được danh sách thiết bị." + nút "Thử lại"; `FilterBar` vẫn full chức năng (đổi filter trong lúc đang lỗi vẫn gọi lại `fetchDevices` bình thường qua watcher route.query, không bị khoá bởi state lỗi).
- **Success**: `DataTable` render đúng số dòng trang hiện tại + `PaginationBar` "Hiển thị {(page-1)*per_page+1}–{min(page*per_page, total_count)} / {total_count}".
- Không có thao tác async chạy nền ở F2 (read-only list, không áp dụng job tracker của `UI_UX_design.md` §6.3).

## 5. Rủi ro / open question

- **Lệch có chủ đích với `UI_UX_design.md` §4 (đã giải thích ở đầu file, nhắc
  lại để không sót khi review diff)**: không có nút "+ Thêm Device", không
  click-through row, không cột `⋯`. Căn cứ: `docs/sot/F2-device-list.md` §3
  "Ngoài phạm vi" (approved) — các phần này thuộc F3 (create/edit modal) và F4
  (`/devices/:id` detail), chưa tồn tại tại thời điểm F2 build, dựng UI trỏ
  tới chúng sẽ vi phạm nguyên tắc "không nút chết" (`UI_UX_design.md` §0.1).
  Không cần người duyệt quyết định lại — chỉ ghi nhận để diff review không bị
  hiểu nhầm là thiếu sót.
- **CSS: `.data-table tr:hover td { cursor: pointer; ... }` trong
  `web/src/styles/components.css` áp dụng không điều kiện cho mọi bảng.**
  Vì F2 không có click-through, style này sẽ khiến row F2 trông "có vẻ bấm
  được" dù không có hành vi gì xảy ra — vi phạm chính nguyên tắc "không nút
  chết" mà quyết định trên đang cố tránh. Cần thêm 1 modifier class (vd
  `.data-table.is-clickable tr:hover td`) khi implement, để `DataTable.vue`
  chỉ bật hover/pointer khi thực sự nhận `onRowClick`; F2 dùng bảng **không**
  có class này. Đây là việc sửa nhỏ ở `components.css` (thêm modifier, không
  xóa rule cũ vì F3/F4 vẫn cần), ghi rõ ở đây để `slice-implementer` không bỏ
  sót.
**Quyết định (approve, tất cả theo phương án đề xuất trong từng mục dưới):**
OQ-FE-1 → sanitize phía FE (bỏ giá trị lạ). OQ-FE-2 → sanitize `page` phía FE
(mặc định 1). OQ-FE-3 → không có control `per_page` ở F2. OQ-FE-4 → tự động
`router.replace` về `meta.total_pages` khi `page` URL vượt quá. OQ-FE-5 →
em-dash `"—"` cho `last_seen_at` null.

- **OQ-FE-1 (cần xác nhận): giá trị `platform`/`status` không hợp lệ trong URL
  (hand-crafted, vd `?platform=windows`) — FE có tự sanitize (bỏ qua, coi như
  "tất cả") trước khi gọi API, hay cứ gửi nguyên rồi hứng lỗi 422 từ
  `docs/design/F2-api.md` §3 và hiển thị như 1 lỗi chung?**
  Đề xuất: **sanitize phía FE** (bỏ giá trị lạ, coi như không filter) — vì
  dropdown của `FilterBar` chỉ sinh ra giá trị hợp lệ, giá trị lạ chỉ đến từ
  URL bị sửa tay, và một banner lỗi 422 kỹ thuật ("platform is not included in
  the list") không thân thiện bằng việc âm thầm bỏ qua rồi vẫn hiển thị được
  danh sách. Rủi ro của phương án này: không có test riêng cho message 422 ở
  tầng FE (nhưng test 422 vẫn cần ở tầng API — đã có ở `F2-api.md`). Nếu người
  duyệt muốn FE hiển thị đúng lỗi 422 trả về (không tự sanitize), nêu ở đây
  trước khi implement.
- **OQ-FE-2 (cần xác nhận): `page` trong URL không phải số nguyên dương (vd
  `?page=abc` hoặc `?page=-1`) — tương tự OQ-FE-1, đề xuất FE coi như không có
  (`page` mặc định `1`), không gửi giá trị thô lên API.** Cùng lý do: giá trị
  lạ chỉ đến từ URL sửa tay, `PaginationBar` không bao giờ tự sinh giá trị
  không hợp lệ.
- **OQ-FE-3 (cần xác nhận): F2 không có control chọn `per_page` trên UI** (khớp
  `UI_UX_design.md` §4 — mockup không vẽ ô chọn kích thước trang, chỉ có
  "Hiển thị 1–20 / 837" dạng text tĩnh) → FE luôn gọi API không kèm `per_page`,
  dùng default server-side (`20`, theo `F2-api.md` OQ-1). Nếu sau này cần cho
  user tự chọn 20/50/100 dòng/trang, đó là thay đổi UI mới, không thuộc F2.
- **OQ-FE-4 (cần xác nhận): khi `page` trong URL vượt quá `meta.total_pages`
  thực tế trả về (A6/OQ-6b) — hiện `EmptyState` "trang này không có dữ liệu"
  hay tự động điều hướng về trang cuối hợp lệ (`meta.total_pages`) rồi fetch
  lại?** Đề xuất: **tự động `router.replace` về `page = meta.total_pages`**
  (giữ nguyên filter) khi phát hiện `meta.total_pages > 0 && page >
  meta.total_pages` sau khi có response — tránh hiển thị 1 bảng rỗng gây hiểu
  lầm "không có device nào" trong khi dữ liệu vẫn tồn tại ở trang trước (tình
  huống này xảy ra tự nhiên khi đổi filter làm giảm tổng số trang trong lúc
  `page` cũ trong URL còn cao). Nếu `meta.total_pages === 0` (rỗng thật) → vẫn
  hiện `EmptyState` bình thường (A1/A2), không có gì để redirect. Nếu người
  duyệt muốn UX đơn giản hơn (không tự redirect, chỉ hiện empty kèm text "Về
  trang 1"), nêu ở đây trước khi implement.
- **OQ-FE-5 (cần xác nhận): text hiển thị khi `last_seen_at` là `null`**
  (device chưa từng "gọi về" — SoT/API không cấm giá trị null, cột này không
  có ràng buộc `NOT NULL` bắt buộc theo `F2-db.md`). Đề xuất: hiển thị
  `"—"` (em-dash) trong cột Last seen thay vì text rỗng hoặc "Invalid Date".
  Không có message cụ thể nào chốt ở SoT/`UI_UX_design.md` cho trường hợp
  này — cần xác nhận copy chính xác nếu muốn khác `"—"`.
- **Không dùng Tailwind** (kế thừa quyết định đã chốt ở `docs/plan/F0-foundation.md`,
  không phải quyết định mới của F2): mọi class mới cho `FilterBar`/`DataTable`/
  `PaginationBar`/`EmptyState`/`ErrorState`/`StatusBadge` viết thêm vào
  `web/src/styles/components.css` (đã có sẵn `.data-table`, `.pagination`,
  `.badge`, `.placeholder-box`, `.error-banner` — ghi chú "not used until F2+,
  kept ready" trong file, F2 là feature dùng chúng lần đầu), không tạo file
  CSS riêng theo component, không thêm thư viện UI mới.
- **Refactor cơ hội, không bắt buộc ở F2**: `LoginView.vue` đang có hàm
  `extractErrorMessage` cục bộ trùng logic cần cho `deviceStore.fetchDevices`.
  Có thể tách thành `utils/apiError.ts` dùng chung, nhưng không bắt buộc sửa
  `LoginView.vue` ở F2 (tránh động vào code F0 đã test xanh ngoài phạm vi cần
  thiết) — nếu implement viết trùng logic ở `stores/devices.ts` thay vì tách
  file dùng chung, chấp nhận được cho scope F2, nhưng nên tách nếu thuận tiện.
