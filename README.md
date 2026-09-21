# Team Control Center

An internal task tracker and management dashboard. Every person maintains their
own tasks; the manager gets a live view of who is working on what, what is
overdue, what is blocked, and who is overloaded — without asking anyone.

Built to be boring to run: one Node process, one MySQL database, four
dependencies. No build step, no bundler. It will handle a team of a few
hundred on the smallest server you can rent.

---

## Quick start

```bash
mysql -u root -e "CREATE DATABASE tcc CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
                   CREATE USER 'tcc_app'@'localhost' IDENTIFIED BY 'change-me';
                   GRANT ALL PRIVILEGES ON tcc.* TO 'tcc_app'@'localhost';"
npm install
cp .env.example .env          # then set SESSION_SECRET and DATABASE_URL — see below
npm run seed                  # the real team roster, 6 projects, 34 sample tasks
npm start                     # http://localhost:3000
```

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The seed prints the sign-in details. Everyone starts on the password
`controlcenter1` and is asked to change it after signing in. Sign in as
`roshani.shinde` for the manager view, anyone else for the employee side.
There's no email address anywhere in this app — everyone signs in with a
**User ID** auto-generated from their name (`John Doe` → `john.doe`, deduped
with a trailing number on collision).

**Starting with real data instead:** skip `npm run seed` and create the first
manager directly. Everyone else gets added from Settings → People inside the
app.

```bash
npm run create-manager -- "Manager Name"
```

`scripts/load-marketing-team.js` is a second, standalone seeder that loads a
different hardcoded roster the same way `seed.js` does — an alternative to
editing `scripts/seed-data/`, not something most people need.

---

## How it fits together

```
src/
  server.js        express app, static files, route mounting
  db.js            every SQL statement; snake_case rows in, camelCase JSON out
  schema.sql       tables and indexes
  domain.js        permission and validation rules, audit-trail derivation
  auth.js          password hashing, sessions, the auth middleware
  events.js        Server-Sent Events hub for live updates
  routes/
    tasks.js         the single write path for tasks, plus bulk and comments
    admin.js         people, projects, settings, daily updates, /api/bootstrap
    attachments.js   file uploads on tasks
    breaks.js        break tracking (start/end, once-per-type-per-day)
    notifications.js the persisted per-employee notification feed
public/
  index.html       the shell; loads the app files in order
  styles.css       design tokens first, then components
  app/
    util.js        helpers, config defaults, the client-side state object
    metrics.js     workload, staleness, attention, analytics — all derived here
    api.js         REST client, optimistic writes, SSE subscription
    ui.js          shared components, navigation, the render dispatcher
    views-*.js     one file per group of screens
    drawer.js      task detail drawer and the task form
    modals.js      dialogs and CSV exports
    events.js      event delegation, drag and drop, boot
scripts/
  seed.js                loads scripts/seed-data/*.json (dates shift so "today" always looks right)
  load-marketing-team.js an alternative, standalone seeder with its own hardcoded roster
  create-manager.js
  backup.js
  smoke-test.js          business rules and every permission boundary
  security-test.js       session/cookie hardening, IDOR, upload and input validation
  notif-test.js          client-side notification logic, loaded into a vm sandbox
```

The frontend files are plain scripts sharing one global scope, loaded in the
order listed in `index.html`. There is no build step on purpose — edit a file,
refresh the page. If you later want modules, bundling or a framework, the split
above is already along sensible lines.

### Where the numbers come from

Nothing on any screen is stored as a metric. `public/app/metrics.js` derives
everything from the task rows on each render:

- **`flags(task)`** — overdue, days overdue, due today, staleness against the
  per-priority threshold, days blocked, schedule variance, effort overrun.
- **`attention(task)`** — the reasons a task needs the manager, each with a
  severity and a sentence explaining itself. Ten detectors.
- **`workload(employeeId, taskFilter?)`** — deliberately *not* a task count.
  Each open task contributes `priority weight × remaining-effort factor ×
  deadline urgency`. Blocked work costs attention at roughly half capacity
  plus a fixed penalty, because it occupies a person without consuming their
  hours. Bands are configurable in Settings. The optional filter lets a view
  narrow which tasks count without touching the underlying formula.
- **`delivery(employeeId)`** — five weighted indicators (on-time rate, weight of
  work delivered, estimate accuracy, update consistency, deadline hygiene) with
  a low-confidence flag under five tasks. Every screen that shows it also shows
  how it was calculated. It is a conversation starter, not a rating.

