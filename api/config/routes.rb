Rails.application.routes.draw do
  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      resources :sessions, only: [ :create ]
      resource :me, only: [ :show ], controller: "me"
      resources :devices, only: [ :index, :show, :create, :update ] do
        member do
          # F9 — docs/design/F9-api.md §1. `member do`, not a nested
          # `resources :applied_policies` — keeps params[:id] meaning
          # Device (same reasoning as :groups/:policies member routes
          # above), and OQ-2 wants this endpoint tested/loaded separately
          # from GET /devices/:id (independent loading/error state, F4 §12).
          get "applied_policies", to: "device_applied_policies#index"
        end
      end
      # `member do ... end`, not a nested `resources :devices` — the nested
      # form would rename the Group param to :group_id, while the contract
      # (SoT F6 §8, docs/design/F6-api.md §1) is `groups/:id/devices` and
      # `groups/:id/devices/:device_id`.
      resources :groups, only: [ :index, :show, :create, :update, :destroy ] do
        member do
          get "devices", to: "group_devices#index"
          post "devices", to: "group_devices#create"
          delete "devices/:device_id", to: "group_devices#destroy"

          # F8 — docs/design/F8-api.md §1.
          get "policy_assignments", to: "group_policy_assignments#index"
          post "policy_assignments", to: "group_policy_assignments#create"
          delete "policy_assignments/:policy_id", to: "group_policy_assignments#destroy"
          get "policy_assignment_jobs", to: "group_policy_assignment_jobs#index"
        end
      end
      # `:show` MỞ LẠI ở đây (F8 SoT §3 — F7 OQ-2/OQ-7 từng chốt không có).
      # Toàn bộ phân tích "404 qua routing" ở docs/design/F7-api.md §2.5 hết
      # hiệu lực từ đây, thay bằng 404 qua policy_scope(Policy).find như mọi
      # action khác.
      resources :policies, only: [ :index, :show, :create, :update ] do
        member do
          get "device_assignments", to: "policy_device_assignments#index"
          post "device_assignments", to: "policy_device_assignments#create"
          delete "device_assignments/:device_id", to: "policy_device_assignments#destroy"
          get "group_assignments", to: "policy_group_assignments#index"
        end
      end
      # Đứng độc lập — không nested dưới /groups hay /policies (SoT §3: poll
      # bằng chính job_id, không cần biết trước group/policy nào).
      resources :policy_assignment_jobs, only: [ :show ]
    end
  end
end
