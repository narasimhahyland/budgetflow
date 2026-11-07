// Embeddable widgets (102d), the sharpest edge in this phase. A widget carries no authorization: the
// viewer comes from their own token, the host site only decides whether the frame may render, a
// widget id from another tenant does not exist, and nothing here writes financial state.
import { expect, test } from '@playwright/test';
import { WidgetContent, WidgetList, WidgetView } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { ALLOWED_ORIGIN, OTHER_ORIGIN } from './support';

async function createWidget(
  request: import('@playwright/test').APIRequestContext,
  data: Record<string, unknown> = {},
) {
  return expectContract(
    await request.post('/api/ecosystem/widgets', {
      headers: await mutate('org-admin'),
      data: {
        name: `scenario widget ${randomUUID().slice(0, 8)}`,
        kind: 'team_budget',
        allowedOrigins: [ALLOWED_ORIGIN],
        showAmounts: true,
        eventCount: 3,
        ...data,
      },
    }),
    201,
    WidgetView,
  );
}

test.describe('configuring widgets', () => {
  test('a widget lists its exact sites and the frame policy built from them', async ({
    request,
  }) => {
    const widget = await createWidget(request);
    expect(widget.allowedOrigins).toEqual([ALLOWED_ORIGIN]);
    expect(widget.frameAncestors).toBe(`frame-ancestors ${ALLOWED_ORIGIN}`);
    expect(widget.embedSnippet).toContain(widget.id);
    // A policy that names no site is the one thing a widget must never have.
    expect(widget.frameAncestors).not.toContain('*');

    const list = await expectContract(
      await request.get('/api/ecosystem/widgets', { headers: await as('org-admin') }),
      200,
      WidgetList,
    );
    expect(list.canManage).toBe(true);
    expect(list.items.map((w) => w.id)).toContain(widget.id);
  });

  test('a wildcard site is refused: it would let any page frame the widget', async ({
    request,
  }) => {
    for (const bad of ['*', 'https://*.example.test', 'https://intranet.example.test/team']) {
      await expectProblem(
        await request.post('/api/ecosystem/widgets', {
          headers: await mutate('org-admin'),
          data: {
            name: 'should not exist',
            kind: 'team_budget',
            allowedOrigins: [bad],
            showAmounts: true,
            eventCount: 3,
          },
        }),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  test('an employee cannot configure widgets', async ({ request }) => {
    await expectProblem(
      await request.post('/api/ecosystem/widgets', {
        headers: await mutate('employee'),
        data: {
          name: 'should not exist',
          kind: 'team_budget',
          allowedOrigins: [ALLOWED_ORIGIN],
          showAmounts: true,
          eventCount: 3,
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('what a viewer gets', () => {
  test('the viewer comes from their token, and the host site must be on the list', async ({
    request,
  }) => {
    const widget = await createWidget(request);
    const content = await expectContract(
      await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
        headers: await as('finance-admin', { origin: ALLOWED_ORIGIN }),
      }),
      200,
      WidgetContent,
    );
    expect(content.viewerName).toBeTruthy();
    expect(content.teamBudget).not.toBeNull();
    expect(content.frameAncestors).toBe(`frame-ancestors ${ALLOWED_ORIGIN}`);

    // The same token from a site nobody listed gets nothing, even though the viewer is allowed.
    await expectProblem(
      await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
        headers: await as('finance-admin', { origin: OTHER_ORIGIN }),
      }),
      403,
      'WIDGET_ORIGIN_NOT_ALLOWED',
    );
  });

  test('a copied snippet cannot name a tenant, a person or a budget', async ({ request }) => {
    const widget = await createWidget(request);
    // Query parameters that look like identity are not a way in: the response is the employee's own
    // view, and the strict query schema would refuse them outright.
    const res = await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
      headers: await as('employee', { origin: ALLOWED_ORIGIN }),
      params: {
        tenantId: SEED.tenants.globex,
        personId: 'someone-else',
        budgetId: SEED.budgets.bengaluru,
      },
    });
    const content = await expectContract(res, 200, WidgetContent);
    // The employee owns no budget, so the card is the neutral line, not someone else's figures.
    expect(content.teamBudget).toBeNull();
    expect(content.emptyMessage).toBe('No shared team budget.');
    expect(JSON.stringify(content)).not.toContain(SEED.budgets.bengaluru);
  });

  test('a widget belonging to another tenant does not exist', async ({ request }) => {
    const widget = await createWidget(request);
    await expectProblem(
      await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
        headers: await as('globex-admin', { origin: ALLOWED_ORIGIN }),
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('hiding amounts removes the figures, not just the formatting', async ({ request }) => {
    const shown = await createWidget(request, { showAmounts: true });
    const hidden = await createWidget(request, { showAmounts: false });
    const withFigures = await expectContract(
      await request.get(`/api/ecosystem/widgets/${shown.id}/content`, {
        headers: await as('finance-admin', { origin: ALLOWED_ORIGIN }),
      }),
      200,
      WidgetContent,
    );
    const withoutFigures = await expectContract(
      await request.get(`/api/ecosystem/widgets/${hidden.id}/content`, {
        headers: await as('finance-admin', { origin: ALLOWED_ORIGIN }),
      }),
      200,
      WidgetContent,
    );
    expect(withFigures.teamBudget?.available).not.toBeNull();
    expect(withoutFigures.teamBudget?.available).toBeNull();
    expect(withoutFigures.teamBudget?.authorized).toBeNull();
    expect(withoutFigures.teamBudget?.headline).toBe('Your team has budget for activities.');
  });

  test('a paused widget renders nothing, and the blocked sites are reported back to the admin', async ({
    request,
  }) => {
    const widget = await createWidget(request);
    await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
      headers: await as('finance-admin', { origin: OTHER_ORIGIN }),
    });
    const list = await expectContract(
      await request.get('/api/ecosystem/widgets', { headers: await as('org-admin') }),
      200,
      WidgetList,
    );
    const seen = list.items.find((w) => w.id === widget.id);
    expect(seen?.blockedOriginsLast30Days.map((b) => b.origin)).toContain(OTHER_ORIGIN);

    await request.patch(`/api/ecosystem/widgets/${widget.id}`, {
      headers: await mutate('org-admin'),
      data: { status: 'paused' },
    });
    await expectProblem(
      await request.get(`/api/ecosystem/widgets/${widget.id}/content`, {
        headers: await as('finance-admin', { origin: ALLOWED_ORIGIN }),
      }),
      409,
      'WIDGET_PAUSED',
    );
  });
});
