---
feature_id: F0
status: draft   # draft | approved
approver:
date:
---

# Thiết kế Frontend — F0

Nguồn: `docs/design/F0-api.md` (approved), `docs/sot/F0-foundation.md`,
`UI_UX_design.md` (design system nền — §0 nguyên tắc, §1 stack, §2 IA/layout,
§3 Login), `web/src/` hiện có (bare Vite scaffold — `App.vue`/`HelloWorld.vue`
mặc định, chưa có route/store/component nghiệp vụ nào).

**Quyết định phạm vi quan trọng:** `UI_UX_design.md` §2 không định nghĩa route
`/` hay trang "home" — landing route sau login là `/devices` (SoT §4 bước 6).
Nhưng Devices thật (list/filter/phân trang) là việc của **F2/F3**, chưa làm ở
F0. F0 build `/devices` như **shell rỗng** (AppShell + placeholder) — chỉ đủ
để chứng minh login/org hoạt động đúng (PRD cần "dùng được bằng seed data ngay
sau setup" + walkthrough 5 phút xem đăng nhập đúng org); F2/F3 sẽ **thay nội
dung bên trong** view này bằng bảng thật, không đổi route/AppShell đã có.

## 1. Route / screen breakdown

| Route | Component chính | Ghi chú |
|---|---|---|
| `/login` | `views/LoginView.vue` | Không bọc `AppShell` — full-page, không cần auth |
| `/devices` | `views/devices/DeviceListView.vue` | Bọc `AppShell`; F0 chỉ render placeholder ("Devices — hoàn thiện ở F2/F3") bên trong; **route/guard/AppShell là phần F0 chốt, không đổi lại ở F2** |

`/devices/:id`, `/groups`, `/groups/:id`, `/policies`, `/policies/:id` (theo
`UI_UX_design.md` §2) — **chưa khai báo ở F0**, để dependency đúng chỗ (F3/F5/F7
tự thêm route của mình, không đụng router config F0 đã viết ngoài việc thêm).

## 2. Element / Trigger / Action / Notes

### `LoginView.vue` (theo đúng `UI_UX_design.md` §3, cụ thể hoá theo API đã approved)

| Element | Trigger | Action | Notes |
|---|---|---|---|
| Input `email` | blur/submit | validate format email cơ bản (client) | Lỗi format → text đỏ dưới field, KHÔNG gọi API |
| Input `password` | — | toggle show/hide (icon) | |
| Nút "Đăng nhập" | click / submit form | disable + spinner trong nút → `authStore.login(email, password)` → `POST /api/v1/sessions` | Enable lại nút khi request xong (thành công hoặc lỗi) |
| Banner lỗi (trên form) | response 401 **hoặc** 422 (thiếu field) | hiện `error.value` từ response — **một message chung duy nhất** cho mọi lý do 401 (sai email, sai password, hoặc inactive — SoT §12 OQ-1, không có nhánh 403 riêng) | Response shape: `{"error": "..."}` (401) hoặc `{"errors": {...}}` (422) — 2 shape khác nhau theo `F0-api.md` §0, FE phải xử lý cả 2 |
| — | response network/500 | banner "Không thể kết nối máy chủ, thử lại sau." | |
| — | thành công (201) | `authStore` lưu `token`/`user`/`organization`, router push `/devices` | |

### `AppShell.vue` (khung dùng lại cho mọi trang trừ `/login` — theo `UI_UX_design.md` §2)

| Element | Trigger | Action | Notes |
|---|---|---|---|
| Topbar — tên Organization | mount | đọc `authStore.organization.name` | Đây là điểm reviewer xác nhận không lẫn org khi đổi tài khoản seed (PRD) |
| Topbar — User menu ▾ | click "Logout" | `authStore.logout()` → router push `/login` | Confirm không cần (logout không phải hành động phá huỷ dữ liệu) |
| Sidebar — Devices / Groups / Policies | click | `router-link` tới route tương ứng | Ở F0 chỉ `/devices` tồn tại thật; 2 mục còn lại **ẩn** cho tới khi F5/F7 thêm route (không link tới route 404) |
| `<router-view>` | — | render view con | |

### `DeviceListView.vue` (F0 — placeholder, F2/F3 thay nội dung)

| Element | Trigger | Action | Notes |
|---|---|---|---|
| Text "Devices — sẽ hoàn thiện ở F2/F3" | mount | — | Không gọi API nào ở F0 (chưa có `GET /api/v1/devices`) |

## 3. State management

- **`stores/auth.ts`** (Pinia):
  - State: `token: string | null`, `user: { id, email } | null`,
    `organization: { id, name } | null`.
  - Persist: `token` lưu `localStorage` (chấp nhận được cho bài test — ghi rõ
    trong `DESIGN.md` khi viết tài liệu đó, đã note trong `UI_UX_design.md` §3).
  - Action `login(email, password)`: gọi `POST /api/v1/sessions`, set state +
    `localStorage` khi thành công; throw lỗi (đã parse theo §0 shape của
    `F0-api.md`) để `LoginView` hiện banner — **không tự redirect trong
    store**, để component quyết định (dễ test hơn).
  - Action `logout()`: clear state + `localStorage`, không gọi API (`F0-api.md`
    §6 OQ-3: không có endpoint logout ở BE).
  - Action `hydrate()`: nếu có `token` trong `localStorage` lúc app khởi động
    mà state đang rỗng (reload trang) → gọi `GET /api/v1/me` để nạp lại
    `user`/`organization`; 401 (token hết hạn/user bị deactivate — SoT A6) →
    `logout()` + để router guard tự đẩy về `/login`.
  - Getter `isAuthenticated`: `!!token && !!user`.
- **`router/index.ts`**: `beforeEach` guard —
  - Route khác `/login` mà chưa `isAuthenticated` (sau khi đã `hydrate()` xong
    — xem §4 Loading) → redirect `/login`.
  - Route `/login` mà đã `isAuthenticated` → redirect `/devices`.
- **`api/client.ts`** (axios instance, theo `UI_UX_design.md` §1):
  - `baseURL` từ `import.meta.env.VITE_API_URL` (đã set sẵn trong
    `docker-compose.yml`).
  - Request interceptor: đính `Authorization: Bearer <token>` từ
    `authStore.token` nếu có.
  - Response interceptor: 401 → `authStore.logout()` + toast "Phiên đăng nhập
    hết hạn" + redirect `/login` (trừ khi đang **ở** `/login` — tránh loop khi
    chính request login trả 401 vì sai mật khẩu).

