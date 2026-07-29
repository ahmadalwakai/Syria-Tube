import {
  YouTubeApiError,
  YouTubeChannel,
  YouTubeLiveStatus,
  YouTubePageInfo,
  YouTubePlaylist,
  YouTubeSearchPage,
  YouTubeSearchResult,
  YouTubeThumbnail,
  YouTubeVideo,
  YouTubeVideoAvailability,
  dedupeSearchResults,
  filterPlayableVideos,
  isValidYouTubeResourceId,
  isValidYouTubeVideoId,
  youtubeError
} from './core';

export type YouTubeSearchResourceId = {
  kind?: string;
  videoId?: string;
  channelId?: string;
  playlistId?: string;
};

export type YouTubeSnippet = {
  publishedAt: string;
  title: string;
  description: string;
  channelId?: string;
  channelTitle?: string;
  thumbnails: Record<string, YouTubeThumbnail>;
  categoryId?: string;
  liveBroadcastContent?: string;
};

export type YouTubeSearchItem = {
  id: YouTubeSearchResourceId;
  snippet: YouTubeSnippet;
};

export type YouTubeSearchResponse = {
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo?: {
    totalResults?: number;
    resultsPerPage?: number;
  };
  items: YouTubeSearchItem[];
};

export type YouTubeVideoItem = {
  id: string;
  snippet: YouTubeSnippet;
  contentDetails: {
    duration?: string;
    contentRating?: Record<string, string>;
  };
  statistics?: {
    viewCount?: string;
  };
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
    uploadStatus?: string;
    madeForKids?: boolean;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
    concurrentViewers?: string;
  };
};

export type YouTubeVideoResponse = {
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo?: {
    totalResults?: number;
    resultsPerPage?: number;
  };
  items: YouTubeVideoItem[];
};

export type YouTubeChannelItem = {
  id: string;
  snippet: YouTubeSnippet;
};

export type YouTubeChannelResponse = {
  items: YouTubeChannelItem[];
};

export function mapYouTubeSearchPage(search: YouTubeSearchResponse, details: YouTubeVideoResponse): YouTubeSearchPage {
  const detailsById = new Map(details.items.map((item) => [item.id, item]));
  const mapped = search.items
    .map((item): YouTubeSearchResult | null => {
      if (item.id.kind === 'youtube#channel' && item.id.channelId && isValidYouTubeResourceId(item.id.channelId)) {
        return mapYouTubeChannelSearchItem(item);
      }
      if (item.id.kind === 'youtube#playlist' && item.id.playlistId && isValidYouTubeResourceId(item.id.playlistId)) {
        return mapYouTubePlaylistSearchItem(item);
      }
      const videoId = item.id.videoId;
      if (!videoId || !isValidYouTubeVideoId(videoId)) {
        return null;
      }
      const detail = detailsById.get(videoId);
      return detail ? mapYouTubeVideo(detail) : null;
    })
    .filter((item): item is YouTubeSearchResult => Boolean(item));

  const playable = mapped.filter((item) => item.kind !== 'video' || (item.embeddable && item.availability === 'public'));
  return {
    pageInfo: mapPageInfo(search),
    results: dedupeSearchResults(playable)
  };
}

export function mapYouTubeVideosPage(details: YouTubeVideoResponse): { pageInfo: YouTubePageInfo; videos: YouTubeVideo[] } {
  return {
    pageInfo: mapPageInfo(details),
    videos: filterPlayableVideos(details.items.map(mapYouTubeVideo))
  };
}

export function mapYouTubeVideo(item: YouTubeVideoItem): YouTubeVideo {
  const liveStatus = mapLiveStatus(item);
  const embeddable = item.status?.embeddable === true;
  return {
    kind: 'video',
    id: item.id,
    title: decodeYouTubeText(item.snippet.title),
    channelId: item.snippet.channelId ?? '',
    channelName: decodeYouTubeText(item.snippet.channelTitle ?? ''),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    durationSeconds: parseYouTubeDuration(item.contentDetails.duration ?? '') ?? 0,
    viewCount: parseOptionalNumber(item.statistics?.viewCount),
    publishedAt: item.snippet.publishedAt,
    description: decodeYouTubeText(item.snippet.description),
    canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
    categoryId: item.snippet.categoryId,
    liveStatus,
    embeddable,
    availability: mapAvailability(item, embeddable)
  };
}

