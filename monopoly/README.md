# Istanbul Exchange

An original Istanbul-themed property-trading game for 2–6 friends, at `/monopoly/`. The interface follows omertepe.com's IBM Plex typography, quiet borders, light/dark themes, and English/Turkish controls. Play in an online room or take turns on one device. All money and properties are fictional game assets; there are no real-money purchases or wagering.

## The table and your pawn

- Choose a ferry, cat, tower, tulip, tea glass, or tram pawn in one of eight colors. Online players choose their own appearance in the lobby; local players can each have a different pawn.
- The optional 3D board presents modeled pawns, houses, hotels, and Istanbul scenery, with animated dice and movement. Drag to rotate, use the wheel or controls to zoom, and select a space to inspect its deed. The 2D board provides native keyboard-accessible space buttons and the same game controls, and remains available when 3D cannot load.
- Switch the board palette and 3D/2D view independently of the other players. These choices do not affect rules or room state.
- Sound is off until enabled. Reduced motion follows the operating-system preference and can also be selected in the game. Animation events come from the game state so displays can animate movement without changing the underlying rules.

## Play online

1. Open the game, enter your name, choose your pawn and color, and create a room.
2. Share the room link with friends. They open it, choose their names and pawns, and join.
3. The host chooses the room rules in the lobby and starts after at least two players have joined. Everyone receives the same validated settings; rules and pawn choices are fixed once the game starts.
4. Keep the host's tab open for the entire game.

The host's browser maintains the room and validates player actions. Refreshing or closing the host tab ends that room: there is no persistent server or automatic host migration. Guests automatically retry a lost connection for up to 90 seconds. A returning guest can manually rejoin from the original browser tab/session while the host is still present. Room links use an eight-character code, such as `#room=ABCD-2345`, and are intended to be shared privately with friends.

A disconnected player keeps their seat after the game starts, and play waits when their turn arrives. There is no automatic turn timer or replacement bot. The host can remove disconnected seats in the lobby before starting.

## Classic rules

Classic is the default preset. The settings listed in the next section can change its cash amounts and optional rules.

- Start with ₺1,500. Move around 40 spaces and collect ₺200 when passing START. The last player who has not gone bankrupt wins.
- Buy unowned properties when you land on them, or send them to a turn-based auction. Everyone may bid, including the player who declined the purchase.
- Collect rent from visitors. Complete color groups double undeveloped rent and allow building. Build and sell evenly across a group, using the bank's supply of 32 houses and 12 hotels.
- Mortgage an undeveloped property for half its price; redeem it for that amount plus 10% interest. Mortgaged properties collect no rent. Sell a group's buildings before mortgaging or trading its properties.
- Negotiate trades of cash and properties. The recipient must accept an offer for it to take effect.
- Doubles earn another roll; three consecutive doubles send you to Detour. Leave by rolling doubles, paying ₺50, or using a pass. A third failed attempt requires the ₺50 payment before moving.
- If you owe more cash than you have, sell buildings, mortgage assets, or negotiate a trade. The debt settles when enough cash is available, or you can declare bankruptcy. Assets pass to the creditor or return to the bank, as appropriate. You can sell every building in a color group at once, including when the bank has too few houses to downgrade a hotel individually.

Some rules deliberately keep play simple: event cards are independent random draws and trading a mortgaged property adds no transfer fee. Classic disables the Tea Break pot. On bankruptcy to another player, buildings are liquidated at half cost and their value passes to the creditor; on bankruptcy to the bank, buildings return to its supply and properties become unowned. There are no bots or time limits.

## Custom rules

Choose a preset, then adjust individual rules before starting. Only the room host can change online rules; local games use the settings selected before play. The engine validates the following schema and rejects unsupported values instead of coercing them.

