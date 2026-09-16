module Api
  module V1
    # Group membership at scale — docs/design/F6-api.md §2.2–§2.4.
    #
    # Three endpoints hanging off one Group: list its devices, add devices in
    # bulk, remove one. The Group itself is ALWAYS resolved through
    # `policy_scope(Group).find` first, before a single line of the request
    # body is read, so a cross-org (or nonexistent, or malformed) group id
    # 404s without ever touching group_memberships — never a 403, and never a
    # partial write (CLAUDE.md §4, SoT F6 A2–A5).
    #
    # No `rescue_from ActiveRecord::RecordNotUnique` here, unlike
    # Groups/DevicesController: nothing in this controller goes through
    # `save`/`create`. `upsert_all` resolves conflicts inside the DB
    # (ON CONFLICT DO NOTHING) and `delete_all` has no constraint to violate,
    # so such a handler would be dead code (docs/design/F6-api.md §5).
    class GroupDevicesController < ApplicationController
      include Authenticatable
      include Paginatable
      include DeviceSerializable
      include DeviceFilterable

      # A ceiling on ONE request, not a business rule (SoT F6 OQ-2): the write
      # runs synchronously inside the request, so the payload has to stay
      # bounded. Measured before anything else touches the database — see
      # #create step 2.
      MAX_DEVICE_IDS_PER_REQUEST = 500

      DEVICE_IDS_BLANK_MESSAGE = "Chọn ít nhất một thiết bị".freeze
      DEVICE_IDS_CAP_MESSAGE = "Chọn tối đa #{MAX_DEVICE_IDS_PER_REQUEST} thiết bị mỗi lần".freeze
      NO_VALID_DEVICES_MESSAGE = "Không có thiết bị hợp lệ nào được chọn".freeze
      RETIRED_BATCH_PREFIX = "#{Device::RETIRED_GROUP_MESSAGE}: ".freeze

      # GET /api/v1/groups/:id/devices — docs/design/F6-api.md §2.2.
      def index
        group = policy_scope(Group).find(params[:id])
        authorize group, :show?

        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        errors = filter_errors
        return render_validation_errors(errors) if errors.any?

        scope = member_scope(group)
        # Counted on the group-scoped, org-scoped, filtered relation and
        # *before* limit/offset — a 10.000-member group must never be loaded
        # into Ruby just to be sized (SoT F6 A17).
        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        render json: {
          # serialize_device only — no `groups` key per row, which is what
          # separates this from DevicesController#show: one extra query per
          # row here would be an N+1 20 rows wide (plan F6 "Bẫy #5").
          devices: records.map { |device| serialize_device(device) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      # POST /api/v1/groups/:id/devices — docs/design/F6-api.md §2.3.
      #
      # Strictly ordered, each step refusing before the next one costs
      # anything:
      #   1. shape of device_ids, on the RAW param;
      #   2. the 500 cap, also on the raw array — measuring it after the
      #      org filter would let a 100.000-element array of junk ids sail
      #      past the cap and be rejected two steps later, having already
      #      paid for the coercion and the query (plan F6 "Bẫy #4");
      #   3. coerce + org-filter, dropping unknown/foreign ids in silence
      #      (SoT F6 A10 — reporting them would reveal what exists in another
      #      organization);
      #   4. nothing survived the filter;
      #   5. any retired device in the batch rejects the WHOLE batch;
      #   6. one idempotent write.
      def create
        # Before params, always: a group from another org must not be able to
        # tell a well-formed body from a malformed one (SoT F6 A3).
        group = policy_scope(Group).find(params[:id])
        authorize group, :add_devices?

        raw_ids = params[:device_ids]
        return render_validation_errors(device_ids: [ DEVICE_IDS_BLANK_MESSAGE ]) unless raw_ids.is_a?(Array) && raw_ids.present?
        return render_validation_errors(device_ids: [ DEVICE_IDS_CAP_MESSAGE ]) if raw_ids.size > MAX_DEVICE_IDS_PER_REQUEST

        valid_ids = org_device_ids(raw_ids)
        return render_validation_errors(device_ids: [ NO_VALID_DEVICES_MESSAGE ]) if valid_ids.empty?

        retired_identifiers = current_organization.devices.where(id: valid_ids, status: :retired).order(:identifier).pluck(:identifier)
        # Atomic reject, NOT "skip the retired ones and add the rest" (SoT F6
        # OQ-3/A8): the caller asked for a specific set, and silently adding
        # part of it would leave them believing the retired devices got in.
        # Ordered by identifier so the message is deterministic rather than
        # whatever order Postgres felt like returning.
        if retired_identifiers.any?
          return render_validation_errors(base: [ "#{RETIRED_BATCH_PREFIX}#{retired_identifiers.join(', ')}" ])
        end

        added_count = valid_ids.size - existing_member_ids(group, valid_ids).size
        upsert_memberships(group, valid_ids)

        # Recomputed from the database rather than added to a previous total:
        # devices_count is then a pure function of current state, correct even
        # when two concurrent requests both believed they added the same
        # device (docs/design/F6-api.md §2.3).
        render json: { added_count: added_count, devices_count: group.devices.count }
      end

      # DELETE /api/v1/groups/:id/devices/:device_id — docs/design/F6-api.md §2.4.
      def destroy
        group = policy_scope(Group).find(params[:id])
        authorize group, :remove_device?

        membership = GroupMembership.find_by(group_id: group.id, device_id: params[:device_id])
        # Never a member, or already removed by another request — both are
        # "there is nothing here", both 404 (SoT F6 A14, A16).
        return render_not_found if membership.nil?

        # "Retired bất biến" covers removal too, not just addition (SoT F6 A9
        # — a retired device stays stuck in its groups, an accepted
        # consequence recorded in SoT §12). Checked BEFORE the delete, so a
        # refused request changes nothing.
        if membership.device.retired?
          return render_validation_errors(base: [ Device::RETIRED_GROUP_MESSAGE ])
        end

        # `delete_all` rather than `membership.destroy!` purely to learn how
        # many rows this statement actually removed (docs/design/F6-api.md §5
        # OQ-API-2). Under a real double-click both requests can pass the
        # find_by above; `destroy!` would then report success twice for one
        # deletion, while a zero row count here correctly becomes the second
        # request's 404 (SoT F6 A16: exactly one effect).
        deleted_count = GroupMembership.where(id: membership.id).delete_all
        return render_not_found if deleted_count.zero?

        head :no_content
      end

      private

      def member_scope(group)
        # `.merge(current_organization.devices)` is a deliberate second layer:
        # group_memberships carries no org-match validation (F6-db.md §1b), so
        # the organization boundary is re-applied at read time instead of
        # trusting what write time promised (CLAUDE.md §4). Same SQL, one more
        # indexed condition.
        scope = group.devices.merge(current_organization.devices)
        scope = scope.where(platform: params[:platform]) if params[:platform].present?
        scope = scope.where(status: params[:status]) if params[:status].present?
        # devices.created_at, NOT group_memberships.created_at — decided at
        # docs/design/F6-db.md §4a so the members tab reads like the device
        # list it mirrors.
        scope.order(created_at: :desc, id: :desc)
      end

      # Integer(..., 10, exception: false), never String#to_i: "12abc".to_i
      # would quietly become 12 (same rule as Paginatable). Anything that
      # isn't a plain decimal integer, and every id outside this
      # organization, simply disappears here — no per-id error, by design.
      def org_device_ids(raw_ids)
        coerced_ids = raw_ids.filter_map { |value| Integer(value.to_s, 10, exception: false) }
        return [] if coerced_ids.empty?

        current_organization.devices.where(id: coerced_ids).pluck(:id)
      end

      # Snapshot taken before the write so added_count reports only the rows
      # this request is about to create (SoT F6 A6/A7: re-adding an existing
      # member is a successful no-op, not an increment).
      def existing_member_ids(group, device_ids)
        GroupMembership.where(group_id: group.id, device_id: device_ids).pluck(:device_id)
      end

      # ONE statement, idempotent, no manual transaction needed.
      # `on_duplicate: :skip` (ON CONFLICT DO NOTHING) leaves rows that
      # already exist completely untouched — not even updated_at is bumped —
      # which is both the literal reading of "calling it again has no extra
      # effect" and consistent with the decision not to `touch:` anything
      # (docs/design/F6-db.md §4a). It also means two concurrent requests
      # adding the same pair both succeed with exactly one row created, the
      # unique index doing the arbitration inside the DB (SoT F6 A15).
      #
      # Everything above this line exists because upsert_all bypasses every
      # validation and callback GroupMembership declares.
      def upsert_memberships(group, device_ids)
        now = Time.current
        rows = device_ids.map { |device_id| { group_id: group.id, device_id: device_id, created_at: now, updated_at: now } }

        GroupMembership.upsert_all(rows, unique_by: [ :group_id, :device_id ], on_duplicate: :skip)
      end
    end
  end
end
