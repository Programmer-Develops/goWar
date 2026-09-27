# goWar

goWar is a real-time, simultaneous-order strategy game for 2–8 commanders. One person starts the command server and creates a room; everyone else opens the same address on their own device and joins with the five-character room code.

## Start a game

Requires Node.js 18 or later; there are no package dependencies.

```sh
node server.js
```

Open `http://localhost:3000` on the host computer. For friends on the same Wi-Fi, they can open `http://<host-computer-LAN-address>:3000` on their devices. For players on different networks, run the server on an internet-accessible host and share its address. Room state currently lives in server memory, so active rooms end if the server restarts.

## Rules

- Each commander starts with a command base, five troops, three supply, and two rockets.
- Every round, each active commander privately locks one order: advance into a connected sector, reinforce a sector they control, or rocket-strike a connected rival sector. Other players can see who has sealed an order, but not what it is.
- Orders resolve after every active commander is ready. Rockets hit first, then reinforcements and advances resolve; attack priority rotates each round, and a failed advance leaves a garrison behind.
- Supply and rockets replenish from controlled territory and ports. Control a majority of all command bases, or eliminate every rival, to win.

Room codes identify games but do not authenticate players. Use a trusted server address when sharing a live room.
