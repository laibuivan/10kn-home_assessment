module Api
  module V1
    # Assigning/unassigning a Policy to/from a Group — docs/design/F8-api.md
    # §2.4–§2.6. The Group is ALWAYS resolved through `policy_scope(Group).find`
    # FIRST, and the Policy through its own independent
    # `policy_scope(Policy).find` — two separate org-scope checks in every
    # action that touches both, so either side belonging to another
    # organization 404s without leaking which one (CLAUDE.md §4, SoT F8
    # A1/A2).
    class GroupPolicyAssignmentsController < ApplicationController
      include Authenticatable
      include Paginatable
      include PolicyAssignmentJobSerializable

      # GET /api/v1/groups/:id/policy_assignments — docs/design/F8-api.md §2.4.
      def index
        group = policy_scope(Group).find(params[:id])
        authorize group, :show?

        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        scope = Policy.joins(:policy_assignments)
                       .where(policy_assignments: { group_id: group.id })
                       .merge(current_organization.policies)
                       .order("policy_assignments.created_at DESC, policy_assignments.id DESC")
        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        render json: {
          policies: records.map { |policy| { id: policy.id, name: policy.name, type: policy.type, status: policy.status } },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      # POST /api/v1/groups/:id/policy_assignments — docs/design/F8-api.md §2.5.
      def create
        group = policy_scope(Group).find(params[:id])   # 404 độc lập #1 (A1)
        authorize group, :assign_policy?

        policy = policy_scope(Policy).find(params[:policy_id])  # 404 độc lập #2 (A2)
        unless policy.active?
          return render_validation_errors(base: [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ])  # A5, A26
        end

        job = find_or_create_policy_assignment_job(group, policy)
        render json: { policy_assignment_job: serialize_policy_assignment_job(job) }, status: :accepted
      end

      # DELETE /api/v1/groups/:id/policy_assignments/:policy_id —
      # docs/design/F8-api.md §2.6.
      def destroy
        group = policy_scope(Group).find(params[:id])       # 404 độc lập #1
        authorize group, :unassign_policy?

        policy = policy_scope(Policy).find(params[:policy_id])  # 404 độc lập #2
        assignment = group.policy_assignments.find_by(policy_id: policy.id)
        return render_not_found if assignment.nil?  # OQ-4 — liên kết không tồn tại → 404, không 204

        deleted_count = PolicyAssignment.where(id: assignment.id).delete_all
        return render_not_found if deleted_count.zero?  # race: 2 request gỡ cùng lúc, giống F6 A16
        head :no_content
      end

      private

      # OQ-5 (dedupe): a pending/running job for the EXACT same (policy_id,
      # group_id) pair already exists → return that job, do NOT create a new
      # one (A12). Check-then-create has a theoretical race window (accepted,
      # docs/design/F8-db.md §4b OQ-DB-2 — upsert_all stays idempotent
      # either way, worst case is one extra job running).
      def find_or_create_policy_assignment_job(group, policy)
        existing = current_organization.policy_assignment_jobs
          .where(policy_id: policy.id, group_id: group.id, status: %i[pending running])
          .order(:id).first
        return existing if existing

        # One transaction for create! + perform_later — both are INSERTs on
        # the same database (docs/design/F8-db.md §3.4a), so they must both
        # succeed or both roll back, or a job row could be left orphaned at
        # pending forever with nothing ever enqueued to move it.
        ActiveRecord::Base.transaction do
          job = current_organization.policy_assignment_jobs.create!(
            policy_id: policy.id,
            group_id: group.id,
            status: :pending,
            total_count: group.devices.count,
            processed_count: 0
          )
          GroupPolicyAssignmentJob.perform_later(job.id)
          job
        end
      end
    end
  end
end
