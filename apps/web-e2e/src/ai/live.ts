/** AI journeys call Amazon Bedrock through the running API, so they only run when asked to. */
export const AI_LIVE = Boolean(process.env['BF_AI_LIVE']);
export const AI_LIVE_REASON =
  'AI journeys call Amazon Bedrock. Set BF_AI_LIVE=1 with AWS credentials in the API environment to run them.';
