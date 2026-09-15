# CLAUDE.md — Device Management Console

Tài liệu điều hành cho Claude Code khi làm việc trong repo này. Đề bài đầy đủ:
`PRD.md`. Không sửa `PRD.md`.

## 1. Sản phẩm & stack

Device Management Console — Organization quản lý Users/Devices/Groups/Policies,
dữ liệu tách biệt tuyệt đối giữa các Organization.

| | |
|---|---|
| Backend | Ruby 4.0.x, Rails 8.1 (API-only, `rails new api --api`) |
| DB | PostgreSQL 16 (Docker) |
| Frontend | Vue 3 + Vite + TypeScript, Pinia, Vue Router, Axios |
| Background job | Solid Queue (đi kèm mặc định Rails 8, không cần Redis/Sidekiq) |
| Auth | JWT (Bearer), không dùng session cookie — SPA gọi API qua origin riêng |
| Authorization | Pundit, scope mọi query qua `current_organization.<assoc>`, không bao giờ `Model.find` trần |
| Test backend | RSpec + FactoryBot + Faker |
| Test frontend (unit) | Vitest + @vue/test-utils |
| Test E2E | Playwright + `playwright-bdd` (Gherkin, tiếng Anh) — chạy qua cả `api/` lẫn `web/` thật, không mock |
| Lint | Rubocop (`rubocop-rails-omakase`), ESLint + Prettier |
| Version manager | `mise` (đã có Ruby 4.0.5/Rails 8.1.3.1; chạy `mise use node@24` trước khi tạo `web/`) |

## 2. Layout repo (monorepo)

```text
api/                  # Rails API
web/                  # Vue SPA
features/             # Gherkin (.feature) + step definitions dùng chung, drive cả api+web
docs/
  sdlc.md             # vòng đời ATDD chi tiết — đọc trước khi chạy bất kỳ command nào
  backlog.md          # danh sách feature (F-id), dependency map
  sot/<id>-<slug>.md               # Source of Truth đã/đang được approve — output của /brainstorm
  design/<id>-{db,api,frontend}.md # output của /design
  plan/<id>-<slug>.md              # output của /plan
  templates/          # template cho 5 loại tài liệu trên (sot, design-db, design-api, design-frontend, plan)
PRD.md                # đề bài gốc — không sửa
UI_UX_design.md        # design system nền cho FE (xem §5) — nguồn bắt buộc của bước Frontend design
DESIGN.md             # tài liệu thiết kế tổng (bắt buộc theo PRD, viết dần khi feature xong)
README.md             # bắt buộc theo PRD — setup, seed, chạy test, walkthrough
```

## 3. 5 golden rule (ATDD/TDD) — xem chi tiết `docs/sdlc.md`

1. Không thiết kế trước khi SoT (`docs/sot/`) `status: approved`.
2. Không code trước khi cả 3 bản thiết kế (`docs/design/<id>-{db,api,frontend}.md`)
   đều `status: approved`.
3. Viết acceptance test (`features/*.feature`) **trước**, xác nhận **RED** đúng lý
   do (feature chưa build) rồi mới code. **Cấm** sửa acceptance test để nó pass.
4. TDD cho pure logic (`api/app/services/`, policy-resolution...): test fail
   trước → code → green.
5. 4 gate (`/gate`: rubocop, rspec, eslint+vitest, playwright full suite) phải
   xanh trước khi coi feature Done / trước commit.

## 4. Invariant nghiệp vụ — không bao giờ được vi phạm dù đang làm feature nào

Đây là phần bị chấm nặng nhất (PRD §"Cách chấm"). Mọi agent phải tự kiểm tra lại
diff của mình với danh sách này trước khi báo Done:

- **Tách Organization tuyệt đối**: mọi controller action lấy resource qua
  `current_organization.devices/groups/policies/users`, không bao giờ
  `Device.find(params[:id])` trần (leak chéo org qua đoán ID). Viết test riêng
  cho từng resource: org A không đọc/sửa/xóa được resource của org B (kỳ vọng
  404, không phải 403 — không lộ sự tồn tại của resource).
- **Unique trong Organization, không unique toàn hệ thống**: `User.email` và
  `Device.identifier` unique theo `organization_id` (`add_index ..., unique:
  true` composite + validate ở model). Hai org khác nhau được trùng
  email/identifier.
- **User `active` mới login được** — check ở bước authenticate, thông báo lỗi
  không phân biệt "sai email" vs "user inactive" (tránh user-enumeration).
