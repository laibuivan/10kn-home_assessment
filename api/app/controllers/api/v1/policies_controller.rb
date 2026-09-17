module Api
  module V1
    # Policy CRUD — docs/design/F7-api.md §2.
    #
    # Only three actions (`index`/`create`/`update`) — no `show`, no
    # `destroy` (SoT F7 OQ-2, OQ-7). Two things make F7 different from
    # Device/Group:
    #   1. `status` is a Rails enum on BOTH sides — filter (GET) and write
    #      (POST/PATCH) — so `invalid_status?` must run before any
    #      `.where`/`.build`/`.update` touches ActiveRecord, or an
    #      out-of-enum string raises ArgumentError (500), not a validation
    #      error (docs/design/F7-db.md §1c).
    #   2. `configuration` is free-form jsonb — see `build_policy_params`/
    #      `configuration_param` below, the single most error-prone part of
    #      F7 (docs/design/F7-api.md §2.4).
    class PoliciesController < ApplicationController
      include Authenticatable
      include Paginatable

      # Same wording as DeviceFilterable::ENUM_ERROR (UX consistency), declared
      # separately on purpose (docs/design/F7-api.md §2.6).
      STATUS_ENUM_ERROR = "is not included in the list".freeze

      # A7/A9 (SoT F7 §5.2) — the loser of a create/rename race never sees its
      # own uniqueness check fail, it hits the composite unique index instead.
      # Rescued into the same 422 field error the app-level validation
      # produces, using the same constant, so a client cannot tell the two
      # apart. Scoped locally, not on ApplicationController: the message is
      # Policy-specific semantics (docs/design/F3-api.md §5 precedent).
      rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken

      # GET /api/v1/policies — docs/design/F7-api.md §2.1.
      def index
        errors = pagination_errors
        errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(params[:status])
        return render_validation_errors(errors) if errors.any?

        authorize Policy

        scope = filtered_scope
        # Counted on the org-scoped, q/status-filtered relation and *before*
        # any limit/offset.
        total_count = scope.count
        records = scope.offset((page - 1) * per_page).limit(per_page)

        # ONE grouped COUNT for the whole page (F8 — docs/design/F8-api.md
        # §2.1), never `policy.policy_assignments.count` inside the map —
        # that would be an N+1 that grows with per_page (same trap as
        # devices_count in GroupsController#index). A policy with zero rows
        # in policy_assignments simply doesn't appear in the hash, hence
        # fetch(id, 0) — A32.
        assignments_counts = PolicyAssignment
          .where(organization_id: current_organization.id, policy_id: records.map(&:id))
          .group(:policy_id).count

        render json: {
          policies: records.map do |policy|
            serialize_policy(policy, assignments_count: assignments_counts.fetch(policy.id, 0))
          end,
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      # GET /api/v1/policies/:id — docs/design/F8-api.md §2.2 (F7 OQ-7).
      #
      # Found through the Pundit scope, so a cross-org id, a nonexistent id
      # or a malformed id all raise ActiveRecord::RecordNotFound (rescued
      # globally into a 404 — never a 403) before authorize even runs (S26,
      # A27).
      def show
        policy = policy_scope(Policy).find(params[:id])
        authorize policy

        render json: { policy: serialize_policy(policy) }
      end

      # POST /api/v1/policies — docs/design/F7-api.md §2.2.
      def create
        authorize Policy

        errors = {}
        errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(create_params[:status])
        return render_validation_errors(errors) if errors.any?

        # Built off current_organization.policies, so organization_id always
        # comes from the token; strong params refusing :organization_id is
        # the second, independent layer (A28).
        policy = current_organization.policies.build(create_params)
        if policy.save
          render json: { policy: serialize_policy(policy) }, status: :created
        else
          render_validation_errors(policy.errors.messages)
        end
      end

      # PATCH /api/v1/policies/:id — docs/design/F7-api.md §2.3.
      def update
        # Found through the Pundit scope, so a cross-org id, a nonexistent id
        # or a malformed id all raise ActiveRecord::RecordNotFound (rescued
        # globally into a 404 — never a 403) before authorize even runs
        # (A1–A3).
        policy = policy_scope(Policy).find(params[:id])
        authorize policy

        errors = {}
        errors[:status] = [ STATUS_ENUM_ERROR ] if invalid_status?(update_params[:status])
        return render_validation_errors(errors) if errors.any?

        if policy.update(update_params)
          render json: { policy: serialize_policy(policy) }
        else
          render_validation_errors(policy.errors.messages)
        end
      end

      private

      def filtered_scope
        scope = policy_scope(Policy)
        scope = scope.where("name ILIKE ?", "%#{Policy.sanitize_sql_like(search_term)}%") if search_term.present?
        # Safe by this point: the guard above already ensured params[:status]
        # is either blank or one of Policy.statuses.keys — no more
        # ArgumentError risk.
        scope = scope.where(status: params[:status]) if params[:status].present?
        scope.order(created_at: :desc, id: :desc)
      end

      # Blank / whitespace-only means "no filter", never an error — there is
      # no 422 branch for q at all (docs/design/F7-api.md §2.1).
      def search_term
        @search_term ||= params[:q].to_s.strip
      end

      # `Policy.statuses` has exactly one field to guard (unlike Device's
      # platform+status pair) — defined locally rather than reused/extended
      # from DeviceFilterable, which is named and documented specifically for
      # Device (docs/design/F7-api.md §2.6).
      def invalid_status?(value)
        value.present? && !value.to_s.in?(Policy.statuses.keys)
      end

      # Request body is flat (no `policy:` wrapper) — docs/design/F7-api.md
      # §0. Deliberately never permits :organization_id/:id/timestamps.
      def create_params
        build_policy_params
      end

      # Same permitted set as create_params — both actions in F7 accept
      # exactly the same four fields, no action-specific field exists yet
      # (docs/design/F7-api.md §2.7).
      def update_params
        build_policy_params
      end

      # Scalar fields go through permit normally; `configuration` is taken
      # manually AND only added to the result hash when the client actually
      # sent this key — that distinction is what makes a PATCH that omits
      # `configuration` (leave it alone) different from a PATCH that sends it
      # with the wrong type (422), per docs/design/F7-api.md §2.4.
      def build_policy_params
        attrs = params.permit(:name, :type, :status).to_h.symbolize_keys
        attrs[:configuration] = configuration_param if params.key?(:configuration)
        attrs
      end

      # `to_unsafe_h`, not `permit(configuration: {})`: this value is never
      # used to mass-assign any other field/association, it goes straight
      # into exactly one jsonb column and stops — the mass-assignment risk
      # strong params exists to prevent (assigning an unexpected field via a
      # side door) does not apply here. If the value is not a Hash (Array,
      # String, Numeric, nil), it is returned as-is so the model validator
      # catches the error on the `configuration` field instead of this layer
      # silently "fixing" it (docs/design/F7-api.md §2.4, OQ-API-1).
      def configuration_param
        raw = params[:configuration]
        raw.is_a?(ActionController::Parameters) ? raw.to_unsafe_h : raw
      end

      def render_name_taken
        render_validation_errors(name: [ Policy::NAME_TAKEN_MESSAGE ])
      end

      # 8 fields since F8 — `assignments_count` pays F7's OQ-6 carry-over
      # debt (docs/design/F8-api.md §2.3). Still no organization_id (client
      # only ever has one). The default argument is only evaluated when the
      # caller omits it — #index always passes a value from its one grouped
      # COUNT above, so `policy.policy_assignments.count` below only runs
      # for the single-record responses (show/create/update), one COUNT
      # each — same pattern as GroupsController#serialize_group.
      def serialize_policy(policy, assignments_count: policy.policy_assignments.count)
        {
          id: policy.id,
          name: policy.name,
          type: policy.type,
          configuration: policy.configuration,
          status: policy.status,
          assignments_count: assignments_count,
          created_at: policy.created_at,
          updated_at: policy.updated_at
        }
      end
    end
  end
end
