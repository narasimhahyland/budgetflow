import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AiProvider, type AiCall, type AiRawResult } from './ai-provider';
import { systemPrompt } from './prompts';

const BedrockEnv = z.object({
  AWS_REGION: z.string().min(1).default('us-east-1'),
  BEDROCK_MODEL_ID: z
    .string()
    .min(1)
    .default('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    .describe('Bedrock model id or inference profile id used for every AI feature.'),
  BEDROCK_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(2048),
  BEDROCK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
});

const IMAGE_FORMATS: Record<string, 'png' | 'jpeg' | 'gif' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Amazon Bedrock behind `AiProvider`, through the Converse API. Structured output is forced with a
 * single tool whose input schema is the call's zod schema, so the model must answer in that shape and
 * the gateway still re-validates it. Credentials come from the standard AWS chain in the server
 * environment (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
 * [+ `AWS_SESSION_TOKEN`], `AWS_PROFILE`, or an instance/task role); none is read from code or the database.
 */
@Injectable()
export class BedrockAiProvider extends AiProvider {
  readonly id = 'bedrock';
  private readonly log = new Logger('BedrockAiProvider');
  private readonly cfg = BedrockEnv.parse(process.env);
  private client: BedrockRuntimeClient | null = null;

  get modelId(): string {
    return this.cfg.BEDROCK_MODEL_ID;
  }

  get modelVersion(): string {
    return this.cfg.BEDROCK_MODEL_ID;
  }

  /** True when the environment carries some AWS credential source. Whether it is valid is found out on the first call. */
  get configured(): boolean {
    const e = process.env;
    return Boolean(
      e['AWS_BEARER_TOKEN_BEDROCK'] ||
        (e['AWS_ACCESS_KEY_ID'] && e['AWS_SECRET_ACCESS_KEY']) ||
        e['AWS_PROFILE'] ||
        e['AWS_WEB_IDENTITY_TOKEN_FILE'] ||
        e['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'] ||
        e['AWS_CONTAINER_CREDENTIALS_FULL_URI'],
    );
  }

  private getClient(): BedrockRuntimeClient {
    this.client ??= new BedrockRuntimeClient({
      region: this.cfg.AWS_REGION,
      requestHandler: { requestTimeout: this.cfg.BEDROCK_TIMEOUT_MS },
      maxAttempts: 2,
    });
    return this.client;
  }

  async generate<T>(call: AiCall<T>): Promise<AiRawResult> {
    if (!this.configured) return { output: null, unavailable: true };
    const content: ContentBlock[] = [];
    for (const [i, a] of (call.attachments ?? []).entries()) {
      const image = IMAGE_FORMATS[a.contentType];
      if (image) content.push({ image: { format: image, source: { bytes: a.bytes } } });
      else if (a.contentType === 'application/pdf')
        content.push({
          document: { format: 'pdf', name: `document ${i + 1}`, source: { bytes: a.bytes } },
        });
    }
    content.push({
      text:
        `<facts>\n${JSON.stringify(call.facts)}\n</facts>\n` +
        `<asker_words>\n${call.prompt ?? ''}\n</asker_words>`,
    });

    let response: ConverseCommandOutput;
    try {
      const inputSchema = z.toJSONSchema(call.schema as z.ZodType, {
        io: 'input',
        unrepresentable: 'any',
      });
      response = await this.getClient().send(
        new ConverseCommand({
          modelId: this.cfg.BEDROCK_MODEL_ID,
          system: [{ text: systemPrompt(call.feature, call.task) }],
          messages: [{ role: 'user', content }],
          inferenceConfig: { maxTokens: this.cfg.BEDROCK_MAX_TOKENS, temperature: 0 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: 'respond',
                  description: 'Return the answer in exactly this shape.',
                  inputSchema: {
                    json: inputSchema as never,
                  },
                },
              },
            ],
            toolChoice: { tool: { name: 'respond' } },
          },
        }),
      );
    } catch (error) {
      // Never log the request: it holds minimized tenant facts. The error name is enough to diagnose.
      this.log.warn(
        `Bedrock call failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return { output: null, unavailable: true };
    }
    const blocks = response.output?.message?.content ?? [];
    const tool = blocks.find((b) => b.toolUse?.name === 'respond')?.toolUse;
    // No tool answer (refusal, truncation) is an unusable output, not an outage: the gateway discards it.
    return { output: tool?.input ?? null };
  }
}
