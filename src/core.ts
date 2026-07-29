export type SearchType = 'videos' | 'channels' | 'playlists' | 'live';
export type SearchSort = 'relevance' | 'date' | 'viewCount';
export type SearchDuration = 'any' | 'short' | 'medium' | 'long';
export type AppearancePreference = 'system' | 'light' | 'dark';
export type ContentPreferenceKey = 'news' | 'music' | 'sports' | 'technology' | 'documentaries' | 'learning';
export type PlayerCommand =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seekBackward10'
  | 'seekForward10'
  | 'replay'
  | { type: 'seekTo'; seconds: number }
  | { type: 'setPlaybackRate'; rate: number }
  | { type: 'setVolume'; volume: number };
export type PlayerState = 'idle' | 'ready' | 'buffering' | 'playing' | 'paused' | 'ended' | 'interrupted' | 'error';
export type PlaybackIntent = 'play' | 'pause';
export type YouTubeVideoAvailability = 'public' | 'private' | 'deleted' | 'unavailable' | 'embeddingDisabled' | 'ageRestricted';
export type YouTubeLiveStatus = 'none' | 'live' | 'upcoming' | 'completed';
export type VideoPlaybackContentType = 'auto' | 'progressive' | 'hls' | 'dash' | 'smoothStreaming';

export type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export type YouTubeVideo = {
  kind: 'video';
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelThumbnailUrl?: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number | null;
  publishedAt: string;
  description: string;
  canonicalUrl: string;
  categoryId?: string;
  liveStatus: YouTubeLiveStatus;
  embeddable: boolean;
  availability: YouTubeVideoAvailability;
  playbackUrl?: string;
  playbackContentType?: VideoPlaybackContentType;
};

export type VideoSummary = YouTubeVideo;

export type YouTubeChannel = {
  kind: 'channel';
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  canonicalUrl: string;
};

export type YouTubePlaylist = {
  kind: 'playlist';
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  description: string;
  thumbnailUrl: string;
  canonicalUrl: string;
};

export type YouTubeSearchResult = YouTubeVideo | YouTubeChannel | YouTubePlaylist;

export type YouTubePageInfo = {
  nextPageToken?: string;
  prevPageToken?: string;
  totalResults?: number;
  resultsPerPage?: number;
};

export type YouTubeApiErrorCode =
  | 'notConfigured'
  | 'badRequest'
  | 'invalidQuery'
  | 'invalidPageToken'
  | 'quotaExceeded'
  | 'rateLimitExceeded'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'backendUnavailable'
  | 'offline'
  | 'timeout'
  | 'cancelled'
  | 'invalidJson'
  | 'malformedResponse'
  | 'responseSchemaMismatch'
  | 'serverError'
  | 'unknown';

export type YouTubeApiError = {
  code: YouTubeApiErrorCode;
  message: string;
  retryable: boolean;
};

export type YouTubeSearchPage = {
  results: YouTubeSearchResult[];
  pageInfo: YouTubePageInfo;
};

export type HomeSectionKey =
  | 'continueWatching'
  | 'trending'
  | 'music'
  | 'gaming'
  | 'news'
  | 'sports'
  | 'technology'
  | 'documentaries'
  | 'recommended'
  | 'recentlyWatched'
  | 'watchLater'
  | 'favourites';

export const homeSectionKeys: HomeSectionKey[] = [
  'continueWatching',
  'trending',
  'music',
  'gaming',
  'news',
  'sports',
  'technology',
  'documentaries',
  'recommended',
  'recentlyWatched',
  'watchLater',
  'favourites'
];

export const contentPreferenceKeys: ContentPreferenceKey[] = [
  'news',
  'music',
  'sports',
  'technology',
  'documentaries',
  'learning'
];

export const defaultContentPreferenceKeys: ContentPreferenceKey[] = ['news', 'technology', 'documentaries'];

export type HomeSection = {
  key: HomeSectionKey;
  title: string;
  videos: YouTubeVideo[];
  error?: YouTubeApiError;
};

export type HomeSectionError = {
  key: HomeSectionKey;
  title: string;
  error: YouTubeApiError;
};

export type HomeContent = {
  spotlight: YouTubeVideo | null;
  sections: HomeSection[];
  errors?: HomeSectionError[];
};

export type FeedStatus = 'initializing' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'partialError' | 'offline' | 'error';

