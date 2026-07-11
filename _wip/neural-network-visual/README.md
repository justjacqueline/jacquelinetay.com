# Neural networks, visually (DRAFT)

A work-in-progress section for pedagogical neural-network visualizations.

## What's here

```
_wip/neural-network-visual/
├── README.md            # this file
├── index.html           # hub page (lists draft visualizations)
├── building-a-probe/
│   └── index.html       # "Building a probe: from sentences to a direction"
│                        #   6-beat step-through: dataset → model → dot →
│                        #   cloud → mass-mean probe → logistic-regression probe.
│                        #   Animated model interior inspired by
│                        #   https://animatedllm.github.io/
├── probing/
│   └── index.html       # "Two probes, two directions" — slider sandbox
│                        #   for exploring how the two methods respond to
│                        #   data shape changes. Downstream of building-a-probe/.
└── dot-product/
    └── index.html       # "The dot product: a probe meets an activation"
                         #   Interactive draggable vectors, inspired by
                         #   https://www.falstad.com/dotproduct/
```

**Reading order for visitors:** `dot-product/` (geometric primer for what "applying" a probe means) → `building-a-probe/` (story) → `probing/` (playground).

## Why "_wip" / what "not public" actually means

- The folder lives under `/_wip/` so it's outside the production `/apps/` and `/charts/` namespaces.
- Every page sets `<meta name="robots" content="noindex, nofollow">` in `<head>`.
- Netlify also sends `X-Robots-Tag: noindex, nofollow` for any URL under `/_wip/*` (see the top-level `netlify.toml`).
- Nothing here is linked from `/shelf/`, so there is no nav path to it.
- **The files are still deployed** when the repo is pushed — anyone with the exact URL can view them. They just won't show up in search or in site navigation. If you ever need it truly off the internet, add `_wip/` to `.gitignore` (or move the folder out of the repo) until ready.

## Local preview

From the `jacquelinetay.com/` folder:

```bash
python3 -m http.server 8888
```

Then visit:

- `http://localhost:8888/_wip/neural-network-visual/`                   — hub
- `http://localhost:8888/_wip/neural-network-visual/building-a-probe/`  — building-a-probe app
- `http://localhost:8888/_wip/neural-network-visual/probing/`           — probing app
- `http://localhost:8888/_wip/neural-network-visual/dot-product/`       — dot-product app

Both apps load React + `htm` from `esm.sh`, so an internet connection is required for local preview.

## Tech notes

- **No build step.** The probing app is a single `index.html` that imports React 18 and `htm` from `esm.sh` via native ES modules. There's no `package.json`, no `node_modules`, no bundler.
- **All math is inline.** The PRNG (mulberry32), Gaussian sampler (Box–Muller), Cholesky factorization for the 2×2 covariance, sigmoid, and the gradient-descent training loop for logistic regression all live in the page's `<script type="module">`.
- **Why this choice:** matches the rest of the site (static HTML), portable, and trivial to relocate. If a viz outgrows this pattern, migrate it to a Vite + React + TypeScript project that builds into the same folder.

---

## "Please make this public" — publish recipe

Use this as the canonical recipe whenever a draft from this section is ready to launch. The example below is for the **probing** subpage; the same steps work for any other subfolder added later.

### Step 1 — Move the folder

If publishing **just the probing subpage** (hub stays in `_wip/` until more pages are ready):

```bash
git mv _wip/neural-network-visual/probing apps/neural-network-visual/probing
```

If publishing **the whole hub** (probing + any other ready subpages):

```bash
git mv _wip/neural-network-visual apps/neural-network-visual
```

### Step 2 — Update `<head>` of every moved page

In each moved `index.html` (e.g. `apps/neural-network-visual/probing/index.html`):

1. **Remove** the noindex meta:

   ```html
   <meta name="robots" content="noindex, nofollow">
   ```

