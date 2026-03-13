# IdeaGit

A browser-based design ideation tool that tracks every version of an idea using a Git-like branching model. Built with Node.js, Express, and the Anthropic Claude API.

---

## What it does

IdeaGit lets users generate, modify, and explore design ideas for a given challenge. Every modification — whether made manually or with AI assistance — creates a new node in a branching tree, so no version is ever lost. Users can view all their ideas as an interactive graph and export their session as a CSV file.

---

## Project structure

```
/
  server.js           Express server and Claude API proxy
  package.json
  public/
    landing.html      Landing page with slideshow instructions
    app.html          Main application
    app.js            Application logic
    prompts.js        All Claude prompt definitions
    challenges.js     Design challenge definitions
    styles.css        All styles
    instructions/     Slide images (slide1.png through slide7.png)
```

---

## Setup

### Prerequisites

- Node.js 18 or higher
- An Anthropic API key — get one at https://console.anthropic.com

### Steps

1. Clone the repository:

   ```
   git clone https://github.com/your-username/ideagit.git
   cd ideagit
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set your API key as an environment variable. The exact method depends on your platform or hosting provider, but the variable name must be:

   ```
   ANTHROPIC_API_KEY=your_key_here
   ```

   For local development, you can create a `.env` file in the project root. The server reads this variable at startup and it is never sent to the client.

4. Start the server:

   ```
   npm start
   ```

5. Open http://localhost:3000 in your browser.

---

## Deploying

The application is a standard Node.js/Express server. It can be deployed on any platform that supports Node.js 18+, such as Heroku, Railway, Render, Fly.io, or a VPS.

The only requirement is that the `ANTHROPIC_API_KEY` environment variable is set on the server before startup. Refer to your platform's documentation for how to set environment variables.

The entry point is `server.js` and the start command is `node server.js`.

---

## Adding or editing design challenges

All challenges are defined in `public/challenges.js`. Each entry has a `title` shown in the dropdown and a `description` sent to the AI. Edit this file to add, remove, or change challenges, then restart the server.

Example entry:

```js
{
  title: "Challenge 1 — Shopping Cart for Older Adults",
  description: "Design a feature to improve an older adult's shopping experience when using a regular shopping cart. The feature should not cost more than $200."
}
```

---

## Adding instruction slide images

The instructions slideshow expects seven images at:

```
public/instructions/slide1.png
public/instructions/slide2.png
...
public/instructions/slide7.png
```

Recommended size: 1200 x 675 px (16:9). Images are displayed at full width with no cropping. If an image file is missing, that slide's image area is hidden and only the text is shown.

Each slide covers:

1. Selecting a design challenge
2. Generating a first idea
3. The four modify actions
4. The Modify with AI workflow
5. The navigation bar
6. Graph view
7. The participant task

---

## How the Claude API proxy works

The server exposes a single endpoint, `POST /api/claude`, which forwards requests to the Anthropic API. The API key is stored only in the server environment and is never exposed to the browser. All AI calls from the frontend go through this proxy.

The model used is `claude-sonnet-4-20250514`. To change it, edit the `callClaude` function in `public/app.js`.

---

## Environment variables

| Variable            | Required | Description                    |
|---------------------|----------|--------------------------------|
| ANTHROPIC_API_KEY   | Yes      | Your Anthropic API key         |
| PORT                | No       | Server port, defaults to 3000  |

---

## Notes

- Sessions are not persisted on the server. All idea data lives in the browser for the duration of the session. Use the Export CSV button before closing the browser or switching challenges.
- The tool runs in light mode only. Dark mode is not currently active.
- There is no login or authentication layer. The tool is intended for controlled research or classroom use where a shared deployment is acceptable.
