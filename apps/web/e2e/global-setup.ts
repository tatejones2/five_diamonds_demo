import { execSync } from 'node:child_process';

export default function globalSetup() {
  if (process.env.E2E_BASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL)) {
    throw new Error('Refusing to reseed a non-local environment.');
  }
  execSync('npm run db:seed', { cwd: new URL('../../..', import.meta.url).pathname, stdio: 'inherit' });
}
