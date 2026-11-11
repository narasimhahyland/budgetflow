import { outboxMessages, people, type Tx } from '@bf/api/db';
import { Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { sendSmtp } from './smtp';
import type { RenderedEmail } from './templates';

export const EMAIL_TOPIC = 'notification.email';

const MailEnv = z.object({
  WEB_BASE_URL: z.url().default('http://localhost:4200'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('BudgetFlow <no-reply@budgetflow.example.test>'),
});

export function mailConfig(env: NodeJS.ProcessEnv = process.env) {
  return MailEnv.parse(env);
}

export interface EmailPayload {
  tenantId: string;
  to: string;
  toName: string;
  subject: string;
  text: string;
  html: string;
  kind: string;
  recipientPersonId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectRef?: string | null;
  /** Files to attach, by DocumentStore reference: the outbox never carries the bytes. */
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  storageKey: string;
  fileName: string;
  contentType: string;
}

/** Reads an attachment's bytes; the worker passes the DocumentStore. */
export type AttachmentLoader = (storageKey: string) => Promise<Buffer>;

export interface Recipient {
  personId: string;
  email: string;
  displayName: string;
  firstName: string;
}

/**
 * Transactional email: messages are written to the outbox in the caller's transaction and sent by the
 * worker (no SMTP call from a request handler). Links point at the web app (`WEB_BASE_URL`).
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  readonly webBaseUrl = mailConfig().WEB_BASE_URL.replace(/\/$/, '');

  async recipients(tx: Tx, personIds: readonly string[]): Promise<Map<string, Recipient>> {
    const ids = [...new Set(personIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: people.id, email: people.email, name: people.displayName })
      .from(people)
      .where(inArray(people.id, ids));
    return new Map(
      rows.map((r) => [
        r.id,
        { personId: r.id, email: r.email, displayName: r.name, firstName: r.name.split(' ')[0] },
      ]),
    );
  }

  async queueEmail(
    tx: Tx,
    tenantId: string,
    to: Recipient,
    email: RenderedEmail,
    kind: string,
    meta?: { subjectType?: string | null; subjectId?: string | null; subjectRef?: string | null },
    attachments: readonly EmailAttachment[] = [],
  ): Promise<void> {
    const payload: EmailPayload = {
      tenantId,
      to: to.email,
      toName: to.displayName,
      subject: email.subject,
      text: email.text,
      html: email.html,
      kind,
      recipientPersonId: to.personId,
      subjectType: meta?.subjectType ?? null,
      subjectId: meta?.subjectId ?? null,
      subjectRef: meta?.subjectRef ?? null,
      ...(attachments.length ? { attachments: [...attachments] } : {}),
    };
    await tx.insert(outboxMessages).values({ tenantId, topic: EMAIL_TOPIC, payload });
  }

  /**
   * Worker side: deliver one queued email through SMTP (Mailpit locally). Attachments are read with
   * `load`; an email that carries attachments but cannot read them fails, so the job retries and
   * then dead-letters instead of sending a message without its file.
   */
  async deliver(payload: EmailPayload, load?: AttachmentLoader): Promise<void> {
    const cfg = mailConfig();
    const refs = payload.attachments ?? [];
    if (refs.length && !load) throw new Error('email has attachments but no attachment loader');
    const files = [];
    for (const a of refs)
      files.push({
        fileName: a.fileName,
        contentType: a.contentType,
        body: await load!(a.storageKey),
      });
    await sendSmtp(cfg.SMTP_URL, {
      from: cfg.MAIL_FROM,
      to: `${payload.toName.replace(/[<>"]/g, '')} <${payload.to}>`,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments: files,
    });
    this.log.log(`email sent (${payload.kind})`);
  }

  async personEmail(tx: Tx, personId: string): Promise<Recipient | undefined> {
    const [p] = await tx.select().from(people).where(eq(people.id, personId));
    return p
      ? {
          personId: p.id,
          email: p.email,
          displayName: p.displayName,
          firstName: p.displayName.split(' ')[0],
        }
      : undefined;
  }
}
