Feature: Device detail page
  As an active user of an Organization, I need to open a device's detail
  page to see its full information, which Groups it belongs to, and which
  Policies are currently applied to it — reached both from the Devices list
  and directly by URL — without ever being able to see a device belonging to
  another Organization.

  Scenario: View a device's detail page successfully
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-001" that is "active"
    When I open the detail page for device "IPHONE-001"
    Then I see the device's full information for "IPHONE-001"
    And I see the message "Chưa thuộc group nào." in the Groups block
    And I see the message "Chưa có policy nào áp dụng." in the Policy block

  Scenario: Viewing a device belonging to another organization returns 404
    Given organization "Globex Corp." has a device "IPHONE-777"
    And organization "Acme Inc." also exists
    When I call the device-detail API as "Acme Inc." for the device with identifier "IPHONE-777"
    Then the response status is 404
    And the response body says "Not found"

  Scenario: Viewing a device that does not exist shows a not-found page
    Given I am logged in as an active user of organization "Acme Inc."
    When I open the detail page for a device id that does not exist
    Then I see the message "Không tìm thấy thiết bị"
    And I see a button to go back to the list

  Scenario: Viewing a device with a malformed id does not leak an infrastructure error
    Given I am logged in as an active user of organization "Acme Inc."
    When I open the detail page for a malformed device id
    Then I see the message "Không tìm thấy thiết bị"

  Scenario: A retired device hides the Edit button and shows an immutable banner
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-203" that is "retired"
    When I open the detail page for device "IPHONE-203"
    Then I do not see a working Edit button on the detail page
    And I see the banner "Thiết bị đã retired — không thể chỉnh sửa." on the detail page

  Scenario: A non-retired device shows a working Edit button that opens the correct edit form
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-204" that is "active"
    When I open the detail page for device "IPHONE-204"
    And I click the Edit button on the detail page
    Then the edit form opens prefilled with device "IPHONE-204"'s data

  Scenario: Editing successfully from the detail page updates the header immediately
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-205" that is "active"
    When I open the detail page for device "IPHONE-205"
    And I edit that device from the detail page, changing its status to "retired"
    Then I see the toast "Đã cập nhật device"
    And I see the banner "Thiết bị đã retired — không thể chỉnh sửa." on the detail page

  Scenario: Clicking a row on the Devices list navigates to its detail page
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-206" that is "active"
    When I open the Devices page
    And I click the row for device "IPHONE-206"
    Then I see the device's full information for "IPHONE-206"

  Scenario: The "Xem chi tiết" action on the Devices list navigates to its detail page
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-207" that is "active"
    When I open the Devices page
    And I choose "Xem chi tiết" from the row actions for device "IPHONE-207"
    Then I see the device's full information for "IPHONE-207"

  Scenario: Opening the detail page directly via URL loads the correct data
    Given I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-208" that is "active"
    When I navigate directly to the detail page URL for device "IPHONE-208"
    Then I see the device's full information for "IPHONE-208"

  Scenario: Going back to the list preserves the previously viewed filter and page
    Given I have applied platform filter "ios" and am on page 2
    When I click the row for the first device on that page
    And I click the back-to-list link on the detail page
    Then I still see filter "ios" applied and page 2 as before reloading

  Scenario: An infrastructure error while loading the detail page shows a retry banner
    Given the device-detail API is returning a server error
    And I am logged in as an active user of organization "Acme Inc." with a device "IPHONE-209" that is "active"
    When I open the detail page for device "IPHONE-209"
    Then I see an error banner with a "Thử lại" button on the detail page

  Scenario: Calling the device-detail API without a token
    Given organization "Acme Inc." has a device "IPHONE-210"
    When I call the device-detail API for the device with identifier "IPHONE-210" without an authentication token
    Then the response status is 401

  Scenario: Calling the device-detail API with an expired token
    Given I have an already-expired authentication token for an active user of organization "Acme Inc." which has a device "IPHONE-211"
    When I call the device-detail API for the device with identifier "IPHONE-211" using that token
    Then the response status is 401

  Scenario: Visiting the detail page URL directly while not logged in redirects to login
    Given organization "Acme Inc." has a device "IPHONE-212"
    When I navigate directly to the detail page URL for device "IPHONE-212" while not logged in
    Then I am redirected to the login page