## 4. Empty / loading / error / success

- **Loading khi app khởi động** (đang `hydrate()` từ token cũ trong
  `localStorage`): hiện 1 full-screen spinner tối giản (không phải skeleton —
  chưa có layout để skeleton) thay vì render `router-view` ngay, tránh render
  nhầm `/login` rồi nhấp nháy chuyển sang `/devices` (hoặc ngược lại) trong lúc
  chờ `GET /api/v1/me`.
- `LoginView`: theo bảng Element/Trigger/Action ở §2 trên (idle/submitting/
  error/success).
- `DeviceListView` (F0): không có state loading/error (không gọi API) — F2/F3
  thêm khi build thật.
- Không áp dụng thao tác async chạy nền ở F0 (đó là F6/F8).

## 5. Rủi ro / open question

- Ẩn mục sidebar Groups/Policies cho tới khi có route thật (§2) là quyết định
  của F0 — F5/F7 khi thêm route phải đồng thời bỏ điều kiện ẩn này trong
  `AppShell.vue`, ghi chú lại ở design-frontend của F5/F7 để không quên.
- `hydrate()` gọi `GET /api/v1/me` mỗi lần app khởi động (kể cả khi user vẫn
  đang mở tab, chỉ F5 trang) — chấp nhận được ở quy mô bài test này, không cần
  cache/tối ưu thêm.
