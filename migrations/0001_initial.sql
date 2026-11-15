-- The game stores one immutable vote per anonymous browser identifier and question.
-- Question publication and resolution are administrative operations, not public API actions.
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  criteria TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved', 'void')),
  outcome TEXT CHECK (outcome IN ('yes', 'no') OR outcome IS NULL),
  source_url TEXT,
  resolved_at TEXT,
  CHECK (status != 'resolved' OR (outcome IS NOT NULL AND source_url IS NOT NULL))
);

CREATE TABLE votes (
  question_id TEXT NOT NULL REFERENCES questions(id),
  voter_hash TEXT NOT NULL,
  team TEXT NOT NULL CHECK (team IN ('red', 'blue')),
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (question_id, voter_hash)
);

CREATE INDEX questions_by_open ON questions(status, opens_at DESC);
CREATE INDEX votes_by_question ON votes(question_id, team, answer);
