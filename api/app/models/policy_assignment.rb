# Join row: "Policy X is assigned to Group Y" OR "Policy X is assigned
# directly to Device Z" — never both, never neither (docs/design/F8-db.md
# §1a). No `source`/`status` column — group_id/device_id (exactly one
# present) already distinguish "assigned via Group" from "assigned directly
# to a Device", and effective-status is derived from `policy.status` at the
# time F9 computes it, not stored here.
#
# `organization_id` lives directly on this table (not inferred by joining
# through policy/group/device) — every count/lookup in F8 filters by org
# without a 2-3 table join just to apply the tenant boundary
# (docs/design/F8-db.md §1).
class PolicyAssignment < ApplicationRecord
  belongs_to :organization
  belongs_to :policy
  belongs_to :group, optional: true
  belongs_to :device, optional: true

  EXACTLY_ONE_TARGET_MESSAGE =
    "Phải gán cho đúng 1 Group hoặc 1 Device, không thể cả hai hoặc không cái nào.".freeze

  validate :exactly_one_of_group_or_device

  private

  # XOR: true when exactly one of the two is present, false when both or
  # neither are. This validation only guards the ordinary save/create path
  # (specs, console) — the two real write paths in F8
  # (GroupPolicyAssignmentJob, Api::V1::PolicyDeviceAssignmentsController)
  # both use `upsert_all`, which skips this entirely. The DB CHECK constraint
  # `chk_policy_assignments_exactly_one_target` (added in the migration) is
  # the layer that actually protects those paths (docs/design/F8-db.md §1a).
  def exactly_one_of_group_or_device
    return if group_id.present? ^ device_id.present?

    errors.add(:base, EXACTLY_ONE_TARGET_MESSAGE)
  end
end
