import { existsSync, readFileSync } from 'node:fs';

const directSourceContentTypes = new Set(['auto', 'progressive', 'hls', 'dash', 'smoothStreaming']);

const key = readEnvValue('YOUTUBE_DATA_API_KEY');
const port = process.env.PORT ?? '8787';
const directSourcesJson = readEnvValue('SYRIA_TUBE_DIRECT_SOURCES_JSON');
const directSourcesFile = readEnvValue('SYRIA_TUBE_DIRECT_SOURCES_FILE');
const requireDirectSources =
  process.argv.includes('--require-direct-sources') ||
  isTruthy(process.env.SYRIA_TUBE_REQUIRE_DIRECT_SOURCES);

if (!key) {
  fail('YOUTUBE_DATA_API_KEY is required for the backend.');
}

if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  fail('PORT must be a TCP port number between 1 and 65535.');
}

const directSourceCount = validateDirectSources(directSourcesJson, directSourcesFile);
if (requireDirectSources && directSourceCount === 0) {
  fail('At least one backend-provided native direct playback source is required for release validation. YouTube embed playback cannot continue after screen lock.');
}

console.log(`Syria Tube backend env ok: port ${port}; direct playback sources ${directSourceCount}; direct sources required ${requireDirectSources ? 'yes' : 'no'}`);

function validateDirectSources(jsonValue, filePath) {
  if (jsonValue && filePath) {
    fail('Use either SYRIA_TUBE_DIRECT_SOURCES_JSON or SYRIA_TUBE_DIRECT_SOURCES_FILE, not both.');
  }
  if (!jsonValue && !filePath) {
    return 0;
  }

  let raw = jsonValue;
  if (filePath) {
    if (!existsSync(filePath)) {
      fail('SYRIA_TUBE_DIRECT_SOURCES_FILE does not exist.');
    }
    raw = readFileSync(filePath, 'utf8');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('Direct playback sources must be valid JSON.');
  }

  const entries = Array.isArray(parsed)
    ? parsed.map((item) => [item?.videoId, item])
    : Object.entries(parsed ?? {});

  let valid = 0;
  for (const [videoId, value] of entries) {
    if (!isValidVideoId(videoId)) {
      fail('Direct playback sources include an invalid YouTube video id.');
    }
    const playbackUrl = typeof value === 'string' ? value : value?.playbackUrl ?? value?.url;
    if (!isHttpsUrl(playbackUrl)) {
      fail('Direct playback sources must use HTTPS playback URLs.');
    }
    const contentType = typeof value === 'object' ? value?.playbackContentType ?? value?.contentType : undefined;
    if (contentType && !directSourceContentTypes.has(contentType)) {
      fail('Direct playback sources include an unsupported playback content type.');
    }
    valid += 1;
  }
  return valid;
}

function readEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }
  try {
    const file = readFileSync('.env.local', 'utf8');
    const line = file.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
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

function isTruthy(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

function fail(message) {
  console.error(`Syria Tube backend env error: ${message}`);
  process.exit(1);
}
