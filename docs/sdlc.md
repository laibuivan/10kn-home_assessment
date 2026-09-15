# SDLC — vòng đời ATDD cho một feature

Áp dụng cho mỗi feature (`F-id`) trong `docs/backlog.md`. Mỗi bước có gate con
người review trước khi qua bước sau; agent tương ứng **dừng lại và báo cáo**
khi gate chưa qua, không tự ý bỏ qua.

```text
/brainstorm F-id      subagent: analyst
        │  → docs/sot/<id>-<slug>.md (status: draft)
        │  ⟵ NGƯỜI review, set status: approved, điền §12 Quyết định,
        │     rà lại mọi scenario §11 (pending OQ-n)
        ▼
/design F-id           tuần tự 3 bước, mỗi bước cần approve mới sang bước sau
        │  1. subagent db-designer       → docs/design/<id>-db.md
        │  2. subagent api-designer      → docs/design/<id>-api.md
        │  3. subagent frontend-designer → docs/design/<id>-frontend.md
        │  ⟵ NGƯỜI review + approve từng bản
        ▼
/plan F-id              subagent: Plan
        │  → docs/plan/<id>-<slug>.md (task T1..Tn, wave)
        ▼
/feature F-id            (hoặc chạy tay từng bước acceptance → implement)
        │  4. subagent acceptance-author → features/<slug>.feature   [RED]
        │  5. subagent slice-implementer → theo wave trong plan      [GREEN]
        ▼
/gate                    rubocop, rspec, eslint+vitest, playwright full suite
        ▼
/code-review, /security-review (nếu đụng auth/dữ liệu Device/Policy)
        ▼
commit (chỉ khi được yêu cầu) — branch feat/<slug>, lịch sử commit thật
```

## Vì sao giữ đủ các bước (không rút gọn)

Đây là take-home nhưng PRD chấm đúng những gì các gate này ép ra: bất biến
nghiệp vụ (tách org, unique, retired, inactive policy, xóa group, group lớn,
policy conflict) đúng bằng test tự động — không phải "nhiều feature". SoT §11
bắt buộc phủ hết edge flow trước khi viết acceptance test là cơ chế duy nhất
đảm bảo mấy invariant này không bị bỏ sót khi code nhanh.

## Điều chỉnh so với "full" SDLC gốc (bản có Notion, nhiều feature dài hạn)

- Không có Notion — không có bước tạo/đồng bộ ticket. Nguồn nghiệp vụ gốc là
  `PRD.md` (đọc trực tiếp), không phải Notion ticket.
- Không có `designs/*.html` prototype HTML — thay bằng **`UI_UX_design.md`**
  (root): design system nền dạng văn bản cho toàn bộ FE (IA/routes, layout
  khung, đặc tả từng trang, component dùng chung, ma trận loading/empty/error).
  `frontend-designer` bắt buộc tuân theo file này (route/component cố định)
  nhưng vẫn tự thiết kế chi tiết riêng từng slice ở bước Frontend của
  `/design F-id` — không phải chỉ đọc/chép lại.
- `spec.md`/`prisma/schema.prisma` (dự án gốc) → thay bằng chính `PRD.md` +
  `api/db/schema.rb` một khi đã có migration.

## Golden rule & invariant

Xem `CLAUDE.md` §3–4. Không lặp lại ở đây để tránh hai nguồn sự thật lệch nhau.

## SoT §-numbering

Bắt buộc dùng đúng số mục sau — các agent/command tham chiếu trực tiếp các số
này (`docs/templates/sot-template.md`):
§1 Meta · §2 Summary/User story · §3 Scope (in/out) · §4 Main flow ·
§5 Edge & alternate flow (5.1 variations chính, **5.2 edge case**) ·
§6 Business rule & validation · §7 UI state (empty/loading/error/success) ·
§8 Data & API touchpoint · §9 RBAC/Authorization · §10 Non-functional
(performance/scale) · **§11 Acceptance criteria (canonical, Gherkin-style)** ·
**§12 Decisions & Open questions**.

`/brainstorm` yêu cầu §11 phủ hết mọi flow ở §5.2 và mọi rule ở §6 (kể cả input
hợp lệ lẫn bị chặn), cộng RBAC denial. Scenario phụ thuộc quyết định chưa chốt
→ đặt tên `Scenario: ... (pending OQ-n)`, liệt kê open question tương ứng ở
§12. Approve = người điền Quyết định ở §12 **và** rà lại từng scenario
`(pending OQ-n)` (sửa theo quyết định thật, bỏ tag) trước khi set
`status: approved`.
