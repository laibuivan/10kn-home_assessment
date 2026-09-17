module Api
  module V1
    # GET /api/v1/devices/:id/applied_policies — docs/design/F9-api.md §1-2.1.
    #
    # Read-only: F9 never creates/updates/destroys policy_assignments (SoT
    # F9-policy-resolution.md R6) — the entire response comes from
    # Devices::PolicyResolver, computed fresh on every call, nothing cached.
    class DeviceAppliedPoliciesController < ApplicationController
      # NOT inherited from ApplicationController — every resource controller
      # includes this itself (same as DevicesController/PoliciesController).
      include Authenticatable

      def index
        device = policy_scope(Device).find(params[:id]) # 404 — wrong org/nonexistent/malformed id (CLAUDE.md §4, A15/A16)
        # Action name is `index`, but the record being viewed is 1 Device —
        # `authorize device, :show?` called explicitly (not `authorize
        # device` bare, which would resolve to DevicePolicy#index? — a
        # different, unrelated permission, docs/design/F9-api.md §1).
        authorize device, :show?

        results = Devices::PolicyResolver.new(device).call
        render json: { applied_policies: results }
      end
    end
  end
end
