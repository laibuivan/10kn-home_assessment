---
feature_id: F0
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com
date: 2026-09-15
---

# Thiết kế Database — F0

Nguồn: `docs/sot/F0-foundation.md` (approved), `PRD.md` §"Organization & User",
`api/db/schema.rb` hiện có (chỉ có `schema_migrations`/`ar_internal_metadata`
— chưa có bảng nghiệp vụ nào).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `Organization` | `name` | `string` | `null: false` | Add |
| `Organization` | `has_many :users, dependent: :restrict_with_error` | — | Không xoá Organization còn User (không có UI xoá org — PRD không yêu cầu — chặn ở model cho an toàn, không phải chỉ dựa vào "không có nút xoá") | Add |
| `User` | `belongs_to :organization` | FK `organization_id`, `bigint` | `null: false`, index | Add |
| `User` | `email` | `string` | `null: false`; validate format; **unique theo `organization_id`** (composite, xem §1a); luôn lưu **lowercase** (normalize trước validate — tránh `Foo@x.com`/`foo@x.com` bị coi là 2 email khác nhau) | Add |
| `User` | `password_digest` | `string` | `null: false` (qua `has_secure_password`, cần gem `bcrypt` — hiện đang comment trong `Gemfile`, uncomment ở bước implement) | Add |
| `User` | `status` | `integer` | `null: false`, default `0`; Rails `enum status: { active: 0, inactive: 1 }` | Add |

### 1a. Composite unique index — quyết định quan trọng

SoT §6 yêu cầu `email` unique **trong Organization**, KHÔNG unique toàn hệ
thống (PRD; SoT §12 OQ-2 xác nhận 2 org được phép trùng email). Migration:

```ruby
add_index :users, [:organization_id, :email], unique: true
```

**Không** thêm `add_index :users, :email, unique: true` (đơn, toàn cục) — làm
vậy sẽ vô tình cấm chính cái PRD cho phép (2 org trùng email), phá luôn kịch
bản test cross-org mà SoT §11 "Email trùng giữa 2 Organization" yêu cầu.

## 2. Migration plan

Thứ tự (2 migration riêng, `Organization` phải tồn tại trước khi `User` có FK
tới nó):

1. `CreateOrganizations` — bảng `organizations` (`name:string`, timestamps).
2. `CreateUsers` — bảng `users` (`organization_id:references`,
   `email:string`, `password_digest:string`, `status:integer default:0`,
   timestamps) + composite unique index (§1a) + index đơn `organization_id`
   (được tạo tự động kèm `references`, không cần thêm tay).

Không có dữ liệu cũ → không cần backfill. Cả 2 migration đều reversible mặc
định (`create_table`/`add_index` tự sinh `down` qua `change`).

## 3. Index / hiệu năng

- `users(organization_id, email)` unique — dùng cho cả việc lookup lúc login
  (`Organization` cụ thể + email) lẫn validate uniqueness, đã đủ nhanh cho quy
  mô của bài test này (không phải bảng lớn như Device).
- OQ-2 (SoT): lookup lúc login đi qua **mọi** org (`User.where(email:
  normalized_email)`, không biết org trước) — cần thêm
  `add_index :users, :email` (không unique) để câu này nhanh, tách biệt với
  composite unique ở trên (2 index khác mục đích, không thay thế nhau được).
- `organizations` không cần index thêm (bảng cực nhỏ, 2 dòng ở seed).

## 4. Rủi ro / open question

- `has_secure_password` cần cột `password_digest` đúng tên quy ước của Rails —
  đã đặt đúng tên ở trên, không có rủi ro đặt sai tên cột.
- Nếu tương lai (ngoài scope F0) cần audit "ai sửa gì" cho Device/Group/Policy,
  sẽ cần thêm quan hệ `User has_many :xxx` ở các model đó (không phải việc của
  F0 — chỉ ghi chú để `db-designer` của F2+ biết `User` đã tồn tại sẵn).
- Không có rủi ro migration phá dữ liệu cũ (DB hiện đang trống hoàn toàn).
