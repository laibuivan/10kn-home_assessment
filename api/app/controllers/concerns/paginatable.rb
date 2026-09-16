# Shared page/per_page handling for every list endpoint (docs/design/F5-api.md
# §5 OQ-API-1, approved option (a)).
#
# Extracted verbatim from Api::V1::DevicesController (F2) the moment a second
# controller needed it — copying would have left MAX_PER_PAGE and the
# "must be a positive integer" message in two places, where they are certain
# to drift apart and produce two list endpoints with different meta.per_page.
module Paginatable
  extend ActiveSupport::Concern

  DEFAULT_PAGE = 1
  DEFAULT_PER_PAGE = 20
  MAX_PER_PAGE = 100

  PAGINATION_ERROR = "must be a positive integer".freeze

  private

  # Both pagination params are reported together rather than failing on
  # the first one (field-level error convention, F0-api.md §0).
  def pagination_errors
    errors = {}
    errors[:page] = [ PAGINATION_ERROR ] unless valid_pagination_param?(params[:page])
    errors[:per_page] = [ PAGINATION_ERROR ] unless valid_pagination_param?(params[:per_page])
    errors
  end

  # Absent (or blank) means "use the default" — only a value that is
  # actually there and isn't a positive integer is an error.
  def valid_pagination_param?(raw)
    raw.blank? || !coerce_positive_integer(raw).nil?
  end

  # Integer(..., exception: false), never String#to_i: "12abc".to_i
  # would quietly become 12 and "abc".to_i a 0 (F2-api.md §2 step 2).
  # Base 10 is explicit: without it, Integer() infers the base from the
  # string itself, so "010" silently parses as octal 8, "0x1A" as hex 26,
  # and a leading-zero decimal like "09" (invalid octal digit) raises
  # instead of just being nine — none of which is "a positive integer"
  # in the plain decimal sense the API contract promises.
  def coerce_positive_integer(raw)
    return nil if raw.blank?

    value = Integer(raw.to_s, 10, exception: false)
    value if value&.positive?
  end

  def page
    @page ||= coerce_positive_integer(params[:page]) || DEFAULT_PAGE
  end

  # Clamped silently, not rejected: a client asking for everything at
  # once gets the maximum, not an error (SoT F2 §12 OQ-1).
  def per_page
    @per_page ||= [ coerce_positive_integer(params[:per_page]) || DEFAULT_PER_PAGE, MAX_PER_PAGE ].min
  end

  def total_pages(total_count)
    total_count.zero? ? 0 : (total_count.to_f / per_page).ceil
  end
end
