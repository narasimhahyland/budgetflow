import { exponentOf, isCurrencyCode } from '@bf/domain';

export interface Money {
  amountMinor: number;
  currency: string;
}

/** "USD 6,000.00" (lakh/crore grouping for INR), from integer minor units. */
export function formatMoney(m: Money): string {
  const exp = isCurrencyCode(m.currency) ? exponentOf(m.currency) : 2;
  const value = m.amountMinor / 10 ** exp;
  const n = new Intl.NumberFormat(m.currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(value);
  return `${m.currency} ${n}`;
}

export const escapeHtml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f3f7;font-family:Arial,Helvetica,sans-serif;color:#1b1b21">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px">
<tr><td style="background:#5654ac;color:#ffffff;padding:16px 24px;border-radius:8px 8px 0 0;font-weight:bold">BudgetFlow <span style="font-weight:normal;opacity:.85">&middot; Hyland</span></td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#5f5e66;border-top:1px solid #e4e1ec">You receive this because of your role in BudgetFlow. Manage notifications in your profile.</td></tr>
</table></td></tr></table></body></html>`;

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#5f5e66;font-size:13px">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:14px">${escapeHtml(value)}</td></tr>`;

const button = (href: string, label: string, primary: boolean) =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;margin-right:8px;border-radius:20px;text-decoration:none;font-weight:bold;${
    primary
      ? 'background:#322f86;color:#ffffff'
      : 'background:#ffffff;color:#b02b36;border:1px solid #b02b36'
  }">${escapeHtml(label)}</a>`;

export interface ApprovalEmailInput {
  approverFirstName: string;
  subjectLabel: string;
  ref: string;
  title: string;
  amount: Money;
  requesterName: string;
  chargeTo: string;
  neededBy: string | null;
  purpose: string;
  whyYou: string;
  availableBefore: Money | null;
  availableAfter: Money | null;
  warning: string | null;
  approveUrl: string;
  rejectUrl: string;
  detailsUrl: string;
  expiresAt: Date;
}

/** Actionable approval email (screen 061a): one-click Approve, Reject with a reason, details in the app. */
export function approvalRequestEmail(i: ApprovalEmailInput): RenderedEmail {
  const amount = formatMoney(i.amount);
  const expires = i.expiresAt.toUTCString();
  const impact =
    i.availableBefore && i.availableAfter
      ? `<p style="margin:16px 0 4px;font-weight:bold">Budget impact</p><table role="presentation">${row(
          'Available now',
          formatMoney(i.availableBefore),
        )}${row('Available after approval', formatMoney(i.availableAfter))}</table>${
          i.warning
            ? `<p style="background:#fff4d6;padding:8px 12px;border-radius:4px;font-size:13px">${escapeHtml(i.warning)}</p>`
            : ''
        }`
      : '';
  const html = shell(
    `Approve ${i.ref}`,
    `<p>Hi ${escapeHtml(i.approverFirstName)},</p>
<p>${escapeHtml(i.requesterName)} asks for ${escapeHtml(amount)}. ${escapeHtml(i.whyYou)}</p>
<table role="presentation" style="background:#f8f7fc;border-radius:6px;padding:12px;width:100%">
${row(i.subjectLabel, `${i.ref} · ${i.title}`)}${row('Amount', amount)}${row('Requester', i.requesterName)}${row('Charge to', i.chargeTo)}${
      i.neededBy ? row('Needed by', i.neededBy) : ''
    }${row('Justification', i.purpose)}</table>
${impact}
<p style="margin:20px 0">${button(i.approveUrl, `Approve ${amount}`, true)}${button(i.rejectUrl, 'Reject', false)}</p>
<p style="font-size:13px"><a href="${escapeHtml(i.detailsUrl)}">Approve part, request changes or see details in BudgetFlow</a></p>
<p style="font-size:12px;color:#5f5e66">These links work once and expire on ${escapeHtml(expires)}. Rejecting asks for a reason.</p>`,
  );
  const text = [
    `Hi ${i.approverFirstName},`,
    '',
    `${i.requesterName} asks for ${amount}. ${i.whyYou}`,
    `${i.subjectLabel}: ${i.ref} · ${i.title}`,
    `Charge to: ${i.chargeTo}`,
    `Justification: ${i.purpose}`,
    i.availableBefore && i.availableAfter
      ? `Available now ${formatMoney(i.availableBefore)}; after approval ${formatMoney(i.availableAfter)}`
      : '',
    i.warning ?? '',
    '',
    `Approve ${amount}: ${i.approveUrl}`,
    `Reject: ${i.rejectUrl}`,
    `Details: ${i.detailsUrl}`,
    '',
    `These links work once and expire on ${expires}.`,
  ]
    .filter((l, idx, all) => l !== '' || all[idx - 1] !== '')
    .join('\n');
  return { subject: `Approve ${amount}: ${i.ref} ${i.title}`, text, html };
}

/** A plain notification to a requester (decision, changes requested, cancelled by a budget control). */
export function noticeEmail(i: {
  firstName: string;
  subject: string;
  headline: string;
  lines: [string, string][];
  detailsUrl: string;
}): RenderedEmail {
  const html = shell(
    i.subject,
    `<p>Hi ${escapeHtml(i.firstName)},</p><p>${escapeHtml(i.headline)}</p>
<table role="presentation" style="background:#f8f7fc;border-radius:6px;padding:12px;width:100%">${i.lines
      .map(([l, v]) => row(l, v))
      .join('')}</table>
<p style="margin-top:16px"><a href="${escapeHtml(i.detailsUrl)}">Open in BudgetFlow</a></p>`,
  );
  const text = [
    `Hi ${i.firstName},`,
    '',
    i.headline,
    ...i.lines.map(([l, v]) => `${l}: ${v}`),
    '',
    `Open in BudgetFlow: ${i.detailsUrl}`,
  ].join('\n');
  return { subject: i.subject, text, html };
}