export function mapYouTubeChannel(item: YouTubeChannelItem): YouTubeChannel {
  return {
    kind: 'channel',
    id: item.id,
    title: decodeYouTubeText(item.snippet.title),
    description: decodeYouTubeText(item.snippet.description),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    canonicalUrl: `https://www.youtube.com/channel/${item.id}`
  };
}

export function parseYouTubeDuration(value: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export function decodeYouTubeText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function mapYouTubeApiError(status: number, reason?: string): YouTubeApiError {
  if (reason === 'quotaExceeded') {
    return youtubeError('quotaExceeded', 'YouTube quota is exhausted. Try again later.', false);
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return youtubeError('rateLimitExceeded', 'YouTube is rate limiting requests. Try again soon.', true);
  }
  if (reason === 'invalidPageToken') {
    return youtubeError('invalidPageToken', 'This page token is no longer valid. Start the search again.', false);
  }
  if (status === 403) {
    return youtubeError('forbidden', 'YouTube refused this request for the configured API key.', false);
  }
  if (status >= 500) {
    return youtubeError('serverError', 'YouTube is temporarily unavailable.', true);
  }
  return youtubeError('unknown', 'The YouTube request failed.', true);
}

function mapYouTubeChannelSearchItem(item: YouTubeSearchItem): YouTubeChannel {
  return {
    kind: 'channel',
    id: item.id.channelId ?? '',
    title: decodeYouTubeText(item.snippet.title),
    description: decodeYouTubeText(item.snippet.description),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    canonicalUrl: `https://www.youtube.com/channel/${item.id.channelId}`
  };
}

function mapYouTubePlaylistSearchItem(item: YouTubeSearchItem): YouTubePlaylist {
  return {
    kind: 'playlist',
    id: item.id.playlistId ?? '',
    title: decodeYouTubeText(item.snippet.title),
    channelId: item.snippet.channelId ?? '',
    channelName: decodeYouTubeText(item.snippet.channelTitle ?? ''),
    description: decodeYouTubeText(item.snippet.description),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    canonicalUrl: `https://www.youtube.com/playlist?list=${item.id.playlistId}`
  };
}

function mapAvailability(item: YouTubeVideoItem, embeddable: boolean): YouTubeVideoAvailability {
  if (item.status?.privacyStatus === 'private') {
    return 'private';
  }
  if (item.status?.uploadStatus === 'deleted') {
    return 'deleted';
  }
  if (!embeddable) {
    return 'embeddingDisabled';
  }
  if (item.contentDetails.contentRating?.ytRating === 'ytAgeRestricted') {
    return 'ageRestricted';
  }
  if (item.status?.privacyStatus !== 'public') {
    return 'unavailable';
  }
  return 'public';
}

function mapLiveStatus(item: YouTubeVideoItem): YouTubeLiveStatus {
  if (item.liveStreamingDetails?.actualStartTime && !item.liveStreamingDetails.actualEndTime) {
    return 'live';
  }
  if (item.liveStreamingDetails?.scheduledStartTime && !item.liveStreamingDetails.actualStartTime) {
    return 'upcoming';
  }
  if (item.liveStreamingDetails?.actualEndTime) {
    return 'completed';
  }
  if (item.snippet.liveBroadcastContent === 'live') {
    return 'live';
  }
  if (item.snippet.liveBroadcastContent === 'upcoming') {
    return 'upcoming';
  }
  return 'none';
}

function mapPageInfo(response: YouTubeSearchResponse | YouTubeVideoResponse): YouTubePageInfo {
  return {
    nextPageToken: response.nextPageToken,
    prevPageToken: response.prevPageToken,
    totalResults: response.pageInfo?.totalResults,
    resultsPerPage: response.pageInfo?.resultsPerPage
  };
}

function parseOptionalNumber(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function bestThumbnail(thumbnails: Record<string, YouTubeThumbnail>): string {
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? '';
}
