# Authorization for Group (docs/design/F5-api.md §1).
#
# There are no roles inside an Organization (SoT F5 §9): every active user may
# list, create, rename and delete the org's groups. The real authorization
# boundary is the Scope below — it is the single place group queries get tied
# to the caller's Organization (CLAUDE.md §4), which is why `destroy?` being
# unconditionally true is safe: `authorize group` only ever runs on a record
# already found through policy_scope, so another org's group 404s first.
#
# F6 adds three actions (`show?`, `add_devices?`, `remove_device?`) for the
# Group detail screen and its membership sub-resource. All three must be
# authorized EXPLICITLY at the call site — `authorize group, :show?`, not a
# bare `authorize group` — because Api::V1::GroupDevicesController's actions
# are named index/create/destroy, exactly like Api::V1::GroupsController's,
# and Pundit's default query is derived from `action_name`. A bare authorize
# there would silently ask "may this user list every group?" when the real
# question is "may this user list THIS group's devices?". Every one of those
# answers is `true` today, so nothing would break visibly — which is what
# makes it a trap worth spelling out (docs/design/F6-api.md §1).
class GroupPolicy < ApplicationPolicy
  def index?
    true
  end

  # GET /groups/:id and GET /groups/:id/devices — reading one group, or the
  # devices inside it.
  def show?
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

  # POST /groups/:id/devices — adding members in bulk.
  def add_devices?
    true
  end

  # DELETE /groups/:id/devices/:device_id — removing one member.
  def remove_device?
    true
  end

  # F8 — GET/POST /groups/:id/policy_assignments, DELETE
  # /groups/:id/policy_assignments/:policy_id, GET
  # /groups/:id/policy_assignment_jobs. All of these act ON the group itself
  # (docs/design/F8-api.md §1) — no roles, same reasoning as add_devices?/
  # remove_device? above.
  def assign_policy?
    true
  end

  def unassign_policy?
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
