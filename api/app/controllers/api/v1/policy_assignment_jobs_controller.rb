module Api
  module V1
    # Poll one PolicyAssignmentJob by id — docs/design/F8-api.md §2.8. The
    # only F8 endpoint not nested under /groups or /policies (SoT §3 — the
    # client polls by job_id alone, without needing to know the group/policy
    # again).
    class PolicyAssignmentJobsController < ApplicationController
      include Authenticatable
      include PolicyAssignmentJobSerializable

      # GET /api/v1/policy_assignment_jobs/:id — docs/design/F8-api.md §2.8.
      def show
        job = current_organization.policy_assignment_jobs.find(params[:id])
        authorize job

        render json: { policy_assignment_job: serialize_policy_assignment_job(job) }
      end
    end
  end
end
