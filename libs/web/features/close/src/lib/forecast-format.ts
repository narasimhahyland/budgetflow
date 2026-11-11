import type { ForecastCycle, ForecastMethod, ForecastStatus } from '@bf/contracts';
import type { Tag } from './close-format';

/** The commentary the API asks for on a variance above the cycle threshold. */
export const COMMENTARY_MIN = 20;

export const METHOD_LABELS: Record<ForecastMethod, string> = {
  run_rate: 'Run-rate',
  committed_pipeline: 'Committed plus pipeline',
  owner_input: 'Owner input',
};

/**
 * Forecast line statuses. "Commentary required" is a warning because the owner still has to act;
 * "Superseded" is quiet because a later cycle already replaced it.
 */
export const FORECAST_STATUS: Record<ForecastStatus, Tag> = {
  draft: { tone: 'neutral', text: 'Draft', icon: 'note_edit' },
  submitted: { tone: 'neutral', text: 'Submitted', icon: 'send' },
  commentary_required: { tone: 'warning', text: 'Commentary required', icon: 'comment' },
  accepted: { tone: 'success', text: 'Accepted', icon: 'circle_check' },
  superseded: { tone: 'neutral-quiet', text: 'Superseded', icon: 'restore' },
};

export const CYCLE_STATUS: Record<ForecastCycle['status'], Tag> = {
  open: { tone: 'success', text: 'Open', icon: 'circle_check' },
  closed: { tone: 'neutral', text: 'Closed', icon: 'archive' },
};

/** The direction the API wrote out, so the reader never has to work it out from a sign or a colour. */
export const DIRECTION_WORDS: Record<'under' | 'over' | 'on', string> = {
  under: 'under budget',
  over: 'over budget',
  on: 'on budget',
};

/** Segments of the progress bar, in the order a line moves through the cycle. */
export const PROGRESS_SEGMENTS = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'commentaryRequired', label: 'Commentary required' },
  { key: 'draft', label: 'Draft' },
  { key: 'notStarted', label: 'Not started' },
] as const;
