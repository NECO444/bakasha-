# BAKASHA on Vercel (no Firebase, no Cloudflare, no player email)

Everything runs on one Vercel project:

- `public/` – the website (index.html, styles.css, app.js)
- `api/` – game, account, and public leaderboard endpoints (Vercel Functions)
- `lib/engine.js` – the game rules; the server owns the deck and both hands
- Upstash Redis (free, added from Vercel) – stores rooms, player accounts, sessions, and recent match results

Players can play as guests or create a Bakasha account with a username and
password. Accounts do not require email, and forgotten passwords cannot be
recovered. Passwords are stored as scrypt hashes. Players do not need a Vercel
account; only the person deploying the app needs one.

## Deploy (about 10 minutes)

1. Put this folder in a GitHub repository (or use the Vercel CLI: `npm i -g vercel`, then `vercel` in this folder).
2. In Vercel: **Add New → Project**, import the repository. Leave Framework Preset as **Other**. Deploy.
3. In the project: **Storage** (or **Marketplace**) → **Upstash Redis** → create a free database → connect it to this project.
   Vercel adds the connection variables for you.
4. **Redeploy** (Deployments → ⋯ → Redeploy). New environment variables only apply to new deployments.
5. Open your Vercel URL, optionally create or sign in to a Bakasha account for ranked scores, enter a name if playing as a guest, then **Create an invite link** and send it to your friend.

If you see "Storage is not set up", step 3 or 4 was skipped.

## Sharing the game

Your friend does not need a Vercel account. Send them the app's public URL and
the invite link created in the game. A Vercel Preview deployment may be protected
and ask visitors to sign in; use the public production URL instead. If the
production URL also asks for a Vercel login, the project owner should check
**Settings → Deployment Protection** to confirm public visitors are allowed.

## Playing

- The room creator starts the game once the friend has joined.
- Players appear online while the room receives activity; after 30 seconds without it, they appear away. Their seat stays reserved so they can reconnect.
- Guest games are not ranked. Both players must be signed in before the game starts; a completed online game then records one win or loss for each.
- The public leaderboard is available to everyone and shows the rolling last 28 days, ranked by wins and then win rate.
- Reloading the page or reopening the invite link reconnects you automatically on the same browser.
- A new browser or cleared site data means you can't rejoin that seat. Create a new room.
- Anyone who opens the invite link first takes the second seat, so send it privately.

## Test locally

```
npm install
npm test
```

The tests cover the rules (including a 300-game random-play check that no card is ever lost or duplicated),
the room flow, account sessions, and four-week leaderboard scoring.

To run the whole site locally with real Redis: `vercel link`, `vercel env pull`, `vercel dev`.

## Limits and privacy

- Polling: every 2 s while waiting for your opponent, every 5 s on your own turn, every 3–4 s in the lobby and after the game ends.
  Hidden tabs stop polling. Check Vercel's and Upstash's current free-plan limits; they change.
- Rooms are deleted after 24 hours without activity.
- Leaderboard results are retained for 28 days. Usernames are public; do not choose a username you want to keep private.
- Username-only accounts have no password reset or recovery process.
- This is not end-to-end encryption: the server must know the cards. Whoever owns the Vercel/Upstash account can technically read them.
- Vercel Hobby is for non-commercial use.

## Old files you can delete

`firebase.json`, `database.rules.json`, `firebase-config.js`, `FIREBASE_SETUP.md`, and the `cloudflare/` folder.
