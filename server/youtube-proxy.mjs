import http from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const key = loadEnvValue('YOUTUBE_DATA_API_KEY');
const regionCode = 'GB';
const requestLimit = 80;
const requestWindowMs = 60_000;
const rateBuckets = new Map();

const allowedSearchTypes = new Set(['videos', 'channels', 'playlists', 'live']);
const allowedOrders = new Set(['relevance', 'date', 'viewCount']);
const allowedDurations = new Set(['any', 'short', 'medium', 'long']);
const allowedPlaybackContentTypes = new Set(['auto', 'progressive', 'hls', 'dash', 'smoothStreaming']);
const directPlaybackSources = loadDirectPlaybackSources();
const freeDirectCatalogCache = new Map();
const freeDirectCatalogCacheMs = 10 * 60_000;
const categorySections = [
  { key: 'music', title: 'Music', videoCategoryId: '10' },
  { key: 'news', title: 'News', videoCategoryId: '25' },
  { key: 'gaming', title: 'Gaming', videoCategoryId: '20' },
  { key: 'sports', title: 'Sports', videoCategoryId: '17' }
];

const querySections = [{ key: 'recommended', title: 'Recommended', query: 'popular videos today' }];

export async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null);
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/') {
    sendJson(response, 200, {
      ok: true,
      service: 'Syria Tube YouTube proxy',
      routes: ['/health', '/health/live', '/health/ready', '/youtube/home', '/youtube/search', '/youtube/videos', '/youtube/suggestions', '/youtube/categories']
    });
    return;
  }

  if (request.method === 'GET' && (requestUrl.pathname === '/health' || requestUrl.pathname === '/health/live')) {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/health/ready') {
    if (!key) {
      sendJson(response, 503, {
        ok: false,
        ready: false,
        directPlaybackSources: directPlaybackSources.size,
        error: { code: 'notConfigured', message: 'YouTube API key is not configured on the server.', retryable: false }
      });
      return;
    }
    sendJson(response, 200, { ok: true, ready: true, directPlaybackSources: directPlaybackSources.size });
    return;
  }

  if (!consumeRateLimit(request)) {
    sendJson(response, 429, { error: { code: 'rateLimitExceeded', message: 'Too many requests. Try again soon.', retryable: true } });
    return;
  }

  if (!key) {
    sendJson(response, 500, { error: { code: 'notConfigured', message: 'YouTube API key is not configured on the server.', retryable: false } });
    return;
  }

  try {
    if (request.method === 'GET' && requestUrl.pathname === '/youtube/search') {
      await handleSearch(requestUrl, response);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/youtube/home') {
      await handleHome(requestUrl, response);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/youtube/videos') {
      await handleVideos(requestUrl, response);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/youtube/suggestions') {
      await handleSuggestions(requestUrl, response);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/youtube/categories') {
      await handleCategories(response);
      return;
    }
    sendJson(response, 404, { error: { code: 'serverError', message: 'Route not found.', retryable: false } });
  } catch (error) {
    const safeError = normaliseError(error);
    sendJson(response, safeError.status, { error: safeError.body });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Syria Tube YouTube proxy listening on http://localhost:${port}`);
  });
}

async function handleSearch(requestUrl, response) {
  const query = (requestUrl.searchParams.get('query') ?? '').trim();
  const type = normalizeOption(requestUrl.searchParams.get('type'), allowedSearchTypes, 'videos');
  const sort = normalizeOption(requestUrl.searchParams.get('sort'), allowedOrders, 'relevance');
  const duration = normalizeOption(requestUrl.searchParams.get('duration'), allowedDurations, 'any');
  const pageToken = validatePageToken(requestUrl.searchParams.get('pageToken'));

  if (!query || query.length > 100) {
    sendJson(response, 400, { error: { code: 'invalidQuery', message: 'Enter a search query.', retryable: false } });
    return;
  }

  const searchType = type === 'live' ? 'video' : type === 'videos' ? 'video' : type.slice(0, -1);
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: searchType,
    maxResults: '20',
    q: query,
    order: sort,
    regionCode,
    safeSearch: 'moderate',
    key
  });

  if (pageToken) {
    searchParams.set('pageToken', pageToken);
  }
  if (searchType === 'video') {
    searchParams.set('videoEmbeddable', 'true');
  }
  if (duration !== 'any' && type !== 'live' && searchType === 'video') {
    searchParams.set('videoDuration', duration);
  }
  if (type === 'live') {
    searchParams.set('eventType', 'live');
  }

  const freeDirectPromise = searchType === 'video' && !pageToken ? fetchFreeDirectVideos(query, 8) : Promise.resolve([]);
  const search = await fetchYouTube(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  if (searchType !== 'video') {
    sendJson(response, 200, {
      pageInfo: pageInfo(search),
      results: mapNonVideoSearchResults(search.items ?? [])
    });
    return;
  }

  const ids = uniqueIds((search.items ?? []).map((item) => item.id?.videoId).filter(isValidVideoId));
  const videos = ids.length ? orderVideosByIds(await fetchVideosByIds(ids), ids) : [];
  const freeDirectVideos = await settleOrEmpty(freeDirectPromise);
  sendJson(response, 200, {
    pageInfo: pageInfo(search),
    results: uniqueById([...freeDirectVideos, ...videos])
  });
}

