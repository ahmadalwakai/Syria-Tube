import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  ActivePlaybackSession,
  HomeContent,
  HomeFeedState,
  SuggestionState,
  YouTubeApiError,
  YouTubeVideo,
  addVideoToQueue,
  addToCollection,
  beginHomeFeedRequest,
  beginSuggestionRequest,
  completeHomeFeedFailure,
  completeHomeFeedSuccess,
  completeSuggestionFailure,
  completeSuggestionSuccess,
  contentPreferenceKeys,
  createInitialHomeFeedState,
  createInitialLibrary,
  createInitialSuggestionState,
  createProgress,
  defaultContentPreferenceKeys,
  dedupeSearchResults,
  dedupeVideos,
  filterPlayableVideos,
  formatDuration,
  formatPublishedDate,
  formatViews,
  hasNativePlaybackSource,
  isContentPreferenceKey,
  isConnectivityError,
  isPlayableVideo,
  moveQueuedVideo,
  playbackIntentAfterNativeStateChange,
  recordSearch,
  removeVideoFromQueue,
  upsertProgress,
  youtubeError
} from '../core';
import { capabilitiesForPlayback, resolvePlaybackDescriptor } from '../player/PlaybackResolver';
import { parseYouTubePlayerEvent } from '../player/adapters/YouTubePlaybackAdapter';
import { sanitizeDevelopmentDiagnostic } from '../observability';
import {
  fetchVideosByIds,
  resolveSearchApiBaseUrl,
  joinSearchApiUrl,
  retryDelayWithJitter
} from '../searchApi';
import {
  YouTubeVideoItem,
  mapYouTubeApiError,
  mapYouTubeSearchPage,
  mapYouTubeVideosPage,
  parseYouTubeDuration
} from '../youtubeData';
import { fetchHomeContent } from '../searchApi';

const videoId = 'AbCdEfGhIj1';
const secondVideoId = 'KLMnopQRsT2';

function fixtureVideo(overrides: Partial<YouTubeVideo> = {}): YouTubeVideo {
  return {
    kind: 'video',
    id: videoId,
    title: 'Real mapped video',
    channelId: 'UCRealChannel',
    channelName: 'Real Channel',
    thumbnailUrl: 'https://i.ytimg.com/vi/AbCdEfGhIj1/hqdefault.jpg',
    durationSeconds: 366,
    viewCount: 1200,
    publishedAt: '2026-07-01T00:00:00Z',
    description: 'Mapped from a YouTube API fixture',
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    categoryId: '28',
    liveStatus: 'none',
    embeddable: true,
    availability: 'public',
    ...overrides
  };
}

function fixtureVideoItem(overrides: Partial<YouTubeVideoItem> = {}): YouTubeVideoItem {
  return {
    id: videoId,
    snippet: {
      publishedAt: '2026-07-01T00:00:00Z',
      title: 'Real &amp; mapped video',
      description: 'Mapped from YouTube',
      channelId: 'UCRealChannel',
      channelTitle: 'Real Channel',
      categoryId: '28',
      thumbnails: {
        high: { url: 'https://i.ytimg.com/vi/AbCdEfGhIj1/hqdefault.jpg' }
      }
    },
    contentDetails: { duration: 'PT6M6S' },
    statistics: { viewCount: '1200' },
    status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
    ...overrides
  };
}

test('formats real metadata', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(Number.NaN), '0:00');
  assert.equal(formatViews(1200), '1,200 views');
  assert.equal(formatViews(null), 'Views unavailable');
  assert.equal(formatPublishedDate('2026-07-01T00:00:00Z', new Date('2026-07-27T00:00:00Z')), '26d ago');
});

test('validates and classifies watch progress', () => {
  assert.equal(createProgress('invalid', 1, 10), null);
  assert.equal(createProgress(videoId, -1, 10), null);
  assert.equal(createProgress(videoId, 11, 10), null);
  assert.equal(createProgress(videoId, Number.POSITIVE_INFINITY, 10), null);
  assert.equal(createProgress(videoId, 89, 100)?.completed, false);
  assert.equal(createProgress(videoId, 90, 100)?.completed, true);
  assert.equal(createProgress(videoId, 20, 100)?.progressPercent, 0.2);
});

test('private session writes no history or searches', () => {
  const library = { ...createInitialLibrary(), privateSession: true };
  const progress = createProgress(videoId, 10, 100);
  assert.ok(progress);
  const afterProgress = upsertProgress(library, fixtureVideo(), progress);
  const afterSearch = recordSearch(library, 'swiftui');
  assert.equal(afterProgress.history.length, 0);
  assert.equal(afterSearch.recentSearches.length, 0);
});

test('collections and resources are deduplicated', () => {
  const collection = addToCollection(addToCollection({ id: 'one', name: 'One', videoIds: [] }, videoId), videoId);
  assert.deepEqual(collection.videoIds, [videoId]);
  assert.equal(dedupeVideos([fixtureVideo(), fixtureVideo()]).length, 1);
  assert.equal(dedupeSearchResults([fixtureVideo(), fixtureVideo(), { ...fixtureVideo(), kind: 'video' }]).length, 1);
});

test('playback queue helpers dedupe, prioritize, remove, and reorder videos', () => {
  const first = fixtureVideo({ id: videoId, title: 'First' });
  const second = fixtureVideo({ id: secondVideoId, title: 'Second' });
  const third = fixtureVideo({ id: 'ZyxwvUtsRq1', title: 'Third' });
  let queue = addVideoToQueue([], first, null, 'end');

  queue = addVideoToQueue(queue, first, null, 'end');
  assert.deepEqual(queue.map((video) => video.id), [videoId]);

  queue = addVideoToQueue(queue, second, null, 'next');
  queue = addVideoToQueue(queue, second, secondVideoId, 'next');
  queue = addVideoToQueue(queue, third, secondVideoId, 'end');
  assert.deepEqual(queue.map((video) => video.id), [secondVideoId, videoId, 'ZyxwvUtsRq1']);

  queue = moveQueuedVideo(queue, videoId, 'up');
  assert.deepEqual(queue.map((video) => video.id), [videoId, secondVideoId, 'ZyxwvUtsRq1']);

  queue = moveQueuedVideo(queue, videoId, 'down');
  assert.deepEqual(queue.map((video) => video.id), [secondVideoId, videoId, 'ZyxwvUtsRq1']);

  queue = removeVideoFromQueue(queue, videoId);
  assert.deepEqual(queue.map((video) => video.id), [secondVideoId, 'ZyxwvUtsRq1']);
});

test('parses YouTube ISO 8601 durations', () => {
  assert.equal(parseYouTubeDuration('PT6M6S'), 366);
  assert.equal(parseYouTubeDuration('PT1H2M3S'), 3723);
  assert.equal(parseYouTubeDuration('PT45S'), 45);
  assert.equal(parseYouTubeDuration('six minutes'), null);
});

