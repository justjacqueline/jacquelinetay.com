# jacquelinetay.com (static site)

One repo for your personal site: home, **Shelf** (project index), **About**, and self-contained charts under `/charts/…`.

## Run locally

From this folder:

```bash
python3 -m http.server 8888
```

Open `http://localhost:8888` (paths like `/shelf/` work with the dev server).

## Deploy (Netlify)

1. Push this repo to GitHub.
2. New site on Netlify → import repo.
3. **Publish directory:** leave empty or `.` (root). `netlify.toml` sets `publish = "."`.
4. Add custom domain `jacquelinetay.com` and follow Netlify’s DNS steps at Porkbun.

## Add a new visualization

1. Create `charts/<short-name>/index.html` (and any JSON next to it).
2. Add a card on `shelf/index.html` linking to `/charts/<short-name>/`.
3. Push → Netlify redeploys.

The worry-automation chart was copied from `americans-worry-work-being-automated/public/`; you can delete that old repo once this site is the source of truth.
