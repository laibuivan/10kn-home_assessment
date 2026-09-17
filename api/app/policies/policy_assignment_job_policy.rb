# Authorization for PolicyAssignmentJob (docs/design/F8-api.md §1) — the
# only F8 resource with its own top-level route (GET
# /api/v1/policy_assignment_jobs/:id), so it is the only one that needs its
# own Scope. `PolicyAssignment` (the join row) deliberately has NO Pundit
# policy of its own — every write/read of it is authorized through its
# Group or Policy parent instead, same pattern as GroupMembership in F6.
class PolicyAssignmentJobPolicy < ApplicationPolicy
  def show?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.organization.policy_assignment_jobs
    end
  end
end
