# omertepe.com

Personal site of Mehmet Ömer Tepe, served by GitHub Pages (custom domain via `CNAME`).

Plain HTML/CSS/JS — no build step. Push to `main` and GitHub Pages deploys it.

## Structure

- `index.html` — home: about, selected projects, contact
- `projects/` — all projects, grouped by category; published repos are pulled live from the GitHub API, unpublished ones come from the catalog in `assets/site.js`
- `resume/` — embedded PDF viewer + download link (`assets/resume.pdf`)
- `404.html` — custom not-found page
- `assets/site.css`, `assets/site.js` — shared styles, i18n (EN/TR), theming, project catalog

## Updating things

- **New repo published?** It shows up on the projects page automatically (under "Other" unless mapped). To categorize it, add its lowercase name to `REPO_CATEGORIES` in `assets/site.js`; if it replaces a catalog entry, delete that entry from `LOCAL_PROJECTS`.
- **New unpublished project?** Add an entry to `LOCAL_PROJECTS` in `assets/site.js` (EN + TR description).
- **New resume?** Overwrite `assets/resume.pdf`.
