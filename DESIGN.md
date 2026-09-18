# DESIGN.md — Device Management Console

Tài liệu thiết kế cho người sẽ maintain repo này (theo yêu cầu `PRD.md`
§"Tài liệu bắt buộc"). Viết dần theo tiến độ feature — mục nào chưa có feature
tương ứng đánh dấu **TODO**, không bịa trước.

## Mục lục

- [Mô hình dữ liệu / quan hệ](#mô-hình-dữ-liệu--quan-hệ) — TODO (đầy đủ khi F2–F9 xong)
- [Luồng chính](#luồng-chính) — TODO (login đã xong, gán policy/xem policy chờ F6–F9)
- [Xử lý Group rất lớn](#xử-lý-group-rất-lớn) ✅ F6/F8
- [Tính policy đang áp dụng và conflict](#tính-policy-đang-áp-dụng-và-conflict) ✅ F9
- [Auth / phân quyền / tách Organization](#auth--phân-quyền--tách-organization) ✅ F0
- [Giả định](#giả-định) — TODO
- [Rủi ro production còn lại](#rủi-ro-production-còn-lại) — TODO
- [AI](#ai) — cập nhật dần theo feature (F0, F2, F3, F4, F5, F6, F7, F8, F9 done)

---

## Mô hình dữ liệu / quan hệ

TODO.

## Luồng chính

TODO — login đã implement ở F0 (xem phần Auth bên dưới), các luồng gán
policy/xem policy trên device sẽ điền khi F6–F9 xong.

## Xử lý Group rất lớn

PRD yêu cầu Group tới ~10.000 device vẫn "dùng được": UI không treo, hệ
thống không sập, kết quả đúng và idempotent. Hai nghĩa vụ khác nhau, chia
cho 2 feature khác nhau vì lý do khác nhau:

**F6 — thêm/gỡ device khỏi Group**: chọn **không** cần Solid Queue job
(`docs/sot/F6-group-membership.md` §12 OQ-1) — PRD chỉ bắt buộc job async
cho "gán Policy cho Group lớn", không cho membership. `POST/DELETE
/groups/:id/devices` xử lý đồng bộ trong request, dùng `upsert_all` trên
unique index `(group_id, device_id)` để idempotent (gọi lại không nhân đôi
`group_memberships`), cap 500 device/request để bounded thời gian request,
và tab Thành viên luôn phân trang server-side dù group có 10.000 thành viên.

**F8 — gán Policy cho Group**: đây mới là nhánh PRD thực sự yêu cầu async.
- **Solid Queue** — cài lần đầu ở F8 (không có sẵn từ Rails 8 mặc dù
  `CLAUDE.md` §1 ngụ ý "đi kèm mặc định"). `POST
  /api/v1/groups/:id/policy_assignments` tạo 1 dòng `policy_assignment_jobs`
  (`status: pending`) + `GroupPolicyAssignmentJob.perform_later` trong 1
  transaction, trả `202 Accepted` ngay — không block request tới khi xử lý
  xong toàn bộ device trong group.
- **Không fan-out theo device** (`docs/sot/F8-policy-assignment.md` §12
  OQ-2, Phương án A): gán Policy cho 1 Group luôn là **đúng 1 dòng**
  `policy_assignments (policy_id, group_id)`, không phải 1 dòng/device.
  "Policy nào đang áp dụng lên 1 device cụ thể" là việc **join tại thời
  điểm đọc** qua `group_memberships` — đó là F9, không phải F8. Hệ quả: gán
  *và* gỡ Policy khỏi Group đều rẻ tuyệt đối, không tỉ lệ với số device
  trong group (khác hẳn F6 phải `upsert_all` N dòng khi thêm N device).
- **Idempotent**: unique index partial `(policy_id, group_id) WHERE
  group_id IS NOT NULL` + `upsert_all(..., on_duplicate: :skip)` — gán lại
  cùng cặp (bấm "Gán" nhiều lần, hoặc "Thử lại" sau khi `failed`) không bao
  giờ tạo dòng trùng. Dedupe ở tầng service: 1 job `pending`/`running` đang
  chạy cho đúng cặp `(policy_id, group_id)` → trả lại `job_id` cũ, không tạo
  job song song vô ích.
- **Trạng thái job**: enum `pending → running → done` hoặc `failed`
  (`policy_assignment_jobs.status`) — FE poll `GET
  /policy_assignment_jobs/:id` mỗi 2s, banner sticky đổi màu/nội dung theo
  4 trạng thái này (`AsyncJobBanner.vue`), re-attach khi rời/quay lại trang
  Group Detail (`GET /groups/:id/policy_assignment_jobs?status=pending,running`)
  — không bao giờ "bấm xong không biết gì" (yêu cầu chấm điểm rõ trong
  PRD). `processed_count` là cosmetic (nhảy thẳng `0 → total_count` khi
  `done`) vì không có khái niệm "batch thứ N/M" dưới Phương án A — không có
  progress bar %.
- **Xóa Group giữa lúc job đang chạy**: `Group` model có
  `before_destroy :fail_pending_policy_assignment_jobs` (set job
  `pending`/`running` → `failed` ngay trong transaction destroy) +
  `has_many :policy_assignment_jobs, dependent: :nullify` (không
  `:delete_all`) — job vẫn tồn tại và poll được `status: "failed"` sau khi
  Group đã mất, chỉ mất tham chiếu `group`. `has_many :policy_assignments,
  dependent: :delete_all` dọn sạch liên kết Group↔Policy trong cùng
  transaction (không để dữ liệu treo, `CLAUDE.md` §4).
- **Vận hành**: 1 service `worker` mới trong `docker-compose.yml` (chạy
  `bin/jobs`, tức `SolidQueue::Supervisor`), share Postgres với `api` (không
  tách database riêng cho queue) — `docker compose up` khởi cả 2, không cần
  bước tay. Test dùng `config.active_job.queue_adapter = :test` +
  `perform_enqueued_jobs` (job chạy đồng bộ trong transaction test), không
  chờ worker thật — tránh flaky/sleep trong CI.

## Tính policy đang áp dụng và conflict

F9 (`api/app/services/devices/policy_resolver.rb`) trả về policy thực áp
dụng trên 1 Device, đúng công thức bất biến ở `CLAUDE.md` §4: hợp của (policy
gán trực tiếp) ∪ (policy của mọi Group Device đang thuộc), lọc `status:
active` **tại thời điểm gọi** (không cache — gọi lại nhiều lần với state
không đổi ra kết quả giống hệt tuyệt đối, kể cả thứ tự mảng — R5/A18).

**Query**: 2-4 câu SQL cố định, không phụ thuộc kích thước Group (`GET
.../devices/:id/applied_policies` không chậm dần khi 1 Group có 10.000
device — chỉ phụ thuộc số Group *Device* thuộc và số Policy gán trực tiếp,
luôn nhỏ): 1 câu lấy `group_ids` Device thuộc
(`GroupMembership.joins(:group).merge(current_organization.groups)` — filter
phòng vệ cross-org thứ 2, cùng idiom F6/F8, không phải `raise`), 2 câu lấy
`policy_assignments` (theo `device_id` và theo `group_id IN (...)`), cộng
`includes(:policy, :group)` để tránh N+1. Lọc `status: active` thực hiện ở
**tầng Ruby**, không ở SQL — candidate `inactive` vẫn được giữ lại để phục vụ
"Xem tất cả nguồn" (mỗi `type` chỉ **biến mất hoàn toàn** khỏi kết quả khi
không còn candidate `active` nào — không xuất hiện dạng rỗng).

**Chọn 1 policy thắng khi cùng `type` có nhiều candidate** — 1 khóa sort duy
nhất, 4 phần tử, áp dụng cho tập candidate `active`:

```ruby
sort_key = ->(c) {
  [
    c.device_id.present? ? 0 : 1,   # R2 — gán trực tiếp luôn thắng gán qua Group
    -c.policy.updated_at.to_f,      # R3 — giữa các Group, updated_at mới nhất thắng
    c.policy_id,                    # R4 — hòa updated_at, id nhỏ hơn thắng
    c.group_id || Float::INFINITY   # tie-break hiển thị: cùng 1 policy_id qua ≥2
                                     # Group (vd Device thuộc cả Group A và B, cả 2
                                     # đều gán đúng Policy #7) không phải conflict —
                                     # badge nguồn hiển thị group_id nhỏ nhất, không
                                     # phụ thuộc thứ tự trả về không có ORDER BY
                                     # tường minh của 2 câu SQL ở trên
  ]
}
```

Phần tử thứ 4 (`group_id`) **không có trong câu chữ gốc R2-R4 của `CLAUDE.md`
§4** — không thêm nó, `min_by` sẽ phụ thuộc thứ tự Postgres trả hàng (không
có `ORDER BY` tường minh ở 2 query trên) mỗi khi cùng 1 Policy được gán cho
≥2 Group của cùng 1 Device — vi phạm thẳng "kết quả phải là hàm thuần của
state hiện tại, gọi lại nhiều lần ra cùng kết quả" (R5). Đây là điểm dễ bỏ
sót nhất nếu chỉ đọc `CLAUDE.md`/SoT gốc mà không đọc `docs/design/F9-api.md`
§2.5 — `api/spec/services/devices/policy_resolver_spec.rb` có 1 test riêng
tạo 2 `PolicyAssignment` theo thứ tự **ngược** (`group_id` lớn hơn insert
trước) để phát hiện nếu code lỡ phụ thuộc thứ tự insert/SQL thay vì tie-break
tường minh.

**Conflict** (banner cảnh báo + cờ `⚠` cấp dòng ở FE) tính **độc lập** với
việc đã chọn được dòng thắng: `true` khi tập candidate `active` của 1 `type`
có ≥2 `configuration` khác nhau (so sánh Ruby Hash `==` sau khi Postgres
decode JSONB, không so sánh ở SQL) — kể cả khi 1 trong 2 nguồn là gán trực
tiếp và đã thắng chắc chắn (vd Device gán trực tiếp Policy A, đồng thời thuộc
Group gán Policy B khác configuration cùng `type` — A luôn thắng nhưng vẫn
hiện banner, vì 2 policy khác nhau *đang* được gán chồng lên nhau, chỉ là hệ
thống đã tự chọn 1 cái). Ngược lại, cùng 1 `policy_id` gán qua nhiều Group
(ví dụ trên) không phải conflict (chỉ 1 `configuration` duy nhất trong tập
`active`) dù có ≥2 dòng `policy_assignments` — banner **không** hiện.

Response JSON đầy đủ (`GET /api/v1/devices/:id/applied_policies`), 2 chuỗi
`excluded_reason` cố định ("Ưu tiên thấp hơn" / "Policy đang inactive, không
được tính hiệu lực"), và toàn bộ 15 scenario canonical (S1-S13, S18, S19) —
xem `docs/design/F9-api.md` §2.3/§2.5/§3, `docs/sot/F9-policy-resolution.md`
§11.

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

Acceptance criteria cho `F5`-`F9` được viết đầy đủ dạng scenario trong từng
`docs/sot/<id>-*.md` (vd. `docs/sot/F5-group-crud.md` §11 có 39 scenario),
dùng làm hợp đồng hành vi ánh xạ trực tiếp vào RSpec request spec + Vitest
component test.

### F9 (Policy resolution engine — policy đang áp dụng trên Device, xử lý conflict cùng `type`)
- **AI làm**: toàn bộ vòng đời — SoT, 3 bản thiết kế + preview HTML, plan (13
  task/6 wave), implement (BE TDD trước — service spec RED rồi code GREEN —
  rồi controller/request spec, FE types/api/component/mount song song), gate.
  **User ủy quyền cho AI tự review & approve toàn bộ** trong phiên làm việc
  này, cùng cách đã làm từ F4 — không dừng lại chờ duyệt từng bước.
- **Không phát hiện mâu thuẫn thật nào giữa SoT/3 design/`CLAUDE.md`/PRD cần
  dừng lại báo cáo** trong lúc implement — plan đã tự đối chiếu và chốt hết ở
  bước `/design`/`/plan` trước đó (khác F8, nơi có 2 mâu thuẫn đa-nguồn thật
  phải dừng ở bước brainstorm). 4 điểm plan tự nhắc "dễ bị bỏ sót nếu code
  nhanh" (sort key 4 phần tử không phải 3, giữ nguyên testid
  `device-detail-policies-empty`, `load_candidates` phải
  `.joins(:group).merge(current_organization.groups)`, nhớ sửa
  `DeviceDetailView.spec.ts`) đều đã implement đúng ngay từ đầu, không phải
  quay lại sửa.
- **TDD tuân thủ nghiêm cho `api/app/services/devices/policy_resolver.rb`**
  (`CLAUDE.md` §3 rule 4, đúng service được nêu đích danh làm ví dụ):
  `policy_resolver_spec.rb` viết trước, chạy `bundle exec rspec` xác nhận RED
  thật (`NameError: uninitialized constant Devices` — chưa có class, không
  phải assertion fail giả RED), rồi mới viết `policy_resolver.rb`, chạy lại
  tới GREEN (15/15 example) mà không sửa spec để né logic khó — 1 test cố ý
  tạo 2 `PolicyAssignment` theo thứ tự **ngược** id Group để bắt lỗi nếu
  implementation lỡ phụ thuộc thứ tự SQL thay vì tie-break tường minh ở phần
  tử thứ 4 của sort key (xem "Tính policy đang áp dụng và conflict" ở trên).
- **Bẫy môi trường tự phát hiện khi chạy gate, không phải lỗi code**:
  `docker-compose.yml` set `RAILS_ENV: development` cho service `api` —
  `spec/rails_helper.rb` dùng `ENV['RAILS_ENV'] ||= 'test'`, và vì biến đã có
  sẵn giá trị `development` từ container, `||=` không ghi đè được. Hệ quả:
  chạy `bundle exec rspec` (không set `RAILS_ENV=test` tường minh) load
  `config/environments/development.rb` thay vì `test.rb`, nơi
  `config.hosts.clear` không chạy → mọi request spec HTTP thật (bao gồm
  `device_applied_policies_spec.rb`) bị `ActionDispatch::HostAuthorization`
  chặn 403 ("Blocked hosts: www.example.com") ngay từ request đầu tiên — lỗi
  hạ tầng, không phải lỗi F9. Cách phát hiện: request spec service (không
  gọi HTTP, chỉ gọi thẳng class Ruby) chạy sạch, còn request spec HTTP thì
  toàn bộ báo lỗi giống hệt nhau bất kể nội dung test — dấu hiệu rõ ràng đây
  là lỗi môi trường chứ không phải 10 test cùng sai logic. Sửa bằng chạy
  đúng `RAILS_ENV=test bundle exec rspec` (đúng cách các gate trước đó của
  dự án vẫn chạy, không phải thay đổi hành vi app) — không sửa
  `docker-compose.yml`/`rails_helper.rb` vì đây là quy ước sẵn có của dự án,
  không phải bug cần fix, chỉ là lệnh gọi thiếu biến môi trường.
- **Tự thiết kế (không có trong 3 bản design, phải tự quyết định nhỏ khi
  code, không ảnh hưởng hợp đồng API/FE đã chốt)**:
  - Thêm 3 class CSS mới vào `web/src/styles/components.css`
    (`.link-btn`/`.conflict-flag`/`.candidate-list`) — `F9-frontend.md` giả
    định tái dùng `.chip`/`.warning-banner`/`.skeleton-cell` (đã có thật, xác
    nhận trước khi dùng đúng theo chỉ dẫn coordinator), nhưng không đặt tên
    class cụ thể cho nút "Xem tất cả nguồn"/cờ conflict/danh sách accordion —
    3 class này chưa tồn tại trong codebase, thêm mới theo đúng "extend, không
    fork" đã ghi ở đầu file CSS.
  - Cấu trúc `<tr>` accordion dùng `<template v-for :key="entry.type">` bọc 2
    `<tr>` liền nhau (dòng chính + dòng accordion `colspan="4"`) thay vì tách
    2 `v-for` riêng — cách duy nhất giữ đúng thứ tự DOM (accordion luôn ngay
    dưới dòng `type` của nó) mà vẫn có 1 `:key` ổn định cho Vue.
- **Gate xác nhận độc lập (không chỉ tin báo cáo của subagent implement)**:
  coordinator tự chạy lại cả 3 gate sau khi subagent báo Done —
  `bundle exec rubocop` (98 file/0 offense), `RAILS_ENV=test bundle exec
  rspec` **trong container `api` qua `docker compose exec`** (632
  example/0 failure — toàn bộ suite F0-F9, không chỉ file mới; chạy trên
  máy host trần bị lệch version gem `fugit` do `Gemfile.lock` đòi 1.14.0
  nhưng gem cài local là 1.13.0 — dấu hiệu môi trường host không đồng bộ
  với container, không phải lỗi F9, sửa bằng `bundle install` chứ không
  sửa `Gemfile.lock`), `npm run lint` (sạch), `npx vitest run` + `npm run
  build` (`vue-tsc -b && vite build` sạch) — trước khi coi F9 Done.
- **2 bug thật do `/code-review high` phát hiện, đã sửa** (không phải chỉ
  nitpick — cả 2 là lỗi correctness/UX rò rỉ state giữa 2 Device khác nhau
  trên cùng 1 component instance, chỉ xảy ra khi user điều hướng nhanh giữa
  2 trang `/devices/:id` mà Vue Router tái dùng instance thay vì remount):
  1. `AppliedPoliciesBlock.load()` không có request-token guard — nếu
     response của Device A về **sau** khi user đã chuyển sang Device B (và
     request của B đã resolve trước), `items.value` bị ghi đè ngược bằng dữ
     liệu cũ của A trong khi trang đang hiển thị Device B. Sửa bằng biến
     đếm `requestToken` cục bộ, chỉ áp dụng response nếu token còn khớp lúc
     resolve (`web/src/components/AppliedPoliciesBlock.vue`).
  2. `expandedTypes` (state "đang mở accordion") không bị reset khi
     `deviceId` đổi — accordion đang mở ở Device A vẫn hiện mở cho Device B
     nếu B cũng có `type` trùng tên, lộ nhầm lý do loại candidate của A.
     Sửa bằng reset `expandedTypes.value = []` ở đầu `load()`.
  2 fix trên kèm 2 test Vitest mới (`AppliedPoliciesBlock.spec.ts`) tái hiện
  đúng race condition/leak rồi xác nhận đã sửa; test `DeviceDetailView.spec.ts`
  dòng ~260 (mount trực tiếp, không qua helper `mountView()`) cũng được
  review chỉ ra thiếu `flushPromises()` thứ 2 — bổ sung cho nhất quán, dù
  chưa gây fail vì test đó chưa assert lên `device-detail-policies-*`.
  4 finding còn lại của review **không sửa**, mỗi cái có lý do riêng:
  - Gộp `load_candidates` (2 query direct/via_group) thành 1 câu `OR` — đi
    ngược quyết định đã approve tường minh ở `F9-db.md` §3.1/`F9-api.md`
    §6.1 (tách riêng có chủ đích để chỉ nhánh group mới cần thêm
    `.joins(:group).merge(...)` phòng vệ cross-org; gộp lại sẽ phải áp lớp
    phòng vệ đó cho cả nhánh direct dù không cần) — không phải sơ suất.
  - Gộp 3 hàm serialize Policy trùng lặp giữa `PoliciesController`/
    `GroupPolicyAssignmentsController`/`PolicyResolver` thành 1 serializer
    dùng chung — finding hợp lệ (trùng lặp thật), nhưng sửa sẽ phải đụng 2
    controller ngoài phạm vi diff F9, tăng rủi ro ngoài slice đang review —
    để lại làm rủi ro production ghi nhận, không sửa trong phiên F9 này.
  - Gộp 2 lượt `sort_by`/`map` (active/inactive) trong `resolve_type` thành
    1 lượt, và cache `isExpanded` thay vì gọi lại 3 lần/dòng — cả 2 là tối
    ưu vi mô, không ảnh hưởng correctness, không đáng đổi rủi ro sửa lại
    code đã qua TDD/test xanh chỉ để giảm vài phép lặp mảng nhỏ.

### Bổ sung sau F9 (2026-09-17) — `docs/overview.md` + fixture F9 trong seed
- **User yêu cầu**: 1 file overview liệt kê toàn bộ tính năng + seed data đầy
  đủ để test hết. Không phải feature mới, không qua vòng đời ATDD.
- **AI làm**: tạo `docs/overview.md` (bản đồ route FE ↔ endpoint ↔ fixture
  seed cho từng F-id, không lặp lại nội dung `DESIGN.md`/`docs/backlog.md`).
  `api/db/seeds.rb` seed sẵn đủ dữ liệu cho F0-F8 nhưng **thiếu ca conflict/
  tie-break thật cho F9** — mọi policy trong seed cũ chỉ có 1 policy/`type`
  mỗi org nên `PolicyResolver` chưa từng phải chọn giữa 2 candidate active
  khác nhau khi chạy tay qua UI. Thêm 4 fixture mới (2 policy mới ở Acme:
  `Executive Password`/`Modern VPN`, 1 ở Globex: `Sales Password`, cộng vài
  `GroupMembership`) tạo đúng 4 nhánh của `CLAUDE.md` §4 quan sát được trên
  `ACME-0001` (direct thắng group, vẫn `conflict: true`), `ACME-0002` (2
  group tranh nhau, không có direct — tie-break `updated_at`), `ACME-0003`
  (candidate inactive bị loại nhưng type không biến mất — `Legacy VPN` gán
  **sau khi** đã set inactive, mô phỏng đúng luồng thật "policy bị tắt sau
  khi đã gán", không phải bypass validate "không gán Policy inactive" của
  service layer) và `GLBX-0002` (lặp lại ca tie-break ở org còn lại, chứng
  minh resolver không lẫn state giữa 2 Organization). Xác nhận cả 4 bằng
  cách gọi trực tiếp `Devices::PolicyResolver.new(device).call` qua `bin/
  rails runner` trong container `api` — khớp đúng kỳ vọng trước khi ghi vào
  `docs/overview.md`.
- **Phát hiện ngoài lề, đã tự xử lý**: DB dev trong container `api` đang
  chạy có 588 `Organization`/7543 `Device` rác (tên dạng `Acme Inc. 3abf6355`
  — dấu vân tay FactoryBot/Faker) lẫn với 2 org seed thật, nhiều khả năng do
  một lần chạy `rspec` trước đó lỡ trỏ vào DB development thay vì test (xem
  bẫy `RAILS_ENV` đã ghi ở mục F9 phía trên — cùng nguyên nhân, khác lần xảy
  ra). Không phải lỗi seed/code lần này; dọn bằng `TRUNCATE ... RESTART
  IDENTITY CASCADE` toàn bộ bảng nghiệp vụ + `solid_queue_*` (không
  `db:reset`/`db:drop` vì `api`/`worker` đang giữ connection) rồi
  `db:seed` lại cho khớp đúng state 2-org mà `docs/overview.md` mô tả.
  Volume Docker của reviewer khi clone repo mới là volume rỗng nên không bị
  ảnh hưởng — ghi lại ở đây phòng khi việc này tái diễn.

### Bổ sung 2026-09-18 — README (setup/seed/test/walkthrough) + Vite dev server stale
- **User yêu cầu**: (1) user báo click vào 1 row bất kỳ ở `/groups` không
  chuyển trang, và vào thẳng `/groups/8` báo "Không tìm thấy Group"; (2) sau
  khi xử lý xong, yêu cầu rà soát + cập nhật `README.md` cho đúng hiện trạng
  và thêm link `docs/overview.md`.
- **Chẩn đoán (1) bằng Playwright headless, không phải chỉ đọc code**: dựng
  script tự login + click row cho cả 3 màn Devices/Groups/Policies. Devices
  chuyển trang bình thường, Groups/Policies thì không — loại trừ được cả giả
  thuyết CSS overlay chặn click (`force click` vẫn không chuyển) lẫn giả
  thuyết lỗi logic `viewDetail`/`router.push` (source trên đĩa hoàn toàn
  đúng, giống hệt `DeviceListView.vue`). Bằng chứng quyết định: so `curl
  http://localhost:5173/src/views/groups/GroupListView.vue` (JS Vite thực sự
  trả về) với file trên đĩa — khác nhau (server trả về hằng số
  `DELETE_MISSING_MESSAGE` không hề tồn tại trong lịch sử git, đáng lẽ phải
  là `GROUP_MISSING_MESSAGE` từ commit F6). Kết luận: container `web` (Vite
  dev server) đã chạy liên tục 2 ngày không restart, file-watcher (chokidar
  qua Docker bind-mount trên macOS) bị đứng nên phục vụ bản compile CŨ, từ
  trước khi row-click của Groups/Policies được nối dây xong — không phải bug
  trong code hiện tại. Sửa bằng `docker compose restart web` (không đổi 1
  dòng code), verify lại bằng đúng bộ Playwright script đó: cả 3 list đều
  chuyển trang đúng. `/groups/8` báo "không tìm thấy" khi đăng nhập Acme là
  **đúng theo thiết kế** (id 8 là group của Globex — 404 do tách Organization,
  `CLAUDE.md` §4), verify bằng cách login cả 2 org rồi vào cùng URL.
- **Việc (2)**: `README.md` cũ (viết từ F0, chưa cập nhật) nói sai hiện trạng
  (liệt kê F8/F9 "chưa build" dù đã Done từ trước), thiếu bảng tài khoản seed
  rõ ràng, thiếu walkthrough 5 phút PRD §"Tài liệu bắt buộc" yêu cầu, và lệnh
  test là 4 lệnh rời rạc thay vì "chạy test một lệnh" (PRD §2). Viết lại:
  cập nhật trạng thái F0-F9 Done, thêm bảng 5 tài khoản seed, gộp 4 lệnh gate
  bằng `&&` thành 1 lệnh copy-paste được, thêm walkthrough 5 bước (gán Policy
  cho Group lớn + xem Device Detail có conflict), link `docs/overview.md`/
  `DESIGN.md` ở đầu file. Mỗi bước trong walkthrough đều tự tay chạy qua
  Playwright/`docker compose exec` trước khi ghi vào README, không suy đoán:
  xác nhận label UI thật là banner "Đã tự động chọn policy ưu tiên cao hơn
  cho N loại đang xung đột" + icon ⚠ (không phải chữ "Conflict" như bản nháp
  đầu), xác nhận nút gán Policy bị `disabled` ở UI khi Policy `inactive`
  (`PolicyDetailView.vue` `assignDisabled`) nên không thể "thử gán rồi bị
  chặn" qua UI như bản nháp đầu viết nhầm, và xác nhận job seed sẵn cho
  "Bulk Ops (F8 demo)" đã chuyển `done` từ lâu (worker chạy liên tục) nên
  walkthrough phải tự gán 1 Policy MỚI để thấy banner `pending → running →
  done` thay vì trỏ vào job cũ đã xong.
- **Đã chạy đúng lệnh "1 lệnh" mới của README** (`rspec && rubocop && eslint
  && vitest`) trong container thật trước khi commit vào README: 632/632 +
  98 file/0 offense + eslint sạch + 406/406 — không chỉ tin là nó chạy được.

### F8 (Policy assignment — gán Group và/hoặc Device, chặn inactive/chéo org, chịu group lớn, trạng thái job)
- **AI làm**: toàn bộ vòng đời — SoT (12 OQ), 3 bản thiết kế + preview HTML,
  plan (56 task/7 wave), implement (2 nhánh BE/FE chạy song song), gate.
  **User ủy quyền cho AI tự review & approve toàn bộ** (SoT, cả 3 design,
  mọi open question, plan) trong phiên làm việc này, cùng cách đã làm từ F4
  — không dừng lại chờ duyệt từng bước, kể cả bước implement.
- **Mâu thuẫn đa-nguồn được xử lý đúng quy trình `CLAUDE.md` §5** (dừng lại,
  báo cáo, người có thẩm quyền quyết định — không tự chọn ngầm), phát hiện
  ngay ở bước brainstorm trước khi bất kỳ dòng thiết kế nào được viết:
  - **Tên 4 trạng thái job**: `docs/backlog.md` viết `running/done/failed`
    (thiếu `pending`), `CLAUDE.md` §4 viết `pending/running/done/failed`,
    `UI_UX_design.md` §6.3 viết `queued/running/completed/failed` — 3 nguồn,
    3 tên khác nhau cho cùng khái niệm. Quyết định (SoT §12 OQ-1): dùng
    đúng 4 giá trị của `CLAUDE.md` §4 làm enum DB/API thật;
    `queued`/`completed` của `UI_UX_design.md` chỉ là label UX minh họa,
    không phải field contract.
  - **Shape bảng `policy_assignments`**: câu `CLAUDE.md` §4 "mỗi device một
    dòng `policy_assignments` với `source: group/direct`" đọc được theo 2
    cách — fan-out theo device (Phương án B) hay 1 dòng/cặp
    Policy↔Group/Device (Phương án A). Quyết định (SoT §12 OQ-2): Phương án
    A — tách rõ ranh giới F8 (gán)/F9 (resolution), tránh F6 phải biết về
    `policy_assignments` mỗi khi đổi membership, và làm gán/gỡ Policy khỏi
    Group rẻ tuyệt đối (1 dòng, không tỉ lệ số device) — xem "Xử lý Group
    rất lớn" ở trên.
- **Chỗ AI (vai trò db-designer) tự sửa giữa lúc thiết kế, có ghi rõ lý do
  (không phải lỗi, mà là 1 lệch có chủ đích với chỉ dẫn kỹ thuật ban đầu)**:
  chỉ dẫn gốc đề `Group has_many :policy_assignment_jobs, dependent:
  :delete_all` (cùng hàng với `policy_assignments`). db-designer tự phát
  hiện điều này vi phạm trực tiếp 1 acceptance scenario đã approve ở SoT
  ("Job gán Policy cho Group bị xóa giữa lúc đang chạy chuyển sang
  failed") — `:delete_all` sẽ xóa mất chính dòng job mà scenario đó yêu cầu
  phải còn tồn tại và đọc được `status: failed`. Đổi sang `dependent:
  :nullify` + `before_destroy` callback (chuyển job `pending`/`running`
  sang `failed` trước khi nullify), khai báo callback **trước** dòng
  `has_many` (thứ tự bắt buộc — xem "Xử lý Group rất lớn"). Claude chính
  (vai trò duyệt) xác nhận đúng theo SoT, không sửa SoT.
- **Chỗ AI (vai trò Plan) không tự viết ra file, chỉ mô tả trong chat — bị
  Claude chính phát hiện khi verify, không phải tự tin báo cáo**: subagent
  `Plan` báo cáo đã ghi `docs/plan/F8-policy-assignment.md` và dán nội dung
  đầy đủ trong phần tóm tắt trả về, nhưng file thực tế **không tồn tại**
  trên đĩa (agent thứ nhất trước đó cũng thất bại giữa chừng vì hết rate
  limit của phiên, agent thứ hai hoàn thành nhưng có vẻ chỉ soạn nội dung mà
  không thực sự gọi Write). Bắt bằng đúng nguyên tắc "trust but verify" —
  chạy `ls docs/plan/` sau khi agent báo Done thay vì tin lời báo cáo — rồi
  tự ghi lại y nguyên nội dung agent đã soạn (đã đọc và xác nhận nội dung đó
  hợp lý) vào đúng đường dẫn.
- **Chỗ AI (vai trò implement FE) sai, bị Claude chính tự phát hiện sau khi
  agent báo cả 2 gate (ESLint, Vitest) đã xanh**: `npm run lint`/`npm run
  test:unit` không chạy `vue-tsc` toàn project, nên 1 lỗi kiểu (test mock
  `Policy` thiếu field `configuration` bắt buộc, ở
  `GroupDetailView.spec.ts`) lọt qua cả 2 gate — chỉ `npm run build`
  (`vue-tsc -b && vite build`) mới bắt được. Claude chính tự chạy thêm lệnh
  này ngoài 2 gate agent đã báo (đúng thói quen đã áp dụng từ F7: không chỉ
  tin báo cáo tóm tắt, tự verify độc lập bằng công cụ thật), phát hiện và
  sửa 1 dòng test, chạy lại `build`/`test:unit` xác nhận cả 2 vẫn xanh.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - Vận hành Solid Queue lần đầu trong repo: thêm 1 service `worker` mới
    vào `docker-compose.yml` (thay vì Procfile/foreman — repo chưa dùng cả
    2, chạy chính qua Docker Compose) — quyết định thuộc `/plan`, không có
    trong 3 bản design (db-designer chủ động để ngỏ đúng chỗ này cho
    `/plan` quyết, không đoán mò).
  - `AsyncJobBanner`/`stores/jobs.ts` mount **1 lần global** ở
    `AppShell.vue` (không mount cục bộ mỗi view) — vì job có thể khởi tạo
    từ 2 entry point (Group Detail, Policy Detail) và phải sống sót qua
    điều hướng SPA giữa 2 trang đó.
  - Gỡ Policy khỏi Group từ **cả 2 hướng** (Group Detail tab Policies,
    Policy Detail tab Group) gọi **cùng 1 hàm API** (tham số đảo) — API
    design chỉ có 1 endpoint `DELETE /groups/:id/policy_assignments/:policy_id`,
    không có endpoint đối xứng dưới `/policies`.
- **Không có bug nào khác của AI bị phát hiện trong lúc implement** ngoài 2
  điểm ở trên (Plan không ghi file, lỗi kiểu ở test FE) — 2 nhánh
  Backend/Frontend chạy song song (khác thư mục, không đụng file nhau),
  mỗi nhánh tự chạy gate của mình trước khi báo Done; Claude chính chạy lại
  độc lập cả 4 lệnh sau khi cả 2 nhánh xong: `bundle exec rubocop` (94
  file/0 offense), `RAILS_ENV=test bundle exec rspec` (607 example/0
  failure — có seed thật enqueue 2 job async qua worker container, verify
  cả 2 chuyển `done`, không chỉ test giả lập), `npm run lint` (sạch),
  `npm run test:unit` (396 test/29 file, sau khi sửa lỗi kiểu ở trên) +
  `npm run build` (`vue-tsc -b && vite build` sạch) — trước khi coi F8 là
  Done.

### F7 (Policy CRUD — list/create/edit, status)
- **AI làm**: toàn bộ vòng đời — SoT (10 OQ), 3 bản thiết kế + preview HTML,
  plan (20 task/7 wave), implement (2 nhánh BE/FE chạy song song), gate. **User
  ủy quyền cho AI tự review & approve toàn bộ** (SoT, cả 3 design, mọi open
  question, plan) trong phiên làm việc này, cùng cách đã làm từ F4 — không
  dừng lại chờ duyệt từng bước, kể cả bước implement. Khác các feature trước:
  vai trò "người duyệt" và vai trò "agent thiết kế" là 2 lượt gọi Claude tách
  biệt trong cùng phiên (subagent viết bản nháp → Claude chính đọc lại, tự
  verify bằng công cụ thật thay vì chỉ đọc văn bản, sửa lỗi trước khi tự
  approve) — nhờ vậy 2 lỗi thật ở mục dưới được bắt **trước khi** code, không
  phải trong lúc implement hay code review sau đó.
- **Chỗ AI (vai trò db-designer) sai, bị Claude chính (vai trò duyệt) tự phát
  hiện và sửa trước khi approve `docs/design/F7-db.md`**: bản nháp đầu tiên
  đặt tên cột nghiệp vụ là `type` (đúng thuật ngữ PRD) và ghi chú "an toàn vì
  Rails chỉ kích hoạt Single Table Inheritance khi có class con kế thừa
  `Policy`" — **sai**: `ActiveRecord::Inheritance` kích hoạt STI dựa trên **sự
  tồn tại của cột `type`**, không phụ thuộc có subclass hay không, nên mọi
  `Policy.find`/`organization.policies.all` sẽ raise
  `ActiveRecord::SubclassNotFound` ngay khi có ≥1 policy với `type` thật (vd
  `"wifi"`). Bị bắt bằng cách đọc kỹ tài liệu Rails `ActiveRecord::Inheritance`
  trong lúc review thay vì chỉ tin lời giải thích của bản nháp — sửa bằng
  `self.inheritance_column = "_type_disabled"` làm dòng đầu tiên của class,
  kèm 1 RSpec regression test riêng (T3) để lỗi này không thể quay lại êm ru.
- **Chỗ AI (vai trò api-designer) sai, bị Claude chính tự phát hiện và sửa
  trước khi approve `docs/design/F7-api.md`**: bản nháp khẳng định request
  `GET /api/v1/policies/:id` (route không tồn tại, SoT OQ-7) trả về "trang 404
  mặc định của Rails (HTML)" — **sai**, và không được verify trước khi viết
  vào tài liệu. Claude chính tự chạy `rails runner` thật trên chính app này
  (giả lập request có header `Accept: application/json` — đúng header mọi
  request spec/axios thật gửi) và phát hiện: ở `test`/`development` body thực
  ra là **JSON debug đầy đủ** của `ActionDispatch::DebugExceptions` (rò rỉ tên
  exception class + backtrace), còn ở cấu hình kiểu production là JSON sạch
  nhưng khác shape `{"error": "Not found"}` chuẩn của app. Sửa tài liệu theo
  đúng bằng chứng đã verify (không suy đoán), và chốt rule cho test: chỉ
  assert status `404`, không bao giờ assert body cho nhánh này.
- **Mâu thuẫn SoT/`UI_UX_design.md` được xử lý đúng quy trình `CLAUDE.md` §5**
  (dừng lại, báo cáo, người có thẩm quyền quyết định — không tự chọn ngầm):
  `UI_UX_design.md` §7.1 mô tả `type` là "select, danh sách cố định theo
  domain", nhưng PRD không cho danh sách type cụ thể nào. Quyết định (ghi rõ
  trong SoT §12 OQ-3 và `F7-frontend.md` §0.1): giữ `type` free-form string ở
  DB, nhưng FE hiện field này dưới dạng **combobox** (`&lt;input list&gt;` +
  `&lt;datalist&gt;`, gợi ý = type distinct đã có trong org, vẫn gõ được giá trị
  mới) — hoà giải tinh thần "chọn từ danh sách" của UI_UX mà không bịa ra 1
  enum domain-specific ngoài đề bài.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - Combobox `type` qua `&lt;datalist&gt;` gốc HTML5 (không thư viện dropdown
    riêng) — nguồn gợi ý lấy từ `store.policies` đã tải sẵn (không gọi thêm
    endpoint), chấp nhận giới hạn "chỉ phủ trang/filter đang xem" vì đây chỉ
    là gợi ý tiện lợi, không phải validate (ghi rõ trade-off ở OQ-FE-1).
  - JSON editor cho `configuration` — textarea + nút "Format" + parse-on-blur,
    dùng 1 hàm `parseConfiguration()` duy nhất cho cả blur/Format/submit
    (tránh 3 bản logic lệch nhau), không tự động sửa/format khi đang lỗi.
  - `to_unsafe_h` scoped đúng 1 field `configuration` ở strong params — lần
    đầu dự án dùng, vì `permit(configuration: {})` chuẩn của Rails âm thầm bỏ
    field khi giá trị sai kiểu (bug im lặng: `PATCH` với `configuration` sai
    kiểu sẽ trả `200` giữ nguyên giá trị cũ thay vì `422`). Giới hạn chặt vào
    đúng 1 field, không mở `to_unsafe_h` cho toàn bộ params.
  - Thêm prop `wide?: boolean` (default `false`) vào `FormModal.vue` dùng
    chung — JSON editor 8 dòng monospace cần rộng hơn khung 360px mặc định.
    Thuần cộng thêm, `GroupFormModal`/`DeviceFormModal` không đổi hành vi.
- **Không có bug nào của AI bị phát hiện trong lúc implement** (khác các
  feature trước) — nhờ 2 lỗi thiết kế ở trên đã bị chặn từ trước khi code.
  Một ghi chú vận hành (không phải lỗi logic): agent backend lần đầu chạy
  `bundle exec rspec` qua `docker exec` kế thừa `RAILS_ENV=development` của
  container (đặt trong `docker-compose.yml` cho service `api`), khiến
  `ActionDispatch::HostAuthorization` chặn host `www.example.com` mà RSpec
  request spec dùng mặc định — phải truyền `-e RAILS_ENV=test` tường minh.
  Claude chính (vai trò duyệt) tự chạy lại độc lập cả 3 gate (`bin/rubocop`,
  `bundle exec rspec` qua Docker với `RAILS_ENV=test`, `npm run lint`/
  `test:unit`/`build`) sau khi 2 agent implement báo Done, xác nhận cùng kết
  quả (503 RSpec example/0 failure, 70 file rubocop/0 offense, 310 Vitest
  test/0 failure, ESLint sạch, `vue-tsc -b && vite build` sạch) trước khi coi
  F7 là Done — không chỉ tin báo cáo tóm tắt của agent.

### F6 (Group membership tại scale — thêm/gỡ device, chịu 10.000 device, idempotent)
- **AI làm**: toàn bộ vòng đời — SoT (8 OQ), 3 bản thiết kế + preview HTML,
  plan (39 task/6 wave), implement (2 nhánh BE/FE chạy song song), gate. **User
  ủy quyền cho AI tự review & approve toàn bộ** (SoT, cả 3 design, mọi open
  question, plan) trong phiên làm việc này, cùng cách đã làm từ F4 — không
  dừng lại chờ duyệt từng bước, kể cả bước implement.
- **Trả 2 món nợ F5 đã ghi rõ lúc approve** (`docs/design/F5-db.md` §4a,
  `docs/sot/F5-group-crud.md` OQ-4/OQ-5): `Group has_many :group_memberships,
  dependent: :delete_all` (xóa Group không để `group_memberships` mồ côi,
  Device không bị xóa — test cả ở model spec lẫn request spec, kể cả ở quy mô
  10.000 dòng) và cột "Số device" + action "Xem chi tiết" trên Group List.
- **Quyết định phạm vi quan trọng nhất (SoT OQ-1)**: `docs/backlog.md` mô tả
  F6 phải "chịu 10.000 device, idempotent", còn `UI_UX_design.md` §6.2 vẽ thêm
  tính năng tùy chọn "thêm hàng loạt theo filter" (cần kiến trúc Solid Queue
  job như gán Policy ở F8). AI chọn **không** làm bulk-by-filter — yêu cầu
  "chịu 10.000 device" được đáp ứng đủ qua phân trang server-side + `upsert_all`
  đồng bộ (cap 500 device/request), vì `CLAUDE.md` §4 chỉ bắt buộc async job
  cho **gán Policy** cho Group lớn, không cho membership. Giữ đúng ranh giới
  scope F6/F8 thay vì làm sớm 1 phần việc của F8.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - `AsyncSearchSelect.vue` — component dùng chung build lần đầu (debounce,
    chọn 1/nhiều, chip lựa chọn, loading/empty trong dropdown), viết đủ tổng
    quát (fetcher do caller truyền vào, không biết gì về Device/Group/Policy
    cụ thể) để F7/F8 tái dùng nguyên props, không phải sửa lại khi tới lượt.
  - `POST .../devices` dùng `upsert_all(on_duplicate: :skip)` — cặp đã tồn tại
    **không** bump `updated_at`, để nhất quán với quyết định không thêm
    `belongs_to :group, touch: true` (tránh 2 chuẩn khác nhau giữa bulk-add
    qua `upsert_all` — bỏ qua mọi callback — và gỡ đơn lẻ đi qua model).
  - `DELETE .../devices/:device_id` dùng `delete_all` + kiểm tra
    `deleted_count` (không phải `destroy!`/`find_by` mù) — siết hơn 1 mức so
    với văn bản gợi ý ban đầu ở `docs/design/F6-db.md`, để đảm bảo đúng nghĩa
    đen "đúng 1 request thành công" của acceptance scenario race-gỡ dưới race
    thật sự đồng thời (2 request cùng thấy record tồn tại trước khi request
    nào `DELETE` xong).
  - `devices_count` tính bằng `COUNT`/`GROUP BY` trực tiếp, không counter
    cache — vì `upsert_all` bỏ qua AR callback nên counter cache mặc định của
    Rails sẽ lệch nếu không tự cập nhật thủ công mọi nơi ghi; đánh đổi chấp
    nhận được ở quy mô hiện tại (hàng chục–hàng trăm Group/trang).
- **Chỗ AI sai đã tự phát hiện và sửa (trước khi báo Done)**:
  - RSpec request spec ban đầu gửi `device_ids: []` bằng form-encode mặc định
    của test helper — Rails/Rack biến `[]` thành `device_ids[]=` rồi controller
    nhận `[""]`, rơi nhầm vào nhánh "toàn bộ không hợp lệ" (A11) thay vì
    "device_ids rỗng/sai kiểu" (A13) mà scenario đó thực sự muốn kiểm. Lỗi ở
    **test**, không phải code sản phẩm — sửa bằng cách gửi request dạng
    `as: :json` (đúng cách FE/axios thật sự gửi), nhờ đó 4 case
    `nil`/string/object/mảng-rỗng mới thật sự kiểm được đúng nhánh validate.
  - Test đếm N+1 cho `GroupsController#index` (so số query giữa trang có 5
    Group và trang có 10 Group) lần đầu fail "ngược đời" (5 group ra nhiều
    query hơn 10 group) vì request đầu tiên của mỗi example RSpec luôn tốn
    thêm vài query khởi tạo connection/schema — sửa bằng 1 request khởi động
    trước khi đo, không đổi assertion.
  - Lần đầu viết danh sách kết quả `AsyncSearchSelect` bằng `v-for` và
    `v-else` trên cùng 1 phần tử — vi phạm `vue/no-use-v-if-with-v-for`; ESLint
    tự bắt được ngay, sửa bằng cách bọc `<template v-else>`.
  - 2 case Vitest tự viết sai lúc đầu (banner có ký tự `⚠` nên `toBe` fail
    thay vì `toContain`; stub phân trang giữ `current_page: 2` sau khi đổi
    filter dù thiết kế yêu cầu reset về trang 1) — cả 2 đều sửa **spec cho
    đúng thiết kế**, không sửa code để né lỗi.
  - 9 assertion cũ của F4/F5 (7 ở RSpec, 2 ở Vitest `GroupListView.spec.ts`)
    **phải sửa** dù plan ghi "không đụng spec cũ" của các gate regression (T5,
    T14, T16, T39) — vì các case này khẳng định tường minh **sự vắng mặt**
    của đúng những gì F6 được approve để thêm vào (`GET /groups/:id` chưa tồn
    tại, `devices_count` chưa lộ ra, `GroupPolicy#show?` deny-by-default, Group
    List chưa có "Xem chi tiết"/row-click) — mâu thuẫn trực tiếp với hợp đồng
    3 bản thiết kế đã approved, không phải né lỗi. Mỗi case được viết lại kèm
    comment nêu rõ trước đây khẳng định điều ngược lại và vì sao F6 đổi.
  - `FormModal.vue` (component dùng chung, F3) được thêm 1 prop
    `submitDisabled?: boolean` (default `false`, thuần cộng thêm) — thiết kế
    frontend ghi "tái dùng nguyên vẹn, không sửa" nhưng 2 modal mới của F6 cần
    disable nút submit khi chưa chọn gì trong `AsyncSearchSelect`, và dùng
    `submitting` cho việc này sẽ hiện sai trạng thái (spinner) lúc chưa submit
    gì. Spec cũ của `FormModal`/`DeviceFormModal`/`GroupFormModal` xanh
    nguyên, không đổi hành vi mặc định.

### F5 (Group CRUD — list/create/edit/xóa an toàn)
- **AI làm**: toàn bộ vòng đời còn lại của quy trình (SoT → 3 bản thiết kế +
  preview HTML → plan 30 task/8 wave → implement → gate). **User ủy quyền cho
  AI tự review & approve toàn bộ** (SoT, cả 3 design, mọi open question) trong
  phiên làm việc này — không dừng lại chờ duyệt từng bước.
- **Quyết định phạm vi quan trọng nhất (SoT OQ-3)**: tại thời điểm F5 build,
  `group_memberships` (F6) và `policy_assignments` (F8) **chưa tồn tại**, nên
  invariant nặng nhất của đề bài ("xóa Group không để dữ liệu treo",
  `CLAUDE.md` §4) **chưa thể test end-to-end** ở F5. AI chọn: F5 chỉ chốt
  **hợp đồng hành vi** (transaction ngầm của `#destroy!`, `dependent:
  :delete_all` tường minh khi bảng tồn tại) và **ghi nợ tường minh** cho F6/F8
  phải tự thêm association + test "xóa group không để join row mồ côi,
  device/policy vẫn còn" khi tạo bảng join tương ứng — thay vì tạo sớm 2 bảng
  đó (đoán mò schema/index mà F6/F8 sẽ tự thiết kế lại theo yêu cầu 10k
  device/idempotent) hoặc gắn tag skip lên một scenario RED vĩnh viễn.
- **Refactor chạm vào 2 feature đã Done** (quyết định lúc approve design API/
  frontend, không phải tự ý lúc code): tách `Paginatable` concern dùng chung
  giữa `DevicesController`/`GroupsController` (thay vì copy lần thứ 2 cùng một
  khối phân trang); chuyển `firstQueryValue` từ `DeviceListView.vue` sang
  `utils/queryParams.ts` dùng chung; gộp `PaginationMeta` vào `types/ui.ts`,
  `DeviceListMeta` thành alias. Cả 3 đều là refactor thuần hành vi, có gate
  regression riêng (chạy lại toàn bộ `devices_spec.rb` + toàn bộ Vitest cũ,
  không sửa spec nào) trước khi coi Done.
- **Tự thiết kế (không có trong PRD, phải tự quyết định và ghi rõ)**:
  - `ConfirmModal.vue` — component xác nhận xóa dùng chung, build lần đầu ở
    F5 dù đã được `UI_UX_design.md` §8 định nghĩa khung trước; đặc tả đủ tổng
    quát (single-flight, không tự đóng, focus mặc định vào nút Hủy, không
    `window.confirm`) để F6 (gỡ device khỏi group) và F8 (gỡ/gán policy) dùng
    lại nguyên vẹn, không phải sửa.
  - Cơ chế highlight sidebar: thiết kế ban đầu chọn `active-class` của
    `RouterLink`, nhưng lúc implement phát hiện `/devices` và `/devices/:id`
    là 2 route **ngang hàng** (không lồng nhau) nên `active-class` không
    match ở trang chi tiết Device — chuyển sang so `route.path` bằng
    `startsWith` (phương án dự phòng đã được ghi sẵn trong
    `docs/design/F5-frontend.md` OQ-FE-3 cho đúng tình huống này), có comment
    giải thích ngay trong `AppShell.vue`.
  - Bỏ cột "Số device" và action "Xem chi tiết" khỏi Group list dù
    `UI_UX_design.md` §6.1 có vẽ — vì F5 chưa có `group_memberships` (không
    nguồn dữ liệu cho số đếm) và chưa có nội dung thật cho trang chi tiết
    (tab Thành viên/Policies thuộc F6/F8); dựng sớm sẽ là field giả/trang
    trống. F6 phải khôi phục đầy đủ cả hai.
- **Chỗ AI sai đã tự phát hiện và sửa (trước khi báo Done)**:
  - Hai bẫy thiết kế được chủ động kiểm chứng bằng cách phá code có chủ đích
    rồi khôi phục, để xác nhận test thật sự bắt được thay vì tin suông vào
    coverage: (1) đổi `group.destroy!` thành `group.delete` → request spec
    "goes through #destroy" đỏ ngay; (2) bỏ `Group.sanitize_sql_like` khỏi
    filter `q` → 2 case `q="%"`/`q="_"` đỏ ngay (ghi chú: một mình case
    `q="100%"` **không** đủ bắt bẫy này vì pattern `%100%%` vẫn chỉ khớp tên
    có chứa "100" — phải có case `q` là thuần ký tự wildcard mới bắt được).
  - `/code-review` (medium) sau khi implement xong phát hiện 3 lỗi thật
    trong code do AI viết, cả 3 đều đã sửa và có test khóa lại hành vi đúng:
    (1) `GroupListView.onSaved` bắn **2 request `GET /groups`** cho 1 lần tạo
    group khi đang ở trang ≥ 2 — `replaceQuery` bỏ `page` khỏi URL đã tự kích
    hoạt `watch(activeQuery, load)`, cộng thêm lệnh `load()` tường minh ngay
    sau đó là dư thừa; sửa bằng cách chỉ gọi `load()` tường minh khi đang ở
    trang 1 (lúc đó `replaceQuery` không đổi URL nên watcher không tự chạy),
    thêm test riêng "refetch đúng 1 lần" cho cả 2 nhánh (đang ở trang 1 / đang
    ở trang khác) và siết assertion cũ từ `toBeGreaterThan` thành đúng bằng
    số lần gọi. (2) hằng `DELETE_MISSING_MESSAGE` (tên ngụ ý chỉ dùng cho
    luồng xóa) bị dùng lại cho cả nhánh 404 của luồng **sửa** — đổi tên thành
    `GROUP_MISSING_MESSAGE` để tên hằng khớp đúng phạm vi dùng, tránh người
    sau sửa nhầm câu chữ của luồng này mà không biết đang ảnh hưởng cả luồng
    kia. (3) `ConfirmModal.vue` hard-code `id="confirm-modal-title"` cho
    `aria-labelledby` — an toàn ở F5 vì `GroupListView` chỉ mount 1 modal tại
    một thời điểm, nhưng component này được thiết kế để F6/F8 dùng lại
    nguyên vẹn nên không được giả định mãi mãi chỉ có 1 instance; sửa bằng
    `useId()` (Vue 3.5) để mỗi instance có id riêng, tránh đụng độ DOM id nếu
    sau này có màn hình mount 2 `ConfirmModal` cùng lúc.
  - Các finding còn lại của code review (trùng lặp shell modal giữa
    `ConfirmModal`/`FormModal`, trùng khối field-error giữa
    `GroupFormModal`/`DeviceFormModal`, trùng guard `lastRequestId` giữa
    `stores/groups.ts`/`stores/devices.ts`, nút "+ Thêm Group" lặp ở 2 nơi
    trong `GroupListView.vue`) là duplication ở mức thấp, nhất quán với
    pattern per-feature-modal/per-feature-store đã có từ F2/F3 (không phải
    hồi quy do F5 gây ra) — không sửa để tránh trừu tượng hoá sớm ngoài
    scope, theo đúng nguyên tắc "3 dòng lặp còn hơn 1 abstraction non".

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

