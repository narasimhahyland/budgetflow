// Writes libs/contracts/openapi/openapi.json from the zod contracts, or with --check fails when the
// committed file differs from what the contracts generate (the openapi-check target, run by the build gate).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument } from '../src/lib/openapi';

const target = resolve(__dirname, '../openapi/openapi.json');
const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== generated) {
    console.error(
      'openapi-check: libs/contracts/openapi/openapi.json is out of date. Run: npx nx run contracts:openapi',
    );
    process.exit(1);
  }
  console.log('openapi-check: openapi.json matches the contracts');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, generated);
  console.log(`openapi: wrote ${target}`);
}