test('maps search responses through hydrated videos.list data', () => {
  const page = mapYouTubeSearchPage(
    {
      nextPageToken: 'NEXT',
      pageInfo: { totalResults: 3, resultsPerPage: 20 },
      items: [
        {
          id: { kind: 'youtube#video', videoId },
          snippet: {
            publishedAt: '2026-07-01T00:00:00Z',
            title: 'Search shell',
            description: 'search.list shell',
            channelTitle: 'Search Channel',
            thumbnails: {}
          }
        },
        {
          id: { kind: 'youtube#video', videoId },
          snippet: {
            publishedAt: '2026-07-01T00:00:00Z',
            title: 'Duplicate shell',
            description: 'duplicate',
            channelTitle: 'Search Channel',
            thumbnails: {}
          }
        },
        {
          id: { kind: 'youtube#channel', channelId: 'UCValidChannel' },
          snippet: {
            publishedAt: '2026-07-01T00:00:00Z',
            title: 'Real Channel',
            description: 'Channel result',
            thumbnails: { default: { url: 'https://yt.example/channel.jpg' } }
          }
        }
      ]
    },
    {
      items: [fixtureVideoItem()]
    }
  );

  assert.equal(page.pageInfo.nextPageToken, 'NEXT');
  assert.equal(page.pageInfo.totalResults, 3);
  assert.equal(page.results.length, 2);
  assert.equal(page.results[0].kind, 'video');
  assert.equal(page.results[0].title, 'Real & mapped video');
  assert.equal(page.results[0].durationSeconds, 366);
  assert.equal(page.results[0].viewCount, 1200);
  assert.equal(page.results[1].kind, 'channel');
});

test('filters unavailable and non-embeddable videos', () => {
  const page = mapYouTubeVideosPage({
    items: [
      fixtureVideoItem(),
      fixtureVideoItem({
        id: secondVideoId,
        status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' }
      })
    ]
  });

  assert.deepEqual(page.videos.map((video) => video.id), [videoId]);
  assert.equal(filterPlayableVideos([fixtureVideo(), fixtureVideo({ id: secondVideoId, embeddable: false, availability: 'embeddingDisabled' })]).length, 1);
});

test('allows native direct-source videos through the playable filter', () => {
  const nativeVideo = fixtureVideo({
    embeddable: false,
    availability: 'public',
    playbackUrl: 'https://media.example.test/video.m3u8',
    playbackContentType: 'hls'
  });

  assert.equal(hasNativePlaybackSource(nativeVideo), true);
  assert.equal(isPlayableVideo(nativeVideo), true);
  assert.deepEqual(filterPlayableVideos([nativeVideo]).map((video) => video.id), [videoId]);
});

