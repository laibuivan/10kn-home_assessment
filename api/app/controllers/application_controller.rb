class ApplicationController < ActionController::API
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
end
