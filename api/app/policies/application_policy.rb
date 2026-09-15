# Pundit base class — every policy inherits from this (docs/design/F2-api.md
# §5 OQ-API-1: Pundit is wired up starting at F2, the first feature with a
# real resource controller).
#
# Defaults deny: a new policy must opt in to each action explicitly, so
# forgetting to define one can never accidentally authorize it.
class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    @user = user
    @record = record
  end

  def index?
    false
  end

  def show?
    false
  end

  def create?
    false
  end

  def new?
    create?
  end

  def update?
    false
  end

  def edit?
    update?
  end

  def destroy?
    false
  end

  class Scope
    def initialize(user, scope)
      @user = user
      @scope = scope
    end

    # Subclasses MUST override this — there is no safe generic default
    # (returning `scope.all` here would silently leak across Organizations,
    # CLAUDE.md §4).
    def resolve
      raise NotImplementedError, "You must define #resolve in #{self.class}"
    end

    private

    attr_reader :user, :scope
  end
end
