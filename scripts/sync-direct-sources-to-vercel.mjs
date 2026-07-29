import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultFile = 'config/direct-sources.production.json';
const defaultScope = 'ahmadalwakais-projects';
const variableName = 'SYRIA_TUBE_DIRECT_SOURCES_JSON';
const supportedContentTypes = new Set(['auto', 'progressive', 'hls', 'dash', 'smoothStreaming']);
const environments = ['production', 'preview', 'development'];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const file = readOption('--file') ?? defaultFile;
const scope = readOption('--scope') ?? process.env.VERCEL_SCOPE ?? defaultScope;

const sources = readAndValidateSources(file);
await validatePlaybackUrls(sources);

const payload = JSON.stringify(sources);

if (checkOnly) {
  console.log(`Direct playback sources ok: ${Object.keys(sources).length} source(s) from ${file}`);
  process.exit(0);
}

for (const environment of environments) {
  syncEnvironment(environment, payload);
}

console.log(`Synced ${Object.keys(sources).length} direct playback source(s) to Vercel env ${variableName}.`);

function readOption(name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readAndValidateSources(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Could not read valid JSON from ${path}: ${error.message}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed.map((item) => [item?.videoId, item])
    : Object.entries(parsed ?? {});

  const sources = {};
  for (const [videoId, value] of entries) {
    if (!isValidVideoId(videoId)) {
      fail(`Invalid YouTube video id in direct sources: ${String(videoId)}`);
    }
    const playbackUrl = typeof value === 'string' ? value : value?.playbackUrl ?? value?.url;
    if (!isHttpsUrl(playbackUrl)) {
      fail(`Direct source ${videoId} must use an HTTPS playbackUrl.`);
    }
    const playbackContentType = normalizeContentType(value, playbackUrl);
    sources[videoId] = { playbackUrl, playbackContentType };
  }

  if (!Object.keys(sources).length) {
    fail('At least one direct playback source is required.');
  }

  return sources;
}

function normalizeContentType(value, playbackUrl) {
  const explicit = typeof value === 'object' ? value?.playbackContentType ?? value?.contentType : undefined;
  if (explicit) {
    if (!supportedContentTypes.has(explicit)) {
      fail(`Unsupported direct playback content type: ${explicit}`);
    }
    return explicit;
  }
  const lower = playbackUrl.toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (lower.includes('.ism') || lower.includes('manifest')) return 'smoothStreaming';
  return 'auto';
}

async function validatePlaybackUrls(sources) {
  for (const [videoId, source] of Object.entries(sources)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(source.playbackUrl, {
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
}

function syncEnvironment(environment, payload) {
  const result = spawnSync(
    'npx',
    ['vercel', 'env', 'add', variableName, environment, '--force', '--scope', scope],
    {
      input: payload,
      shell: true,
      stdio: ['pipe', 'inherit', 'inherit']
    }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
  console.error(`Direct playback source sync error: ${message}`);
  process.exit(1);
}
