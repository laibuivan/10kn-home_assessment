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
