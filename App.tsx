import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

import { sampleSections, sampleVideos } from './src/sampleData';
import { clearLibrary, loadLibrary, saveLibrary } from './src/storage';
import { colors, spacing } from './src/theme';
import {
  AppearancePreference,
  Collection,
  LibraryState,
  PlayerCommand,
  SearchDuration,
  SearchSort,
  SearchType,
  VideoSummary,
  WatchProgress,
  addToCollection,
  createInitialLibrary,
  createProgress,
  dedupeVideos,
  formatDuration,
  formatPublishedDate,
  formatViews,
  recordSearch,
  upsertProgress
} from './src/core';
import { YouTubePlayer } from './src/YouTubePlayer';
import { searchRemoteVideos } from './src/searchApi';

type TabKey = 'home' | 'search' | 'watch' | 'library' | 'settings';

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'search', label: 'Search', icon: '⌕' },
  { key: 'watch', label: 'Watch', icon: '▶' },
  { key: 'library', label: 'Library', icon: '▣' },
  { key: 'settings', label: 'Settings', icon: '⚙' }
];

export default function App() {
  const systemScheme = useColorScheme();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [library, setLibrary] = useState<LibraryState>(() => createInitialLibrary());
  const [selectedVideo, setSelectedVideo] = useState<VideoSummary>(sampleVideos[0]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    loadLibrary()
      .then((stored) => {
        if (isMounted) {
          setLibrary(stored);
          setIsReady(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsReady(true);
        }
      });
    return () => {
      isMounted = false;
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

  const actualScheme = library.appearance === 'system' ? systemScheme : library.appearance;
  const isDark = actualScheme === 'dark';
  const palette = isDark ? colors.dark : colors.light;

  function updateLibrary(mutator: (current: LibraryState) => LibraryState) {
    setLibrary((current) => mutator(current));
  }

  function selectVideo(video: VideoSummary) {
    setSelectedVideo(video);
    setLibrary((current) => ({
      ...current,
      savedVideos: { ...current.savedVideos, [video.id]: video }
    }));
    setActiveTab('watch');
  }

  function recordPlayback(position: number, duration: number) {
    const progress = createProgress(selectedVideo.id, position, duration);
    if (!progress) {
      return;
    }
    setLibrary((current) => upsertProgress(current, selectedVideo, progress));
  }

  function addWatchLater(video: VideoSummary) {
    updateLibrary((current) => ({
      ...current,
      savedVideos: { ...current.savedVideos, [video.id]: video },
      watchLaterIds: [...new Set([...current.watchLaterIds, video.id])]
    }));
  }

  function addFavourite(video: VideoSummary) {
    updateLibrary((current) => ({
      ...current,
      savedVideos: { ...current.savedVideos, [video.id]: video },
      favouriteIds: [...new Set([...current.favouriteIds, video.id])]
    }));
  }

  function setAppearancePreference(value: AppearancePreference) {
    updateLibrary((current) => ({ ...current, appearance: value }));
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ExpoStatusBar style={isDark ? 'light' : 'dark'} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.appFrame, { backgroundColor: palette.background }]}>
        <View style={styles.screen}>
          {activeTab === 'home' ? (
            <HomeScreen
              library={library}
              palette={palette}
              selectedVideo={selectedVideo}
              onSelectVideo={selectVideo}
              onSearch={() => setActiveTab('search')}
              onOpenSettings={() => setActiveTab('settings')}
              onAddFavourite={addFavourite}
              onAddWatchLater={addWatchLater}
            />
          ) : null}
          {activeTab === 'search' ? (
            <SearchScreen
              library={library}
              palette={palette}
              onSelectVideo={selectVideo}
              onRecordSearch={(query) => updateLibrary((current) => recordSearch(current, query))}
              onAddFavourite={addFavourite}
              onAddWatchLater={addWatchLater}
            />
          ) : null}
          {activeTab === 'watch' ? (
            <WatchScreen
              library={library}
              palette={palette}
              video={selectedVideo}
              onProgress={recordPlayback}
              onSelectVideo={selectVideo}
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
              onSetAppearance={setAppearancePreference}
              onUpdateLibrary={updateLibrary}
            />
          ) : null}
        </View>
        <TabBar activeTab={activeTab} palette={palette} onChange={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

type Palette = typeof colors.light;

function HomeScreen({
  library,
  palette,
  selectedVideo,
  onSelectVideo,
  onSearch,
  onOpenSettings,
  onAddFavourite,
  onAddWatchLater
}: {
  library: LibraryState;
  palette: Palette;
  selectedVideo: VideoSummary;
  onSelectVideo: (video: VideoSummary) => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onAddFavourite: (video: VideoSummary) => void;
  onAddWatchLater: (video: VideoSummary) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.kicker, { color: palette.subtle }]}>
            {library.privateSession ? 'Private session' : 'Calm watching'}
          </Text>
          <Text style={[styles.title, { color: palette.text }]}>Syria Tube</Text>
        </View>
        <IconButton label="Settings" icon="⚙" palette={palette} onPress={onOpenSettings} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open search"
        style={[styles.searchField, { backgroundColor: palette.surface, borderColor: palette.border }]}
        onPress={onSearch}
      >
        <Text style={[styles.searchIcon, { color: palette.subtle }]}>⌕</Text>
        <Text style={[styles.searchPlaceholder, { color: palette.subtle }]}>Search without noise</Text>
      </Pressable>
      <SpotlightCard video={selectedVideo} palette={palette} onPress={() => onSelectVideo(selectedVideo)} />
      {sampleSections.map((section) => (
        <VideoRail
          key={section.title}
          title={section.title}
          videos={section.videos}
          library={library}
          palette={palette}
          onSelectVideo={onSelectVideo}
          onAddFavourite={onAddFavourite}
          onAddWatchLater={onAddWatchLater}
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
  onAddWatchLater
}: {
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: VideoSummary) => void;
  onRecordSearch: (query: string) => void;
  onAddFavourite: (video: VideoSummary) => void;
  onAddWatchLater: (video: VideoSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState<SearchType>('videos');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [duration, setDuration] = useState<SearchDuration>('any');
  const [loading, setLoading] = useState(false);
  const [remoteResults, setRemoteResults] = useState<VideoSummary[] | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const timeout = setTimeout(() => {
      setDebouncedQuery(trimmed);
      if (trimmed.length > 0 && trimmed.length <= 100) {
        onRecordSearch(trimmed);
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [query, onRecordSearch]);

  useEffect(() => {
    if (!debouncedQuery) {
      setLoading(false);
      setRemoteResults(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    searchRemoteVideos({ query: debouncedQuery, type, sort, duration })
      .then((page) => {
        if (!cancelled) {
          setRemoteResults(page?.videos ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteResults(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, type, sort, duration]);

  const sampleResults = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length > 100) {
      return [];
    }
    const lower = debouncedQuery.toLowerCase();
    return dedupeVideos(
      sampleVideos.filter((video) => {
        const text = `${video.title} ${video.channelName} ${video.description}`.toLowerCase();
        return text.includes(lower);
      })
    );
  }, [debouncedQuery]);
  const results = remoteResults ?? sampleResults;

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: palette.text }]}>Search</Text>
      <View style={[styles.inputWrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.searchIcon, { color: palette.subtle }]}>⌕</Text>
        <TextInput
          accessibilityLabel="Search query"
          value={query}
          onChangeText={setQuery}
          placeholder="Search videos, channels, playlists"
          placeholderTextColor={palette.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: palette.text }]}
          returnKeyType="search"
        />
        {query.length ? <IconButton label="Clear" icon="×" palette={palette} onPress={() => setQuery('')} /> : null}
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
        onChange={(value) => setType(value as SearchType)}
      />
      <SegmentedControl
        label="Sort"
        value={sort}
        options={[
          ['relevance', 'Relevance'],
          ['date', 'Date'],
          ['viewCount', 'Views'],
          ['rating', 'Rating']
        ]}
        palette={palette}
        onChange={(value) => setSort(value as SearchSort)}
      />
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
      {!query.trim() ? (
        <View>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Recent Searches</Text>
          {library.recentSearches.length ? (
            library.recentSearches.map((item) => (
              <Pressable key={item} style={styles.recentRow} onPress={() => setQuery(item)}>
                <Text style={[styles.bodyText, { color: palette.text }]}>{item}</Text>
              </Pressable>
            ))
          ) : (
            <EmptyState title="No recent searches" palette={palette} />
          )}
        </View>
      ) : null}
      {loading ? <LoadingState title="Searching" palette={palette} /> : null}
      {!loading && debouncedQuery.length > 100 ? <EmptyState title="Search is too long" palette={palette} /> : null}
      {!loading && debouncedQuery && results.length === 0 ? <EmptyState title="No results" palette={palette} /> : null}
      {!loading && results.length > 0 ? (
        <VideoRail
          title="Results"
          videos={results}
          library={library}
          palette={palette}
          onSelectVideo={onSelectVideo}
          onAddFavourite={onAddFavourite}
          onAddWatchLater={onAddWatchLater}
          vertical
        />
      ) : null}
    </ScrollView>
  );
}

function WatchScreen({
  library,
  palette,
  video,
  onProgress,
  onSelectVideo,
  onAddFavourite,
  onAddWatchLater,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  video: VideoSummary;
  onProgress: (position: number, duration: number) => void;
  onSelectVideo: (video: VideoSummary) => void;
  onAddFavourite: (video: VideoSummary) => void;
  onAddWatchLater: (video: VideoSummary) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  const { width } = useWindowDimensions();
  const playerHeight = Math.max(204, Math.floor((width - spacing.page * 2) * 9 / 16));
  const [command, setCommand] = useState<PlayerCommand | null>(null);
  const [repeatOne, setRepeatOne] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.playerFrame, { height: playerHeight, backgroundColor: palette.ink }]}>
        <YouTubePlayer
          videoId={video.id}
          command={command}
          repeatOne={repeatOne}
          onCommandHandled={() => setCommand(null)}
          onProgress={onProgress}
          onReady={() => setPlayerError(null)}
          onError={setPlayerError}
        />
      </View>
      {playerError ? (
        <View style={[styles.notice, { backgroundColor: palette.dangerSoft }]}>
          <Text style={[styles.bodyText, { color: palette.danger }]}>{playerError}</Text>
        </View>
      ) : null}
      <View style={styles.controlRow}>
        <IconButton label="Back 10 seconds" icon="↺10" palette={palette} onPress={() => setCommand('seekBackward10')} />
        <IconButton label="Play" icon="▶" palette={palette} onPress={() => setCommand('play')} />
        <IconButton label="Pause" icon="Ⅱ" palette={palette} onPress={() => setCommand('pause')} />
        <IconButton label="Forward 10 seconds" icon="10↻" palette={palette} onPress={() => setCommand('seekForward10')} />
        <IconButton label="Replay" icon="↻" palette={palette} onPress={() => setCommand('replay')} />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: repeatOne }}
          accessibilityLabel="Repeat one"
          style={[
            styles.iconButton,
            { backgroundColor: repeatOne ? palette.accent : palette.surface, borderColor: palette.border }
          ]}
          onPress={() => setRepeatOne((current) => !current)}
        >
          <Text style={[styles.iconText, { color: repeatOne ? palette.onAccent : palette.text }]}>1∞</Text>
        </Pressable>
      </View>
      <View style={styles.metadataBlock}>
        <Text style={[styles.videoTitle, { color: palette.text }]}>{video.title}</Text>
        <Text style={[styles.metaText, { color: palette.subtle }]}>{video.channelName}</Text>
        {!library.focusMode ? (
          <Text style={[styles.metaText, { color: palette.subtle }]}>
            {formatViews(video.viewCount)} · {formatPublishedDate(video.publishedAt)}
          </Text>
        ) : null}
        <Text style={[styles.description, { color: palette.mutedText }]}>{video.description}</Text>
      </View>
      <View style={styles.actionRow}>
        <ActionButton label="Favourite" palette={palette} onPress={() => onAddFavourite(video)} />
        <ActionButton label="Later" palette={palette} onPress={() => onAddWatchLater(video)} />
        <ActionButton
          label="Collect"
          palette={palette}
          onPress={() => {
            const options = library.collections.map((collection) => ({
              text: collection.name,
              onPress: () =>
                onUpdateLibrary((current) => ({
                  ...current,
                  savedVideos: { ...current.savedVideos, [video.id]: video },
                  collections: current.collections.map((item) => (item.id === collection.id ? addToCollection(item, video.id) : item))
                }))
            }));
            Alert.alert('Add to collection', video.title, [...options, { text: 'Cancel', style: 'cancel' }]);
          }}
        />
        <ActionButton
          label="Share"
          palette={palette}
          onPress={() => void Share.share({ message: video.canonicalUrl, url: video.canonicalUrl })}
        />
      </View>
      <FocusPanel library={library} palette={palette} onUpdateLibrary={onUpdateLibrary} />
      <VideoRail
        title="Related discovery"
        videos={sampleVideos}
        library={library}
        palette={palette}
        onSelectVideo={onSelectVideo}
        onAddFavourite={onAddFavourite}
        onAddWatchLater={onAddWatchLater}
      />
    </ScrollView>
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
  onSelectVideo: (video: VideoSummary) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  const [collectionName, setCollectionName] = useState('');
  const progressVideos = library.history
    .map((progress) => library.savedVideos[progress.videoId])
    .filter((video): video is VideoSummary => Boolean(video));

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

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: palette.text }]}>Library</Text>
      <VideoListBlock title="Continue Watching" videos={progressVideos} palette={palette} onSelectVideo={onSelectVideo} />
      <VideoListBlock
        title="Watch Later"
        videos={library.watchLaterIds.map((id) => library.savedVideos[id]).filter((video): video is VideoSummary => Boolean(video))}
        palette={palette}
        onSelectVideo={onSelectVideo}
      />
      <VideoListBlock
        title="Favourites"
        videos={library.favouriteIds.map((id) => library.savedVideos[id]).filter((video): video is VideoSummary => Boolean(video))}
        palette={palette}
        onSelectVideo={onSelectVideo}
      />
      <Text style={[styles.sectionTitle, { color: palette.text }]}>Collections</Text>
      <View style={[styles.inputWrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <TextInput
          value={collectionName}
          onChangeText={setCollectionName}
          placeholder="Collection name"
          placeholderTextColor={palette.subtle}
          style={[styles.input, { color: palette.text }]}
          returnKeyType="done"
          onSubmitEditing={createCollection}
        />
        <IconButton label="Create collection" icon="+" palette={palette} onPress={createCollection} />
      </View>
      {library.collections.map((collection) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          library={library}
          palette={palette}
          onSelectVideo={onSelectVideo}
          onDelete={() =>
            Alert.alert('Delete collection?', collection.name, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  onUpdateLibrary((current) => ({
                    ...current,
                    collections: current.collections.filter((item) => item.id !== collection.id)
                  }))
              }
            ])
          }
        />
      ))}
    </ScrollView>
  );
}

