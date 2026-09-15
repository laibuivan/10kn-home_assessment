---
feature_id: F2
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

# Thiết kế API — F2

Nguồn: `docs/design/F2-db.md` (approved), `docs/sot/F2-device-list.md`
(approved), `PRD.md` §"Device" + bảng "Giao diện bắt buộc", pattern hiện có ở
`api/app/controllers/` (`ApplicationController`, `Authenticatable` concern,
`Api::V1::MeController`), quy ước lỗi đã chốt ở `docs/design/F0-api.md` §0.

## 0. Quy ước kế thừa từ F0 (không đổi)

- Namespace `api/v1`, `ActionController::API`, JSON thuần.
- 422 (validate lỗi field-level): `{ "errors": { "<field>": ["<message>"] } }`.
- Lỗi khác (401/404/500...): `{ "error": "<message>" }`.
- Auth: `Authenticatable` concern (`include Authenticatable` trong
  controller) — cung cấp sẵn `current_user`/`current_organization` qua
  `before_action`. F2 **tái sử dụng nguyên vẹn**, không sửa concern này.

## 1. Endpoint

| Method | Path | Input (params/body) | Output | Role được gọi | Ghi chú org-scope |
|---|---|---|---|---|---|
| `GET` | `/api/v1/devices` | Query: `platform` (optional string), `status` (optional string), `page` (optional, default `1`), `per_page` (optional, default `20`, max `100`) | 200: `{ devices: [ { id, identifier, name, platform, os_version, status, last_seen_at, created_at, updated_at } ], meta: { current_page, per_page, total_count, total_pages } }` | Bất kỳ user `active` thuộc org (không phân role — SoT §9) | `current_organization.devices` — không bao giờ `Device.find`/`Device.all` trần; không nhận `organization_id` từ client dưới bất kỳ hình thức nào (query/body) |

Route (mô tả, không code): `namespace :api do namespace :v1 do resources
:devices, only: [:index] end end` — chỉ thêm action `index`, chưa mở
`create`/`show`/`update`/`destroy` (thuộc F3/F4).

### Vì sao không cần route/controller `show` cho org-isolation ở F2

`CLAUDE.md` §4 yêu cầu 404 (không 403) khi cross-org truy cập resource qua
ID — điều này áp dụng cho action **show/update/destroy** (đoán ID của org
khác). F2 chỉ có `index`, không nhận ID resource nào từ client, nên không có
tình huống "404 vì thuộc org khác" ở đây. Org-isolation của F2 hoàn toàn nằm
ở **query scope không bao giờ include row của org khác** (đã cover ở A9 SoT,
xem §3 dưới) — không phải một nhánh lỗi riêng cần thiết kế. `slice-implementer`
không cần thêm rescue/404 case nào cho việc này ở F2; 404 case sẽ xuất hiện từ
F3/F4 trở đi khi có `show`/`update`.

## 2. Business logic — `GET /api/v1/devices`

Thứ tự thao tác trong action (đọc-only, không transaction cần thiết vì không
ghi dữ liệu):

1. `Authenticatable#authenticate_request!` (đã chạy qua `before_action`,
   không việc gì thêm ở action này) → có `current_organization`.
2. **Validate `page`/`per_page`** (OQ-6a, A7) — thực hiện **trước** khi chạm
   tới bất kỳ enum filter hay query nào:
   - Coerce mỗi param bằng `Integer(params[:page], exception: false)` (và
     tương tự cho `per_page`) — trả `nil` nếu không parse được thành số
     nguyên (bắt cả `"abc"`, chuỗi rỗng, `"1.5"`, giá trị thập phân dạng chuỗi
     không phải integer thuần).
     - Lý do dùng `Integer(str, exception: false)` thay vì `to_i`: `"abc".to_i`
       âm thầm trả `0` (sai — sẽ lọt qua thành lỗi "phải dương" thay vì lỗi
       "không phải số", nhưng quan trọng hơn là `"12abc".to_i` trả `12`, một
       giá trị sai được chấp nhận nhầm) — `Integer(...)` raise/`nil` đúng ngữ
       nghĩa "không phải số nguyên hợp lệ".
   - Nếu param có mặt (không nil/không blank) nhưng coerce ra `nil`, hoặc
     coerce ra số `<= 0` → thêm lỗi field-level tương ứng (`page` hoặc
     `per_page`) vào error hash, **không raise sớm** — gom hết lỗi của cả 2
     param rồi trả 1 lần (UX tốt hơn, đúng tinh thần "field-level errors" của
     `docs/design/F0-api.md` §0, xem thêm ví dụ ở §3).
   - Nếu param **không có mặt** (nil vì client không truyền) → dùng default
     (`page=1`, `per_page=20`), không phải lỗi.
   - Nếu có lỗi ở bước này → dừng lại, render 422 ngay, **không** chạy tiếp
     bước 3 (validate enum) hay query DB — tránh lãng phí, và vì pagination
     input sai kiểu là lỗi "hình dạng request" nghiêm trọng hơn enum filter.