test('production API base URL rejects local, LAN, and non-HTTPS hosts', () => {
  const local = resolveSearchApiBaseUrl('https://127.0.0.1:8787', 'production');
  const lan = resolveSearchApiBaseUrl('https://192.168.1.15:8787', 'production');
  const dockerLan = resolveSearchApiBaseUrl('https://10.0.0.4:8787', 'production');
  const privateLan = resolveSearchApiBaseUrl('https://172.20.0.4:8787', 'production');
  const insecure = resolveSearchApiBaseUrl('http://api.example.test', 'production');
  const quickTunnel = resolveSearchApiBaseUrl('https://temporary.trycloudflare.com', 'production');
  const production = resolveSearchApiBaseUrl('https://api.example.test////', 'production');
  const missing = resolveSearchApiBaseUrl('', 'production');

  assert.equal(local.ok, false);
  assert.equal(lan.ok, false);
  assert.equal(dockerLan.ok, false);
  assert.equal(privateLan.ok, false);
  assert.equal(insecure.ok, false);
  assert.equal(quickTunnel.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(production.ok, true);
  assert.equal(production.ok ? production.url : '', 'https://api.example.test');
});

test('development API base URL accepts local HTTP and route joining preserves paths and query', () => {
  const development = resolveSearchApiBaseUrl('http://localhost:8787/dev-api///', 'development');
  assert.equal(development.ok, true);
  assert.equal(development.ok ? development.url : '', 'http://localhost:8787/dev-api');

  const joined = joinSearchApiUrl('https://api.example.test/mobile-api/', '/youtube/search?query=news&type=videos');
  assert.equal(joined.toString(), 'https://api.example.test/mobile-api/youtube/search?query=news&type=videos');
});

test('request retry jitter is bounded above the base delay', () => {
  assert.equal(retryDelayWithJitter(1000, () => 0), 1000);
  assert.equal(retryDelayWithJitter(1000, () => 0.999), 1199);
});

test('playback resolver maps YouTube, native direct, and unavailable descriptors', () => {
  const youtube = resolvePlaybackDescriptor(fixtureVideo());
  const native = resolvePlaybackDescriptor(
    fixtureVideo({
      embeddable: false,
      availability: 'public',
      playbackUrl: 'https://media.example.test/video.m3u8',
      playbackContentType: 'hls'
    })
  );
  const unavailable = resolvePlaybackDescriptor(fixtureVideo({ embeddable: false, availability: 'embeddingDisabled' }));
  const invalidId = resolvePlaybackDescriptor(fixtureVideo({ id: 'invalid-id' }));
  const invalidNativeData = resolvePlaybackDescriptor(
    fixtureVideo({
      embeddable: false,
      availability: 'public',
      playbackUrl: 'file:///private/video.mp4'
    })
  );

  assert.equal(youtube.kind, 'youtube-embed');
  assert.equal(native.kind, 'native-direct');
  assert.equal(unavailable.kind, 'unavailable');
  assert.equal(unavailable.kind === 'unavailable' ? unavailable.reason : '', 'embedding-disabled');
  assert.equal(invalidId.kind, 'unavailable');
  assert.equal(invalidId.kind === 'unavailable' ? invalidId.reason : '', 'invalid-video-id');
  assert.equal(invalidNativeData.kind, 'unavailable');
});

test('native direct playback requires HTTPS sources', () => {
  const insecureNative = fixtureVideo({
    embeddable: false,
    availability: 'public',
    playbackUrl: 'http://media.example.test/video.m3u8',
    playbackContentType: 'hls'
  });

  assert.equal(hasNativePlaybackSource(insecureNative), false);
  assert.equal(isPlayableVideo(insecureNative), false);
  assert.equal(resolvePlaybackDescriptor(insecureNative).kind, 'unavailable');
});

test('capabilities are derived from source kind and platform support', () => {
  const youtube = resolvePlaybackDescriptor(fixtureVideo());
  const native = resolvePlaybackDescriptor(
    fixtureVideo({
      embeddable: false,
      availability: 'public',
      playbackUrl: 'https://media.example.test/video.m3u8',
      playbackContentType: 'hls'
    })
  );
  const platform = { backgroundPlayback: true, pictureInPicture: true, airPlay: true, nowPlaying: true };

  const youtubeCapabilities = capabilitiesForPlayback(youtube, platform);
  const nativeCapabilities = capabilitiesForPlayback(native, platform);

  assert.equal(youtubeCapabilities.backgroundPlayback, false);
  assert.equal(youtubeCapabilities.pictureInPicture, false);
  assert.equal(youtubeCapabilities.airPlay, false);
  assert.equal(nativeCapabilities.backgroundPlayback, true);
  assert.equal(nativeCapabilities.pictureInPicture, true);
  assert.equal(nativeCapabilities.airPlay, true);
});

test('native direct playback source uses only existing safe metadata fields', () => {
  const native = resolvePlaybackDescriptor(
    fixtureVideo({
      playbackUrl: 'https://media.example.test/video.m3u8',
      playbackContentType: 'hls'
    })
  );

  assert.equal(native.kind, 'native-direct');
  const source = native.kind === 'native-direct' && native.source && typeof native.source === 'object' ? native.source : null;
  assert.ok(source);
  assert.equal(source.metadata?.title, 'Real mapped video');
  assert.equal(source.metadata?.artist, 'Real Channel');
  assert.equal(source.metadata?.artwork, 'https://i.ytimg.com/vi/AbCdEfGhIj1/hqdefault.jpg');
  assert.equal('duration' in (source.metadata ?? {}), false);
});

test('development diagnostics allow release-gate fields without exposing sensitive values', () => {
  const safe = sanitizeDevelopmentDiagnostic({
    operation: 'homeFeed',
    sourceKind: 'native-direct',
    playerPhase: 'playing',
    presentationMode: 'mini',
    requestId: 12,
    requestGeneration: 14,
    startedAt: '2026-07-28T10:00:00.000Z',
    finishedAt: '2026-07-28T10:00:01.000Z',
    resultStatus: 'failed',
    errorCode: 'backendUnavailable',
    aborted: false,
    staleResponseIgnored: true,
    startupState: 'loading-content',
    feedState: 'refreshing',
    cachedItemCount: 8,
    retrying: true,
    playbackUrl: 'https://signed.example.test/video.m3u8?token=secret',
    authorization: 'Bearer secret'
  } as Parameters<typeof sanitizeDevelopmentDiagnostic>[0] & Record<string, unknown>);

  assert.deepEqual(safe, {
    operation: 'homeFeed',
    sourceKind: 'native-direct',
    playerPhase: 'playing',
    presentationMode: 'mini',
    requestId: 12,
    requestGeneration: 14,
    startedAt: '2026-07-28T10:00:00.000Z',
    finishedAt: '2026-07-28T10:00:01.000Z',
    resultStatus: 'failed',
    errorCode: 'backendUnavailable',
    aborted: false,
    staleResponseIgnored: true,
    startupState: 'loading-content',
    feedState: 'refreshing',
    cachedItemCount: 8,
    retrying: true
  });
});

test('YouTube adapter ignores stale WebView messages and parses current messages', () => {
  const current = parseYouTubePlayerEvent(JSON.stringify({ type: 'state', state: 1, position: 12, duration: 60, instanceId: 'current' }), 'current');
  const stale = parseYouTubePlayerEvent(JSON.stringify({ type: 'state', state: 2, position: 4, duration: 60, instanceId: 'old' }), 'current');
  const invalid = parseYouTubePlayerEvent('{not-json', 'current');

  assert.equal(current.status, 'ok');
  assert.equal(stale.status, 'stale');
  assert.equal(invalid.status, 'invalid');
});

test('maps quota, rate, page token, and server errors', () => {
  assert.equal(mapYouTubeApiError(403, 'quotaExceeded').code, 'quotaExceeded');
  assert.equal(mapYouTubeApiError(429, 'userRateLimitExceeded').code, 'rateLimitExceeded');
  assert.equal(mapYouTubeApiError(400, 'invalidPageToken').code, 'invalidPageToken');
  assert.equal(mapYouTubeApiError(503).code, 'serverError');
});

test('malformed successful API response is not reported as offline', async () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = 'https://api.example.test';
  process.env.NODE_ENV = 'production';
  globalThis.fetch = async () => new Response('<html>Cloudflare tunnel page</html>', { status: 200 });

  try {
    await assert.rejects(
      () => fetchHomeContent({ historyIds: [], watchLaterIds: [], favouriteIds: [] }),
      (error: unknown) => {
        assert.equal((error as YouTubeApiError).code, 'invalidJson');
        assert.doesNotMatch((error as YouTubeApiError).message, /YouTube service/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = originalBaseUrl;
    }
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('API client maps incorrect routes and auth failures without reporting offline', async () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = 'https://api.example.test';
  process.env.NODE_ENV = 'production';

  try {
    globalThis.fetch = async () => new Response('<html>Not found</html>', { status: 404 });
    await assert.rejects(
      () => fetchHomeContent({ historyIds: [], watchLaterIds: [], favouriteIds: [] }),
      (error: unknown) => {
        assert.equal((error as YouTubeApiError).code, 'notFound');
        assert.equal((error as YouTubeApiError).retryable, false);
        return true;
      }
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Nope' } }), { status: 401 });
    await assert.rejects(
      () => fetchHomeContent({ historyIds: [], watchLaterIds: [], favouriteIds: [] }),
      (error: unknown) => {
        assert.equal((error as YouTubeApiError).code, 'unauthorized');
        assert.equal((error as YouTubeApiError).retryable, false);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = originalBaseUrl;
    }
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('API client rejects response schema mismatches', async () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = 'https://api.example.test';
  process.env.NODE_ENV = 'production';
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });

  try {
    await assert.rejects(
      () => fetchVideosByIds([videoId]),
      (error: unknown) => {
        assert.equal((error as YouTubeApiError).code, 'responseSchemaMismatch');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = originalBaseUrl;
    }
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('backend transport failures are not reported as YouTube outages', async () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = 'https://api.example.test';
  process.env.NODE_ENV = 'production';
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };

  try {
    await assert.rejects(
      () => fetchHomeContent({ historyIds: [], watchLaterIds: [], favouriteIds: [] }),
      (error: unknown) => {
        assert.equal((error as YouTubeApiError).code, 'backendUnavailable');
        assert.equal(isConnectivityError(error as YouTubeApiError), true);
        assert.match((error as YouTubeApiError).message, /Syria Tube backend/);
        assert.doesNotMatch((error as YouTubeApiError).message, /YouTube service/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL = originalBaseUrl;
    }
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, 'NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('preserves mini-player session state without creating a second video model', () => {
  const now = new Date('2026-07-27T00:00:00Z').toISOString();
  const session: ActivePlaybackSession = {
    videoId,
    video: fixtureVideo(),
    currentTimeSeconds: 42,
    durationSeconds: 366,
    state: 'playing',
    playbackIntent: 'play',
    isMini: false,
    interrupted: false,
    startedAt: now,
    updatedAt: now
  };

  const miniSession: ActivePlaybackSession = { ...session, isMini: true };
  assert.equal(miniSession.videoId, session.videoId);
  assert.equal(miniSession.currentTimeSeconds, 42);
  assert.equal(miniSession.video, session.video);
});

test('home feed shows no error during initialization', () => {
  const state = createInitialHomeFeedState();
  assert.equal(state.status, 'initializing');
  assert.equal(state.error, null);
  assert.equal(state.content.sections.length, 0);
});

test('empty loading data is not treated as a home feed failure', () => {
  const state = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  assert.equal(state.status, 'loading');
  assert.equal(state.error, null);
  assert.equal(state.content.sections.length, 0);
});

test('stale failed home request cannot overwrite a newer success', () => {
  const content = fixtureHomeContent();
  const staleError = youtubeError('offline', 'The Syria Tube backend could not be reached.', true);
  let state: HomeFeedState = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  state = beginHomeFeedRequest(state, 2);
  state = completeHomeFeedSuccess(state, 2, content);
  state = completeHomeFeedFailure(state, 1, staleError);
  assert.equal(state.status, 'ready');
  assert.equal(state.content.sections[0].videos[0].id, videoId);
});

test('home retry reaches ready state', () => {
  const offline = youtubeError('offline', 'The Syria Tube backend could not be reached.', true);
  let state: HomeFeedState = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  state = completeHomeFeedFailure(state, 1, offline);
  assert.equal(state.status, 'offline');
  state = beginHomeFeedRequest(state, 2, true);
  assert.equal(state.status, 'loading');
  assert.equal(state.retrying, true);
  state = completeHomeFeedSuccess(state, 2, fixtureHomeContent());
  assert.equal(state.status, 'ready');
  assert.equal(state.retrying, false);
});

test('home refresh preserves existing videos', () => {
  let state: HomeFeedState = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  state = completeHomeFeedSuccess(state, 1, fixtureHomeContent());
  state = beginHomeFeedRequest(state, 2);
  assert.equal(state.status, 'refreshing');
  assert.equal(state.content.sections[0].videos[0].id, videoId);
  state = completeHomeFeedSuccess(state, 2, { spotlight: null, sections: [], errors: [] });
  assert.equal(state.status, 'ready');
  assert.equal(state.content.sections[0].videos[0].id, videoId);
});

test('all-error home refresh keeps previous content and surfaces connectivity state', () => {
  const previous = fixtureHomeContent();
  const backendError = youtubeError('backendUnavailable', 'The Syria Tube backend could not be reached.', true);
  let state: HomeFeedState = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  state = completeHomeFeedSuccess(state, 1, previous);
  state = beginHomeFeedRequest(state, 2);
  state = completeHomeFeedSuccess(state, 2, {
    spotlight: null,
    sections: [],
    errors: [{ key: 'trending', title: 'Trending', error: backendError }]
  });
  assert.equal(state.status, 'partialError');
  assert.equal(state.error?.code, 'backendUnavailable');
  assert.equal(state.content.sections[0].videos[0].id, videoId);
});

test('all-error initial home response becomes terminal connectivity error', () => {
  const backendError = youtubeError('backendUnavailable', 'The Syria Tube backend could not be reached.', true);
  let state: HomeFeedState = beginHomeFeedRequest(createInitialHomeFeedState(), 1);
  state = completeHomeFeedSuccess(state, 1, {
    spotlight: null,
    sections: [],
    errors: [{ key: 'trending', title: 'Trending', error: backendError }]
  });
  assert.equal(state.status, 'offline');
  assert.equal(state.error?.code, 'backendUnavailable');
});

test('startup and feed lifecycle protects against false service-error races', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const offline = youtubeError('offline', 'The Syria Tube backend could not be reached.', true);
  const content = fixtureHomeContent();

  let state = createInitialHomeFeedState();
  assert.equal(state.status, 'initializing');
  assert.equal(state.error, null);

  state = beginHomeFeedRequest(state, 1);
  assert.equal(state.status, 'loading');
  assert.equal(state.error, null);
  assert.equal(state.content.sections.length, 0);

  state = beginHomeFeedRequest(state, 2);
  state = completeHomeFeedSuccess(state, 2, content);
  state = completeHomeFeedFailure(state, 1, offline);
  assert.equal(state.status, 'ready');
  assert.equal(state.content.sections[0].videos[0].id, videoId);

  state = beginHomeFeedRequest(state, 3);
  state = completeHomeFeedFailure(state, 3, offline);
  assert.equal(state.status, 'partialError');
  assert.equal(state.content.sections[0].videos[0].id, videoId);

  const partial = completeHomeFeedSuccess(beginHomeFeedRequest(state, 4), 4, {
    spotlight: fixtureVideo(),
    sections: [{ key: 'trending', title: 'Trending', videos: [fixtureVideo()] }],
    errors: [{ key: 'music', title: 'Music', error: offline }]
  });
  assert.equal(partial.status, 'partialError');
  assert.equal(partial.content.sections[0].videos[0].id, videoId);

  const retrySource = sourceBetween(appSource, 'function retryHome()', 'function loadSuggestions');
  assert.ok(retrySource.includes("homeFeed.retrying || homeFeed.status === 'loading'"));

  const requestSource = sourceBetween(appSource, 'function loadHomeFeed', 'function retryHome');
  assert.ok(requestSource.includes("error.code !== 'cancelled'"));
  assert.ok(requestSource.includes('homeRequestId.current !== requestId || homeController.current !== controller'));
  assert.ok(requestSource.includes('staleResponseIgnored'));
  assert.ok(requestSource.includes('countHomeVideos(homeFeed.content)'));

  const startupEffectSource = sourceBetween(appSource, 'const timeout = setTimeout(() => {\n      loadHomeFeed(controller, false);', '}, [isReady, homeSignature]);');
  assert.ok(startupEffectSource.includes('clearTimeout(timeout);'));
  assert.ok(startupEffectSource.includes('controller.abort();'));
  assert.equal((appSource.match(/AppState\.addEventListener/g) ?? []).length, 1);
  assert.equal(appSource.includes('useFocusEffect'), false);
  assert.equal(appSource.includes("addListener('focus'"), false);
});

test('watch screen keeps player fixed and disables indefinite player dragging', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const playerSource = readFileSync(path.join(process.cwd(), 'src', 'YouTubePlayer.tsx'), 'utf8');
  assert.ok(appSource.includes('bounces={false}'));
  assert.ok(appSource.includes('alwaysBounceVertical={false}'));
  assert.ok(playerSource.includes('scrollEnabled={false}'));
  assert.ok(playerSource.includes('bounces={false}'));
});

test('native direct-source playback is configured for background playback and PiP', () => {
  const appConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'));
  const expoVideoPlugin = appConfig.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-video');
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const nativePlayerSource = readFileSync(path.join(process.cwd(), 'src', 'NativeVideoPlayer.tsx'), 'utf8');
  const serverSource = readFileSync(path.join(process.cwd(), 'server', 'youtube-proxy.mjs'), 'utf8');

  assert.ok(expoVideoPlugin);
  assert.equal(expoVideoPlugin[1].supportsBackgroundPlayback, true);
  assert.equal(expoVideoPlugin[1].supportsPictureInPicture, true);
  assert.deepEqual(appConfig.expo.ios.infoPlist.UIBackgroundModes, ['audio']);
  assert.deepEqual(appConfig.expo.ios.infoPlist.LSApplicationQueriesSchemes, ['youtube', 'vnd.youtube']);
  assert.ok(appSource.includes('<NativeVideoPlayer'));
  assert.ok(appSource.includes('hasNativePlaybackSource(session.video)'));
  assert.ok(nativePlayerSource.includes('configureBackgroundPlayback(instance);'));
  assert.ok(nativePlayerSource.includes('player.staysActiveInBackground = true;'));
  assert.ok(nativePlayerSource.includes('player.showNowPlayingNotification = true;'));
  assert.ok(nativePlayerSource.includes("player.audioMixingMode = 'doNotMix';"));
  assert.ok(nativePlayerSource.includes('player.allowsExternalPlayback = true;'));
  assert.ok(nativePlayerSource.includes('startsPictureInPictureAutomatically'));
  assert.equal(appSource.includes('allows automatic PiP'), false);
  assert.ok(serverSource.includes('SYRIA_TUBE_DIRECT_SOURCES_JSON'));
  assert.ok(serverSource.includes('directPlaybackForVideo(item.id)'));
});

test('native direct player owns one visible VideoView and no manual native player instance', () => {
  const nativePlayerSource = readFileSync(path.join(process.cwd(), 'src', 'NativeVideoPlayer.tsx'), 'utf8');
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

  assert.equal((nativePlayerSource.match(/<VideoView/g) ?? []).length, 1);
  assert.equal((nativePlayerSource.match(/useVideoPlayer\(/g) ?? []).length, 1);
  assert.equal(nativePlayerSource.includes('createVideoPlayer'), false);
  assert.equal(appSource.includes('createVideoPlayer'), false);
  assert.equal((nativePlayerSource.match(/useEventListener\(player/g) ?? []).length, 5);
  assert.equal((appSource.match(/<PersistentPlayer/g) ?? []).length, 1);
});

test('saved video metadata is persisted instead of dropped during refresh failures', () => {
  const storageSource = readFileSync(path.join(process.cwd(), 'src', 'storage.ts'), 'utf8');

  assert.ok(storageSource.includes('savedVideos?: Record<string, YouTubeVideo>;'));
  assert.ok(storageSource.includes('savedVideos: sanitizeSavedVideos(library.savedVideos)'));
  assert.ok(storageSource.includes('savedVideos: sanitizeSavedVideos(parsed.savedVideos ?? {})'));
});

test('player lifecycle events are scoped to the active video session', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

  assert.ok(appSource.includes('const activeSessionRef = useRef<ActivePlaybackSession | null>(activeSession);'));
  assert.ok(appSource.includes('activeSessionRef.current?.videoId === videoId'));
  assert.ok(appSource.includes('current && current.videoId === videoId'));
  assert.ok(appSource.includes('onStateChange(session.videoId, state, position, duration)'));
  assert.ok(appSource.includes('onProgress(session.videoId, session.video, position, duration)'));
});

test('embedded playback prevents automatic screen sleep while playing', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

  assert.ok(appSource.includes("import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';"));
  assert.ok(appSource.includes('const playbackKeepAwakeTag'));
  assert.ok(appSource.includes("const shouldKeepAwake = !usesNativePlayer && session.state !== 'ended' && session.state !== 'error';"));
  assert.ok(appSource.includes('activateKeepAwakeAsync(playbackKeepAwakeTag)'));
  assert.ok(appSource.includes('deactivateKeepAwake(playbackKeepAwakeTag)'));
});

test('embed-only background action routes users to YouTube', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

  assert.ok(appSource.includes('function showBackgroundPlaybackAction(video: YouTubeVideo)'));
  assert.ok(appSource.includes('async function openYouTubeVideo(video: YouTubeVideo)'));
  assert.ok(appSource.includes('youtube://www.youtube.com/watch?v='));
  assert.ok(appSource.includes('vnd.youtube://www.youtube.com/watch?v='));
  assert.ok(appSource.includes("onSetCommand('pause')"));
  assert.ok(appSource.includes("label={hasNativePlaybackSource(video) ? 'Lock Screen' : 'YouTube App'}"));
  assert.ok(appSource.includes('openYouTubeVideo(video)'));
});

test('settings expose a safe support snapshot without secrets', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');
  const reportStart = appSource.indexOf('function supportReportMessage');
  const reportEnd = appSource.indexOf('function shareSupportSnapshot', reportStart);
  const reportSource = appSource.slice(reportStart, reportEnd);

  assert.ok(settingsSource.includes('<SupportSnapshotPanel'));
  assert.ok(settingsSource.includes('Share support snapshot'));
  assert.ok(settingsSource.includes('DiagnosticRow label="API"'));
  assert.ok(settingsSource.includes('DiagnosticRow label="Host"'));
  assert.ok(settingsSource.includes('DiagnosticRow label="Playback"'));
  assert.ok(reportSource.includes('Syria Tube support snapshot'));
  assert.ok(reportSource.includes('API host:'));
  assert.equal(reportSource.includes('YOUTUBE_DATA_API_KEY'), false);
  assert.equal(reportSource.includes('YOUTUBE_DATA_API_PROJECT'), false);
  assert.equal(reportSource.includes('playbackUrl'), false);
  assert.equal(reportSource.includes('Authorization'), false);
});

test('settings provide a safe user problem report path', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');
  const problemStart = appSource.indexOf('function problemReportMessage');
  const problemEnd = appSource.indexOf('function shareSupportSnapshot', problemStart);
  const problemSource = appSource.slice(problemStart, problemEnd);

  assert.ok(settingsSource.includes('<ProblemReportPanel'));
  assert.ok(settingsSource.includes('Report a Problem'));
  assert.ok(settingsSource.includes('Problem note'));
  assert.ok(settingsSource.includes('Share Problem Report'));
  assert.ok(problemSource.includes('supportReportMessage(snapshot)'));
  assert.ok(problemSource.includes('User note:'));
  assert.equal(problemSource.includes('YOUTUBE_DATA_API_KEY'), false);
  assert.equal(problemSource.includes('playbackUrl'), false);
  assert.equal(problemSource.includes('Authorization'), false);
});

test('settings provide separate local data controls', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');

  assert.ok(settingsSource.includes('<DataControlsPanel'));
  assert.ok(settingsSource.includes('Clear Watch History'));
  assert.ok(settingsSource.includes('Clear Search History'));
  assert.ok(settingsSource.includes('Clear Saved Lists'));
  assert.ok(settingsSource.includes('history: []'));
  assert.ok(settingsSource.includes('recentSearches: []'));
  assert.ok(settingsSource.includes('watchLaterIds: []'));
  assert.ok(settingsSource.includes('favouriteIds: []'));
  assert.ok(settingsSource.includes('collections: current.collections.map'));
  assert.ok(settingsSource.includes("style: 'destructive'"));
});

test('users can choose which home sections appear', () => {
  const library = createInitialLibrary();
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const storageSource = readFileSync(path.join(process.cwd(), 'src', 'storage.ts'), 'utf8');
  const homeSource = sourceBetween(appSource, 'function HomeScreen', 'function SearchScreen');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');

  assert.deepEqual(library.homeHiddenSectionKeys, []);
  assert.ok(homeSource.includes('visibleSections = content.sections.filter'));
  assert.ok(homeSource.includes('!library.homeHiddenSectionKeys.includes(section.key)'));
  assert.ok(settingsSource.includes('<HomeSectionsPanel'));
  assert.ok(settingsSource.includes('Home Sections'));
  assert.ok(settingsSource.includes('homeSectionKeys.map'));
  assert.ok(settingsSource.includes('homeHiddenSectionKeys: [...hidden]'));
  assert.ok(settingsSource.includes('Show All Sections'));
  assert.ok(settingsSource.includes('disabled={library.homeHiddenSectionKeys.length === 0}'));
  assert.ok(settingsSource.includes('homeHiddenSectionKeys: []'));
  assert.ok(storageSource.includes('homeHiddenSectionKeys?: HomeSectionKey[];'));
  assert.ok(storageSource.includes('homeHiddenSectionKeys: uniqueHomeSectionKeys(library.homeHiddenSectionKeys)'));
  assert.ok(storageSource.includes('homeHiddenSectionKeys: uniqueHomeSectionKeys(parsed.homeHiddenSectionKeys ?? [])'));
  assert.ok(storageSource.includes('function uniqueHomeSectionKeys'));
});

test('search suggestions use saved content preferences', () => {
  const library = createInitialLibrary();
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const storageSource = readFileSync(path.join(process.cwd(), 'src', 'storage.ts'), 'utf8');
  const searchSource = sourceBetween(appSource, 'function SearchScreen', 'function WatchScreen');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');

  assert.deepEqual(library.contentPreferenceKeys, defaultContentPreferenceKeys);
  assert.deepEqual(contentPreferenceKeys.filter(isContentPreferenceKey), contentPreferenceKeys);
  assert.ok(appSource.includes('const suggestedSearchesByPreference'));
  assert.ok(appSource.includes('function buildSearchSuggestions'));
  assert.ok(appSource.includes('library.contentPreferenceKeys.flatMap'));
  assert.ok(searchSource.includes('Suggested Searches'));
  assert.ok(searchSource.includes('const suggestedQueries = useMemo(() => buildSearchSuggestions(library)'));
  assert.ok(searchSource.includes('function applySuggestedQuery'));
  assert.ok(searchSource.includes('accessibilityLabel={`Search for ${item}`}'));
  assert.ok(settingsSource.includes('<ContentPreferencesPanel'));
  assert.ok(settingsSource.includes('Content Preferences'));
  assert.ok(settingsSource.includes('contentPreferenceKeys.map'));
  assert.ok(settingsSource.includes('contentPreferenceKeys: [...enabledKeys]'));
  assert.ok(settingsSource.includes('Reset Preferences'));
  assert.ok(storageSource.includes('contentPreferenceKeys?: ContentPreferenceKey[];'));
  assert.ok(storageSource.includes('contentPreferenceKeys: uniqueContentPreferenceKeys(library.contentPreferenceKeys)'));
  assert.ok(storageSource.includes('contentPreferenceKeys: uniqueContentPreferenceKeys(parsed.contentPreferenceKeys ?? defaultContentPreferenceKeys)'));
  assert.ok(storageSource.includes('function uniqueContentPreferenceKeys'));
});

test('comfort settings persist and affect text and player motion', () => {
  const library = createInitialLibrary();
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const storageSource = readFileSync(path.join(process.cwd(), 'src', 'storage.ts'), 'utf8');
  const settingsSource = sourceBetween(appSource, 'function SettingsScreen', 'function PersistentPlayer');
  const playerSource = sourceBetween(appSource, 'function PersistentPlayer', 'function PlayerChromeButton');

  assert.equal(library.reduceMotionEnabled, false);
  assert.equal(library.readableTextEnabled, false);
  assert.ok(appSource.includes('const ReadableTextContext = React.createContext(false)'));
  assert.ok(appSource.includes('function readableTextComfort'));
  assert.ok(appSource.includes('<ReadableTextContext.Provider value={library.readableTextEnabled}>'));
  assert.ok(settingsSource.includes('<ComfortSettingsPanel'));
  assert.ok(settingsSource.includes('Comfort'));
  assert.ok(settingsSource.includes('Reduce Motion'));
  assert.ok(settingsSource.includes('Readable Text'));
  assert.ok(playerSource.includes('reducedMotion: boolean;'));
  assert.ok(playerSource.includes('function animateTranslateTo'));
  assert.ok(playerSource.includes('if (reducedMotion)'));
  assert.ok(playerSource.includes('function springTranslateHome'));
  assert.ok(storageSource.includes('reduceMotionEnabled?: boolean;'));
  assert.ok(storageSource.includes('readableTextEnabled?: boolean;'));
  assert.ok(storageSource.includes('reduceMotionEnabled: library.reduceMotionEnabled'));
  assert.ok(storageSource.includes('readableTextEnabled: library.readableTextEnabled'));
});

test('library lists provide targeted quick clear actions', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const librarySource = sourceBetween(appSource, 'function LibraryScreen', 'function SettingsScreen');
  const listBlockSource = sourceBetween(appSource, 'function VideoListBlock', 'function CollectionCard');
  const collectionSource = sourceBetween(appSource, 'function CollectionCard', 'function SettingsSwitch');

  assert.ok(librarySource.includes('function confirmLibraryChange'));
  assert.ok(librarySource.includes('actionLabel="Clear Continue Watching"'));
  assert.ok(librarySource.includes('actionLabel="Clear Watch Later"'));
  assert.ok(librarySource.includes('actionLabel="Clear Favourites"'));
  assert.ok(librarySource.includes('history: []'));
  assert.ok(librarySource.includes('watchLaterIds: []'));
  assert.ok(librarySource.includes('favouriteIds: []'));
  assert.ok(librarySource.includes('collections: current.collections.map'));
  assert.ok(librarySource.includes('<CollectionCard'));
  assert.ok(librarySource.includes('onClear={() =>'));
  assert.ok(listBlockSource.includes('actionLabel?: string;'));
  assert.ok(listBlockSource.includes('actionDisabled?: boolean;'));
  assert.ok(listBlockSource.includes('label={actionLabel ?? `Clear ${title}`}'));
  assert.ok(collectionSource.includes('Clear collection videos'));
  assert.ok(collectionSource.includes('disabled={collection.videoIds.length === 0}'));
});

test('watch screen exposes a manageable playback queue', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const watchSource = sourceBetween(appSource, 'function WatchScreen', 'function UpNextSection');
  const upNextSource = sourceBetween(appSource, 'function UpNextSection', 'function PlaybackQueueSection');
  const queueSource = sourceBetween(appSource, 'function PlaybackQueueSection', 'function LibraryScreen');
  const videoCardSource = sourceBetween(appSource, 'function VideoCard', 'function VideoThumbnail');

  assert.ok(appSource.includes('const [playbackQueue, setPlaybackQueue] = useState<YouTubeVideo[]>([])'));
  assert.ok(appSource.includes('setPlaybackQueue((current) => addVideoToQueue'));
  assert.ok(appSource.includes('playQueuedVideo(nextVideo)'));
  assert.ok(appSource.includes('setPlaybackQueue((current) => removeVideoFromQueue(current, video.id))'));
  assert.ok(watchSource.includes('<PlaybackQueueSection'));
  assert.ok(watchSource.includes('onSelectQueuedVideo'));
  assert.ok(watchSource.includes('playbackQueue={playbackQueue}'));
  assert.ok(upNextSource.includes('playbackQueue: YouTubeVideo[];'));
  assert.ok(upNextSource.includes('queued={playbackQueue.some'));
  assert.ok(queueSource.includes('Queue'));
  assert.ok(queueSource.includes('Clear queue'));
  assert.ok(queueSource.includes('Move queued video up'));
  assert.ok(queueSource.includes('Move queued video down'));
  assert.ok(queueSource.includes('Remove queued video'));
  assert.ok(videoCardSource.includes('Play Next'));
  assert.ok(videoCardSource.includes('Add to Queue'));
  assert.ok(videoCardSource.includes('In queue'));
});

test('suggestions render below video details', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const metadataIndex = appSource.indexOf('<View style={styles.metadataBlock}>');
  const upNextIndex = appSource.indexOf('<UpNextSection', metadataIndex);
  const actionIndex = appSource.indexOf('<View style={styles.actionRow}>', metadataIndex);
  assert.ok(metadataIndex > 0);
  assert.ok(upNextIndex > metadataIndex);
  assert.ok(actionIndex > upNextIndex);
});

test('changing video ignores stale suggestion results', () => {
  let state: SuggestionState = beginSuggestionRequest(createInitialSuggestionState(), 1, videoId);
  state = beginSuggestionRequest(state, 2, secondVideoId);
  state = completeSuggestionSuccess(state, 1, videoId, [fixtureVideo()]);
  assert.equal(state.status, 'loading');
  assert.equal(state.videoId, secondVideoId);
  assert.deepEqual(state.videos, []);
});

test('suggestion failure does not stop playback', () => {
  const now = new Date('2026-07-27T00:00:00Z').toISOString();
  const session: ActivePlaybackSession = {
    videoId,
    video: fixtureVideo(),
    currentTimeSeconds: 42,
    durationSeconds: 366,
    state: 'playing',
    playbackIntent: 'play',
    isMini: false,
    interrupted: false,
    startedAt: now,
    updatedAt: now
  };
  const error: YouTubeApiError = youtubeError('offline', 'The Syria Tube backend could not be reached.', true);
  let suggestions: SuggestionState = beginSuggestionRequest(createInitialSuggestionState(), 1, videoId);
  suggestions = completeSuggestionFailure(suggestions, 1, videoId, error);
  assert.equal(session.state, 'playing');
  assert.equal(suggestions.status, 'offline');
});

test('native playback keeps the lock-screen play intent unless the user pauses', () => {
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'play',
      previousState: 'playing',
      nextState: 'playing',
      appState: 'background',
      hasNativePlayback: true
    }),
    'play'
  );
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'play',
      previousState: 'playing',
      nextState: 'paused',
      appState: 'background',
      hasNativePlayback: true
    }),
    'play'
  );
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'play',
      previousState: 'idle',
      nextState: 'paused',
      appState: 'background',
      hasNativePlayback: true
    }),
    'play'
  );
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'play',
      previousState: 'playing',
      nextState: 'paused',
      appState: 'active',
      hasNativePlayback: true
    }),
    'play'
  );
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'pause',
      previousState: 'paused',
      nextState: 'playing',
      appState: 'background',
      hasNativePlayback: true
    }),
    'play'
  );
  assert.equal(
    playbackIntentAfterNativeStateChange({
      currentIntent: 'play',
      previousState: 'playing',
      nextState: 'paused',
      appState: 'background',
      hasNativePlayback: false
    }),
    'play'
  );
});

