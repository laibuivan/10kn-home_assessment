# Authorization for Group (docs/design/F5-api.md §1).
#
# There are no roles inside an Organization (SoT F5 §9): every active user may
# list, create, rename and delete the org's groups. The real authorization
# boundary is the Scope below — it is the single place group queries get tied
# to the caller's Organization (CLAUDE.md §4), which is why `destroy?` being
# unconditionally true is safe: `authorize group` only ever runs on a record
# already found through policy_scope, so another org's group 404s first.
#
# `show?` is deliberately NOT declared — F5 has no show action (SoT OQ-5), and
# ApplicationPolicy's deny-by-default keeps a future forgotten route closed.
class GroupPolicy < ApplicationPolicy
  def index?
    true
  end

  def create?
    true
  end

  def update?
    true
  end

  def destroy?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      # Deliberately goes through the association, never Group.where(...) —
      # same rule as every other org-scoped query in this codebase.
      user.organization.groups
    end
  end
end
