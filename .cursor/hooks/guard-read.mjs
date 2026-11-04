// beforeReadFile: keeps credential files and secret-bearing content away from the model.
import { findSecrets } from '../../scripts/secret-patterns.mjs';
import { forbiddenFileReason, runHook, sensitivePathReason, workspaceRoots } from './lib.mjs';

const MAX_SCAN = 5 * 1024 * 1024;

runHook((input) => {
  const file = String(input.file_path ?? '');
  const roots = workspaceRoots(input);
  let reason = sensitivePathReason(file, roots) ?? forbiddenFileReason(file);

  const content = typeof input.content === 'string' ? input.content : '';
  if (!reason && content && content.length <= MAX_SCAN && !/[\\/]node_modules[\\/]/.test(file)) {
    const hits = findSecrets(content);
    if (hits.length) reason = `it contains what looks like a ${[...new Set(hits.map((h) => h.id))].join(', ')}`;
  }

  if (!reason) return { permission: 'allow' };
  return {
    permission: 'deny',
    user_message: `BudgetFlow guard blocked the agent from reading ${file}: ${reason}. If this is a false positive, read it yourself or adjust scripts/secret-patterns.mjs.`,
  };
});
