---
feature_id: F2
title: Device list (phân trang + lọc platform/status)
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

## §1. Meta
- Feature: `F2` — Device list (phân trang + lọc platform/status)
- Dependency: `F0` (Organization/User model, JWT auth, `Authenticatable` concern
  — approved, xem `docs/sot/F0-foundation.md`, `docs/design/F0-{db,api,frontend}.md`)
- Nguồn: `PRD.md` §"Device" (field/status/unique), bảng "Giao diện bắt buộc"
  (dòng "Devices": "Danh sách có phân trang + lọc (platform, status)"),
  `docs/backlog.md` mục F2, `UI_UX_design.md` §4 ("Trang: Devices List")

**Scope note:** `docs/backlog.md` xếp F2 → F3 (create/edit) → F4 (detail) là
chuỗi phụ thuộc tuần tự. F2 **chỉ** cover list + filter + pagination. Model
`Device` **chưa tồn tại** trong `api/db/schema.rb` (chỉ có `organizations`,
`users` từ F0) — F2 là feature đầu tiên cần tạo model này, nhưng SoT này chỉ
liệt kê field cần thiết ở §8 (schema/index cụ thể do `/design F2` DB quyết
định), không tự thiết kế bảng.

## §2. Summary / User story
Là một user `active` thuộc một Organization, tôi muốn xem danh sách toàn bộ
Device của **chính Organization mình**, lọc theo platform và/hoặc status, và
duyệt qua nhiều trang mà không bị tải hết dữ liệu cùng lúc — để quản lý được
số lượng device lớn mà không bị treo trình duyệt hay lẫn dữ liệu Organization
khác.

## §3. Scope
**Trong phạm vi:**
- Model `Device` (tạo mới): field tối thiểu theo PRD — `identifier`, `name`,
  `platform` (`ios`/`android`/`macos`), `os_version`, `status`
  (`active`/`inactive`/`retired`), `last_seen_at`, thuộc về 1 `Organization`.
  (Migration/index cụ thể — kể cả composite unique cho `identifier` — do
  `/design F2` (DB) quyết định; F2 SoT chỉ khẳng định field nào cần tồn tại để
  render list + filter theo yêu cầu PRD.)
- Endpoint `GET /api/v1/devices` (index, có phân trang) — org-scope tuyệt đối
  qua `current_organization.devices`, không bao giờ `Device.find`/`Device.all`
  trần.
- Filter theo `platform` và `status` (độc lập, kết hợp được cùng lúc — AND).
- Phân trang server-side (không render toàn bộ danh sách một lần, kể cả khi
  org có hàng nghìn device).
- Trang Devices List (`/devices`) theo `UI_UX_design.md` §4: filter bar, table
  (cột: Identifier, Name, Platform, OS Version, Status, Last seen), pagination
  bar, đồng bộ filter/trang với URL query string (share link / giữ trạng thái
  khi F5).
- Seed data: cần đủ số lượng device rải rác nhiều platform/status ở ít nhất 1
  organization để có thể demo phân trang + filter có ý nghĩa (số lượng cụ thể
  không chốt ở SoT — implement-time).

**Ngoài phạm vi** (khớp `docs/backlog.md` — thuộc F3/F4, không làm ở đây):
- Nút "+ Thêm Device", modal tạo/sửa Device, action "Sửa" trên mỗi dòng — F3.
- Click vào dòng để xem chi tiết Device (route `/devices/:id`) — F4. Ở F2,
  bảng **không** có hành vi click-through/nút "Xem chi tiết" vì trang đích
  chưa tồn tại (tránh nút chết theo `UI_UX_design.md` §0.1); cột hành động `⋯`
  của bảng sẽ được bật lại khi F3/F4 build xong.
- Un-retire device — mặc định không làm (`CLAUDE.md` §4), không liên quan F2
  vì F2 không sửa device.
- Search theo tên/identifier, filter theo group/policy — xem §12 OQ-3, OQ-4
  (PRD không nhắc, không tự quyết định ở đây).

## §4. Main flow
1. User (đã đăng nhập, có JWT hợp lệ) mở `/devices`.
2. FE gọi `GET /api/v1/devices` với `page`/`per_page` mặc định, không filter
   (trừ khi URL đã có query string từ trước — xem biến thể ở §5.1).
3. BE lấy `current_organization.devices`, áp filter (nếu có) và phân trang,
   trả về danh sách + metadata phân trang (tổng số dòng, tổng số trang).
