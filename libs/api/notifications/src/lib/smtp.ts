import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

const encodeHeader = (v: string) =>
  /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;

const base64Lines = (v: string) =>
  (
    Buffer.from(v, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');

/** RFC 5322 message with text and HTML alternatives (bodies base64-encoded, so no line-length or dot issues). */
export function mimeMessage(m: MailMessage, now = new Date()): string {
  const boundary = `bf-${randomUUID()}`;
  const domain = m.from.replace(/.*@/, '').replace(/>.*/, '') || 'budgetflow.example.test';
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

const address = (v: string) => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim();

/**
 * Minimal SMTP client (EHLO, optional AUTH PLAIN, MAIL, RCPT, DATA, QUIT) over a plain socket, enough
 * for the local Mailpit relay. `url`: smtp://[user:password@]host:port.
 */
export async function sendSmtp(url: string, mail: MailMessage, timeoutMs = 10_000): Promise<void> {
  const u = new URL(url);
  const socket: Socket = connect({ host: u.hostname, port: Number(u.port || 25) });
  socket.setTimeout(timeoutMs);
  let buffer = '';
  const waiters: { resolve: (r: string) => void; reject: (e: Error) => void }[] = [];
  const replies: string[] = [];
  const fail = (e: Error) => {
    while (waiters.length) waiters.shift()!.reject(e);
  };
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const lines = buffer.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3} /.test(l));
      if (end < 0) break;
      const reply = lines.slice(0, end + 1).join('\n');
      buffer = lines.slice(end + 1).join('\r\n');
      const w = waiters.shift();
      if (w) w.resolve(reply);
      else replies.push(reply);
    }
  });
  socket.on('error', fail);
  socket.on('timeout', () => {
    fail(new Error('SMTP timeout'));
    socket.destroy();
  });
  const next = () =>
    new Promise<string>((resolve, reject) => {
      const queued = replies.shift();
      if (queued !== undefined) resolve(queued);
      else waiters.push({ resolve, reject });
    });
  const expect = async (code: string) => {
    const r = await next();
    if (!r.startsWith(code)) throw new Error(`SMTP: expected ${code}, got ${r.slice(0, 120)}`);
  };
  const cmd = async (line: string, code: string) => {
    socket.write(`${line}\r\n`);
    await expect(code);
  };
  try {
    await expect('220');
    await cmd('EHLO budgetflow', '250');
    if (u.username) {
      const token = Buffer.from(
        `\0${decodeURIComponent(u.username)}\0${decodeURIComponent(u.password)}`,
      ).toString('base64');
      await cmd(`AUTH PLAIN ${token}`, '235');
    }
    await cmd(`MAIL FROM:<${address(mail.from)}>`, '250');
    await cmd(`RCPT TO:<${address(mail.to)}>`, '250');
    await cmd('DATA', '354');
    socket.write(`${mimeMessage(mail)}\r\n.\r\n`);
    await expect('250');
    await cmd('QUIT', '221');
  } finally {
    socket.end();
  }
}