test('native player reinforces playback when a playing session enters lock screen', () => {
  const nativePlayerSource = readFileSync(path.join(process.cwd(), 'src', 'NativeVideoPlayer.tsx'), 'utf8');
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

  assert.ok(nativePlayerSource.includes("import { AppState, AppStateStatus, StyleSheet } from 'react-native';"));
  assert.ok(nativePlayerSource.includes("AppState.addEventListener('change'"));
  assert.ok(nativePlayerSource.includes("wasActive && nextState !== 'active' && shouldAutoPlay"));
  assert.ok(nativePlayerSource.includes('keepPlayingAfterScreenLock(player, onStateChange)'));
  assert.ok(nativePlayerSource.includes('const lockScreenRetries'));
  assert.ok(nativePlayerSource.includes('reinforceBackgroundPlayback(player, onStateChange, lockScreenRetries.current)'));
  assert.ok(nativePlayerSource.includes("appState.current !== 'active' && shouldAutoPlay"));
  assert.ok(nativePlayerSource.includes('for (const delay of [250, 650, 1200, 2200])'));
  assert.ok(nativePlayerSource.includes('startsPictureInPictureAutomatically'));
  assert.ok(nativePlayerSource.includes('configureBackgroundPlayback(player);'));
  assert.ok(nativePlayerSource.includes("player.audioMixingMode = 'doNotMix';"));
  assert.ok(nativePlayerSource.includes('player.staysActiveInBackground = true;'));
  assert.ok(nativePlayerSource.includes('player.showNowPlayingNotification = true;'));
  assert.ok(nativePlayerSource.includes("if (player.status === 'error' || player.playing)"));
  assert.ok(nativePlayerSource.includes('player.play();'));
  assert.ok(appSource.includes('playbackIntentAfterNativeStateChange({'));
  assert.ok(appSource.includes('appState: appState.current'));
  assert.ok(appSource.includes('hasNativePlayback: hasNativePlaybackSource(current.video)'));
});

