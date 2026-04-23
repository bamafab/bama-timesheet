# How to push code from a chat (Claude.ai / ChatGPT) back into GitHub

This is for when you don't have Claude Code running and you've been working in a
browser chat. You only need a web browser — no terminal, no Git install needed.

---

## Before you start

Have these two things open in separate browser tabs:

1. The chat where the AI gave you the updated code.
2. The repo on GitHub: **https://github.com/bamafab/bama-timesheet**

---

## Giving the AI context at the start of a chat

Before asking the AI to change anything, paste two things into the chat:

1. **`CLAUDE.md`** — open it on GitHub, click the **Raw** button, select all, copy,
   paste into the chat. This is the project briefing.
2. **The file(s) you want to change** — same trick. Open the file on GitHub, click
   **Raw**, copy the whole contents, paste into the chat.

Then tell the AI what you want changed.

---

## Editing a single file on GitHub (easiest case)

The AI gives you updated code. To get it into the repo:

1. On GitHub, navigate to the file you want to replace (e.g. `index.html`).
2. Click the **pencil icon** (top right of the file view) — "Edit this file".
3. Select all the existing content (Ctrl+A) and delete it.
4. Paste in the new version from the chat.
5. Scroll down to **Commit changes**.
6. In the top box, write a short description of the change (e.g.
   `Fix clock-out button alignment on kiosk`).
7. Leave "Commit directly to the main branch" selected.
8. Click the green **Commit changes** button.

That's it. GitHub saves it, and the deploy workflow automatically pushes it live
within a couple of minutes.

---

## Adding a brand-new file

1. On GitHub, go to the folder where the file should live (usually the repo root).
2. Click **Add file** → **Create new file** (top right).
3. Type the filename at the top (e.g. `new-page.html`).
4. Paste the content into the editor.
5. Scroll down, write a commit message, click **Commit changes**.

---

## Deleting a file

1. Open the file on GitHub.
2. Click the **trash icon** (top right).
3. Write a commit message, click **Commit changes**.

---

## Checking that your change went live

1. Wait ~2 minutes after committing.
2. Go to the **Actions** tab on GitHub: https://github.com/bamafab/bama-timesheet/actions
3. The latest workflow run should have a green tick. If it has a red cross, click
   into it and paste the error into a chat — the AI can tell you what broke.
4. Then open the live site (Hub: https://proud-dune-0dee63110.2.azurestaticapps.net)
   and check your change is there. You may need to Ctrl+F5 to force refresh.

---

## Cache-busting reminder

If you changed `shared.js` or `bama.css`, the browser may serve an old cached
version. The project uses a version tag in the HTML files like `?v=20260326a` to
force browsers to re-download.

When updating those two files:
- In **every HTML file** (`index.html`, `hub.html`, `manager.html`, `office.html`,
  `projects.html`), find the line that loads `shared.js` or `bama.css`.
- Change the version tag. Format: today's date + a letter.
  Example: first push on 26 March 2026 → `?v=20260326a`. Second push same day →
  `?v=20260326b`.

If you forget, users will see stale code until their browser cache expires.

---

## Keeping CLAUDE.md fresh

`CLAUDE.md` is the "briefing document" for any AI working on this project. If the
change you just made is **architectural** — a new page, a new database table, a
new workflow, a changed convention — also update `CLAUDE.md` in the same commit
(or a commit right after).

If you're not sure whether CLAUDE.md needs updating, ask the AI: "Does this change
need a CLAUDE.md update?" and paste the current version in.

---

## If something goes wrong

- **Deploy fails (red cross on Actions tab):** Click into the failed run, scroll to
  the red step, copy the error message. Paste it into a chat and ask for a fix.
- **Site shows old code after deploying:** Hard refresh the page (Ctrl+F5). If
  that doesn't work, you probably forgot to bump the cache-bust version.
- **You committed something broken to main:** On GitHub, go to the **Commits** list,
  find the last good commit, copy its ID. Then in a chat, paste the ID and say
  "please revert main to this commit" and follow the instructions.
