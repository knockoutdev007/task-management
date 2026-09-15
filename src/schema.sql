-- Team Control Center — SQLite schema
-- Every table carries created_at / updated_at as ISO-8601 UTC strings.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  initials             TEXT NOT NULL DEFAULT '',
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT,                       -- null until the first password is set
  must_change_password INTEGER NOT NULL DEFAULT 0,
  role                 TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('manager','employee')),
  title                TEXT NOT NULL DEFAULT '',
  department_id        TEXT NOT NULL DEFAULT '',
  team_id              TEXT NOT NULL DEFAULT '',
  manager_id           TEXT REFERENCES employees(id) ON DELETE SET NULL,
  capacity_hours       INTEGER NOT NULL DEFAULT 40,
  color                TEXT NOT NULL DEFAULT '#0E7C86',
  active               INTEGER NOT NULL DEFAULT 1,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(active);
CREATE INDEX IF NOT EXISTS idx_employees_team   ON employees(department_id, team_id);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  owner_id    TEXT REFERENCES employees(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date  TEXT,
  target_date TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  assignee_id         TEXT REFERENCES employees(id) ON DELETE SET NULL,
  created_by_id       TEXT REFERENCES employees(id) ON DELETE SET NULL,
  department_id       TEXT NOT NULL DEFAULT '',
  team_id             TEXT NOT NULL DEFAULT '',
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category            TEXT NOT NULL DEFAULT '',
  priority            TEXT NOT NULL DEFAULT 'MEDIUM',
  status              TEXT NOT NULL DEFAULT 'NOT_STARTED',
  progress            INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date          TEXT,
  due_date            TEXT,
  expected_completion TEXT,
  completed_at        TEXT,
  estimated_hours     REAL,
  actual_hours        REAL,
  reopen_count        INTEGER NOT NULL DEFAULT 0,
  tags                TEXT NOT NULL DEFAULT '[]',   -- JSON array
  blocker             TEXT,                          -- JSON object or null
  dependencies        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  links               TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
-- The dashboard's hot paths: by person, by state, by deadline, by freshness.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee   ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due        ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_updated    ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority   ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_completed  ON tasks(completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_open_due   ON tasks(status, due_date);

CREATE TABLE IF NOT EXISTS task_comments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id    TEXT REFERENCES employees(id) ON DELETE SET NULL,
  at           TEXT NOT NULL,
  body         TEXT NOT NULL,
  manager_note INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id, at);

CREATE TABLE IF NOT EXISTS task_attachments (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,        -- name on disk, under data/uploads/
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL DEFAULT '',
  size           INTEGER NOT NULL DEFAULT 0,
  uploaded_by_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON task_attachments(task_id, uploaded_at);

CREATE TABLE IF NOT EXISTS task_activity (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  by_id      TEXT REFERENCES employees(id) ON DELETE SET NULL,
  by_name    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  field      TEXT,
  from_value TEXT,
  to_value   TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_task ON task_activity(task_id, at);
CREATE INDEX IF NOT EXISTS idx_activity_at   ON task_activity(at);

CREATE TABLE IF NOT EXISTS daily_updates (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                -- YYYY-MM-DD
  at          TEXT NOT NULL,
  completed   TEXT NOT NULL DEFAULT '',
  current     TEXT NOT NULL DEFAULT '',
  next        TEXT NOT NULL DEFAULT '',
  blocked     TEXT NOT NULL DEFAULT '',
  help        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_updates_date ON daily_updates(date);

CREATE TABLE IF NOT EXISTS breaks (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,                            -- null while break is in progress
  duration_sec INTEGER,                         -- filled in on end
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_breaks_employee ON breaks(employee_id, started_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  activity_id TEXT REFERENCES task_activity(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications(employee_id, read_at);

CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                 -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