4. FE render bảng theo cột: Identifier, Name, Platform, OS Version, Status
   (badge), Last seen; hiện pagination bar ("Hiển thị x–y / tổng").
5. User chọn filter Platform và/hoặc Status trên filter bar → FE gọi lại API
   với query param tương ứng, **reset về page 1**, cập nhật URL query string.
6. User chuyển trang (prev/next/nhảy trang) → FE gọi lại API với `page` mới,
   **giữ nguyên filter hiện tại**, cập nhật URL query string.

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- Mở `/devices` bằng URL đã có sẵn query string filter/trang (share link hoặc
  F5 reload) → FE đọc query string, gọi API đúng theo state đó ngay từ lần
  load đầu (không phải load mặc định rồi mới áp lại filter).
- Đổi filter luôn reset `page=1`; đổi trang luôn giữ filter — không bao giờ
  trộn lẫn 2 hành vi này.
- "Xóa lọc" (chỉ hiện khi có filter đang áp dụng — `UI_UX_design.md` §4) →
  xoá hết filter, về page 1, cập nhật URL query string về trạng thái không
  filter.

### 5.2 Edge case
- A1. Organization chưa có Device nào (danh sách rỗng tuyệt đối, không do
  filter) → empty state, không có nút "Xóa lọc" (vì không có filter nào đang
  áp).
- A2. Có filter đang áp dụng nhưng không match Device nào → empty state kèm
  nút "Xóa lọc" (`UI_UX_design.md` §9).
- A3. Áp filter `platform` **và** `status` cùng lúc → kết quả phải là **giao**
  (AND) của cả 2 điều kiện, không phải OR.
- A4. Giá trị filter không nằm trong enum hợp lệ (vd `platform=windows`,
  `status=deleted`) → xử lý theo Quyết định OQ-5 (§12).
- A5. Trang cuối có số dòng ít hơn `per_page` (vd 837 device, `per_page=20`,
  trang cuối 21 chỉ có 17 dòng) → vẫn render đúng, pagination bar hiển thị
  đúng tổng.
- A6. Yêu cầu trang vượt quá tổng số trang hiện có (vd `page=999` khi chỉ có 5
  trang dữ liệu) → xử lý theo Quyết định OQ-6 (§12).
- A7. Tham số phân trang không hợp lệ (`page`/`per_page` âm, bằng 0, hoặc
  không phải số) → xử lý theo Quyết định OQ-6 (§12).
- A8. `per_page` vượt ngưỡng tối đa cho phép (vd client truyền
  `per_page=100000` để cố lấy hết dữ liệu 1 lần) → bị chặn/clamp theo Quyết
  định OQ-1 (§12) — liên quan trực tiếp tới invariant "API/list không chậm vô
  lý khi dữ liệu tăng" (`PRD.md` §"Chất lượng kỹ thuật").
- A9. **Org-scope**: Organization A gọi `GET /api/v1/devices` (kể cả không
  filter, lấy hết các trang) tuyệt đối không được thấy bất kỳ Device nào của
  Organization B, kể cả **tổng count** trong metadata phân trang (không được
  lộ số lượng device của org khác qua con số tổng) — `CLAUDE.md` §4.
- A10. Gọi endpoint không có `Authorization` header hoặc token hết hạn/không
  hợp lệ → 401 (tái sử dụng `Authenticatable` concern đã có từ F0 — chỉ cần
  xác nhận áp dụng đúng cho endpoint mới, không thiết kế lại middleware).
- A11. API lỗi hạ tầng (500/network/timeout) khi tải danh sách → FE hiện
  ErrorState + nút "Thử lại" trong khu vực bảng, filter bar vẫn hoạt động
  bình thường, không phải lỗi nghiệp vụ (`UI_UX_design.md` §4, §9).

## §6. Business rule & validation
- **Org-scope tuyệt đối** (`CLAUDE.md` §4): query luôn qua
  `current_organization.devices`. Input hợp lệ: mọi response chỉ chứa Device
  của org gắn với token đang dùng. Input bị chặn: không có param nào từ
  client (query/body) cho phép chọn org khác — FE không gửi, BE không nhận
  `organization_id` từ request (xem A9).
- **Filter `platform`**: input hợp lệ = một trong `ios`/`android`/`macos`
  hoặc để trống (nghĩa là "tất cả"). Input bị chặn = giá trị khác enum trên
  (xem A4, OQ-5).
- **Filter `status`**: input hợp lệ = một trong `active`/`inactive`/`retired`
  hoặc để trống ("tất cả"). Input bị chặn = giá trị khác enum trên (xem A4,
  OQ-5).