| Setting | Classic default | Allowed values or behavior |
| --- | --- | --- |
| `startingCash` | ₺1,500 | ₺500, ₺1,000, ₺1,500, ₺2,000, ₺2,500, ₺3,000, ₺5,000 |
| `salary` | ₺200 | ₺0, ₺100, ₺200, ₺300, ₺400, ₺500 when passing START |
| `bail` | ₺50 | ₺0, ₺25, ₺50, ₺100, ₺200 to leave Detour |
| `rentMultiplier` | 1× | 0.5×, 1×, 1.5×, 2×; applies to districts, stations, and utilities, rounded up to a whole lira |
| `auctions` | On | On: declined purchases open an auction. Off: the property stays with the bank and play continues. |
| `freeParkingPot` | Off | When on, paid board taxes feed the Tea Break pot; landing there collects and clears it. |
| `doubleSalaryOnGo` | Off | When on, landing exactly on START receives twice the configured salary. |
| `evenBuilding` | On | When on, build and sell evenly within a color group. Off permits any building order within the group. |

The Quick preset starts with ₺1,000, pays ₺100 at START, and uses 1.5× rent. Its other settings match Classic. The Generous preset starts with ₺2,500, pays ₺300 at START, charges ₺25 for Detour, and enables both the Tea Break pot and double salary for exact START landings. Its other settings match Classic.

The Tea Break pot receives only money actually paid for the City Tax and Restoration Levy board spaces. An unpaid tax enters the pot when the debt settles; bankruptcy contributes only the cash paid. Card fees, repairs, and bail do not feed the pot. START cards use the configured salary and exact-landing bonus without paying it twice; a next-station card combines its double rent with the configured rent multiplier before rounding.

Custom building order never makes the building supply unlimited. All games have 32 houses and 12 hotels, require a complete unmortgaged color group before building, and allow at most four houses followed by one hotel per district. Selling one hotel still requires four available houses; selling the entire group's buildings remains available when the bank lacks houses for an individual downgrade. Rules remain fixed for the duration of the game.

## Run and publish

Serve the repository root locally:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080/monopoly/`. Serving the root also makes the shared `/assets/` resources available. JavaScript modules require an HTTP(S) origin; opening `index.html` as a local file is not supported.

For deployment, publish this repository through its existing GitHub Pages configuration. There is no build, database, app server, or player account system. Keep the existing `CNAME` and HTTPS setting. The production route is `https://omertepe.com/monopoly/`. The browser TURN configuration described below uses the site's Metered free-tier relay account.

## How multiplayer works

GitHub Pages serves the HTML, CSS, JavaScript, vendored PeerJS 1.5.5 browser library, and vendored Three.js 0.186.1 rendering library. Both libraries retain their MIT licenses in `vendor/`. Three.js is loaded for the 3D view; it does not change the transport or require a server.

PeerJS signaling introduces players, then WebRTC data channels carry room state and player commands. The host applies commands to one authoritative game state and distributes updates to guests. Online protocol version 2 includes validated room rules and pawn cosmetics; its room identifiers use the `omertepe-estates-v2-` prefix. Older protocol versions cannot join these rooms, so all participants should reload the current page before joining.

WebRTC still needs network infrastructure: signaling coordinates connections, STUN discovers addresses, and TURN relays traffic when a direct connection is unavailable. The game explicitly configures its ICE servers in `ice-config.js` instead of using the relay endpoints bundled with PeerJS:

- TLS signaling at `0.peerjs.com:443`.
- STUN at `stun.l.google.com:19302`.
- TURN: account-generated Metered UDP, TCP, and TLS endpoints in `TURN_SERVERS`, using a browser-only relay credential approved by the site owner.

The selected Metered free plan includes a 20 GB relay allowance, with no paid plan or overage billing enabled. Relay service stops when that allowance is exhausted. Metered describes these free servers as intended for development, with fewer regions and no service-level agreement; this setup does not provide a production availability guarantee.

To rotate the relay credential, create a new browser TURN credential in the Metered dashboard and replace the TURN entries in `TURN_SERVERS` with the supplied ICE-server array's TURN entries. Preserve its UDP, TCP, and TLS endpoints. Each entry needs its `urls`, `username`, and `credential` (the generated TURN password). Metered documents this flow in [Creating TURN Credentials](https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/). New credentials may need up to two minutes to propagate before testing.

These browser relay credentials are intentionally visible in the public JavaScript with the site owner's approval. They grant relay usage, so keep their provider quota under review and rotate or revoke them in the dashboard if needed. They are not account-management credentials. Never add a management API key or account secret key to this repository. The game makes no credential API request and needs no credential-fetching backend; only the generated browser TURN username/password goes in the static configuration.

