import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  AccessibilityInfo,
  GestureResponderEvent,
  Image,
  Linking,
  PanResponder,
  PanResponderGestureState,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text as NativeText,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  View
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { VideoAirPlayButton, isPictureInPictureSupported } from 'expo-video';
import {
  Airplay,
  BookmarkPlus,
  ChevronDown,
  CirclePlay,
  ExternalLink,
  Heart,
  Home as HomeIcon,
  Library as LibraryIcon,
  Lock,
  Maximize2,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Share2,
  SkipBack,
  SkipForward,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react-native';

import { clearLibrary, loadLibrary, saveLibrary } from './src/storage';
import { colors, spacing } from './src/theme';
import {
  ActivePlaybackSession,
  AppearancePreference,
  Collection,
  ContentPreferenceKey,
  HomeContent,
  HomeFeedState,
  HomeSectionKey,
  LibraryState,
  PlayerCommand,
  PlayerState,
  SearchDuration,
  SearchSort,
  SearchType,
  SuggestionState,
  WatchProgress,
  YouTubeApiError,
  YouTubeSearchResult,
  YouTubeVideo,
  addVideoToQueue,
  addToCollection,
  beginHomeFeedRequest,
  beginSuggestionRequest,
  completeHomeFeedFailure,
  completeHomeFeedSuccess,
  completeSuggestionFailure,
  completeSuggestionSuccess,
  createInitialLibrary,
  createInitialHomeFeedState,
  createInitialSuggestionState,
  createProgress,
  contentPreferenceKeys,
  defaultContentPreferenceKeys,
  formatDuration,
  formatPublishedDate,
  formatViews,
  hasNativePlaybackSource,
  hasHomeContent,
  homeSectionKeys,
  isConnectivityError,
  markSavedVideo,
  moveQueuedVideo,
  playbackIntentAfterNativeStateChange,
  recordSearch,
  removeVideoFromQueue,
  upsertProgress,
  youtubeError
} from './src/core';
import {
  checkingReadinessState,
  createInitialStartupState,
  failedStartupState,
  loadingContentState,
  readyStartupState,
  StartupState
} from './src/data/startup';
import { capabilitiesForPlayback, resolvePlaybackDescriptor } from './src/player/PlaybackResolver';
import { PlaybackDescriptor, PlayerCapabilities, PlayerPresentation } from './src/player/types';
import { logDevelopmentDiagnostic } from './src/observability';
import { YouTubePlayer } from './src/YouTubePlayer';
import { NativeVideoPlayer } from './src/NativeVideoPlayer';
import {
  checkBackendReadiness,
  fetchHomeContent,
  fetchSuggestedVideos,
  fetchVideosByIds,
  getSearchApiConfigurationError,
  isSearchApiConfigured,
  searchYouTube
} from './src/searchApi';

type TabKey = 'home' | 'search' | 'watch' | 'library' | 'settings';
type Palette = typeof colors.light;
type PlayerGestureMode = 'undecided' | 'scrub' | 'brightness' | 'volume' | 'minimize' | 'dismiss' | 'pinch';
type PlayerFitMode = 'fit' | 'fill';
type SupportSnapshot = {
  apiConfigured: boolean;
  apiHost: string;
  startupStatus: StartupState['status'];
  feedStatus: HomeFeedState['status'];
  playbackSource: string;
  lastErrorCode: string;
};

const playbackKeepAwakeTag = 'SyriaTubePlayback';
const appVersion = '1.0.0';

const homeSectionLabels: Record<HomeSectionKey, string> = {
  nativeDirect: 'Free Lock Screen',
  continueWatching: 'Continue Watching',
  trending: 'Trending',
  music: 'Music',
  gaming: 'Gaming',
  news: 'News',
  sports: 'Sports',
  technology: 'Technology',
  documentaries: 'Documentaries',
  recommended: 'Recommended',
  recentlyWatched: 'Recently Watched',
  watchLater: 'Watch Later',
  favourites: 'Favourites'
};

const contentPreferenceLabels: Record<ContentPreferenceKey, string> = {
  news: 'News and current events',
  music: 'Music and live sessions',
  sports: 'Sports highlights',
  technology: 'Technology explainers',
  documentaries: 'Documentaries',
  learning: 'Learning and how-to'
};

const suggestedSearchesByPreference: Record<ContentPreferenceKey, string[]> = {
  news: ['news today', 'Syria news', 'world news explained'],
  music: ['Arabic music live', 'new music videos', 'calm music playlist'],
  sports: ['football highlights', 'sports news', 'match analysis'],
  technology: ['technology explained', 'AI tools tutorial', 'phone tips'],
  documentaries: ['short documentaries', 'history documentary', 'science documentary'],
  learning: ['learn English Arabic', 'study skills', 'how to fix phone']
};

const fallbackSearchSuggestions = ['breaking news', 'music live', 'technology explained', 'documentaries', 'football highlights', 'learn something new'];

const ReadableTextContext = React.createContext(false);

function readableTextComfort(style: StyleProp<TextStyle>): TextStyle | null {
  const flattened = StyleSheet.flatten(style);
  const fontSize = flattened?.fontSize;
  if (typeof fontSize !== 'number') {
    return null;
  }
  const bump = fontSize <= 12 ? 1 : fontSize >= 28 ? 2 : 1.5;
  const lineHeight = typeof flattened.lineHeight === 'number' ? Math.ceil(flattened.lineHeight + bump * 1.6) : undefined;
  return {
    fontSize: Math.ceil(fontSize + bump),
    ...(lineHeight ? { lineHeight } : null)
  };
}

function Text(props: React.ComponentProps<typeof NativeText>) {
  const readableTextEnabled = useContext(ReadableTextContext);
  const comfortStyle = readableTextEnabled ? readableTextComfort(props.style) : null;
  return <NativeText {...props} style={[props.style, comfortStyle]} />;
}

const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'search', label: 'Search', icon: SearchIcon },
  { key: 'watch', label: 'Watch', icon: CirclePlay },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon }
];

function touchFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}

