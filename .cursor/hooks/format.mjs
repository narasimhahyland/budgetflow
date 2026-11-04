// afterFileEdit: formats the edited file with the workspace's Prettier. Silent no-op when Prettier is absent.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isInside, runHook, workspaceRoots } from './lib.mjs';

const FORMATTABLE = /\.(ts|mts|cts|js|mjs|cjs|json|html|scss|css|md|ya?ml)$/;
const SKIP = /(^|\/)(node_modules|dist|coverage|tmp|\.nx|\.angular)\/|(^|\/)package-lock\.json$/;

runHook((input) => {
  const file = String(input.file_path ?? '');
  const root = workspaceRoots(input).find((r) => isInside(file, [r]));
  if (!root || !FORMATTABLE.test(file)) return undefined;
  if (SKIP.test(path.relative(root, file).split(path.sep).join('/'))) return undefined;

  const cli = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (!existsSync(cli)) return undefined;
  spawnSync(process.execPath, [cli, '--write', '--log-level=silent', '--ignore-unknown', file], {
    cwd: root,
    timeout: 15000,
    stdio: 'ignore',
  });
  return undefined;
});
