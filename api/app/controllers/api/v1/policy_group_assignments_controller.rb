module Api
  module V1
    # Read-only "which Groups have this Policy assigned" — docs/design/
    # F8-api.md §2.13. The write side of Policy↔Group lives in
    # GroupPolicyAssignmentsController (both directions call the same
    # underlying data — docs/plan/F8-policy-assignment.md "F8-frontend.md
    # §2.2").
    class PolicyGroupAssignmentsController < ApplicationController
      include Authenticatable
      include Paginatable

      # GET /api/v1/policies/:id/group_assignments — docs/design/F8-api.md §2.13.
      def index
        policy = policy_scope(Policy).find(params[:id])
        authorize policy, :show?

        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        scope = Group.joins(:policy_assignments)
                      .where(policy_assignments: { policy_id: policy.id })
                      .merge(current_organization.groups)
                      .order("policy_assignments.created_at DESC, groups.id DESC")
        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        render json: {
          groups: records.map { |group| { id: group.id, name: group.name } },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end
    end
  end
end
