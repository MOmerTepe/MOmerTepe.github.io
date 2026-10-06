# omertepe.com

Personal site of Mehmet Ömer Tepe, served by GitHub Pages (custom domain via `CNAME`).

Plain HTML/CSS/JS.

## Run locally

From this repository's root, run:

```sh
python -m http.server 8080
```

Open `http://localhost:8080/` for the site or `http://localhost:8080/monopoly/` for Istanbul Exchange. There is no build step. Use an HTTP server rather than opening HTML files directly so the game's JavaScript modules can load.

## Istanbul Exchange

A browser-based property-trading game for 2–6 friends, built around Istanbul neighborhoods and the site's typography, themes, and English/Turkish controls. Play online or take turns locally, choose from six sculpted pawns and eight colors, and use a 3D board with animated movement and buildings or the keyboard-accessible 2D board. Board palettes, reduced motion, and optional sound are personal viewing preferences.

Hosts can choose Classic, Quick, or Generous rules and customize starting cash, START salary, detour bail, rent, auctions, the Tea Break tax pot, exact-START bonuses, and even building. Every room shares one validated rule set; the bank always has 32 houses and 12 hotels.

The site and all game assets stay on GitHub Pages. Online rooms use WebRTC connections through PeerJS, with no accounts or persistent game server. The host must keep their tab open; refreshing or closing it ends the room. The optional 3D view uses vendored Three.js 0.186.1 under the MIT license.

See [the game README](monopoly/README.md) for rules, online room setup, service dependencies, and tests.

## Publish

The existing `CNAME` keeps the site at `omertepe.com`. Publish the repository root through the site's existing GitHub Pages branch/workflow; no separate game server or build output is required. The game is then available at `https://omertepe.com/monopoly/`.

Keep HTTPS enabled in GitHub Pages. Room signaling and WebRTC connectivity depend on external services described in the game README; GitHub Pages serves the files and does not keep live rooms running.

## Structure

- `index.html` - home: about, selected projects, contact
- `projects/` - all projects, grouped by category; published repos are pulled live from the GitHub API, unpublished ones come from the catalog in `assets/site.js`
- `projects/<slug>/` - per-project case studies, each with an interactive canvas schematic (`demo.js`, vanilla JS, no dependencies)
- `resume/` - inline SVG preview (`assets/resume-preview.svg`) + download link (`assets/resume.pdf`)
- `monopoly/` - Istanbul Exchange: static multiplayer property-trading game, 3D/2D boards, pawn customization, and shared custom rules
- `404.html` - custom not-found page
- `assets/site.css`, `assets/site.js` - shared styles, i18n (EN/TR), theming, project catalog
