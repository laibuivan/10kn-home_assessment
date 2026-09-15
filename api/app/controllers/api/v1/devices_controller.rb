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
