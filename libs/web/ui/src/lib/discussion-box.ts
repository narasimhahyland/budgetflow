import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import type { DiscussionItemType, DiscussionThread } from '@bf/contracts';
import { ApiService, SessionStore } from '@bf/web/data-access';
import { DiscussionPanel } from './discussion-panel';

@Component({
  selector: 'bf-discussion-box',
  imports: [DiscussionPanel],
  template: `
    <bf-discussion-panel
      [thread]="threadValue()"
      [loading]="thread.isLoading()"
      [busy]="busy()"
      [error]="error()"
      [timezone]="session.timezone()"
      [initialOpen]="initialOpen()"
      (postComment)="onPost($event)"
      (editComment)="onEdit($event)"
      (deleteComment)="onDelete($event)"
      (followChange)="onFollow($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscussionBox {
  private readonly api = inject(ApiService).client;
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  readonly itemType = input.required<DiscussionItemType>();
  readonly itemId = input.required<string>();
  protected readonly initialOpen = computed(
    () => this.route.snapshot.queryParamMap.get('discussion') === 'open',
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly thread = resource({
    params: () => ({ itemType: this.itemType(), itemId: this.itemId() }),
    loader: async ({ params }): Promise<DiscussionThread> => {
      const r = await this.api.getDiscussion({ params });
      if (!r.ok) throw new Error(r.problem?.detail ?? 'Could not load discussion');
      return r.data;
    },
  });
  protected readonly threadValue = computed(() =>
    this.thread.hasValue() ? this.thread.value() : undefined,
  );

  protected async onPost(e: {
    body: string;
    parentCommentId?: string;
    mentionedPersonIds?: string[];
  }): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.createComment({
        params: { itemType: this.itemType(), itemId: this.itemId() },
        body: e,
      });
      if (!r.ok) {
        this.error.set(r.problem?.detail ?? 'Could not post comment');
        return;
      }
      this.snack.open('Comment posted', undefined, { duration: 3000 });
      this.thread.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async onEdit(e: { commentId: string; body: string }): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.updateComment({
        params: { commentId: e.commentId },
        body: { body: e.body },
      });
      if (!r.ok) {
        this.error.set(r.problem?.detail ?? 'Could not update comment');
        return;
      }
      this.snack.open('Comment updated', undefined, { duration: 3000 });
      this.thread.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async onDelete(commentId: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.removeComment({ params: { commentId } });
      if (!r.ok) {
        this.error.set(r.problem?.detail ?? 'Could not remove comment');
        return;
      }
      this.snack.open('Comment removed', undefined, { duration: 3000 });
      this.thread.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async onFollow(e: {
    following: boolean;
    level?: 'all' | 'money_decisions';
  }): Promise<void> {
    const r = await this.api.updateFollow({
      params: { itemType: this.itemType(), itemId: this.itemId() },
      body: e,
    });
    if (r.ok) {
      this.snack.open(
        e.following ? 'Following item' : 'Unfollowed item',
        undefined,
        { duration: 2500 },
      );
      this.thread.reload();
    }
  }
}