test('Up Next lifecycle is isolated from active playback', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const suggestionsSource = sourceBetween(appSource, 'function loadSuggestions', 'function retrySuggestions');
  const upNextSource = sourceBetween(appSource, 'function UpNextSection', 'function LibraryScreen');
  const watchSource = sourceBetween(appSource, 'function WatchScreen', 'function UpNextSection');
  let suggestions: SuggestionState = beginSuggestionRequest(createInitialSuggestionState(), 1, videoId);

  suggestions = beginSuggestionRequest(suggestions, 2, secondVideoId);
  suggestions = completeSuggestionFailure(suggestions, 1, videoId, youtubeError('offline', 'Offline', true));

  assert.equal(suggestions.videoId, secondVideoId);
  assert.equal(suggestions.status, 'loading');
  assert.ok(appSource.includes('[activeSession?.videoId]'));
  assert.ok(suggestionsSource.includes('suggestionController.current !== controller'));
  assert.ok(suggestionsSource.includes("error.code !== 'cancelled'"));
  assert.ok(suggestionsSource.includes('staleResponseIgnored'));
  assert.ok(upNextSource.includes('Playback is still active.'));
  assert.ok(watchSource.indexOf('<UpNextSection') > watchSource.indexOf('<View style={styles.metadataBlock}>'));
  assert.equal((appSource.match(/<PersistentPlayer/g) ?? []).length, 1);
});

