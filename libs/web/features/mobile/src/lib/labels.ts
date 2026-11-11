import type { ChannelDeliveryLogView, NotificationChannel } from '@bf/contracts';
import type { StatusView } from '@bf/web/ui';

/** Plain-English names for notification channels. */
export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  email: 'Email',
  push: 'Push',
  slack: 'Slack',
  teams: 'Microsoft Teams',
};

export const channelLabel = (c: string): string =>
  CHANNEL_LABEL[c as NotificationChannel] ?? sentence(c);

/** Delivery outcomes as status tags (section 5: text and icon, never colour alone). */
export const DELIVERY_STATUS: Record<ChannelDeliveryLogView['status'], StatusView> = {
  queued: { label: 'Queued', tone: 'neutral', icon: 'clock' },
  sent: { label: 'Sent', tone: 'success', icon: 'circle_check' },
  updated: { label: 'Updated', tone: 'info', icon: 'sync' },
  retried: { label: 'Retried', tone: 'warning', icon: 'refresh' },
  failed: { label: 'Failed', tone: 'important', icon: 'error' },
};

// Display names for role ids (labels only; authorization never uses them). Mirrors the shell's
// ROLE_LABELS, which feature libraries cannot import.
const ROLE_LABEL: Record<string, string> = {
  'super-admin': 'Super admin',
  'org-admin': 'Organization admin',
  ceo: 'CEO',
  'finance-admin': 'Finance admin',
  'finance-controller': 'Finance controller',
  'budget-owner': 'Budget owner',
  'department-head': 'Department head',
  'regional-manager': 'Regional manager',
  'location-manager': 'Location manager',
  'event-organizer': 'Event organizer',
  employee: 'Employee',
  auditor: 'Auditor',
  'integration-admin': 'Integration admin',
  analyst: 'Read-only analyst',
};

export const roleLabel = (r: string): string => ROLE_LABEL[r] ?? sentence(r);

/** "approval.assigned" → "Approval assigned"; for event keys the API sends without a label. */
export function sentence(key: string): string {
  const words = key.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Two initials for `sat-avatar` ("Lena Fischer" → "LF"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}
