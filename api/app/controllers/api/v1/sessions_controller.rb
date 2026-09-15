module Api
  module V1
    # Public — does NOT include Authenticatable (that would require a token
    # to... get a token). See docs/design/F0-api.md §2.
    class SessionsController < ApplicationController
      GENERIC_LOGIN_ERROR = "Email hoặc mật khẩu không đúng.".freeze

      def create
        email = params[:email].to_s.strip.downcase
        password = params[:password].to_s

        if email.blank? || password.blank?
          return render json: { errors: blank_field_errors(email, password) }, status: :unprocessable_content
        end

        user = authenticate_candidate(email, password)

        unless user&.active?
          # Same message for: no such email, wrong password, and inactive
          # account — SoT F0-foundation.md §12 OQ-1 (avoid user enumeration).
          return render json: { error: GENERIC_LOGIN_ERROR }, status: :unauthorized
        end

        token = JsonWebToken.encode(user_id: user.id, organization_id: user.organization_id)
        render json: {
          token: token,
          user: { id: user.id, email: user.email },
          organization: { id: user.organization.id, name: user.organization.name }
        }, status: :created
      end

      private

      # Email is unique per-Organization, not globally (PRD) — so a login
      # can match >1 User row. Try each by id ASC, first whose password
      # matches wins (deterministic; doesn't depend on DB row order). See
      # docs/design/F0-api.md §2 step 3 and SoT §12 OQ-2.
      def authenticate_candidate(email, password)
        User.where(email: email).order(:id).find { |candidate| candidate.authenticate(password) }
      end

      def blank_field_errors(email, password)
        {}.tap do |errors|
          errors[:email] = [ "can't be blank" ] if email.blank?
          errors[:password] = [ "can't be blank" ] if password.blank?
        end
      end
    end
  end
end
