import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Collection,
  ContentPreferenceKey,
  HomeSectionKey,
  LibraryState,
  WatchProgress,
  YouTubeVideo,
  createInitialLibrary,
  defaultContentPreferenceKeys,
  createProgress,
  hasNativePlaybackSource,
  isContentPreferenceKey,
  isHomeSectionKey,
  isPlayableVideo,
  isValidYouTubeVideoId
} from './core';

const storageKey = 'syria-tube:library:v2';
const legacyStorageKey = 'syria-tube:library:v1';

type PersistedLibrary = {
  savedVideos?: Record<string, YouTubeVideo>;
  watchLaterIds?: string[];
  favouriteIds?: string[];
  history?: WatchProgress[];
  collections?: Collection[];
  recentSearches?: string[];
  contentPreferenceKeys?: ContentPreferenceKey[];
  homeHiddenSectionKeys?: HomeSectionKey[];
  privateSession?: boolean;
  focusMode?: boolean;
  watchHistoryEnabled?: boolean;
  searchHistoryEnabled?: boolean;
  reduceMotionEnabled?: boolean;
  readableTextEnabled?: boolean;
  autoplayEnabled?: boolean;
  resumePlaybackEnabled?: boolean;
  appearance?: LibraryState['appearance'];
  analyticsConsent?: boolean;
};

export async function loadLibrary(): Promise<LibraryState> {
  const raw = (await AsyncStorage.getItem(storageKey)) ?? (await AsyncStorage.getItem(legacyStorageKey));
  if (!raw) {
    return createInitialLibrary();
  }
  const parsed = JSON.parse(raw) as PersistedLibrary & Partial<LibraryState>;
  return sanitizeLibrary(parsed);
}

export async function saveLibrary(library: LibraryState): Promise<void> {
  const persisted: PersistedLibrary = {
    savedVideos: sanitizeSavedVideos(library.savedVideos),
    watchLaterIds: uniqueVideoIds(library.watchLaterIds),
    favouriteIds: uniqueVideoIds(library.favouriteIds),
    history: sanitizeHistory(library.history),
    collections: sanitizeCollections(library.collections),
    recentSearches: library.recentSearches.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    contentPreferenceKeys: uniqueContentPreferenceKeys(library.contentPreferenceKeys),
    homeHiddenSectionKeys: uniqueHomeSectionKeys(library.homeHiddenSectionKeys),
    privateSession: library.privateSession,
    focusMode: library.focusMode,
    watchHistoryEnabled: library.watchHistoryEnabled,
    searchHistoryEnabled: library.searchHistoryEnabled,
    reduceMotionEnabled: library.reduceMotionEnabled,
    readableTextEnabled: library.readableTextEnabled,
    autoplayEnabled: library.autoplayEnabled,
    resumePlaybackEnabled: library.resumePlaybackEnabled,
    appearance: library.appearance,
    analyticsConsent: library.analyticsConsent
  };
  await AsyncStorage.setItem(storageKey, JSON.stringify(persisted));
}

export async function clearLibrary(): Promise<void> {
  await AsyncStorage.multiRemove([storageKey, legacyStorageKey]);
}

function sanitizeLibrary(parsed: PersistedLibrary & Partial<LibraryState>): LibraryState {
  const initial = createInitialLibrary();
  return {
    ...initial,
    savedVideos: sanitizeSavedVideos(parsed.savedVideos ?? {}),
    watchLaterIds: uniqueVideoIds(parsed.watchLaterIds ?? []),
    favouriteIds: uniqueVideoIds(parsed.favouriteIds ?? []),
    history: sanitizeHistory(parsed.history ?? []),
    collections: sanitizeCollections(parsed.collections ?? initial.collections),
    recentSearches: (parsed.recentSearches ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 12),
    contentPreferenceKeys: uniqueContentPreferenceKeys(parsed.contentPreferenceKeys ?? defaultContentPreferenceKeys),
    homeHiddenSectionKeys: uniqueHomeSectionKeys(parsed.homeHiddenSectionKeys ?? []),
    privateSession: Boolean(parsed.privateSession),
    focusMode: Boolean(parsed.focusMode),
    watchHistoryEnabled: parsed.watchHistoryEnabled ?? true,
    searchHistoryEnabled: parsed.searchHistoryEnabled ?? true,
    reduceMotionEnabled: Boolean(parsed.reduceMotionEnabled),
    readableTextEnabled: Boolean(parsed.readableTextEnabled),
    autoplayEnabled: Boolean(parsed.autoplayEnabled),
    resumePlaybackEnabled: parsed.resumePlaybackEnabled ?? true,
    appearance: parsed.appearance === 'light' || parsed.appearance === 'dark' || parsed.appearance === 'system' ? parsed.appearance : 'system',
    analyticsConsent: Boolean(parsed.analyticsConsent)
  };
}

