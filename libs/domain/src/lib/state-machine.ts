import { err, ok, type Result } from './result';

export interface Transition<S extends string, E extends string> {
  from: S | readonly S[];
  event: E;
  to: S;
}

export interface Machine<S extends string, E extends string> {
  name: string;
  transitions: readonly Transition<S, E>[];
  /** Next state, or INVALID_TRANSITION with the allowed events from `state`. */
  next(state: S, event: E): Result<S>;
  allowedEvents(state: S): E[];
}

export function defineMachine<S extends string, E extends string>(def: {
  name: string;
  transitions: readonly Transition<S, E>[];
}): Machine<S, E> {
  const froms = (t: Transition<S, E>): readonly S[] =>
    Array.isArray(t.from) ? (t.from as readonly S[]) : [t.from as S];
  const allowedEvents = (state: S): E[] => [
    ...new Set(def.transitions.filter((t) => froms(t).includes(state)).map((t) => t.event)),
  ];
  return {
    name: def.name,
    transitions: def.transitions,
    allowedEvents,
    next(state, event) {
      const t = def.transitions.find((x) => x.event === event && froms(x).includes(state));
      if (t) return ok(t.to);
      return err(
        'INVALID_TRANSITION',
        `A ${def.name} that is ${state.replace(/_/g, ' ')} cannot ${event.replace(/_/g, ' ')}.`,
        {
          machine: def.name,
          state,
          event,
          allowed: allowedEvents(state).join(','),
        },
      );
    },
  };
}
