# Shared auth middleware — every controller from F2+ onward includes this
# and relies on current_user/current_organization. See docs/design/F0-api.md
# §3 for the full contract this implements.
module Authenticatable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate_request!
    attr_reader :current_user, :current_organization
  end

  private

  def authenticate_request!
    token = bearer_token
    payload = token && JsonWebToken.decode(token)
    return render_unauthorized unless payload

    # Always reload from DB — never trust the claim alone. This is what
    # makes deactivating a user take effect immediately even against a
    # token that hasn't expired yet (SoT F0-foundation.md §5.2 A6, §6).
    user = User.find_by(id: payload[:user_id])
    return render_unauthorized unless user&.active?

    @current_user = user
    @current_organization = user.organization
  end

  def bearer_token
    header = request.headers["Authorization"]
    header&.start_with?("Bearer ") ? header.delete_prefix("Bearer ") : nil
  end

  def render_unauthorized
    render json: { error: "Unauthorized" }, status: :unauthorized
  end
end
