import {
  HomeContent,
  SearchDuration,
  SearchSort,
  SearchType,
  VideoPlaybackContentType,
  YouTubeApiError,
  YouTubeSearchPage,
  YouTubeVideo,
  dedupeSearchResults,
  filterPlayableVideos,
  isValidYouTubeVideoId,
  youtubeError
} from './core';

export type RemoteSearchParams = {
  query: string;
  type: SearchType;
  sort: SearchSort;
  duration: SearchDuration;
  pageToken?: string;
  signal?: AbortSignal;
};

export type HomeParams = {
  historyIds: string[];
  watchLaterIds: string[];
  favouriteIds: string[];
  signal?: AbortSignal;
};

export type ApiBaseUrlResolution =
  | { ok: true; url: string }
  | { ok: false; error: YouTubeApiError };

const retryDelaysMs = [400, 1000, 2000];
const requestTimeoutMs = 15_000;
const productionEnv = 'production';

export function isSearchApiConfigured(): boolean {
  return resolveSearchApiBaseUrl().ok;
}

export function getSearchApiConfigurationError(): YouTubeApiError | null {
  const resolution = resolveSearchApiBaseUrl();
  return resolution.ok ? null : resolution.error;
}

export async function fetchHomeContent(params: HomeParams): Promise<HomeContent> {
  const url = apiUrl('/youtube/home');
  url.searchParams.set('historyIds', params.historyIds.join(','));
  url.searchParams.set('watchLaterIds', params.watchLaterIds.join(','));
  url.searchParams.set('favouriteIds', params.favouriteIds.join(','));
  const content = await requestJsonWithRetries<unknown>(url, params.signal);
  assertHomeContentResponse(content);
  return normalizeHomeContent(content);
}

export async function searchYouTube(params: RemoteSearchParams): Promise<YouTubeSearchPage> {
  const query = params.query.trim();
  if (!query || query.length > 100) {
    throw youtubeError('invalidQuery', 'Enter a search query.', false);
  }

  const url = apiUrl('/youtube/search');
  url.searchParams.set('query', query);
  url.searchParams.set('type', params.type);
  url.searchParams.set('sort', params.sort);
  url.searchParams.set('duration', params.duration);
  if (params.pageToken) {
    url.searchParams.set('pageToken', params.pageToken);
  }

  const page = await requestJsonWithRetries<unknown>(url, params.signal);
  assertSearchPageResponse(page);
  return {
    pageInfo: page.pageInfo,
    results: dedupeSearchResults(page.results)
  };
}

export async function fetchVideosByIds(ids: string[], signal?: AbortSignal): Promise<YouTubeVideo[]> {
  if (!ids.length) {
    return [];
  }
  const url = apiUrl('/youtube/videos');
  url.searchParams.set('ids', ids.join(','));
  const page = await requestJsonWithRetries<unknown>(url, signal);
  assertVideosResponse(page);
  return normalizeVideos(page.videos);
}

export async function fetchSuggestedVideos(videoId: string, signal?: AbortSignal): Promise<YouTubeVideo[]> {
  if (!isValidYouTubeVideoId(videoId)) {
    throw youtubeError('invalidQuery', 'The selected video is invalid.', false);
  }
  const url = apiUrl('/youtube/suggestions');
  url.searchParams.set('videoId', videoId);
  const page = await requestJsonWithRetries<unknown>(url, signal);
  assertVideosResponse(page);
  return normalizeVideos(page.videos).filter((video) => video.id !== videoId);
}

export async function checkBackendReadiness(signal?: AbortSignal): Promise<void> {
  const health = await requestJsonWithRetries<{ ok?: boolean; ready?: boolean }>(apiUrl('/health/ready'), signal);
  if (health.ok === false || health.ready === false) {
    throw youtubeError('backendUnavailable', 'The Syria Tube backend is not ready to serve mobile requests.', true);
  }
}

async function requestJsonWithRetries<T>(url: URL, signal?: AbortSignal): Promise<T> {
  let lastError: YouTubeApiError | null = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await requestJson<T>(url, signal);
    } catch (error) {
      const apiError = error as YouTubeApiError;
      lastError = apiError;
      if (apiError.code === 'cancelled' || !apiError.retryable || attempt === retryDelaysMs.length) {
        logRetryDiagnostic(apiError, attempt + 1, false);
        throw apiError;
      }
      logRetryDiagnostic(apiError, attempt + 1, true);
      await waitForRetry(retryDelayWithJitter(retryDelaysMs[attempt]), signal);
    }
  }
  throw lastError ?? youtubeError('unknown', 'The YouTube request failed.', true);
}

