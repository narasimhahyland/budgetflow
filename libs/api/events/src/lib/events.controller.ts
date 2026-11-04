import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AddParticipantsBody,
  CreateEventBody,
  CreateEventCommitmentBody,
  EventListQuery,
  ReasonBody,
  UpdateEventBody,
  type CloseEventResponse,
  type CofundingBoard,
  type EventCommitment,
  type EventDetail,
  type EventList,
  type EventParticipant,
  type UtilizationReport,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { EventsService } from './events.service';
import { InsightsService } from './insights.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}
interface Result<T> {
  body: T;
  replayed: boolean;
}

const Uuid = z.uuid();

const send = <T>(res: ResponseLike, r: Result<T>): T => {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
};

@Controller('api')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly insights: InsightsService,
  ) {}

  @Get('events')
  list(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<EventList> {
    return this.events.list(actor, parseWith(EventListQuery, raw));
  }

  @Get('events/cofunding-board')
  board(@CurrentActor() actor: RequestActor): Promise<CofundingBoard> {
    return this.insights.board(actor);
  }

  @Get('utilization')
  utilization(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<UtilizationReport> {
    const q = parseWith(
      z.object({ groupBy: z.enum(['location', 'team', 'budget']).optional() }).strict(),
      raw,
    );
    return this.insights.utilization(actor, q.groupBy ?? 'location');
  }

  @Post('events')
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return send(
      res,
      await this.events.create(actor, parseWith(CreateEventBody, body), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Get('events/:eventId')
  get(@CurrentActor() actor: RequestActor, @Param('eventId') raw: string): Promise<EventDetail> {
    return this.events.get(actor, parseWith(Uuid, raw));
  }

  @Patch('events/:eventId')
  async update(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return send(
      res,
      await this.events.update(actor, parseWith(Uuid, raw), parseWith(UpdateEventBody, body), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  private async run(
    verb: 'submit' | 'confirm-funding' | 'start' | 'complete' | 'cancel',
    actor: RequestActor,
    raw: string,
    body: unknown,
    ctx: { idempotencyKey: string; requestId: string | null },
    res: ResponseLike,
  ): Promise<EventDetail> {
    const id = parseWith(Uuid, raw);
    const reason = parseWith(ReasonBody, body ?? {}).reason;
    const r =
      verb === 'submit'
        ? await this.events.submit(actor, id, ctx)
        : verb === 'confirm-funding'
          ? await this.events.confirmFunding(actor, id, reason, ctx)
          : verb === 'start'
            ? await this.events.start(actor, id, reason, ctx)
            : verb === 'complete'
              ? await this.events.complete(actor, id, reason, ctx)
              : await this.events.cancel(actor, id, reason, ctx);
    return send(res, r);
  }

  @Post('events/:eventId/submit')
  @HttpCode(200)
  submit(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return this.run('submit', actor, raw, body, { idempotencyKey, requestId }, res);
  }

  @Post('events/:eventId/confirm-funding')
  @HttpCode(200)
  confirmFunding(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return this.run('confirm-funding', actor, raw, body, { idempotencyKey, requestId }, res);
  }

  @Post('events/:eventId/start')
  @HttpCode(200)
  start(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return this.run('start', actor, raw, body, { idempotencyKey, requestId }, res);
  }

  @Post('events/:eventId/complete')
  @HttpCode(200)
  complete(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return this.run('complete', actor, raw, body, { idempotencyKey, requestId }, res);
  }

  @Post('events/:eventId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return this.run('cancel', actor, raw, body, { idempotencyKey, requestId }, res);
  }

  @Post('events/:eventId/close')
  @HttpCode(200)
  async close(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<CloseEventResponse> {
    const reason = parseWith(ReasonBody, body ?? {}).reason;
    return send(
      res,
      await this.events.close(actor, parseWith(Uuid, raw), reason, { idempotencyKey, requestId }),
    );
  }

  @Get('events/:eventId/participants')
  participants(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<{ items: EventParticipant[] }> {
    return this.events.participants(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/participants')
  @HttpCode(200)
  async addParticipants(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ items: EventParticipant[] }> {
    return send(
      res,
      await this.events.addParticipants(
        actor,
        parseWith(Uuid, raw),
        parseWith(AddParticipantsBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Delete('events/:eventId/participants/:participantId')
  async removeParticipant(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('participantId') rawP: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ items: EventParticipant[] }> {
    return send(
      res,
      await this.events.removeParticipant(actor, parseWith(Uuid, raw), parseWith(Uuid, rawP), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Post('events/:eventId/commitments')
  @HttpCode(201)
  async commit(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventCommitment> {
    return send(
      res,
      await this.events.commit(
        actor,
        parseWith(Uuid, raw),
        parseWith(CreateEventCommitmentBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/commitments/:commitmentId/release')
  @HttpCode(200)
  async release(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('commitmentId') rawC: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventCommitment> {
    const reason = parseWith(ReasonBody, body ?? {}).reason;
    return send(
      res,
      await this.events.releaseCommitment(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawC),
        reason,
        { idempotencyKey, requestId },
      ),
    );
  }

  @Get('events/:eventId/activity')
  activity(@CurrentActor() actor: RequestActor, @Param('eventId') raw: string) {
    return this.events.activity(actor, parseWith(Uuid, raw));
  }
}