function sanitizeHistory(history: WatchProgress[]): WatchProgress[] {
  const seen = new Set<string>();
  const valid: WatchProgress[] = [];
  for (const item of history) {
    if (seen.has(item.videoId)) {
      continue;
    }
    const progress = createProgress(item.videoId, item.lastPositionSeconds, item.durationSeconds, new Date(item.lastWatchedAt), item.interrupted);
    if (progress) {
      seen.add(progress.videoId);
      valid.push(progress);
    }
  }
  return valid
    .sort((left, right) => new Date(right.lastWatchedAt).getTime() - new Date(left.lastWatchedAt).getTime())
    .slice(0, 100);
}

function sanitizeCollections(collections: Collection[]): Collection[] {
  const seen = new Set<string>();
  return collections
    .map((collection) => ({
      id: String(collection.id || `collection-${Date.now()}`),
      name: String(collection.name || 'Collection').trim() || 'Collection',
      videoIds: uniqueVideoIds(collection.videoIds ?? [])
    }))
    .filter((collection) => {
      if (seen.has(collection.id)) {
        return false;
      }
      seen.add(collection.id);
      return true;
    });
}

function sanitizeSavedVideos(savedVideos: Record<string, YouTubeVideo>): Record<string, YouTubeVideo> {
  const output: Record<string, YouTubeVideo> = {};
  for (const [id, value] of Object.entries(savedVideos)) {
    if (!isValidYouTubeVideoId(id) || !isStoredVideo(value) || value.id !== id || !isPlayableVideo(value)) {
      continue;
    }
    output[id] = sanitizeVideo(value);
  }
  return output;
}

function isStoredVideo(value: unknown): value is YouTubeVideo {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const video = value as Partial<YouTubeVideo>;
  return (
    video.kind === 'video' &&
    typeof video.id === 'string' &&
    typeof video.title === 'string' &&
    typeof video.channelId === 'string' &&
    typeof video.channelName === 'string' &&
    typeof video.thumbnailUrl === 'string' &&
    typeof video.durationSeconds === 'number' &&
    typeof video.publishedAt === 'string' &&
    typeof video.description === 'string' &&
    typeof video.canonicalUrl === 'string' &&
    typeof video.embeddable === 'boolean' &&
    typeof video.availability === 'string' &&
    typeof video.liveStatus === 'string'
  );
}

function sanitizeVideo(video: YouTubeVideo): YouTubeVideo {
  const sanitized: YouTubeVideo = {
    ...video,
    title: String(video.title),
    channelId: String(video.channelId),
    channelName: String(video.channelName),
    thumbnailUrl: String(video.thumbnailUrl),
    durationSeconds: Number.isFinite(video.durationSeconds) && video.durationSeconds > 0 ? video.durationSeconds : 0,
    viewCount: typeof video.viewCount === 'number' && Number.isFinite(video.viewCount) && video.viewCount >= 0 ? video.viewCount : null,
    publishedAt: String(video.publishedAt),
    description: String(video.description),
    canonicalUrl: String(video.canonicalUrl)
  };
  if (!hasNativePlaybackSource(sanitized)) {
    delete sanitized.playbackUrl;
    delete sanitized.playbackContentType;
  }
  return sanitized;
}

function uniqueVideoIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && isValidYouTubeVideoId(id)))];
}

function uniqueHomeSectionKeys(keys: HomeSectionKey[]): HomeSectionKey[] {
  return [...new Set(keys.filter(isHomeSectionKey))];
}

function uniqueContentPreferenceKeys(keys: ContentPreferenceKey[]): ContentPreferenceKey[] {
  return [...new Set(keys.filter(isContentPreferenceKey))];
}
