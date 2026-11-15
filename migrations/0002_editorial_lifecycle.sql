-- A publisher supplies a stable ID and a window in canonical UTC ISO format.
CREATE TRIGGER validate_question_publication
BEFORE INSERT ON questions
BEGIN
  SELECT CASE WHEN
    NEW.status <> 'open' OR NEW.outcome IS NOT NULL OR
    NEW.source_url IS NOT NULL OR NEW.resolved_at IS NOT NULL OR
    length(NEW.id) NOT BETWEEN 1 AND 80 OR NEW.id GLOB '*[^a-zA-Z0-9_-]*' OR
    trim(NEW.prompt) = '' OR trim(NEW.criteria) = '' OR
    NEW.opens_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', NEW.opens_at) OR
    NEW.closes_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closes_at) OR
    NEW.opens_at >= NEW.closes_at
  THEN RAISE(ABORT, 'Invalid question publication') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM questions
    WHERE id <> NEW.id AND status = 'open'
      AND opens_at < NEW.closes_at AND closes_at > NEW.opens_at
  ) THEN RAISE(ABORT, 'Voting windows overlap') END;
END;

-- Verification is a trusted write after voting closes. Keep the published criteria fixed.
CREATE TRIGGER validate_question_transition
BEFORE UPDATE ON questions
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id OR NEW.prompt IS NOT OLD.prompt OR NEW.criteria IS NOT OLD.criteria OR
    NEW.opens_at IS NOT OLD.opens_at OR NEW.closes_at IS NOT OLD.closes_at OR
    OLD.status IN ('resolved', 'void') OR NEW.status = 'open' OR
    (NEW.status IN ('closed', 'resolved') AND
      OLD.closes_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) OR
    (NEW.status = 'resolved' AND (
      NEW.outcome IS NULL OR NEW.source_url IS NULL OR
      NEW.source_url NOT GLOB 'https://?*' OR NEW.resolved_at IS NULL OR
      NEW.resolved_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', NEW.resolved_at) OR
      NEW.resolved_at < OLD.closes_at OR NEW.resolved_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )) OR
    (NEW.status <> 'resolved' AND
      (NEW.outcome IS NOT NULL OR NEW.source_url IS NOT NULL OR NEW.resolved_at IS NOT NULL))
  THEN RAISE(ABORT, 'Invalid question transition') END;
END;
