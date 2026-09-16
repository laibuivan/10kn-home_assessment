module Api
  module V1
    # Group CRUD — docs/design/F5-api.md §2.
    #
    # Five endpoints since F6 added `show` for the Group detail screen (F5
    # had none — SoT F5 OQ-5 judged it dead weight while the edit form was
    # the only consumer). Every action
    # reaches its records through Pundit — `policy_scope(Group)` for reads and
    # `current_organization.groups.build` for writes — so the Organization
    # boundary is applied in exactly one place and a cross-org id 404s instead
    # of 403ing (CLAUDE.md §4: never reveal that another org's record exists).
    class GroupsController < ApplicationController
      include Authenticatable
      include Paginatable

      # A7 (SoT F5 §5.2) — two requests creating (or renaming to) the same
      # name in the same org at the same time: the loser never sees its own
      # uniqueness EXISTS check fail, it hits the composite unique index
      # instead. Rescued into the *same* 422 field error the app-level
      # validation produces, using the same constant, so a client cannot tell
      # the two apart. Scoped locally, not on ApplicationController: the
      # message is Group-specific semantics (docs/design/F3-api.md §5).
      rescue_from ActiveRecord::RecordNotUnique, with: :render_name_taken

      # GET /api/v1/groups — docs/design/F5-api.md §2.1.
      def index
        errors = pagination_errors
        return render_validation_errors(errors) if errors.any?

        authorize Group

        scope = filtered_scope
        # Counted on the org-scoped, q-filtered relation and *before* any
        # limit/offset, so the total can neither include another org's rows
        # nor shrink to the current page's size.
        total_count = scope.count
        # A page past the end needs no special case: OFFSET simply returns no
        # rows, which is exactly the decided behaviour (200 + empty, A16).
        records = scope.offset((page - 1) * per_page).limit(per_page)

        # ONE grouped COUNT for the whole page, never `group.devices.count`
        # inside the map — that would be an N+1 that grows with per_page
        # (docs/design/F6-api.md §2.7, plan F6 "Bẫy #5"). Groups with no
        # members simply don't appear in the result, hence fetch(id, 0).
        devices_counts = GroupMembership.where(group_id: records.map(&:id)).group(:group_id).count

        render json: {
          groups: records.map { |group| serialize_group(group, devices_count: devices_counts.fetch(group.id, 0)) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: total_pages(total_count)
          }
        }
      end

      # GET /api/v1/groups/:id — docs/design/F6-api.md §2.1.
      #
      # Found through the Pundit scope, so a cross-org id, a nonexistent id or
      # a malformed id all raise ActiveRecord::RecordNotFound (rescued
      # globally into a 404 — never a 403) before authorize even runs
      # (SoT F6 A1, A5).
      def show
        group = policy_scope(Group).find(params[:id])
        # Explicit query: Api::V1::GroupDevicesController#index authorizes the
        # very same :show? on its own action named `index`, so spelling it out
        # here keeps both call sites asking the same question by name rather
        # than by whichever action happens to be running
        # (docs/design/F6-api.md §1).
        authorize group, :show?

        render json: { group: serialize_group(group) }
      end

      # POST /api/v1/groups — docs/design/F5-api.md §2.2.
      #
      # Built off current_organization.groups, so organization_id always comes
      # from the token; strong params refusing :organization_id is the second,
      # independent layer (A22).
      def create
        authorize Group

        group = current_organization.groups.build(create_params)
        if group.save
          render json: { group: serialize_group(group) }, status: :created
        else
          render_validation_errors(group.errors.messages)
        end
      end

      # PATCH /api/v1/groups/:id — docs/design/F5-api.md §2.3.
      #
      # Found through the Pundit scope, so a cross-org id, a nonexistent id or
      # a malformed id all raise ActiveRecord::RecordNotFound (rescued
      # globally into a 404 — never a 403) before authorize even runs
      # (A1–A3, A12).
      def update
        group = policy_scope(Group).find(params[:id])
        authorize group

        if group.update(update_params)
          render json: { group: serialize_group(group) }
        else
          render_validation_errors(group.errors.messages)
        end
      end

      # DELETE /api/v1/groups/:id — docs/design/F5-api.md §2.4.
      #
      # MUST be `destroy!`, NEVER `delete`/`delete_all` (docs/design/F5-db.md
      # §4a — "the biggest trap of this feature"):
      #   * `#delete` fires a single DELETE and skips every `dependent:`
      #     association. Today `Group` has none, so `delete` would look
      #     perfectly correct and every F5 test would still pass — but the
      #     moment F6/F8 add `has_many :group_memberships/:policy_assignments,
      #     dependent: :delete_all`, it would silently orphan join rows and
      #     break the heaviest invariant in CLAUDE.md §4, with the bug
      #     introduced here at F5. `destroy!` needs no change when those
      #     associations arrive.
      #   * `#destroy` already wraps the dependent cleanup and the parent
      #     DELETE in one transaction, so no manual
      #     ActiveRecord::Base.transaction here (A13: a mid-flight failure
      #     rolls back and leaves the group intact).
      #   * bang form on purpose: nothing can abort this destroy today, so an
      #     `if group.destroy` branch would be untestable dead code — but
      #     ignoring the return value would answer 204 while deleting nothing.
      #     `destroy!` raises loudly (500) the day a guard is added, instead of
      #     lying. Whoever adds that guard owes an explicit 422 branch here.
      def destroy
        group = policy_scope(Group).find(params[:id])
        authorize group

        group.destroy!
        # 204 with an empty body: the resource is gone, so echoing it back
        # would only confuse; the client always refetches the list anyway.
        head :no_content
      end

      private

      def filtered_scope
        scope = policy_scope(Group)
        scope = scope.where("name ILIKE ?", "%#{Group.sanitize_sql_like(search_term)}%") if search_term.present?
        scope.order(created_at: :desc, id: :desc)
      end

      # Blank / whitespace-only means "no filter", never an error — there is
      # no 422 branch for q at all (docs/design/F5-api.md §3).
      def search_term
        @search_term ||= params[:q].to_s.strip
      end

      # Request body is flat (no `group:` wrapper) — docs/design/F5-api.md §0.
      # Deliberately never permits :organization_id/:id/timestamps.
      def create_params
        params.permit(:name, :description)
      end

      # Same list as create_params today, kept as a separate method on
      # purpose: F6/F8 are likely to permit action-specific fields, and
      # merging now would only mean splitting later
      # (docs/design/F5-api.md §2.3).
      def update_params
        params.permit(:name, :description)
      end

      def render_name_taken
        render_validation_errors(name: [ Group::NAME_TAKEN_MESSAGE ])
      end

      # Exactly six fields since F6 — still no organization_id (the client only
      # ever has one, and returning it hints it could be changed), now always
      # devices_count so a group has ONE shape across index/show/create/update
      # and the frontend never has to handle two (docs/design/F6-api.md §1).
      #
      # The default argument is only evaluated when the caller omits it, which
      # is what makes this safe: #index always passes a value from its single
      # grouped COUNT, so the per-record `group.devices.count` below runs only
      # for the single-record responses (show/create/update), one COUNT each.
      def serialize_group(group, devices_count: group.devices.count)
        {
          id: group.id,
          name: group.name,
          description: group.description,
          devices_count: devices_count,
          created_at: group.created_at,
          updated_at: group.updated_at
        }
      end
    end
  end
end
