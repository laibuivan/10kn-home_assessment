---
description: Chạy 4 gate kiểm tra (rubocop, rspec, eslint+vitest, playwright) và báo cáo
argument-hint: "[feature-id] (tuỳ chọn, vd. F4 — bỏ trống để chạy full acceptance suite)"
allowed-tools: Bash(bundle exec rubocop:*), Bash(bundle exec rspec:*), Bash(npm run:*), Bash(npx playwright:*), Bash(npx bddgen:*), Bash(find features -iname:*), Bash(docker compose:*), Bash(bin/rails db:*)
---

Chạy 4 gate kiểm tra theo thứ tự và báo cáo kết quả dưới dạng bảng (pass/fail):

1. `docker compose exec api bundle exec rubocop`
2. `docker compose exec -e RAILS_ENV=test api bundle exec rspec` — **`-e
   RAILS_ENV=test` bắt buộc**: container chạy `RAILS_ENV=development` cho dev
   server, thiếu override này `rspec` sẽ chạy nhầm env dev (test DB không
   tồn tại/không migrate, có thể còn 403 Blocked-host do
   `config.hosts` của dev khác test — xem `config/environments/test.rb`).
3. `npm run lint && npm run test:unit` (trong `web/`)
4. Acceptance (Playwright) — **xem chế độ bên dưới tuỳ theo `$ARGUMENTS`**

## Chế độ acceptance (gate 4)

- **Không có `$ARGUMENTS`** (lệnh gốc `/gate`) → chạy **full suite**:
  `npx playwright test` từ `features/` (đúng như CI, mọi `.feature`). Đây là
  lần chạy **bắt buộc trước khi coi feature là Done / trước commit** — chỉ
  full suite mới phát hiện được regression ở feature khác.
- **Có `$ARGUMENTS`** (một feature ID, vd `F4`) → **scoped, dùng cho vòng lặp
  phát triển nhanh**:
  1. `find features -iname "$ARGUMENTS*.feature"` để tìm file `.feature` khớp
     tiền tố ID. Không thấy file nào → báo cho user và hỏi tên file `.feature`
     chính xác thay vì tự ý chạy full suite.
  2. `npx bddgen` (nếu dùng `playwright-bdd` codegen) để sinh lại spec từ
     `.feature`/`steps/`.
  3. `npx playwright test .features-gen/features/<tên-file-khớp>.spec.js` —
     chỉ scenario của feature này.
  4. Sau khi báo cáo kết quả, **nhắc rõ**: scoped mode không thay thế full
     suite; chạy `/gate` (không tham số) trước khi commit.

Yêu cầu trước khi chạy: `docker compose up -d db` (Postgres) và
`bin/rails db:test:prepare`/`RAILS_ENV=test bin/rails db:prepare` nếu DB test
chưa sẵn sàng — kiểm tra thay vì giả định đã chạy.

Nếu một gate fail: **dừng ở đó**, tóm tắt lỗi và nguyên nhân gốc, đề xuất
cách sửa. Không sửa acceptance test để làm gate 4 pass (xem golden rule trong
`CLAUDE.md`). Chỉ khi cả 4 gate đều green **trên full suite** thì phần
verification của Definition of Done mới được coi là đạt — scoped mode chỉ là
kiểm tra nhanh giữa chừng.
