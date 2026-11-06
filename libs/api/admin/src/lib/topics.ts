/** Queue and outbox topics this module owns. The worker registers them in `JobsService`. */

/** The nightly retention run (worker schedule). */
export const RETENTION_SWEEP_TOPIC = 'admin.retention.nightly';

/** Outbox topic for a bulk owner invitation (103a). */
export const OWNER_INVITED_TOPIC = 'admin.owner_invited';
