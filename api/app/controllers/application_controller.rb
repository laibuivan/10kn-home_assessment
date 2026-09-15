class ApplicationController < ActionController::API
  # Authorization for every resource controller from F2 on — `authorize` /
  # `policy_scope` (docs/design/F2-api.md §5). No rescue_from for
  # Pundit::NotAuthorizedError yet: no policy can deny anything today, so a
  # handler would be untested dead code — F3 adds it with the first real
  # rule (docs/plan/F2-device-list.md, Rủi ro).
  include Pundit::Authorization

  # Consistent error shape for the whole API (docs/design/F0-api.md §0):
  # 404 for "not found or not yours" (never 403 — see CLAUDE.md §4, org-scope
  # must not leak whether a resource exists in another Organization).
  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
  rescue_from ActionController::ParameterMissing, with: :render_bad_request

  private

  def render_not_found
    render json: { error: "Not found" }, status: :not_found
  end

  def render_bad_request(exception)
    render json: { error: exception.message }, status: :bad_request
  end

  # Shared field-level 422 envelope (docs/design/F0-api.md §0:
  # `{"errors": {"<field>": ["<message>"]}}`) — every controller that
  # validates request shape before querying (DevicesController today, more
  # resource controllers from F3 on) renders through this one method so the
  # shape can't drift between them.
  def render_validation_errors(errors)
    render json: { errors: errors }, status: :unprocessable_content
  end
end
