# DESIGN.md — Device Management Console

Tài liệu thiết kế cho người sẽ maintain repo này (theo yêu cầu `PRD.md`
§"Tài liệu bắt buộc"). Viết dần theo tiến độ feature — mục nào chưa có feature
tương ứng đánh dấu **TODO**, không bịa trước.

## Mục lục

- [Mô hình dữ liệu / quan hệ](#mô-hình-dữ-liệu--quan-hệ) — TODO (đầy đủ khi F2–F9 xong)
- [Luồng chính](#luồng-chính) — TODO (login đã xong, gán policy/xem policy chờ F6–F9)
- [Xử lý Group rất lớn](#xử-lý-group-rất-lớn) — TODO (F6/F8)
- [Tính policy đang áp dụng và conflict](#tính-policy-đang-áp-dụng-và-conflict) — TODO (F9)
- [Auth / phân quyền / tách Organization](#auth--phân-quyền--tách-organization) ✅ F0
- [Giả định](#giả-định) — TODO
- [Rủi ro production còn lại](#rủi-ro-production-còn-lại) — TODO
- [AI](#ai) — cập nhật dần theo feature (F0, F2 done)

---

## Mô hình dữ liệu / quan hệ

TODO.

## Luồng chính

TODO — login đã implement ở F0 (xem phần Auth bên dưới), các luồng gán
policy/xem policy trên device sẽ điền khi F6–F9 xong.

## Xử lý Group rất lớn

TODO — điền khi F6 (group membership tại scale) xong.

## Tính policy đang áp dụng và conflict

TODO — điền khi F9 (policy resolution engine) xong. Quyết định resolve
conflict mặc định đã chốt trước ở `CLAUDE.md` §4, sẽ chuyển vào đây kèm
implementation thật khi F9 build.

## Auth / phân quyền / tách Organization

Ranh giới tenant là **Organization**. Cách ly áp dụng nhất quán ở 4 tầng:

### 1. Tầng dữ liệu (DB)

Mọi model thuộc về 1 Organization đều có `belongs_to :organization` (FK
`organization_id`, `null: false`). Ràng buộc unique **luôn scope theo
Organization**, không bao giờ global:

```ruby
# api/db/migrate/20260915085545_create_users.rb
add_index :users, [:organization_id, :email], unique: true
```

Cố ý — PRD cho phép 2 Organization trùng email, nên một unique index toàn
cục trên `email` sẽ cấm nhầm một trường hợp hợp lệ.

### 2. Tầng xác thực — không tin claim trong token

`current_organization` **không** lấy trực tiếp từ payload JWT. Mỗi request
đều load `User` tươi từ DB rồi lấy quan hệ thật:

```ruby
# api/app/controllers/concerns/authenticatable.rb
user = User.find_by(id: payload[:user_id])   # không dùng payload[:organization_id]
return render_unauthorized unless user&.active?
@current_user = user
@current_organization = user.organization    # luôn từ DB, không từ claim
```

Nếu chỉ tin `organization_id` trong token, một claim cũ/bị thao túng có thể
trỏ sai org. Vì `current_organization` luôn suy ra từ quan hệ `user.organization`
sống, không có cách nào để một request tự nhận thuộc org khác. Hệ quả phụ:
deactivate một user có hiệu lực ngay ở request tiếp theo, kể cả khi token đó
chưa hết hạn (không cần cơ chế revoke/blacklist token).

### 3. Tầng query — nguyên tắc bắt buộc cho mọi controller (F2 trở đi)

> Mọi controller action lấy resource qua
> `current_organization.devices/groups/policies`, **không bao giờ**
> `Model.find(params[:id])` trần.

```ruby
device = current_organization.devices.find(params[:id])  # đúng — sai org → RecordNotFound
device = Device.find(params[:id])                          # sai — tìm thấy cả device org khác
```

`current_organization.devices.find` tự thêm `WHERE organization_id = ?` vào
query. Id thuộc org khác → `ActiveRecord::RecordNotFound` → **404**, không
phải 403 (`api/app/controllers/application_controller.rb`,
`rescue_from ActiveRecord::RecordNotFound`). Dùng 404 thay vì 403 có chủ đích:
403 sẽ lộ ra rằng resource đó *tồn tại*, chỉ là ở org khác — 404 không phân
biệt được "không tồn tại" với "tồn tại nhưng không phải của bạn".

### 4. Tầng frontend

FE **không bao giờ** gửi `organization_id` trong body/query của bất kỳ
request nào — org luôn suy ra ở backend từ token (`UI_UX_design.md` §0.6).
Kể cả nếu FE có bug, không có input nào cho phép "chọn org khác" khi gọi API.

### Ngoại lệ có chủ đích: login

Lúc login, hệ thống **chưa biết org** (user chỉ nhập email/password) nên bắt
buộc phải tìm `User.where(email:)` xuyên suốt mọi Organization — đây là chỗ
**duy nhất** trong toàn hệ thống có query không scope theo org, vì bản chất
nó xảy ra *trước khi* có org context. Xử lý an toàn: thử `authenticate`
(password) lần lượt trên từng candidate theo thứ tự `id ASC`, dùng candidate
đầu tiên khớp (`api/app/controllers/api/v1/sessions_controller.rb`,
`#authenticate_candidate`) — xác định tuyệt đối, không phụ thuộc thứ tự DB
trả về. Đã test bằng scenario "2 Organization cùng email, login đúng password
→ vào đúng org" (`api/spec/requests/api/v1/sessions_spec.rb`,
`features/f0-foundation.feature`).

### Trạng thái test

F0 mới có login — đã test được org-isolation ở tầng auth (candidate theo
email dùng đúng org). **Chưa** test được "org A không đọc/sửa/xóa được
resource của org B" bằng thực nghiệm vì chưa có Device/Group/Policy — đây là
bài test bắt buộc ngay khi F2 (Device) có endpoint đầu tiên, theo đúng
nguyên tắc ở tầng query nêu trên.

## Giả định

TODO — sẽ gom lại toàn bộ giả định từ các SoT (`docs/sot/*.md` §12) khi số
feature đủ nhiều để không lặp lại quá sớm.

## Rủi ro production còn lại

TODO — sẽ điền khi thấy rõ scope hơn (kỳ vọng gồm: JWT không có refresh/
revoke, login lookup xuyên-org không có index tối ưu ở scale lớn, chưa có
rate-limit cho `/api/v1/sessions`).

## AI

Toàn bộ dự án được làm qua Claude Code (Sonnet 5), theo đúng vòng đời ATDD ở
`docs/sdlc.md`/`CLAUDE.md` §3: mỗi feature đi qua `/brainstorm` (SoT) →
`/design` (Database → API → Frontend, mỗi bước approve riêng) → `/plan` →
`/acceptance` (RED) → implement → `/gate` → `/code-review`/`/security-review`.
Các vai trò (analyst, db-designer, api-designer, frontend-designer, Plan,
acceptance-author, slice-implementer) là các agent con tách biệt, mỗi agent
chỉ đọc đúng tài liệu nguồn đã approve của bước trước, không tự bịa ngoài
`PRD.md`.

### F0 (Foundation: Organization/User, JWT auth, Login)
- **AI làm**: toàn bộ vòng đời trên — SoT, 3 bản thiết kế, plan, acceptance
  test, model/migration, `Authenticatable` concern, `SessionsController`,
  Login page + auth store, seed 2 org, toàn bộ test (RSpec + Vitest +
  Playwright).
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**: quy ước
  lỗi JSON chung (`{"errors": {...}}` vs `{"error": "..."}}`), thứ tự
  candidate khi 2 org trùng email lúc login (`id ASC`, xem SoT F0 OQ-2), chọn
  không dùng Tailwind mà viết CSS token trực tiếp từ `UI_UX_design.md` §12.

### F2 (Device list — phân trang + lọc platform/status)
- **AI làm**: toàn bộ vòng đời như F0, cộng thêm: quyết định wire Pundit từ
  F2 (thay vì hoãn tới khi có role thật — xem `docs/design/F2-api.md` §5),
  build 6 component dùng chung đầu tiên (`FilterBar`, `DataTable`,
  `PaginationBar`, `StatusBadge`, `EmptyState`, `ErrorState`) cho F3+ tái sử
  dụng.
- **Con người ủy quyền cho AI tự approve các gate** (SoT → Design DB/API/FE →
  Plan) trong phiên làm việc này — mọi Open Question ở mỗi bước được AI chọn
  theo đúng phương án khuyến nghị đã tự đề xuất trước đó (per_page 20/100,
  sort `created_at DESC, id DESC`, 422 cho enum/pagination sai, page vượt
  tổng → 200 rỗng, sanitize phía FE cho URL bị sửa tay, auto-redirect trang
  vượt tổng). Ghi rõ ở đây vì đây là quyết định nghiệp vụ, không phải chi
  tiết implement — nếu review lại thấy phương án nào không hợp lý, cần sửa
  ở đúng file thiết kế tương ứng (`docs/design/F2-*.md`) trước khi đổi code.
- **Chỗ AI sai đã tự phát hiện và sửa** (qua `/code-review`, trước khi báo
  Done):
  - `coerce_positive_integer` dùng `Integer(str, exception: false)` không
    chỉ định base — khiến `page=010` bị hiểu thành octal (8), `page=09` bị
    từ chối nhầm (octal không có chữ số 9), `per_page=0x1A` bị chấp nhận
    thành 26. Sửa bằng cách ép base 10 tường minh.
  - `PaginationBar.vue` hiển thị sai ("Hiển thị 19961–25 / 25") và nút
    "Trước" bấm không phản ứng trong khoảng thời gian ngắn khi `page` trên
    URL vượt quá tổng số trang (trước khi tự động điều hướng về trang hợp
    lệ hoàn tất) — do đọc thẳng `currentPage` chưa được kẹp trong khoảng
    hợp lệ. Sửa bằng 1 computed `displayPage` kẹp giá trị.
  - `web/src/main.ts` cài `router` **trước** khi `hydrate()` xong — khiến
    mọi lần mở thẳng URL cần đăng nhập (hoặc F5) bị điều hướng nhầm về
    `/login` dù token còn hợp lệ, dù đây là bug tồn tại từ F0 (F0 chỉ test
    qua `/login`, F2 mới lần đầu test mở thẳng `/devices`). Sửa bằng cách
    chuyển `app.use(router)` vào trong `.finally()` của `hydrate()`, đúng ý
    đã ghi ở `docs/design/F0-frontend.md` §4 nhưng chưa được code đúng.
  - `playwright.config.ts` chạy `fullyParallel: true` trong khi các scenario
    dùng chung 1 Postgres instance (không có DB riêng theo worker) — khiến
    scenario "chạy seed 2 lần không tạo trùng" của F0 (so tổng số dòng toàn
    cục) bị flaky khi F2 tạo thêm nhiều Organization song song. Sửa bằng
    `workers: 1`.
  - Helper `readVisibleDeviceRows` trong acceptance step (không phải code
    sản phẩm) lấy `count()` rồi đọc field tuần tự nhiều round-trip — bị race
    với Vue re-render khi filter thay đổi, khiến 3 scenario filter fail
    không ổn định. Sửa bằng cách đọc toàn bộ bảng trong 1 lệnh
    `page.evaluate` atomic, không đổi ý nghĩa scenario.
### F3 (Device create/edit + validate — identifier unique trong org)
- **AI làm**: toàn bộ vòng đời — SoT, 3 bản thiết kế, plan (25 task/6 wave),
  acceptance test (18 scenario, xác nhận RED đúng lý do trước khi code), model
  (`Device` callback), `DevicesController#create/#update`, `DevicePolicy`,
  route, RSpec, và toàn bộ phía FE (`FormModal.vue`/`DeviceFormModal.vue`/
  `ToastContainer.vue`, `stores/toast.ts`, mở rộng `stores/devices.ts`/
  `api/devices.ts`/`types/device.ts`/`utils/apiError.ts`, wiring vào
  `DeviceListView.vue`, Vitest).
- **Con người ủy quyền cho AI tự approve các gate** (SoT → Design DB/API/FE →
  Plan) trong phiên làm việc này, cùng cách đã làm ở F2 — mọi Open Question
  (OQ-1..OQ-7 ở SoT, OQ-DB1 ở Design DB, các quyết định envelope/response ở
  Design API) được AI chọn theo đúng phương án khuyến nghị đã tự đề xuất
  trước đó. Ghi rõ ở đây vì đây là quyết định nghiệp vụ, không phải chi tiết
  implement.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - Cơ chế "identifier bất biến sau khi tạo": dùng `before_validation` reset
    (`self.identifier = identifier_was if identifier_changed?`) thay vì
    `attr_readonly :identifier` — tránh "response drift" (giá trị trong bộ
    nhớ object bị đổi dù cột DB không đổi) nếu 1 endpoint tương lai lỡ
    mass-assign field này (`docs/design/F3-db.md` §1a).
  - Cơ chế "retired bất biến": `before_validation` + `throw(:abort)` (không
    phải `validate` thường) để short-circuit toàn bộ chuỗi validate còn lại
    khi `status_was == "retired"` — đảm bảo response 422 chỉ có đúng 1 lỗi
    `base`, không lẫn lỗi field khác (`docs/design/F3-db.md` §1b).
  - Envelope response `{ "device": {...} }` cho `POST`/`PATCH` (SoT/Design DB
    không chốt shape này) — chọn bọc theo tiền lệ F0 (`sessions`/`me`), và
    tái dùng đúng khung lỗi `{"errors": {...}}` hiện có cho cả lỗi
    field-level lẫn lỗi "chặn vì retired" (chỉ khác key `base` thay vì tên
    field) — để FE chỉ cần 1 quy tắc phân biệt banner/field-level duy nhất.
  - Tách `FormModal.vue` (shell dùng chung, không biết gì về field cụ thể)
    khỏi `DeviceFormModal.vue` (feature-specific) — chuẩn bị tái dùng cho
    Group/Policy form ở F5+ mà không cần thiết kế lại từ đầu.
  - Tooltip dùng `title` gốc của trình duyệt (không xây component Tooltip
    riêng) — `UI_UX_design.md` §8 không liệt kê component này, thêm 1
    component mới cho đúng 1 chỗ dùng là over-engineering.
- **Chỗ AI sai đã tự phát hiện và sửa (trước khi báo Done)**:
  - Khi tự viết Quyết định cho OQ-4 ở SoT §12 (trích dẫn lại câu tooltip từ
    `UI_UX_design.md` §4 dòng 128), AI tự ý thêm dấu chấm cuối câu
    ("...không thể sửa.") không có trong bản gốc — sai lệch này lan sang cả
    3 bản `docs/design/F3-{db,api,frontend}.md`. Phát hiện khi
    `acceptance-author` đối chiếu message giữa SoT §11 (không dấu chấm, đúng
    theo `UI_UX_design.md`) và 3 bản design (có dấu chấm, sai) trước khi viết
    `.feature`. Sửa bằng cách đồng bộ lại toàn bộ 3 bản design + preview HTML
    về đúng bản gốc không dấu chấm — **không sửa acceptance test** (test đã
    viết đúng theo SoT ngay từ đầu).
  - `extractFormErrors` (FE) theo đúng pseudocode ở `docs/design/F3-frontend.md`
    sẽ tin tưởng bất kỳ `body.error` string nào làm banner — nhưng 1 lỗi hạ
    tầng 500 có kèm JSON body (`{"error": "Internal server error"}`) sẽ làm
    lộ nguyên văn message hạ tầng ra UI thay vì banner chung "Có lỗi xảy ra,
    vui lòng thử lại." (SoT A13). Sửa bằng cách thêm điều kiện `status < 500`
    trước khi tin `body.error` — mọi 5xx luôn rơi về `genericFallback` bất kể
    body chứa gì, không đổi hành vi cho 401/404.

### F4 (Device detail — info, group đang thuộc, policy đang áp dụng)
- **AI làm**: toàn bộ vòng đời — SoT, 3 bản thiết kế + preview HTML, plan (16
  task/4 wave), acceptance test (15 scenario), action `show`/`DevicePolicy
  #show?`/route mới, và toàn bộ phía FE (`ActionsMenu.vue`,
  `DeviceDetailView.vue`, mở rộng `router/index.ts`/`stores/devices.ts`/
  `api/devices.ts`/`utils/apiError.ts`), RSpec + Vitest tương ứng.
- **Con người ủy quyền cho AI tự approve toàn bộ gate** (SoT → Design DB/API/
  FE → Plan) **và tự chạy tiếp implement/gate/PR** trong phiên làm việc này
  (không dừng lại chờ review từng bước như F0–F3) — mọi Open Question (OQ-1
  đến OQ-6 ở SoT) được AI chọn theo đúng phương án khuyến nghị đã tự đề xuất.
  Quyết định phạm vi quan trọng nhất là OQ-1: tại thời điểm F4 được build,
  `docs/backlog.md` xếp F5–F9 (Group/Policy) **sau** F4 — nên 2 khối "Groups
  đang thuộc"/"Policy đang áp dụng" chỉ dựng khung UI tĩnh (luôn empty, không
  gọi API, không bịa schema Group/Policy hộ F5/F7), để F6/F9 sau này thay nội
  dung mà không cần đổi route/layout.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - Đổi action "Sửa" trên Devices List từ nút rời (F3) sang menu "⋯"
    (`ActionsMenu.vue`, component dùng chung mới) chứa cả "Sửa" và "Xem chi
    tiết" (OQ-2) — vì `UI_UX_design.md` §4/§6.1 đã vẽ sẵn pattern này cho cả
    Devices lẫn Groups list, xây 1 lần dùng lại được ngay khi F5/F7 tới.
  - Cơ chế "quay lại danh sách giữ đúng filter/trang" (OQ-5): 1 field
    `lastListLocation` trên Pinia store (không phải `sessionStorage`/
    `router.back()`) — `DeviceListView` tự ghi lại full path mỗi khi URL đổi,
    `DeviceDetailView` đọc lại, fallback `/devices` nếu chưa từng ghi (vào
    thẳng bằng URL) — đơn giản hơn dựa vào lịch sử điều hướng của trình
    duyệt (vốn có thể không đáng tin nếu user mở tab mới/refresh).
  - Không thêm field `groups`/`applied_policies` (kể cả mảng rỗng) vào
    response `GET /devices/:id` (OQ-6) — tránh bịa 1 contract mà F6/F8/F9 rất
    có thể cần thiết kế lại khác đi (vd cần field `source`/`overridden_by`).
- **Chỗ AI sai đã tự phát hiện và sửa (trước khi báo Done)**:
  - Xác nhận RED cho scenario "xem device thuộc org khác trả 404" ban đầu
    **pass nhầm** trước khi code: vì route `GET /devices/:id` chưa tồn tại,
    Rails tự trả `404 Blocked`/routing-error cũng mang status 404, trùng
    ngẫu nhiên với kỳ vọng của scenario dù chưa hề có logic org-scope nào
    chạy. Phát hiện bằng cách so khớp toàn bộ 15 scenario theo từng dòng thất
    bại thay vì chỉ đọc số lượng pass/fail. Sửa bằng cách thêm assertion thứ
    2 kiểm tra đúng body `{"error": "Not found"}` (envelope thật của
    `ApplicationController#render_not_found`) — **không sửa để test pass dễ
    hơn**, mà làm assertion chặt hơn để RED đúng lý do, rồi mới code.
  - Đổi action "Sửa" sang menu "⋯" (trên) phá vỡ 2 test đã xanh từ trước:
    acceptance scenario cuối của F3 (nút "Sửa" disabled + tooltip) và 4 test
    Vitest của `DeviceListView.spec.ts` — cả 2 đều trỏ thẳng
    `[data-testid=edit-device-button]`/`edit-device-tooltip` (không còn tồn
    tại độc lập ngoài menu). Phát hiện ngay khi chạy lại full Playwright +
    Vitest suite trước khi báo Done (không chỉ chạy suite của riêng F4). Sửa
    bằng cách cập nhật đúng 2 file test đó theo UI mới (mở menu "⋯" trước khi
    thao tác) — hành vi nghiệp vụ (disable + tooltip khi retired) không đổi,
    chỉ đổi đường DOM để chạm tới nó, nên đây là cập nhật hợp lệ theo
    `CLAUDE.md` §3 (khác với việc sửa test của chính feature đang làm để nó
    pass).
  - `docker compose exec api bundle exec rspec` chạy nhầm `RAILS_ENV=development`
    (biến môi trường container set sẵn cho dev server), khiến
    `ActionDispatch::HostAuthorization` chặn toàn bộ request test bằng
    `403 Blocked hosts` thay vì lỗi nghiệp vụ thật — làm 61/71 spec fail
    không liên quan gì tới code F4. Xác nhận bằng `git stash` để chứng minh
    lỗi có sẵn trên nhánh F3 gốc (không phải regression của F4), rồi chạy lại
    với `-e RAILS_ENV=test` tường minh — không sửa code sản phẩm.

**Follow-up sau PR #7 (cùng F4, trước khi merge)**: user yêu cầu bổ sung
"xem chi tiết Device thì cập nhật `last_seen_at`" — không có trong PRD, đảo
lại 1 quyết định "ngoài phạm vi" mà chính F3 đã ghi (`docs/sot/F3-device-create-edit.md`
§3: "F3 không tự bịa thêm 1 cơ chế cập nhật `last_seen_at`"). Trước khi code,
AI chủ động hỏi lại 1 câu làm rõ (không tự quyết) vì đụng thẳng invariant
"retired bất biến" (`CLAUDE.md` §4, mục bị chấm nặng nhất): device `retired`
có nên vẫn bị đổi `last_seen_at` khi xem không? Người dùng chọn **không** —
giữ tuyệt đối invariant. Implement theo TDD đúng thứ tự (`CLAUDE.md` §3 rule
4): RSpec model spec cho `Device#record_seen!` trước (RED), rồi code
(`update_column`, bypass hẳn callback/validate — không dùng `update` để
tránh mọi rủi ro vô tình chạm lại callback retired-block), rồi request spec,
rồi bổ sung 2 scenario + step definition vào `.feature` đã có, rồi ghi lại
quyết định vào SoT §6/§11/§12 (OQ-7) + `docs/design/F4-{db,api}.md` — không
bỏ qua tài liệu dù đây là thay đổi nhỏ. Toàn bộ 4 gate chạy lại xanh trước
khi push tiếp lên PR #7 (không tạo PR mới).