2. **Add** a canonical URL (use the page's actual public path):

   ```html
   <link rel="canonical" href="https://jacquelinetay.com/apps/neural-network-visual/probing/">
   ```

3. **Add** Open Graph + Twitter cards (mirror `apps/help-me-make-decisions/index.html`):

   ```html
   <meta property="og:site_name" content="Jacqueline Tay">
   <meta property="og:type" content="website">
   <meta property="og:title" content="Two probes, two directions — Jacqueline Tay">
   <meta property="og:description" content="Why a mass-mean probe and a logistic-regression probe can point in different directions, even when both separate true from false.">
   <meta property="og:url" content="https://jacquelinetay.com/apps/neural-network-visual/probing/">
   <meta property="og:image" content="https://jacquelinetay.com/assets/logo-home.png">
   <meta property="og:image:alt" content="Jacqueline Tay">
   <meta name="twitter:card" content="summary_large_image">
   <meta name="twitter:title" content="Two probes, two directions — Jacqueline Tay">
   <meta name="twitter:description" content="Why a mass-mean probe and a logistic-regression probe can point in different directions, even when both separate true from false.">
   <meta name="twitter:image" content="https://jacquelinetay.com/assets/logo-home.png">
   ```

4. **Update** the breadcrumb and the "draft" footer line:

   - Change `<p class="breadcrumb"><a href="/shelf/">Shelf</a> · <a href="../">Neural networks, visually</a> · Draft</p>` to drop the `· Draft`. If the hub is still in `_wip/`, replace the `<a href="../">…</a>` with plain text `Neural networks, visually`.
   - Delete the `<p class="draft-flag">Draft sketch — not linked from the shelf.</p>` line at the bottom of the page.

### Step 3 — Add a card on the shelf

Edit `shelf/index.html`. Inside `<div class="shelf-grid">`, add (style + tags optional, mirror existing cards):

```html
<a class="shelf-card-hit" href="/apps/neural-network-visual/probing/">
  <article class="shelf-item">
    <header>
      <h2>Two probes, two directions</h2>
    </header>
    <p class="shelf-card-subtitle">Why "mass-mean" and "logistic-regression" probes can disagree, even when both separate true from false.</p>
    <div class="tag-row" role="list">
      <span class="tag" role="listitem">interactive explainer</span>
      <span class="tag" role="listitem">AI safety</span>
      <span class="tag" role="listitem">interpretability</span>
    </div>
  </article>
</a>
```

### Step 4 — `netlify.toml` (no change usually needed)

The `[[headers]] for "/_wip/*"` block stops mattering once nothing is under `/_wip/`. Leave it in place for future drafts. Only delete it if you remove the `_wip/` folder entirely.

### Step 5 — Push

```bash
git add -A
git commit -m "publish: probing geometry visualization"
git push
```

Netlify rebuilds and the page is live at:

```
https://jacquelinetay.com/apps/neural-network-visual/probing/
```

---

## Adding more visualizations to this section

1. Create a new subfolder under `_wip/neural-network-visual/<slug>/`.
2. Copy `probing/index.html` as a starting template — it already includes the site shell, the noindex meta, and the breadcrumb.
3. Add a card to the hub at `_wip/neural-network-visual/index.html` (inside `<ul class="nn-hub__list">`).
4. When ready, follow the publish recipe above with `<slug>` instead of `probing`.

## TL;DR for future me

If a future me (or future Claude) is asked **"please make the probing app public"**, do exactly:

1. `git mv _wip/neural-network-visual/probing apps/neural-network-visual/probing`
2. In `apps/neural-network-visual/probing/index.html`:
   - delete the `<meta name="robots" …>` line,
   - add the canonical + OG + Twitter meta tags shown in Step 2,
   - drop `· Draft` from the breadcrumb,
   - delete the `draft-flag` paragraph.
3. Add the shelf card from Step 3 to `shelf/index.html`.
4. `git commit` and `git push`.

For the **dot-product** app, do the same thing with `dot-product` in place of `probing` everywhere. Suggested shelf card text:

```html
<a class="shelf-card-hit" href="/apps/neural-network-visual/dot-product/">
  <article class="shelf-item">
    <header>
      <h2>The dot product: a probe meets an activation</h2>
    </header>
    <p class="shelf-card-subtitle">An interactive sketch of how a probe is "applied" to a model activation — drag two arrows and watch the shadow.</p>
    <div class="tag-row" role="list">
      <span class="tag" role="listitem">interactive explainer</span>
      <span class="tag" role="listitem">AI safety</span>
      <span class="tag" role="listitem">linear algebra</span>
    </div>
  </article>
</a>
```

And suggested OG/Twitter description for the dot-product page:

```
content="An interactive sketch: drag a probe and a model activation in 2D and watch the dot product as the shadow of the activation on the probe."
```

For the **building-a-probe** app, do the same thing with `building-a-probe` in place of `probing` everywhere. Suggested shelf card text:

```html
<a class="shelf-card-hit" href="/apps/neural-network-visual/building-a-probe/">
  <article class="shelf-item">
    <header>
      <h2>Building a probe: from sentences to a direction</h2>
    </header>
    <p class="shelf-card-subtitle">A 6-beat walkthrough of how a labeled dataset becomes a probe direction in an LLM's activation space — from text to dot to arrow.</p>
    <div class="tag-row" role="list">
      <span class="tag" role="listitem">interactive explainer</span>
      <span class="tag" role="listitem">AI safety</span>
      <span class="tag" role="listitem">interpretability</span>
    </div>
  </article>
</a>
```

And suggested OG/Twitter description for the building-a-probe page:

```
content="A step-by-step pedagogical sketch: how a labeled dataset of sentences becomes a probe direction in an LLM's activation space."
```

That's it.
