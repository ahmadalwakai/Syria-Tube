import { spawnSync } from 'node:child_process';

const apiUrl = process.env.EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL?.trim();
const requireDirectSources = process.argv.includes('--require-direct-sources');

if (!apiUrl) {
  fail('EXPO_PUBLIC_SYRIA_TUBE_API_BASE_URL is required.');
}

run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'validate:production-config']);
run('node', [
  'scripts/check-backend-health.mjs',
  apiUrl,
  '--deep',
  ...(requireDirectSources ? ['--require-direct-sources'] : [])
]);

console.log(`Syria Tube TestFlight readiness ok: ${new URL(apiUrl).hostname}${requireDirectSources ? '; direct native sources verified' : '; embed fallback release'}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    shell: true,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`Syria Tube TestFlight readiness error: ${message}`);
  process.exit(1);
}