test('home startup request is deferred to avoid duplicate strict-mode fetches', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  assert.ok(appSource.includes('const timeout = setTimeout(() => {'));
  assert.ok(appSource.includes('loadHomeFeed(controller, false);'));
  assert.ok(appSource.includes('clearTimeout(timeout);'));
});

test('search refresh keeps previous results until replacement or explicit clear', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const runSearchStart = appSource.indexOf('async function runSearch(append: boolean)');
  const clearSearchStart = appSource.indexOf('function clearSearch()', runSearchStart);
  const runSearchSource = appSource.slice(runSearchStart, clearSearchStart);

  assert.ok(runSearchStart > 0);
  assert.ok(clearSearchStart > runSearchStart);
  assert.equal(runSearchSource.includes('setResults([])'), false);
  assert.ok(appSource.includes('loading && results.length === 0'));
});

test('search filters map to real backend parameters and reset stale pagination', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const apiSource = readFileSync(path.join(process.cwd(), 'src', 'searchApi.ts'), 'utf8');
  const serverSource = readFileSync(path.join(process.cwd(), 'server', 'youtube-proxy.mjs'), 'utf8');
  const searchStart = appSource.indexOf('function SearchScreen');
  const watchStart = appSource.indexOf('function WatchScreen', searchStart);
  const runSearchStart = appSource.indexOf('async function runSearch', searchStart);
  const clearSearchStart = appSource.indexOf('function clearSearch', runSearchStart);
  assert.ok(searchStart >= 0);
  assert.ok(watchStart > searchStart);
  assert.ok(runSearchStart > searchStart);
  assert.ok(clearSearchStart > runSearchStart);
  const searchSource = appSource.slice(searchStart, watchStart);
  const runSearchSource = appSource.slice(runSearchStart, clearSearchStart);

  for (const value of ['videos', 'channels', 'playlists', 'live', 'relevance', 'date', 'viewCount', 'any', 'short', 'medium', 'long']) {
    assert.ok(searchSource.includes(`'${value}'`), `${value} filter is visible`);
  }
  assert.ok(searchSource.includes("setDuration('any')"));
  assert.ok(searchSource.includes('[debouncedQuery, type, sort, duration]'));
  assert.ok(runSearchSource.includes('const searchKey = JSON.stringify'));
  assert.ok(runSearchSource.includes('setNextPageToken(undefined)'));
  assert.ok(runSearchSource.includes('activeController.current?.abort()'));
  assert.ok(searchSource.includes('loading && results.length === 0'));
  assert.ok(runSearchSource.includes('setError(apiError)'));
  assert.ok(apiSource.includes("url.searchParams.set('type', params.type)"));
  assert.ok(apiSource.includes("url.searchParams.set('sort', params.sort)"));
  assert.ok(apiSource.includes("url.searchParams.set('duration', params.duration)"));
  assert.ok(apiSource.includes("url.searchParams.set('pageToken', params.pageToken)"));
  assert.ok(serverSource.includes("new Set(['videos', 'channels', 'playlists', 'live'])"));
  assert.ok(serverSource.includes("new Set(['relevance', 'date', 'viewCount'])"));
  assert.ok(serverSource.includes("new Set(['any', 'short', 'medium', 'long'])"));
  assert.ok(serverSource.includes("searchParams.set('videoDuration', duration)"));
  assert.ok(serverSource.includes("searchParams.set('eventType', 'live')"));
});

