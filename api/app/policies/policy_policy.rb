# Authorization for Policy (docs/design/F7-api.md §1).
#
# Naming note: this is the Pundit policy for the `Policy` model — the class
# name collision with the generic "Pundit policy" concept is intentional
# (there is no better name for a model literally called Policy) and is
# flagged so nobody reads "policy" in a comment here and can't tell which
# one it means (SoT F7 §3).
#
# No roles inside an Organization (SoT F7 §9): every active user may list,
# create and edit the org's policies, including flipping `status`. The real
# authorization boundary is the Scope below.
class PolicyPolicy < ApplicationPolicy
  def index?
    true
  end

  def create?
    true
  end

  def update?
    true
  end

  # F8 — GET /policies/:id (F7 OQ-7 mở lại), and reused for the two new read
  # actions (list device assigned directly, list group assigned) — same
  # reasoning as GroupPolicy#show? (docs/design/F8-api.md §1).
  def show?
    true
  end

  # POST/DELETE /policies/:id/device_assignments(/:device_id) — assigning/
  # unassigning a Device directly to this Policy.
  def assign_device?
    true
  end

  def unassign_device?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      # Through the association, never Policy.where(...) — same rule as
      # every other org-scoped query in this codebase.
      user.organization.policies
    end
  end
end
