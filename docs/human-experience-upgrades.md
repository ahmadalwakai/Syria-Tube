# Syria Tube Human Experience Upgrades

This list turns the app upgrade direction into 33 concrete product, design, and tooling updates. Each item should make the app calmer, clearer, or more useful for real people.

## 33 Updates

1. Replace the temporary public tunnel with a stable HTTPS backend URL.
2. Keep production builds blocked when the API URL is missing, local, private, or insecure.
3. Keep `/health/live` and `/health/ready` available for support and uptime checks.
4. Add uptime monitoring for backend health before users notice outages.
5. Keep YouTube API keys server-side only.
6. Keep direct native playback URLs optional and never expose signed URLs in support logs.
7. Preserve lock-screen playback for native direct videos unless the user pauses.
8. Show honest playback capability labels for native direct videos versus YouTube embed videos.
9. Keep the mini player available while browsing Home, Search, and Library.
10. Save playback progress when the app leaves the foreground.
11. Avoid foreground auto-play after iOS interrupts YouTube WebView playback.
12. Add a queue view with reorder, remove, and clear controls.
13. Keep Up Next suggestions isolated from active playback failures.
14. Show suggested search chips before the user types.
15. Mix recent searches with preferred topics without saving private-session searches.
16. Keep search filters compact and understandable.
17. Preserve search results during refresh until the replacement response arrives.
18. Add content preferences for news, music, sports, technology, documentaries, and learning.
19. Let users choose which Home sections appear.
20. Keep watched progress visible on thumbnails.
21. Put Continue Watching, Watch Later, and Favourites where users can find them quickly.
22. Add quick clear controls for Continue Watching, Watch Later, and Favourites.
23. Let users clear videos from a collection without deleting the collection itself.
24. Keep collection creation lightweight and local-first.
25. Keep separate data controls for watch history, search history, and saved lists.
26. Keep private session clear, simple, and respected across history and search.
27. Support larger text without layout overlap.
28. Keep all icon-only buttons accessible with labels.
29. Add Arabic and RTL as a first-class localization path.
30. Use short, human empty states instead of technical failure language.
31. Provide a safe support snapshot with version, host, status, playback source, and last error code.
32. Add release checks for TypeScript, tests, Expo Doctor, dependency compatibility, backend validation, and production config.
33. Run a real-device TestFlight smoke test covering Home, Search, playback, lock-screen native playback, pause while locked, and YouTube embed fallback behavior.

## Current App Coverage

- Implemented now: content preferences, suggested searches, home section controls, quick library clear actions, manageable playback queue, comfort settings for reduced motion and readable text, safe support snapshot, safe problem report sharing, data controls, production config validation, backend health tooling, and native lock-screen playback support for direct sources.
- Still needs product/backend follow-up: stable production backend hosting, real direct playback source inventory, full Arabic/RTL localization, uptime monitoring, and real-device TestFlight smoke testing.
