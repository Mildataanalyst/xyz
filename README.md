# YouTube → PDF

A phone-first static web app that turns YouTube captions into a clean PDF.

## How it works
1. Open the site on your phone.
2. Paste your Supadata API key once under **API key settings**.
3. Paste a YouTube link.
4. Tap **Make PDF**.
5. The PDF downloads to your device.

Each PDF uses the YouTube video's title automatically. The filename also includes the video ID so files from different videos do not overwrite each other.

The API key is stored in browser `localStorage` on that device. This version is intentionally static, so it can be hosted on Vercel, Netlify, Cloudflare Pages, or GitHub Pages without a backend.

## Transcript provider
Uses Supadata:
- `GET https://api.supadata.ai/v1/transcript?url=...`
- `GET https://api.supadata.ai/v1/metadata?url=...`

## Important
Use the app only for videos/transcripts you have permission to copy or reuse.