`getIceConfig()` validates endpoint syntax and credentials before passing a fresh configuration to PeerJS. Empty TURN configuration is allowed for direct-connection development, while the readiness check below rejects it. Passing validation does not establish that a relay is reachable or that its credentials work. On 2026-10-06, six browser clients connected with `iceTransportPolicy: 'relay'`, all five guest links selected relay candidates, and the host started the game. A separate test restricting both ends to TURN over TLS on port 443 also connected successfully. These tests used the actual PeerJS transport and Metered service, not a simulated network. Keep diagnostic overrides out of the normal production configuration so direct connections remain available.

Signaling and relay availability, quotas, and network reachability remain outside the site's control. A restrictive corporate, school, VPN, or mobile network can still block online play. The frontend continues to live entirely on GitHub Pages.

The host and guests run code in their own browsers. This is a casual game for trusted friends, not a cheat-resistant competitive service: an altered host can alter its own game state. There is no durable game recovery after the host leaves.

## Privacy and storage

Theme and language choices use the same browser-local preferences as the rest of the site. Pawn appearance, view, board palette, optional sound, and motion preferences are also saved locally in the browser. These preferences do not save an active game. The game stores a random player ID and reconnect credential in `sessionStorage` under `omertepe.estates.identity.v1`. That private credential authenticates a reconnect to the host and is not broadcast to the other players; a public pawn's `token` field is only its appearance identifier. This is not an account or a saved game; clearing the session storage removes that tab's reconnect identity.

Display names, pawn choices, room membership, rules, actions, and game state are exchanged with the room host and players. Signaling and relay services necessarily process connection metadata, and WebRTC can expose network information such as IP addresses to participating peers. The game page adds no analytics or tracking cookies. PeerJS and Three.js are vendored locally, so loading their files does not require a third-party CDN; online room connections still require the services listed above.

## Files

- `index.html`, `game.css`, `app.js`: the game page, responsive board, and controls.
- `board.js`: Istanbul spaces, prices, rents, and color groups.
- `engine.js`: game state, turn validation, property actions, rules, and deterministic animation events.
- `rules.js`: validated room rule schema and Classic, Quick, and Generous presets.
- `cosmetics.js`: six pawn identifiers, eight colors, and sanitized player profiles.
- `graphics.js`: pawn/building graphics and optional audio and motion effects.
- `scene.js`: Three.js board, modeled city and pieces, movement animation, space selection, and camera controls.
- `network.js`: rooms, host validation, state synchronization, and reconnects.
- `ice-config.js`: static browser STUN/TURN configuration and strict TURN validation.
- `vendor/peerjs.min.js`, `vendor/LICENSE.peerjs`: pinned PeerJS 1.5.5 and its license.
- `vendor/three.module.js`, `vendor/three.core.js`, `vendor/LICENSE.three`: pinned Three.js 0.186.1 and its MIT license.
- `tests/`: deterministic engine checks.
- `network.test.mjs`: transport checks with a simulated PeerJS network.
- `ice-config.test.mjs`: configuration validation and a separately reported deployment relay-readiness check.

## Checks

With a current Node.js version, run the game engine tests from the repository root:

```sh
node --test monopoly/tests/*.test.mjs
node --test monopoly/network.test.mjs
node --test monopoly/ice-config.test.mjs
```

The relay-readiness test runs against the configured TURN entries. For direct-only development it reports a skip when `TURN_SERVERS` is empty, but the Game checks workflow also runs the mandatory guard below and fails if the relay configuration is missing. This guard checks configuration, not network reachability:

```sh
node --input-type=module -e "import { getIceConfig } from './monopoly/ice-config.js'; getIceConfig({ requireRelay: true });"
```

The automated checks cover the game engine, rule validation, movement events, and simulated room transport. To check online play, open separate browser sessions, create a room in one, join from the other, and verify both players see the same pawn choices, rules, turn, buildings, and balance changes. Exercise both 3D and 2D views, keyboard controls, reduced motion, and sound opt-in. Test again with devices on different networks before relying on a chosen relay configuration; a same-device test does not establish cross-network reachability.
