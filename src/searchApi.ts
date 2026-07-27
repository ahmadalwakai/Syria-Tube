import { SearchDuration, SearchSort, SearchType, VideoSummary, dedupeVideos } from './core';

export type RemoteSearchParams = {
  query: string;
  type: SearchType;
  sort: SearchSort;
  duration: SearchDuration;
};

export type RemoteSearchPage = {
  nextPageToken?: string;
  videos: VideoSummary[];
};

const searchApiBaseUrl = readSearchApiBaseUrl();

export async function searchRemoteVideos(params: RemoteSearchParams): Promise<RemoteSearchPage | null> {
  if (!searchApiBaseUrl) {
    return null;
  }

  const query = params.query.trim();
  if (!query || query.length > 100) {
    return { videos: [] };
  }

  const url = new URL('/youtube/search', searchApiBaseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('type', params.type);
  url.searchParams.set('sort', params.sort);
  url.searchParams.set('duration', params.duration);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Search service unavailable');
  }

  const data = (await response.json()) as RemoteSearchPage;
  return {
    nextPageToken: data.nextPageToken,
    videos: dedupeVideos(data.videos)
  };
}

function readSearchApiBaseUrl(): string | null {
  if (typeof process === 'undefined') {
    return null;
  }
  const value = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}
