# Application Tracker

A lightweight job application tracker built as a static web app.

## Local development

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to Cloudflare Pages via GitHub

1. Create a GitHub repository for this project and push the files to it.
2. In Cloudflare Pages, choose Create a project, then Connect to Git.
3. Select the GitHub repository.
4. Use these settings:
   - Framework preset: None
   - Build command: leave empty
   - Build output directory: `.`
5. Deploy.