function SettingsScreen({
  library,
  palette,
  onSetAppearance,
  onUpdateLibrary
}: {
  library: LibraryState;
  palette: Palette;
  onSetAppearance: (value: AppearancePreference) => void;
  onUpdateLibrary: (mutator: (current: LibraryState) => LibraryState) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: palette.text }]}>Settings</Text>
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
      <SettingsSwitch
        label="Autoplay"
        value={library.autoplayEnabled}
        disabled={library.focusMode}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, autoplayEnabled: current.focusMode ? false : value }))}
      />
      <SettingsSwitch
        label="Resume playback"
        value={library.resumePlaybackEnabled}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, resumePlaybackEnabled: value }))}
      />
      <SettingsSwitch
        label="Private Session"
        value={library.privateSession}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, privateSession: value }))}
      />
      <SettingsSwitch
        label="Watch history"
        value={library.watchHistoryEnabled}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, watchHistoryEnabled: value }))}
      />
      <SettingsSwitch
        label="Search history"
        value={library.searchHistoryEnabled}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, searchHistoryEnabled: value }))}
      />
      <SettingsSwitch
        label="Analytics consent"
        value={library.analyticsConsent}
        palette={palette}
        onValueChange={(value) => onUpdateLibrary((current) => ({ ...current, analyticsConsent: value }))}
      />
      <ActionButton label="Clear search history" palette={palette} onPress={() => onUpdateLibrary((current) => ({ ...current, recentSearches: [] }))} />
      <ActionButton label="Clear watch history" palette={palette} onPress={() => onUpdateLibrary((current) => ({ ...current, history: [] }))} />
      <ActionButton
        label="Clear all local data"
        destructive
        palette={palette}
        onPress={() =>
          Alert.alert('Clear all local data?', 'Syria Tube will reset local library data.', [
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
      <ActionButton label="Privacy Policy" palette={palette} onPress={() => Alert.alert('Privacy Policy URL required')} />
      <ActionButton label="Terms of Use" palette={palette} onPress={() => Alert.alert('Terms of Use URL required')} />
      <ActionButton label="YouTube Terms" palette={palette} onPress={() => void Linking.openURL('https://www.youtube.com/t/terms')} />
    </ScrollView>
  );
}

function SpotlightCard({
  video,
  palette,
  onPress
}: {
  video: VideoSummary;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${video.title}`}
      style={[styles.spotlight, { backgroundColor: palette.surface, borderColor: palette.border }]}
      onPress={onPress}
    >
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
  vertical = false
}: {
  title: string;
  videos: VideoSummary[];
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: VideoSummary) => void;
  onAddFavourite: (video: VideoSummary) => void;
  onAddWatchLater: (video: VideoSummary) => void;
  vertical?: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
        {!vertical ? <Text style={[styles.seeAll, { color: palette.accent }]}>See All</Text> : null}
      </View>
      {videos.length === 0 ? (
        <EmptyState title="Nothing here yet" palette={palette} />
      ) : vertical ? (
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
  wide = false
}: {
  video: VideoSummary;
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: VideoSummary) => void;
  onAddFavourite: (video: VideoSummary) => void;
  onAddWatchLater: (video: VideoSummary) => void;
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
          <Text style={[styles.avatarText, { color: palette.accent }]}>{video.channelName.slice(0, 1)}</Text>
        </View>
        <View style={styles.cardText}>
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
              { text: 'Watch Later', onPress: () => onAddWatchLater(video) },
              { text: 'Favourite', onPress: () => onAddFavourite(video) },
              { text: 'Share URL', onPress: () => void Share.share({ message: video.canonicalUrl, url: video.canonicalUrl }) },
              { text: 'Cancel', style: 'cancel' }
            ])
          }
        >
          <Text style={[styles.moreText, { color: palette.subtle }]}>⋯</Text>
        </Pressable>
      </View>
    </View>
  );
}

function VideoThumbnail({ video, palette, progress }: { video: VideoSummary; palette: Palette; progress?: WatchProgress }) {
  const percentage = progress?.completionPercentage ?? 0;
  return (
    <View style={[styles.thumbnail, { backgroundColor: palette.ink }]}>
      <Image source={{ uri: video.thumbnailUrl }} style={styles.thumbnailImage} resizeMode="cover" />
      <View style={styles.badgeRow}>
        <Text style={styles.durationBadge}>{formatDuration(video.durationSeconds)}</Text>
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
  onSelectVideo
}: {
  title: string;
  videos: VideoSummary[];
  palette: Palette;
  onSelectVideo: (video: VideoSummary) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {videos.length ? (
        videos.map((video) => (
          <Pressable key={video.id} style={[styles.libraryRow, { borderColor: palette.border }]} onPress={() => onSelectVideo(video)}>
            <Image source={{ uri: video.thumbnailUrl }} style={styles.libraryThumb} />
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
  library,
  palette,
  onSelectVideo,
  onDelete
}: {
  collection: Collection;
  library: LibraryState;
  palette: Palette;
  onSelectVideo: (video: VideoSummary) => void;
  onDelete: () => void;
}) {
  const videos = collection.videoIds.map((id) => library.savedVideos[id]).filter((video): video is VideoSummary => Boolean(video));
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.cardTitle, { color: palette.text }]}>{collection.name}</Text>
          <Text style={[styles.metaText, { color: palette.subtle }]}>{collection.videoIds.length} videos</Text>
        </View>
        <IconButton label="Delete collection" icon="×" palette={palette} onPress={onDelete} />
      </View>
      {videos.map((video) => (
        <Pressable key={video.id} onPress={() => onSelectVideo(video)} style={styles.collectionVideo}>
          <Text style={[styles.bodyText, { color: palette.text }]} numberOfLines={1}>
            {video.title}
          </Text>
        </Pressable>
      ))}
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
  onPress
}: {
  label: string;
  icon: string;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.iconButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
      onPress={onPress}
    >
      <Text style={[styles.iconText, { color: palette.text }]}>{icon}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  palette,
  destructive,
  onPress
}: {
  label: string;
  palette: Palette;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.actionButton,
        { backgroundColor: destructive ? palette.dangerSoft : palette.surface, borderColor: destructive ? palette.danger : palette.border }
      ]}
      onPress={onPress}
    >
      <Text style={[styles.actionText, { color: destructive ? palette.danger : palette.text }]}>{label}</Text>
    </Pressable>
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

function TabBar({ activeTab, palette, onChange }: { activeTab: TabKey; palette: Palette; onChange: (tab: TabKey) => void }) {
  return (
    <View style={[styles.tabBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {tabs.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={styles.tabItem}
            onPress={() => onChange(tab.key)}
          >
            <Text style={[styles.tabIcon, { color: selected ? palette.accent : palette.subtle }]}>{tab.icon}</Text>
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
    paddingHorizontal: spacing.page,
    paddingTop: 12,
    paddingBottom: 112,
    gap: 18
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
  searchIcon: {
    fontSize: 24,
    marginRight: 10
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '800'
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
    fontSize: 22,
    fontWeight: '900'
  },
  playerFrame: {
    borderRadius: 8,
    minHeight: 204,
    overflow: 'hidden'
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
    fontSize: 17,
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
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14
  },
  actionText: {
    fontSize: 15,
    fontWeight: '800'
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
  collectionVideo: {
    minHeight: 44,
    justifyContent: 'center'
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
    minHeight: 44,
    justifyContent: 'center'
  },
  emptyState: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
    justifyContent: 'center',
    padding: 14
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
    minHeight: 54,
    justifyContent: 'center'
  },
  tabIcon: {
    fontSize: 18,
    fontWeight: '900'
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '800'
  }
});
