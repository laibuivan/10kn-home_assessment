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
      include Paginatable
      # serialize_device / filter_errors + ENUM_ERROR live in concerns since
      # F6: Api::V1::GroupDevicesController lists devices too, and two copies
      # of either would drift (docs/design/F6-api.md §5 OQ-API-1).
      include DeviceSerializable
      include DeviceFilterable

      # A11/A12 (SoT F3 §11) — race-condition duplicate identifiers land here
      # as a DB-level unique-index violation rather than the app-level
      # uniqueness validate (whichever request loses the race never gets to
      # see its own EXISTS check fail first). Scoped locally, not on
      # ApplicationController: the message is Device-specific semantics, not
      # a generic resource concern (docs/design/F3-api.md §5).
      rescue_from ActiveRecord::RecordNotUnique, with: :render_identifier_taken

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

      # GET /api/v1/devices/:id — docs/design/F4-api.md §2.1.
      #
      # Record is found through the Pundit scope, so a cross-org id, a
      # nonexistent id, or a malformed id all raise
      # ActiveRecord::RecordNotFound (rescued globally into a 404 — never a
      # 403, CLAUDE.md §4) before authorize even runs — confirmed by direct
      # experiment that a non-integer id never reaches the DB as raw SQL
      # (F4-db.md §4), so no extra guard is needed here.
      def show
        device = policy_scope(Device).find(params[:id])
        authorize device

        # Viewing the detail page counts as "seen" (F4 follow-up, DESIGN.md
        # §AI) — no-op for a retired device (CLAUDE.md §4 "retired bất
        # biến"), so the response always reflects the actually-persisted value.
        device.record_seen!

        # The ONLY response carrying `groups` (docs/design/F6-api.md §2.6):
        # one device means one extra join query, while adding it to #index
        # would mean one per row. `.merge(current_organization.groups)` is a
        # deliberate second layer — group_memberships has no org-match
        # validation (F6-db.md §1b), so read time must not simply trust what
        # write time promised (CLAUDE.md §4). Ordered by name so the list is
        # stable between requests; `[]`, never null, when the device belongs
        # to no group (SoT F6 A25).
        render json: {
          device: serialize_device(device).merge(
            groups: device.groups.merge(current_organization.groups).order(:name).map { |group| { id: group.id, name: group.name } }
          )
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

      def filtered_scope
        scope = policy_scope(Device)
        scope = scope.where(platform: params[:platform]) if params[:platform].present?
        scope = scope.where(status: params[:status]) if params[:status].present?
        # `q` (F6) — the device picker in "+ Thêm device vào group" searches
        # through this same endpoint (docs/design/F6-api.md §2.5). One named
        # placeholder used twice, so the escaped pattern can't be built two
        # slightly different ways; sanitize_sql_like keeps a user-typed % or _
        # a literal character instead of a wildcard.
        scope = scope.where("identifier ILIKE :q OR name ILIKE :q", q: "%#{Device.sanitize_sql_like(search_term)}%") if search_term.present?
        scope.order(created_at: :desc, id: :desc)
      end

      # Blank / whitespace-only means "no filter", never an error — there is
      # no 422 branch for q at all (docs/design/F6-api.md §2.5, same rule the
      # Group search settled at F5).
      def search_term
        @search_term ||= params[:q].to_s.strip
      end
    end
  end
end