- **Kết hợp filter**: `platform` + `status` cùng lúc phải là AND (A3) — không
  có business rule nào của PRD gợi ý OR, đây là hành vi filter chuẩn.
- **Phân trang**: input hợp lệ = `page` nguyên dương (≥1), `per_page` nguyên
  dương (≥1) trong ngưỡng tối đa (OQ-1). Input bị chặn = không phải số
  nguyên dương (A7, OQ-6), hoặc vượt ngưỡng tối đa `per_page` (A8, OQ-1).
- **Auth** (kế thừa F0, không phải rule mới của F2): input hợp lệ = Bearer
  token của user `active`; input bị chặn = thiếu/sai/hết hạn token → 401.

## §7. UI state
Theo `UI_UX_design.md` §4 (Devices List) và §9 (ma trận Loading/Empty/Error
dùng chung) — không lặp lại chi tiết, chỉ liệt kê điểm phải khớp business
rule ở §6:
- **Loading** (lần đầu): skeleton rows, giữ filter bar hiển thị bình thường.
- **Loading** (đổi filter/trang): overlay mờ lên bảng cũ, không xóa trắng rồi
  mới hiện lại (tránh giật layout).
- **Empty** không do filter (A1): text "Không có thiết bị nào", không có nút
  "Xóa lọc" (vì F2 chưa có nút "+ Thêm Device" — xem §3 Ngoài phạm vi — nên
  empty state ở F2 chỉ có text, chưa có CTA tạo mới; F3 sẽ bổ sung CTA này).
- **Empty** do filter (A2): text + nút "Xóa lọc".
- **Error** (A11): banner đỏ trong khu vực bảng + nút "Thử lại", filter bar
  vẫn hoạt động, không trang trắng, không spinner treo vô hạn.
- **Success**: bảng + pagination bar ("Hiển thị x–y / tổng").

## §8. Data & API touchpoint
- Model (mới, chưa tồn tại — chốt schema/index ở `/design F2` DB):
  `Device belongs_to :organization` — field: `identifier`, `name`,
  `platform` (enum: `ios`/`android`/`macos`), `os_version`, `status` (enum:
  `active`/`inactive`/`retired`), `last_seen_at`, `organization_id`,
  `created_at`/`updated_at` (dùng cho sort — xem OQ-2).
- Endpoint dự kiến: `GET /api/v1/devices?platform=&status=&page=&per_page=`
  → trả danh sách device (đã org-scope, filter, phân trang) + metadata phân
  trang (tổng số dòng/tổng số trang — shape JSON cụ thể chốt ở `/design F2`
  API, kế thừa quy ước lỗi đã chốt ở `docs/design/F0-api.md` §0: 422 dạng
  `{"errors": {...}}`, lỗi khác dạng `{"error": "..."}`).
- Auth: tái dùng `Authenticatable` concern (`current_user`,
  `current_organization`) đã có từ F0 — không thiết kế lại.

## §9. RBAC / Authorization
- Không có role trong nội bộ 1 Organization (kế thừa quyết định F0 — xem
  `docs/sot/F0-foundation.md` §3/§9). Mọi user `active` của 1 org có quyền
  xem toàn bộ Device của org đó, quyền như nhau.
- Authorization thực chất là org-scope check bắt buộc: mọi request tới
  `GET /api/v1/devices` phải bị chặn/lọc qua `current_organization`, không
  bao giờ trả Device của org khác (xem A9, §6). Đây là điểm bị chấm nặng
  nhất theo `PRD.md` §"Cách chấm" — phải có test riêng chứng minh.

## §10. Non-functional (performance/scale)
- Đây chưa phải kịch bản "Group 10.000 device" của `CLAUDE.md` §4 (đó là
  F6/F8), nhưng nguyên tắc chung "API/list không chậm vô lý khi dữ liệu
  tăng" (`PRD.md` §"Chất lượng kỹ thuật") vẫn áp dụng: một Organization có
  thể có rất nhiều Device ngay cả không liên quan tới Group. Phân trang
  server-side là **bắt buộc** (không bao giờ trả toàn bộ danh sách trong 1
  response — xem A8). Index cần thiết trên `(organization_id, platform)`,
  `(organization_id, status)` (hoặc composite phù hợp) để filter không quét
  toàn bảng khi dữ liệu tăng — quyết định index cụ thể để `/design F2` (DB).

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Xem danh sách device của tổ chức mình, có phân trang mặc định
  Given tôi là user active thuộc Organization "Acme Inc." và org này có nhiều Device
  When tôi mở trang Devices không áp filter nào
  Then tôi thấy danh sách Device của "Acme Inc." theo trang đầu tiên
  And tôi thấy tổng số Device và tổng số trang chính xác

