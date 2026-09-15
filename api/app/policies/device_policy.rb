# Authorization for Device (docs/design/F2-api.md §5).
#
# There are no roles inside an Organization (SoT F0 §9 / F2 §9): every active
# user may read the whole device list. The real authorization boundary is the
# Scope below — it is the single place device queries get tied to the
# caller's Organization, so no controller ever has to remember to do it
# (CLAUDE.md §4).
class DevicePolicy < ApplicationPolicy
  def index?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      # Deliberately goes through the association, never Device.where(...) —
      # same rule as every other org-scoped query in this codebase.
      user.organization.devices
    end
  end
end
