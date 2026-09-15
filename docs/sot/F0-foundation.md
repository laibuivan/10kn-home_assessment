---
feature_id: F0
title: Foundation — Organization/User model, JWT auth, seed 2 org
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

## §1. Meta
- Feature: `F0` — Foundation (Organization/User model, JWT login, seed 2 org)
- Dependency: — (nền tảng)
- Nguồn: `PRD.md` §"Organization & User", bảng "Giao diện bắt buộc" (dòng Login),
  `docs/backlog.md` mục F0

**Scope note:** `docs/backlog.md` mô tả F0 gồm cả "Rails API + Vue skeleton +
Postgres" — phần đó **đã xong** (PR #1, #2: `docker-compose.yml`, bare `rails
new`/`vite create` scaffold, chưa có model/route nào ngoài default). SoT này
chỉ cover phần nghiệp vụ còn lại: Organization/User model, JWT auth, seed.

## §2. Summary / User story
Là một user thuộc một Organization, tôi muốn đăng nhập bằng email + password
để vào Device Management Console **của đúng Organization mình** — không bao
giờ thấy được, hay vô tình đăng nhập vào, dữ liệu của Organization khác.

## §3. Scope
**Trong phạm vi:**
- Model `Organization` (name) và `User` (thuộc 1 Organization, email, password
  digest, status `active`/`inactive`).
- Endpoint login (email+password) → JWT; middleware xác thực JWT cho mọi
  endpoint cần auth sau này; endpoint "whoami"/logout phía FE (xoá token, JWT
  là stateless nên không cần endpoint logout ở BE — xem §12 OQ-3).
- Trang Login (FE) theo `UI_UX_design.md` §3.
- `db/seeds.rb`: 2 Organization, mỗi bên ≥1 User, idempotent (chạy lại không
  tạo trùng).

**Ngoài phạm vi** (khớp `docs/backlog.md` §"Ngoài phạm vi"):
- Màn hình quản lý Organization/User (PRD không yêu cầu — bảng "Giao diện bắt
  buộc" không có dòng Users; User chỉ tồn tại qua seed).
- Đăng ký tài khoản, quên mật khẩu, đổi mật khẩu.
- Refresh token / "remember me" / revocation list.
- Role/permission trong nội bộ 1 Organization — PRD không mô tả cấp bậc user
  nào trong Organization; mọi `active` user của 1 org có quyền như nhau trên
  dữ liệu org đó (chỉ phân biệt theo Organization, không theo role).

## §4. Main flow
1. User mở SPA, chưa có token hợp lệ → route guard chuyển về `/login`.
2. User nhập email + password, bấm "Đăng nhập".
3. FE gọi `POST /api/v1/sessions`.
4. BE tìm `User` theo email, kiểm tra password (bcrypt) và `status: active`.
5. Hợp lệ → BE trả JWT (claim: `user_id`, `organization_id`, `exp`).
6. FE lưu token, mọi request sau kèm `Authorization: Bearer <token>`, redirect
   `/devices`.
7. Mỗi request authenticated: BE decode JWT, load `User` theo `user_id` (query
   DB thật, không chỉ tin claim), kiểm tra còn tồn tại + vẫn `active` +
   `organization_id` khớp claim → set `current_user`/`current_organization`.

## §5. Edge & alternate flow

### 5.1 Biến thể chính
- Logout: FE xoá token khỏi storage, redirect `/login`. Không cần gọi BE (JWT
  stateless — xem §12 OQ-3).
- Reload trang với token còn hạn: FE giữ nguyên phiên, không bắt login lại.
- Token hết hạn khi đang dùng: request tiếp theo trả 401 → FE tự redirect
  `/login` + toast "Phiên đăng nhập hết hạn" (đã mô tả ở `UI_UX_design.md` §1).

### 5.2 Edge case
- A1. Sai email (không tồn tại ở **bất kỳ** Organization nào) → 401, message
  chung "Email hoặc mật khẩu không đúng."
- A2. Email đúng (tồn tại), sai password → **cùng message y hệt A1**, cùng mã
  401 — không được để kẻ tấn công phân biệt được "email có tồn tại hay không"
  qua response (user enumeration — `CLAUDE.md` §4).
- A3. Email/password đúng nhưng `User.status == "inactive"` → **cùng message y
  hệt A1/A2**, cùng mã 401 (OQ-1: ưu tiên bảo mật, không lộ trạng thái tài
  khoản qua response — xem Quyết định ở §12).
- A4. Email trùng giữa 2 Organization khác nhau (PRD cho phép: unique chỉ
  trong-org, không unique toàn hệ thống) — xử lý theo Quyết định OQ-2 ở §12.
- A5. Request tới endpoint cần auth mà không có header `Authorization` → 401.
- A6. Request với JWT hợp lệ (chưa hết hạn, chữ ký đúng) nhưng `User` đã bị
  admin set `inactive` **sau khi** token được phát hành (token vẫn còn hạn) →
  phải bị chặn ngay ở request tiếp theo (chứng minh BE luôn load `User` tươi
  từ DB, không chỉ tin claim trong token) → 401.
- A7. Request với JWT hợp lệ nhưng `User` đã bị xoá (không nên xảy ra ở MVP vì
  không có UI xoá User, nhưng vẫn phải xử lý — 401, không 500).
- A8. Submit form login với email/password rỗng → chặn ở FE (validate trước
  khi gọi API) **và** BE vẫn phải tự validate độc lập (không tin FE) → 422 rõ
  ràng nếu lỡ gọi thẳng API với body rỗng.
- A9. Chạy `rails db:seed` nhiều lần → không tạo trùng Organization/User (dùng
  `find_or_create_by!`).

## §6. Business rule & validation
- `Organization#name`: bắt buộc.
- `User#email`: bắt buộc, format email hợp lệ, **unique theo `organization_id`**
  (composite), không unique toàn hệ thống (PRD).
