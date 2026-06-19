# klgorski.github.io

My personal academic website, built with [Jekyll](https://jekyllrb.com/)
and the [Minimal Mistakes](https://mmistakes.github.io/minimal-mistakes/)
theme, hosted on GitHub Pages at <https://klgorski.github.io>.

## Editing

Most content lives in plain Markdown:

| What | Where |
|------|-------|
| Homepage / About | `index.md` |
| Research | `_pages/publications.md` |
| Projects | `_pages/projects.md` |
| CV | `_pages/cv.md` |
| Navigation bar | `_data/navigation.yml` |
| Site config, author profile, links | `_config.yml` |
| Profile photo | `assets/images/avatar.png` |
| CV PDF | `assets/cv.pdf` |

Look for `[bracketed placeholders]` and replace them with your details.

## Preview locally (optional)

You need [Ruby](https://www.ruby-lang.org/) and Bundler installed.

```bash
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000>. You don't have to build locally —
pushing to `main` is enough for GitHub to rebuild and publish the site.

## Publishing

Every push to the `main` branch triggers a GitHub Pages build. Changes
are usually live within a minute or two.
