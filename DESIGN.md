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
