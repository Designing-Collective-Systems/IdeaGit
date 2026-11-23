# IdeaForest – variant 2 (Idea Tree only)

Flow: **open the site → consent form → Idea Tree (`/app`)**. There are no logins.
Each new visitor is automatically given the next PID (`P0001`, `P0002`, …) in the database; the user never sees it.
The PID is linked to their consent name/time, their ideas and their answers. Concurrent visitors always get different PIDs
(numbers come from a Postgres sequence). There are **no cookies**: every browser **tab** that opens the site becomes a new
participant. The tab keeps a random secret in its own `sessionStorage`, so refreshing that tab resumes the same participant,
while a new tab (or window) starts a new one. Closing a tab ends that participant's session; their saved data stays in the database.
(Note: browsers copy `sessionStorage` when a tab is *duplicated*, so a duplicated tab shares the original's PID.)
Pressing **Done with Task** shows, for every finalized idea, three text-box questions
(idea tree on the left half, questions on the right half, all on one scrollable page):

1. Did you use AI to ideate? If yes, how? If no, why not?
2. Did you explore multiple ideas? Why?
3. Did you refine your idea? Why?

No influence ratings, self-reports or reflections are asked in this variant.

## Files (copy the whole folder, delete any old app1/app2/login files)

```
Procfile  package.json  server.js  db.js  .gitignore  README.md
views/    consent.html  app.html  admin.html
public/   app.js  session.js  shared.js  prompts.js  styles.css  fonts/*.ttf
          consent.pdf   <-- YOU must add this file (shown inside the consent page)
```

## Heroku setup

1. `heroku create` (or use an existing app), add the Postgres add-on (`DATABASE_URL` is set automatically).
2. Config vars:
   - `ANTHROPIC_API_KEY` – your Anthropic key
   - `ADMIN_PASSWORD` – password for `/admin` (username can be anything)
   - optional `CLAUDE_MODEL` – defaults to `claude-sonnet-5-5`
3. `git push heroku main`. Tables are created automatically on first start
   (`ideagit2_users`, `ideagit2_nodes`, `ideagit2_final_answers`).

## Data

`/admin` (Basic auth) lists participants and downloads
`ideas.csv` (every idea version with prompts, AI responses, edit history) and
`final_answers.csv` (the three answers per finalized idea). Individual participants can be deleted there.
The `pid` column in both CSVs identifies the participant; consent name and time are on the participant list (database `ideagit2_users`: `username` = PID, `consent_name`, `consented_at`).