function impactFeedback(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  void Haptics.impactAsync(style).catch(() => undefined);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function playbackIntentForCommand(command: PlayerCommand, current: ActivePlaybackSession['playbackIntent']): ActivePlaybackSession['playbackIntent'] {
  if (command === 'pause' || command === 'stop') {
    return 'pause';
  }
  if (command === 'play' || command === 'replay') {
    return 'play';
  }
  return current;
}

function getPlaybackPlatformSupport() {
  const nativeMobile = Platform.OS === 'ios' || Platform.OS === 'android';
  return {
    backgroundPlayback: nativeMobile,
    pictureInPicture: nativeMobile && safePictureInPictureSupported(),
    airPlay: Platform.OS === 'ios',
    nowPlaying: nativeMobile
  };
}

function safePictureInPictureSupported(): boolean {
  try {
    return isPictureInPictureSupported();
  } catch {
    return false;
  }
}

function playbackUnavailableMessage(descriptor: PlaybackDescriptor): string {
  if (descriptor.kind !== 'unavailable') {
    return '';
  }
  switch (descriptor.reason) {
    case 'invalid-video-id':
      return 'This video id is invalid.';
    case 'private':
      return 'This video is private.';
    case 'deleted':
      return 'This video has been removed.';
    case 'age-restricted':
      return 'This video is age restricted and cannot play here.';
    case 'embedding-disabled':
      return 'The owner has disabled embedded playback.';
    case 'native-source-missing':
      return 'This video does not include a licensed native playback source.';
    case 'region-restricted':
      return 'This video is not available in this region.';
    case 'unsupported-source':
      return 'This video source is unsupported.';
    default:
      return 'This video is unavailable.';
  }
}

function showScreenMirroringGuide(video?: YouTubeVideo) {
  const message = video
    ? `To watch "${video.title}" on a TV, open iOS Control Centre, tap Screen Mirroring, then choose an AirPlay-compatible TV or Apple TV. For Chromecast, open this video in YouTube and use YouTube's official Cast button.`
    : 'Open iOS Control Centre, tap Screen Mirroring, then choose an AirPlay-compatible TV or Apple TV. For Chromecast, open a video in YouTube and use YouTube official Cast.';
  Alert.alert('Mirror Screen to TV', message);
}

function showLockScreenNotice(video?: YouTubeVideo) {
  const message = video && hasNativePlaybackSource(video)
    ? `Syria Tube plays "${video.title}" with the native iOS video player, keeps it active in the background, publishes Now Playing metadata, and allows PiP when iOS supports it.`
    : video
      ? `This video is using the YouTube embed fallback. Syria Tube keeps the display awake while the embedded player is open, but iOS pauses YouTube WebView/IFrame playback if you manually lock the screen. Lock-screen playback requires this video to include a backend-supplied native playback URL.`
      : 'Native direct-source videos use iOS background playback and PiP. YouTube embed fallback videos keep the display awake while open, but cannot keep playing after a manual screen lock.';
  Alert.alert('Lock Screen Playback', message);
}

async function openYouTubeVideo(video: YouTubeVideo) {
  const urls = [
    `youtube://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
    `youtube://watch?v=${encodeURIComponent(video.id)}`,
    `vnd.youtube://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
    video.canonicalUrl
  ];

  for (const url of urls) {
    try {
      const canOpen = url.startsWith('http') || await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      continue;
    }
  }

  Alert.alert('Open YouTube', 'This video could not be opened outside Syria Tube.');
}

function showBackgroundPlaybackAction(video: YouTubeVideo) {
  if (hasNativePlaybackSource(video)) {
    showLockScreenNotice(video);
    return;
  }
  void openYouTubeVideo(video);
}

function readSafeApiHost(): string {
  const rawValue = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL?.trim();
  if (!rawValue) {
    return 'Not configured';
  }
  try {
    return new URL(rawValue).hostname;
  } catch {
    return 'Invalid URL';
  }
}

function playbackSourceLabel(session: ActivePlaybackSession | null): string {
  if (!session) {
    return 'No active player';
  }
  return hasNativePlaybackSource(session.video) ? 'Lock-screen direct' : 'YouTube embed';
}

function videoSourceBadge(video: YouTubeVideo): string {
  return hasNativePlaybackSource(video) ? 'Lock' : 'YouTube';
}

function videoSourceActionLabel(video: YouTubeVideo): string {
  return hasNativePlaybackSource(video) ? 'Open Source' : 'Open in YouTube';
}

function lastSupportErrorCode(startupState: StartupState, homeFeed: HomeFeedState, playerError: string | null): string {
  if (playerError) {
    return 'player';
  }
  if ('error' in homeFeed && homeFeed.error) {
    return homeFeed.error.code;
  }
  if (startupState.status === 'error') {
    return startupState.error.code;
  }
  return 'none';
}

function createSupportSnapshot({
  apiConfigured,
  startupState,
  homeFeed,
  activeSession,
  playerError
}: {
  apiConfigured: boolean;
  startupState: StartupState;
  homeFeed: HomeFeedState;
  activeSession: ActivePlaybackSession | null;
  playerError: string | null;
}): SupportSnapshot {
  return {
    apiConfigured,
    apiHost: readSafeApiHost(),
    startupStatus: startupState.status,
    feedStatus: homeFeed.status,
    playbackSource: playbackSourceLabel(activeSession),
    lastErrorCode: lastSupportErrorCode(startupState, homeFeed, playerError)
  };
}

function supportReportMessage(snapshot: SupportSnapshot): string {
  return [
    'Syria Tube support snapshot',
    `Version: ${appVersion}`,
    `API configured: ${snapshot.apiConfigured ? 'yes' : 'no'}`,
    `API host: ${snapshot.apiHost}`,
    `Startup: ${snapshot.startupStatus}`,
    `Home feed: ${snapshot.feedStatus}`,
    `Playback: ${snapshot.playbackSource}`,
    `Last error: ${snapshot.lastErrorCode}`
  ].join('\n');
}

function problemReportMessage(snapshot: SupportSnapshot, note: string): string {
  const trimmedNote = note.trim();
  return [
    supportReportMessage(snapshot),
    '',
    'User note:',
    trimmedNote || 'No note provided'
  ].join('\n');
}

function shareSupportSnapshot(snapshot: SupportSnapshot) {
  void Share.share({
    title: 'Syria Tube support snapshot',
    message: supportReportMessage(snapshot)
  });
}

function shareProblemReport(snapshot: SupportSnapshot, note: string) {
  void Share.share({
    title: 'Syria Tube problem report',
    message: problemReportMessage(snapshot, note)
  });
}

function countHomeVideos(content: HomeContent): number {
  const ids = new Set<string>();
  if (content.spotlight) {
    ids.add(content.spotlight.id);
  }
  for (const section of content.sections) {
    for (const video of section.videos) {
      ids.add(video.id);
    }
  }
  return ids.size;
}

function buildSearchSuggestions(library: LibraryState): string[] {
  const preferred = library.contentPreferenceKeys.flatMap((key) => suggestedSearchesByPreference[key] ?? []);
  const candidates = [...library.recentSearches.slice(0, 4), ...preferred, ...fallbackSearchSuggestions];
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push(value);
    if (suggestions.length >= 12) {
      break;
    }
  }
  return suggestions;
}

function usePlaybackKeepAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    void activateKeepAwakeAsync(playbackKeepAwakeTag).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(playbackKeepAwakeTag).catch(() => undefined);
    };
  }, [enabled]);
}

export default function App() {
  const systemScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [library, setLibrary] = useState<LibraryState>(() => createInitialLibrary());
  const [isReady, setIsReady] = useState(false);
  const [startupState, setStartupState] = useState<StartupState>(() => createInitialStartupState());
  const [homeFeed, setHomeFeed] = useState<HomeFeedState>(() => createInitialHomeFeedState());
  const [suggestions, setSuggestions] = useState<SuggestionState>(() => createInitialSuggestionState());
  const [activeSession, setActiveSession] = useState<ActivePlaybackSession | null>(null);
  const [playerCommand, setPlayerCommand] = useState<PlayerCommand | null>(null);
  const [repeatOne, setRepeatOne] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<YouTubeVideo[]>([]);
  const homeRequestId = useRef(0);
  const homeController = useRef<AbortController | null>(null);
  const startupController = useRef<AbortController | null>(null);
  const suggestionRequestId = useRef(0);
  const suggestionController = useRef<AbortController | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const latestLibrary = useRef(library);
  const activeSessionRef = useRef<ActivePlaybackSession | null>(activeSession);

  latestLibrary.current = library;
  activeSessionRef.current = activeSession;

  const actualScheme = library.appearance === 'system' ? systemScheme : library.appearance;
  const isDark = actualScheme === 'dark';
  const palette = isDark ? colors.dark : colors.light;
  const playerHeight = Math.max(204, Math.floor((width - spacing.page * 2) * 9 / 16));
  const apiConfigured = isSearchApiConfigured();
  const supportSnapshot = createSupportSnapshot({
    apiConfigured,
    startupState,
    homeFeed,
    activeSession,
    playerError
  });
  const homeSignature = useMemo(
    () =>
      [
        library.history.map((item) => item.videoId).join(','),
        library.watchLaterIds.join(','),
        library.favouriteIds.join(',')
      ].join('|'),
    [library.history, library.watchLaterIds, library.favouriteIds]
  );
  const handleRecordSearch = useCallback((query: string) => {
    setLibrary((current) => recordSearch(current, query));
  }, []);

  useEffect(() => {
    let mounted = true;
    loadLibrary()
      .then((stored) => {
        if (mounted) {
          setLibrary(stored);
          setIsReady(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const timeout = setTimeout(() => {
      void saveLibrary(library);
    }, 450);
    return () => clearTimeout(timeout);
  }, [isReady, library]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const controller = new AbortController();
    startupController.current?.abort();
    startupController.current = controller;
    setStartupState(checkingReadinessState());
    checkBackendReadiness(controller.signal)
      .then(() => {
        if (startupController.current === controller) {
          setStartupState((current) => loadingContentState(current));
        }
      })
      .catch((error: YouTubeApiError) => {
        if (startupController.current === controller && error.code !== 'cancelled') {
          setStartupState((current) => (current.status === 'ready' ? current : failedStartupState(error, isConnectivityError(error))));
        }
      })
      .finally(() => {
        if (startupController.current === controller) {
          startupController.current = null;
        }
      });
    return () => {
      if (startupController.current === controller) {
        controller.abort();
        startupController.current = null;
      }
    };
  }, [isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const controller = new AbortController();
    homeController.current?.abort();
    homeController.current = controller;
    const timeout = setTimeout(() => {
      loadHomeFeed(controller, false);
    }, 0);
    return () => {
      clearTimeout(timeout);
      if (homeController.current === controller) {
        controller.abort();
        homeController.current = null;
      }
    };
  }, [isReady, homeSignature]);

  useEffect(() => {
    const videoId = activeSession?.videoId ?? null;
    suggestionController.current?.abort();
    if (!videoId) {
      setSuggestions(createInitialSuggestionState());
      suggestionController.current = null;
      return;
    }
    const controller = new AbortController();
    suggestionController.current = controller;
    const timeout = setTimeout(() => {
      loadSuggestions(videoId, controller, false);
    }, 0);
    return () => {
      clearTimeout(timeout);
      if (suggestionController.current === controller) {
        controller.abort();
        suggestionController.current = null;
      }
    };
  }, [activeSession?.videoId]);

  useEffect(() => {
    const nextVideo = playbackQueue[0];
    if (!activeSession || activeSession.state !== 'ended' || repeatOne || !nextVideo) {
      return;
    }
    const timeout = setTimeout(() => {
      const current = activeSessionRef.current;
      if (current?.videoId === activeSession.videoId && current.state === 'ended') {
        playQueuedVideo(nextVideo);
      }
    }, 650);
    return () => clearTimeout(timeout);
  }, [activeSession?.state, activeSession?.videoId, repeatOne, playbackQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  function handleAppStateChange(state: AppStateStatus) {
    const session = activeSessionRef.current;
    appState.current = state;
    if (!session) {
      return;
    }
    if (state !== 'active') {
      const suspendedByPlatform = !hasNativePlaybackSource(session.video) && (session.state === 'playing' || session.state === 'buffering');
      const progress = createProgress(
        session.videoId,
        session.currentTimeSeconds,
        session.durationSeconds,
        new Date()
      );
      if (progress) {
        setLibrary((current) => {
          const next = upsertProgress(current, session.video, progress);
          void saveLibrary(next);
          return next;
        });
      }
      setActiveSession((current) =>
        current && current.videoId === session.videoId
          ? {
              ...current,
              state: suspendedByPlatform ? 'interrupted' : current.state,
              interrupted: suspendedByPlatform ? true : current.interrupted,
              updatedAt: new Date().toISOString()
            }
          : current
      );
      return;
    }
  }

  function loadHomeFeed(controller: AbortController, retrying: boolean) {
    const requestId = ++homeRequestId.current;
    const startedAt = new Date().toISOString();
    logDevelopmentDiagnostic({
      operation: 'homeFeed',
      requestId,
      requestGeneration: homeRequestId.current,
      startedAt,
      resultStatus: 'started',
      startupState: startupState.status,
      feedState: homeFeed.status,
      cachedItemCount: countHomeVideos(homeFeed.content),
      retrying
    });
    setHomeFeed((current) => beginHomeFeedRequest(current, requestId, retrying));
    setStartupState((current) => loadingContentState(current));
    if (!apiConfigured) {
      const configurationError = getSearchApiConfigurationError() ?? youtubeError('notConfigured', 'Syria Tube backend is not configured for this build.', false);
      logDevelopmentDiagnostic({
        operation: 'homeFeed',
        requestId,
        requestGeneration: homeRequestId.current,
        startedAt,
        finishedAt: new Date().toISOString(),
        resultStatus: 'failed',
        errorCode: configurationError.code,
        aborted: false,
        staleResponseIgnored: false,
        startupState: startupState.status,
        feedState: homeFeed.status,
        cachedItemCount: countHomeVideos(homeFeed.content),
        retrying
      });
      setHomeFeed((current) =>
        completeHomeFeedFailure(current, requestId, configurationError)
      );
      setStartupState(failedStartupState(configurationError, isConnectivityError(configurationError)));
      if (homeController.current === controller) {
        homeController.current = null;
      }
      return;
    }
    const librarySnapshot = latestLibrary.current;
    fetchHomeContent({
      historyIds: librarySnapshot.history.map((item) => item.videoId),
      watchLaterIds: librarySnapshot.watchLaterIds,
      favouriteIds: librarySnapshot.favouriteIds,
      signal: controller.signal
    })
      .then((content) => {
        if (homeRequestId.current !== requestId || homeController.current !== controller) {
          logDevelopmentDiagnostic({
            operation: 'homeFeed',
            requestId,
            requestGeneration: homeRequestId.current,
            startedAt,
            finishedAt: new Date().toISOString(),
            resultStatus: 'ignored',
            aborted: controller.signal.aborted,
            staleResponseIgnored: true,
            startupState: startupState.status,
            feedState: homeFeed.status,
            cachedItemCount: countHomeVideos(homeFeed.content),
            retrying
          });
          return;
        }
        logDevelopmentDiagnostic({
          operation: 'homeFeed',
          requestId,
          requestGeneration: homeRequestId.current,
          startedAt,
          finishedAt: new Date().toISOString(),
          resultStatus: 'succeeded',
          errorCode: content.errors?.[0]?.error.code,
          aborted: false,
          staleResponseIgnored: false,
          startupState: 'ready',
          feedState: content.errors?.length ? 'partialError' : hasHomeContent(content) ? 'ready' : 'empty',
          cachedItemCount: countHomeVideos(content),
          retrying
        });
        setHomeFeed((current) => completeHomeFeedSuccess(current, requestId, content));
        setStartupState(readyStartupState());
        const videos = [...(content.spotlight ? [content.spotlight] : []), ...content.sections.flatMap((section) => section.videos)];
        setLibrary((current) => ({
          ...current,
          savedVideos: {
            ...current.savedVideos,
            ...Object.fromEntries(videos.map((video) => [video.id, video]))
          }
        }));
      })
      .catch((error: YouTubeApiError) => {
        const staleResponseIgnored = homeRequestId.current !== requestId || homeController.current !== controller;
        const aborted = error.code === 'cancelled' || controller.signal.aborted;
        logDevelopmentDiagnostic({
          operation: 'homeFeed',
          requestId,
          requestGeneration: homeRequestId.current,
          startedAt,
          finishedAt: new Date().toISOString(),
          resultStatus: aborted ? 'aborted' : staleResponseIgnored ? 'ignored' : 'failed',
          errorCode: error.code,
          aborted,
          staleResponseIgnored,
          startupState: startupState.status,
          feedState: homeFeed.status,
          cachedItemCount: countHomeVideos(homeFeed.content),
          retrying
        });
        if (homeRequestId.current === requestId && homeController.current === controller && error.code !== 'cancelled') {
          setHomeFeed((current) => completeHomeFeedFailure(current, requestId, error));
          setStartupState((current) => (current.status === 'ready' ? current : failedStartupState(error, isConnectivityError(error))));
        }
      })
      .finally(() => {
        if (homeController.current === controller) {
          homeController.current = null;
        }
      });
  }

  function retryHome() {
    if (homeFeed.retrying || homeFeed.status === 'loading') {
      return;
    }
    homeController.current?.abort();
    const controller = new AbortController();
    homeController.current = controller;
    loadHomeFeed(controller, true);
  }

  function loadSuggestions(videoId: string, controller: AbortController, retrying: boolean) {
    const requestId = ++suggestionRequestId.current;
    const startedAt = new Date().toISOString();
    logDevelopmentDiagnostic({
      operation: 'suggestions',
      requestId,
      requestGeneration: suggestionRequestId.current,
      startedAt,
      resultStatus: 'started',
      retrying
    });
    setSuggestions((current) => beginSuggestionRequest(current, requestId, videoId, retrying));
    if (!apiConfigured) {
      const configurationError = youtubeError('notConfigured', 'Syria Tube backend is not configured for this build.', false);
      logDevelopmentDiagnostic({
        operation: 'suggestions',
        requestId,
        requestGeneration: suggestionRequestId.current,
        startedAt,
        finishedAt: new Date().toISOString(),
        resultStatus: 'failed',
        errorCode: configurationError.code,
        aborted: false,
        staleResponseIgnored: false,
        retrying
      });
      setSuggestions((current) =>
        completeSuggestionFailure(current, requestId, videoId, configurationError)
      );
      if (suggestionController.current === controller) {
        suggestionController.current = null;
      }
      return;
    }
    fetchSuggestedVideos(videoId, controller.signal)
      .then((videos) => {
        if (suggestionRequestId.current !== requestId || suggestionController.current !== controller) {
          logDevelopmentDiagnostic({
            operation: 'suggestions',
            requestId,
            requestGeneration: suggestionRequestId.current,
            startedAt,
            finishedAt: new Date().toISOString(),
            resultStatus: 'ignored',
            aborted: controller.signal.aborted,
            staleResponseIgnored: true,
            retrying
          });
          return;
        }
        logDevelopmentDiagnostic({
          operation: 'suggestions',
          requestId,
          requestGeneration: suggestionRequestId.current,
          startedAt,
          finishedAt: new Date().toISOString(),
          resultStatus: 'succeeded',
          aborted: false,
          staleResponseIgnored: false,
          cachedItemCount: videos.length,
          retrying
        });
        setSuggestions((current) => completeSuggestionSuccess(current, requestId, videoId, videos));
        setLibrary((current) => ({
          ...current,
          savedVideos: {
            ...current.savedVideos,
            ...Object.fromEntries(videos.map((video) => [video.id, video]))
          }
        }));
      })
      .catch((error: YouTubeApiError) => {
        const staleResponseIgnored = suggestionRequestId.current !== requestId || suggestionController.current !== controller;
        const aborted = error.code === 'cancelled' || controller.signal.aborted;
        logDevelopmentDiagnostic({
          operation: 'suggestions',
          requestId,
          requestGeneration: suggestionRequestId.current,
          startedAt,
          finishedAt: new Date().toISOString(),
          resultStatus: aborted ? 'aborted' : staleResponseIgnored ? 'ignored' : 'failed',
          errorCode: error.code,
          aborted,
          staleResponseIgnored,
          retrying
        });
        if (suggestionRequestId.current === requestId && suggestionController.current === controller && error.code !== 'cancelled') {
          setSuggestions((current) => completeSuggestionFailure(current, requestId, videoId, error));
        }
      })
      .finally(() => {
        if (suggestionController.current === controller) {
          suggestionController.current = null;
        }
      });
  }

  function retrySuggestions() {
    const videoId = activeSession?.videoId;
    if (!videoId || suggestions.retrying || suggestions.status === 'loading') {
      return;
    }
    suggestionController.current?.abort();
    const controller = new AbortController();
    suggestionController.current = controller;
    loadSuggestions(videoId, controller, true);
  }

  function updateLibrary(mutator: (current: LibraryState) => LibraryState) {
    setLibrary((current) => mutator(current));
  }

  function enqueueVideo(video: YouTubeVideo, placement: 'end' | 'next' = 'end') {
    setLibrary((current) => markSavedVideo(current, video));
    setPlaybackQueue((current) => addVideoToQueue(current, video, activeSessionRef.current?.videoId ?? null, placement));
  }

  function playQueuedVideo(video: YouTubeVideo) {
    setPlaybackQueue((current) => removeVideoFromQueue(current, video.id));
    selectVideo(video);
  }

  function removeQueuedVideo(videoId: string) {
    setPlaybackQueue((current) => removeVideoFromQueue(current, videoId));
  }

  function moveQueueItem(videoId: string, direction: 'up' | 'down') {
    setPlaybackQueue((current) => moveQueuedVideo(current, videoId, direction));
  }

  function clearPlaybackQueue() {
    setPlaybackQueue([]);
  }

  function selectVideo(video: YouTubeVideo) {
    const now = new Date().toISOString();
    setLibrary((current) => markSavedVideo(current, video));
    setPlaybackQueue((current) => removeVideoFromQueue(current, video.id));
    setPlayerCommand(null);
    setActiveSession({
      videoId: video.id,
      video,
      currentTimeSeconds: 0,
      durationSeconds: video.durationSeconds,
      state: 'idle',
      playbackIntent: 'play',
      isMini: false,
      interrupted: false,
      startedAt: now,
      updatedAt: now
    });
    setPlayerError(null);
    setActiveTab('watch');
  }

  function handlePlayerReady(videoId: string) {
    if (activeSessionRef.current?.videoId === videoId) {
      setPlayerError(null);
    }
  }

  function handlePlayerError(videoId: string, message: string) {
    if (activeSessionRef.current?.videoId === videoId) {
      setPlayerError(message);
    }
  }

  function updateSessionState(videoId: string, state: PlayerState, position: number, duration: number) {
    setActiveSession((current) =>
      current && current.videoId === videoId
        ? {
            ...current,
            currentTimeSeconds: Number.isFinite(position) ? Math.max(0, position) : current.currentTimeSeconds,
            durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : current.durationSeconds,
            state,
            playbackIntent: playbackIntentAfterNativeStateChange({
              currentIntent: current.playbackIntent,
              previousState: current.state,
              nextState: state,
              appState: appState.current,
              hasNativePlayback: hasNativePlaybackSource(current.video)
            }),
            interrupted: state === 'interrupted' ? true : current.interrupted,
            updatedAt: new Date().toISOString()
          }
        : current
    );
  }

  function recordPlayback(videoId: string, video: YouTubeVideo, position: number, duration: number) {
    if (activeSessionRef.current?.videoId !== videoId) {
      return;
    }
    const progress = createProgress(videoId, position, duration);
    if (!progress) {
      return;
    }
    setLibrary((current) => upsertProgress(current, video, progress));
  }

  function issuePlayerCommand(command: PlayerCommand) {
    setActiveSession((current) => {
      if (!current) {
        return current;
      }
      const playbackIntent = playbackIntentForCommand(command, current.playbackIntent);
      if (playbackIntent === current.playbackIntent) {
        return current;
      }
      return {
        ...current,
        playbackIntent,
        updatedAt: new Date().toISOString()
      };
    });
    setPlayerCommand(command);
  }

  function addWatchLater(video: YouTubeVideo) {
    updateLibrary((current) => ({
      ...markSavedVideo(current, video),
      watchLaterIds: [...new Set([...current.watchLaterIds, video.id])]
    }));
  }

  function addFavourite(video: YouTubeVideo) {
    updateLibrary((current) => ({
      ...markSavedVideo(current, video),
      favouriteIds: [...new Set([...current.favouriteIds, video.id])]
    }));
  }

  function closePlayer() {
    setPlayerCommand('stop');
    setActiveSession(null);
    setPlayerError(null);
  }

  function minimizePlayer() {
    if (!activeSession) {
      return;
    }
    impactFeedback();
    setActiveSession((current) =>
      current
        ? {
            ...current,
            isMini: true,
            updatedAt: new Date().toISOString()
          }
        : current
    );
    if (activeTab === 'watch') {
      setActiveTab('home');
    }
  }

  function restoreFullPlayer() {
    if (activeSession) {
      impactFeedback();
      setActiveSession((current) =>
        current
          ? {
              ...current,
              isMini: false,
              updatedAt: new Date().toISOString()
            }
          : current
      );
      setActiveTab('watch');
    }
  }

  function changeTab(tab: TabKey) {
    if (activeSession) {
      setActiveSession((current) =>
        current
          ? {
              ...current,
              isMini: tab !== 'watch',
              updatedAt: new Date().toISOString()
            }
          : current
      );
    }
    setActiveTab(tab);
  }

  function setAppearancePreference(value: AppearancePreference) {
    updateLibrary((current) => ({ ...current, appearance: value }));
  }

  return (
    <ReadableTextContext.Provider value={library.readableTextEnabled}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ExpoStatusBar style={isDark ? 'light' : 'dark'} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.appFrame, { backgroundColor: palette.background }]}>
        <View style={styles.screen}>
          {activeTab === 'home' ? (
            <HomeScreen
              library={library}
              palette={palette}
              feed={homeFeed}
              startupState={startupState}
              onRetry={retryHome}
              onSelectVideo={selectVideo}
              onSearch={() => setActiveTab('search')}
              onOpenSettings={() => setActiveTab('settings')}
              onAddFavourite={addFavourite}
              onAddWatchLater={addWatchLater}
              onPlayNext={(video) => enqueueVideo(video, 'next')}
              onAddToQueue={(video) => enqueueVideo(video, 'end')}
            />
          ) : null}
          {activeTab === 'search' ? (
            <SearchScreen
              library={library}
              palette={palette}
              onSelectVideo={selectVideo}
              onRecordSearch={handleRecordSearch}
              onAddFavourite={addFavourite}
              onAddWatchLater={addWatchLater}
              onPlayNext={(video) => enqueueVideo(video, 'next')}
              onAddToQueue={(video) => enqueueVideo(video, 'end')}
            />
          ) : null}
          {activeTab === 'watch' ? (
            <WatchScreen
              library={library}
              palette={palette}
              session={activeSession}
              playerHeight={playerHeight}
              playerError={playerError}
              repeatOne={repeatOne}
              suggestions={suggestions}
              playbackQueue={playbackQueue}
              onSetCommand={issuePlayerCommand}
              onSetRepeatOne={setRepeatOne}
              onSelectVideo={selectVideo}
              onSelectQueuedVideo={playQueuedVideo}
              onPlayNext={(video) => enqueueVideo(video, 'next')}
              onAddToQueue={(video) => enqueueVideo(video, 'end')}
              onRemoveQueuedVideo={removeQueuedVideo}
              onMoveQueueItem={moveQueueItem}
              onClearPlaybackQueue={clearPlaybackQueue}
              onRetrySuggestions={retrySuggestions}
              onAddFavourite={addFavourite}
              onAddWatchLater={addWatchLater}
              onUpdateLibrary={updateLibrary}
            />
          ) : null}
          {activeTab === 'library' ? (
            <LibraryScreen
              library={library}
              palette={palette}
              onSelectVideo={selectVideo}
              onUpdateLibrary={updateLibrary}
            />
          ) : null}
          {activeTab === 'settings' ? (
            <SettingsScreen
              library={library}
              palette={palette}
              supportSnapshot={supportSnapshot}
              onSetAppearance={setAppearancePreference}
              onUpdateLibrary={updateLibrary}
            />
          ) : null}
        </View>
        {activeSession ? (
          <PersistentPlayer
            session={activeSession}
            command={playerCommand}
            repeatOne={repeatOne}
            palette={palette}
            isFull={activeTab === 'watch' && !activeSession.isMini}
            reducedMotion={library.reduceMotionEnabled}
            fullHeight={playerHeight}
            screenWidth={width}
            onSetCommand={issuePlayerCommand}
            onCommandHandled={() => setPlayerCommand(null)}
            onReady={handlePlayerReady}
            onProgress={recordPlayback}
            onStateChange={updateSessionState}
            onError={handlePlayerError}
            onClose={closePlayer}
            onMinimize={minimizePlayer}
            onRestore={restoreFullPlayer}
            onTogglePlay={() => issuePlayerCommand(activeSession.state === 'playing' ? 'pause' : 'play')}
          />
        ) : null}
        <TabBar activeTab={activeTab} palette={palette} onChange={changeTab} />
      </View>
      </SafeAreaView>
    </ReadableTextContext.Provider>
  );
}

function HomeScreen({
  library,
  palette,
  feed,
  startupState,
  onRetry,
  onSelectVideo,
  onSearch,
  onOpenSettings,
  onAddFavourite,
  onAddWatchLater,
  onPlayNext,
  onAddToQueue
}: {
  library: LibraryState;
  palette: Palette;
  feed: HomeFeedState;
  startupState: StartupState;
  onRetry: () => void;
  onSelectVideo: (video: YouTubeVideo) => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
}) {
  const content = feed.content;
  const visibleSections = content.sections.filter((section) => section.key === 'nativeDirect' || !library.homeHiddenSectionKeys.includes(section.key));
  const hasContent = hasHomeContent(content);
  const showInitialSkeletons = (feed.status === 'initializing' || feed.status === 'loading') && !hasContent;
  const showTerminalError = (feed.status === 'error' || feed.status === 'offline') && !hasContent && feed.error;
  const showPartialError = feed.status === 'partialError' && hasContent && feed.error;
  const showStartupChecking = startupState.status === 'checking-readiness' && !hasContent;
  const retryDisabled = feed.retrying || feed.status === 'loading' || feed.status === 'refreshing';

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.kicker, { color: palette.subtle }]}>
            {library.privateSession ? 'Private session' : 'Real YouTube discovery'}
          </Text>
          <Text style={[styles.title, { color: palette.text }]}>Syria Tube</Text>
        </View>
        <IconButton label="Settings" icon={SettingsIcon} palette={palette} onPress={onOpenSettings} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open search"
        style={[styles.searchField, { backgroundColor: palette.surface, borderColor: palette.border }]}
        onPress={onSearch}
      >
        <Text style={[styles.searchPlaceholder, { color: palette.subtle }]}>Search videos</Text>
      </Pressable>
      <ActionButton label="Mirror Screen to TV" icon={MonitorUp} palette={palette} onPress={() => showScreenMirroringGuide()} />
      {showStartupChecking ? <InlineState title="Checking Syria Tube backend readiness" palette={palette} /> : null}
      {feed.status === 'refreshing' ? <InlineState title="Refreshing YouTube sections" palette={palette} /> : null}
      {showPartialError ? (
        <InlineState
          title="Some YouTube sections could not refresh. Showing available videos."
          palette={palette}
          actionLabel={feed.retrying ? 'Retrying' : 'Retry'}
          disabled={retryDisabled}
          onPress={onRetry}
        />
      ) : null}
      {showInitialSkeletons ? <HomeSkeleton palette={palette} /> : null}
      {showTerminalError ? <ErrorState error={feed.error} palette={palette} onRetry={onRetry} disabled={retryDisabled} /> : null}
      {!showInitialSkeletons && !showTerminalError && content.spotlight ? (
        <SpotlightCard video={content.spotlight} palette={palette} onPress={() => onSelectVideo(content.spotlight as YouTubeVideo)} />
      ) : null}
      {feed.status === 'empty' ? <EmptyState title="No playable YouTube videos are available right now" palette={palette} /> : null}
      {visibleSections.map((section) => (
        <VideoRail
          key={section.key}
          title={section.title}
          videos={section.videos}
          library={library}
          palette={palette}
          onSelectVideo={onSelectVideo}
          onAddFavourite={onAddFavourite}
          onAddWatchLater={onAddWatchLater}
          onPlayNext={onPlayNext}
          onAddToQueue={onAddToQueue}
        />
      ))}
    </ScrollView>
  );
}

function SearchScreen({
  library,
  palette,
  onSelectVideo,
  onRecordSearch,
  onAddFavourite,
  onAddWatchLater,
  onPlayNext,
  onAddToQueue
}: {
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onRecordSearch: (query: string) => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
}) {
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const activeSearchKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState<SearchType>('videos');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [duration, setDuration] = useState<SearchDuration>('any');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [didSearch, setDidSearch] = useState(false);
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [error, setError] = useState<YouTubeApiError | null>(null);
  const suggestedQueries = useMemo(() => buildSearchSuggestions(library), [library.recentSearches, library.contentPreferenceKeys]);

  useEffect(
    () => () => {
      mounted.current = false;
      requestId.current += 1;
      activeSearchKey.current = null;
      activeController.current?.abort();
      activeController.current = null;
    },
    []
  );

  useEffect(() => {
    const trimmed = query.trim();
    const timeout = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 350);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      activeController.current?.abort();
      activeController.current = null;
      activeSearchKey.current = null;
      setResults([]);
      setNextPageToken(undefined);
      setDidSearch(false);
      setError(null);
      setLoading(false);
      return;
    }
    void runSearch(false);
    return () => {
      activeController.current?.abort();
      activeController.current = null;
      activeSearchKey.current = null;
    };
  }, [debouncedQuery, type, sort, duration]);

  async function runSearch(append: boolean) {
    if (!debouncedQuery) {
      return;
    }
    if (append && (!nextPageToken || loading || loadingMore)) {
      return;
    }
    const queryForRequest = debouncedQuery;
    const typeForRequest = type;
    const sortForRequest = sort;
    const durationForRequest = typeForRequest === 'videos' ? duration : 'any';
    const pageTokenForRequest = append ? nextPageToken : undefined;
    const searchKey = JSON.stringify({
      append,
      query: queryForRequest,
      type: typeForRequest,
      sort: sortForRequest,
      duration: durationForRequest,
      pageToken: pageTokenForRequest ?? ''
    });
    if (activeSearchKey.current === searchKey) {
      return;
    }
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    activeSearchKey.current = searchKey;
    const id = ++requestId.current;
    const startedAt = new Date().toISOString();
    logDevelopmentDiagnostic({
      operation: 'search',
      requestId: id,
      requestGeneration: requestId.current,
      startedAt,
      resultStatus: 'started'
    });
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setNextPageToken(undefined);
    }
    setError(null);
    try {
      const page = await searchYouTube({
        query: queryForRequest,
        type: typeForRequest,
        sort: sortForRequest,
        duration: durationForRequest,
        pageToken: pageTokenForRequest,
        signal: controller.signal
      });
      if (!mounted.current || requestId.current !== id || activeController.current !== controller) {
        logDevelopmentDiagnostic({
          operation: 'search',
          requestId: id,
          requestGeneration: requestId.current,
          startedAt,
          finishedAt: new Date().toISOString(),
          resultStatus: 'ignored',
          aborted: controller.signal.aborted,
          staleResponseIgnored: true
        });
        return;
      }
      logDevelopmentDiagnostic({
        operation: 'search',
        requestId: id,
        requestGeneration: requestId.current,
        startedAt,
        finishedAt: new Date().toISOString(),
        resultStatus: 'succeeded',
        cachedItemCount: page.results.length,
        aborted: false,
        staleResponseIgnored: false
      });
      setResults((current) => (append ? [...current, ...page.results] : page.results));
      setNextPageToken(page.pageInfo.nextPageToken);
      setDidSearch(true);
      if (!append) {
        onRecordSearch(queryForRequest);
      }
    } catch (searchError) {
      const apiError = searchError as YouTubeApiError;
      const staleResponseIgnored = !mounted.current || requestId.current !== id || activeController.current !== controller;
      const aborted = apiError.code === 'cancelled' || controller.signal.aborted;
      logDevelopmentDiagnostic({
        operation: 'search',
        requestId: id,
        requestGeneration: requestId.current,
        startedAt,
        finishedAt: new Date().toISOString(),
        resultStatus: aborted ? 'aborted' : staleResponseIgnored ? 'ignored' : 'failed',
        errorCode: apiError.code,
        aborted,
        staleResponseIgnored
      });
      if (mounted.current && requestId.current === id && activeController.current === controller && apiError.code !== 'cancelled') {
        setError(apiError);
        setDidSearch(true);
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
      }
      if (activeSearchKey.current === searchKey) {
        activeSearchKey.current = null;
      }
      if (mounted.current && requestId.current === id) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  function clearSearch() {
    activeController.current?.abort();
    activeController.current = null;
    activeSearchKey.current = null;
    requestId.current += 1;
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setError(null);
    setDidSearch(false);
    setNextPageToken(undefined);
  }

  function applySuggestedQuery(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setDebouncedQuery(trimmed);
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: palette.text }]}>Search</Text>
      <View style={[styles.inputWrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <TextInput
          accessibilityLabel="Search query"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => setDebouncedQuery(query.trim())}
          placeholder="Search videos, channels, playlists"
          placeholderTextColor={palette.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: palette.text }]}
          returnKeyType="search"
        />
        {query.length ? <IconButton label="Clear" icon={X} palette={palette} onPress={clearSearch} /> : null}
      </View>
      <SegmentedControl
        label="Type"
        value={type}
        options={[
          ['videos', 'Videos'],
          ['channels', 'Channels'],
          ['playlists', 'Playlists'],
          ['live', 'Live']
        ]}
        palette={palette}
        onChange={(value) => {
          const nextType = value as SearchType;
          setType(nextType);
          if (nextType !== 'videos') {
            setDuration('any');
          }
        }}
      />
      <SegmentedControl
        label="Sort"
        value={sort}
        options={[
          ['relevance', 'Relevance'],
          ['date', 'Date'],
          ['viewCount', 'Views']
        ]}
        palette={palette}
        onChange={(value) => setSort(value as SearchSort)}
      />
      {type === 'videos' ? (
        <SegmentedControl
          label="Duration"
          value={duration}
          options={[
            ['any', 'Any'],
            ['short', 'Short'],
            ['medium', 'Medium'],
            ['long', 'Long']
          ]}
          palette={palette}
          onChange={(value) => setDuration(value as SearchDuration)}
        />
      ) : null}
      {!query.trim() ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Suggested Searches</Text>
          <View style={styles.chipWrap}>
            {suggestedQueries.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${item}`}
                style={[styles.searchChip, { backgroundColor: palette.surface, borderColor: palette.border }]}
                onPress={() => applySuggestedQuery(item)}
              >
                <Text style={[styles.searchChipText, { color: palette.text }]} numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Recent Searches</Text>
          {library.recentSearches.length ? (
            library.recentSearches.map((item) => (
              <Pressable key={item} style={styles.recentRow} onPress={() => applySuggestedQuery(item)}>
                <Text style={[styles.bodyText, { color: palette.text }]}>{item}</Text>
              </Pressable>
            ))
          ) : (
            <EmptyState title="No recent searches" palette={palette} />
          )}
        </View>
      ) : null}
      {loading && results.length === 0 ? <LoadingState title="Searching YouTube" palette={palette} /> : null}
      {error ? <ErrorState error={error} palette={palette} onRetry={() => runSearch(false)} /> : null}
      {!loading && !error && didSearch && results.length === 0 ? <EmptyState title="No YouTube results matched this search" palette={palette} /> : null}
      {results.length > 0 ? (
        <View style={styles.verticalList}>
          {results.map((result) => (
            <SearchResultCard
              key={`${result.kind}:${result.id}`}
              result={result}
              library={library}
              palette={palette}
              onSelectVideo={onSelectVideo}
              onAddFavourite={onAddFavourite}
              onAddWatchLater={onAddWatchLater}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
            />
          ))}
        </View>
      ) : null}
      {nextPageToken ? (
        <ActionButton
          label={loadingMore ? 'Loading more' : 'Load More'}
          palette={palette}
          disabled={loading || loadingMore}
          onPress={() => runSearch(true)}
        />
      ) : null}
    </ScrollView>
  );
}

