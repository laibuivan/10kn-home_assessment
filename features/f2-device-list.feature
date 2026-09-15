Feature: Device list with pagination and platform/status filters
  As an active user of an Organization, I need to browse my Organization's
  devices in pages, filter them by platform and/or status, and never see any
  device belonging to another Organization — so I can manage large device
  counts without freezing the browser or leaking data across Organizations.

  Scenario: View my organization's device list with default pagination
    Given I am an active user of organization "Acme Inc." and it has many devices
    When I open the Devices page without any filter
    Then I see the device list for "Acme Inc." on the first page
    And I see the correct total device count and total number of pages

  Scenario: Filter by a valid platform
    Given organization "Acme Inc." has devices across multiple platforms
    When I filter the device list by platform "ios"
    Then I only see devices with platform "ios" belonging to "Acme Inc."
    And the list returns to page 1

  Scenario: Filter by a valid status
    Given organization "Acme Inc." has devices in multiple statuses
    When I filter the device list by status "retired"
    Then I only see devices with status "retired" belonging to "Acme Inc."

  Scenario: Combine platform and status filters at the same time
    Given organization "Acme Inc." has devices spanning multiple platforms and statuses
    When I filter the device list by platform "android" and status "active" at the same time
    Then I only see devices that have both platform "android" and status "active"

  Scenario: Empty list because the organization has no devices at all
    Given organization "Acme Inc." has no devices at all
    When I open the Devices page
    Then I see the message "Không có thiết bị nào"
    And I do not see a "Xóa lọc" button

  Scenario: Filter matches no device
    Given organization "Acme Inc." has no devices with platform "macos"
    When I filter the device list by platform "macos"
    Then I see the empty-filter message with a "Xóa lọc" button

  Scenario: Last page has fewer rows than the page size
    Given organization "Acme Inc." has a number of devices not evenly divisible by the page size
    When I go to the last page
    Then I see exactly the remaining devices for that page, no more and no less

  Scenario: Requesting a page beyond the total number of pages
    Given organization "Acme Inc." only has enough devices for 5 pages
    When I call the device list API with page "999"
    Then the response status is 200
    And I receive an empty device list
    And the pagination metadata still reflects the true total device count and total pages

  Scenario: Filtering with an invalid enum value
    Given I am an active user of organization "Acme Inc."
    When I call the device list API with platform "windows"
    Then the response status is 422
    And I receive a field-level error for "platform"

  Scenario Outline: Invalid pagination parameters
    Given I am an active user of organization "Acme Inc."
    When I call the device list API with page "<page>"
    Then the response status is 422
    And I receive a field-level error for "page"

    Examples:
      | page |
      | -1   |
      | abc  |

  Scenario: per_page exceeding the maximum allowed is silently clamped
    Given organization "Acme Inc." has more devices than the maximum allowed page size
    When I call the device list API with per_page "100000"
    Then the response status is 200
    And the returned page size is clamped to the maximum allowed
    And not all devices are returned in a single response

  Scenario: Organization A cannot see organization B's devices
    Given organization "Acme Inc." has its own devices and organization "Globex Corp." also has its own devices
    When a user from "Acme Inc." calls the device list API without any filter, across all pages
    Then I only see devices belonging to "Acme Inc."
    And the total device count in the pagination metadata only counts "Acme Inc." devices

  Scenario: Calling the device list API without a token
    When I call the device list API without an authentication token
    Then the response status is 401

  Scenario: Calling the device list API with an expired token
    Given an active user "f2.expired-token@acme.example" with password "Password123!" exists in organization "Acme Inc."
    And I have an already-expired authentication token for "f2.expired-token@acme.example"
    When I call the device list API with that token
    Then the response status is 401

  Scenario: Infrastructure error while loading the list
    Given the device list API is returning a server error
    When I open the Devices page
    Then I see an error banner with a "Thử lại" button in the table area
    And the filter bar still works normally

  Scenario: Reopening the Devices page from a URL that already has a filter and page
    Given I have applied platform filter "ios" and am on page 2
    When I reload the page
    Then I still see filter "ios" applied and page 2 as before reloading
