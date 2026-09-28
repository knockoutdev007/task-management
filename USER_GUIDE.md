# Team Control Center: User Guide

Team Control Center is the internal task tracker and management dashboard for the Marketing Team. Everyone signs in with a User ID and password (no email). What you see and can do depends on your role:

- **Manager**: full visibility and control across the whole team.
- **Employee**: their own work, plus a few shared, read-only or lightly-scoped views.
- **Team Lead**: an employee granted specific manager-like powers, but only for their own team (see the note at the end).

Permissions are enforced by the server, not just hidden in the UI, so what's described below is exactly what each role can actually do, not just what they can see.

---

## For Managers

### Overview (your home screen)
The morning screen: a team workload table (who's carrying what, weighted by priority and deadline, not just task count), a "Currently working on" snapshot, a "Requires attention" feed (overdue, blocked, stale or off-track work), upcoming deadlines, and recently completed work. Every KPI tile is clickable and filters the rest of the page.

### Managers Board
A Not Done / Done board (separate from the status-based Board below) with a live assignment timer per task, useful for tracking active hands-on work through to completion.

### Work
- **Board**: kanban by status; drag a card to change its status.
- **All tasks**: the full table, every task, fully filterable and sortable. Select rows for bulk edit, export to CSV, or click **New task** to create and assign work to anyone.
- **Blockers**: every open blocker across the team, oldest first, with a one-click **Resolve**.
- **Projects**: create projects, see progress and a per-person breakdown for each.

### Reporting
- **Daily summary**: auto-generated from task data (not typed by anyone): completed today, in progress, attention items, blockers, and who has/hasn't checked in. Copy as text or export.
- **Day plan board**: everyone's daily checklist on one screen, filterable by team, with a date picker to look back at past days.
- **Analytics**: the weekly management report: week-over-week trends, priority/status distribution, an 8-week completion trend, and a per-person breakdown. Manager-only.

### Culture
- **Good Vibes Wall**: one person is assigned each working day to share something positive. Managers manage the rotation (reorder, skip, reassign today) and can moderate (hide) posts or comments.
- **Complaint Wall**: anyone can submit a complaint; it lands in a manager-only inbox. From there a manager can:
  - **Publish** it to the board (still shown anonymously; nobody, including the submitter, sees who filed it once published)
  - **Start/stop a poll** on a published complaint: everyone votes yes/no on "do you believe this happened as described," and only the manager sees who voted which way (everyone else sees just the running total)
  - **Archive** it, or move it back to the inbox

### Admin
- **Team**: add/edit people, see everyone's workload and break time in one table.
- **Settings**: the control panel for how the app itself behaves:
  - Departments and teams, priorities and staleness thresholds, statuses, extra manager boards, which nav items are visible to managers, and which optional columns show on the All Tasks table
  - Workload bands, working days and default due-date offset, org-wide notification defaults
  - Projects and People management (same actions as the dedicated pages, in one place)
  - **Data and access**: export every task to CSV (always the full set, regardless of any filters left over from the Tasks page), and a one-click **Delete all tasks and projects** for a hard reset (this cannot be undone; comments, attachments and activity history go with their tasks)

### Creating and assigning tasks
As a manager, you can create a task and assign it to anyone (or leave it unassigned), edit any field on any task, and delete tasks outright. Use **New task** from All Tasks or Task Board, or **Assign work** from a person's card on Overview/Team.

---

## For Employees

### My Day (your home screen)
Today's and upcoming tasks, your workload breakdown, and quick actions: **Add task**, **Update progress**, **Mark complete**, **Report a blocker**, and **Post today's update**. Also shows your delivery signals (a 4-week rolling health score) and today's break log.

### Board & Task Board
The same kanban and Not Done/Done views managers use, scoped to your own work (or your team's, if you're a team lead with the right capability; see below).

### All tasks
The same filterable table, scoped to tasks you're assigned to or created.

### Projects
Read-only: browse project progress and who's working on what.

### Daily update
Your personal checklist for today: add items, tick them off as you go, saved automatically. Past updates are kept for reference.

### Good Vibes Wall
When it's your turn in the rotation, post something (a thought, a win, something funny). Anyone can like and comment on any post, any time.

### Complaint Wall
- **Submit a complaint** any time: it goes straight to a manager-only inbox. Only a manager ever sees who submitted it.
- If a manager publishes it, it appears on the wall **anonymously**, even to you, the person who wrote it.
- If a manager starts a poll on it, you can vote **Yes/No** on "do you believe this happened as described." You'll see the running total; only managers see individual votes.

### Breaks
Start a break from the topbar: **Short Break 1** (15 min), **Short Break 2** (15 min), or **Long Break** (30 min), one of each per day. Your break history shows on My Day and on your profile.

### Account
From the account menu: change your password, and override the org-wide notification defaults just for yourself.

### Creating tasks
As an employee, you can create tasks, but only assigned to yourself; the assignee field is locked to you unless you're a team lead with the "tasks" capability (see below), in which case you can also assign within your own team.

---

## A note on Team Leads

A Team Lead is an employee who has been granted one or more specific capabilities by a manager (in Settings → People). Each capability unlocks one manager-shaped screen or action, scoped strictly to their own team:

| Capability | Unlocks |
|---|---|
| `team` | The Team page, for their own team |
| `tasks` | Assigning, editing and completing tasks for their team (also scopes Board / All Tasks / Task Board to their team) |
| `blockers` | The Blockers page |
| `working` | The "Currently working on" page |
| `daily` | The Daily summary page |
| `dayboard` | The Day plan board page |
| `goodvibes` | Managing today's Good Vibes Wall turn for their team |

A team lead never gets Settings, Analytics, Overview, or Data and access, and never manages the Complaint Wall; those stay manager-only regardless of capabilities.
