Feature: Device create/edit with organization-scoped validation
  As an active user of an Organization, I need to create and edit my
  Organization's devices with proper validation — identifiers unique within
  my Organization, valid platform/status values only, and a retired device
  locked from further edits — so device data stays trustworthy without ever
  leaking or mixing across Organizations.

  Scenario: Create a device successfully with valid data
    Given I am logged in as an active user of organization "Acme Inc."
    When I create a new device with identifier "IPHONE-001", name "iPhone của Alice" and platform "ios"
    Then the device is created successfully belonging to "Acme Inc."
    And the new device has default status "active"
    And I see the toast "Đã tạo device"

  Scenario: Create a device fails because the identifier already exists in the same organization
    Given I am an active user of organization "Acme Inc.", which already has a device with identifier "IPHONE-001"
    When I create a new device with identifier "IPHONE-001", name "Another Device" and platform "android"
    Then the response status is 422
    And I see a field-level error under the "identifier" field saying "Identifier này đã tồn tại trong tổ chức của bạn."

  Scenario: Create a device succeeds even if the identifier matches a device in another organization
    Given organization "Globex Corp." already has a device with identifier "IPHONE-001"
    And I am an active user of organization "Acme Inc."
    When I call the create-device API for "Acme Inc." with identifier "IPHONE-001", name "Alice's iPhone" and platform "ios"
    Then the response status is 201
    And the created device belongs to organization "Acme Inc."

  Scenario: Create a device fails because required fields are missing
    Given I am an active user of organization "Acme Inc."
    When I call the create-device API for "Acme Inc." with no identifier, name or platform
    Then the response status is 422
    And I receive a field-level error for "identifier"
    And I receive a field-level error for "name"
    And I receive a field-level error for "platform"

  Scenario: Create or edit a device fails because the platform is invalid
    Given I am an active user of organization "Acme Inc."
    When I call the create-device API for "Acme Inc." with identifier "IPHONE-002", name "Some Device" and platform "windows"
    Then the response status is 422
    And I receive a field-level error for "platform"

  Scenario: Edit a device fails because the status is invalid
    Given organization "Acme Inc." has a device "IPHONE-101" with status "active"
    When I call the update-device API as "Acme Inc." for the device with identifier "IPHONE-101" and status "deleted"
    Then the response status is 422
    And I receive a field-level error for "status"

  Scenario: Creating a device always defaults to active status, ignoring any status the client sends
    Given I am an active user of organization "Acme Inc."
    When I call the create-device API for "Acme Inc." with identifier "IPHONE-003", name "Some Device", platform "ios" and status "retired"
    Then the response status is 201
    And the created device has status "active"

  Scenario: Edit a device succeeds while it is not retired
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-201" that is "active"
    When I edit that device changing its name, platform and OS version
    Then the device is updated successfully with the new data
    And I see the toast "Đã cập nhật device"

  Scenario: Edit a device to change its status to retired succeeds
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-202" that is "active"
    When I edit that device changing its status to "retired"
    Then the device is updated successfully with status "retired"

  Scenario: Editing a device is completely blocked once it is retired
    Given organization "Acme Inc." has a device "IPHONE-102" with status "retired"
    When I call the update-device API as "Acme Inc." for the device with identifier "IPHONE-102" and name "Hacked Name"
    Then the response status is 422
    And the error message is "Thiết bị đã retired, không thể sửa"
    And no field of the device with identifier "IPHONE-102" was actually changed

  Scenario: The identifier cannot be changed when editing a device even if a different value is sent
    Given organization "Acme Inc." has a device "IPHONE-103" with status "active"
    When I call the update-device API as "Acme Inc." for the device with identifier "IPHONE-103", attempting to change identifier to "IPHONE-999"
    Then the response status is 200
    And the device's identifier in the response is still "IPHONE-103"

  Scenario: Create or edit a device ignores the organization_id sent by the client
    Given I am an active user of organization "Acme Inc."
    And organization "Globex Corp." also exists
    When I call the create-device API for "Acme Inc." with identifier "IPHONE-104", name "Spoofed Org Device", platform "ios" and organization_id of "Globex Corp."
    Then the response status is 201
    And the created device belongs to organization "Acme Inc."

  Scenario: Editing a device belonging to another organization returns 404
    Given organization "Globex Corp." has a device "IPHONE-777"
    And organization "Acme Inc." also exists
    When I call the update-device API as "Acme Inc." for the device with identifier "IPHONE-777" and name "Hack Attempt"
    Then the response status is 404

  Scenario: Creating a device concurrently with the same identifier only lets one request succeed
    Given I am an active user of organization "Acme Inc."
    When I send 2 requests to create a device with identifier "IPHONE-105" in "Acme Inc." at nearly the same time
    Then only one request succeeds with status 201
    And the other request fails with a field-level error for "identifier"

  Scenario: An infrastructure error while submitting the form keeps the entered data
    Given the create-device API is returning a server error
    And I am logged in as an active user of organization "Acme Inc."
    When I create a new device with identifier "IPHONE-106", name "Test Device" and platform "ios"
    Then I see an error banner saying "Có lỗi xảy ra, vui lòng thử lại." in the form
    And the modal does not close
    And the data I entered is still there

  Scenario: Calling the create-device API without a token
    When I call the create-device API without an authentication token
    Then the response status is 401

  Scenario: Calling the update-device API with an expired token
    Given I have an already-expired authentication token for an active user of organization "Acme Inc." which has a device "IPHONE-107"
    When I call the update-device API for the device with identifier "IPHONE-107" using that token
    Then the response status is 401

  Scenario: The Edit button is disabled on the list for a retired device
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-203" that is "retired"
    When I open the Devices page
    Then the "Sửa" button for that device is disabled
    And I see the tooltip "Thiết bị đã retired, không thể sửa" when hovering over that button
