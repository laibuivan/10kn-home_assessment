# The one shape a PolicyAssignmentJob takes in a JSON response
# (docs/design/F8-api.md §2.9). Extracted from the start (not "copy then
# extract later" like DeviceSerializable was) because 3 controllers need it
# at once: GroupPolicyAssignmentsController#create,
# GroupPolicyAssignmentJobsController#index, PolicyAssignmentJobsController#show.
module PolicyAssignmentJobSerializable
  extend ActiveSupport::Concern

  private

  # `group:` MUST handle nil — after a Group is deleted,
  # Group#fail_pending_policy_assignment_jobs (docs/design/F8-db.md §1c)
  # flips a pending/running job to failed, then `dependent: :nullify` clears
  # group_id, but the job row itself must still exist and be readable via
  # GET /policy_assignment_jobs/:id (200, never 404). `job.group` — through
  # `belongs_to :group, optional: true` — safely returns nil, never raises.
  def serialize_policy_assignment_job(job)
    {
      id: job.id,
      status: job.status,
      total_count: job.total_count,
      processed_count: job.processed_count,
      error_message: job.error_message,
      policy: { id: job.policy.id, name: job.policy.name },
      group: job.group ? { id: job.group.id, name: job.group.name } : nil,
      created_at: job.created_at,
      updated_at: job.updated_at
    }
  end
end
