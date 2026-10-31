# Limbo - Feedback website (Vercel + Make + Google Sheets)

A website where the feedback players write inside the game is posted, plus an **admin panel** (`/admin`) where you can
**edit, hide / show and delete** feedback. Your **Google Sheet is the database**.

    Game  --POST-->  this site (/api/feedback)  --POST-->  your Make webhook  -->  Google Sheet
                                                                                       |
    Public page + admin panel  <------------ read / edit / delete (Google Sheets API) --+

* The game sends feedback to **this site**, not straight to Make. The site checks and cleans the text, limits spam and keeps
  your Make webhook address **secret** (a webhook address placed inside the game's public code could be used by anybody to fill your sheet).
* The site **reads** the sheet through the Google Sheets API, so the public page and admin panel always show what is in the sheet.
  (Reading through Make would need a Make run for every visitor and quickly use up its free operations.)

        api/        serverless functions (/api/feedback, /api/site, /api/admin/...)
        lib/        shared code (Google Sheets, login, validation)
        public/     the pages: index.html (public), admin.html, css/, js/
        vercel.json security headers + "serve public/"       dev-server.js  run on your computer       test/  npm test

## Set it up (about 20 minutes)

### 1. The Google Sheet
1. Create a Google Sheet. Rename the first tab to **`Feedback`**.
2. Type these headers in **row 1, columns A to J** (exactly):

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| id | createdAt | date | anonymous | name | title | content | hidden | edited | updatedAt |

3. Copy the **spreadsheet ID** from the sheet's address: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`. This is `GOOGLE_SHEET_ID`.

### 2. Let the website use the sheet (Google "service account")
1. Go to console.cloud.google.com, create a project (or pick one) and **enable the "Google Sheets API"** (APIs & Services > Library).
2. **IAM & Admin > Service Accounts > Create service account** (any name, no roles needed).
3. Open the new service account > **Keys > Add key > Create new key > JSON**. A `.json` file downloads. **Keep it private - never put it on GitHub.**
4. Open that JSON file and copy the `client_email` (looks like `name@project.iam.gserviceaccount.com`).
5. In your Google Sheet press **Share**, paste that email and give it **Editor** access.
6. The **whole contents of the JSON file** will become the `GOOGLE_SERVICE_ACCOUNT_JSON` variable (step 4 below).

(Google's menu names sometimes change a little; the idea stays the same: a robot account with a key, shared on your sheet.)

### 3. Your Make scenario (adds the rows)
1. In Make open your scenario with the **Custom webhook** you already created.
2. Open the webhook module and press **Run once** (it now waits for data). Then send one test feedback (see step 6 below, or run
   `npm run dev` here and send one from the game). Make learns the fields: `id, createdAt, date, anonymous, name, title, content, hidden, edited, updatedAt`.
   (Later, if you change fields: webhook > **Redetermine data structure**.)
3. Add **Google Sheets > Add a Row**: choose your spreadsheet and the `Feedback` tab, then map **each column to the webhook field with the same name**
   (A id, B createdAt, C date, D anonymous, E name, F title, G content, H hidden, I edited, J updatedAt).
   If the module offers a *Value input option*, choose **Raw**. Leave the empty `updatedAt` empty.
4. Turn the scenario **ON** (scheduling: *Immediately as data arrives*).

You can add more modules after it (email / Discord notification...) - the site does not care.
The site shows feedback as soon as its row is in the sheet.

### 4. GitHub + Vercel
1. Push the contents of this folder to a new GitHub repo (files at the top level: `api/`, `lib/`, `public/`, `vercel.json`...). `.env` files are ignored by git.
2. On vercel.com: **Add New > Project**, import the repo, framework **Other**, no build command, **Deploy**.
3. **Settings > Environment Variables** - add:

| Variable | Value |
|----------|-------|
| `ADMIN_PASSWORD` | **required** - your admin login (use 12+ characters) |
| `GOOGLE_SHEET_ID` | **required** - the ID from step 1.3 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **required** - paste the whole JSON key file |
| `MAKE_WEBHOOK_URL` | your Make webhook address (keep it secret - only ever put it here) |
| `CORS_ORIGINS` | your game's address, e.g. `https://yourname.github.io` (origin only: no path, no trailing `/`) |
| `GAME_URL` | link to your game (shows a "Play the game" button) |

4. **Redeploy** (Deployments > latest > Redeploy) - new variables only apply to new deployments.

### 5. Connect the game
In the **game** repository, `js/config.js`:

    const FEEDBACK_URL = 'https://YOUR-PROJECT.vercel.app/api/feedback';

### 6. Test
Open `https://YOUR-PROJECT.vercel.app/admin`, log in, send a feedback from the game: Make adds the row, then it shows on the public page.
Allow up to a minute: Make runs, the site re-reads the sheet (cached 10 s) and Vercel caches the public page (30 s).

> If `MAKE_WEBHOOK_URL` is empty the site adds rows to the sheet itself (instant, no Make needed).

## Good to know

* **You can edit the sheet directly.** Change a title, type `TRUE` in the `hidden` column to hide a feedback, or delete a row - the site follows
  (after the short cache time). Do not rename the headers or the `Feedback` tab and keep the `id` values (they start with `f`).
  A row without a valid `id` is ignored.
* **Spreadsheet safety:** text that starts with `=`, `+`, `-` or `@` could run as a formula in Google Sheets, so the site adds a `'` in front.
  Google hides that `'`; the site removes it again when reading. (This is why you should never mix other data into the `title` / `content` columns.)
* **Speed and limits:** Google's API is slower than a normal database and has request limits. The caches (`SHEET_CACHE_SECONDS`, `PUBLIC_CACHE_SECONDS`) keep it fast.
  A sheet is fine for thousands of feedbacks, not millions. The admin panel loads the newest 1000.
* **Spam protection is "best effort".** Without a database the site cannot remember visitors between server restarts, so the limit
  (5 feedback per visitor per 10 minutes) and the admin-login lockout only work inside one running instance. Stronger options:
  `REQUIRE_APPROVAL=1` (nothing is shown until you press Show), and a rate-limit rule in Vercel's Firewall (Project > Firewall).
* **Changing the admin password:** change `ADMIN_PASSWORD` in Vercel and redeploy - everybody is logged out.
* **If your Make webhook address leaks** (for example it was pasted somewhere public), create a new webhook in Make and update `MAKE_WEBHOOK_URL`.
* **Backups:** the sheet is your backup (Google keeps its version history: File > Version history). The admin **Backup** button also downloads a `.json` copy.
* Vercel's and Make's free plans have limits (Make counts operations per month; Vercel's free plan is meant for personal, non-commercial projects).
  Check their current terms, especially if your game earns money.

## Optional settings

| Variable | Default | Meaning |
|----------|---------|---------|
| `REQUIRE_APPROVAL` | off | `1` = new feedback is hidden until you press Show |
| `SITE_TITLE` | `Limbo` | title at the top of the public page |
| `SUBMIT_MAX` | `5` | feedback per visitor per 10 minutes |
| `PUBLIC_CACHE_SECONDS` | `30` | how long Vercel may cache the public list (`0` = never) |
| `SHEET_CACHE_SECONDS` | `10` | how long the site remembers what it read from the sheet (`0` = never) |
| `GOOGLE_SHEET_TAB` | `Feedback` | name of the tab |
| `SESSION_SECRET` | - | optional extra secret for the admin login cookie |

## Run it on your computer

    npm run dev          # Node.js 18+; open http://localhost:3000  (PowerShell: $env:ADMIN_PASSWORD="my-test-password"; npm run dev)

Without the Google variables a **temporary in-memory** store is used (data is lost when you stop it). To test with your real sheet,
put the variables from `.env.example` into a file called `.env.local` (git ignores it). `npm test` runs the automated tests (no accounts needed).

## What the Make webhook receives

One JSON object per feedback, with exactly the sheet's columns:

    { "id": "f1a2b3c4d5e6", "createdAt": 1761825000000, "date": "2026-10-30T12:30:00.000Z", "anonymous": false,
      "name": "Alex", "title": "Great game", "content": "I love the Swirl sword!", "hidden": false, "edited": false, "updatedAt": "" }

`createdAt` is milliseconds since 1970 (the site uses it for sorting); `date` is the same moment in readable form for you.
`hidden` is `true` when `REQUIRE_APPROVAL=1`.

## API (for reference)

| Request | Who | Does |
|---------|-----|------|
| `GET /api/feedback?page=1` | everyone | published feedback, newest first (20 per page) |
| `POST /api/feedback` `{anonymous, name, title, content}` | everyone (the game) | add feedback |
| `POST /api/admin/login` `{password}` | admin | log in |
| `GET /api/admin/feedback` | admin | newest 1000 incl. hidden |
| `PATCH /api/admin/feedback/:id` `{name, title, content, hidden}` | admin | edit / hide / show (updates the sheet row) |
| `DELETE /api/admin/feedback/:id` | admin | delete (removes the sheet row) |