async function requestJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const configurationError = getSearchApiConfigurationError();
  if (configurationError) {
    throw configurationError;
  }
  const request = createRequestSignal(signal);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: request.signal
    });
  } catch (error) {
    request.dispose();
    throw normalizeTransportError(error, request, url);
  }

  try {
    const body = await readJsonResponse(response, request, url);
    if (!response.ok) {
      throw normalizeApiError(isObjectRecord(body) ? body.error : undefined, response.status);
    }
    return body as T;
  } catch (error) {
    if (isYouTubeApiError(error)) {
      throw error;
    }
    throw normalizeTransportError(error, request, url);
  } finally {
    request.dispose();
  }
}

function apiUrl(path: string): URL {
  const resolution = resolveSearchApiBaseUrl();
  if (!resolution.ok) {
    return new URL(path, 'https://not-configured.local');
  }
  return joinSearchApiUrl(resolution.url, path);
}

function normalizeApiError(error: Partial<YouTubeApiError> | undefined, status: number): YouTubeApiError {
  if (error?.code && error.message && status !== 404) {
    return {
      code: error.code,
      message: error.message,
      retryable: Boolean(error.retryable)
    } as YouTubeApiError;
  }
  if (status === 400) {
    return youtubeError('badRequest', 'The Syria Tube backend rejected this request.', false);
  }
  if (status === 401) {
    return youtubeError('unauthorized', 'The Syria Tube backend rejected this app build configuration.', false);
  }
  if (status === 403) {
    return youtubeError('forbidden', 'The Syria Tube backend or YouTube refused this request.', false);
  }
  if (status === 404) {
    return youtubeError('notFound', 'The Syria Tube app is calling a backend route that does not exist.', false);
  }
  if (status === 429) {
    return youtubeError('rateLimitExceeded', 'Too many requests. Try again soon.', true);
  }
  if (status >= 500) {
    return youtubeError('serverError', 'The Syria Tube backend is temporarily unavailable.', true);
  }
  return youtubeError('unknown', 'The Syria Tube backend returned an unexpected response.', true);
}

async function readJsonResponse(response: Response, request: RequestSignal, url: URL): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw normalizeTransportError(error, request, url);
  }

  if (!text.trim()) {
    if (response.ok) {
      throw youtubeError('malformedResponse', 'The Syria Tube backend returned an empty response.', false);
    }
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      return {};
    }
    throw youtubeError('invalidJson', 'The Syria Tube backend returned invalid JSON.', false);
  }
}

function isObjectRecord(value: unknown): value is Record<string, Partial<YouTubeApiError> | undefined> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isYouTubeApiError(error: unknown): error is YouTubeApiError {
  return Boolean(error && typeof error === 'object' && 'code' in error && 'message' in error && 'retryable' in error);
}

type RequestSignal = {
  signal: AbortSignal;
  dispose: () => void;
  timedOut: () => boolean;
  externallyAborted: () => boolean;
};

function createRequestSignal(externalSignal?: AbortSignal): RequestSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, requestTimeoutMs);
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
    timedOut: () => didTimeout,
    externallyAborted: () => Boolean(externalSignal?.aborted)
  };
}

function normalizeTransportError(error: unknown, request: RequestSignal, url: URL): YouTubeApiError {
  if (isYouTubeApiError(error)) {
    return error;
  }
  if (request.timedOut()) {
    return youtubeError('timeout', 'The Syria Tube backend timed out before returning YouTube data.', true);
  }
  if (request.externallyAborted() || (error as Error).name === 'AbortError') {
    return youtubeError('cancelled', 'The request was cancelled.', false);
  }
  return youtubeError('backendUnavailable', backendUnavailableMessage(url), true);
}

function backendUnavailableMessage(url: URL): string {
  const host = url.hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return 'The Syria Tube backend could not be reached at localhost. On a physical iPhone, use a reachable LAN or HTTPS backend URL instead of localhost.';
  }
  return 'The Syria Tube backend could not be reached. Check the backend URL or network connection.';
}

function normalizeHomeContent(content: HomeContent): HomeContent {
  const sections = Array.isArray(content?.sections)
    ? content.sections
        .map((section) => ({
          ...section,
          videos: normalizeVideos(section.videos)
        }))
        .filter((section) => section.videos.length > 0)
    : [];
  const spotlight = isVideoLike(content?.spotlight) ? content.spotlight : sections[0]?.videos[0] ?? null;
  return {
    spotlight,
    sections,
    errors: Array.isArray(content?.errors) ? content.errors : []
  };
}

function normalizeVideos(videos: unknown): YouTubeVideo[] {
  return Array.isArray(videos) ? filterPlayableVideos(videos.filter(isVideoLike).map(normalizeVideo)) : [];
}

