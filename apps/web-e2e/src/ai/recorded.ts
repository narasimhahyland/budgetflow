// The AI journeys assert the words, sources and provenance of the offline recorded provider, which
// the local stack, functional runs and CI use by default (AI_PROVIDER=recorded). Against a stack
// started with AI_PROVIDER=bedrock the wording varies, so the journeys skip there and say why.
import { test } from '@playwright/test';
import { apiAs } from './support';

/** The model id the recorded provider reports in provenance and on the settings screen. */
export const RECORDED_MODEL = 'budgetflow-recorded';

/** Call at the top of an AI journey file: skips the file unless the stack runs the recorded provider. */
export function onRecordedProvider(): void {
  test.beforeAll(async () => {
    const res = await (await apiAs('org-admin')).get('/api/ai/settings');
    const body = (await res.json()) as { provider?: { provider?: string } };
    test.skip(
      body.provider?.provider !== 'recorded',
      'AI journeys assert the recorded provider; this stack runs a live model (AI_PROVIDER=bedrock).',
    );
  });
}
