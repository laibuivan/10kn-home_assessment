class User < ApplicationRecord
  belongs_to :organization

  has_secure_password

  enum :status, { active: 0, inactive: 1 }

  before_validation :normalize_email

  validates :email, presence: true,
                     format: { with: URI::MailTo::EMAIL_REGEXP },
                     uniqueness: { scope: :organization_id, case_sensitive: true }
  # Case-sensitive is correct here: normalize_email already lowercases the
  # value before this validation runs, so two rows can never differ only by
  # case — comparing case-sensitively avoids an extra citext/LOWER() index.
  validates :password, length: { minimum: 8 }, allow_nil: true

  private

  # SoT F0-foundation.md §6: email must be stored lowercase so
  # "Foo@x.com"/"foo@x.com" can't both exist as distinct rows in the same
  # Organization.
  def normalize_email
    self.email = email.strip.downcase if email.present?
  end
end