- `User#password`: bắt buộc khi tạo, lưu dạng `password_digest` (bcrypt, qua
  `has_secure_password`), độ dài tối thiểu hợp lý (đề xuất ≥8 ký tự — không có
  yêu cầu cụ thể trong PRD, đây là giả định, ghi vào DESIGN.md).
- `User#status`: enum `active`/`inactive`, mặc định `active`.
- **Chỉ `active` user login được** (PRD, `CLAUDE.md` §4) — message lỗi không
  phân biệt lý do (xem A1–A3, OQ-1).
- **Mọi request authenticated phải re-check `active` từ DB**, không chỉ tin
  JWT đã ký hợp lệ (A6) — vì JWT không có cơ chế revoke, đây là cách duy nhất
  để việc deactivate 1 user có hiệu lực ngay mà không cần blacklist token.
- JWT: ký bằng secret riêng (Rails `credentials`/ENV, không hard-code), thuật
  toán HS256, thời hạn đề xuất **24h** (không có yêu cầu cụ thể trong PRD —
  giả định, ghi vào DESIGN.md), claim tối thiểu `user_id`, `organization_id`,
  `exp`.

## §7. UI state
Theo `UI_UX_design.md` §3 (Trang Login) — không lặp lại chi tiết ở đây, chỉ
liệt kê điểm phải khớp với business rule ở §6:
- Idle / Submitting / Error (401 sai thông tin — dùng chung cho mọi lý do sai
  bao gồm cả user inactive, 422 validate rỗng, network/500) / Success — như
  `UI_UX_design.md` §3 đã đặc tả sau khi cập nhật theo OQ-1 (đã bỏ nhánh 403
  riêng cho inactive).

## §8. Data & API touchpoint
- Model: `Organization`, `User belongs_to :organization`.
- Endpoint: `POST /api/v1/sessions` (login) → `{ token, user: { id, email,
  organization: { id, name } } }`. Không cần `DELETE /api/v1/sessions`
  (logout) ở BE nếu JWT thuần stateless (xem OQ-3).
- Middleware/concern dùng lại cho mọi controller sau này:
  `Authenticatable#current_user`, `#current_organization` (từ JWT, load lại từ
  DB mỗi request).

## §9. RBAC / Authorization
- Không có role trong 1 Organization (xem §3 — ngoài phạm vi). Mọi `active`
  user của 1 org có quyền như nhau trên dữ liệu org đó.
- Toàn bộ authorization thực chất là **org-scoping**: mọi query sau này
  (Device/Group/Policy ở F2+) phải đi qua `current_organization.<assoc>` —
  đây là điều kiện tiên quyết F0 phải cung cấp đúng (`current_organization`
  không bao giờ `nil`/sai khi request đã qua middleware).

## §10. Non-functional (performance/scale)
Không liên quan tới list/group lớn (đó là F2+). Riêng lưu ý: verify JWT +
load `User` từ DB (A6) chạy trên **mọi** request — phải có index sẵn trên
`users.id` (mặc định PK) nên chi phí không đáng kể; không cần cache thêm ở MVP.

## §11. Acceptance criteria (canonical)