test('foregrounding does not auto-play suspended YouTube WebView playback', () => {
  const appSource = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const handlerStart = appSource.indexOf('function handleAppStateChange');
  const handlerEnd = appSource.indexOf('function loadHomeFeed', handlerStart);
  const handlerSource = appSource.slice(handlerStart, handlerEnd);

  assert.ok(handlerSource.includes("state: suspendedByPlatform ? 'interrupted' : current.state"));
  assert.equal(handlerSource.includes("setPlayerCommand('play')"), false);
});

test('backend exposes separate liveness and readiness health routes', () => {
  const serverSource = readFileSync(path.join(process.cwd(), 'server', 'youtube-proxy.mjs'), 'utf8');

  assert.ok(serverSource.includes("requestUrl.pathname === '/health/live'"));
  assert.ok(serverSource.includes("requestUrl.pathname === '/health/ready'"));
  assert.ok(serverSource.includes('sendJson(response, 200, { ok: true });'));
  assert.ok(serverSource.includes('ready: false'));
  assert.ok(serverSource.includes('ready: true'));
});

test('production EAS profile loads production environment and validates API config during build', () => {
  const easConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'eas.json'), 'utf8'));
  const packageConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const validatorSource = readFileSync(path.join(process.cwd(), 'scripts', 'validate-production-config.mjs'), 'utf8');
  const patchScript = readFileSync(path.join(process.cwd(), 'scripts', 'patch-expo-video-ios-background.mjs'), 'utf8');

  assert.equal(easConfig.build.production.environment, 'production');
  assert.equal(packageConfig.scripts.postinstall, 'node scripts/patch-expo-video-ios-background.mjs');
  assert.equal(packageConfig.scripts['eas-build-post-install'], 'node scripts/patch-expo-video-ios-background.mjs && node scripts/validate-production-config.mjs');
  assert.ok(validatorSource.includes('EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL'));
  assert.ok(validatorSource.includes("parsed.protocol !== 'https:'"));
  assert.ok(validatorSource.includes('isDevelopmentOnlyHost(parsed.hostname)'));
  assert.ok(validatorSource.includes('isTemporaryTunnelHost(parsed.hostname)'));
  assert.ok(validatorSource.includes("backgroundModes.includes('audio')"));
  assert.ok(validatorSource.includes('NSAllowsArbitraryLoads'));
  assert.ok(validatorSource.includes('supportsBackgroundPlayback'));
  assert.ok(validatorSource.includes('supportsPictureInPicture'));
  assert.ok(validatorSource.includes('validateNativeExpoVideoPatch()'));
  assert.ok(validatorSource.includes('func applyBackgroundPlaybackPolicy()'));
  assert.ok(validatorSource.includes('audiovisualBackgroundPlaybackPolicy = staysActiveInBackground ? .continuesIfPossible : .pauses'));
  assert.ok(patchScript.includes('node_modules'));
  assert.ok(patchScript.includes('expo-video'));
  assert.ok(patchScript.includes('applyBackgroundPlaybackPolicy()'));
  assert.ok(patchScript.includes('audiovisualBackgroundPlaybackPolicy = staysActiveInBackground ? .continuesIfPossible : .pauses'));
  assert.ok(patchScript.includes('setAppropriateAudioSessionOrWarn()'));
});

