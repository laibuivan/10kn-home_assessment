# Join row: "device X is currently a member of group Y" — nothing else
# (docs/design/F6-db.md §1). No `source`/`status` column, no extra behaviour.
#
# Two things this model deliberately does NOT do, both spelled out in
# docs/design/F6-db.md §1b so nobody "fixes" them later:
#
#   1. It does not validate that `group.organization_id ==
#      device.organization_id`. That boundary is enforced one layer up, where
#      device ids are filtered through `current_organization.devices` before a
#      row is ever built (Api::V1::GroupDevicesController#create) — and it has
#      to be, because the main write path is `upsert_all`, which skips every
#      validation and callback in this class.
#   2. For the same reason, the uniqueness validation below is NOT what stops
#      duplicate rows on that path — the composite unique index
#      `[group_id, device_id]` is. This validation only guards the ordinary
#      `save`/`create` path (specs, seeds, console), which is layer 1 of the
#      project's usual two-layer rule (CLAUDE.md §4).
class GroupMembership < ApplicationRecord
  belongs_to :group
  belongs_to :device

  validates :device_id, uniqueness: { scope: :group_id }
end
