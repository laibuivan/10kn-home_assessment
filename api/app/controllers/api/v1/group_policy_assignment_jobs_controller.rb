module Api
  module V1
    # Re-attach / history for a Group's async Policy-assignment jobs —
    # docs/design/F8-api.md §2.7. Read-only — creating a job is
    # GroupPolicyAssignmentsController#create's job.
    class GroupPolicyAssignmentJobsController < ApplicationController
      include Authenticatable
      include Paginatable
      include PolicyAssignmentJobSerializable

      # Defined locally, not shared with PoliciesController::STATUS_ENUM_ERROR
      # — same reasoning as F7 §2.6 for not extending DeviceFilterable: one
      # call site, no benefit to a shared concern.
      STATUS_LIST_ENUM_ERROR = "is not included in the list".freeze

      # GET /api/v1/groups/:id/policy_assignment_jobs — docs/design/F8-api.md §2.7.
      def index
        group = policy_scope(Group).find(params[:id])
        authorize group, :show?

        errors = pagination_errors
        errors[:status] = [ STATUS_LIST_ENUM_ERROR ] if invalid_job_statuses?(params[:status])
        return render_validation_errors(errors) if errors.any?

        scope = group.policy_assignment_jobs.merge(current_organization.policy_assignment_jobs)
        scope = scope.where(status: parsed_job_statuses(params[:status])) if params[:status].present?
        scope = scope.order(created_at: :desc, id: :desc)

        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        render json: {
          policy_assignment_jobs: records.map { |job| serialize_policy_assignment_job(job) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      private

      # "pending,running" → ["pending", "running"]; blank/absent → [] (no
      # filter — same "blank = no filter" convention as every other filter
      # in the app).
      def parsed_job_statuses(raw)
        raw.to_s.split(",").map(&:strip).reject(&:blank?)
      end

      # Guarded BEFORE `.where(status: ...)` touches ActiveRecord — an
      # out-of-enum value anywhere in the list would raise ArgumentError
      # (500) otherwise (same trap as F7 §2.6/§2.1, here applied to an array).
      def invalid_job_statuses?(raw)
        parsed_job_statuses(raw).any? { |value| !value.in?(PolicyAssignmentJob.statuses.keys) }
      end
    end
  end
end