async function handleHome(requestUrl, response) {
  const historyIds = parseIdList(requestUrl.searchParams.get('historyIds'));
  const watchLaterIds = parseIdList(requestUrl.searchParams.get('watchLaterIds'));
  const favouriteIds = parseIdList(requestUrl.searchParams.get('favouriteIds'));

  const sections = [];
  const errors = [];
  const tasks = [
    { key: 'nativeDirect', title: 'Lock Screen Ready', run: fetchNativeDirectVideos },
    { key: 'continueWatching', title: 'Continue Watching', run: () => (historyIds.length ? fetchVideosByIds(historyIds) : Promise.resolve([])) },
    { key: 'trending', title: 'Trending in Great Britain', run: () => fetchPopularVideos() },
    ...categorySections.map((section) => ({ key: section.key, title: section.title, run: () => fetchPopularVideos(section.videoCategoryId) })),
    ...querySections.map((section) => ({ key: section.key, title: section.title, run: () => fetchSearchVideos(section.query) })),
    { key: 'recentlyWatched', title: 'Recently Watched', run: () => (historyIds.length ? fetchVideosByIds(historyIds.slice(0, 12)) : Promise.resolve([])) },
    { key: 'watchLater', title: 'Watch Later', run: () => (watchLaterIds.length ? fetchVideosByIds(watchLaterIds) : Promise.resolve([])) },
    { key: 'favourites', title: 'Favourites', run: () => (favouriteIds.length ? fetchVideosByIds(favouriteIds) : Promise.resolve([])) }
  ];

  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  results.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'fulfilled') {
      addSection(sections, task.key, task.title, result.value);
      return;
    }
    errors.push({ key: task.key, title: task.title, error: normaliseError(result.reason).body });
  });

  sendJson(response, 200, {
    spotlight: firstVideo(sections),
    sections,
    errors
  });
}

async function fetchNativeDirectVideos() {
  const configuredPromise = directPlaybackSources.size ? fetchVideosByIds(directPlaybackVideoIds()) : Promise.resolve([]);
  const freeDirectPromise = fetchFreeDirectVideos('free animation', 12, { archiveQuery: 'collection:animationandcartoons', sortByDownloads: true });
  const [configured, freeDirect] = await Promise.all([settleOrEmpty(configuredPromise), settleOrEmpty(freeDirectPromise)]);
  return uniqueById([...configured, ...freeDirect]).slice(0, 12);
}

async function handleVideos(requestUrl, response) {
  const ids = parseIdList(requestUrl.searchParams.get('ids'));
  if (!ids.length) {
    sendJson(response, 400, { error: { code: 'invalidQuery', message: 'Provide at least one valid video id.', retryable: false } });
    return;
  }
  const videos = await fetchVideosByIds(ids);
  sendJson(response, 200, { videos });
}

