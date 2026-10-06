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

A browser-based property-trading game for 2–6 friends, built around Istanbul neighborhoods and the site's typography, themes, and language controls. The site and all game assets stay on GitHub Pages; online rooms use WebRTC connections through PeerJS.

See [the game README](monopoly/README.md) for rules, online room setup, service dependencies, and tests.

## Publish

The existing `CNAME` keeps the site at `omertepe.com`. Publish the repository root through the site's existing GitHub Pages branch/workflow; no separate game server or build output is required. The game is then available at `https://omertepe.com/monopoly/`.

Keep HTTPS enabled in GitHub Pages. Room signaling and WebRTC connectivity depend on external services described in the game README; GitHub Pages serves the files and does not keep live rooms running.

## Structure

- `index.html` - home: about, selected projects, contact
- `projects/` - all projects, grouped by category; published repos are pulled live from the GitHub API, unpublished ones come from the catalog in `assets/site.js`
- `projects/<slug>/` - per-project case studies, each with an interactive canvas schematic (`demo.js`, vanilla JS, no dependencies)
- `resume/` - inline SVG preview (`assets/resume-preview.svg`) + download link (`assets/resume.pdf`)
- `monopoly/` - Istanbul Exchange: static multiplayer property-trading game
- `404.html` - custom not-found page
- `assets/site.css`, `assets/site.js` - shared styles, i18n (EN/TR), theming, project catalog
