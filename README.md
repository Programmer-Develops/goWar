# goWar

goWar is a real-time, simultaneous-order strategy game for 2–8 commanders. One person starts the command server and creates a room; everyone else opens the same address on their own device and joins with the five-character room code.

## Start a game

Requires Node.js 18 or later; there are no package dependencies.

```sh
node server.js
```

Open `http://localhost:3000` on the host computer. For friends on the same Wi-Fi, they can open `http://<host-computer-LAN-address>:3000` on their devices. For players on different networks, deploy the app to an internet-accessible host and share its address.

The local Node server keeps room data in memory. Restarting it ends any active local rooms.

## Deploy to Vercel with Supabase

The browser app is served from `public/`; serverless room routes are under `api/`. Create a Supabase project, then run [`db/schema.sql`](db/schema.sql) in its SQL Editor. Add these Vercel environment variables:

- `SUPABASE_URL` — the Supabase project URL.
- `SUPABASE_SECRET_KEY` — a server-only key used by the room API. Never put it in browser code.
- `SUPABASE_PUBLISHABLE_KEY` — used by the browser to subscribe to room update broadcasts.

The API also accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` names. After adding the variables, redeploy. Rooms expire 24 hours after their last update. Supabase Broadcast sends room change notices immediately; the browser polls every five seconds as a fallback.

## Rules

- Each commander starts with a command base, five troops, three supply, and two rockets.
- Every round, each active commander privately locks one order: advance into a connected sector, reinforce a sector they control, or rocket-strike a connected rival sector. Other players can see who has sealed an order, but not what it is.
- Orders resolve after every active commander is ready. Rockets hit first, then reinforcements and advances resolve; attack priority rotates each round, and a failed advance leaves a garrison behind.
- Supply and rockets replenish from controlled territory and ports. Control a majority of all command bases, or eliminate every rival, to win.

Room codes identify games but do not authenticate players. Use a trusted server address when sharing a live room.