export type HomeFeedState =
  | { status: 'initializing' | 'loading'; content: HomeContent; error: null; requestId: number; retrying: boolean }
  | { status: 'refreshing' | 'ready' | 'empty'; content: HomeContent; error: null; requestId: number; retrying: boolean }
  | { status: 'partialError' | 'offline' | 'error'; content: HomeContent; error: YouTubeApiError; requestId: number; retrying: boolean };

export type SuggestionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'offline' | 'error';

export type SuggestionState =
  | { status: 'idle'; videoId: null; videos: YouTubeVideo[]; error: null; requestId: number; retrying: boolean }
  | { status: 'loading'; videoId: string; videos: YouTubeVideo[]; error: null; requestId: number; retrying: boolean }
  | { status: 'ready' | 'empty'; videoId: string; videos: YouTubeVideo[]; error: null; requestId: number; retrying: boolean }
  | { status: 'offline' | 'error'; videoId: string; videos: YouTubeVideo[]; error: YouTubeApiError; requestId: number; retrying: boolean };

export type WatchProgress = {
  videoId: string;
  lastPositionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  completionPercentage: number;
  lastWatchedAt: string;
  completed: boolean;
  interrupted?: boolean;
};

export type Collection = {
  id: string;
  name: string;
  videoIds: string[];
};

export type ActivePlaybackSession = {
  videoId: string;
  video: YouTubeVideo;
  currentTimeSeconds: number;
  durationSeconds: number;
  state: PlayerState;
  playbackIntent: PlaybackIntent;
  isMini: boolean;
  interrupted: boolean;
  startedAt: string;
  updatedAt: string;
};

export function playbackIntentAfterNativeStateChange({
  currentIntent,
  previousState,
  nextState,
  appState,
  hasNativePlayback
}: {
  currentIntent: PlaybackIntent;
  previousState: PlayerState;
  nextState: PlayerState;
  appState: string;
  hasNativePlayback: boolean;
}): PlaybackIntent {
  if (!hasNativePlayback || appState === 'active') {
    return currentIntent;
  }

  if (nextState === 'playing') {
    return 'play';
  }

  return currentIntent;
}

export type LibraryState = {
  savedVideos: Record<string, YouTubeVideo>;
  watchLaterIds: string[];
  favouriteIds: string[];
  history: WatchProgress[];
  collections: Collection[];
  recentSearches: string[];
  contentPreferenceKeys: ContentPreferenceKey[];
  homeHiddenSectionKeys: HomeSectionKey[];
  privateSession: boolean;
  focusMode: boolean;
  watchHistoryEnabled: boolean;
  searchHistoryEnabled: boolean;
  reduceMotionEnabled: boolean;
  readableTextEnabled: boolean;
  autoplayEnabled: boolean;
  resumePlaybackEnabled: boolean;
  appearance: AppearancePreference;
  analyticsConsent: boolean;
};

export const completionThreshold = 0.9;

export const emptyHomeContent: HomeContent = { spotlight: null, sections: [], errors: [] };

export function createInitialLibrary(): LibraryState {
  return {
    savedVideos: {},
    watchLaterIds: [],
    favouriteIds: [],
    history: [],
    collections: [
      { id: 'evening-focus', name: 'Evening focus', videoIds: [] },
      { id: 'research-queue', name: 'Research queue', videoIds: [] }
    ],
    recentSearches: [],
    contentPreferenceKeys: defaultContentPreferenceKeys,
    homeHiddenSectionKeys: [],
    privateSession: false,
    focusMode: false,
    watchHistoryEnabled: true,
    searchHistoryEnabled: true,
    reduceMotionEnabled: false,
    readableTextEnabled: false,
    autoplayEnabled: false,
    resumePlaybackEnabled: true,
    appearance: 'system',
    analyticsConsent: false
  };
}

export function isHomeSectionKey(value: unknown): value is HomeSectionKey {
  return typeof value === 'string' && homeSectionKeys.includes(value as HomeSectionKey);
}

export function isContentPreferenceKey(value: unknown): value is ContentPreferenceKey {
  return typeof value === 'string' && contentPreferenceKeys.includes(value as ContentPreferenceKey);
}

export function hasHomeContent(content: HomeContent): boolean {
  return Boolean(content.spotlight || content.sections.some((section) => section.videos.length > 0));
}

export function createInitialHomeFeedState(): HomeFeedState {
  return { status: 'initializing', content: emptyHomeContent, error: null, requestId: 0, retrying: false };
}

