module Api
  module V1
    # Assigning/unassigning a Policy directly to/from a Device — docs/design/
    # F8-api.md §2.10–§2.12. Synchronous (bounded — 1 device/request, OQ-7),
    # unlike the Group path: no job, no `pending`/`running` state ever
    # exists for this branch.
    class PolicyDeviceAssignmentsController < ApplicationController
      include Authenticatable
      include Paginatable
      include DeviceSerializable

      # GET /api/v1/policies/:id/device_assignments — docs/design/F8-api.md §2.10.
      def index
        policy = policy_scope(Policy).find(params[:id])
        authorize policy, :show?

        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        scope = Device.joins(:policy_assignments)
                       .where(policy_assignments: { policy_id: policy.id })
                       .merge(current_organization.devices)
                       .order("policy_assignments.created_at DESC, devices.id DESC")
        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        render json: {
          devices: records.map { |device| serialize_device(device) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      # POST /api/v1/policies/:id/device_assignments — docs/design/F8-api.md §2.11.
      def create
        policy = policy_scope(Policy).find(params[:id])   # 404 độc lập #1 (A4)
        authorize policy, :assign_device?

        device = policy_scope(Device).find(params[:device_id])  # 404 độc lập #2 (A3)
        unless policy.active?
          return render_validation_errors(base: [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ])  # A6
        end
        if device.retired?
          return render_validation_errors(base: [ Device::RETIRED_POLICY_MESSAGE ])       # A7, A26
        end

        now = Time.current
        PolicyAssignment.upsert_all(
          [ { organization_id: policy.organization_id, policy_id: policy.id, device_id: device.id,
              created_at: now, updated_at: now } ],
          unique_by: :index_policy_assignments_on_policy_and_device, on_duplicate: :skip
        )

        render json: { device: serialize_device(device) }, status: :created
      end

      # DELETE /api/v1/policies/:id/device_assignments/:device_id —
      # docs/design/F8-api.md §2.12.
      #
      # No `device.retired?` check here — unlike GroupDevicesController#destroy
      # (F6, which DOES block removing a retired device from a group). SoT F8
      # §6 only writes "retired bất biến" for *assigning* directly to a
      # Device; no acceptance scenario blocks *unassigning* a Policy from a
      # retired Device (docs/design/F8-api.md §5, §2.12).
      def destroy
        policy = policy_scope(Policy).find(params[:id])          # 404 độc lập #1
        authorize policy, :unassign_device?

        device = policy_scope(Device).find(params[:device_id])   # 404 độc lập #2
        assignment = policy.policy_assignments.find_by(device_id: device.id)
        return render_not_found if assignment.nil?

        deleted_count = PolicyAssignment.where(id: assignment.id).delete_all
        return render_not_found if deleted_count.zero?
        head :no_content
      end
    end
  end
end
