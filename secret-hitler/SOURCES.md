# Secret Hitler: sources, credits, and changes

Secret Hitler was created by **Mike Boxleiter, Tommy Maranges, and Mac Schubert**.
These are the credits printed in the current official rulebook, page 7.

Original game: [secrethitler.com](https://www.secrethitler.com/).
License: [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/).
The complete license text is included in [LICENSE](./LICENSE).

This is an independent, noncommercial browser adaptation. The original creators
have not endorsed it. The game adaptation and adapted artwork are offered under
the same CC BY-NC-SA 4.0 license. Third-party libraries retain their own licenses.

## Official downloads

Retrieved on **2026-10-07** directly from the official website:

| Local file | Official source | Treatment |
| --- | --- | --- |
| `downloads/Secret_Hitler_Rules.pdf` | [Official rulebook](https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf) | Verbatim, 7 pages; includes credits and license |
| `downloads/Secret_Hitler_Print_and_Play.pdf` | [Official print-and-play kit](https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf) | Verbatim, 13 pages; includes all printed game components |
| `downloads/official-box.svg` | [Official homepage](https://www.secrethitler.com/) | Extracted inline game-box illustration |
| `downloads/official-fascist-card.svg` | [Official homepage](https://www.secrethitler.com/) | Extracted inline Fascist role illustration |
| `downloads/official-printer.svg` | [Official homepage](https://www.secrethitler.com/) | Extracted inline print-and-play illustration |
| `downloads/official-favicon.png` | [Official icon](https://www.secrethitler.com/assets/favicon.png) | Verbatim |

The official website offers the rules and print-and-play PDFs as its two game
downloads. Its available game illustrations are inline SVG, rather than separate
art packs. The extracted SVGs retain their original path geometry and colors;
their corresponding presentation rules from the [official stylesheet](https://www.secrethitler.com/stylesheets/secret.css)
have been embedded as SVG attributes, so no external stylesheet is required.
No unrelated website content is included.

## Web artwork

The print-and-play kit is intentionally grayscale. Its original art is used
without recoloring. The following transformations prepare it for the web:

- Individual roles, party memberships, policies, ballots, draw/discard cards,
  and office placards were cropped along their printed artwork boundaries.
- Sideways components were rotated upright. The two matching halves of each
  board were rotated and joined at their labeled assembly edges.
- Artwork was resized for readable browser display and encoded as WebP.
- `logo-transparent.webp` additionally converts the cover logo's white
  background and white lettering into transparency. `logo.webp` preserves the
  original white background.
- `official-box.webp` and `official-fascist-card.webp` are raster versions of
  the official website illustrations. The latter is an alternate Fascist
  illustration, **not** the Hitler card.

The role cards are `role-liberal.webp`, `role-fascist.webp`, and
`role-hitler.webp`. Party cards are distinct assets because an investigation
reveals party membership, never the Hitler role.

The full file inventory, exact source URLs, SHA-256 hashes, byte sizes,
dimensions, PDF page numbers, and crop coordinates are recorded in
[`assets/manifest.json`](./assets/manifest.json).

## Adaptation changes

The browser adaptation adds an online lobby, room invitations, private role
views, simultaneous voting, digital policy selection, automatic rule handling,
turn/status displays, and interface controls. Printed game components remain
available unchanged in the two official PDFs. Digital rendering, layout,
interaction, networking, and implementation are adaptations of the original
tabletop experience; they are not products published by the original creators.

Attribution must remain available with redistributed copies. Commercial use is
not permitted by this license, and adaptations must retain CC BY-NC-SA 4.0.