3. **Clamp `per_page`** (OQ-1, A8) — sau khi đã biết `per_page` là số nguyên
   dương hợp lệ: `per_page = [per_page, 100].min`. Đây **không phải lỗi**,
   không thêm vào error hash, âm thầm điều chỉnh rồi tiếp tục — khớp SoT A8 +
   Scenario "per_page vượt ngưỡng tối đa" (§11: "không trả lỗi").
4. **Validate `platform`/`status` enum** (OQ-5, A4) — chỉ chạy nếu bước 2
   không có lỗi:
   - Nếu `params[:platform]` có mặt (không blank) và **không nằm trong**
     `Device.platforms.keys` (`%w[ios android macos]`) → thêm lỗi field-level
     `platform` vào error hash.
   - Tương tự cho `params[:status]` với `Device.statuses.keys`
     (`%w[active inactive retired]`).
   - **Không** gọi thẳng `current_organization.devices.where(platform:
     params[:platform])` trước khi validate — đây chính là bẫy `ArgumentError`
     đã cảnh báo ở `docs/design/F2-db.md` §1b: gán/where một string không có
     trong enum map khiến Rails raise `ArgumentError`, không tự thành 422. Vì
     vậy **bắt buộc** whitelist-check (`.in?`) bằng tay trước khi giá trị đó
     chạm tới bất kỳ scope enum nào của ActiveRecord.
   - Nếu param không có mặt (blank/nil) → nghĩa là "tất cả", không filter theo
     cột đó, không phải lỗi.
   - Nếu có lỗi ở bước này → render 422, không chạy query DB.
5. Nếu bước 2 và bước 4 đều sạch: build query — **cập nhật theo Quyết định
   Pundit ở §5 (OQ-API-1)**: dùng `policy_scope(Device)` (Pundit,
   `DevicePolicy::Scope#resolve` trả `current_organization.devices`) thay vì
   gọi thẳng `current_organization.devices` trong controller, giữ đúng 1
   đường org-scope duy nhất đi qua Pundit cho mọi resource controller từ F2
   trở đi:
   ```
   authorize Device  # DevicePolicy#index? — luôn true cho user active, không phân role
   scope = policy_scope(Device)
   scope = scope.where(platform: params[:platform]) if params[:platform].present?
   scope = scope.where(status: params[:status]) if params[:status].present?
   scope = scope.order(created_at: :desc, id: :desc)
   ```
   (2 điều kiện `where` liên tiếp = AND tự nhiên trong ActiveRecord — đúng A3,
   không cần logic gộp thủ công.)
6. Đếm tổng: `total_count = scope.count` (đếm **trên scope đã org-scope +
   filter**, trước khi áp `limit/offset` — đúng A9: count không bao giờ vượt
   phạm vi org hiện tại, và đúng A5/A6: count phản ánh đúng tập đã filter,
   không phải tổng toàn org).
7. Phân trang: `devices = scope.offset((page - 1) * per_page).limit(per_page)`.
   - `page` vượt quá `total_pages` thực tế (OQ-6b, A6) → `offset` lớn hơn số
     dòng thực → Postgres tự trả tập rỗng, **không cần** check `page >
     total_pages` thủ công để early-return — hành vi tự nhiên của
     `OFFSET/LIMIT` đã đúng theo yêu cầu (200 + rỗng, không lỗi). Không thêm
     nhánh code đặc biệt cho case này.
8. `total_pages = (total_count.to_f / per_page).ceil` (0 nếu `total_count ==
   0`, tránh chia cho 0 gây `NaN`/`Infinity` — dùng
   `total_count.zero? ? 0 : (total_count.to_f / per_page).ceil`).
9. Render 200 với shape ở §1 — mỗi device serialize tường minh (không
   `to_json` record trần) theo đúng cột SoT §7 cần cho bảng list + `id` (FE
   cần key để React/Vue `:key`, dù F2 chưa có click-through) +
   `created_at`/`updated_at` (thường có ích, rẻ để trả, không có lý do che
   giấu — không phải dữ liệu nhạy cảm như `password_digest`).

