Feature: Login and session
  As a user of an Organization, I need to log in with my email and password
  and stay authenticated, without ever being able to see another
  Organization's data.

  Scenario: Successful login with a valid active account
    Given an active user "login.ok@acme.example" with password "Password123!" exists in organization "Acme Inc."
    When I log in with email "login.ok@acme.example" and password "Password123!"
    Then I am redirected to the devices page
    And I see the organization name "Acme Inc." in the top bar

  Scenario: Login fails with the wrong password
    Given an active user "login.wrongpw@acme.example" with password "Password123!" exists in organization "Acme Inc."
    When I log in with email "login.wrongpw@acme.example" and password "WrongPassword!"
    Then I see the error "Email hoặc mật khẩu không đúng."
    And I am not redirected away from the login page

  Scenario: Login fails with an email that does not exist
    When I log in with email "nobody-at-all@nowhere.example" and password "whatever123"
    Then I see the error "Email hoặc mật khẩu không đúng."

  Scenario: Login fails for an inactive user, with the same generic message
    Given an inactive user "login.inactive@acme.example" with password "Password123!" exists in organization "Acme Inc."
    When I log in with email "login.inactive@acme.example" and password "Password123!"
    Then I see the error "Email hoặc mật khẩu không đúng."

  Scenario: Calling a protected endpoint without a token is rejected
    When I call the current-user endpoint without an authentication token
    Then the response status is 401

  Scenario: Calling a protected endpoint with an expired token is rejected
    Given an active user "login.expired@acme.example" with password "Password123!" exists in organization "Acme Inc."
    And I have an already-expired authentication token for "login.expired@acme.example"
    When I call the current-user endpoint with that token
    Then the response status is 401

  Scenario: A user deactivated mid-session is rejected immediately even with an unexpired token
    Given an active user "login.deactivated@acme.example" with password "Password123!" exists in organization "Acme Inc."
    And I have logged in as "login.deactivated@acme.example" and hold a valid token
    When that user is deactivated
    And I call the current-user endpoint with that same token
    Then the response status is 401

  Scenario: Logging in with an email shared by two organizations authenticates into the right one
    Given an active user "shared.login@example.com" with password "AcmePass123!" exists in organization "Acme Inc."
    And an active user "shared.login@example.com" with password "GlobexPass123!" exists in organization "Globex Corp."
    When I log in with email "shared.login@example.com" and password "AcmePass123!"
    Then I see the organization name "Acme Inc." in the top bar

  Scenario: Submitting the login form with empty email and password is rejected as a validation error
    When I call the login endpoint with an empty email and empty password
    Then the response status is 422

  Scenario: Running the seed script twice does not create duplicate data
    Given the seed script has already been run once
    When I run the seed script again
    Then the number of organizations and users does not increase