function WatchScreen({
  library,
  palette,
  session,
  playerHeight,
  playerError,
  repeatOne,
  suggestions,
  playbackQueue,
  onSetCommand,
  onSetRepeatOne,
  onSelectVideo,
  onSelectQueuedVideo,
  onPlayNext,
  onAddToQueue,
  onRemoveQueuedVideo,
  onMoveQueueItem,
  onClearPlaybackQueue,
  onRetrySuggestions,
  onAddFavourite,
  onAddWatchLater,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  session: ActivePlaybackSession | null;
  playerHeight: number;
  playerError: string | null;
  repeatOne: boolean;
  suggestions: SuggestionState;
  playbackQueue: YouTubeVideo[];
  onSetCommand: (command: PlayerCommand) => void;
  onSetRepeatOne: (value: boolean) => void;
  onSelectVideo: (video: YouTubeVideo) => void;
  onSelectQueuedVideo: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
  onRemoveQueuedVideo: (videoId: string) => void;
  onMoveQueueItem: (videoId: string, direction: 'up' | 'down') => void;
  onClearPlaybackQueue: () => void;
  onRetrySuggestions: () => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [session?.videoId]);

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.title, { color: palette.text }]}>Watch</Text>
        <EmptyState title="Choose a real YouTube video to start watching" palette={palette} />
        <PlaybackQueueSection
          queue={playbackQueue}
          palette={palette}
          onSelectVideo={onSelectQueuedVideo}
          onRemoveVideo={onRemoveQueuedVideo}
          onMoveVideo={onMoveQueueItem}
          onClearQueue={onClearPlaybackQueue}
        />
      </ScrollView>
    );
  }

  const video = session.video;
  const canControlPlayer = session.state !== 'idle' && session.state !== 'error';
  const lockScreenText = hasNativePlaybackSource(video)
    ? 'Native playback stays active in the background with iOS Now Playing controls and automatic PiP where supported.'
    : 'Unavailable for this YouTube embed. Screen-lock playback requires a backend native playback URL.';
  function handleBackgroundAction() {
    if (!hasNativePlaybackSource(video)) {
      onSetCommand('pause');
    }
    showBackgroundPlaybackAction(video);
  }

  return (
    <ScrollView
      ref={scrollRef}
      bounces={false}
      alwaysBounceVertical={false}
      contentContainerStyle={[styles.scrollContent, { paddingTop: playerHeight + 24 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {playerError ? (
        <View style={[styles.notice, { backgroundColor: palette.dangerSoft }]}>
          <Text style={[styles.bodyText, { color: palette.danger }]}>{playerError}</Text>
        </View>
      ) : null}
      <View style={styles.controlRow}>
        <IconButton label="Back 10 seconds" icon={SkipBack} palette={palette} disabled={!canControlPlayer} onPress={() => onSetCommand('seekBackward10')} />
        <IconButton label="Play" icon={Play} palette={palette} disabled={!canControlPlayer} onPress={() => onSetCommand('play')} />
        <IconButton label="Pause" icon={Pause} palette={palette} disabled={!canControlPlayer} onPress={() => onSetCommand('pause')} />
        <IconButton label="Forward 10 seconds" icon={SkipForward} palette={palette} disabled={!canControlPlayer} onPress={() => onSetCommand('seekForward10')} />
        <IconButton label="Replay" icon={RotateCcw} palette={palette} disabled={!canControlPlayer} onPress={() => onSetCommand('replay')} />
        <IconButton label="Repeat one" icon={Repeat2} palette={palette} selected={repeatOne} onPress={() => onSetRepeatOne(!repeatOne)} />
      </View>
      <QuickToolGrid>
        <ToolButton label="Mirror TV" icon={MonitorUp} palette={palette} onPress={() => showScreenMirroringGuide(video)} />
        <ToolButton label={hasNativePlaybackSource(video) ? 'Lock Screen' : 'YouTube App'} icon={Lock} palette={palette} onPress={handleBackgroundAction} />
        <ToolButton label="Share" icon={Share2} palette={palette} onPress={() => void Share.share({ message: video.canonicalUrl, url: video.canonicalUrl })} />
        <ToolButton label="Save" icon={BookmarkPlus} palette={palette} onPress={() => onAddWatchLater(video)} />
      </QuickToolGrid>
      <InfoPanel
        icon={Lock}
        title={hasNativePlaybackSource(video) ? 'Lock screen' : 'Embed only'}
        text={lockScreenText}
        palette={palette}
        onPress={() => showLockScreenNotice(video)}
      />
      <View style={styles.metadataBlock}>
        <Text style={[styles.videoTitle, { color: palette.text }]}>{video.title}</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>{video.channelName}</Text>
        {!library.focusMode ? (
          <Text style={[styles.metaText, { color: palette.subtle }]}>
            {formatViews(video.viewCount)} · {formatPublishedDate(video.publishedAt)}
          </Text>
        ) : null}
        <Text style={[styles.metaText, { color: palette.subtle }]}>
          State: {session.state} · Position: {formatDuration(session.currentTimeSeconds)} / {formatDuration(session.durationSeconds)}
        </Text>
        <Text style={[styles.description, { color: palette.mutedText }]}>{video.description}</Text>
      </View>
      <UpNextSection
        activeVideoId={session.videoId}
        library={library}
        palette={palette}
        suggestions={suggestions}
        playbackQueue={playbackQueue}
        onSelectVideo={onSelectVideo}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        onAddFavourite={onAddFavourite}
        onAddWatchLater={onAddWatchLater}
        onRetry={onRetrySuggestions}
      />
      <PlaybackQueueSection
        queue={playbackQueue}
        palette={palette}
        onSelectVideo={onSelectQueuedVideo}
        onRemoveVideo={onRemoveQueuedVideo}
        onMoveVideo={onMoveQueueItem}
        onClearQueue={onClearPlaybackQueue}
      />
      <View style={styles.actionRow}>
        <ActionButton label="Favourite" icon={Heart} palette={palette} onPress={() => onAddFavourite(video)} />
        <ActionButton label="Later" icon={BookmarkPlus} palette={palette} onPress={() => onAddWatchLater(video)} />
        <ActionButton
          label="Collect"
          icon={Plus}
          palette={palette}
          onPress={() => {
            const options = library.collections.map((collection) => ({
              text: collection.name,
              onPress: () =>
                onUpdateLibrary((current) => ({
                  ...current,
                  collections: current.collections.map((item) => (item.id === collection.id ? addToCollection(item, video.id) : item))
                }))
            }));
            Alert.alert('Add to collection', video.title, [...options, { text: 'Cancel', style: 'cancel' }]);
          }}
        />
        <ActionButton label="Share" icon={Share2} palette={palette} onPress={() => void Share.share({ message: video.canonicalUrl, url: video.canonicalUrl })} />
        <ActionButton label="Open in YouTube" icon={ExternalLink} palette={palette} onPress={() => openYouTubeVideo(video)} />
        <ActionButton
          label="Mirror Screen to TV"
          icon={Airplay}
          palette={palette}
          onPress={() => showScreenMirroringGuide(video)}
        />
      </View>
      <FocusPanel library={library} palette={palette} onUpdateLibrary={onUpdateLibrary} />
    </ScrollView>
  );
}

function UpNextSection({
  activeVideoId,
  library,
  palette,
  suggestions,
  playbackQueue,
  onSelectVideo,
  onPlayNext,
  onAddToQueue,
  onAddFavourite,
  onAddWatchLater,
  onRetry
}: {
  activeVideoId: string;
  library: LibraryState;
  palette: Palette;
  suggestions: SuggestionState;
  playbackQueue: YouTubeVideo[];
  onSelectVideo: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onRetry: () => void;
}) {
  const loading = suggestions.status === 'loading';
  const failed = suggestions.status === 'error' || suggestions.status === 'offline';
  const retryDisabled = suggestions.retrying || loading;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Up next</Text>
        {loading && suggestions.videos.length ? <Text style={[styles.metaText, { color: palette.subtle }]}>Refreshing</Text> : null}
      </View>
      {loading && !suggestions.videos.length ? <SuggestionSkeletonList palette={palette} /> : null}
      {failed && !suggestions.videos.length && suggestions.error ? (
        <ErrorState error={suggestions.error} palette={palette} onRetry={onRetry} disabled={retryDisabled} />
      ) : null}
      {failed && suggestions.videos.length && suggestions.error ? (
        <InlineState
          title="Suggestions could not refresh. Playback is still active."
          palette={palette}
          actionLabel={suggestions.retrying ? 'Retrying' : 'Retry'}
          disabled={retryDisabled}
          onPress={onRetry}
        />
      ) : null}
      {suggestions.status === 'empty' ? <EmptyState title="No suggested videos are available for this video" palette={palette} /> : null}
      {suggestions.videos.length ? (
        <View style={styles.verticalList}>
          {suggestions.videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              library={library}
              palette={palette}
              onSelectVideo={onSelectVideo}
              onAddFavourite={onAddFavourite}
              onAddWatchLater={onAddWatchLater}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
              queued={playbackQueue.some((item) => item.id === video.id)}
              current={video.id === activeVideoId}
              wide
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PlaybackQueueSection({
  queue,
  palette,
  onSelectVideo,
  onRemoveVideo,
  onMoveVideo,
  onClearQueue
}: {
  queue: YouTubeVideo[];
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onRemoveVideo: (videoId: string) => void;
  onMoveVideo: (videoId: string, direction: 'up' | 'down') => void;
  onClearQueue: () => void;
}) {
  if (!queue.length) {
    return null;
  }

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Queue</Text>
          <Text style={[styles.metaText, { color: palette.subtle }]}>{queue.length} videos ready</Text>
        </View>
        <IconButton label="Clear queue" icon={Trash2} palette={palette} onPress={onClearQueue} />
      </View>
      <View style={styles.verticalList}>
        {queue.map((video, index) => (
          <View key={video.id} style={[styles.queueRow, { borderColor: palette.border }]}>
            {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={styles.queueThumb} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Play queued video ${video.title}`} style={styles.queueText} onPress={() => onSelectVideo(video)}>
              <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
                {video.title}
              </Text>
              <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
                {index === 0 ? 'Plays next' : `Queued ${index + 1}`} · {video.channelName}
              </Text>
            </Pressable>
            <View style={styles.queueActions}>
              <IconButton label="Move queued video up" icon="↑" palette={palette} disabled={index === 0} onPress={() => onMoveVideo(video.id, 'up')} />
              <IconButton label="Move queued video down" icon="↓" palette={palette} disabled={index === queue.length - 1} onPress={() => onMoveVideo(video.id, 'down')} />
              <IconButton label="Remove queued video" icon={X} palette={palette} onPress={() => onRemoveVideo(video.id)} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function LibraryScreen({
  library,
  palette,
  onSelectVideo,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  const [collectionName, setCollectionName] = useState('');
  const [hydrated, setHydrated] = useState<Record<string, YouTubeVideo>>({});
  const [error, setError] = useState<YouTubeApiError | null>(null);
  const idsToHydrate = useMemo(
    () => [...new Set([...library.history.map((item) => item.videoId), ...library.watchLaterIds, ...library.favouriteIds, ...library.collections.flatMap((item) => item.videoIds)])],
    [library.history, library.watchLaterIds, library.favouriteIds, library.collections]
  );

  useEffect(() => {
    if (!idsToHydrate.length) {
      setHydrated({});
      return;
    }
    const controller = new AbortController();
    fetchVideosByIds(idsToHydrate, controller.signal)
      .then((videos) => {
        const byId = Object.fromEntries(videos.map((video) => [video.id, video]));
        setHydrated(byId);
        onUpdateLibrary((current) => ({ ...current, savedVideos: { ...current.savedVideos, ...byId } }));
        setError(null);
      })
      .catch((apiError: YouTubeApiError) => {
        if (apiError.code !== 'cancelled') {
          setError(apiError);
        }
      });
    return () => controller.abort();
  }, [idsToHydrate.join(',')]);

  function createCollection() {
    const trimmed = collectionName.trim();
    if (!trimmed) {
      return;
    }
    onUpdateLibrary((current) => ({
      ...current,
      collections: current.collections.some((collection) => collection.name.toLowerCase() === trimmed.toLowerCase())
        ? current.collections
        : [...current.collections, { id: `collection-${Date.now()}`, name: trimmed, videoIds: [] }]
    }));
    setCollectionName('');
  }

  function confirmLibraryChange(title: string, message: string, action: () => void) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: action }
    ]);
  }

  const videoById = { ...library.savedVideos, ...hydrated };
  const progressVideos = library.history.map((progress) => videoById[progress.videoId]).filter((video): video is YouTubeVideo => Boolean(video));
  const watchLater = library.watchLaterIds.map((id) => videoById[id]).filter((video): video is YouTubeVideo => Boolean(video));
  const favourites = library.favouriteIds.map((id) => videoById[id]).filter((video): video is YouTubeVideo => Boolean(video));

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: palette.text }]}>Library</Text>
      {error ? <ErrorState error={error} palette={palette} onRetry={() => setHydrated({})} /> : null}
      <VideoListBlock
        title="Continue Watching"
        videos={progressVideos}
        palette={palette}
        actionLabel="Clear Continue Watching"
        actionIcon={Trash2}
        actionDisabled={library.history.length === 0}
        onAction={() =>
          confirmLibraryChange('Clear continue watching?', 'This removes local playback progress only.', () =>
            onUpdateLibrary((current) => ({ ...current, history: [] }))
          )
        }
        onSelectVideo={onSelectVideo}
      />
      <VideoListBlock
        title="Watch Later"
        videos={watchLater}
        palette={palette}
        actionLabel="Clear Watch Later"
        actionIcon={Trash2}
        actionDisabled={library.watchLaterIds.length === 0}
        onAction={() =>
          confirmLibraryChange('Clear watch later?', 'This removes every video from Watch Later on this device.', () =>
            onUpdateLibrary((current) => ({ ...current, watchLaterIds: [] }))
          )
        }
        onSelectVideo={onSelectVideo}
      />
      <VideoListBlock
        title="Favourites"
        videos={favourites}
        palette={palette}
        actionLabel="Clear Favourites"
        actionIcon={Trash2}
        actionDisabled={library.favouriteIds.length === 0}
        onAction={() =>
          confirmLibraryChange('Clear favourites?', 'This removes every video from Favourites on this device.', () =>
            onUpdateLibrary((current) => ({ ...current, favouriteIds: [] }))
          )
        }
        onSelectVideo={onSelectVideo}
      />
      <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Collections</Text>
        <View style={[styles.inputWrap, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <TextInput
            value={collectionName}
            onChangeText={setCollectionName}
            placeholder="New collection"
            placeholderTextColor={palette.subtle}
            style={[styles.input, { color: palette.text }]}
          />
          <IconButton label="Add collection" icon={Plus} palette={palette} onPress={createCollection} />
        </View>
      </View>
      {library.collections.map((collection) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          videoById={videoById}
          palette={palette}
          onSelectVideo={onSelectVideo}
          onDelete={() =>
            onUpdateLibrary((current) => ({
              ...current,
              collections: current.collections.filter((item) => item.id !== collection.id)
            }))
          }
          onClear={() =>
            confirmLibraryChange('Clear collection videos?', `This keeps "${collection.name}" but removes its saved videos.`, () =>
              onUpdateLibrary((current) => ({
                ...current,
                collections: current.collections.map((item) => (item.id === collection.id ? { ...item, videoIds: [] } : item))
              }))
            )
          }
        />
      ))}
      <ActionButton
        label="Clear Local Library"
        icon={Trash2}
        destructive
        palette={palette}
        onPress={() =>
          Alert.alert('Clear local library?', 'This removes local watch progress, favourites, watch later, collections, and searches.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear',
              style: 'destructive',
              onPress: () => {
                void clearLibrary();
                onUpdateLibrary(() => createInitialLibrary());
              }
            }
          ])
        }
      />
    </ScrollView>
  );
}

function SettingsScreen({
  library,
  palette,
  supportSnapshot,
  onSetAppearance,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  supportSnapshot: SupportSnapshot;
  onSetAppearance: (value: AppearancePreference) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: palette.text }]}>Settings</Text>
      <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <SegmentedControl
          label="Appearance"
          value={library.appearance}
          options={[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark']
          ]}
          palette={palette}
          onChange={(value) => onSetAppearance(value as AppearancePreference)}
        />
        <SettingsSwitch label="Private Session" value={library.privateSession} palette={palette} onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, privateSession: value }))} />
        <SettingsSwitch label="Watch History" value={library.watchHistoryEnabled} palette={palette} onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, watchHistoryEnabled: value }))} />
        <SettingsSwitch label="Search History" value={library.searchHistoryEnabled} palette={palette} onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, searchHistoryEnabled: value }))} />
        <SettingsSwitch label="Resume Playback" value={library.resumePlaybackEnabled} palette={palette} onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, resumePlaybackEnabled: value }))} />
        <SettingsSwitch label="Analytics Consent" value={library.analyticsConsent} palette={palette} onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, analyticsConsent: value }))} />
      </View>
      <DataControlsPanel palette={palette} onUpdateLibrary={onUpdateLibrary} />
      <HomeSectionsPanel library={library} palette={palette} onUpdateLibrary={onUpdateLibrary} />
      <ContentPreferencesPanel library={library} palette={palette} onUpdateLibrary={onUpdateLibrary} />
      <ComfortSettingsPanel library={library} palette={palette} onUpdateLibrary={onUpdateLibrary} />
      <InfoPanel
        icon={MonitorUp}
        title="Screen mirroring"
        text="Use iOS Control Centre to mirror Syria Tube to an AirPlay-compatible TV or Apple TV. Chromecast stays inside the official YouTube app."
        palette={palette}
        onPress={() => showScreenMirroringGuide()}
      />
      <InfoPanel
        icon={Lock}
        title="When iPhone locks"
        text="Native direct videos keep playing after lock. YouTube embed videos keep progress and resume when iOS returns them to the foreground."
        palette={palette}
        onPress={() => showLockScreenNotice()}
      />
      <SupportSnapshotPanel snapshot={supportSnapshot} palette={palette} />
      <ProblemReportPanel snapshot={supportSnapshot} palette={palette} />
      <ActionButton
        label="Mirror Screen to TV"
        icon={Airplay}
        palette={palette}
        onPress={() => showScreenMirroringGuide()}
      />
      <ActionButton label="YouTube Terms" icon={ExternalLink} palette={palette} onPress={() => void Linking.openURL('https://www.youtube.com/t/terms')} />
      <ActionButton label="YouTube Privacy" icon={ExternalLink} palette={palette} onPress={() => void Linking.openURL('https://policies.google.com/privacy')} />
    </ScrollView>
  );
}

function HomeSectionsPanel({
  library,
  palette,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  function setSectionVisible(sectionKey: HomeSectionKey, visible: boolean) {
    onUpdateLibrary((current) => {
      const hidden = new Set(current.homeHiddenSectionKeys);
      if (visible) {
        hidden.delete(sectionKey);
      } else {
        hidden.add(sectionKey);
      }
      return {
        ...current,
        homeHiddenSectionKeys: [...hidden]
      };
    });
  }

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Home Sections</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>Choose the rows that make Home feel useful.</Text>
      </View>
      {homeSectionKeys.map((sectionKey) => (
        <SettingsSwitch
          key={sectionKey}
          label={homeSectionLabels[sectionKey]}
          value={sectionKey === 'nativeDirect' || !library.homeHiddenSectionKeys.includes(sectionKey)}
          palette={palette}
          disabled={sectionKey === 'nativeDirect'}
          onValueChange={(visible) => setSectionVisible(sectionKey, visible)}
        />
      ))}
      <ActionButton
        label="Show All Sections"
        icon={RotateCcw}
        palette={palette}
        disabled={library.homeHiddenSectionKeys.length === 0}
        onPress={() => onUpdateLibrary((current) => ({ ...current, homeHiddenSectionKeys: [] }))}
      />
    </View>
  );
}

function ContentPreferencesPanel({
  library,
  palette,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  function setPreferenceEnabled(preferenceKey: ContentPreferenceKey, enabled: boolean) {
    onUpdateLibrary((current) => {
      const enabledKeys = new Set(current.contentPreferenceKeys);
      if (enabled) {
        enabledKeys.add(preferenceKey);
      } else {
        enabledKeys.delete(preferenceKey);
      }
      return {
        ...current,
        contentPreferenceKeys: [...enabledKeys]
      };
    });
  }

  const usesDefaultPreferences =
    library.contentPreferenceKeys.length === defaultContentPreferenceKeys.length &&
    defaultContentPreferenceKeys.every((key) => library.contentPreferenceKeys.includes(key));

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Content Preferences</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>Tune search ideas around the topics people actually want.</Text>
      </View>
      {contentPreferenceKeys.map((preferenceKey) => (
        <SettingsSwitch
          key={preferenceKey}
          label={contentPreferenceLabels[preferenceKey]}
          value={library.contentPreferenceKeys.includes(preferenceKey)}
          palette={palette}
          onValueChange={(enabled) => setPreferenceEnabled(preferenceKey, enabled)}
        />
      ))}
      <ActionButton
        label="Reset Preferences"
        icon={RotateCcw}
        palette={palette}
        disabled={usesDefaultPreferences}
        onPress={() => onUpdateLibrary((current) => ({ ...current, contentPreferenceKeys: [...defaultContentPreferenceKeys] }))}
      />
    </View>
  );
}

function ComfortSettingsPanel({
  library,
  palette,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Comfort</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>Make the app easier on eyes and attention.</Text>
      </View>
      <SettingsSwitch
        label="Reduce Motion"
        value={library.reduceMotionEnabled}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, reduceMotionEnabled: value }))}
      />
      <SettingsSwitch
        label="Readable Text"
        value={library.readableTextEnabled}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, readableTextEnabled: value }))}
      />
    </View>
  );
}

function DataControlsPanel({
  palette,
  onUpdateLibrary
}: {
  palette: Palette;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  function confirmLocalChange(title: string, message: string, action: () => void) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: action }
    ]);
  }

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Data Controls</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>Keep what helps. Clear what feels noisy.</Text>
      </View>
      <View style={styles.dataControlActions}>
        <ActionButton
          label="Clear Watch History"
          icon={Trash2}
          palette={palette}
          destructive
          onPress={() =>
            confirmLocalChange('Clear watch history?', 'This removes local playback progress only.', () =>
              onUpdateLibrary((current) => ({ ...current, history: [] }))
            )
          }
        />
        <ActionButton
          label="Clear Search History"
          icon={Trash2}
          palette={palette}
          destructive
          onPress={() =>
            confirmLocalChange('Clear search history?', 'This removes recent searches stored on this device.', () =>
              onUpdateLibrary((current) => ({ ...current, recentSearches: [] }))
            )
          }
        />
        <ActionButton
          label="Clear Saved Lists"
          icon={Trash2}
          palette={palette}
          destructive
          onPress={() =>
            confirmLocalChange('Clear saved lists?', 'This removes watch later, favourites, and collections on this device.', () =>
              onUpdateLibrary((current) => ({
                ...current,
                watchLaterIds: [],
                favouriteIds: [],
                collections: current.collections.map((collection) => ({ ...collection, videoIds: [] }))
              }))
            )
          }
        />
      </View>
    </View>
  );
}

function SupportSnapshotPanel({
  snapshot,
  palette
}: {
  snapshot: SupportSnapshot;
  palette: Palette;
}) {
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Support Snapshot</Text>
          <Text style={[styles.metaText, { color: palette.subtle }]}>Version {appVersion}</Text>
        </View>
        <IconButton label="Share support snapshot" icon={Share2} palette={palette} onPress={() => shareSupportSnapshot(snapshot)} />
      </View>
      <View style={styles.diagnosticRows}>
        <DiagnosticRow label="API" value={snapshot.apiConfigured ? 'Configured' : 'Not configured'} palette={palette} />
        <DiagnosticRow label="Host" value={snapshot.apiHost} palette={palette} />
        <DiagnosticRow label="Startup" value={snapshot.startupStatus} palette={palette} />
        <DiagnosticRow label="Feed" value={snapshot.feedStatus} palette={palette} />
        <DiagnosticRow label="Playback" value={snapshot.playbackSource} palette={palette} />
        <DiagnosticRow label="Last error" value={snapshot.lastErrorCode} palette={palette} />
      </View>
    </View>
  );
}

function ProblemReportPanel({
  snapshot,
  palette
}: {
  snapshot: SupportSnapshot;
  palette: Palette;
}) {
  const [note, setNote] = useState('');

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Report a Problem</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>Add what happened in your words. Technical details stay safe.</Text>
      </View>
      <TextInput
        accessibilityLabel="Problem note"
        value={note}
        onChangeText={setNote}
        placeholder="What happened?"
        placeholderTextColor={palette.subtle}
        multiline
        textAlignVertical="top"
        style={[styles.problemInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.text }]}
      />
      <ActionButton
        label="Share Problem Report"
        icon={Share2}
        palette={palette}
        onPress={() => shareProblemReport(snapshot, note)}
      />
    </View>
  );
}

function DiagnosticRow({
  label,
  value,
  palette
}: {
  label: string;
  value: string;
  palette: Palette;
}) {
  return (
    <View style={[styles.diagnosticRow, { borderColor: palette.border }]}>
      <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.bodyText, styles.diagnosticValue, { color: palette.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function PersistentPlayer({
  session,
  command,
  repeatOne,
  palette,
  isFull,
  reducedMotion,
  fullHeight,
  screenWidth,
  onSetCommand,
  onCommandHandled,
  onReady,
  onProgress,
  onStateChange,
  onError,
  onClose,
  onMinimize,
  onRestore,
  onTogglePlay
}: {
  session: ActivePlaybackSession;
  command: PlayerCommand | null;
  repeatOne: boolean;
  palette: Palette;
  isFull: boolean;
  reducedMotion: boolean;
  fullHeight: number;
  screenWidth: number;
  onSetCommand: (command: PlayerCommand) => void;
  onCommandHandled: () => void;
  onReady: (videoId: string) => void;
  onProgress: (videoId: string, video: YouTubeVideo, position: number, duration: number) => void;
  onStateChange: (videoId: string, state: PlayerState, position: number, duration: number) => void;
  onError: (videoId: string, message: string) => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onTogglePlay: () => void;
}) {
  const descriptor = useMemo<PlaybackDescriptor>(() => resolvePlaybackDescriptor(session.video), [session.video]);
  const capabilities = useMemo<PlayerCapabilities>(
    () => capabilitiesForPlayback(descriptor, getPlaybackPlatformSupport()),
    [descriptor]
  );
  const canControlPlayer = descriptor.kind !== 'unavailable' && session.state !== 'idle' && session.state !== 'error';
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const gesture = useRef({
    mode: 'undecided' as PlayerGestureMode,
    startX: 0,
    startY: 0,
    scrubStart: 0,
    brightnessStart: 1,
    volumeStart: 100,
    pinchStartDistance: 0,
    pinchHandled: false,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressActive: false,
    lastScrubCommandAt: 0,
    lastVolumeCommandAt: 0
  });
  const lastTap = useRef({ time: 0, x: 0 });
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fitMode, setFitMode] = useState<PlayerFitMode>('fit');
  const [brightnessLevel, setBrightnessLevel] = useState(1);
  const [volumeLevel, setVolumeLevel] = useState(100);
  const [gestureLabel, setGestureLabel] = useState<string | null>(null);
  const [progressWidth, setProgressWidth] = useState(1);
  const playerWidth = Math.max(1, screenWidth - spacing.page * 2);
  const usesNativePlayer = descriptor.kind === 'native-direct';
  const presentationMode: PlayerPresentation = isFull ? 'expanded' : session.isMini ? 'mini' : 'sticky';
  const shouldKeepAwake = !usesNativePlayer && session.state !== 'ended' && session.state !== 'error';
  const dimOpacity = brightnessLevel < 1 ? clamp(1 - brightnessLevel, 0, 0.55) : 0;
  const boostOpacity = brightnessLevel > 1 ? clamp((brightnessLevel - 1) * 0.45, 0, 0.22) : 0;
  const progressRatio = session.durationSeconds > 0 ? clamp(session.currentTimeSeconds / session.durationSeconds, 0, 1) : 0;

  usePlaybackKeepAwake(shouldKeepAwake);

  useEffect(() => {
    logDevelopmentDiagnostic({
      operation: 'player',
      sourceKind: descriptor.kind,
      playerPhase: session.state,
      presentationMode
    });
  }, [descriptor.kind, presentationMode, session.state]);

  useEffect(() => {
    setControlsVisible(true);
    setGestureLabel(null);
    translate.setValue({ x: 0, y: 0 });
  }, [isFull, session.videoId, translate]);

  useEffect(
    () => () => {
      clearGestureTimers();
      if (gesture.current.longPressActive) {
        onSetCommand({ type: 'setPlaybackRate', rate: 1 });
      }
    },
    [onSetCommand]
  );

  function clearGestureTimers() {
    if (gesture.current.longPressTimer) {
      clearTimeout(gesture.current.longPressTimer);
      gesture.current.longPressTimer = null;
    }
    if (singleTapTimer.current) {
      clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
    }
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  }

  function clearFeedbackAfter(delay = 700) {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
    }
    feedbackTimer.current = setTimeout(() => {
      setGestureLabel(null);
      feedbackTimer.current = null;
    }, delay);
  }

  function animateTranslateTo(value: { x: number; y: number }, onComplete?: () => void) {
    if (reducedMotion) {
      translate.setValue(value);
      onComplete?.();
      return;
    }
    Animated.timing(translate, {
      toValue: value,
      duration: 180,
      useNativeDriver: true
    }).start(onComplete);
  }

  function springTranslateHome() {
    if (reducedMotion) {
      translate.setValue({ x: 0, y: 0 });
      return;
    }
    Animated.spring(translate, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: true
    }).start();
  }

  function startLongPressTimer() {
    if (!canControlPlayer) {
      return;
    }
    gesture.current.longPressTimer = setTimeout(() => {
      gesture.current.longPressActive = true;
      onSetCommand({ type: 'setPlaybackRate', rate: 2 });
      setGestureLabel('2x speed');
      impactFeedback(Haptics.ImpactFeedbackStyle.Medium);
    }, 450);
  }

  function stopLongPressIfNeeded() {
    if (gesture.current.longPressActive) {
      gesture.current.longPressActive = false;
      onSetCommand({ type: 'setPlaybackRate', rate: 1 });
      setGestureLabel('1x speed');
      impactFeedback();
      clearFeedbackAfter(450);
    }
  }

  function handleTap(event: GestureResponderEvent) {
    if (!isFull) {
      onRestore();
      return;
    }
    const now = Date.now();
    const x = event.nativeEvent.locationX;
    const previousTap = lastTap.current;
    if (now - previousTap.time <= 280 && Math.abs(x - previousTap.x) < 80) {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      lastTap.current = { time: 0, x: 0 };
      if (x < playerWidth / 2) {
        onSetCommand('seekBackward10');
        setGestureLabel('-10s');
      } else {
        onSetCommand('seekForward10');
        setGestureLabel('+10s');
      }
      impactFeedback(Haptics.ImpactFeedbackStyle.Medium);
      clearFeedbackAfter();
      return;
    }
    lastTap.current = { time: now, x };
    singleTapTimer.current = setTimeout(() => {
      setControlsVisible((visible) => !visible);
      touchFeedback();
      singleTapTimer.current = null;
    }, 220);
  }

  function touchDistance(event: GestureResponderEvent): number | null {
    const touches = event.nativeEvent.touches;
    if (touches.length < 2) {
      return null;
    }
    const [first, second] = touches;
    return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
  }

  function maybeCancelLongPress(gestureState: PanResponderGestureState) {
    if (Math.abs(gestureState.dx) > 8 || Math.abs(gestureState.dy) > 8 || gesture.current.mode !== 'undecided') {
      if (gesture.current.longPressTimer) {
        clearTimeout(gesture.current.longPressTimer);
        gesture.current.longPressTimer = null;
      }
    }
  }

  function resolveFullGestureMode(gestureState: PanResponderGestureState): PlayerGestureMode {
    const absX = Math.abs(gestureState.dx);
    const absY = Math.abs(gestureState.dy);
    if (gestureState.dy > 72 && absX < 60) {
      return 'minimize';
    }
    if (absX > 10 && absX > absY * 1.2) {
      return 'scrub';
    }
    if (absY > 10) {
      return gesture.current.startX < playerWidth / 2 ? 'brightness' : 'volume';
    }
    return 'undecided';
  }

  function scrubTarget(gestureState: PanResponderGestureState): number {
    const duration = session.durationSeconds > 0 ? session.durationSeconds : Math.max(session.currentTimeSeconds + 60, 60);
    const range = Math.max(30, duration * 0.25);
    return clamp(gesture.current.scrubStart + (gestureState.dx / playerWidth) * range, 0, duration);
  }

  function updateScrub(gestureState: PanResponderGestureState, force = false) {
    const target = scrubTarget(gestureState);
    setGestureLabel(formatDuration(target));
    const now = Date.now();
    if (force || now - gesture.current.lastScrubCommandAt > 160) {
      gesture.current.lastScrubCommandAt = now;
      onSetCommand({ type: 'seekTo', seconds: target });
    }
  }

  function updateVolume(nextVolume: number, force = false) {
    const rounded = Math.round(nextVolume);
    setVolumeLevel(rounded);
    setGestureLabel(`Volume ${rounded}%`);
    const now = Date.now();
    if (force || now - gesture.current.lastVolumeCommandAt > 120) {
      gesture.current.lastVolumeCommandAt = now;
      onSetCommand({ type: 'setVolume', volume: rounded });
    }
  }

  function handleProgressPress(event: GestureResponderEvent) {
    if (!canControlPlayer || session.durationSeconds <= 0) {
      return;
    }
    const ratio = clamp(event.nativeEvent.locationX / Math.max(1, progressWidth), 0, 1);
    onSetCommand({ type: 'seekTo', seconds: ratio * session.durationSeconds });
    impactFeedback();
  }

  function toggleFitMode() {
    const nextMode: PlayerFitMode = fitMode === 'fit' ? 'fill' : 'fit';
    setFitMode(nextMode);
    setGestureLabel(nextMode === 'fill' ? 'Fill' : 'Fit');
    impactFeedback();
    clearFeedbackAfter();
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => isFull,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          isFull
            ? Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4
            : Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.15,
        onPanResponderGrant: (event) => {
          translate.stopAnimation();
          const distance = touchDistance(event);
          gesture.current.mode = distance ? 'pinch' : 'undecided';
          gesture.current.startX = event.nativeEvent.locationX;
          gesture.current.startY = event.nativeEvent.locationY;
          gesture.current.scrubStart = session.currentTimeSeconds;
          gesture.current.brightnessStart = brightnessLevel;
          gesture.current.volumeStart = volumeLevel;
          gesture.current.pinchStartDistance = distance ?? 0;
          gesture.current.pinchHandled = false;
          gesture.current.longPressActive = false;
          gesture.current.lastScrubCommandAt = 0;
          gesture.current.lastVolumeCommandAt = 0;
          if (!distance && isFull) {
            startLongPressTimer();
          }
        },
        onPanResponderMove: (event, gestureState) => {
          maybeCancelLongPress(gestureState);
          const distance = touchDistance(event);
          if (isFull && distance && gesture.current.pinchStartDistance > 0) {
            gesture.current.mode = 'pinch';
            const ratio = distance / gesture.current.pinchStartDistance;
            if (!gesture.current.pinchHandled && Math.abs(ratio - 1) > 0.12) {
              const nextMode: PlayerFitMode = ratio > 1 ? 'fill' : 'fit';
              setFitMode(nextMode);
              setGestureLabel(nextMode === 'fill' ? 'Fill' : 'Fit');
              gesture.current.pinchHandled = true;
              impactFeedback();
              clearFeedbackAfter();
            }
            return;
          }
          if (!isFull) {
            gesture.current.mode = 'dismiss';
            translate.setValue({ x: gestureState.dx, y: 0 });
            setGestureLabel('Release to close');
            return;
          }
          const nextMode = resolveFullGestureMode(gestureState);
          if (nextMode !== 'undecided') {
            gesture.current.mode = nextMode;
          }
          if (gesture.current.mode === 'minimize') {
            translate.setValue({ x: 0, y: Math.max(0, gestureState.dy) });
            setGestureLabel('Mini player');
            return;
          }
          if (gesture.current.mode === 'scrub') {
            updateScrub(gestureState);
            return;
          }
          if (gesture.current.mode === 'brightness') {
            const nextBrightness = clamp(gesture.current.brightnessStart - gestureState.dy / fullHeight, 0.35, 1.35);
            setBrightnessLevel(nextBrightness);
            setGestureLabel(`Brightness ${Math.round(nextBrightness * 100)}%`);
            return;
          }
          if (gesture.current.mode === 'volume') {
            const nextVolume = clamp(gesture.current.volumeStart - (gestureState.dy / fullHeight) * 120, 0, 100);
            updateVolume(nextVolume);
          }
        },
        onPanResponderRelease: (event, gestureState) => {
          if (gesture.current.longPressTimer) {
            clearTimeout(gesture.current.longPressTimer);
            gesture.current.longPressTimer = null;
          }
          if (gesture.current.longPressActive) {
            stopLongPressIfNeeded();
            return;
          }
          if (!isFull) {
            if (Math.abs(gestureState.dx) > screenWidth * 0.24 || Math.abs(gestureState.vx) > 1.15) {
              const direction = gestureState.dx >= 0 ? 1 : -1;
              impactFeedback(Haptics.ImpactFeedbackStyle.Medium);
              animateTranslateTo({ x: direction * screenWidth, y: 0 }, () => {
                translate.setValue({ x: 0, y: 0 });
                onClose();
              });
            } else {
              springTranslateHome();
              setGestureLabel(null);
            }
            return;
          }
          if (gesture.current.mode === 'minimize') {
            if (gestureState.dy > 72) {
              impactFeedback(Haptics.ImpactFeedbackStyle.Medium);
              animateTranslateTo({ x: 0, y: fullHeight + 40 }, () => {
                translate.setValue({ x: 0, y: 0 });
                setGestureLabel(null);
                onMinimize();
              });
            } else {
              springTranslateHome();
              setGestureLabel(null);
            }
            return;
          }
          if (gesture.current.mode === 'scrub') {
            updateScrub(gestureState, true);
            impactFeedback();
            clearFeedbackAfter();
            return;
          }
          if (gesture.current.mode === 'volume') {
            updateVolume(clamp(gesture.current.volumeStart - (gestureState.dy / fullHeight) * 120, 0, 100), true);
            impactFeedback();
            clearFeedbackAfter();
            return;
          }
          if (gesture.current.mode === 'brightness') {
            impactFeedback();
            clearFeedbackAfter();
            return;
          }
          if (gesture.current.mode === 'pinch') {
            clearFeedbackAfter();
            return;
          }
          handleTap(event);
        },
        onPanResponderTerminate: () => {
          if (gesture.current.longPressTimer) {
            clearTimeout(gesture.current.longPressTimer);
            gesture.current.longPressTimer = null;
          }
          stopLongPressIfNeeded();
          springTranslateHome();
          setGestureLabel(null);
        }
      }),
    [
      brightnessLevel,
      canControlPlayer,
      fitMode,
      fullHeight,
      isFull,
      onClose,
      onMinimize,
      onRestore,
      onSetCommand,
      playerWidth,
      reducedMotion,
      screenWidth,
      session.currentTimeSeconds,
      session.durationSeconds,
      translate,
      volumeLevel
    ]
  );

  return (
    <Animated.View
      {...(!isFull ? panResponder.panHandlers : {})}
      style={[
        styles.persistentPlayer,
        isFull
          ? [styles.fullPlayer, { height: fullHeight, backgroundColor: palette.ink }]
          : [styles.miniPlayer, { backgroundColor: palette.surface, borderColor: palette.border }],
        { transform: translate.getTranslateTransform() }
      ]}
    >
      <View style={isFull ? styles.fullPlayerBody : styles.miniVideo}>
        <Animated.View style={[styles.playerMedia, fitMode === 'fill' ? styles.playerMediaFill : null]}>
          {descriptor.kind === 'native-direct' ? (
            <NativeVideoPlayer
              key={`native:${session.videoId}:${session.video.playbackUrl}`}
              video={session.video}
              source={descriptor.source}
              command={command}
              repeatOne={repeatOne}
              shouldAutoPlay={session.playbackIntent === 'play' && session.state !== 'ended'}
              onCommandHandled={onCommandHandled}
              onReady={() => onReady(session.videoId)}
              onProgress={(position, duration) => onProgress(session.videoId, session.video, position, duration)}
              onStateChange={(state, position, duration) => onStateChange(session.videoId, state, position, duration)}
              onError={(message) => onError(session.videoId, message)}
            />
          ) : descriptor.kind === 'youtube-embed' ? (
            <YouTubePlayer
              key={`youtube:${session.videoId}`}
              videoId={descriptor.videoId}
              command={command}
              repeatOne={repeatOne}
              onCommandHandled={onCommandHandled}
              onReady={() => onReady(session.videoId)}
              onProgress={(position, duration) => onProgress(session.videoId, session.video, position, duration)}
              onStateChange={(state, position, duration) => onStateChange(session.videoId, state, position, duration)}
              onError={(message) => onError(session.videoId, message)}
            />
          ) : (
            <View style={[styles.unavailablePlayer, { backgroundColor: palette.ink }]}>
              <Text style={styles.playerChromeText}>{playbackUnavailableMessage(descriptor)}</Text>
            </View>
          )}
        </Animated.View>
        {dimOpacity ? <View pointerEvents="none" style={[styles.videoBrightnessOverlay, { backgroundColor: '#000000', opacity: dimOpacity }]} /> : null}
        {boostOpacity ? <View pointerEvents="none" style={[styles.videoBrightnessOverlay, { backgroundColor: '#FFFFFF', opacity: boostOpacity }]} /> : null}
        {isFull ? <View style={styles.playerGestureLayer} {...panResponder.panHandlers} /> : <Pressable accessibilityLabel="Restore player" style={styles.playerGestureLayer} onPress={onRestore} />}
        {isFull && controlsVisible ? (
          <View pointerEvents="box-none" style={styles.playerChrome}>
            <View style={styles.playerChromeTop}>
              <PlayerChromeButton label="Mini player" icon={ChevronDown} onPress={onMinimize} />
              <Text style={styles.playerChromeTitle} numberOfLines={1}>
                {session.video.title}
              </Text>
              <View style={styles.playerChromeTopActions}>
                <PlayerChromeButton label={fitMode === 'fit' ? 'Fill video' : 'Fit video'} icon={Maximize2} onPress={toggleFitMode} />
                {capabilities.airPlay ? (
                  <View accessibilityLabel="Choose AirPlay video route" style={styles.playerAirPlayButton}>
                    <VideoAirPlayButton tint="#FFFFFF" activeTint={palette.accent} prioritizeVideoDevices />
                  </View>
                ) : null}
                <PlayerChromeButton label="Close player" icon={X} onPress={onClose} />
              </View>
            </View>
            <View style={styles.playerChromeCenter}>
              <PlayerChromeButton label="Back 10 seconds" icon={SkipBack} disabled={!canControlPlayer} large onPress={() => onSetCommand('seekBackward10')} />
              <PlayerChromeButton
                label={session.state === 'playing' ? 'Pause' : 'Play'}
                icon={session.state === 'playing' ? Pause : Play}
                disabled={!canControlPlayer}
                prominent
                large
                onPress={onTogglePlay}
              />
              <PlayerChromeButton label="Forward 10 seconds" icon={SkipForward} disabled={!canControlPlayer} large onPress={() => onSetCommand('seekForward10')} />
            </View>
            <View style={styles.playerChromeBottom}>
              <View style={styles.playerTimeRow}>
                <Text style={styles.playerChromeText}>{formatDuration(session.currentTimeSeconds)}</Text>
                <Text style={styles.playerChromeText}>{formatDuration(session.durationSeconds)}</Text>
              </View>
              <Pressable
                accessibilityRole="adjustable"
                accessibilityLabel="Seek video"
                disabled={!canControlPlayer || session.durationSeconds <= 0}
                style={styles.playerProgressRail}
                onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
                onPress={handleProgressPress}
              >
                <View style={[styles.playerProgressFill, { width: `${progressRatio * 100}%` }]} />
              </Pressable>
            </View>
          </View>
        ) : null}
        {gestureLabel ? (
          <View pointerEvents="none" style={styles.gesturePill}>
            <Text style={styles.gesturePillText}>{gestureLabel}</Text>
          </View>
        ) : null}
      </View>
      {!isFull ? (
        <Pressable style={styles.miniMeta} onPress={onRestore}>
          <Text style={[styles.miniTitle, { color: palette.text }]} numberOfLines={1}>
            {session.video.title}
          </Text>
          <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
            {session.state}
          </Text>
        </Pressable>
      ) : null}
      {!isFull ? (
        <View style={styles.miniControls}>
          <IconButton label="Play or pause" icon={session.state === 'playing' ? Pause : Play} palette={palette} disabled={!canControlPlayer} onPress={onTogglePlay} />
          <IconButton label="Close player" icon={X} palette={palette} onPress={onClose} />
        </View>
      ) : null}
    </Animated.View>
  );
}

function PlayerChromeButton({
  label,
  icon: Icon,
  disabled = false,
  prominent = false,
  large = false,
  onPress
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  prominent?: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      style={[
        styles.playerChromeButton,
        large ? styles.playerChromeButtonLarge : null,
        prominent ? styles.playerChromeButtonProminent : null,
        disabled ? styles.playerChromeButtonDisabled : null
      ]}
      onPress={() => {
        touchFeedback();
        onPress();
      }}
    >
      <Icon color="#FFFFFF" size={large ? 24 : 19} strokeWidth={2.5} />
    </Pressable>
  );
}

function SearchResultCard({
  result,
  library,
  palette,
  onSelectVideo,
  onAddFavourite,
  onAddWatchLater,
  onPlayNext,
  onAddToQueue
}: {
  result: YouTubeSearchResult;
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
}) {
  if (result.kind === 'video') {
    return (
      <VideoCard
        video={result}
        library={library}
        palette={palette}
        onSelectVideo={onSelectVideo}
        onAddFavourite={onAddFavourite}
        onAddWatchLater={onAddWatchLater}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        wide
      />
    );
  }
  return (
    <Pressable
      style={[styles.resultCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
      onPress={() => void Linking.openURL(result.canonicalUrl)}
    >
      {result.thumbnailUrl ? <Image source={{ uri: result.thumbnailUrl }} style={styles.resultThumb} /> : null}
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
          {result.title}
        </Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>{result.kind === 'channel' ? 'Channel' : `Playlist · ${result.channelName}`}</Text>
        <Text style={[styles.metaText, { color: palette.mutedText }]} numberOfLines={2}>
          {result.description}
        </Text>
      </View>
    </Pressable>
  );
}

function SpotlightCard({ video, palette, onPress }: { video: YouTubeVideo; palette: Palette; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play ${video.title}`} style={[styles.spotlight, { backgroundColor: palette.surface, borderColor: palette.border }]} onPress={onPress}>
      <VideoThumbnail video={video} palette={palette} />
      <View style={styles.spotlightBody}>
        <Text style={[styles.kicker, { color: palette.accent }]}>Spotlight</Text>
        <Text style={[styles.videoTitle, { color: palette.text }]} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
          {video.channelName} · {formatViews(video.viewCount)}
        </Text>
      </View>
    </Pressable>
  );
}

function VideoRail({
  title,
  videos,
  library,
  palette,
  onSelectVideo,
  onAddFavourite,
  onAddWatchLater,
  onPlayNext,
  onAddToQueue,
  vertical = false
}: {
  title: string;
  videos: YouTubeVideo[];
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
  vertical?: boolean;
}) {
  if (!videos.length) {
    return null;
  }
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      </View>
      {vertical ? (
        <View style={styles.verticalList}>
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              library={library}
              palette={palette}
              onSelectVideo={onSelectVideo}
              onAddFavourite={onAddFavourite}
              onAddWatchLater={onAddWatchLater}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
              wide
            />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.railContent}>
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                library={library}
                palette={palette}
                onSelectVideo={onSelectVideo}
                onAddFavourite={onAddFavourite}
                onAddWatchLater={onAddWatchLater}
                onPlayNext={onPlayNext}
                onAddToQueue={onAddToQueue}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function VideoCard({
  video,
  library,
  palette,
  onSelectVideo,
  onAddFavourite,
  onAddWatchLater,
  onPlayNext,
  onAddToQueue,
  queued = false,
  current = false,
  wide = false
}: {
  video: YouTubeVideo;
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onAddFavourite: (video: YouTubeVideo) => void;
  onAddWatchLater: (video: YouTubeVideo) => void;
  onPlayNext: (video: YouTubeVideo) => void;
  onAddToQueue: (video: YouTubeVideo) => void;
  queued?: boolean;
  current?: boolean;
  wide?: boolean;
}) {
  const progress = library.history.find((item) => item.videoId === video.id);
  return (
    <View style={[styles.card, wide ? styles.wideCard : styles.railCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${video.title}`} onPress={() => onSelectVideo(video)}>
        <VideoThumbnail video={video} palette={palette} progress={progress} />
      </Pressable>
      <View style={styles.cardBody}>
        <View style={[styles.avatar, { backgroundColor: palette.accentSoft }]}>
          <Text style={[styles.avatarText, { color: palette.accent }]}>{video.channelName.slice(0, 1) || 'Y'}</Text>
        </View>
        <View style={styles.cardText}>
          {current ? (
            <Text style={[styles.nowPlayingText, { color: palette.accent }]} numberOfLines={1}>
              Now playing
            </Text>
          ) : null}
          {!current && queued ? (
            <Text style={[styles.nowPlayingText, { color: palette.accent }]} numberOfLines={1}>
              In queue
            </Text>
          ) : null}
          <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
            {video.title}
          </Text>
          <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
            {video.channelName}
          </Text>
          {!library.focusMode ? (
            <Text style={[styles.metaText, { color: palette.subtle }]} numberOfLines={1}>
              {formatViews(video.viewCount)} · {formatPublishedDate(video.publishedAt)}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${video.title}`}
          hitSlop={8}
          style={styles.moreButton}
          onPress={() =>
            Alert.alert(video.title, undefined, [
              { text: 'Play Next', onPress: () => onPlayNext(video) },
              { text: queued ? 'Move to Queue End' : 'Add to Queue', onPress: () => onAddToQueue(video) },
              { text: 'Watch Later', onPress: () => onAddWatchLater(video) },
              { text: 'Favourite', onPress: () => onAddFavourite(video) },
              { text: videoSourceActionLabel(video), onPress: () => void Linking.openURL(video.canonicalUrl) },
              { text: 'Share URL', onPress: () => void Share.share({ message: video.canonicalUrl, url: video.canonicalUrl }) },
              { text: 'Cancel', style: 'cancel' }
            ])
          }
        >
          <Text style={[styles.moreText, { color: palette.subtle }]}>...</Text>
        </Pressable>
      </View>
    </View>
  );
}

function VideoThumbnail({ video, palette, progress }: { video: YouTubeVideo; palette: Palette; progress?: WatchProgress }) {
  const percentage = progress?.progressPercent ?? 0;
  return (
    <View style={[styles.thumbnail, { backgroundColor: palette.ink }]}>
      {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={styles.thumbnailImage} resizeMode="cover" /> : null}
      <View style={styles.badgeRow}>
        {video.liveStatus === 'live' ? <Text style={styles.liveBadge}>Live</Text> : <Text style={styles.durationBadge}>{formatDuration(video.durationSeconds)}</Text>}
        <Text style={hasNativePlaybackSource(video) ? styles.lockBadge : styles.embedBadge}>{videoSourceBadge(video)}</Text>
        {percentage >= 0.9 ? <Text style={styles.watchedBadge}>Watched</Text> : null}
      </View>
      {percentage > 0 && percentage < 0.9 ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(Math.max(percentage, 0), 1) * 100}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

function FocusPanel({
  library,
  palette,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  const [minutes, setMinutes] = useState(15);
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <SettingsSwitch
        label="Focus Mode"
        value={library.focusMode}
        palette={palette}
        onValueChange={(value) =>
          onUpdateLibrary((current) => ({ ...current, focusMode: value, autoplayEnabled: value ? false : current.autoplayEnabled }))
        }
      />
      <SegmentedControl
        label="Session"
        value={String(minutes)}
        options={[
          ['15', '15'],
          ['30', '30'],
          ['60', '60']
        ]}
        palette={palette}
        onChange={(value) => setMinutes(Number(value))}
      />
      <Text style={[styles.metaText, { color: palette.subtle }]}>Break reminder: {minutes} min</Text>
    </View>
  );
}

function VideoListBlock({
  title,
  videos,
  palette,
  actionLabel,
  actionIcon,
  actionDisabled = false,
  onAction,
  onSelectVideo
}: {
  title: string;
  videos: YouTubeVideo[];
  palette: Palette;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  actionDisabled?: boolean;
  onAction?: () => void;
  onSelectVideo: (video: YouTubeVideo) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
        {onAction ? (
          <IconButton
            label={actionLabel ?? `Clear ${title}`}
            icon={actionIcon ?? Trash2}
            palette={palette}
            disabled={actionDisabled}
            onPress={onAction}
          />
        ) : null}
      </View>
      {videos.length ? (
        videos.map((video) => (
          <Pressable key={video.id} style={[styles.libraryRow, { borderColor: palette.border }]} onPress={() => onSelectVideo(video)}>
            {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={styles.libraryThumb} /> : null}
            <View style={styles.libraryText}>
              <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
                {video.title}
              </Text>
              <Text style={[styles.metaText, { color: palette.subtle }]}>{video.channelName}</Text>
            </View>
          </Pressable>
        ))
      ) : (
        <EmptyState title="Nothing saved" palette={palette} />
      )}
    </View>
  );
}

function CollectionCard({
  collection,
  videoById,
  palette,
  onSelectVideo,
  onClear,
  onDelete
}: {
  collection: Collection;
  videoById: Record<string, YouTubeVideo>;
  palette: Palette;
  onSelectVideo: (video: YouTubeVideo) => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const videos = collection.videoIds.map((id) => videoById[id]).filter((video): video is YouTubeVideo => Boolean(video));
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.cardTitle, { color: palette.text }]}>{collection.name}</Text>
          <Text style={[styles.metaText, { color: palette.subtle }]}>{collection.videoIds.length} videos</Text>
        </View>
        <View style={styles.collectionActions}>
          <IconButton label="Clear collection videos" icon={RotateCcw} palette={palette} disabled={collection.videoIds.length === 0} onPress={onClear} />
          <IconButton label="Delete collection" icon={Trash2} palette={palette} onPress={onDelete} />
        </View>
      </View>
      {videos.length ? (
        videos.map((video) => (
          <Pressable key={video.id} onPress={() => onSelectVideo(video)} style={styles.collectionVideo}>
            <Text style={[styles.bodyText, { color: palette.text }]} numberOfLines={1}>
              {video.title}
            </Text>
          </Pressable>
        ))
      ) : (
        <EmptyState title="No current videos in this collection" palette={palette} />
      )}
    </View>
  );
}

function SettingsSwitch({
  label,
  value,
  disabled,
  palette,
  onValueChange
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  palette: Palette;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.switchRow, { borderColor: palette.border, opacity: disabled ? 0.55 : 1 }]}>
      <Text style={[styles.bodyText, { color: palette.text }]}>{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ true: palette.accentSoft }} thumbColor={value ? palette.accent : palette.subtle} />
    </View>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  palette,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  palette: Palette;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmentGroup}>
      <Text style={[styles.segmentLabel, { color: palette.subtle }]}>{label}</Text>
      <View style={[styles.segmentWrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {options.map(([key, text]) => {
          const selected = value === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.segment, selected ? { backgroundColor: palette.accent } : null]}
              onPress={() => onChange(key)}
            >
              <Text style={[styles.segmentText, { color: selected ? palette.onAccent : palette.text }]} numberOfLines={1}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IconButton({
  label,
  icon,
  palette,
  disabled = false,
  selected = false,
  onPress
}: {
  label: string;
  icon: string | LucideIcon;
  palette: Palette;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const Icon = typeof icon === 'string' ? null : icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={8}
      style={[
        styles.iconButton,
        {
          backgroundColor: selected ? palette.accent : palette.surface,
          borderColor: selected ? palette.accent : palette.border,
          opacity: disabled ? 0.45 : 1
        }
      ]}
      onPress={() => {
        touchFeedback();
        onPress();
      }}
    >
      {Icon ? (
        <Icon color={selected ? palette.onAccent : palette.text} size={20} strokeWidth={2.4} />
      ) : (
        <Text style={[styles.iconText, { color: selected ? palette.onAccent : palette.text }]} numberOfLines={1}>
          {String(icon)}
        </Text>
      )}
    </Pressable>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  destructive,
  disabled = false,
  onPress
}: {
  label: string;
  icon?: LucideIcon;
  palette: Palette;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = icon;
  const color = destructive ? palette.danger : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[
        styles.actionButton,
        {
          backgroundColor: destructive ? palette.dangerSoft : palette.surface,
          borderColor: destructive ? palette.danger : palette.border,
          opacity: disabled ? 0.5 : 1
        }
      ]}
      onPress={() => {
        touchFeedback();
        onPress();
      }}
    >
      {Icon ? <Icon color={color} size={18} strokeWidth={2.3} /> : null}
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function QuickToolGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.quickToolGrid}>{children}</View>;
}

function ToolButton({
  label,
  icon: Icon,
  palette,
  onPress
}: {
  label: string;
  icon: LucideIcon;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.toolButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
      onPress={() => {
        touchFeedback();
        onPress();
      }}
    >
      <View style={[styles.toolIconBubble, { backgroundColor: palette.accentSoft }]}>
        <Icon color={palette.accent} size={21} strokeWidth={2.4} />
      </View>
      <Text style={[styles.toolLabel, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  text,
  palette,
  onPress
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  palette: Palette;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.infoPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}
      onPress={
        onPress
          ? () => {
              touchFeedback();
              onPress();
            }
          : undefined
      }
    >
      <View style={[styles.infoIcon, { backgroundColor: palette.accentSoft }]}>
        <Icon color={palette.accent} size={22} strokeWidth={2.4} />
      </View>
      <View style={styles.infoText}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.metaText, { color: palette.mutedText }]}>{text}</Text>
      </View>
    </Pressable>
  );
}

function InlineState({
  title,
  palette,
  actionLabel,
  disabled,
  onPress
}: {
  title: string;
  palette: Palette;
  actionLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={[styles.inlineState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.metaText, styles.inlineStateText, { color: palette.subtle }]}>{title}</Text>
      {actionLabel && onPress ? <ActionButton label={actionLabel} palette={palette} disabled={disabled} onPress={onPress} /> : null}
    </View>
  );
}

function HomeSkeleton({ palette }: { palette: Palette }) {
  return (
    <>
      <View style={styles.section}>
        <View style={[styles.skeletonTitle, { backgroundColor: palette.border }]} />
        <View style={[styles.skeletonSpotlight, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.skeletonBlock, { backgroundColor: palette.border }]} />
          <View style={[styles.skeletonLineWide, { backgroundColor: palette.border }]} />
          <View style={[styles.skeletonLine, { backgroundColor: palette.border }]} />
        </View>
      </View>
      <View style={styles.section}>
        <View style={[styles.skeletonTitle, { backgroundColor: palette.border }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
          {[0, 1, 2].map((item) => (
            <SkeletonVideoCard key={item} palette={palette} />
          ))}
        </ScrollView>
      </View>
    </>
  );
}

function SuggestionSkeletonList({ palette }: { palette: Palette }) {
  return (
    <View style={styles.verticalList}>
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <SkeletonVideoCard key={item} palette={palette} wide />
      ))}
    </View>
  );
}

function SkeletonVideoCard({ palette, wide = false }: { palette: Palette; wide?: boolean }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading video"
      style={[styles.card, wide ? styles.wideCard : styles.railCard, styles.skeletonCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <View style={[styles.skeletonThumb, { backgroundColor: palette.border }]} />
      <View style={styles.skeletonBody}>
        <View style={[styles.skeletonLineWide, { backgroundColor: palette.border }]} />
        <View style={[styles.skeletonLine, { backgroundColor: palette.border }]} />
      </View>
    </View>
  );
}

function LoadingState({ title, palette }: { title: string; palette: Palette }) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.bodyText, { color: palette.subtle }]}>{title}</Text>
    </View>
  );
}

function EmptyState({ title, palette }: { title: string; palette: Palette }) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.bodyText, { color: palette.subtle }]}>{title}</Text>
    </View>
  );
}

function ErrorState({
  error,
  palette,
  disabled,
  onRetry
}: {
  error: YouTubeApiError;
  palette: Palette;
  disabled?: boolean;
  onRetry: () => void;
}) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(error.message);
  }, [error.message]);

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.inlineState, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}
    >
      <Text style={[styles.bodyText, { color: palette.danger }]}>{error.message}</Text>
      {error.retryable ? <ActionButton label={disabled ? 'Retrying' : 'Retry'} palette={palette} disabled={disabled} onPress={onRetry} /> : null}
    </View>
  );
}