Không có transaction cần thiết (toàn bộ endpoint chỉ đọc — không ghi gì).

## 3. Lỗi / edge case

- **422 — pagination sai kiểu/âm/0** (OQ-6a, A7, scenario "Tham số phân trang
  không hợp lệ"):
  ```json
  { "errors": { "page": ["must be a positive integer"] } }
  ```
  (hoặc `per_page`, hoặc cả 2 cùng lúc nếu cả 2 đều sai — gom lỗi theo bước 2
  ở §2). Message cụ thể: `"must be a positive integer"`.
- **422 — enum filter không hợp lệ** (OQ-5, A4, scenario "Lọc bằng giá trị
  enum không hợp lệ"):
  ```json
  { "errors": { "platform": ["is not included in the list"] } }
  ```
  Message khớp đúng văn bản khuyến nghị ở SoT §12 OQ-5 (`"is not included in
  the list"` — trùng message chuẩn Rails `inclusion` validation, dù ở đây là
  check thủ công chứ không phải AR validation chạy qua model, để nhất quán
  văn phong lỗi cho FE/test).
  - Nếu cả `platform` và `status` cùng sai → cả 2 field xuất hiện trong cùng 1
    object `errors` (không chỉ báo field đầu tiên rồi dừng).
- **200 + rỗng — page vượt quá total_pages** (OQ-6b, A6): không phải lỗi, xử
  lý tự nhiên qua `OFFSET` (xem §2 bước 7) — `meta.total_count`/`total_pages`
  vẫn phản ánh đúng toàn bộ tập đã filter.
- **200 + clamp — per_page vượt ngưỡng** (OQ-1, A8): không lỗi, `meta.per_page`
  trong response phản ánh **giá trị đã clamp thực tế** (vd request
  `per_page=100000` → response `meta.per_page = 100`), không echo lại giá trị
  client gửi — tránh FE hiểu nhầm server đã dùng đúng giá trị yêu cầu.
- **Org-scope / không leak count org khác** (A9, CLAUDE.md §4): vì bước 6
  (`total_count`) luôn tính trên `scope` đã bắt đầu từ
  `current_organization.devices`, không có đường nào để `total_count` cộng
  dồn device của org khác — không cần thêm rescue/check riêng, đây là hệ quả
  tự động của việc không bao giờ dùng `Device.all`/`Device.where` trần ở bất
  kỳ bước nào.
- **Trùng dữ liệu**: không áp dụng — endpoint chỉ đọc.
- **Vi phạm business rule retired/policy**: không áp dụng — F2 không sửa
  device, không đụng tới policy.
- **401**: không xử lý gì thêm ở controller F2 — hoàn toàn do
  `Authenticatable` concern xử lý trước khi action `index` chạy (A10, scenario
  "không có token"/"token hết hạn").
- **500/hạ tầng (A11)**: không thiết kế riêng ở tầng API — đây là lỗi hạ tầng
  chung (DB down, v.v.), không phải business logic của F2; FE tự xử lý qua
  `UI_UX_design.md` §9 (ErrorState + Thử lại) dựa trên status code 500 chung
  của Rails/`ApplicationController`.

## 4. Xử lý bất đồng bộ

Không áp dụng — F2 là read-only list trên 1 bảng, không có thao tác ghi hàng
loạt (khác F6/F8 — Group 10k device, Policy assignment).

## 5. Rủi ro / open question

- **OQ-API-1 (cần người quyết định): Pundit chưa được wire up trong repo.**
  `CLAUDE.md` §"Authorization" ghi rõ dự án dùng Pundit, nhưng kiểm tra thực
  tế repo hiện tại (`api/Gemfile`, `api/app/`) cho thấy **chưa có gem
  `pundit`, chưa có `app/policies/`, chưa có `ApplicationPolicy`** — F0 chỉ
  làm authentication (JWT), chưa chạm tới authorization framework. F2 là
  feature **đầu tiên** có resource controller thật ngoài `sessions`/`me`, nên
  đây là điểm quyết định tự nhiên: có nên bắt đầu wire Pundit từ F2, hay để
  org-scope query (`current_organization.devices`) tự nó là đủ vì SoT §9 xác
  nhận **chưa có role nội bộ org** (mọi user active của 1 org có quyền y hệt
  nhau, không có "viewer"/"admin" phân biệt quyền đọc).
  - **Đề xuất (không tự quyết định thay người duyệt, chỉ nêu khuyến nghị)**:
    với F2 cụ thể — 1 action `index`, không role, không phân quyền theo field
    — thêm Pundit vào chỉ để bọc quanh `current_organization.devices` là một
    lớp trừu tượng chưa tạo giá trị thật (Pundit tỏa sáng khi có ≥2 role hoặc
    field-level authorization, cả 2 đều chưa xuất hiện tới F2). Khuyến nghị
    **hoãn** việc wire Pundit tới khi nghiệp vụ thật sự cần rẽ nhánh theo role
    (nếu PRD/backlog có feature nào giới thiệu role sau F9, hiện `docs/backlog.md`
    không thấy) — org-scope qua `current_organization.<assoc>` (đã có sẵn từ
    F0, không cần code mới) là đủ để thỏa `CLAUDE.md` §4 cho F2.
  - Nếu người duyệt muốn tuân thủ `CLAUDE.md` đúng nghĩa đen ("Authorization
    dùng Pundit" áp dụng ngay từ endpoint có resource đầu tiên) bất kể có role
    hay chưa, cần nêu rõ ở đây trước khi implement — ảnh hưởng
    `docs/plan/F2-*.md` (thêm task cài gem + `ApplicationPolicy` +
    `DevicePolicy#index?` luôn trả `true` cho mọi user active) và
    `Gemfile`/`bundle install`.

  **Quyết định (approve):** wire Pundit **từ F2** — đây là feature đầu tiên có
  resource controller thật, đúng thời điểm tự nhiên để thiết lập pattern thay
  vì nợ kỹ thuật phải quay lại sau. `CLAUDE.md` §1 chốt Pundit ở tầng stack cho
  toàn dự án, không điều kiện theo "khi nào có ≥2 role" — F3 (retired
  immutability check khi update), F8 (chặn Policy khác org/inactive) sẽ cần
  policy thật, nên có `ApplicationPolicy` + convention từ F2 giúp các feature
  sau chỉ kế thừa, không phải bootstrap giữa chừng. Cụ thể: thêm gem `pundit`,
  `ApplicationPolicy` (base, `scope` mặc định raise `NotImplementedError` theo
  Pundit convention), `DevicePolicy` với `index?` luôn `true` cho user `active`
  (không phân role) và `Scope#resolve` trả `current_organization.devices`
  (controller gọi `policy_scope(Device)` thay vì gọi thẳng
  `current_organization.devices` — giữ đúng 1 nguồn org-scope duy nhất đi qua
  Pundit). Ghi task này vào `docs/plan/F2-*.md`.
- **Message text cho lỗi pagination** (`"must be a positive integer"`) là đề
  xuất của bước API design này, chưa xuất hiện nguyên văn ở SoT (SoT §12 OQ-6
  chỉ chốt "422 rõ ràng", không chốt câu chữ) — nếu người duyệt muốn message
  khác (vd tách 2 message riêng cho "not a number" vs "must be positive"),
  cần chốt ở đây trước khi implement, vì test acceptance (Gherkin) và RSpec
  request spec sẽ assert theo đúng câu chữ này.
  **Quyết định (approve):** giữ nguyên đề xuất — 1 message chung
  `"must be a positive integer"` cho cả `page`/`per_page`, không tách 2 message
  riêng (đơn giản, đủ rõ cho field-level error).
- **Không thiết kế lại `Authenticatable`/error rendering chung**: F2 tái sử
  dụng nguyên vẹn `rescue_from` đã có ở `ApplicationController` (F0) — không
  thêm `rescue_from` mới, mọi lỗi 422 của F2 được render tường minh trong
  action (không dựa vào exception raise + rescue global), theo đúng phong
  cách validate-trước-khi-query đã mô tả ở §2.
- **`meta` key naming**: chọn `current_page`, `per_page`, `total_count`,
  `total_pages` (quy ước phổ biến của `kaminari`/`pagy` trong hệ Rails API,
  dễ đoán cho FE dù không dùng gem phân trang cụ thể nào — quyết định
  implement-time có dùng gem hay tự viết Ruby thuần, không ảnh hưởng tới
  shape JSON đã chốt ở đây). Nếu người duyệt muốn khớp tên khác (vd
  `page`/`page_size` thay vì `current_page`/`per_page`), nêu ở đây trước khi
  `frontend-designer` dựa vào shape này thiết kế FE.
  **Quyết định (approve):** giữ nguyên đề xuất — `current_page`/`per_page`/
  `total_count`/`total_pages`. `frontend-designer` dùng shape này làm nguồn
  chốt cho F2.
</content>
