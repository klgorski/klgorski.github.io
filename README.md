# klgorski.github.io

My personal academic website, built with [Jekyll](https://jekyllrb.com/)
and the [Minimal Mistakes](https://mmistakes.github.io/minimal-mistakes/)
theme, hosted on GitHub Pages at <https://klgorski.github.io>.

## Editing

Most content lives in plain Markdown:

| What | Where |
|------|-------|
| Homepage / About | `index.md` |
| CV | `_pages/cv.md` |
| Navigation bar | `_data/navigation.yml` |
| Site config, author profile, links | `_config.yml` |
| Profile photo | `assets/images/avatar.png` |
| CV PDF | `assets/cv.pdf` |

Look for `[bracketed placeholders]` and replace them with your details.

## Math (LaTeX)

Every page renders LaTeX with [MathJax](https://www.mathjax.org/). Write math
the way kramdown expects — `$$ ... $$` for **both** inline and display:

```markdown
The estimator $$\hat\beta = (X^\top X)^{-1} X^\top y$$ is unbiased.

$$
\mathbb{E}[Y \mid X] = X\beta
$$
```

`$$` on its own line (a paragraph of its own) comes out centred as display
math; `$$` inside a sentence stays inline. Numbered environments work too:

```markdown
$$
\begin{align}
  \mu_t &= \alpha + \beta \log t + \varepsilon_t \\
  \varepsilon_t &\sim \mathrm{ARMA}(p, q)
\end{align}
$$
```

In raw HTML (the dashboard page, includes, anything outside markdown) use
`\( ... \)` and `\[ ... \]` instead.

A few rules worth knowing:

- **A single `$` is not a math delimiter, on purpose.** kramdown parses `_` and
  `*` as emphasis before MathJax sees the text, so `$x_i$` would arrive
  mangled, and prose like "a $5,000 grant" would start swallowing the rest of
  the line. Use `$$`.
- Math inside `code` spans and `pre` blocks is left alone, as is anything
  inside an element with `class="no-mathjax"`.
- To skip loading MathJax on one page, add `mathjax: false` to its front
  matter; to switch it off site-wide, uncomment `mathjax: false` in
  `_config.yml`. Nothing sets it today, so every page loads it. `/fitness/`
  needs it: the fitted model equations are typeset from the published
  coefficients at runtime.
- Only math present when the page loads is typeset. Anything a script writes
  into the page afterwards needs a `MathJax.typesetPromise()` call of its own.

MathJax is **vendored**, not loaded from a CDN — `assets/js/lib/mathjax/tex-svg.js`
(v3.2.2, Apache-2.0, license alongside it), wired up in
`_includes/head/custom.html`. Same reasoning as Chart.js: reading the site
makes no third-party requests. It is the SVG build specifically because that
one file is self-contained; the CHTML build and MathJax 4 both fetch font
files separately, which would mean either a CDN request or several megabytes
of vendored fonts. The one exception: MathJax's right-click menu can pull its
speech-rule engine from a CDN if a reader explicitly turns on the accessibility
explorer. The include leaves that menu enabled; adding
`options.enableMenu: false` to it would remove even that request.

To check a change to the math setup without a Ruby toolchain, put the same
config and some test math in a standalone HTML file and render it in headless
Chrome:

```bash
chrome --headless --disable-gpu --user-data-dir=/tmp/chrome-scratch \
  --virtual-time-budget=15000 --dump-dom file:///path/to/page.html > dump.html
```

Use plain `--headless`; `--headless=new` behaves differently and quietly writes
no screenshot. The scratch `--user-data-dir` is what lets it run while your
normal Chrome is open. `--dump-dom` is the dependable half; `--screenshot=out.png`
is a separate run and can fail to write the file with no useful error.

So put the assertions in the test page itself — a `setTimeout` that counts
elements and writes a PASS/FAIL line into `document.title` — and read that line
out of the dump. What to count: one `mjx-container` per expression you wrote
(**the count is the real check** — zero means nothing was typeset at all) and
zero `mjx-merror` elements (those are TeX syntax errors).

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
