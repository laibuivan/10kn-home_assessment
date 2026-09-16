# The one and only shape a Device takes in a JSON response
# (docs/design/F6-api.md §5 OQ-API-1, approved option (a)).
#
# Extracted verbatim from Api::V1::DevicesController (F2/F3/F4) the moment a
# second controller needed it — Api::V1::GroupDevicesController#index lists
# devices too, and copying the field list would guarantee that the next field
# added to one list endpoint goes missing from the other.
#
# Deliberately NOT part of this shape: the `groups: [{id, name}]` array.
# Only GET /api/v1/devices/:id carries it, merged in at that call site, because
# adding it here would turn every list response into an N+1
# (docs/design/F6-api.md §2.6).
module DeviceSerializable
  extend ActiveSupport::Concern

  private

  def serialize_device(device)
    {
      id: device.id,
      identifier: device.identifier,
      name: device.name,
      platform: device.platform,
      os_version: device.os_version,
      status: device.status,
      last_seen_at: device.last_seen_at,
      created_at: device.created_at,
      updated_at: device.updated_at
    }
  end
end
