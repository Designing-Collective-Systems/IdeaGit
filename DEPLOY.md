# IdeaGit — Heroku Deployment

## Folder structure

```
ideagit-heroku/
├── server.js        — Express server (proxy + static file serving)
├── package.json     — Node dependencies
├── Procfile         — Tells Heroku how to start the app
├── .gitignore
└── public/          — All frontend files (served statically)
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── prompts.js
    └── challenges.js
```

The API key lives **only** on Heroku as an environment variable — it is never sent to the browser.

---

## One-time setup

### 1. Install prerequisites (if you haven't already)

- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)

### 2. Install dependencies locally

```bash
cd ideagit-heroku
npm install
```

### 3. Create a Heroku app

```bash
heroku login
heroku create ideagit-study   # or any name you like
```

### 4. Set your API key as a Heroku environment variable

```bash
heroku config:set ANTHROPIC_API_KEY=sk-ant-your-key-here
```

This is the **only** place your key ever lives. It is not in any file.

### 5. Deploy

```bash
git init
git add .
git commit -m "initial deploy"
git push heroku main
```

### 6. Open the app

```bash
heroku open
```

Your app is live at `https://ideagit-study.herokuapp.com` (or whatever name you chose).

---

## Redeploying after changes

Whenever you edit any file (e.g. update `challenges.js` with new challenges):

```bash
git add .
git commit -m "updated challenges"
git push heroku main
```

---

## Updating the design challenges

Edit `public/challenges.js` — this is the only file you need to touch to add/remove/edit challenges. Then redeploy with the three git commands above.

---

## Cost

Heroku's **Eco dynos** plan costs **$5/month** and is more than sufficient for a user study. Sign up at heroku.com and select Eco when creating your app.

Your main running cost is Anthropic API usage — typically **$2–8** for a full user study session depending on how many participants and how much they interact with the AI features.

---

## Checking logs (useful for debugging)

```bash
heroku logs --tail
```
