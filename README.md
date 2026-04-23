---
title: FriendlyBot (Discord + Dashboard)
emoji: ⚽
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

## What this Space runs

Node.js **Discord bot** (`index.js`) plus a small **web dashboard** on port **7860** (required by Hugging Face). The Docker `CMD` runs `start.sh`, which **restarts the bot automatically** if it crashes or exits so the process keeps coming back.

## Make it stay online on Hugging Face

1. **Secrets (required)**  
   In the Space → **Settings** → **Variables and secrets** → **New secret**:
   - `BOT_TOKEN` — your Discord bot token (same value you use locally in `.env`).

   Do **not** commit the token into the repo. HF injects secrets as environment variables at runtime.

2. **Discord Developer Portal (required or the bot stays “connecting”)**  
   [Applications](https://discord.com/developers/applications) → your bot → **Bot** → under **Privileged Gateway Intents** enable **Presence** is optional; enable **Server Members Intent** and **Message Content Intent** (this codebase requests both). Save, then **restart** the Space.

3. **Sleep vs true 24/7**  
   On **free** hardware, Spaces can **pause after inactivity** (policy changes over time; check [Spaces hardware](https://huggingface.co/docs/hub/spaces-overview)). The bot already **HTTP-pings its own public URL** every ~2 minutes when HF env vars are present (`SPACE_HOST`, `SPACE_ID`, or `SPACE_AUTHOR_NAME` + `SPACE_REPO_NAME`) to reduce idle sleep when the Space is running.

   For **guaranteed** always-on behavior (no sleep, stronger SLA), use **paid** Space hardware and, if offered in your Space settings, disable or extend **sleep time**.

4. **After every git push**  
   HF rebuilds the Docker image and restarts the Space. Wait until the Space shows **Running**; check **Logs** for `Slash commands synchronized` and Discord online messages.

5. **Invite the bot**  
   Use an invite URL that includes the **`applications.commands`** scope so slash commands appear in your server.

## Local Windows

Use `start.bat` in this folder (keeps restarting `node index.js` on your PC). Your PC must stay on for the bot to stay online locally.
