# Team Control Center

An internal task tracker and management dashboard. Every person maintains their
own tasks; the manager gets a live view of who is working on what, what is
overdue, what is blocked, and who is overloaded — without asking anyone.

Built to be boring to run: one Node process, one SQLite file, three
dependencies. No build step, no bundler, no external services. It will handle a
team of a few hundred on the smallest server you can rent.

---

## Quick start

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET — see below
npm run seed                  # demo team, 5 projects, 58 tasks
npm start                     # http://localhost:3000
```

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The seed prints the sign-in details. Every seeded account starts on the password
`controlcenter1` and is asked to change it after signing in. Sign in as
`asha.raman@demo.example` for the manager view, anyone else for the employee
side.

**Starting with real data instead:** skip `npm run seed` and create the first
manager directly. Everyone else gets added from Settings → People inside the app.

```bash
npm run create-manager -- "Manager Name" asha.raman@demo.example
```

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
    tasks.js       the single write path for tasks, plus bulk and comments
    admin.js       people, projects, settings, daily updates, /api/bootstrap
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
  seed.js          demo data (dates shift so "today" always looks right)
  create-manager.js
  backup.js
  smoke-test.js    50 API checks, including every permission rule
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
- **`workload(employeeId)`** — deliberately *not* a task count. Each open task
  contributes `priority weight × remaining-effort factor × deadline urgency`.
  Blocked work costs attention at roughly half capacity plus a fixed penalty,
  because it occupies a person without consuming their hours. Bands are
  configurable in Settings.
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

Email and password, hashed with bcrypt (cost 12), server-side sessions in the
`sessions` table, signed httpOnly `SameSite=Lax` cookie. Failed logins are
throttled per email+IP.

Adding someone in Settings → People returns a temporary password **once**. Pass
it to them; they are prompted to replace it on first sign-in. Lost it? Reset the
password from the same dialog. Changing a password signs that person out
everywhere else.

**Swapping in Google or Microsoft SSO later:** replace `POST /api/auth/login` in
`src/auth.js` with your provider's callback and keep issuing the same session
cookie. Nothing downstream reads anything but `req.user`.

---

## Deploying

The app needs one thing from its host: a **persistent disk** for the SQLite
file. Anything that gives you that will do.

### Docker (simplest)

```bash
echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" > .env
docker compose up -d --build
docker compose exec app node scripts/seed.js          # or create-manager.js
```

Data lives in the `tcc-data` volume. Back it up.

### A plain server with nginx

```bash
git clone <your repo> /srv/tcc && cd /srv/tcc
npm install --omit=dev
cp .env.example .env && $EDITOR .env
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

Railway, Render, Fly.io and similar all work — set `SESSION_SECRET`, attach a
volume, and point `DATABASE_PATH` at it. Do **not** use a platform with an
ephemeral filesystem (Vercel, Netlify, Lambda) without moving to Postgres first;
the SQLite file would vanish on every deploy.

### Environment

| Variable | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | — | **Required**, 24+ random characters. Changing it signs everyone out. |
| `DATABASE_PATH` | `./data/tcc.db` | Must be on a persistent disk. |
| `PORT` | `3000` | |
| `NODE_ENV` | | `production` enables the Secure cookie flag and static caching. |
| `SESSION_DAYS` | `14` | How long a sign-in lasts. |
| `TRUST_PROXY` | `1` | Number of proxies in front. `0` if none. |
| `INSECURE_COOKIES` | | Set to `1` only for HTTP on a private network. |

---

## Backups

SQLite is a single file, but don't copy it while the server is running — use the
online backup API:

```bash
npm run backup                    # -> ./backups/tcc-YYYY-MM-DD-HHmm.db
0 2 * * * cd /srv/tcc && /usr/bin/npm run backup    # nightly, keeps 30
```

Restore: stop the app, replace `data/tcc.db` (and delete any `-wal` / `-shm`
alongside it), start again.

---

## Testing

```bash
npm start        # in one terminal, against a scratch database
npm test         # in another
```

`scripts/smoke-test.js` runs 50 checks against the live API — validation rules,
the audit trail, and every permission boundary, asserted by calling the API
directly rather than through the interface, since that is how someone would
actually try to get around it. It writes data, so point it at a scratch
database, never production.

---

## Scale, and when to leave SQLite

Comfortable as-is: a few hundred people, tens of thousands of tasks, hundreds of
thousands of activity rows. `GET /api/bootstrap` sends the whole board in one
response and the browser derives everything locally, which is what makes the
dashboard feel instant.

Two thresholds to watch:

1. **Around 10–20k tasks**, the bootstrap payload gets heavy. Paginate
   `GET /api/tasks` (add `?since=` and `?status=`) and have the client hold a
   window instead of everything. The metrics functions already take a task list,
   so they don't change.
2. **More than one server process.** SQLite is fine for one; the moment you want
   two, move to Postgres. `schema.sql` ports almost unchanged — `TEXT` dates and
   JSON columns work as-is, or convert them to `timestamptz` and `jsonb`. Swap
   `better-sqlite3` for `pg` in `db.js`; nothing outside that file touches SQL.
   The SSE hub in `events.js` would then need Redis pub/sub or Postgres
   `LISTEN/NOTIFY` so both processes broadcast to each other.

`node_modules` aside, the whole thing is about 6,000 lines. It is meant to be
read.

---

## Built-in extension points

- **Notifications** are computed from the activity log rather than stored, so
  turning one off in Settings hides it without losing the record. Emailing them
  is a cron job over `task_activity` — nothing else has to change.
- **Statuses, priorities, departments, teams, categories, staleness thresholds,
  workload bands, working days and default deadlines** are all rows in `config`,
  editable in Settings. None of them are hardcoded.
- **Integrations** (Slack, Teams, Jira, and so on) fit as new files under
  `src/routes/`. The data model is already normalised enough to answer questions
  like "which tasks have been blocked for more than two days" or "what did the
  SEO team complete this week" with a single query.
