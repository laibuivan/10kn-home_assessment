# Assigns 1 Policy to 1 Group, asynchronously (docs/design/F8-db.md §3.4b) —
# the only job type F8 has. Under Phương án A (assignment-level, no
# fan-out), this is always exactly ONE `policy_assignments` row, never one
# row per device in the group — so there is no "batch N/M" to track, and no
# partial-completion state to recover from (see PolicyAssignmentJob's
# comment on `processed_count`).
class GroupPolicyAssignmentJob < ApplicationJob
  queue_as :default

  def perform(job_id)
    job = PolicyAssignmentJob.find(job_id)
    # A Group deleted before the worker even picked this job up already had
    # Group#fail_pending_policy_assignment_jobs flip it to failed — nothing
    # left for this job to do (docs/design/F8-db.md §4c).
    return unless job.pending? || job.running?

    job.update!(status: :running)
    # Raises RecordNotFound if the Group was deleted in the narrow window
    # between the guard above and this line — rescued below into the exact
    # same failed state Group#fail_pending_policy_assignment_jobs would have
    # produced (docs/design/F8-db.md §4c).
    group = Group.find(job.group_id)

    now = Time.current
    PolicyAssignment.upsert_all(
      [ { organization_id: group.organization_id, policy_id: job.policy_id, group_id: group.id,
          created_at: now, updated_at: now } ],
      unique_by: :index_policy_assignments_on_policy_and_group, on_duplicate: :skip
    )

    job.update!(status: :done, processed_count: job.total_count)
  rescue ActiveRecord::RecordNotFound
    job.update!(status: :failed, error_message: PolicyAssignmentJob::GROUP_DELETED_MESSAGE)
  end
end
