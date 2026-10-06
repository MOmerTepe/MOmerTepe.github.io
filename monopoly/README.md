# Istanbul Exchange

An original Istanbul-themed property-trading game for 2–6 friends, at `/monopoly/`. The interface follows omertepe.com's IBM Plex typography, quiet borders, light/dark themes, and English/Turkish controls. All money and properties are fictional game assets; there are no real-money purchases or wagering.

## Play online

1. Open the game, enter your name, and create a room.
2. Share the room link with friends. They open it, enter their names, and join.
3. The host starts after at least two players have joined.
4. Keep the host's tab open for the entire game.

The host's browser maintains the room and validates player actions. Refreshing or closing the host tab ends that room: there is no persistent server or automatic host migration. Guests automatically retry a lost connection for up to 90 seconds. A returning guest can manually rejoin from the original browser tab/session while the host is still present. Room links use an eight-character code, such as `#room=ABCD-2345`, and are intended to be shared privately with friends.

A disconnected player keeps their seat after the game starts, and play waits when their turn arrives. There is no automatic turn timer or replacement bot. The host can remove disconnected seats in the lobby before starting.

## Rules

- Start with ₺1,500. Move around 40 spaces and collect ₺200 when passing START. The last player who has not gone bankrupt wins.
- Buy unowned properties when you land on them, or send them to a turn-based auction. Everyone may bid, including the player who declined the purchase.
- Collect rent from visitors. Complete color groups double undeveloped rent and allow building. Build and sell evenly across a group, using the bank's supply of 32 houses and 12 hotels.
- Mortgage an undeveloped property for half its price; redeem it for that amount plus 10% interest. Mortgaged properties collect no rent. Sell a group's buildings before mortgaging or trading its properties.
- Negotiate trades of cash and properties. The recipient must accept an offer for it to take effect.
- Doubles earn another roll; three consecutive doubles send you to Detour. Leave by rolling doubles, paying ₺50, or using a pass. A third failed attempt requires the ₺50 payment before moving.
- If you owe more cash than you have, sell buildings, mortgage assets, or negotiate a trade. The debt settles when enough cash is available, or you can declare bankruptcy. Assets pass to the creditor or return to the bank, as appropriate. You can sell every building in a color group at once, including when the bank has too few houses to downgrade a hotel individually.

Some rules deliberately keep play simple: event cards are independent random draws, Tea Break has no cash jackpot, and trading a mortgaged property adds no transfer fee. On bankruptcy, buildings are sold back at half their cost. There are no bots or time limits.

## Run and publish

Serve the repository root locally:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080/monopoly/`. Serving the root also makes the shared `/assets/` resources available. JavaScript modules require an HTTP(S) origin; opening `index.html` as a local file is not supported.

For deployment, publish this repository through its existing GitHub Pages configuration. There is no build, database, app server, account system, or backend secret to configure. Keep the existing `CNAME` and HTTPS setting. The production route is `https://omertepe.com/monopoly/`.

## How multiplayer works

GitHub Pages serves the HTML, CSS, JavaScript, and vendored PeerJS 1.5.5 browser library. PeerJS signaling introduces players, then WebRTC data channels carry room state and player commands. The host applies commands to one authoritative game state and distributes updates to guests.

WebRTC still needs network infrastructure: signaling coordinates connections, STUN discovers addresses, and TURN relays traffic when a direct connection is unavailable. The pinned PeerJS library's defaults supply:

- TLS signaling at `0.peerjs.com:443`.
- STUN at `stun.l.google.com:19302`.
- TURN at `eu-0.turn.peerjs.com:3478` and `us-0.turn.peerjs.com:3478`.

These are shared public services. Their availability, rate limits, and network reachability are outside the site's control, so connectivity is not guaranteed on every corporate, school, VPN, or mobile network. For dependable production operation, use maintained signaling and TURN services while continuing to host the frontend on GitHub Pages. There is no configuration panel: change the `Peer` constructor options in `RoomSession._makePeer()` in `network.js` to configure your services. Preserve TURN capability when replacing the ICE configuration. Never put private provider API keys or long-lived secret credentials in this public repository; a managed relay requiring short-lived credentials needs an appropriate credential service.

The host and guests run code in their own browsers. This is a casual game for trusted friends, not a cheat-resistant competitive service: an altered host can alter its own game state. There is no durable game recovery after the host leaves.

## Privacy and storage

Theme and language choices use the same browser-local preferences as the rest of the site. The game stores a random player ID and reconnect token in `sessionStorage` under `omertepe.estates.identity.v1`. The token authenticates a reconnect to the host and is not broadcast to the other players. This is not an account or a saved game; clearing the session storage removes that tab's reconnect identity.

Display names, room membership, actions, and game state are exchanged with the room host and players. Signaling and relay services necessarily process connection metadata, and WebRTC can expose network information such as IP addresses to participating peers. The game page adds no analytics or tracking cookies. PeerJS is vendored locally, so loading the multiplayer library does not require a third-party CDN; online room connections still require the services listed above.

## Files

- `index.html`, `game.css`, `app.js`: the game page, responsive board, and controls.
- `board.js`: Istanbul spaces, prices, rents, and color groups.
- `engine.js`: game state, turn validation, property actions, and rules.
- `network.js`: rooms, host validation, state synchronization, and reconnects.
- `vendor/peerjs.min.js`, `vendor/LICENSE.peerjs`: pinned PeerJS 1.5.5 and its license.
- `tests/`: deterministic engine checks.
- `network.test.mjs`: transport checks with a simulated PeerJS network.

## Checks

With a current Node.js version, run the game engine tests from the repository root:

```sh
node --test monopoly/tests/*.test.mjs
node --test monopoly/network.test.mjs
```

To check online play, open separate browser sessions, create a room in one, join from the other, and verify both players see the same turn and balance changes. Test again with devices on different networks before relying on a chosen relay configuration; a same-device test does not establish cross-network reachability.