Scenario: Lọc theo platform hợp lệ
  Given Organization "Acme Inc." có Device thuộc nhiều platform khác nhau
  When tôi lọc danh sách theo platform "ios"
  Then tôi chỉ thấy Device có platform "ios" của "Acme Inc."
  And danh sách quay về trang 1

Scenario: Lọc theo status hợp lệ
  Given Organization "Acme Inc." có Device ở nhiều status khác nhau
  When tôi lọc danh sách theo status "retired"
  Then tôi chỉ thấy Device có status "retired" của "Acme Inc."

Scenario: Kết hợp filter platform và status cùng lúc
  Given Organization "Acme Inc." có Device đa dạng platform và status
  When tôi lọc đồng thời platform "android" và status "active"
  Then tôi chỉ thấy Device vừa có platform "android" vừa có status "active"

Scenario: Danh sách rỗng vì tổ chức chưa có Device nào
  Given Organization "Acme Inc." chưa có Device nào
  When tôi mở trang Devices
  Then tôi thấy thông báo "Không có thiết bị nào"
  And tôi không thấy nút "Xóa lọc"

Scenario: Lọc không có kết quả nào khớp
  Given Organization "Acme Inc." không có Device nào platform "macos"
  When tôi lọc danh sách theo platform "macos"
  Then tôi thấy thông báo rỗng kèm nút "Xóa lọc"

Scenario: Trang cuối có ít dòng hơn kích thước trang
  Given Organization "Acme Inc." có số Device không chia hết cho kích thước trang
  When tôi chuyển tới trang cuối cùng
  Then tôi thấy đúng số Device còn lại của trang đó, không thiếu không thừa

Scenario: Yêu cầu trang vượt quá tổng số trang hiện có
  Given Organization "Acme Inc." chỉ có đủ dữ liệu cho 5 trang
  When tôi gọi API danh sách Device với "page=999"
  Then tôi nhận về "200" với danh sách rỗng
  And metadata phân trang vẫn phản ánh đúng tổng số dòng và tổng số trang thực tế

Scenario: Lọc bằng giá trị enum không hợp lệ
  When tôi gọi API danh sách Device với "platform=windows" (không nằm trong enum hợp lệ)
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho "platform"

Scenario: Tham số phân trang không hợp lệ
  When tôi gọi API danh sách Device với "page=-1" hoặc "page=abc"
  Then tôi nhận về lỗi "422" kèm thông báo lỗi field-level cho tham số phân trang

Scenario: per_page vượt ngưỡng tối đa cho phép
  When tôi gọi API danh sách Device với "per_page=100000"
  Then hệ thống tự động giới hạn (clamp) về ngưỡng tối đa cho phép
  And không trả lỗi, không trả về toàn bộ dữ liệu trong 1 response

Scenario: Tổ chức A không thấy được Device của tổ chức B
  Given Organization "Acme Inc." có Device riêng và Organization "Globex Corp." cũng có Device riêng
  When user của "Acme Inc." gọi API danh sách Device (không filter, duyệt hết các trang)
  Then tôi chỉ thấy Device của "Acme Inc."
  And tổng số Device trả về (metadata phân trang) chỉ tính Device của "Acme Inc.", không cộng dồn Device của "Globex Corp."

Scenario: Gọi API danh sách Device mà không có token
  When tôi gọi "GET /api/v1/devices" mà không có Authorization header
  Then tôi nhận về lỗi 401

Scenario: Gọi API danh sách Device bằng token đã hết hạn
  Given tôi có một token đã hết hạn
  When tôi gọi "GET /api/v1/devices" bằng token đó
  Then tôi nhận về lỗi 401

Scenario: Lỗi tải danh sách do sự cố hạ tầng
  Given API danh sách Device đang trả lỗi 500/network
  When tôi mở trang Devices
  Then tôi thấy banner lỗi kèm nút "Thử lại" trong khu vực bảng
  And filter bar vẫn dùng được bình thường

Scenario: Mở lại trang Devices từ URL đã có filter và số trang sẵn
  Given tôi đã áp filter platform "ios" và đang ở trang 2
  When tôi tải lại trang (F5) hoặc mở lại đúng URL đó
  Then tôi vẫn thấy đúng filter "ios" và đúng trang 2 như trước khi reload