function isVideoLike(value: unknown): value is YouTubeVideo {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const video = value as Partial<YouTubeVideo>;
  return (
    video.kind === 'video' &&
    typeof video.id === 'string' &&
    isValidYouTubeVideoId(video.id) &&
    typeof video.title === 'string' &&
    typeof video.channelName === 'string' &&
    typeof video.thumbnailUrl === 'string' &&
    typeof video.canonicalUrl === 'string'
  );
}

function normalizeVideo(video: YouTubeVideo): YouTubeVideo {
  const normalized = { ...video };
  if (!isDirectPlaybackUrl(normalized.playbackUrl)) {
    delete normalized.playbackUrl;
    delete normalized.playbackContentType;
    return normalized;
  }
  if (!isPlaybackContentType(normalized.playbackContentType)) {
    normalized.playbackContentType = 'auto';
  }
  return normalized;
}

function isDirectPlaybackUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlaybackContentType(value: unknown): value is VideoPlaybackContentType {
  return value === 'auto' || value === 'progressive' || value === 'hls' || value === 'dash' || value === 'smoothStreaming';
}

function logRetryDiagnostic(error: YouTubeApiError, attempt: number, willRetry: boolean) {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return;
  }
  console.warn('Syria Tube YouTube request issue', {
    attempt,
    code: error.code,
    retryable: error.retryable,
    willRetry
  });
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(youtubeError('cancelled', 'The request was cancelled.', false));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(youtubeError('cancelled', 'The request was cancelled.', false));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function retryDelayWithJitter(baseDelayMs: number, random = Math.random): number {
  const jitterRange = Math.max(1, Math.floor(baseDelayMs * 0.2));
  return baseDelayMs + Math.floor(random() * jitterRange);
}

export function joinSearchApiUrl(baseUrl: string, route: string): URL {
  const base = new URL(baseUrl);
  const routeUrl = new URL(route, 'https://syria-tube-route.local');
  const basePath = base.pathname.replace(/\/+$/, '');
  const routePath = routeUrl.pathname.replace(/^\/+/, '');
  base.pathname = [basePath, routePath].filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  base.search = routeUrl.search;
  base.hash = '';
  return base;
}

export function resolveSearchApiBaseUrl(
  rawValue = readSearchApiBaseUrlFromEnv(),
  nodeEnv = readNodeEnv()
): ApiBaseUrlResolution {
  const value = rawValue?.trim();
  if (!value) {
    return {
      ok: false,
      error: youtubeError('notConfigured', 'Syria Tube backend is not configured for this build.', false)
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      error: youtubeError('notConfigured', 'Syria Tube backend URL is invalid for this build.', false)
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error: youtubeError('notConfigured', 'Syria Tube backend URL must use HTTP or HTTPS.', false)
    };
  }

  if (nodeEnv === productionEnv) {
    if (parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: youtubeError('notConfigured', 'Production Syria Tube builds require an HTTPS backend URL.', false)
      };
    }
    if (isDevelopmentOnlyHost(parsed.hostname)) {
      return {
        ok: false,
        error: youtubeError('notConfigured', 'Production Syria Tube builds cannot use localhost, loopback, or private LAN backend URLs.', false)
      };
    }
    if (isTemporaryTunnelHost(parsed.hostname)) {
      return {
        ok: false,
        error: youtubeError('notConfigured', 'Production Syria Tube builds cannot use temporary Cloudflare tunnel backend URLs.', false)
      };
    }
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return { ok: true, url: parsed.toString().replace(/\/+$/, '') };
}

function readSearchApiBaseUrlFromEnv(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;
}

function readNodeEnv(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env.NODE_ENV;
}

function isDevelopmentOnlyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized)
  );
}

function isTemporaryTunnelHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'trycloudflare.com' || normalized.endsWith('.trycloudflare.com');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function assertHomeContentResponse(value: unknown): asserts value is HomeContent {
  if (!isObjectRecord(value) || !Array.isArray(value.sections) || (value.errors !== undefined && !Array.isArray(value.errors))) {
    throw youtubeError('responseSchemaMismatch', 'The Syria Tube backend returned an unexpected feed shape.', false);
  }
}

function assertSearchPageResponse(value: unknown): asserts value is YouTubeSearchPage {
  if (!isObjectRecord(value) || !Array.isArray(value.results) || !isObjectRecord(value.pageInfo)) {
    throw youtubeError('responseSchemaMismatch', 'The Syria Tube backend returned an unexpected search shape.', false);
  }
}

function assertVideosResponse(value: unknown): asserts value is { videos: YouTubeVideo[] } {
  if (!isObjectRecord(value) || !Array.isArray(value.videos)) {
    throw youtubeError('responseSchemaMismatch', 'The Syria Tube backend returned an unexpected video list shape.', false);
  }
}
