// preToolUse (Grep, Glob, Delete, Write and edit tools): blocks searching credential stores,
// deleting outside the workspace, and writing secrets into files.
import { findSecrets } from '../../scripts/secret-patterns.mjs';
import { HOME, isInside, isTemp, resolvePath, runHook, sensitivePathReason, workspaceRoots } from './lib.mjs';

function collect(value, key = '', out = []) {
  if (typeof value === 'string') out.push({ key, value });
  else if (Array.isArray(value)) value.forEach((v) => collect(v, key, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collect(v, k, out);
  return out;
}

runHook((input) => {
  const tool = String(input.tool_name ?? '');
  const roots = workspaceRoots(input);
  const cwd = input.cwd || roots[0] || process.cwd();
  const deny = (why) => ({
    permission: 'deny',
    user_message: `BudgetFlow guard blocked ${tool}: ${why}.`,
    agent_message: `Blocked by a project hook: ${why}. Do not work around it; ask the user if it is really needed.`,
  });

  for (const { key, value } of collect(input.tool_input ?? {})) {
    const pathLike = /(path|file|target|dir|directory|glob|cwd)/i.test(key) || /^(~\/|\/)/.test(value);
    if (pathLike && value.length < 4096) {
      const abs = resolvePath(value, cwd);
      const reason = abs && sensitivePathReason(abs, roots);
      if (reason) return deny(`${value}: ${reason}`);
      if (tool === 'Grep' && abs && (abs === HOME || abs === '/')) {
        return deny(`searching all of ${abs} can surface credential files; search inside the repository`);
      }
      if (tool === 'Delete' && abs && !isInside(abs, roots) && !isTemp(abs)) {
        return deny(`deleting ${abs}, which is outside the repository`);
      }
    }
    if (/(content|contents|new_string|text|code|replacement)/i.test(key)) {
      const hits = findSecrets(value);
      if (hits.length) {
        return deny(`the new file content contains what looks like a ${hits.map((h) => h.id).join(', ')}; reference secrets through environment variables instead`);
      }
    }
  }
  return { permission: 'allow' };
});