export function beginHomeFeedRequest(state: HomeFeedState, requestId: number, retrying = false): HomeFeedState {
  return {
    status: hasHomeContent(state.content) ? 'refreshing' : 'loading',
    content: state.content,
    error: null,
    requestId,
    retrying
  };
}

export function completeHomeFeedSuccess(state: HomeFeedState, requestId: number, content: HomeContent): HomeFeedState {
  if (state.requestId !== requestId) {
    return state;
  }
  const nextContent = { ...content, errors: content.errors ?? [] };
  const sectionError = nextContent.errors?.[0]?.error;
  if (!hasHomeContent(nextContent)) {
    if (sectionError) {
      if (hasHomeContent(state.content)) {
        return { status: 'partialError', content: state.content, error: sectionError, requestId, retrying: false };
      }
      return {
        status: isConnectivityError(sectionError) ? 'offline' : 'error',
        content: nextContent,
        error: sectionError,
        requestId,
        retrying: false
      };
    }
    if (hasHomeContent(state.content)) {
      return { status: 'ready', content: state.content, error: null, requestId, retrying: false };
    }
    return { status: 'empty', content: nextContent, error: null, requestId, retrying: false };
  }
  if (sectionError) {
    return { status: 'partialError', content: nextContent, error: sectionError, requestId, retrying: false };
  }
  return { status: 'ready', content: nextContent, error: null, requestId, retrying: false };
}

export function completeHomeFeedFailure(state: HomeFeedState, requestId: number, error: YouTubeApiError): HomeFeedState {
  if (state.requestId !== requestId) {
    return state;
  }
  if (hasHomeContent(state.content)) {
    return { status: 'partialError', content: state.content, error, requestId, retrying: false };
  }
  if (isConnectivityError(error)) {
    return { status: 'offline', content: state.content, error, requestId, retrying: false };
  }
  return { status: 'error', content: state.content, error, requestId, retrying: false };
}

export function createInitialSuggestionState(): SuggestionState {
  return { status: 'idle', videoId: null, videos: [], error: null, requestId: 0, retrying: false };
}

export function beginSuggestionRequest(state: SuggestionState, requestId: number, videoId: string, retrying = false): SuggestionState {
  return {
    status: 'loading',
    videoId,
    videos: state.videoId === videoId ? state.videos : [],
    error: null,
    requestId,
    retrying
  };
}

export function completeSuggestionSuccess(state: SuggestionState, requestId: number, videoId: string, videos: YouTubeVideo[]): SuggestionState {
  if (state.requestId !== requestId || state.videoId !== videoId) {
    return state;
  }
  const playableSuggestions = filterPlayableVideos(videos.filter((video) => video.id !== videoId)).slice(0, 12);
  return {
    status: playableSuggestions.length ? 'ready' : 'empty',
    videoId,
    videos: playableSuggestions,
    error: null,
    requestId,
    retrying: false
  };
}

export function completeSuggestionFailure(state: SuggestionState, requestId: number, videoId: string, error: YouTubeApiError): SuggestionState {
  if (state.requestId !== requestId || state.videoId !== videoId) {
    return state;
  }
  return { status: isConnectivityError(error) ? 'offline' : 'error', videoId, videos: state.videos, error, requestId, retrying: false };
}

export function isConnectivityError(error: YouTubeApiError): boolean {
  return error.code === 'offline' || error.code === 'timeout' || error.code === 'backendUnavailable';
}

export function isValidYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function isValidYouTubeResourceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function createProgress(videoId: string, positionSeconds: number, durationSeconds: number, now = new Date(), interrupted = false): WatchProgress | null {
  if (!isValidYouTubeVideoId(videoId)) {
    return null;
  }
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) {
    return null;
  }
  if (positionSeconds < 0 || durationSeconds < 0) {
    return null;
  }
  if (durationSeconds === 0 && positionSeconds !== 0) {
    return null;
  }
  if (durationSeconds > 0 && positionSeconds > durationSeconds) {
    return null;
  }
  const safeDuration = Math.max(0, durationSeconds);
  const safePosition = Math.min(Math.max(0, positionSeconds), safeDuration || positionSeconds);
  const progressPercent = safeDuration > 0 ? safePosition / safeDuration : 0;
  return {
    videoId,
    lastPositionSeconds: safePosition,
    durationSeconds: safeDuration,
    progressPercent,
    completionPercentage: progressPercent,
    lastWatchedAt: now.toISOString(),
    completed: progressPercent >= completionThreshold,
    interrupted
  };
}

