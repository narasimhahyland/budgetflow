// The connector for AI assistants (092c). It obeys the Phase 13 rules because it reuses the Phase 13
// machinery: retrieval is scoped through PolicyService, what leaves the server is cut to the
// minimization allow-list, every call writes an ai_query_log row, and there is no tool that submits,
// approves, applies a control or moves money.
import { expect, test } from '@playwright/test';
import {
  AiQueryLogList,
  AssistantConnectorView,
  AuditEventList,
  McpToolCallResult,
  McpToolListResult,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { callTool, connectAssistant, withToken } from './support';
import { AI_LIVE, AI_LIVE_REASON } from '../ai/support';

test.skip(!AI_LIVE, AI_LIVE_REASON);

const READ_TOOLS = [
  'list_my_budgets',
  'get_budget_balance',
  'list_my_requests',
  'get_request_status',
  'list_waiting_approvals',
  'search_events',
] as const;

test.describe('the connector', () => {
  test('publishes only read-only tools and names what it cannot do', async ({ request }) => {
    const view = await expectContract(
      await request.get('/api/ecosystem/assistants', {
        headers: await as('integration-admin'),
      }),
      200,
      AssistantConnectorView,
    );
    expect(view.enabled).toBe(true);
    expect(view.aiFeatureFlagKey).toBe('ai.mcp');
    expect(view.aiFeatureEnabled).toBe(true);
    expect(view.maxRecordsPerCall).toBe(50);
    expect(view.tools.map((t) => t.tool).sort()).toEqual([...READ_TOOLS].sort());
    expect(view.neverDoes.join(' ')).toContain('cannot approve');
  });

  test('an assistant app the company has not allowed cannot connect', async ({ request }) => {
    await expectProblem(
      await request.post('/api/ecosystem/assistants/connections', {
        headers: await mutate('event-organizer'),
        data: {
          appKey: 'some-other-assistant',
          label: 'should not exist',
          tools: ['list_my_budgets'],
          consentAcknowledged: true,
        },
      }),
      403,
      'ASSISTANT_APP_NOT_ALLOWED',
    );
  });

  test('connecting records the consent text the person agreed to', async ({ request }) => {
    const { id } = await connectAssistant(request, 'event-organizer', ['list_my_budgets']);
    const events = await expectContract(
      await request.get('/api/audit/events', {
        headers: await as('auditor'),
        params: { resourceType: 'ecosystem_connection', resourceId: id, limit: 50 },
      }),
      200,
      AuditEventList,
    );
    expect(
      events.items.filter((e) => e.action === 'ecosystem.connection_created').length,
      'exactly one audit entry for the connection',
    ).toBe(1);
  });
});

test.describe('tool calls', () => {
  test('the tool list offers only what the company and the connection both allow', async ({
    request,
  }) => {
    const { token } = await connectAssistant(request, 'event-organizer', [
      'list_my_budgets',
      'search_events',
    ]);
    const list = await expectContract(
      await request.post('/api/mcp/v1/tools/list', { headers: withToken(token) }),
      200,
      McpToolListResult,
    );
    expect(list.tools.map((t) => t.name).sort()).toEqual(['list_my_budgets', 'search_events']);
    expect(list.tools.every((t) => t.readOnly)).toBe(true);
    expect(list.notice).toContain('no tools to submit, approve');

    // A tool the company offers but this connection was not granted is still refused.
    await expectProblem(
      await callTool(request, token, 'list_waiting_approvals'),
      403,
      'ASSISTANT_TOOL_DISABLED',
    );
  });

  test('a budget in another tenant answers with the neutral not-found wording, not a denial', async ({
    request,
  }) => {
    const { token } = await connectAssistant(request, 'finance-admin', ['get_budget_balance']);
    const mine = await expectContract(
      await callTool(request, token, 'get_budget_balance', {
        budgetId: SEED.budgets.bengaluru,
      }),
      200,
      McpToolCallResult,
    );
    // The Hyland lookup must succeed, otherwise the Globex assertion below proves nothing.
    expect(mine.recordCount).toBe(1);
    expect(mine.records[0]['id']).toBe(SEED.budgets.bengaluru);

    const theirs = await expectContract(
      await callTool(request, token, 'get_budget_balance', {
        budgetId: SEED.budgets.globexOperations,
      }),
      200,
      McpToolCallResult,
    );
    expect(theirs.recordCount).toBe(0);
    expect(theirs.notice).toBe('Not found in budgets you can see.');
  });

  test('an employee sees nothing an owner sees, through the same tool', async ({ request }) => {
    const owner = await connectAssistant(request, 'finance-admin', ['list_my_budgets']);
    const employee = await connectAssistant(request, 'employee', ['list_my_budgets']);
    const ownerSees = await expectContract(
      await callTool(request, owner.token, 'list_my_budgets'),
      200,
      McpToolCallResult,
    );
    const employeeSees = await expectContract(
      await callTool(request, employee.token, 'list_my_budgets'),
      200,
      McpToolCallResult,
    );
    expect(ownerSees.recordCount).toBeGreaterThan(0);
    expect(employeeSees.recordCount).toBe(0);
  });

  test('an owner sees their own subtree and not a budget belonging to someone else', async ({
    request,
  }) => {
    // The Bengaluru location manager owns one subtree. The central contingency reserve is a
    // separate root owned by finance, so it must not appear however the tool is called.
    const { token } = await connectAssistant(request, 'location-manager', ['list_my_budgets']);
    const mine = await expectContract(
      await callTool(request, token, 'list_my_budgets'),
      200,
      McpToolCallResult,
    );
    const ids = mine.records.map((r) => r['id']);
    expect(ids).toContain(SEED.budgets.bengaluru);
    expect(ids).not.toContain(SEED.budgets.contingency);
    expect(ids).not.toContain(SEED.budgets.europe);
  });

  test('records carry only the allowed field names, never an email address', async ({
    request,
  }) => {
    const { token } = await connectAssistant(request, 'finance-admin', ['get_budget_balance']);
    const result = await expectContract(
      await callTool(request, token, 'get_budget_balance', { budgetId: SEED.budgets.bengaluru }),
      200,
      McpToolCallResult,
    );
    const record = result.records[0];
    expect(Object.keys(record)).toContain('availableMinor');
    // Nothing that looks like contact detail survives minimization, whatever it is called.
    const text = JSON.stringify(result);
    expect(text).not.toContain('@example.test');
    expect(Object.keys(record).some((k) => /email|phone|address/i.test(k))).toBe(false);
  });

  test('every call writes one AI query log row with the scope it applied', async ({ request }) => {
    const before = await expectContract(
      await request.get('/api/ai/query-log', {
        headers: await as('auditor'),
        params: { feature: 'mcp', limit: 200 },
      }),
      200,
      AiQueryLogList,
    );
    const { token } = await connectAssistant(request, 'finance-admin', ['list_my_budgets']);
    await callTool(request, token, 'list_my_budgets');
    const after = await expectContract(
      await request.get('/api/ai/query-log', {
        headers: await as('auditor'),
        params: { feature: 'mcp', limit: 200 },
      }),
      200,
      AiQueryLogList,
    );
    expect(after.items.length).toBe(before.items.length + 1);
    const entry = after.items[0];
    expect(entry.channel).toBe('mcp');
    expect(entry.feature).toBe('mcp');
    expect(entry.scope.action).toBe('budget.read');
    expect(entry.sentFields.length).toBeGreaterThan(0);
  });

  test('there is no tool that decides anything, and the surface refuses an invented one', async ({
    request,
  }) => {
    const { token } = await connectAssistant(request, 'finance-admin', ['list_waiting_approvals']);
    const waiting = await expectContract(
      await callTool(request, token, 'list_waiting_approvals'),
      200,
      McpToolCallResult,
    );
    expect(waiting.tool).toBe('list_waiting_approvals');
    // The contract has no decide, submit or control tool: an assistant asking for one is rejected
    // by validation before anything is read.
    for (const invented of ['approve_request', 'submit_request', 'freeze_budget']) {
      await expectProblem(
        await request.post('/api/mcp/v1/tools/call', {
          headers: withToken(token),
          data: { tool: invented, arguments: {} },
        }),
        400,
        'VALIDATION_FAILED',
      );
    }
  });
});
