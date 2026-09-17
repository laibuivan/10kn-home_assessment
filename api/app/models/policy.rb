class Policy < ApplicationRecord
  # Column `type` collides with Rails' default STI `inheritance_column`.
  # ActiveRecord::Inheritance#discriminate_class_for_record calls
  # find_sti_class(record["type"]) whenever it LOADS a record whose `type` is
  # present, and tries to `constantize` that string into a class name — with
  # real business values ("wifi", "password_baseline", ...) this raises
  # ActiveRecord::SubclassNotFound on the very first record with a non-blank
  # `type`, i.e. every `Policy.find`/`organization.policies.all` after any
  # real policy exists. This is NOT conditional on having a subclass — Rails
  # activates STI purely from the column's existence. Renaming the
  # inheritance_column to a column that does not exist on this table makes
  # `using_single_table_inheritance?` always false. MUST stay the first line
  # of the class body (docs/design/F7-db.md §1 "[SỬA khi review]").
  self.inheritance_column = "_type_disabled"

  belongs_to :organization

  # `:restrict_with_error`, not left blank — F7 OQ-2 already decided there is
  # no hard-delete Policy route, so this line never actually raises today.
  # Declared anyway, same reasoning as `Organization has_many :users,
  # dependent: :restrict_with_error` (docs/design/F0-db.md §1): guard the
  # invariant at the model layer now, cheaply, rather than relying on "there
  # is no button for it" and hoping nobody adds a delete route later that
  # forgets to check for existing assignments (docs/design/F8-db.md §1d).
  has_many :policy_assignments, dependent: :restrict_with_error

  NAME_TAKEN_MESSAGE = "Tên policy này đã tồn tại trong tổ chức của bạn.".freeze
  NAME_BLANK_MESSAGE = "Tên policy không được để trống".freeze
  TYPE_BLANK_MESSAGE = "Loại policy không được để trống".freeze
  CONFIGURATION_INVALID_MESSAGE = "Cấu hình phải là một object JSON hợp lệ.".freeze
  # SoT F8 A5/A6/A26 — same message for both the Group and Device assignment
  # paths (docs/design/F8-api.md §3).
  INACTIVE_ASSIGNMENT_MESSAGE = "Chỉ gán được Policy đang active.".freeze

  enum :status, { active: 0, inactive: 1 }

  before_validation :normalize_name_and_type

  validates :name, presence: { message: NAME_BLANK_MESSAGE },
                   length: { maximum: 100 },
                   uniqueness: { scope: :organization_id,
                                 case_sensitive: true,
                                 message: NAME_TAKEN_MESSAGE }
  validates :type, presence: { message: TYPE_BLANK_MESSAGE },
                   length: { maximum: 100 }
  validates :status, presence: true
  validate :configuration_must_be_a_json_object

  private

  def normalize_name_and_type
    self.name = name.strip if name.is_a?(String)
    self.type = type.strip if type.is_a?(String)
  end

  def configuration_must_be_a_json_object
    errors.add(:configuration, CONFIGURATION_INVALID_MESSAGE) unless configuration.is_a?(Hash)
  end
end
