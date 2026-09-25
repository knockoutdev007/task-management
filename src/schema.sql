-- Team Control Center — MySQL schema (ported from SQLite; see AGENTS.md)
--
-- Every table carries created_at / updated_at (and every other timestamp) as
-- ISO-8601 UTC strings in a plain VARCHAR, not a native DATETIME — the app
-- treats timestamps as opaque, lexicographically-sortable strings throughout
-- (see now() in db.js), so this preserves exact behavior across the port
-- instead of introducing MySQL's own DATETIME/timezone semantics.
--
-- Every foreign key uses an explicit FOREIGN KEY (...) REFERENCES ... clause
-- rather than an inline "col REFERENCES table(col)" — MySQL/InnoDB parses the
-- inline form but silently does NOT enforce or cascade it.
--
-- CHECK constraints require MySQL 8.0.16+; on an older server they're parsed
-- but not enforced, which is safe here since db.js/domain.js validate the
-- same rules in the application layer regardless.

CREATE TABLE IF NOT EXISTS employees (
  id                   VARCHAR(64) PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  initials             VARCHAR(8) NOT NULL DEFAULT '',
  username             VARCHAR(190) NOT NULL UNIQUE COLLATE utf8mb4_general_ci,  -- case-insensitive; every other column here is case-sensitive
  password_hash        VARCHAR(255),                       -- null until the first password is set
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  role                 VARCHAR(16) NOT NULL DEFAULT 'employee' CHECK (role IN ('manager','employee','teamlead')),
  title                VARCHAR(255) NOT NULL DEFAULT '',
  department_id        VARCHAR(64) NOT NULL DEFAULT '',
  team_id              VARCHAR(64) NOT NULL DEFAULT '',
  manager_id           VARCHAR(64),
  capacity_hours       INT NOT NULL DEFAULT 40,
  color                VARCHAR(16) NOT NULL DEFAULT '#0E7C86',
  active               TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at        VARCHAR(32),
  created_at           VARCHAR(32) NOT NULL,
  updated_at           VARCHAR(32) NOT NULL,
  INDEX idx_employees_active (active),
  INDEX idx_employees_team (department_id, team_id),
  FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(64) PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(64) NOT NULL DEFAULT '',
  owner_id    VARCHAR(64),
  description TEXT,
  start_date  VARCHAR(32),
  target_date VARCHAR(32),
  status      VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at  VARCHAR(32) NOT NULL,
  updated_at  VARCHAR(32) NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS tasks (
  id                  VARCHAR(64) PRIMARY KEY,
  title               VARCHAR(300) NOT NULL,
  description         TEXT,
  assignee_id         VARCHAR(64),
  created_by_id       VARCHAR(64),
  department_id       VARCHAR(64) NOT NULL DEFAULT '',
  team_id             VARCHAR(64) NOT NULL DEFAULT '',
  project_id          VARCHAR(64),
  category            VARCHAR(64) NOT NULL DEFAULT '',
  priority            VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
  status              VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
  progress            INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date          VARCHAR(32),
  due_date            VARCHAR(32),
  expected_completion VARCHAR(32),
  completed_at        VARCHAR(32),
  estimated_hours     DOUBLE,
  actual_hours        DOUBLE,
  reopen_count        INT NOT NULL DEFAULT 0,
  board_category      VARCHAR(16) NOT NULL DEFAULT 'to_do',  -- Task Board's own filter: project | to_do | on_hold | rock — unrelated to `category` above
  assigned_date       VARCHAR(32),     -- date the assignment timer starts counting from (Task Board)
  paused_at           VARCHAR(32),     -- set while the Task Board timer is paused (done or on_hold); null while running
  paused_ms_total     BIGINT NOT NULL DEFAULT 0,  -- accumulated paused time, so the timer survives repeated pause/resume
  tags                TEXT NOT NULL,   -- JSON array
  blocker             TEXT,            -- JSON object or null
  dependencies        TEXT NOT NULL,   -- JSON array
  links               TEXT NOT NULL,   -- JSON array
  created_at          VARCHAR(32) NOT NULL,
  updated_at          VARCHAR(32) NOT NULL,
  -- The dashboard's hot paths: by person, by state, by deadline, by freshness.
  INDEX idx_tasks_assignee  (assignee_id),
  INDEX idx_tasks_status    (status),
  INDEX idx_tasks_due       (due_date),
  INDEX idx_tasks_updated   (updated_at),
  INDEX idx_tasks_project   (project_id),
  INDEX idx_tasks_priority  (priority),
  INDEX idx_tasks_completed (completed_at),
  INDEX idx_tasks_open_due  (status, due_date),
  FOREIGN KEY (assignee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS task_comments (
  id           VARCHAR(128) PRIMARY KEY,
  task_id      VARCHAR(64) NOT NULL,
  author_id    VARCHAR(64),
  at           VARCHAR(32) NOT NULL,
  body         TEXT NOT NULL,
  manager_note TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_comments_task (task_id, at),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS task_attachments (
  id             VARCHAR(64) PRIMARY KEY,
  task_id        VARCHAR(64) NOT NULL,
  filename       VARCHAR(255) NOT NULL,        -- name on disk, under DATA_DIR/uploads/
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(128) NOT NULL DEFAULT '',
  size           BIGINT NOT NULL DEFAULT 0,
  uploaded_by_id VARCHAR(64),
  uploaded_at    VARCHAR(32) NOT NULL,
  INDEX idx_attachments_task (task_id, uploaded_at),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS task_activity (
  id         VARCHAR(128) PRIMARY KEY,
  task_id    VARCHAR(64) NOT NULL,
  at         VARCHAR(32) NOT NULL,
  by_id      VARCHAR(64),
  by_name    VARCHAR(255) NOT NULL DEFAULT '',
  kind       VARCHAR(32) NOT NULL,
  field      VARCHAR(64),
  from_value TEXT,
  to_value   TEXT,
  note       TEXT,
  INDEX idx_activity_task (task_id, at),
  INDEX idx_activity_at   (at),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (by_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS daily_updates (
  id          VARCHAR(128) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  date        VARCHAR(10) NOT NULL,                -- YYYY-MM-DD
  at          VARCHAR(32) NOT NULL,
  completed   TEXT NOT NULL,
  current     TEXT NOT NULL,
  next        TEXT NOT NULL,
  blocked     TEXT NOT NULL,
  help        TEXT NOT NULL,
  note        TEXT NOT NULL,
  UNIQUE KEY uq_updates_employee_date (employee_id, date),
  INDEX idx_updates_date (date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS breaks (
  id           VARCHAR(64) PRIMARY KEY,
  employee_id  VARCHAR(64) NOT NULL,
  kind         VARCHAR(16),                        -- SHORT1 / SHORT2 / LONG — see BREAK_TYPES
  started_at   VARCHAR(32) NOT NULL,
  ended_at     VARCHAR(32),                         -- null while break is in progress
  duration_sec INT,                                 -- filled in on end
  created_at   VARCHAR(32) NOT NULL,
  updated_at   VARCHAR(32) NOT NULL,
  INDEX idx_breaks_employee (employee_id, started_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS notifications (
  id          VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  task_id     VARCHAR(64),
  activity_id VARCHAR(128),
  kind        VARCHAR(32) NOT NULL,
  text        TEXT NOT NULL,
  created_at  VARCHAR(32) NOT NULL,
  read_at     VARCHAR(32),
  INDEX idx_notifications_employee (employee_id, created_at),
  INDEX idx_notifications_unread   (employee_id, read_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES task_activity(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS employee_notify_prefs (
  employee_id VARCHAR(64) NOT NULL,
  `key`       VARCHAR(64) NOT NULL,
  value       TINYINT(1) NOT NULL,
  updated_at  VARCHAR(32) NOT NULL,
  PRIMARY KEY (employee_id, `key`),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS config (
  `key`      VARCHAR(64) PRIMARY KEY,
  value      LONGTEXT NOT NULL,                 -- JSON
  updated_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  created_at  VARCHAR(32) NOT NULL,
  expires_at  VARCHAR(32) NOT NULL,
  INDEX idx_sessions_expiry (expires_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Good Vibes Wall: one active employee posts each working day, on a fair
-- rotating schedule. Kept as its own set of tables rather than new columns
-- on `employees`/`tasks`, so the existing task-management schema is untouched.

CREATE TABLE IF NOT EXISTS good_vibes_rotation_order (
  employee_id VARCHAR(64) PRIMARY KEY,
  sort_order  INT NOT NULL,
  updated_at  VARCHAR(32) NOT NULL,
  INDEX idx_gv_rotation_order (sort_order),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS good_vibes_assignments (
  id                   VARCHAR(64) PRIMARY KEY,
  date                 VARCHAR(10) NOT NULL UNIQUE,   -- YYYY-MM-DD
  employee_id          VARCHAR(64) NOT NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','skipped','reassigned')),
  skipped_employee_id  VARCHAR(64),                   -- audit: who was skipped, if any
  reassigned_by_id     VARCHAR(64),                   -- audit: which manager reassigned, if any
  created_at           VARCHAR(32) NOT NULL,
  updated_at           VARCHAR(32) NOT NULL,
  INDEX idx_gv_assignments_date (date),
  INDEX idx_gv_assignments_employee (employee_id, date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (skipped_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (reassigned_by_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS good_vibes_posts (
  id            VARCHAR(64) PRIMARY KEY,
  assignment_id VARCHAR(64) NOT NULL UNIQUE,   -- one post per assigned day
  employee_id   VARCHAR(64) NOT NULL,
  category      VARCHAR(24) NOT NULL,
  body          TEXT NOT NULL,
  hidden_at     VARCHAR(32),                   -- moderation: soft-hide, not delete
  hidden_by_id  VARCHAR(64),
  created_at    VARCHAR(32) NOT NULL,
  updated_at    VARCHAR(32) NOT NULL,
  INDEX idx_gv_posts_employee (employee_id, created_at),
  INDEX idx_gv_posts_created (created_at),
  FOREIGN KEY (assignment_id) REFERENCES good_vibes_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (hidden_by_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS good_vibes_likes (
  id          VARCHAR(64) PRIMARY KEY,
  post_id     VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  created_at  VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_gv_likes_post_employee (post_id, employee_id),
  INDEX idx_gv_likes_post (post_id),
  FOREIGN KEY (post_id) REFERENCES good_vibes_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS good_vibes_comments (
  id           VARCHAR(64) PRIMARY KEY,
  post_id      VARCHAR(64) NOT NULL,
  author_id    VARCHAR(64),
  at           VARCHAR(32) NOT NULL,
  body         TEXT NOT NULL,
  hidden_at    VARCHAR(32),
  hidden_by_id VARCHAR(64),
  INDEX idx_gv_comments_post (post_id, at),
  FOREIGN KEY (post_id) REFERENCES good_vibes_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (hidden_by_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
