import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  Public,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import { DocumentsService } from '@bf/api/documents';
import {
  CreateDelegationRequest,
  DecisionRequest,
  EmailActionRequest,
  InboxQuery,
  type ApprovalInbox,
  type ApprovalTaskDetail,
  type DecisionResponse,
  type DelegationView,
  type EmailActionPreview,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const TaskId = z.uuid();
const Token = z.string().min(20).max(300);

@Controller('api/approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('inbox')
  inbox(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<ApprovalInbox> {
    const q = parseWith(InboxQuery, raw);
    return this.approvals.inbox(actor, q.tab ?? 'assigned', q.limit ?? 50);
  }

  @Get('tasks/:taskId')
  task(
    @CurrentActor() actor: RequestActor,
    @Param('taskId') raw: string,
  ): Promise<ApprovalTaskDetail> {
    return this.approvals.task(actor, parseWith(TaskId, raw), (tx, type, id) =>
      this.documents.listTx(tx, type, id),
    );
  }

  @Post('tasks/:taskId/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('taskId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DecisionResponse> {
    const body = parseWith(DecisionRequest, rawBody);
    const r = await this.approvals.decide(actor, parseWith(TaskId, raw), body, {
      idempotencyKey,
      requestId,
      channel: body.channel ?? 'web',
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Public()
  @Get('email-actions/:token')
  preview(@Param('token') raw: string): Promise<EmailActionPreview> {
    return this.approvals.previewEmail(parseWith(Token, raw));
  }

  @Public()
  @Post('email-actions')
  @HttpCode(200)
  execute(@Body() body: unknown, @RequestId() requestId: string | null): Promise<DecisionResponse> {
    return this.approvals.executeEmail(parseWith(EmailActionRequest, body), requestId);
  }

  @Get('delegations')
  delegations(@CurrentActor() actor: RequestActor): Promise<{ items: DelegationView[] }> {
    return this.approvals.delegations(actor);
  }

  @Post('delegations')
  @HttpCode(201)
  async delegate(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DelegationView> {
    const r = await this.approvals.createDelegation(
      actor,
      parseWith(CreateDelegationRequest, body),
      {
        idempotencyKey,
        requestId,
      },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
