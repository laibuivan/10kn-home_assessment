# Shared platform/status enum validation for every endpoint that filters a
# device list (docs/design/F6-api.md §5 OQ-API-1, approved option (a)).
#
# Extracted verbatim from Api::V1::DevicesController (F2) when
# Api::V1::GroupDevicesController#index needed the same two filters. The point
# is to keep an unknown enum string from reaching ActiveRecord, where it would
# raise ArgumentError (a 500) instead of becoming a field-level 422
# (docs/design/F2-db.md §1b) — and to keep ENUM_ERROR spelled the same way in
# both controllers, which is exactly the drift Paginatable was extracted to
# prevent at F5.
module DeviceFilterable
  extend ActiveSupport::Concern

  ENUM_ERROR = "is not included in the list".freeze

  private

  # Both filters are reported together rather than failing on the first
  # (field-level error convention, docs/design/F0-api.md §0).
  def filter_errors
    errors = {}
    errors[:platform] = [ ENUM_ERROR ] if invalid_enum?(params[:platform], Device.platforms.keys)
    errors[:status] = [ ENUM_ERROR ] if invalid_enum?(params[:status], Device.statuses.keys)
    errors
  end

  # Absent (or blank) means "no filter", never an error — only a value that is
  # actually there and isn't one of the enum's keys is rejected.
  def invalid_enum?(value, allowed)
    value.present? && !value.in?(allowed)
  end
end
