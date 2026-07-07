# Moment Aware

A tiny, offline-first PWA to help you become aware in the moment — when an
urge or a wave of anxiety hits, tap one button to log the moment (time + date
saved instantly), then write down what happened whenever you're ready.

Includes a simple daily streak with a reward badge every 10 days to keep you
coming back.

## Features
- **Big "I'M HERE" button** — one tap saves a timestamped slot instantly.
- **Notes** — describe what happened; edit the time/date later if needed.
- **Daily streak** — any activity (opening the app *or* logging a moment)
  counts as showing up that day. Miss a day and it resets.
- **Rewards** — earn a named badge every 10 consecutive days, with a small
  celebration.
- **Search** your past notes.
- **Export / Import** all data as JSON.
- **100% on-device** — data lives in your browser (IndexedDB + localStorage).
  No accounts, no servers, no tracking, no network calls.
- **Installable & offline** — "Add to Home Screen" for an app-like icon that
  works with no connection.

## Tech
Plain HTML/CSS/JS. No build step, no dependencies. Deploys as a static site.

## Deploy (Netlify)
This repo is deploy-ready. Connect it to Netlify and use these settings:
- **Build command:** *(leave empty)*
- **Publish directory:** `.`

`netlify.toml` already sets the correct caching headers (notably `no-cache`
for `sw.js` so updates roll out).

## Local preview
```
python3 -m http.server 8000
# then open http://localhost:8000
```

All data stays on your device.
