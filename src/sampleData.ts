import { VideoSummary } from './core';

export const sampleVideos: VideoSummary[] = [
  {
    id: 'M7lc1UVf-VE',
    title: 'IFrame Player API demo',
    channelName: 'YouTube Developers',
    thumbnailUrl: 'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg',
    durationSeconds: 366,
    viewCount: 1000000,
    publishedAt: '2012-06-01T00:00:00Z',
    description: 'Official YouTube IFrame Player API sample video for embedded player integration.',
    canonicalUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE'
  }
];

export const sampleSections = [
  { title: 'Continue Watching', videos: sampleVideos },
  { title: 'Trending Now', videos: sampleVideos },
  { title: 'Recommended Discovery', videos: sampleVideos },
  { title: 'Music', videos: sampleVideos },
  { title: 'Gaming', videos: sampleVideos },
  { title: 'News', videos: sampleVideos },
  { title: 'Sports', videos: sampleVideos },
  { title: 'Technology', videos: sampleVideos },
  { title: 'Documentaries', videos: sampleVideos },
  { title: 'Saved for Later', videos: sampleVideos }
];
