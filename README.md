# Syria Tube

Syria Tube is now an Expo React Native TypeScript app prepared for iOS TestFlight delivery through EAS Build and EAS Submit.

## Current Project Shape

- Root path: `C:\Syria Tube`
- Framework: Expo React Native
- Language: TypeScript
- Package manager: npm
- Expo package checked from npm on 2026-07-27: `57.0.8`
- React Native package checked from npm on 2026-07-27: `0.86.0`
- EAS CLI package checked from npm on 2026-07-27: `21.3.0`
- iOS bundle identifier: `app.syriatube.ios`
- App Store Connect app ID: `6794990700`
- iOS build target: EAS cloud build for iOS store/TestFlight distribution
- Secrets: none committed
- YouTube playback: official embedded IFrame player only, inside `react-native-webview`

## YouTube Boundary

The app keeps YouTube playback inside the official embedded player and does not include raw stream URLs, media extraction, download logic, MP3 conversion, proxying, offline playback, ad removal, hidden background playback, PiP, AirPlay, Chromecast, or manual quality controls.

Search uses local sample metadata unless `EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL` points to a backend. A local backend proxy is available at `server/youtube-proxy.mjs`; it reads `YOUTUBE_DATA_API_KEY` from `.env.local` or the process environment and keeps the key server-side. Do not place a YouTube API key in Expo public config or the mobile bundle.

Official references used:

- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- YouTube player parameters: https://developers.google.com/youtube/player_parameters
- YouTube API Services Terms: https://developers.google.com/youtube/terms/api-services-terms-of-service
- YouTube Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Expo iOS submit docs: https://docs.expo.dev/submit/ios/
- Expo app config docs: https://docs.expo.dev/versions/latest/config/app/
- Expo `eas.json` docs: https://docs.expo.dev/eas/json/

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm start
```

Run the local YouTube search proxy:

```bash
npm run api
```

Use the proxy from Expo during development:

```bash
set EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL=http://localhost:8787
npm start
```

For TestFlight, deploy this proxy behind a public HTTPS URL and build with `EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL` set to that URL.

Run checks:

```bash
npm run typecheck
npm test
```

## TestFlight

This Windows machine can prepare and trigger EAS cloud builds, but actual TestFlight submission requires:

- Expo account login
- Paid Apple Developer account
- App Store Connect app record
- Apple signing credentials or EAS-managed credentials
- App Store Connect API key or interactive Apple authentication

Commands after credentials are ready:

```bash
eas login
eas credentials --platform ios
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

You can also use one step after the project is connected to EAS:

```bash
eas build --platform ios --profile production --auto-submit
```

The submitted build appears in TestFlight after App Store Connect processing.

On this Windows machine, `C:\Users\Administrator\AppData\Local\pnpm\eas.ps1` shadows the newer npm EAS install. Use `C:\nvm4w\nodejs\eas.cmd` directly if `eas --version` is not `21.3.0`.

Current App Store Connect status:

- App ID `app.syriatube.ios` is registered in Certificates, Identifiers & Profiles.
- App Store Connect app record `Syria Tube` exists with app ID `6794990700`.
- `eas.json` includes `submit.production.ios.ascAppId` for non-interactive submission.
- Production iOS signing credentials are configured on EAS with an active provisioning profile for `app.syriatube.ios`.
- App Store Connect API key `262G7276R6` is configured on EAS for submission.
- EAS iOS production build `2e87e35b-5c12-4cff-8489-bae5711632a5` finished successfully for app version `1.0.0`, build number `5`.
- EAS iOS submission `ce8f53a4-354d-4ce3-ae1d-19017ef7be5f` finished successfully and uploaded the build to App Store Connect/TestFlight.
- App Store Connect shows build `1.0.0 (5)` as validated, with the new Syria Tube icon embedded from the uploaded build, and assigned to the `Internal Testers` group.

Credential setup command:

```bash
C:\nvm4w\nodejs\eas.cmd credentials:configure-build --platform ios --profile production
```

Build and submit command after credentials are validated:

```bash
C:\nvm4w\nodejs\eas.cmd build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

## App Review Note Draft

Syria Tube is a React Native iOS app that uses the official YouTube embedded IFrame player for playback. The app adds native value through organised collections, continue watching, local history controls, private sessions, focus sessions, and reduced-distraction discovery surfaces. It does not download, cache, convert, proxy, expose, or extract YouTube audiovisual streams, and it does not claim background playback, PiP, AirPlay, Chromecast, ad removal, or offline playback. Local data is limited to user-created organisation state and watch progress.