function TabBar({ activeTab, palette, onChange }: { activeTab: TabKey; palette: Palette; onChange: (tab: TabKey) => void }) {
  return (
    <View style={[styles.tabBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={styles.tabItem}
            onPress={() => {
              touchFeedback();
              onChange(tab.key);
            }}
          >
            <View style={[styles.tabIconWrap, selected ? { backgroundColor: palette.accentSoft } : null]}>
              <Icon color={selected ? palette.accent : palette.subtle} size={22} strokeWidth={2.4} />
            </View>
            <Text style={[styles.tabLabel, { color: selected ? palette.accent : palette.subtle }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  appFrame: {
    flex: 1
  },
  screen: {
    flex: 1
  },
  scrollContent: {
    gap: 18,
    paddingBottom: 126,
    paddingHorizontal: spacing.page,
    paddingTop: 12
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  kicker: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0
  },
  searchField: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 14
  },
  inputWrap: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 54,
    paddingLeft: 14
  },
  searchPlaceholder: {
    fontSize: 16,
    fontWeight: '600'
  },
  input: {
    flex: 1,
    fontSize: 16,
    minHeight: 54
  },
  problemInput: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 104,
    padding: 12
  },
  spotlight: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  spotlightBody: {
    gap: 6,
    padding: 14
  },
  thumbnail: {
    aspectRatio: 16 / 9,
    borderRadius: 8,
    minHeight: 150,
    overflow: 'hidden'
  },
  thumbnailImage: {
    height: '100%',
    width: '100%'
  },
  badgeRow: {
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 8,
    position: 'absolute',
    right: 8
  },
  durationBadge: {
    backgroundColor: 'rgba(0,0,0,0.74)',
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  liveBadge: {
    backgroundColor: '#C91F37',
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  lockBadge: {
    backgroundColor: '#0A665E',
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  embedBadge: {
    backgroundColor: '#D98A24',
    borderRadius: 4,
    color: '#101616',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  watchedBadge: {
    backgroundColor: '#0A665E',
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    bottom: 0,
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0
  },
  progressFill: {
    backgroundColor: '#D98A24',
    height: 4
  },
  section: {
    gap: 12
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  diagnosticRows: {
    gap: 2
  },
  diagnosticRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 42,
    justifyContent: 'space-between',
    paddingVertical: 8
  },
  diagnosticValue: {
    flex: 1,
    textAlign: 'right'
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  searchChip: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  searchChipText: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18
  },
  dataControlActions: {
    gap: 10
  },
  quickToolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  toolButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: '22%',
    flexGrow: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 92,
    minWidth: 76,
    paddingHorizontal: 8,
    paddingVertical: 12
  },
  toolIconBubble: {
    alignItems: 'center',
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  toolLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 16,
    textAlign: 'center'
  },
  infoPanel: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 86,
    padding: 14
  },
  infoIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  infoText: {
    flex: 1,
    gap: 4
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0
  },
  railContent: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 8
  },
  verticalList: {
    gap: 12
  },
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  railCard: {
    width: 268
  },
  wideCard: {
    width: '100%'
  },
  cardBody: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    padding: 10
  },
  resultCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    padding: 10
  },
  resultThumb: {
    borderRadius: 8,
    height: 76,
    width: 76
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800'
  },
  cardText: {
    flex: 1,
    gap: 3
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 20
  },
  nowPlayingText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 16,
    textTransform: 'uppercase'
  },
  videoTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 28
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18
  },
  bodyText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22
  },
  description: {
    fontSize: 15,
    lineHeight: 22
  },
  moreButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  moreText: {
    fontSize: 16,
    fontWeight: '900'
  },
  persistentPlayer: {
    overflow: 'hidden',
    position: 'absolute',
    zIndex: 5
  },
  fullPlayer: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    left: spacing.page,
    right: spacing.page,
    top: 8
  },
  fullPlayerBody: {
    flex: 1
  },
  playerMedia: {
    flex: 1
  },
  playerMediaFill: {
    transform: [{ scale: 1.14 }]
  },
  videoBrightnessOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  playerGestureLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  playerChrome: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    bottom: 0,
    justifyContent: 'space-between',
    left: 0,
    padding: 12,
    position: 'absolute',
    right: 0,
    top: 0
  },
  playerChromeTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  playerChromeTopActions: {
    flexDirection: 'row',
    gap: 8
  },
  playerChromeTitle: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18
  },
  playerChromeCenter: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 18
  },
  playerChromeBottom: {
    gap: 7
  },
  playerTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  playerChromeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  },
  playerChromeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  playerChromeButtonLarge: {
    height: 48,
    width: 48
  },
  playerChromeButtonProminent: {
    backgroundColor: 'rgba(217,138,36,0.95)',
    height: 58,
    width: 58
  },
  playerChromeButtonDisabled: {
    opacity: 0.45
  },
  playerAirPlayButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  playerProgressRail: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderRadius: 6,
    height: 8,
    overflow: 'hidden'
  },
  playerProgressFill: {
    backgroundColor: '#D98A24',
    borderRadius: 6,
    height: 8
  },
  gesturePill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    left: '35%',
    minHeight: 38,
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: 'absolute',
    right: '35%',
    top: '43%'
  },
  gesturePillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center'
  },
  miniPlayer: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 78,
    flexDirection: 'row',
    gap: 10,
    height: 86,
    left: spacing.page,
    padding: 8,
    right: spacing.page
  },
  miniVideo: {
    borderRadius: 6,
    height: 68,
    overflow: 'hidden',
    width: 122
  },
  miniMeta: {
    flex: 1
  },
  miniTitle: {
    fontSize: 14,
    fontWeight: '800'
  },
  miniControls: {
    flexDirection: 'row',
    gap: 6
  },
  unavailablePlayer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16
  },
  notice: {
    borderRadius: 8,
    padding: 12
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10
  },
  iconText: {
    fontSize: 12,
    fontWeight: '900'
  },
  metadataBlock: {
    gap: 8
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14
  },
  actionText: {
    fontSize: 15,
    fontWeight: '800'
  },
  inlineState: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  inlineStateText: {
    flex: 1
  },
  panel: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 14
  },
  libraryRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingVertical: 8
  },
  libraryThumb: {
    borderRadius: 6,
    height: 54,
    width: 96
  },
  libraryText: {
    flex: 1,
    gap: 4
  },
  queueRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 78,
    paddingTop: 10
  },
  queueThumb: {
    borderRadius: 6,
    height: 48,
    width: 86
  },
  queueText: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  queueActions: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: 6
  },
  collectionVideo: {
    justifyContent: 'center',
    minHeight: 44
  },
  collectionActions: {
    flexDirection: 'row',
    gap: 8
  },
  switchRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52
  },
  segmentGroup: {
    gap: 8
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '800'
  },
  segmentWrap: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    padding: 3
  },
  segment: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '800'
  },
  recentRow: {
    justifyContent: 'center',
    minHeight: 44
  },
  emptyState: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    justifyContent: 'center',
    minHeight: 64,
    padding: 14
  },
  skeletonSpotlight: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 10
  },
  skeletonBlock: {
    aspectRatio: 16 / 9,
    borderRadius: 8,
    opacity: 0.5
  },
  skeletonCard: {
    padding: 10
  },
  skeletonThumb: {
    aspectRatio: 16 / 9,
    borderRadius: 8,
    opacity: 0.5
  },
  skeletonBody: {
    gap: 8,
    paddingTop: 10
  },
  skeletonLineWide: {
    borderRadius: 4,
    height: 14,
    opacity: 0.5,
    width: '82%'
  },
  skeletonLine: {
    borderRadius: 4,
    height: 12,
    opacity: 0.45,
    width: '48%'
  },
  skeletonTitle: {
    borderRadius: 4,
    height: 18,
    opacity: 0.5,
    width: 148
  },
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingBottom: 8,
    paddingTop: 6,
    position: 'absolute',
    right: 0
  },
  tabItem: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 54
  },
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 44
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '800'
  }
});
