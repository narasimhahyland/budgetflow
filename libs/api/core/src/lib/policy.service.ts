import { can, type Action, type Actor, type Decision, type Resource } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { ApiProblem } from './problem';

/**
 * The single authorization point: PolicyService.can(actor, action, resource), evaluated before every
 * read and write. Resources the actor cannot see answer 404; visible but forbidden answers 403.
 */
@Injectable()
export class PolicyService {
  can(actor: Actor, action: Action, resource: Resource): Decision {
    return can(actor, action, resource);
  }

  assert(actor: Actor, action: Action, resource: Resource, what = 'resource'): void {
    const d = can(actor, action, resource);
    if (d.allowed) return;
    throw d.visible ? ApiProblem.forbidden() : ApiProblem.notFound(what);
  }

  allowed(actor: Actor, resource: Resource, actions: readonly Action[]): Action[] {
    return actions.filter((a) => can(actor, a, resource).allowed);
  }
}
