import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const defaultFile = 'config/direct-sources.production.json';
const supportedContentTypes = new Set(['auto', 'progressive', 'hls', 'dash', 'smoothStreaming']);

const args = process.argv.slice(2);
const file = readOption('--file') ?? defaultFile;
const videoInput = readOption('--video') ?? readOption('--video-id') ?? args[0];
const playbackUrl = readOption('--playback') ?? readOption('--playback-url') ?? args[1];
const explicitType = readOption('--type') ?? readOption('--playback-content-type');

const videoId = normalizeVideoId(videoInput);
if (!videoId) {
  fail('Pass a YouTube video id or URL with --video.');
}

if (!isHttpsUrl(playbackUrl)) {
  fail('Pass an HTTPS HLS/MP4/DASH playback URL with --playback.');
}

const playbackContentType = normalizeContentType(explicitType, playbackUrl);
await validatePlaybackUrl(videoId, playbackUrl);

const sources = readSources(file);
sources[videoId] = { playbackUrl, playbackContentType };
writeFileSync(file, `${JSON.stringify(sortObjectByKey(sources), null, 2)}\n`);

console.log(`Added direct playback source ${videoId} (${playbackContentType}) to ${file}.`);
console.log('Next: npm run direct-sources:validate && npm run direct-sources:sync && npx vercel --prod --scope ahmadalwakais-projects');

function readOption(name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readSources(path) {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${path} must contain a JSON object keyed by YouTube video id.`);
    }
    return parsed;
  } catch (error) {
    fail(`Could not read valid JSON from ${path}: ${error.message}`);
  }
}

function normalizeVideoId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (isValidVideoId(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const queryId = url.searchParams.get('v');
    if (isValidVideoId(queryId)) {
      return queryId;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const candidates = [
      parts.at(-1),
      parts[0] === 'shorts' ? parts[1] : undefined,
      parts[0] === 'embed' ? parts[1] : undefined,
      parts[0] === 'live' ? parts[1] : undefined
    ];
    return candidates.find(isValidVideoId);
  } catch {
    return undefined;
  }
}

function normalizeContentType(explicit, url) {
  if (explicit) {
    if (!supportedContentTypes.has(explicit)) {
      fail(`Unsupported direct playback content type: ${explicit}`);
    }
    return explicit;
  }
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (lower.includes('.ism') || lower.includes('manifest')) return 'smoothStreaming';
  if (lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.m4v')) return 'progressive';
  return 'auto';
}

async function validatePlaybackUrl(videoId, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      signal: controller.signal
    });
    if (!response.ok && response.status !== 206) {
      fail(`Playback URL for ${videoId} returned HTTP ${response.status}.`);
    }
  } catch (error) {
    fail(`Playback URL for ${videoId} is not reachable: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function sortObjectByKey(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function isValidVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`Direct playback source add error: ${message}`);
  process.exit(1);
}
