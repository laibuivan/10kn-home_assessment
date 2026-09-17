/**
 * Shared literal for the deactivate-with-assignments warning (SoT F8 §4-F) —
 * one function so `PolicyListView.vue` (quick toggle) and `PolicyFormModal.vue`
 * (edit form) render byte-identical copy instead of two hand-typed copies
 * drifting apart (docs/design/F8-frontend.md §2.1.1/§5).
 */
export function DEACTIVATE_WARNING(n: number): string {
  return (
    `Policy đang được gán cho ${n} group/device. Chuyển sang inactive sẽ khiến ` +
    `các nơi này không còn được tính là policy đang áp dụng, nhưng liên kết gán ` +
    `vẫn được giữ nguyên — nếu kích hoạt lại, các nơi này có hiệu lực trở lại ngay.`
  )
}
