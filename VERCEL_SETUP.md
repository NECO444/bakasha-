# BAKASHA on Vercel (no Firebase, no Cloudflare, no accounts)

Everything runs on one Vercel project:

- `public/` – the website (index.html, styles.css, app.js)
- `api/rooms/…` – the game server (Vercel Functions)
- `lib/engine.js` – the game rules; the server owns the deck and both hands
- Upstash Redis (free, added from Vercel) – stores rooms for 24 hours

Players type a name. The server gives each player a secret token that the browser
keeps, and only ever sends back that player's own hand.

## Deploy (about 10 minutes)

1. Put this folder in a GitHub repository (or use the Vercel CLI: `npm i -g vercel`, then `vercel` in this folder).
2. In Vercel: **Add New → Project**, import the repository. Leave Framework Preset as **Other**. Deploy.
3. In the project: **Storage** (or **Marketplace**) → **Upstash Redis** → create a free database → connect it to this project.
   Vercel adds the connection variables for you.
4. **Redeploy** (Deployments → ⋯ → Redeploy). New environment variables only apply to new deployments.
5. Open your Vercel URL, enter a name, **Create an invite link**, and send it to your friend.

If you see "Storage is not set up", step 3 or 4 was skipped.

## Playing

- The room creator starts the game once the friend has joined.
- Reloading the page or reopening the invite link reconnects you automatically on the same browser.
- A new browser or cleared site data means you can't rejoin that seat. Create a new room.
- Anyone who opens the invite link first takes the second seat, so send it privately.

## Test locally

```
npm install
npm test
```

The tests cover the rules (including a 300-game random-play check that no card is ever lost or duplicated)
and the room flow (create, join, start, reconnect, hidden hands).

To run the whole site locally with real Redis: `vercel link`, `vercel env pull`, `vercel dev`.

## Limits and privacy

- Polling: every 2 s while waiting for your opponent, every 5 s on your own turn, every 3–4 s in the lobby and after the game ends.
  Hidden tabs stop polling. Check Vercel's and Upstash's current free-plan limits; they change.
- Rooms are deleted after 24 hours without activity.
- This is not end-to-end encryption: the server must know the cards. Whoever owns the Vercel/Upstash account can technically read them.
- Vercel Hobby is for non-commercial use.

## Old files you can delete

`firebase.json`, `database.rules.json`, `firebase-config.js`, `FIREBASE_SETUP.md`, and the `cloudflare/` folder.