```

## §12. Decisions & Open questions
| # | Open question | Phương án khuyến nghị | Quyết định (điền khi approve) |
|---|---|---|---|
| OQ-1 | PRD không quy định kích thước trang (`per_page`) mặc định, cũng như FE có được truyền `per_page` tùy ý hay không. `UI_UX_design.md` §4 chỉ minh họa ví dụ "Hiển thị 1–20 / 837" (ngụ ý 20) mà không chốt cứng. Liên quan trực tiếp A8 (chặn client lấy hết dữ liệu 1 lần). | Mặc định `per_page=20`. Cho phép client override qua query param nhưng **giới hạn tối đa** (đề xuất 100) — vượt ngưỡng thì server clamp về tối đa, không trả lỗi (tránh 1 client vô tình phá UI vẫn dùng được, chỉ không lấy được nhiều hơn ngưỡng). | Theo khuyến nghị: `per_page` mặc định 20, tối đa 100 (server clamp, không lỗi). |
| OQ-2 | PRD không quy định thứ tự sắp xếp mặc định của danh sách Device. | Sắp xếp mặc định `created_at DESC` (Device tạo gần đây nhất lên đầu), tie-break `id DESC` để đảm bảo thứ tự xác định tuyệt đối giữa các lần gọi/trang (tránh device "nhảy trang" nếu 2 bản ghi cùng `created_at`). | Theo khuyến nghị: `created_at DESC`, tie-break `id DESC`. |
| OQ-3 | PRD/`UI_UX_design.md` §4 chỉ liệt kê filter platform/status cho Devices List, không đề cập ô tìm kiếm theo `identifier`/`name`. Có cần bổ sung search không? | Không làm ở F2 — đúng theo đặc tả `UI_UX_design.md` §4 (không có ô search trong layout Devices List, khác với Groups List có search theo tên). Nếu sau này cần, làm feature riêng, không mở rộng scope F2. | Theo khuyến nghị: không làm search ở F2. |
| OQ-4 | Trang Devices List có cần lọc theo Group hoặc Policy đang gán không? PRD không nhắc tới ở bảng "Giao diện bắt buộc" cho Devices. | Không làm ở F2. Lọc device theo Group cụ thể thuộc về tab "Thành viên" ở Group detail (`UI_UX_design.md` §6.2, feature F6), không phải trang Devices List chung. | Theo khuyến nghị: không filter theo group/policy ở F2. |
| OQ-5 | Giá trị filter `platform`/`status` không nằm trong enum hợp lệ (vd `platform=windows`) thì xử lý sao — báo lỗi hay âm thầm bỏ qua (coi như "tất cả")? PRD/`UI_UX_design.md` không nói tới trường hợp query param bị craft tay/sai. | Trả lỗi rõ ràng `422` dạng `{"errors": {"platform": ["is not included in the list"]}}` (khớp quy ước lỗi field-level đã chốt ở `docs/design/F0-api.md` §0) — vì FE chỉ tạo giá trị filter từ dropdown cố định nên giá trị lạ chỉ có thể đến từ URL bị sửa tay/tấn công, nên báo lỗi thay vì âm thầm trả sai kết quả. | Theo khuyến nghị: `422` với lỗi field-level. |
| OQ-6 | Tham số phân trang không hợp lệ xử lý sao, tách 2 tình huống: (a) `page`/`per_page` không phải số nguyên dương (âm, 0, không phải số); (b) `page` hợp lệ về kiểu nhưng vượt quá tổng số trang hiện có (vd `page=999` khi chỉ có 5 trang). | (a) `422` rõ ràng — dữ liệu sai kiểu là lỗi input, không nên âm thầm sửa. (b) **Không** coi là lỗi — trả `200` với danh sách rỗng + metadata phân trang chính xác (`total_pages`, `total_count` vẫn đúng) để FE tự quyết định hiển thị gì (vd empty state hoặc tự điều hướng về trang cuối hợp lệ) — đây là biên phân trang bình thường, không phải input sai. | Theo khuyến nghị: (a) `page`/`per_page` sai kiểu/âm/0 → `422`; (b) `page` vượt tổng số trang → `200` + danh sách rỗng, metadata chính xác. |

**Điền khi approve:** rà lại mọi `Scenario: ... (pending OQ-n)` ở §11 theo
Quyết định thật (OQ-1, OQ-5, OQ-6 đang có scenario gắn tag), bỏ tag, rồi mới
set `status: approved` ở đầu file.