```gherkin
Scenario: Login thành công với tài khoản seed hợp lệ
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi đăng nhập với đúng email và password
  Then tôi được chuyển tới trang Devices
  And các request tiếp theo được xác thực bằng token vừa nhận

Scenario: Login sai password
  Given tôi là user active thuộc Organization "Acme Inc."
  When tôi đăng nhập với đúng email nhưng sai password
  Then tôi thấy lỗi "Email hoặc mật khẩu không đúng"
  And tôi không được cấp token

Scenario: Login với email không tồn tại ở bất kỳ Organization nào
  When tôi đăng nhập với một email không tồn tại trong hệ thống
  Then tôi thấy lỗi giống hệt lỗi sai password (không phân biệt được)

Scenario: Login khi user inactive nhận lỗi giống hệt lỗi sai thông tin
  Given tôi là user thuộc Organization "Acme Inc." với status "inactive"
  When tôi đăng nhập với đúng email và password
  Then tôi thấy lỗi "Email hoặc mật khẩu không đúng" giống hệt A1/A2
  And tôi không được cấp token

Scenario: Gọi API cần xác thực mà không kèm token
  When tôi gọi một endpoint yêu cầu đăng nhập mà không có Authorization header
  Then tôi nhận về lỗi 401

Scenario: Token hết hạn bị từ chối
  Given tôi có một token đã hết hạn
  When tôi gọi một endpoint yêu cầu đăng nhập bằng token đó
  Then tôi nhận về lỗi 401

Scenario: User bị vô hiệu hoá giữa phiên vẫn bị chặn ngay dù token còn hạn
  Given tôi đã đăng nhập thành công và đang giữ một token còn hạn
  When quản trị viên chuyển user của tôi sang status "inactive"
  And tôi gọi lại một endpoint yêu cầu đăng nhập bằng token cũ đó
  Then tôi nhận về lỗi 401

Scenario: Email trùng giữa 2 Organization khác nhau đăng nhập đúng org của mình
  Given Organization "Acme Inc." và Organization "Globex Corp." đều có user với email "admin@shared.example"
  When user của "Acme Inc." đăng nhập bằng email và password của mình
  Then tôi được xác thực vào đúng Organization "Acme Inc.", không phải "Globex Corp."

Scenario: Submit form login với email/password rỗng
  When tôi gọi endpoint login với email và password đều rỗng
  Then tôi nhận về lỗi validate 422, không phải 401 hay 500

Scenario: Chạy seed nhiều lần không tạo trùng dữ liệu
  Given `rails db:seed` đã chạy một lần
  When tôi chạy `rails db:seed` lại lần nữa
  Then số lượng Organization và User không tăng thêm
```

## §12. Decisions & Open questions

| # | Open question | Phương án khuyến nghị | Quyết định |
|---|---|---|---|
| OQ-1 | **Mâu thuẫn 2 tài liệu nguồn**: `CLAUDE.md` §4 nói lỗi login "không phân biệt sai email vs user inactive" (tránh user-enumeration); nhưng `UI_UX_design.md` §3 đã thiết kế sẵn banner **403 riêng** "Tài khoản đã bị vô hiệu hóa, liên hệ quản trị viên." cho trường hợp inactive. Hai cái này không thể cùng đúng — nếu có message/mã lỗi riêng cho inactive thì đã lộ "email này tồn tại và có mật khẩu đúng nhưng bị khoá", đúng là user-enumeration. | Giữ theo `CLAUDE.md` (ưu tiên bảo mật): **luôn trả 401 + message chung** kể cả khi user tồn tại nhưng inactive. Bỏ nhánh UI 403 riêng ở `UI_UX_design.md` §3. | **Theo khuyến nghị.** Luôn 401 + message chung, kể cả inactive. `UI_UX_design.md` §3 đã cập nhật để bỏ nhánh 403 riêng (xem commit cùng đợt approve SoT này). |
| OQ-2 | Login chỉ nhận email+password, không có ô chọn Organization (theo `UI_UX_design.md` §3: "không có chỗ nào để chọn org, org được suy ra từ email"). Nhưng PRD chỉ đảm bảo email unique **trong** 1 Organization, không đảm bảo unique toàn hệ thống — nếu 2 Organization seed cùng email thì suy luận "1 email → 1 org" bị vỡ. | MVP: **đảm bảo bằng seed data** rằng email không trùng giữa 2 Organization (đây là giả định vận hành, không phải ràng buộc DB). Nếu về sau có ≥2 user cùng email ở ≥2 org khác nhau, BE thử xác thực password lần lượt trên từng candidate theo email đó — user đầu tiên khớp password sẽ đăng nhập được (không xác định thứ tự nếu nhiều hơn 1 khớp — rủi ro production, ghi vào DESIGN.md). Không làm UI chọn Organization ở MVP. | **Theo khuyến nghị.** Seed đảm bảo không trùng email giữa 2 org; fallback thử-từng-candidate ghi vào rủi ro production của `DESIGN.md` khi viết tài liệu đó. |
| OQ-3 | Có cần endpoint `DELETE /api/v1/sessions` (logout phía BE) không, hay JWT thuần stateless (FE tự xoá token là đủ)? | Không cần — JWT không thể "thu hồi" ở giữa vòng đời trừ khi có blacklist (thêm phức tạp không cần thiết cho MVP nội bộ này). Logout = FE xoá token. | **Theo khuyến nghị.** Không có endpoint logout ở BE. |
| OQ-4 | Thời hạn JWT bao lâu? PRD không quy định. | 24h, không có refresh token — hết hạn thì đăng nhập lại. | **Theo khuyến nghị.** 24h, không refresh token. |
| OQ-5 | Độ dài tối thiểu password khi seed/tạo user? PRD không quy định (không có UI tạo User). | ≥8 ký tự ở tầng validation (chủ yếu để tránh lỗi thao tác khi viết seed/factory, không phải yêu cầu bảo mật production thực thụ vì không có UI đăng ký). | **Theo khuyến nghị.** ≥8 ký tự. |

Tất cả quyết định theo phương án khuyến nghị (user chốt ngày 2026-09-15,
"theo khuyến nghị hết").
