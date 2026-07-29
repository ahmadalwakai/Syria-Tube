# Syria Tube Product Upgrade Roadmap

This roadmap keeps the app useful, calm, and honest for real people using it on phones.

See `docs/human-experience-upgrades.md` for the 33 concrete product, design, and tooling updates behind this roadmap.

## Phase 1: Trust And Reliability

- Replace the temporary Cloudflare quick tunnel with a stable production backend URL.
- Use `docs/backend-production.md` as the backend deployment checklist.
- Keep YouTube API keys server-side only.
- Keep production builds blocked unless the API URL is HTTPS and public.
- Keep `/health/live` and `/health/ready` available for support checks.
- Add uptime monitoring for the backend and alert before users discover outages.

## Phase 2: Human Playback Experience

- Keep native direct videos playing after screen lock unless the user pauses.
- Show lock-screen support only when the video has a backend-provided direct playback URL.
- Keep YouTube embed videos honest: save progress, keep the session alive, and resume foreground playback, but do not promise lock-screen playback.
- Improve the mini player so browsing never feels like losing the current video.
- Keep improving the queue view for "Up Next", reorder, remove, and clear.

## Phase 3: Home And Discovery

- Make Home start with "Continue Watching", "Watch Later", and recent topics.
- Let users hide sections they do not care about.
- Keep search filters visible but compact.
- Add search suggestions and recent searches without saving them in private sessions.
- Show lightweight progress bars on watched thumbnails.

## Phase 4: Library And Control

- Make Watch Later, Favourites, and Collections easy to scan and edit.
- Add batch actions for removing saved videos.
- Add a local data screen for clearing history, searches, and saved lists.
- Keep private session mode obvious but unobtrusive.

## Phase 5: Support Tools

- Keep a safe support snapshot in Settings with app version, API host, feed status, playback source, and last error code.
- Never include API keys, tokens, full signed media URLs, cookies, or request headers in support reports.
- Add a simple problem-report path that shares the safe snapshot.

## Phase 6: Accessibility And Localization

- Keep all icon buttons labelled for VoiceOver.
- Support larger text without broken layouts.
- Add Arabic and RTL as a first-class language path.
- Use short human messages for empty states and errors.

## Release Gates

- `npm run typecheck`
- `npm test`
- `npm run testflight:ready`
- `npm run testflight:ready:lock-screen` for releases claiming available native lock-screen playback
- `npm run validate:production-config` with a production HTTPS API URL
- `npx expo-doctor`
- `npx expo install --check`
- TestFlight smoke test on a real iPhone:
  - home feed loads
  - search loads
  - video opens
  - native direct playback continues after screen lock
  - pause while locked does not auto-resume
  - YouTube embed fallback does not claim lock-screen playback
