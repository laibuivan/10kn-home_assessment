# Tracks one async "assign Policy to Group" job (docs/design/F8-db.md §1c).
# Never created for the direct-to-Device path — that one is synchronous
# (docs/design/F8-api.md §4.2, SoT OQ-7).
#
# `group_id` is nullable ON PURPOSE, not an oversight — see
# `Group#fail_pending_policy_assignment_jobs` in app/models/group.rb for why:
# a Group can be deleted while this job is still `pending`/`running`, and the
# job row must keep existing (status: "failed", group: null) so
# `GET /api/v1/policy_assignment_jobs/:id` still returns 200, not 404.
#
# `processed_count` is cosmetic under Phương án A (docs/design/F8-db.md
# §3.3/OQ-DB-1): it stays 0 through pending/running and jumps straight to
# total_count when done — there is no batch-by-batch progress to report
# because assigning a Policy to a Group is always exactly one
# `policy_assignments` row, never one row per device.
class PolicyAssignmentJob < ApplicationRecord
  belongs_to :organization
  belongs_to :policy
  belongs_to :group, optional: true

  enum :status, { pending: 0, running: 1, done: 2, failed: 3 }

  GROUP_DELETED_MESSAGE = "Group đã bị xóa.".freeze

  validates :total_count, :processed_count,
            numericality: { greater_than_or_equal_to: 0 }
end
