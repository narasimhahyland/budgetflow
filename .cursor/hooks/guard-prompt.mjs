// beforeSubmitPrompt: stops prompts that contain tokens or keys before they reach the model.
import { findSecrets } from '../../scripts/secret-patterns.mjs';
import { runHook } from './lib.mjs';

runHook((input) => {
  const hits = findSecrets(String(input.prompt ?? ''));
  if (!hits.length) return { continue: true };
  const kinds = [...new Set(hits.map((h) => h.id))].join(', ');
  return {
    continue: false,
    user_message: `Prompt not sent: it looks like it contains a ${kinds}. Remove it and send again. Prompts go to the model, and this repository is public.`,
  };
});