async function handleSuggestions(requestUrl, response) {
  const videoId = requestUrl.searchParams.get('videoId') ?? '';
  if (!isValidVideoId(videoId)) {
    sendJson(response, 400, { error: { code: 'invalidQuery', message: 'Provide a valid video id.', retryable: false } });
    return;
  }
  const current = await fetchVideosByIds([videoId]);
  if (!current.length) {
    sendJson(response, 200, { videos: [] });
    return;
  }
  const video = current[0];
  const query = suggestionQuery(video);
  const [queryResult, categoryResult] = await Promise.allSettled([
    fetchSearchVideos(query, 15),
    video.categoryId ? fetchPopularVideos(video.categoryId) : Promise.resolve([])
  ]);
  const videos = [
    ...(queryResult.status === 'fulfilled' ? queryResult.value : []),
    ...(categoryResult.status === 'fulfilled' ? categoryResult.value : [])
  ].filter((item) => item.id !== videoId);
  sendJson(response, 200, { videos: uniqueById(videos).slice(0, 12) });
}

async function handleCategories(response) {
  const params = new URLSearchParams({
    part: 'snippet',
    regionCode,
    key
  });
  const categories = await fetchYouTube(`https://www.googleapis.com/youtube/v3/videoCategories?${params}`);
  sendJson(response, 200, {
    categories: (categories.items ?? []).map((item) => ({
      id: item.id,
      title: decodeText(item.snippet?.title ?? '')
    }))
  });
}

async function fetchPopularVideos(videoCategoryId) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics,status,liveStreamingDetails',
    chart: 'mostPopular',
    regionCode,
    maxResults: '20',
    key
  });
  if (videoCategoryId) {
    params.set('videoCategoryId', videoCategoryId);
  }
  const details = await fetchYouTube(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  return mapVideos(details.items ?? []);
}

async function fetchSearchVideos(query, maxResults = 20) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(maxResults),
    q: query,
    order: 'relevance',
    regionCode,
    safeSearch: 'moderate',
    videoEmbeddable: 'true',
    key
  });
  const search = await fetchYouTube(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const ids = uniqueIds((search.items ?? []).map((item) => item.id?.videoId).filter(isValidVideoId));
  return ids.length ? orderVideosByIds(await fetchVideosByIds(ids), ids) : [];
}

async function fetchFreeDirectVideos(query, maxResults = 12, options = {}) {
  const normalizedQuery = options.archiveQuery ?? normalizeArchiveSearchQuery(query);
  const cacheKey = `${normalizedQuery}:${maxResults}:${options.sortByDownloads ? 'popular' : 'relevant'}`;
  const cached = freeDirectCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < freeDirectCatalogCacheMs) {
    return cached.videos;
  }

  const params = new URLSearchParams({
    q: `${normalizedQuery} AND mediatype:movies AND (format:"h.264 IA" OR format:"MPEG4")`,
    rows: String(Math.min(Math.max(maxResults * 4, 12), 40)),
    page: '1',
    output: 'json'
  });
  for (const field of ['identifier', 'title', 'creator', 'date', 'description', 'downloads']) {
    params.append('fl[]', field);
  }
  if (options.sortByDownloads) {
    params.append('sort[]', 'downloads desc');
  }

  const search = await fetchInternetArchiveJson(`https://archive.org/advancedsearch.php?${params}`);
  const docs = Array.isArray(search?.response?.docs) ? search.response.docs.slice(0, Math.min(maxResults * 3, 24)) : [];
  const mapped = await Promise.allSettled(docs.map((doc) => mapInternetArchiveVideo(doc)));
  const candidates = mapped
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter(Boolean);
  const videos = uniqueById(candidates).slice(0, maxResults);
  freeDirectCatalogCache.set(cacheKey, { createdAt: Date.now(), videos });
  return videos;
}

async function mapInternetArchiveVideo(doc) {
  const identifier = typeof doc?.identifier === 'string' ? doc.identifier : '';
  if (!isValidArchiveIdentifier(identifier)) {
    return null;
  }
  const metadata = await fetchInternetArchiveJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  const videoFile = selectInternetArchiveVideoFile(files);
  if (!videoFile) {
    return null;
  }

  const thumbnailFile = selectInternetArchiveThumbnailFile(files);
  const title = asSingleLineText(metadata?.metadata?.title ?? doc.title) || identifier;
  const creator = asSingleLineText(metadata?.metadata?.creator ?? doc.creator) || 'Internet Archive';
  const description = asSingleLineText(metadata?.metadata?.description ?? doc.description);
  const publishedAt = parseArchiveDate(metadata?.metadata?.date ?? metadata?.metadata?.publicdate ?? doc.date);

  return {
    kind: 'video',
    id: syntheticVideoId('ia', identifier),
    title: decodeText(title),
    channelId: 'internet-archive',
    channelName: decodeText(creator),
    thumbnailUrl: thumbnailFile ? archiveFileUrl(identifier, thumbnailFile.name) : '',
    durationSeconds: parseArchiveDuration(videoFile.length),
    viewCount: parseOptionalNumber(doc.downloads ?? metadata?.metadata?.downloads),
    publishedAt,
    description: decodeText(description),
    canonicalUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    categoryId: 'freeDirect',
    liveStatus: 'none',
    embeddable: false,
    availability: 'public',
    playbackUrl: archiveFileUrl(identifier, videoFile.name),
    playbackContentType: 'progressive'
  };
}

