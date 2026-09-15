---
feature_id: F0
status: draft   # draft | approved
approver:
date:
---

# Thiết kế API — F0

Nguồn: `docs/design/F0-db.md` (approved), `docs/sot/F0-foundation.md`,
`PRD.md`, `api/app/controllers/` hiện có (chỉ có `ApplicationController` rỗng,
chưa có route/controller nào ngoài `/up`).

## 0. Quy ước chung (áp dụng cho mọi endpoint từ F0 trở đi — chốt precedent ở đây)

- Namespace `api/v1` (khớp `docs/sot/F0-foundation.md` §8: `POST
  /api/v1/sessions`). Route: `namespace :api do namespace :v1 do ... end end`.
- JSON request/response duy nhất (`ActionController::API`, không cần
  `respond_to`).
- Lỗi validate (422): `{ "errors": { "<field>": ["<message>"] } }` — khớp FE
  đã thiết kế sẵn ở `UI_UX_design.md` §1 (axios interceptor "bắt lỗi 422/400 →
  trả object lỗi field-level lên form").
- Lỗi không phải validate field cụ thể (401 auth, 404 not-found, 500...):
  `{ "error": "<message>" }` (số ít, không phải map theo field).
- Auth: `Authorization: Bearer <jwt>` header. Middleware dùng chung
  (`Authenticatable` concern, include vào `ApplicationController`) —
  **không phải REST endpoint riêng nhưng là phần API contract quan trọng nhất
  của F0**, mọi controller F2+ sẽ dựa vào `current_user`/`current_organization`
  do concern này set.

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `POST` | `/api/v1/sessions` | `{ email, password }` | 201: `{ token, user: { id, email }, organization: { id, name } }` | Public (không cần token) | Tự suy ra org từ `User` tìm được theo email (SoT OQ-2) — không nhận `organization_id` từ client |
| `GET` | `/api/v1/me` | — (auth qua header) | 200: `{ user: { id, email }, organization: { id, name } }` | Bất kỳ user `active` đã login | Luôn qua `current_user`/`current_organization`, không nhận param nào chọn org/user khác |

**Vì sao có `GET /api/v1/me`** dù SoT §8 không liệt kê tường minh: (1) là
endpoint tối thiểu để acceptance test của SoT §11 ("Gọi API cần xác thực mà
không kèm token", "Token hết hạn bị từ chối", "User bị vô hiệu hoá giữa phiên")
có cái để gọi — F0 chưa có Device/Group/Policy endpoint nào khác để test auth
middleware; (2) phục vụ đúng yêu cầu FE đã có sẵn ở `UI_UX_design.md` §2:
"Topbar hiện tên Organization của user đang đăng nhập" — FE cần nguồn để lấy
lại thông tin này khi F5 reload trang (không lưu org name vào JWT payload,
tránh JWT phình to và **stale** nếu tên org đổi — luôn gọi API lấy tươi).

## 2. Business logic từng endpoint

### `POST /api/v1/sessions`
1. Validate `email`, `password` đều có mặt (không rỗng) → thiếu → 422
   `{"errors": {"email": ["can't be blank"]}}` (và/hoặc `password`, theo field
   nào rỗng — SoT A8).
2. Normalize `email` (downcase, strip) — khớp thiết kế DB (§1a of F0-db.md).
3. `User.find_by(email: normalized_email)` — tìm theo email **không giới hạn
   org** (đúng OQ-2: chưa biết org tại thời điểm login).
   - Không tìm thấy → 401 generic (§6 dưới).
   - Tìm thấy nhiều hơn 1 (2 org trùng email — cạnh hiếm, OQ-2) → thử
     `authenticate(password)` lần lượt trên từng candidate theo thứ tự
     `id ASC` (xác định, không phụ thuộc thứ tự DB trả về ngẫu nhiên), dùng
     candidate đầu tiên khớp.
4. `user.authenticate(password)` (bcrypt qua `has_secure_password`) sai → 401
   generic.
5. `user.status != "active"` → 401 generic **y hệt bước 3/4** (SoT OQ-1 —
   không phân biệt).
6. Hợp lệ: phát JWT — payload `{ user_id: user.id, organization_id:
   user.organization_id, exp: 24.hours.from_now.to_i }`, ký HS256 bằng secret
   riêng (`Rails.application.credentials.dig(:jwt_secret)` — implement-time
   note: cần set credential này, KHÔNG hard-code secret trong code).
7. Trả 201 kèm token + user/org info (không trả `password_digest`, dùng
   serializer/`as_json(only: ...)` tường minh — không bao giờ `to_json` cả
   record User trần).

### `GET /api/v1/me`
Không có business logic ngoài đọc `current_user`/`current_organization` đã
được middleware set sẵn (xem §0, §3).

## 3. `Authenticatable` — middleware xác thực dùng chung

Không phải 1 endpoint, nhưng là phần thiết kế quan trọng nhất của F0 vì mọi
API sau này (F2+: Device/Group/Policy) đều `before_action :authenticate_request!`
qua concern này:

1. Đọc header `Authorization: Bearer <token>`. Thiếu/không đúng format → 401.
2. Decode JWT (thư viện `jwt` gem — implement-time note: chưa có trong
   `Gemfile`, thêm ở bước implement). Chữ ký sai/hết hạn/malformed → rescue
   `JWT::DecodeError` (base class cho mọi lỗi decode kể cả
   `JWT::ExpiredSignature`) → 401.
3. **Load `User` tươi từ DB** theo `payload["user_id"]` — **không tin thẳng
   claim trong token** (đúng SoT §6, kịch bản A6: user bị deactivate giữa
   phiên phải bị chặn ngay dù token còn hạn).
   - Không tìm thấy User (bị xoá — A7) → 401.
   - `status != "active"` → 401 (dù token vẫn còn hạn — đây là bài test bắt
     buộc ở SoT §11).
4. Set `@current_user = user`, `@current_organization = user.organization`
   (không đọc `organization_id` lại từ claim cho bước set này — dùng quan hệ
   thật từ DB, claim chỉ dùng để tìm `user_id` ở bước 3).
5. Mọi 401 ở middleware này trả cùng shape `{ "error": "Unauthorized" }` (FE
   không cần phân biệt lý do — `UI_UX_design.md` §1 chỉ xử lý theo status code
   401 chung, redirect `/login`).

## 4. Lỗi / edge case

- Không tìm thấy resource thuộc org khác (chưa áp dụng ở F0 — chưa có
  Device/Group/Policy; nguyên tắc org-scope qua `current_organization.<assoc>`
  được thiết lập từ đây để F2+ tuân theo, không tự `Model.find` trần).
- Trùng dữ liệu: không áp dụng ở F0 (không có endpoint tạo User qua API — chỉ
  qua `db/seeds.rb`, validate uniqueness vẫn chạy ở tầng model nếu seed có bug).
- Vi phạm business rule: đã cover ở §2/§3 (inactive, token hết hạn/sai).
- Validate input: `POST /api/v1/sessions` — chỉ 2 field, dùng
  `params.require(:email)`/`params.require(:password)` (rescue
  `ActionController::ParameterMissing` → 422, không để nó thành 400 generic
  hoặc 500) hoặc validate thủ công rõ ràng hơn (quyết định cụ thể ở
  implement-time, cả 2 đều chấp nhận được, ghi note vào DESIGN.md khi code).

## 5. Xử lý bất đồng bộ

Không áp dụng ở F0 (không có thao tác trên tập dữ liệu lớn — đó là F6/F8, sẽ
thiết kế job/poll riêng ở bước `/design F6`, `/design F8`).

## 6. Rủi ro / open question

- Secret ký JWT: dùng Rails credentials (`config/credentials.yml.enc` +
  `config/master.key`, đã có sẵn từ `rails new`) — không tạo file secret mới,
  không hard-code, không commit secret dạng plaintext (`master.key` đã
  `.gitignore`).
- OQ-2 (đa candidate cùng email): logic "thử từng candidate theo `id ASC`" ở
  §2 bước 3 là **quyết định implement-time cụ thể hoá** cho phương án đã chốt
  ở SoT §12 OQ-2 — không phải open question mới, nêu lại ở đây để
  `slice-implementer` không phải tự đoán thứ tự.
