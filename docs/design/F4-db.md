---
feature_id: F4
status: approved   # draft | approved
approver: lai.bui.vtp@gmail.com (qua Claude Code, theo ủy quyền của user trong phiên làm việc)
date: 2026-09-16
---

# Thiết kế Database — F4

Nguồn: `docs/sot/F4-device-detail.md` (approved), `PRD.md` §"Device",
`CLAUDE.md` §4, `api/db/schema.rb` hiện có (bảng `devices` đã tồn tại từ F2,
xem `docs/design/F2-db.md`; validate/callback ở `api/app/models/device.rb`
đã tồn tại từ F3, xem `docs/design/F3-db.md`).

**Kết luận đầu tiên (khớp SoT §1, §3, §8):** F4 **không cần migration nào**
và **không đổi gì ở `Device` model**. F4 chỉ đọc (`GET /api/v1/devices/:id`),
dùng nguyên field/validation/callback đã có từ F2/F3. SoT §3 "Ngoài phạm vi"
đã chốt rõ: không tạo bảng `groups`/`policies`/`group_memberships`/
`policy_assignments` — những bảng đó thuộc F5/F6/F7/F8, chưa phải dependency
của F4 (xem SoT §1 "Lưu ý sequencing quan trọng", OQ-1).

## 1. Model / field / enum / relation

| Model | Field/Assoc | Kiểu | Ràng buộc | Add/Change/No-change |
|---|---|---|---|---|
| `Device` | mọi field (`identifier`, `name`, `platform`, `os_version`, `status`, `organization_id`, `last_seen_at`, timestamps) | (như F2/F3) | Không đổi field/kiểu/index/validation/callback nào — xem `docs/design/F2-db.md` §1, `docs/design/F3-db.md` §1 | **No-change** |
| `Device` | `has_many :groups` / `has_many :policies` | — | **Không thêm** — Group/Policy model chưa tồn tại (SoT OQ-1). Thêm association trỏ tới model chưa có sẽ raise lỗi load ngay khi Rails boot (`NameError: uninitialized constant Group`) | **Không làm** |

Không có field/assoc/enum mới nào ở F4. Bảng trên chỉ để xác nhận tường minh
(và ghi lại lý do) 2 khả năng có thể bị nhầm là "cần làm" nhưng thực ra nằm
ngoài phạm vi.

## 2. Migration plan

**Không có migration nào ở F4.** Route `GET /api/v1/devices/:id` dùng
nguyên bảng `devices` đã có, nguyên index đã có từ F2. Không backfill, không
phá dữ liệu cũ, không cần cân nhắc reversible vì không có file migration
nào được tạo.

## 3. Index / hiệu năng

Không thêm/đổi index nào. Query duy nhất F4 cần —
`current_organization.devices.find(params[:id])` — dùng **primary key**
(`devices.id`), đã có unique index mặc định của Postgres, không cần thêm
composite index. Không liên quan tới kịch bản group/list lớn (PRD ~10.000
device) — đây là fetch **1 record theo PK**, không phải list/scan.

Xác nhận lại 1 điểm để tránh nhầm lẫn khi implement: org-scope check
(`current_organization.devices.find`) **không** cần index riêng cho
`organization_id` để việc 404-khi-khác-org nhanh — `find` trên association
đã kèm sẵn `WHERE organization_id = ? AND id = ?`, và index PK trên `id` đã
đủ để Postgres chọn plan hiệu quả (bảng `devices` hiện tại quy mô nhỏ, và dù
lớn thì điều kiện `id = ?` đã giới hạn xuống tối đa 1 row trước khi Postgres
cần lọc `organization_id`).

## 4. Rủi ro / open question

- **Không migration nghĩa là không có gì để "approve" ở tầng DB thật sự** —
  file này tồn tại chủ yếu để tuân thủ gate "cả 3 bản thiết kế phải approved
  trước khi code" (`CLAUDE.md` §3 rule 2), tránh nhảy thẳng qua bước DB dù
  nội dung là "no-op". Không phải lỗi quy trình, là kết quả đúng của 1
  feature read-only trên schema đã có sẵn.
- **Rủi ro thật sự nằm ở tầng API/Rails, không phải DB**: `Device.find` với
  `:id` sai định dạng (SoT A3, vd không phải số nguyên) — hành vi của
  Postgres adapter khi typecast chuỗi lạ vào cột `bigint` cần được xác nhận
  ở `/design F4` API (liệu có tự raise `ActiveRecord::RecordNotFound` như
  kỳ vọng hay raise `ActiveRecord::StatementInvalid`/lỗi khác cần rescue
  riêng) — nêu lại ở đây để `/design F4` API không bỏ sót, giống cách
  `F3-db.md` từng bàn giao rủi ro `ArgumentError` enum sang API design.
- **Không thêm `has_many :groups`/`has_many :policies` placeholder rỗng
  (vd trả `[]` cứng) vào `Device` model** — cân nhắc và loại bỏ có chủ đích:
  thêm 1 method/association giả (không backing bởi bảng thật) chỉ để "cho
  có" sẽ phải xóa/viết lại khi F5-F9 tới, không tiết kiệm được gì so với
  việc FE tự vẽ empty state tĩnh (đúng theo SoT OQ-1/OQ-6) — ghi lại ở đây
  để người review sau không đề xuất lại phương án này.
