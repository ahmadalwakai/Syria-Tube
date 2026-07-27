import http from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const key = loadEnvValue('YOUTUBE_DATA_API_KEY');

const allowedOrders = new Set(['relevance', 'date', 'viewCount', 'rating']);
const allowedDurations = new Set(['any', 'short', 'medium', 'long']);

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null);
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== 'GET' || requestUrl.pathname !== '/youtube/search') {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  if (!key) {
    sendJson(response, 500, { error: 'missing_youtube_api_key' });
    return;
  }

  const query = (requestUrl.searchParams.get('query') ?? '').trim();
  if (!query || query.length > 100) {
    sendJson(response, 400, { error: 'invalid_query' });
    return;
  }

  const sort = normalizeOption(requestUrl.searchParams.get('sort'), allowedOrders, 'relevance');
  const duration = normalizeOption(requestUrl.searchParams.get('duration'), allowedDurations, 'any');
  const type = requestUrl.searchParams.get('type') === 'live' ? 'live' : 'videos';

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: '20',
      q: query,
      order: sort,
      key
    });

    if (duration !== 'any' && type !== 'live') {
      searchParams.set('videoDuration', duration);
    }
    if (type === 'live') {
      searchParams.set('eventType', 'live');
    }

    const search = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    const ids = search.items
      .map((item) => item.id?.videoId)
      .filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id));

    if (!ids.length) {
      sendJson(response, 200, { nextPageToken: search.nextPageToken, videos: [] });
      return;
    }

    const detailParams = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      id: ids.join(','),
      key
    });
    const details = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`);
    const videos = details.items.map(mapVideo);

    sendJson(response, 200, { nextPageToken: search.nextPageToken, videos });
  } catch {
    sendJson(response, 502, { error: 'youtube_request_failed' });
  }
});

server.listen(port, () => {
  console.log(`Syria Tube YouTube proxy listening on http://localhost:${port}`);
});

function loadEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }
  try {
    const file = fsRead('.env.local');
    const line = file.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function fsRead(path) {
  return readFileSync(path, 'utf8');
}

function normalizeOption(value, allowed, fallback) {
  return value && allowed.has(value) ? value : fallback;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube request failed with ${response.status}`);
  }
  return response.json();
}

function mapVideo(item) {
  return {
    id: item.id,
    title: decodeText(item.snippet.title),
    channelName: decodeText(item.snippet.channelTitle),
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    durationSeconds: parseDuration(item.contentDetails.duration) ?? 0,
    viewCount: Number.parseInt(item.statistics?.viewCount ?? '0', 10) || 0,
    publishedAt: item.snippet.publishedAt,
    description: decodeText(item.snippet.description),
    canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`
  };
}

function parseDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] ?? '0', 10) * 3600 + Number.parseInt(match[2] ?? '0', 10) * 60 + Number.parseInt(match[3] ?? '0', 10);
}

function decodeText(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function bestThumbnail(thumbnails) {
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? '';
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  });
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}
