# omertepe.com

Personal site of Mehmet Ömer Tepe, served by GitHub Pages (custom domain via `CNAME`).

Plain HTML/CSS/JS.

## Structure

- `index.html` - home: about, selected projects, contact
- `projects/` - all projects, grouped by category; published repos are pulled live from the GitHub API, unpublished ones come from the catalog in `assets/site.js`
- `projects/<slug>/` - per-project case studies, each with an interactive canvas schematic (`demo.js`, vanilla JS, no dependencies)
- `resume/` - inline SVG preview (`assets/resume-preview.svg`) + download link (`assets/resume.pdf`)
- `404.html` - custom not-found page
- `assets/site.css`, `assets/site.js` - shared styles, i18n (EN/TR), theming, project catalog
