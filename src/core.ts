export type SearchType = 'videos' | 'channels' | 'playlists' | 'live';
export type SearchSort = 'relevance' | 'date' | 'viewCount' | 'rating';
export type SearchDuration = 'any' | 'short' | 'medium' | 'long';
export type AppearancePreference = 'system' | 'light' | 'dark';
export type PlayerCommand = 'play' | 'pause' | 'seekBackward10' | 'seekForward10' | 'replay';

export type VideoSummary = {
  id: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number;
  publishedAt: string;
  description: string;
  canonicalUrl: string;
};

export type WatchProgress = {
  videoId: string;
  lastPositionSeconds: number;
  durationSeconds: number;
  completionPercentage: number;
  lastWatchedAt: string;
  completed: boolean;
};

export type Collection = {
  id: string;
  name: string;
  videoIds: string[];
};

export type LibraryState = {
  savedVideos: Record<string, VideoSummary>;
  watchLaterIds: string[];
  favouriteIds: string[];
  history: WatchProgress[];
  collections: Collection[];
  recentSearches: string[];
  privateSession: boolean;
  focusMode: boolean;
  watchHistoryEnabled: boolean;
  searchHistoryEnabled: boolean;
  autoplayEnabled: boolean;
  resumePlaybackEnabled: boolean;
  appearance: AppearancePreference;
  analyticsConsent: boolean;
};

export const completionThreshold = 0.9;

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
    privateSession: false,
    focusMode: false,
    watchHistoryEnabled: true,
    searchHistoryEnabled: true,
    autoplayEnabled: false,
    resumePlaybackEnabled: true,
    appearance: 'system',
    analyticsConsent: false
  };
}

export function isValidYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function createProgress(videoId: string, positionSeconds: number, durationSeconds: number, now = new Date()): WatchProgress | null {
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
  const completionPercentage = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;
  return {
    videoId,
    lastPositionSeconds: positionSeconds,
    durationSeconds,
    completionPercentage,
    lastWatchedAt: now.toISOString(),
    completed: completionPercentage >= completionThreshold
  };
}

export function upsertProgress(library: LibraryState, video: VideoSummary, progress: WatchProgress): LibraryState {
  if (library.privateSession || !library.watchHistoryEnabled) {
    return library;
  }
  return {
    ...library,
    savedVideos: { ...library.savedVideos, [video.id]: video },
    history: [progress, ...library.history.filter((item) => item.videoId !== progress.videoId)]
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

export function dedupeVideos(videos: VideoSummary[]): VideoSummary[] {
  const seen = new Set<string>();
  const result: VideoSummary[] = [];
  for (const video of videos) {
    if (!seen.has(video.id)) {
      seen.add(video.id);
      result.push(video);
    }
  }
  return result;
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

export function formatViews(count: number, locale = 'en'): string {
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
