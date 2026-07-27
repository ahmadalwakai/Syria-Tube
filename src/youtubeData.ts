import { VideoSummary, dedupeVideos, isValidYouTubeVideoId } from './core';

export type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export type YouTubeSearchItem = {
  id: {
    kind?: string;
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    channelTitle: string;
    thumbnails: Record<string, YouTubeThumbnail>;
  };
};

export type YouTubeSearchResponse = {
  nextPageToken?: string;
  items: YouTubeSearchItem[];
};

export type YouTubeVideoItem = {
  id: string;
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    channelTitle: string;
    thumbnails: Record<string, YouTubeThumbnail>;
  };
  contentDetails: {
    duration: string;
  };
  statistics?: {
    viewCount?: string;
  };
};

export type YouTubeVideoResponse = {
  items: YouTubeVideoItem[];
};

export type YouTubeSearchPage = {
  nextPageToken?: string;
  videos: VideoSummary[];
};

export function mapYouTubeSearchPage(search: YouTubeSearchResponse, details: YouTubeVideoResponse): YouTubeSearchPage {
  const detailsById = new Map(details.items.map((item) => [item.id, item]));
  const mapped = search.items
    .map((item) => {
      const videoId = item.id.videoId;
      if (!videoId || !isValidYouTubeVideoId(videoId)) {
        return null;
      }
      const detail = detailsById.get(videoId);
      return detail ? mapYouTubeVideo(detail) : null;
    })
    .filter((item): item is VideoSummary => Boolean(item));
  return {
    nextPageToken: search.nextPageToken,
    videos: dedupeVideos(mapped)
  };
}

export function mapYouTubeVideo(item: YouTubeVideoItem): VideoSummary {
  return {
    id: item.id,
    title: decodeYouTubeText(item.snippet.title),
    channelName: decodeYouTubeText(item.snippet.channelTitle),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    durationSeconds: parseYouTubeDuration(item.contentDetails.duration) ?? 0,
    viewCount: Number.parseInt(item.statistics?.viewCount ?? '0', 10) || 0,
    publishedAt: item.snippet.publishedAt,
    description: decodeYouTubeText(item.snippet.description),
    canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`
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

function bestThumbnail(thumbnails: Record<string, YouTubeThumbnail>): string {
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    ''
  );
}
