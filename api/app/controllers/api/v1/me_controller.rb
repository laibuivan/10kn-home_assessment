module Api
  module V1
    class MeController < ApplicationController
      include Authenticatable

      def show
        render json: {
          user: { id: current_user.id, email: current_user.email },
          organization: { id: current_organization.id, name: current_organization.name }
        }
      end
    end
  end
end
