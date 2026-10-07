# Secret Hitler — omertepe.com

A free, unofficial, noncommercial browser adaptation of Secret Hitler for 5–10 friends at https://omertepe.com/secret-hitler/. The original game is by Mike Boxleiter, Tommy Maranges, and Mac Schubert. This adaptation and the original game materials are licensed under **CC BY-NC-SA 4.0**. See [LICENSE](LICENSE) and [SOURCES.md](SOURCES.md) for attribution, original download URLs, and changes to artwork. The original PDFs are preserved unchanged.

## Playing

Create a room, copy its invitation, and have 4–9 friends join from their own browsers. The host starts once everyone is connected. Every player can open and hide their own role card. Nominate governments, cast sealed votes, pass policies privately, and use the official executive powers. The interface implements both board variants for larger groups, all victory conditions, vetoes, investigations, special elections, and executions. The policy deck contains 6 Liberal and 11 Fascist tiles.

Use table chat or your own voice call to discuss and bluff. There is no built-in voice/video service. The game blocks chat from executed players and from the two legislative officers during their private policy session. English and Turkish controls, light/dark themes, keyboard controls, responsive phone layouts, and reduced-motion support are included. Public event-log messages and original artwork remain in English.

Practice mode is one human and four simple bots, entirely offline after assets have loaded. Bots use their own permitted information and basic heuristics; they do not simulate human conversation or strong play. The host cannot add bots to online rooms. There are no altered house rules in this edition.

## Hosting and privacy

GitHub Pages serves the entire frontend without a build step. PeerJS 1.5.5 uses its public signaling service, and WebRTC carries game messages with the existing site's explicit STUN/Metered TURN configuration. The relay is shared with Istanbul Exchange: its free allowance is 20 GB/month, with service stopping at the quota. This page creates no new account or paid service.

The **host's browser owns the full authoritative game state**. Each guest receives an allowlisted view containing only public information and that guest's private role, permitted allies, hand, and investigation/peek results. Unrevealed votes, deck order, other hands, and other players' hidden roles are never sent to guests. The normal host UI also uses its own filtered view. A person modifying the host browser can inspect or alter the complete state: this is a game for friends who trust the host, not a cheat-resistant service. Room codes and session identity tokens are intended for privately shared tables, not a public matchmaking directory.

**Keep the host tab open.** Closing or refreshing it ends the room. There is no saved game, host migration, or central game server. Guests retry temporarily broken connections for up to 90 seconds and can rejoin the same room from their original browser tab/session while the host remains online. A disconnected player keeps their game seat; the table waits if their vote or action is needed. Lobby seats can be removed by the host before starting. Players cannot join mid-game as a new identity or as spectators.

Guest actions are authenticated against their seat, validated by the host engine, and tagged with a round number to reject stale commands. Votes remain private until all living players vote. Once the game ends, every role is revealed. Display names and chat are plain text. No analytics or third-party advertising code is loaded by this game.

## Development

Serve the repository root, so shared fonts/styles and the existing PeerJS/ICE files resolve:

```sh
python -m http.server 8088
node --test secret-hitler/tests/*.test.mjs
```

Open http://localhost:8088/secret-hitler/. There is no npm installation or bundler. `engine.js` is the pure rules engine; `getPlayerView()` is the only state projection permitted on the wire. `network.js` manages rooms, recipient-specific delivery, command acknowledgments, chat, and reconnects. `app.js` renders the interface and practice mode. Tests cover every player count, all rules and win paths, secret-information boundaries, ten-player rooms, reconnects, cancellation, malformed messages, and delayed handshakes. Browser testing also checks the real PeerJS/TURN service and the actual interface.

The shared PeerJS library remains under its existing MIT license in `../monopoly/vendor/LICENSE.peerjs`; it is not relicensed by this adaptation. The rest of the portfolio and Istanbul Exchange are outside this directory's CC license.