- **Device `retired` bất biến**: không sửa field, không đổi group/policy khi
  `status == "retired"`, trừ luồng un-retire tường minh (nếu team quyết định
  làm) — nếu làm, phải ghi rõ trong DESIGN.md ai gọi được, chuyển trạng thái gì.
  Mặc định (chưa quyết định khác): **không làm** un-retire, trả lỗi 422 rõ ràng
  khi cố sửa device retired.
- **Không gán Policy `inactive`**, không gán Policy khác Organization với
  Group/Device đích — validate ở service layer, không chỉ ở UI.
- **Xóa Group không để dữ liệu treo**: xóa join rows (`group_memberships`,
  `policy_assignments` liên quan tới group) trong cùng transaction, dùng
  `dependent: :destroy`/`delete_all` tường minh — không dựa vào FK cascade
  ngầm không khai báo.
- **Group lớn (10k devices) phải dùng được**: thao tác gán Policy cho Group
  không được xử lý đồng bộ trong request. Baseline: enqueue Solid Queue job,
  bulk-write bằng `upsert_all` trên unique index `(policy_id, group_id)` /
  `(policy_id, device_id)` (mỗi device một dòng `policy_assignments` với
  `source: group/direct` — xem thiết kế DB chi tiết ở F6/F8) để **idempotent**
  (chạy lại không nhân đôi). API trả job id ngay; FE poll trạng thái
  `pending/running/done/failed` — không im lặng, không treo UI.
- **Policy đang áp dụng trên Device** = hợp của (policy gán trực tiếp) ∪
  (policy của mọi Group đang thuộc), lọc theo `status: active` tại thời điểm
  tính. **Conflict** (cùng `type`, `configuration` khác nhau) — quyết định mặc
  định (giả định, có thể revisit khi `/brainstorm F9`, nhưng phải nhất quán và
  ghi rõ trong DESIGN.md nếu giữ):
  1. Gán trực tiếp trên Device thắng gán qua Group.
  2. Nếu vẫn conflict giữa nhiều Group (device thuộc ≥2 group có policy cùng
     `type` khác `configuration`) → policy có `updated_at` mới nhất thắng.
  3. Vẫn hòa (`updated_at` bằng nhau) → `id` nhỏ hơn thắng (tie-break xác định
     tuyệt đối, không phụ thuộc thứ tự query).
  Kết quả phải là hàm thuần của state hiện tại — gọi lại nhiều lần ra cùng một
  kết quả.

## 5. Nguồn PRD cho từng loại thiết kế (thay Notion — dự án này không dùng Notion)

Các agent (`analyst`, `db-designer`, `api-designer`, `frontend-designer`,
`Plan`, `acceptance-author`) đọc **`PRD.md`** trực tiếp làm nguồn nghiệp vụ gốc
+ `docs/backlog.md` cho mục feature + dependency, thay vì fetch Notion ticket.

**`UI_UX_design.md`** (root) là **design system nền cho toàn bộ FE** — IA/routes,
layout khung, đặc tả từng trang (Login/Devices/Groups/Policies), component
dùng chung, ma trận loading/empty/error, quy tắc validate. Đóng vai trò tương
đương `designs/*.html` (prototype đã approved) trong khung gốc, nhưng là văn
bản chứ không phải HTML. `frontend-designer` (bước Frontend trong `/design
F-id`) **bắt buộc tuân theo** route/component/pattern đã định nghĩa ở đây,
nhưng vẫn tự thiết kế chi tiết (Element/Trigger/Action/Notes, state management)
riêng cho từng feature slice ở `docs/design/<id>-frontend.md` — không chép
nguyên khối `UI_UX_design.md`, và không tự ý đổi route/component đã chốt ở đó
trừ khi có lý do kỹ thuật rõ ràng (ghi vào "Rủi ro/open question" của bản thiết
kế). Mâu thuẫn giữa SoT và `UI_UX_design.md` → dừng lại, báo cáo, không tự chọn.

## 6. Tài liệu bắt buộc nộp bài (đừng quên, viết dần theo tiến độ)

- `DESIGN.md`, `README.md` ở root (theo đúng mục lục PRD §"Tài liệu bắt buộc").
- Mục "3. AI" trong `DESIGN.md`: ghi lại tool/chỗ AI làm/chỗ tự thiết kế/chỗ AI
  sai đã sửa — cập nhật cuối mỗi feature, không dồn về cuối dự án rồi bịa lại.
