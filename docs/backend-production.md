# Syria Tube Backend Production Runbook

The mobile app needs a stable public HTTPS backend. Do not use account-less Cloudflare quick tunnels for TestFlight or App Store builds.

## Required Environment

- `YOUTUBE_DATA_API_KEY`: server-side YouTube Data API key. Never expose this through Expo public config.
- `PORT`: optional. Defaults to `8787`.
- `SYRIA_TUBE_DIRECT_SOURCES_JSON`: optional JSON map of direct native playback sources.
- `SYRIA_TUBE_DIRECT_SOURCES_FILE`: optional file path containing the same JSON. Use either this or `SYRIA_TUBE_DIRECT_SOURCES_JSON`, not both.

Direct playback sources must use HTTPS and are the only videos that can keep playing after iPhone screen lock.
For any release that claims lock-screen playback, at least one direct source must be configured before shipping.

## Local Checks

```bash
npm run api:validate
npm run api:health -- http://127.0.0.1:8787
```

Use a deep check when the backend has a valid YouTube API key and network access:

```bash
npm run testflight:ready
npm run api:health -- https://api.example.com --deep --require-direct-sources
```

Use `npm run testflight:ready:lock-screen` only for releases that must prove native lock-screen playback sources are present.

The health script prints host and status only. It must not print API keys, signed playback URLs, headers, cookies, or tokens.

## Container Build

```bash
docker build -t syria-tube-backend .
docker run --rm -p 8787:8787 -e YOUTUBE_DATA_API_KEY=... syria-tube-backend
```

For production, configure the secret in the hosting provider instead of storing it in source control.

## Deployment Checklist

- Deploy `server/youtube-proxy.mjs` as a long-running Node service.
- Set `YOUTUBE_DATA_API_KEY` as a secret.
- Attach a public HTTPS domain.
- Do not use a `trycloudflare.com` quick tunnel as the production backend URL.
- Configure `SYRIA_TUBE_DIRECT_SOURCES_JSON` or `SYRIA_TUBE_DIRECT_SOURCES_FILE` with licensed HTTPS native playback sources.
- Add licensed HTTPS native playback sources with `npm run direct-sources:add -- --video=<youtube-id-or-url> --playback=<https-hls-or-mp4-url> --type=hls`.
- Keep `config/direct-sources.production.json` current, then run `npm run direct-sources:validate`, `npm run direct-sources:sync`, and `npx vercel --prod --scope ahmadalwakais-projects` to update Vercel's `SYRIA_TUBE_DIRECT_SOURCES_JSON`.
- Confirm:
  - `GET /health/live` returns `200`.
  - `GET /health/ready` returns `200` and `ready: true`.
  - `GET /health/ready` reports `directPlaybackSources` greater than `0` for lock-screen playback releases.
  - `npm run api:health -- https://your-host --deep --require-direct-sources` passes.
- Update EAS production env:

```bash
eas env:update production --variable-name EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL --value https://your-host
```

- Run:

```bash
npm run validate:production-config
```

- Build a new TestFlight binary after the EAS env update.