export function upsertProgress(library: LibraryState, video: YouTubeVideo, progress: WatchProgress): LibraryState {
  if (library.privateSession || !library.watchHistoryEnabled) {
    return library;
  }
  const existing = library.history.find((item) => item.videoId === progress.videoId);
  if (existing && new Date(existing.lastWatchedAt).getTime() > new Date(progress.lastWatchedAt).getTime()) {
    return library;
  }
  return {
    ...library,
    savedVideos: { ...library.savedVideos, [video.id]: video },
    history: [progress, ...library.history.filter((item) => item.videoId !== progress.videoId)].slice(0, 100)
  };
}

export function markSavedVideo(library: LibraryState, video: YouTubeVideo): LibraryState {
  return {
    ...library,
    savedVideos: { ...library.savedVideos, [video.id]: video }
  };
}

export function recordSearch(library: LibraryState, query: string): LibraryState {
  const trimmed = query.trim();
  if (!trimmed || library.privateSession || !library.searchHistoryEnabled) {
    return library;
  }
  const withoutDuplicate = library.recentSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
  return {
    ...library,
    recentSearches: [trimmed, ...withoutDuplicate].slice(0, 12)
  };
}

export function addToCollection(collection: Collection, videoId: string): Collection {
  if (!isValidYouTubeVideoId(videoId) || collection.videoIds.includes(videoId)) {
    return collection;
  }
  return {
    ...collection,
    videoIds: [...collection.videoIds, videoId]
  };
}

export function dedupeVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  const seen = new Set<string>();
  const result: YouTubeVideo[] = [];
  for (const video of videos) {
    if (!seen.has(video.id)) {
      seen.add(video.id);
      result.push(video);
    }
  }
  return result;
}

export function dedupeSearchResults(results: YouTubeSearchResult[]): YouTubeSearchResult[] {
  const seen = new Set<string>();
  const deduped: YouTubeSearchResult[] = [];
  for (const result of results) {
    const key = `${result.kind}:${result.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }
  return deduped;
}

export function filterPlayableVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  return dedupeVideos(videos).filter((video) => isPlayableVideo(video));
}

export function isPlayableVideo(video: YouTubeVideo): boolean {
  if (!isValidYouTubeVideoId(video.id) || video.availability !== 'public') {
    return false;
  }
  return video.embeddable || hasNativePlaybackSource(video);
}

export function hasNativePlaybackSource(video: YouTubeVideo): boolean {
  return typeof video.playbackUrl === 'string' && /^https:\/\//.test(video.playbackUrl);
}

export function addVideoToQueue(
  queue: YouTubeVideo[],
  video: YouTubeVideo,
  activeVideoId?: string | null,
  placement: 'end' | 'next' = 'end'
): YouTubeVideo[] {
  if (!isPlayableVideo(video) || video.id === activeVideoId) {
    return queue;
  }
  const withoutDuplicate = queue.filter((item) => item.id !== video.id);
  const nextQueue = placement === 'next' ? [video, ...withoutDuplicate] : [...withoutDuplicate, video];
  return nextQueue.slice(0, 50);
}

export function removeVideoFromQueue(queue: YouTubeVideo[], videoId: string): YouTubeVideo[] {
  return queue.filter((video) => video.id !== videoId);
}

export function moveQueuedVideo(queue: YouTubeVideo[], videoId: string, direction: 'up' | 'down'): YouTubeVideo[] {
  const index = queue.findIndex((video) => video.id === videoId);
  if (index < 0) {
    return queue;
  }
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= queue.length) {
    return queue;
  }
  const copy = [...queue];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatViews(count: number | null, locale = 'en'): string {
  if (count === null || !Number.isFinite(count) || count < 0) {
    return 'Views unavailable';
  }
  return `${new Intl.NumberFormat(locale, { notation: count >= 10000 ? 'compact' : 'standard' }).format(count)} views`;
}

export function formatPublishedDate(value: string, now = new Date()): string {
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) {
    return '';
  }
  const diffDays = Math.max(0, Math.floor((now.getTime() - published.getTime()) / 86_400_000));
  if (diffDays < 1) {
    return 'today';
  }
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  const months = Math.floor(diffDays / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.floor(months / 12)}y ago`;
}

export function youtubeError(code: YouTubeApiErrorCode, message: string, retryable = true): YouTubeApiError {
  return { code, message, retryable };
}