test('backend production tooling protects secrets and exposes health checks', () => {
  const packageConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
  const dockerignore = readFileSync(path.join(process.cwd(), '.dockerignore'), 'utf8');
  const envValidator = readFileSync(path.join(process.cwd(), 'scripts', 'validate-backend-env.mjs'), 'utf8');
  const healthScript = readFileSync(path.join(process.cwd(), 'scripts', 'check-backend-health.mjs'), 'utf8');
  const runbook = readFileSync(path.join(process.cwd(), 'docs', 'backend-production.md'), 'utf8');

  assert.equal(packageConfig.scripts['api:validate'], 'node scripts/validate-backend-env.mjs');
  assert.equal(packageConfig.scripts['api:validate:release'], 'node scripts/validate-backend-env.mjs --require-direct-sources');
  assert.equal(packageConfig.scripts['api:health'], 'node scripts/check-backend-health.mjs');
  assert.equal(packageConfig.scripts['testflight:ready'], 'node scripts/validate-testflight-readiness.mjs');
  assert.equal(packageConfig.scripts['testflight:ready:lock-screen'], 'node scripts/validate-testflight-readiness.mjs --require-direct-sources');
  assert.ok(dockerfile.includes('node:22-alpine'));
  assert.ok(dockerfile.includes('/health/live'));
  assert.ok(dockerignore.includes('.env.local'));
  assert.ok(dockerignore.includes('node_modules'));
  assert.ok(envValidator.includes('YOUTUBE_DATA_API_KEY'));
  assert.ok(envValidator.includes('SYRIA_TUBE_DIRECT_SOURCES_JSON'));
  assert.ok(envValidator.includes('Direct playback sources must use HTTPS'));
  assert.ok(envValidator.includes('--require-direct-sources'));
  assert.ok(healthScript.includes('/health/live'));
  assert.ok(healthScript.includes('/health/ready'));
  assert.ok(healthScript.includes('--deep'));
  assert.ok(healthScript.includes('--require-direct-sources'));
  assert.ok(runbook.includes('Do not use account-less Cloudflare quick tunnels'));
  assert.ok(runbook.includes('npm run testflight:ready'));
  assert.ok(runbook.includes('npm run testflight:ready:lock-screen'));
  assert.equal(healthScript.includes('YOUTUBE_DATA_API_KEY'), false);
});

test('source tree contains no hard-coded YouTube demo fallback', () => {
  assert.equal(existsSync(path.join(process.cwd(), 'src', 'sampleData.ts')), false);
  const forbidden = [`M7lc${'1UVf'}-VE`, `IFrame Player API ${'demo'}`, `YouTube ${'Developers'}`];
  const files = walk(process.cwd()).filter((file) => /\.(ts|tsx|mjs|md|json)$/.test(file));
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const value of forbidden) {
      assert.equal(content.includes(value), false, `${path.relative(process.cwd(), file)} contains ${value}`);
    }
  }
});

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, Math.max(0, start + startMarker.length));
  assert.ok(start >= 0, `Missing source start marker: ${startMarker}`);
  assert.ok(end > start, `Missing source end marker: ${endMarker}`);
  return source.slice(start, end);
}

function walk(root: string): string[] {
  const ignored = new Set(['.git', '.expo', 'node_modules']);
  const output: string[] = [];
  for (const name of readdirSync(root)) {
    if (ignored.has(name)) {
      continue;
    }
    const file = path.join(root, name);
    const stats = statSync(file);
    if (stats.isDirectory()) {
      output.push(...walk(file));
    } else {
      output.push(file);
    }
  }
  return output;
}

function fixtureHomeContent(): HomeContent {
  return {
    spotlight: fixtureVideo(),
    sections: [{ key: 'trending', title: 'Trending', videos: [fixtureVideo()] }],
    errors: []
  };
}
