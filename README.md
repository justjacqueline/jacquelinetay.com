# jacquelinetay.com (static site)

One repo for your personal site: **`/shelf/`** is the main surface; charts live under `/charts/…`. The root `index.html` links to the shelf for local preview; **Netlify** redirects `/` → `/shelf/` (see `netlify.toml`).

## Run locally

From this folder:

```bash
python3 -m http.server 8888
```

Open `http://localhost:8888/shelf/` (or `http://localhost:8888/` and follow the link).

## Deploy (Netlify)

1. Push this repo to GitHub.
2. New site on Netlify → import repo.
3. **Publish directory:** leave empty or `.` (root). `netlify.toml` sets `publish = "."`.
4. Add custom domain `jacquelinetay.com` and follow Netlify’s DNS steps at Porkbun.

## Header logo

Replace `assets/logo-home.png` with your export **as-is** (no cropping in the repo). After swapping files, update the `width` / `height` on the `<img class="site-logo">` tags in the HTML shell pages and the `aspect-ratio` in `assets/site.css` to match the new pixel dimensions.

## Add a new visualization

1. Create `charts/<short-name>/index.html` (and any JSON next to it).
2. Add a card on `shelf/index.html` linking to `/charts/<short-name>/`.
3. Push → Netlify redeploys.

The worry-automation chart was copied from `americans-worry-work-being-automated/public/`; you can delete that old repo once this site is the source of truth.
