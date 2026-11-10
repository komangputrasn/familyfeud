// Loads .env into process.env. Import this before anything that reads configuration.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(here, '.env'));
} catch {
  // No .env file yet: the game still runs, the judge just has no key.
}

// A blank "KEY=" line in .env should behave like the line not being there.
for (const key of ['ANTHROPIC_API_KEY', 'PIN', 'JUDGE_MODEL', 'PORT']) {
  if (!process.env[key]?.trim()) delete process.env[key];
}