function suggestionQuery(video) {
  const words = `${video.title} ${video.channelName}`
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8);
  return words.length ? words.join(' ') : video.channelName || 'popular videos';
}

async function settleOrEmpty(promise) {
  try {
    return await promise;
  } catch {
    return [];
  }
}

async function fetchInternetArchiveJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw safeHttpError(response.status, 'freeCatalogUnavailable', 'The free direct video catalog is temporarily unavailable.', true);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw safeHttpError(504, 'timeout', 'The free direct video catalog timed out.', true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeArchiveSearchQuery(value) {
  const words = String(value ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1)
    .slice(0, 8);
  return words.length ? words.join(' ') : 'public domain documentary';
}

function isValidArchiveIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(value);
}

function selectInternetArchiveVideoFile(files) {
  const candidates = files
    .filter((file) => typeof file?.name === 'string')
    .filter((file) => /\.(mp4|m4v|mov)$/i.test(file.name))
    .filter((file) => !/(sample|thumbs?\/|_meta\.|_files\.|_archive\.)/i.test(file.name));
  return candidates.sort((left, right) => scoreArchiveVideoFile(right) - scoreArchiveVideoFile(left))[0] ?? null;
}

function scoreArchiveVideoFile(file) {
  const name = file.name.toLowerCase();
  const format = String(file.format ?? '').toLowerCase();
  let score = 0;
  if (format.includes('h.264')) score += 20;
  if (format.includes('mpeg4')) score += 12;
  if (name.endsWith('.ia.mp4')) score += 10;
  if (name.endsWith('.mp4')) score += 5;
  if (name.includes('512kb')) score -= 6;
  const size = Number.parseInt(file.size ?? '0', 10);
  if (Number.isFinite(size) && size > 0 && size < 700_000_000) score += 3;
  return score;
}

function selectInternetArchiveThumbnailFile(files) {
  return (
    files.find((file) => file?.name === '__ia_thumb.jpg') ??
    files.find((file) => typeof file?.name === 'string' && file.name.includes('.thumbs/') && /\.(jpg|jpeg|png|webp)$/i.test(file.name)) ??
    null
  );
}

function archiveFileUrl(identifier, fileName) {
  const encodedIdentifier = encodeURIComponent(identifier);
  const encodedFileName = fileName.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://archive.org/download/${encodedIdentifier}/${encodedFileName}`;
}

