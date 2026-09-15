# Senior Ruby on Rails – Take-home Assessment

---

## Thời gian & nguyên tắc

**Sản phẩm phải hoàn chỉnh và chạy được.**

Những gì ghi trong đề đều phải làm xong, chỉnh chu, reviewer mở lên dùng được ngay — không phải prototype, không trang dở, không “phần này TODO”.

Được dùng AI. Ứng viên chịu trách nhiệm toàn bộ sản phẩm và phải giải thích được quyết định của mình.

---

## Sản phẩm

Xây một **Device Management Console** cho công ty quản lý thiết bị nội bộ.

Một **Organization** có Users (đăng nhập), Devices, Groups và Policies. Dữ liệu của Organization này không được lộ sang Organization khác.

Stack:

- Backend: **Ruby on Rails** + **PostgreSQL**
- Frontend: **Vue** (SPA)
- Sản phẩm chạy local được theo README, thao tác được trên UI, có test tự động

Một repo (monorepo `api/` + `web/` cũng được). Version ghi rõ trong tài liệu.

---

## Nghiệp vụ

### Organization & User

Mỗi Organization có tài khoản đăng nhập. Email unique trong Organization. User `active` mới được đăng nhập.

Không cần màn hình quản lý Organization. Seed sẵn **2 Organization**, mỗi bên ít nhất 1 tài khoản — để chứng minh không truy cập chéo được.

### Device

- identifier, name, platform (`ios` / `android` / `macos`), os_version, status (`active` / `inactive` / `retired`), last_seen_at
- identifier unique trong Organization
- Device `retired` không được sửa thông tin hay đổi group/policy (trừ khi bạn thiết kế luồng un-retire có chủ đích và ghi vào tài liệu)

### Group

- name, description
- chứa nhiều Device; một Device thuộc nhiều Group
- xóa Group không được để dữ liệu liên quan bị treo / sai

### Policy

- name, type, configuration (dạng cấu trúc, ví dụ JSON), status (`active` / `inactive`)
- gán được cho **Group** và/hoặc **Device**
- không gán Policy `inactive`
- không gán lẫn Organization

**Group có thể rất lớn (cỡ 10.000 devices).** Gán Policy cho Group vẫn phải dùng được: UI không treo, hệ thống không sập, kết quả đúng (không thiếu thiết bị, không gán trùng vô hạn nếu thao tác lại). Cách làm do ứng viên quyết định.

**Policy thực áp dụng trên Device:** Device có thể nhận policy từ các Group nó đang thuộc và từ gán trực tiếp. Màn hình chi tiết Device phải hiện policy đang áp dụng. Nếu cùng `type` mà configuration khác nhau, xử lý cho ra kết quả xác định và giải thích trong tài liệu thiết kế.

---

## Giao diện bắt buộc

FE phải đủ để reviewer **không cần Postman** vẫn kiểm tra hết nghiệp vụ. Không làm trang thừa.

| Trang | Phải làm được |
| --- | --- |
| Login | Đăng nhập theo tài khoản seed; sai thông tin thì báo lỗi rõ |
| Devices | Danh sách có phân trang + lọc (platform, status); tạo / sửa; vào chi tiết |
| Device detail | Thông tin máy, group đang thuộc, **policy đang áp dụng** |
| Groups | Danh sách; tạo / sửa / xóa; chi tiết: thêm/gỡ device, gán policy |
| Policies | Danh sách; tạo / sửa; gán cho group hoặc device |

Yêu cầu chỉnh chu (đây là chỗ phân loại cẩn thận):

- loading, rỗng, lỗi — không để spinner vô hạn hay trang trắng
- validate form, message lỗi từ API hiện ra được
- xóa phải confirm
- phân trang list, không render 10.000 dòng
- gán policy cho group lớn: user hiểu được là việc đang chạy / đã xong / thất bại — không phải bấm xong không biết gì
- không hardcode secret, không để `console` error, không nút chết, không copy-paste layout dở dang
- UI nhất quán, dùng được bằng seed data ngay sau setup

---

## Chất lượng kỹ thuật (tự nhận ra và làm đúng)

Hệ thống phải an toàn và đúng khi dùng thật: không lộ data chéo org, không tạo trùng dữ liệu đáng lẽ unique, thao tác nhiều bước không để DB nửa vời, API/list không chậm vô lý khi dữ liệu tăng.

Test tự động phải chứng minh được các invariant nghiệp vụ (unique, chéo org, retired, inactive policy, xóa group, gán policy, policy áp dụng trên device). README phải chạy test một lệnh.

Không cần coverage 100%. Cần test đúng việc hệ thống không được phép sai.

---

## Tài liệu bắt buộc

### 1. `DESIGN.md` — tài liệu thiết kế

Viết cho người sẽ maintain, không phải essay:

- mô hình dữ liệu / quan hệ
- luồng chính (login, gán policy, xem policy trên device)
- cách xử lý group rất lớn
- cách tính policy đang áp dụng và conflict
- auth / phân quyền / tách Organization
- giả định đã lấy khi đề không nói hết
- rủi ro production còn lại

### 2. `README.md` — cho người chưa biết gì về repo

Copy-paste là chạy được:

- yêu cầu máy (Ruby/Node/Postgres version)
- setup (cài dependency, tạo DB, seed)
- chạy API + Vue
- tài khoản seed (cả 2 org)
- chạy test
- walkthrough 5 phút: làm gì trên UI để thấy gán policy và chi tiết device

### 3. AI

Ghi ngắn: dùng tool gì, chỗ nào AI làm, chỗ nào tự thiết kế, chỗ AI sai đã sửa.

---

## Nộp bài

1. Push lên Git (GitHub/GitLab). Giữ lịch sử commit thật, không gộp thành 1 commit.
2. Repo **private**: mời `quanganh.ho@10kn.io` và `namph-10kn` với quyền đọc. Repo public: gửi URL.

---

## Cách chấm

Không chấm “nhiều feature”. Chấm sản phẩm hoàn chỉnh:

- đúng nghiệp vụ, không leak tenant
- thiết kế chịu được group lớn và conflict policy
- code Rails/Vue maintain được, UI dùng được
- test bảo vệ được rule
- tài liệu đủ để người khác chạy và hiểu
- sự cẩn thận: edge case, trạng thái UI, seed, git, không bỏ dở