Change a rule in one place and every screen follows.

---

## Permissions

Two roles. The server enforces all of this; the browser mirrors it only so the
interface can disable what won't work.

| | Employee | Manager |
|---|---|---|
| See the whole board | read | read |
| Create tasks | for themselves | for anyone |
| Edit a task | their own, or ones they created | any |
| Change status, progress, effort, blockers, comments | their own | any |
| Reassign, move a deadline, change department | ✗ | ✓ |
| Mark complete | their own | any |
| Delete a task | ✗ | ✓ |
| Add or edit people, reset passwords | ✗ | ✓ |
| Projects and Settings | read | write |

Two details worth knowing:

- **Everyone can read every task.** Project rollups and the team view need it,
  and it matches how an internal board normally works. If you need per-person
  read scoping, filter in `GET /api/tasks` — the client already scopes the
  employee views, so only the API changes.
- **A refused field is not an error.** If an employee tries to move a deadline,
  the save succeeds for everything they *are* allowed to change and the response
  lists what was held back; the interface tells them a manager has to do that
  part. It avoids losing someone's work over one disallowed field.

The last active manager cannot demote or deactivate themselves, so you can't
lock yourself out.

---

## Authentication

User ID and password, hashed with bcrypt (cost 12), server-side sessions in the
`sessions` table, signed httpOnly `SameSite=Lax` cookie. Failed logins are
throttled per User ID+IP (8 attempts / 15 minutes). The User ID is
auto-generated from a person's full name (lowercase, dot-separated, e.g.
`John Doe` → `john.doe`, deduped with a trailing number on collision) — no
email address is collected or stored anywhere in the app.

Adding someone in Settings → People returns a temporary password **once**. Pass
it to them; they are prompted to replace it on first sign-in. Lost it? Reset the
password from the same dialog. Changing a password signs that person out
everywhere else — including the session they're currently on, once the new
cookie is issued.

**Swapping in Google or Microsoft SSO later:** replace `POST /api/auth/login` in
`src/auth.js` with your provider's callback and keep issuing the same session
cookie. Nothing downstream reads anything but `req.user`.

---

## Break tracking

Starting a break asks which one: **Short Break 1** and **Short Break 2** (15
minutes each) or a **Long Break** (30 minutes) — each fixed type can be taken
at most once per person per day (`src/domain.js`'s `BREAK_TYPES`, deliberately
not config-driven). Ending one is a single click; there's no separate type
picker for that.

If someone runs over their allotment, or simply forgets to end the break
— the excess is **always derived live** from elapsed time vs. the type's
allotment, never stored, so it's correct the moment someone looks, not just
when the break ends. It shows up wherever break time already appears: the
header button, My Day, the Team table, an employee's break history, and the
Overview "currently working on" cards. Nothing pages anyone about it — it's a
passive signal, not an alert.

---

## Deploying

The app needs two things from its host: a reachable **MySQL database** (8.0+),
and — separately — a **persistent disk** for uploaded task attachments
(`DATA_DIR`, not covered by a MySQL backup). Anything that gives you both
will do.

### Docker (simplest)

```bash
echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" > .env
echo "DATABASE_URL=mysql://tcc_app:change-me@<mysql-host>:3306/tcc" >> .env
docker compose up -d --build
docker compose exec app node scripts/seed.js          # or create-manager.js
```

Attachments live in the `tcc-data` volume; the database itself is wherever
`DATABASE_URL` points, so back that up separately (see Backups below).

### A plain server with nginx

```bash
git clone <your repo> /srv/tcc && cd /srv/tcc
npm install --omit=dev
cp .env.example .env && $EDITOR .env   # set SESSION_SECRET and DATABASE_URL
npm run seed
sudo tee /etc/systemd/system/tcc.service > /dev/null <<'UNIT'
[Unit]
Description=Team Control Center
After=network.target
[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/tcc
ExecStart=/usr/bin/node --env-file-if-exists=.env src/server.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now tcc
```

nginx in front, with the one line SSE needs:

```nginx
server {
  server_name tasks.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;            # required — /api/stream is Server-Sent Events
    proxy_read_timeout 3600s;
  }
}
```

Then `certbot --nginx -d tasks.example.com`. **Serve it over HTTPS**: the session
cookie is marked `Secure` in production, so plain HTTP will not keep anyone
signed in. If you must run HTTP on a private network, set `INSECURE_COOKIES=1`.

### Platform hosting

