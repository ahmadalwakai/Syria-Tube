import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addToCollection,
  createInitialLibrary,
  createProgress,
  dedupeVideos,
  formatDuration,
  recordSearch,
  upsertProgress
} from '../core';
import { sampleVideos } from '../sampleData';
import { mapYouTubeSearchPage, parseYouTubeDuration } from '../youtubeData';

test('formats duration badges', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(Number.NaN), '0:00');
});

test('validates and classifies watch progress', () => {
  assert.equal(createProgress('invalid', 1, 10), null);
  assert.equal(createProgress('M7lc1UVf-VE', -1, 10), null);
  assert.equal(createProgress('M7lc1UVf-VE', 11, 10), null);
  assert.equal(createProgress('M7lc1UVf-VE', Number.POSITIVE_INFINITY, 10), null);
  assert.equal(createProgress('M7lc1UVf-VE', 89, 100)?.completed, false);
  assert.equal(createProgress('M7lc1UVf-VE', 90, 100)?.completed, true);
});

test('private session writes no history or searches', () => {
  const library = { ...createInitialLibrary(), privateSession: true };
  const progress = createProgress('M7lc1UVf-VE', 10, 100);
  assert.ok(progress);
  const afterProgress = upsertProgress(library, sampleVideos[0], progress);
  const afterSearch = recordSearch(library, 'swiftui');
  assert.equal(afterProgress.history.length, 0);
  assert.equal(afterSearch.recentSearches.length, 0);
});

test('collections and videos are deduplicated', () => {
  const collection = addToCollection(addToCollection({ id: 'one', name: 'One', videoIds: [] }, 'M7lc1UVf-VE'), 'M7lc1UVf-VE');
  assert.deepEqual(collection.videoIds, ['M7lc1UVf-VE']);
  assert.equal(dedupeVideos([sampleVideos[0], sampleVideos[0]]).length, 1);
});

test('parses YouTube ISO 8601 durations', () => {
  assert.equal(parseYouTubeDuration('PT6M6S'), 366);
  assert.equal(parseYouTubeDuration('PT1H2M3S'), 3723);
  assert.equal(parseYouTubeDuration('six minutes'), null);
});

test('maps YouTube API responses', () => {
  const page = mapYouTubeSearchPage(
    {
      nextPageToken: 'NEXT',
      items: [
        {
          id: { kind: 'youtube#video', videoId: 'M7lc1UVf-VE' },
          snippet: {
            publishedAt: '2012-06-01T00:00:00Z',
            title: 'Demo',
            description: 'Demo',
            channelTitle: 'YouTube Developers',
            thumbnails: {}
          }
        },
        {
          id: { kind: 'youtube#video', videoId: 'M7lc1UVf-VE' },
          snippet: {
            publishedAt: '2012-06-01T00:00:00Z',
            title: 'Duplicate',
            description: 'Duplicate',
            channelTitle: 'YouTube Developers',
            thumbnails: {}
          }
        }
      ]
    },
    {
      items: [
        {
          id: 'M7lc1UVf-VE',
          snippet: {
            publishedAt: '2012-06-01T00:00:00Z',
            title: 'IFrame &amp; Player',
            description: 'Official demo',
            channelTitle: 'YouTube Developers',
            thumbnails: {
              high: { url: 'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg' }
            }
          },
          contentDetails: { duration: 'PT6M6S' },
          statistics: { viewCount: '1000' }
        }
      ]
    }
  );
  assert.equal(page.nextPageToken, 'NEXT');
  assert.equal(page.videos.length, 1);
  assert.equal(page.videos[0].title, 'IFrame & Player');
  assert.equal(page.videos[0].durationSeconds, 366);
  assert.equal(page.videos[0].viewCount, 1000);
});
