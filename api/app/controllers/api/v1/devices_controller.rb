module Api
  module V1
    # GET /api/v1/devices — docs/design/F2-api.md §2.
    #
    # Read-only list: validate the request shape first (never let an unknown
    # enum string reach ActiveRecord, where it would raise ArgumentError
    # instead of becoming a 422 — F2-db.md §1b), then query through the
    # Pundit scope, which is the only place the Organization boundary is
    # applied.
    class DevicesController < ApplicationController
      include Authenticatable

      # A11/A12 (SoT F3 §11) — race-condition duplicate identifiers land here
      # as a DB-level unique-index violation rather than the app-level
      # uniqueness validate (whichever request loses the race never gets to
      # see its own EXISTS check fail first). Scoped locally, not on
      # ApplicationController: the message is Device-specific semantics, not
      # a generic resource concern (docs/design/F3-api.md §5).
      rescue_from ActiveRecord::RecordNotUnique, with: :render_identifier_taken

      DEFAULT_PAGE = 1
      DEFAULT_PER_PAGE = 20
      MAX_PER_PAGE = 100

      PAGINATION_ERROR = "must be a positive integer".freeze
      ENUM_ERROR = "is not included in the list".freeze

      def index
        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        errors = filter_errors
        return render_validation_errors(errors) if errors.any?

        authorize Device

        scope = filtered_scope
        # Counted on the filtered, org-scoped relation and *before* any
        # limit/offset — so the total can never include another org's rows
        # (SoT F2 §5.2 A9) nor shrink to the current page's size.
        total_count = scope.count
        # A page past the end needs no special case: OFFSET simply returns
        # no rows, which is exactly the decided behaviour (200 + empty).
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

      # POST /api/v1/devices — docs/design/F3-api.md §2.1.
      #
      # Never permits status/organization_id: the created record is always
      # current_organization.devices.build(...) with status left at its
      # column default (active) — the only defense needed for A9/OQ-2.
      def create
        errors = {}
        errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(create_params[:platform], Device.platforms.keys)
        return render_validation_errors(errors) if errors.any?

        authorize Device

        device = current_organization.devices.build(create_params)
        if device.save
          render json: { device: serialize_device(device) }, status: :created
        else
          render_validation_errors(device.errors.messages)
        end
      end

      # PATCH /api/v1/devices/:id — docs/design/F3-api.md §2.2.
      #
      # Record is found through the Pundit scope, so a cross-org id raises
      # ActiveRecord::RecordNotFound (rescued globally into a 404 — never a
      # 403, CLAUDE.md §4) before authorize even runs.
      def update
        device = policy_scope(Device).find(params[:id])
        authorize device

        errors = {}
        errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(update_params[:platform], Device.platforms.keys)
        errors[:status] = [ ENUM_ERROR ] if invalid_enum?(update_params[:status], Device.statuses.keys)
        return render_validation_errors(errors) if errors.any?

        if device.update(update_params)
          render json: { device: serialize_device(device) }
        else
          render_validation_errors(device.errors.messages)
        end
      end

      private

      # Both pagination params are reported together rather than failing on
      # the first one (field-level error convention, F0-api.md §0).
      def pagination_errors
        errors = {}
        errors[:page] = [ PAGINATION_ERROR ] unless valid_pagination_param?(params[:page])
        errors[:per_page] = [ PAGINATION_ERROR ] unless valid_pagination_param?(params[:per_page])
        errors
      end

      def filter_errors
        errors = {}
        errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(params[:platform], Device.platforms.keys)
        errors[:status] = [ ENUM_ERROR ] if invalid_enum?(params[:status], Device.statuses.keys)
        errors
      end

      def invalid_enum?(value, allowed)
        value.present? && !value.in?(allowed)
      end

      # Request body is flat (no `device:` wrapper) — docs/design/F3-api.md §0.
      def create_params
        params.permit(:identifier, :name, :platform, :os_version)
      end

      def update_params
        params.permit(:name, :platform, :os_version, :status)
      end

      def render_identifier_taken
        render_validation_errors(identifier: [ Device::IDENTIFIER_TAKEN_MESSAGE ])
      end

      # Absent (or blank) means "use the default" — only a value that is
      # actually there and isn't a positive integer is an error.
      def valid_pagination_param?(raw)
        raw.blank? || !coerce_positive_integer(raw).nil?
      end

      # Integer(..., exception: false), never String#to_i: "12abc".to_i
      # would quietly become 12 and "abc".to_i a 0 (F2-api.md §2 step 2).
      # Base 10 is explicit: without it, Integer() infers the base from the
      # string itself, so "010" silently parses as octal 8, "0x1A" as hex 26,
      # and a leading-zero decimal like "09" (invalid octal digit) raises
      # instead of just being nine — none of which is "a positive integer"
      # in the plain decimal sense the API contract promises.
      def coerce_positive_integer(raw)
        return nil if raw.blank?

        value = Integer(raw.to_s, 10, exception: false)
        value if value&.positive?
      end

      def page
        @page ||= coerce_positive_integer(params[:page]) || DEFAULT_PAGE
      end

      # Clamped silently, not rejected: a client asking for everything at
      # once gets the maximum, not an error (SoT F2 §12 OQ-1).
      def per_page
        @per_page ||= [ coerce_positive_integer(params[:per_page]) || DEFAULT_PER_PAGE, MAX_PER_PAGE ].min
      end

      def filtered_scope
        scope = policy_scope(Device)
        scope = scope.where(platform: params[:platform]) if params[:platform].present?
        scope = scope.where(status: params[:status]) if params[:status].present?
        scope.order(created_at: :desc, id: :desc)
      end

      def total_pages(total_count)
        total_count.zero? ? 0 : (total_count.to_f / per_page).ceil
      end

      def serialize_device(device)
        {
          id: device.id,
          identifier: device.identifier,
          name: device.name,
          platform: device.platform,
          os_version: device.os_version,
          status: device.status,
          last_seen_at: device.last_seen_at,
          created_at: device.created_at,
          updated_at: device.updated_at
        }
      end
    end
  end
end
