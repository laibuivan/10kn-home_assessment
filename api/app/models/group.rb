class Group < ApplicationRecord
  belongs_to :organization

  # MUST stay declared before `has_many :policy_assignment_jobs, dependent:
  # :nullify` below — Rails runs before_destroy callbacks in the order they
  # are declared in the class body, and `dependent: :nullify` registers its
  # own before_destroy callback right where the `has_many` line itself runs.
  # If this line came AFTER, `dependent: :nullify` would already have set
  # group_id = NULL on every job for this group BEFORE this callback runs,
  # so `policy_assignment_jobs.where(...)` (scoped through the association,
  # i.e. WHERE group_id = <this record's id>) would find nothing left to
  # fail — SoT F8 A10/A19 would silently not hold (docs/design/F8-db.md §1c).
  before_destroy :fail_pending_policy_assignment_jobs

  # Half of the carry-over contract F5 opened (docs/design/F5-db.md §4a) is
  # paid here; F8 still owes `has_many :policy_assignments, dependent:
  # :delete_all` once that table exists. GroupsController#destroy has called
  # `destroy!` since F5 precisely so this line starts working with no change
  # there (SoT F6 A20: deleting a group must leave zero orphaned join rows,
  # and must not delete a single Device).
  #
  # `:delete_all`, not `:destroy` — a join row carries no business callback,
  # and a 10.000-member group would otherwise instantiate 10.000 Ruby objects
  # to issue 10.000 DELETEs instead of one statement (docs/design/F6-db.md §1).
  # Rails still wraps that DELETE and the group's own DELETE in one
  # transaction, so no manual transaction here.
  has_many :group_memberships, dependent: :delete_all
  has_many :devices, through: :group_memberships
  has_many :policy_assignments, dependent: :delete_all
  # `:nullify`, NOT `:delete_all` — deliberately different from
  # policy_assignments right above (docs/design/F8-db.md §1c/§4a). Deleting a
  # Group that has ever had ANY job (even a long-finished done/failed one)
  # must not erase that job's history: SoT F8's "Group bị xóa giữa lúc job
  # đang chạy" scenario (A10/A19) requires
  # `GET /api/v1/policy_assignment_jobs/:id` to still return 200 with
  # status: "failed" after the Group is gone. `:delete_all` here would take
  # that row down with the Group instead.
  has_many :policy_assignment_jobs, dependent: :nullify

  # One constant, two call sites: the uniqueness validation below and the
  # RecordNotUnique rescue in GroupsController. The client must not be able
  # to tell the app-level check from the DB-level race (SoT F5 A5 vs A7).
  NAME_TAKEN_MESSAGE = "Tên group này đã tồn tại trong tổ chức của bạn.".freeze
  NAME_BLANK_MESSAGE = "Tên group không được để trống".freeze

  before_validation :normalize_name_and_description

  validates :name, presence: { message: NAME_BLANK_MESSAGE },
                   length: { maximum: 100 },
                   uniqueness: { scope: :organization_id,
                                 case_sensitive: true,
                                 message: NAME_TAKEN_MESSAGE }
  validates :description, length: { maximum: 500 }, allow_nil: true

  private

  # Mandatory, not cosmetic (docs/design/F5-db.md §1b):
  #   1. trimming `name` makes the validated value identical to the value the
  #      composite unique index sees, so "Sales Team" and "Sales Team " can
  #      never become two rows that look identical in the UI;
  #   2. `description.strip.presence` collapses "" / "   " to NULL, so
  #      "no description" has exactly one representation in the database.
  # The is_a?(String) guards keep a JSON `null` (or any non-string) falling
  # through to the presence/length validators — a 422, never a NoMethodError.
  def normalize_name_and_description
    self.name = name.strip if name.is_a?(String)
    self.description = description.strip.presence if description.is_a?(String)
  end

  # SoT F8 A10/A19: deleting a Group that has a pending/running job for it
  # must flip that job to failed IMMEDIATELY, synchronously, inside the same
  # destroy transaction — not wait for the worker to eventually notice the
  # Group is gone. `update_all` (not `.update` per row) deliberately skips
  # callbacks/validations, matching every other bulk-op in this project
  # (upsert_all/delete_all) — there is at most one pending/running job per
  # group at a time (OQ-5 dedupe), so the cost here is never more than one
  # row.
  def fail_pending_policy_assignment_jobs
    policy_assignment_jobs.where(status: %w[pending running]).update_all(
      status: PolicyAssignmentJob.statuses[:failed],
      error_message: PolicyAssignmentJob::GROUP_DELETED_MESSAGE,
      updated_at: Time.current
    )
  end
end