function asSingleLineText(value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : value;
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function parseArchiveDate(value) {
  const text = asSingleLineText(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function parseArchiveDuration(value) {
  const seconds = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
}

function syntheticVideoId(prefix, value) {
  const hash = createHash('sha1').update(`${prefix}:${value}`).digest('base64url');
  return `${prefix}${hash}`.slice(0, 11);
}

async function fetchVideosByIds(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) {
    chunks.push(ids.slice(i, i + 50));
  }
  const pages = await Promise.all(
    chunks.map((chunk) => {
      const params = new URLSearchParams({
        part: 'snippet,contentDetails,statistics,status,liveStreamingDetails',
        id: chunk.join(','),
        key
      });
      return fetchYouTube(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    })
  );
  return mapVideos(pages.flatMap((page) => page.items ?? []));
}

async function fetchYouTube(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      let reason;
      try {
        const body = await response.json();
        reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
      } catch {}
      throw youtubeHttpError(response.status, reason);
    }
    const body = await response.json();
    if (!body || !Array.isArray(body.items)) {
      throw safeHttpError(502, 'malformedResponse', 'YouTube returned an unreadable response.', true);
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw safeHttpError(504, 'timeout', 'The YouTube request timed out.', true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapVideos(items) {
  return uniqueById(items.map(mapVideo).filter((video) => isPlayableVideo(video)));
}

function mapVideo(item) {
  const embeddable = item.status?.embeddable === true;
  const directPlayback = directPlaybackForVideo(item.id);
  return {
    kind: 'video',
    id: item.id,
    title: decodeText(item.snippet?.title ?? ''),
    channelId: item.snippet?.channelId ?? '',
    channelName: decodeText(item.snippet?.channelTitle ?? ''),
    thumbnailUrl: bestThumbnail(item.snippet?.thumbnails ?? {}),
    durationSeconds: parseDuration(item.contentDetails?.duration ?? '') ?? 0,
    viewCount: parseOptionalNumber(item.statistics?.viewCount),
    publishedAt: item.snippet?.publishedAt ?? '',
    description: decodeText(item.snippet?.description ?? ''),
    canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
    categoryId: item.snippet?.categoryId,
    liveStatus: mapLiveStatus(item),
    embeddable,
    availability: mapAvailability(item, embeddable, Boolean(directPlayback.playbackUrl)),
    ...directPlayback
  };
}

function mapNonVideoSearchResults(items) {
  return uniqueByKindId(
    (items ?? [])
      .map((item) => {
        if (item.id?.kind === 'youtube#channel' && isValidResourceId(item.id.channelId)) {
          return {
            kind: 'channel',
            id: item.id.channelId,
            title: decodeText(item.snippet?.title ?? ''),
            description: decodeText(item.snippet?.description ?? ''),
            thumbnailUrl: bestThumbnail(item.snippet?.thumbnails ?? {}),
            canonicalUrl: `https://www.youtube.com/channel/${item.id.channelId}`
          };
        }
        if (item.id?.kind === 'youtube#playlist' && isValidResourceId(item.id.playlistId)) {
          return {
            kind: 'playlist',
            id: item.id.playlistId,
            title: decodeText(item.snippet?.title ?? ''),
            channelId: item.snippet?.channelId ?? '',
            channelName: decodeText(item.snippet?.channelTitle ?? ''),
            description: decodeText(item.snippet?.description ?? ''),
            thumbnailUrl: bestThumbnail(item.snippet?.thumbnails ?? {}),
            canonicalUrl: `https://www.youtube.com/playlist?list=${item.id.playlistId}`
          };
        }
        return null;
      })
      .filter(Boolean)
  );
}

function mapAvailability(item, embeddable, hasDirectPlayback = false) {
  if (item.status?.privacyStatus === 'private') return 'private';
  if (item.status?.uploadStatus === 'deleted') return 'deleted';
  if (item.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') return 'ageRestricted';
  if (item.status?.privacyStatus !== 'public') return 'unavailable';
  if (!embeddable && !hasDirectPlayback) return 'embeddingDisabled';
  return 'public';
}

function isPlayableVideo(video) {
  return isValidVideoId(video.id) && video.availability === 'public' && (video.embeddable || Boolean(video.playbackUrl));
}

function mapLiveStatus(item) {
  if (item.liveStreamingDetails?.actualStartTime && !item.liveStreamingDetails.actualEndTime) return 'live';
  if (item.liveStreamingDetails?.scheduledStartTime && !item.liveStreamingDetails.actualStartTime) return 'upcoming';
  if (item.liveStreamingDetails?.actualEndTime) return 'completed';
  if (item.snippet?.liveBroadcastContent === 'live') return 'live';
  if (item.snippet?.liveBroadcastContent === 'upcoming') return 'upcoming';
  return 'none';
}

function pageInfo(response) {
  return {
    nextPageToken: response.nextPageToken,
    prevPageToken: response.prevPageToken,
    totalResults: response.pageInfo?.totalResults,
    resultsPerPage: response.pageInfo?.resultsPerPage
  };
}

function addSection(sections, key, title, videos) {
  if (videos.length) {
    sections.push({ key, title, videos });
  }
}

function firstVideo(sections) {
  for (const section of sections) {
    if (section.videos.length) {
      return section.videos[0];
    }
  }
  return null;
}

function parseIdList(value) {
  if (!value) return [];
  return uniqueIds(value.split(',').map((item) => item.trim()).filter(isValidVideoId)).slice(0, 50);
}

function validatePageToken(value) {
  if (!value) return null;
  if (/^[A-Za-z0-9_=-]{1,500}$/.test(value)) return value;
  throw safeHttpError(400, 'invalidPageToken', 'This page token is invalid.', false);
}

function normaliseError(error) {
  if (error?.safeStatus && error?.safeBody) {
    return { status: error.safeStatus, body: error.safeBody };
  }
  return { status: 502, body: { code: 'backendUnavailable', message: 'The Syria Tube backend could not complete this request.', retryable: true } };
}

function youtubeHttpError(status, reason) {
  if (reason === 'quotaExceeded') return safeHttpError(403, 'quotaExceeded', 'YouTube quota is exhausted. Try again later.', false);
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return safeHttpError(429, 'rateLimitExceeded', 'YouTube is rate limiting requests. Try again soon.', true);
  if (reason === 'invalidPageToken') return safeHttpError(400, 'invalidPageToken', 'This page token is no longer valid. Start the search again.', false);
  if (status === 403) return safeHttpError(403, 'forbidden', 'YouTube refused this request for the configured API key.', false);
  if (status >= 500) return safeHttpError(status, 'serverError', 'YouTube is temporarily unavailable.', true);
  return safeHttpError(status, 'unknown', 'The YouTube request failed.', true);
}

function safeHttpError(status, code, message, retryable) {
  const error = new Error(message);
  error.safeStatus = status;
  error.safeBody = { code, message, retryable };
  return error;
}

function consumeRateLimit(request) {
  const key = request.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? { count: 0, resetAt: now + requestWindowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + requestWindowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= requestLimit;
}

function loadEnvValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync('.env.local', 'utf8');
    const line = file.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function loadDirectPlaybackSources() {
  const raw = loadEnvValue('SYRIA_TUBE_DIRECT_SOURCES_JSON') ?? readDirectSourceFile();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed.map((item) => [item?.videoId, item])
      : Object.entries(parsed);
    const sources = new Map();
    for (const [videoId, value] of entries) {
      if (!isValidVideoId(videoId)) continue;
      const source = normalizeDirectPlaybackSource(value);
      if (source) {
        sources.set(videoId, source);
      }
    }
    return sources;
  } catch {
    return new Map();
  }
}

function readDirectSourceFile() {
  const file = loadEnvValue('SYRIA_TUBE_DIRECT_SOURCES_FILE');
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function normalizeDirectPlaybackSource(value) {
  const playbackUrl = typeof value === 'string' ? value : value?.playbackUrl ?? value?.url;
  if (!isHttpsUrl(playbackUrl)) {
    return null;
  }
  const playbackContentType = typeof value === 'object' && allowedPlaybackContentTypes.has(value?.playbackContentType)
    ? value.playbackContentType
    : typeof value === 'object' && allowedPlaybackContentTypes.has(value?.contentType)
      ? value.contentType
      : inferPlaybackContentType(playbackUrl);
  return { playbackUrl, playbackContentType };
}

function directPlaybackForVideo(videoId) {
  const source = directPlaybackSources.get(videoId);
  return source ? { playbackUrl: source.playbackUrl, playbackContentType: source.playbackContentType } : {};
}

function directPlaybackVideoIds() {
  return [...directPlaybackSources.keys()].slice(0, 12);
}

function inferPlaybackContentType(value) {
  const lower = value.toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (lower.includes('.ism') || lower.includes('manifest')) return 'smoothStreaming';
  return 'auto';
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeOption(value, allowed, fallback) {
  return value && allowed.has(value) ? value : fallback;
}

function isValidVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function isValidResourceId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function uniqueById(videos) {
  const seen = new Set();
  return videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

function uniqueByKindId(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderVideosByIds(videos, ids) {
  const byId = new Map(videos.map((video) => [video.id, video]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function parseDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '0', 10) * 3600 + Number.parseInt(match[2] ?? '0', 10) * 60 + Number.parseInt(match[3] ?? '0', 10);
}

function parseOptionalNumber(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeText(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function bestThumbnail(thumbnails) {
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? '';
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  });
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}