Railway, Render, Fly.io and similar all work — set `SESSION_SECRET` and
`DATABASE_URL` (pointing at that platform's managed MySQL add-on, or one you
run elsewhere), and attach a **persistent disk** for `DATA_DIR` if you want
uploaded attachments to survive a redeploy (most free tiers don't offer one).
A platform with a fully ephemeral filesystem (Vercel, Netlify, Lambda) is
still fine for the app itself now that the database is MySQL, not a local
file — attachments are the only thing left needing a disk.

### Environment

| Variable | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | — | **Required**, 24+ random characters. Changing it signs everyone out. |
| `DATABASE_URL` | — | **Required.** `mysql://user:pass@host:port/database`. |
| `DATA_DIR` | `./data` | Where uploaded attachments live (`DATA_DIR/uploads`). Must be on a persistent disk in production. |
| `PORT` | `3000` | |
| `NODE_ENV` | | `production` enables the Secure cookie flag and static caching. |
| `SESSION_DAYS` | `14` | How long a sign-in lasts. |
| `TRUST_PROXY` | `1` | Number of proxies in front. `0` if none. |
| `INSECURE_COOKIES` | | Set to `1` only for HTTP on a private network. |

---

## Backups

```bash
npm run backup                    # -> ./backups/tcc-YYYY-MM-DD-HHmm.sql.gz (mysqldump)
0 2 * * * cd /srv/tcc && /usr/bin/npm run backup    # nightly, keeps 30
```

Requires `mysqldump` on PATH; it dumps via `DATABASE_URL`, safe to run while
the server is up (`--single-transaction`). Restore: `gunzip -c backups/tcc-....sql.gz | mysql -u ... -p ... tcc`.
Uploaded attachments (`DATA_DIR/uploads`) aren't part of this dump — back that
directory up separately (a plain file copy/rsync is fine, it's not a database).

---

## Testing

```bash
npm start        # in one terminal, against a scratch database
npm test         # in another
```

`npm test` chains three scripts, all hitting the live API directly rather than
going through the interface — that's how someone would actually try to get
around a rule:

- **`scripts/smoke-test.js`** (50 checks) — validation rules, the audit trail,
  and every permission boundary.
- **`scripts/security-test.js`** (44 checks) — session/cookie hardening
  (forged and garbage cookies fail closed), the login throttle, session
  fixation after a password change, cross-user authorization boundaries
  (IDOR) across breaks/notifications/attachments, upload validation (MIME
  type, size limit), and input validation edges. Runnable on its own via
  `npm run test:security`.
- **`scripts/notif-test.js`** (18 checks) — client-side notification and
  @mention logic, loaded into a `vm` sandbox against the real `public/app`
  source rather than reimplemented.

All three write data, so point them at a scratch database, never production.

---

## Scale

Comfortable as-is: a few hundred people, tens of thousands of tasks, hundreds of
thousands of activity rows. `GET /api/bootstrap` sends the whole board in one
response and the browser derives everything locally, which is what makes the
dashboard feel instant.

Two thresholds to watch:

1. **Around 10–20k tasks**, the bootstrap payload gets heavy. Paginate
   `GET /api/tasks` (add `?since=` and `?status=`) and have the client hold a
   window instead of everything. The metrics functions already take a task list,
   so they don't change.
2. **More than one server process.** The database itself (MySQL, behind a
   connection pool in `db.js`) is already fine with multiple app processes
   talking to it concurrently. What isn't multi-process-safe yet is the SSE
   hub in `events.js` — it broadcasts live updates in-memory, so two app
   processes wouldn't see each other's events. That would need Redis pub/sub
   or MySQL's own notification mechanisms to fan out across processes.

`node_modules` aside, the whole thing is about 6,000 lines. It is meant to be
read.

---

## Built-in extension points

- **Notifications** are computed from the activity log rather than stored, so
  turning one off in Settings hides it without losing the record. Emailing them
  is a cron job over `task_activity` — nothing else has to change.
- **Statuses, priorities, departments, teams, categories, staleness thresholds,
  workload bands, working days and default deadlines** are all rows in `config`,
  editable in Settings. None of them are hardcoded. (Break types are the one
  deliberate exception — see "Break tracking" above.)
- **Integrations** (Slack, Teams, Jira, and so on) fit as new files under
  `src/routes/`. The data model is already normalised enough to answer questions
  like "which tasks have been blocked for more than two days" or "what did the
  SEO team complete this week" with a single query.
