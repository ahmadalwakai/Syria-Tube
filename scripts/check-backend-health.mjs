const args = process.argv.slice(2);
const requireDirectSources = args.includes('--require-direct-sources');
const deepCheck = args.includes('--deep');
const requestedBaseUrl = args.find((arg) => !arg.startsWith('--'));
const defaultBaseUrl =
  requestedBaseUrl ??
  process.env.SYRIA_TUBE_BACKEND_URL ??
  process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL;

if (!defaultBaseUrl) {
  fail('Pass a backend URL or set SYRIA_TUBE_BACKEND_URL.');
}

let baseUrl;
try {
  baseUrl = new URL(defaultBaseUrl);
} catch {
  fail('Backend URL must be an absolute URL.');
}

baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');
baseUrl.search = '';
baseUrl.hash = '';

const checks = [
  { name: 'live', path: '/health/live', expected: (body) => body.ok === true },
  {
    name: 'ready',
    path: '/health/ready',
    expected: (body) =>
      body.ok === true &&
      body.ready === true &&
      (!requireDirectSources || Number.isInteger(body.directPlaybackSources) && body.directPlaybackSources > 0)
  }
];

if (deepCheck) {
  checks.push({
    name: 'home',
    path: '/youtube/home?historyIds=&watchLaterIds=&favouriteIds=',
    expected: (body) => Array.isArray(body.sections) && Object.prototype.hasOwnProperty.call(body, 'spotlight')
  });
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  const status = result.ok ? 'ok' : 'failed';
  const directSourceText = result.directPlaybackSources === undefined ? '' : `; direct playback sources ${result.directPlaybackSources}`;
  console.log(`${result.name}: ${status}; status ${result.statusCode ?? 'n/a'}; ${result.ms}ms${directSourceText}`);
}

if (failed.length) {
  process.exit(1);
}

console.log(`Syria Tube backend health ok: ${baseUrl.hostname}`);

async function runCheck(check) {
  const url = new URL(check.path, baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    return {
      name: check.name,
      ok: response.ok && check.expected(body),
      statusCode: response.status,
      directPlaybackSources: Number.isInteger(body?.directPlaybackSources) ? body.directPlaybackSources : undefined,
      ms: Date.now() - startedAt
    };
  } catch {
    return {
      name: check.name,
      ok: false,
      statusCode: null,
      ms: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fail(message) {
  console.error(`Syria Tube backend health error: ${message}`);
  process.exit(1);
}
