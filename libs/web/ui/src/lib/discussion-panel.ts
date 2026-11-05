import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import type {
  CommentView,
  DiscussionThread,
  MentionCandidate,
} from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { DateTimePipe } from './date-time';

/**
 * Screen 060a shared Discussion and Follow bar + side-sheet panel for budget details (021),
 * event details (046) and request details (060). Supports @mentions with read-access checks,
 * 15-minute edit window, tombstone removal, and Follow level menu.
 */
@Component({
  selector: 'bf-discussion-panel',
  imports: [
    DateTimePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatGhost,
  ],
  template: `
    <div class="bf-disc-bar" data-testid="discussion-bar">
      <button
        mat-stroked-button
        type="button"
        (click)="toggleOpen()"
        data-testid="discussion-trigger"
      >
        <mat-icon svgIcon="comment" aria-hidden="true" />
        Discussion ({{ commentCount() }})
      </button>

      @if (thread()?.follow; as f) {
        @if (f.following) {
          <button
            mat-stroked-button
            type="button"
            [matMenuTriggerFor]="followMenu"
            data-testid="follow-trigger"
          >
            <mat-icon svgIcon="bell" aria-hidden="true" />
            {{ f.source === 'owner' ? 'Following (owner)' : 'Following' }}
          </button>
          <mat-menu #followMenu="matMenu">
            <button
              mat-menu-item
              type="button"
              (click)="followChange.emit({ following: true, level: 'all' })"
              data-testid="follow-all"
            >
              All activity {{ f.level === 'all' ? '✓' : '' }}
            </button>
            <button
              mat-menu-item
              type="button"
              (click)="followChange.emit({ following: true, level: 'money_decisions' })"
              data-testid="follow-money"
            >
              Money and decisions only {{ f.level === 'money_decisions' ? '✓' : '' }}
            </button>
            <button
              mat-menu-item
              type="button"
              (click)="followChange.emit({ following: false })"
              data-testid="follow-unfollow"
            >
              Unfollow
            </button>
          </mat-menu>
        } @else {
          <button
            mat-stroked-button
            type="button"
            (click)="followChange.emit({ following: true, level: 'all' })"
            data-testid="follow-trigger"
          >
            <mat-icon svgIcon="bell" aria-hidden="true" />
            Follow
          </button>
        }
      }
    </div>

    @if (open()) {
      <aside
        class="bf-disc-sheet"
        role="region"
        aria-label="Discussion"
        data-testid="discussion-panel"
      >
        <header class="bf-disc-sheet__header">
          <div>
            <h2 class="bf-disc-sheet__title">Discussion · {{ commentCount() }}</h2>
            <p class="bf-disc-sheet__subtitle">{{ thread()?.itemName ?? '' }}</p>
          </div>
          <button
            mat-button
            type="button"
            aria-label="Close discussion"
            (click)="open.set(false)"
          >
            Close
          </button>
        </header>

        @if (error()) {
          <sat-banner variant="important" data-testid="discussion-error">
            <sat-banner-message>{{ error() }}</sat-banner-message>
          </sat-banner>
        }

        @if (loading() && !thread()) {
          <div class="bf-disc-sheet__loading" aria-busy="true">
            <sat-ghost variant="box" [height]="20" fitContainer />
            <sat-ghost variant="box" [height]="48" fitContainer />
          </div>
        } @else if (thread(); as t) {
          @if (t.comments.length === 0 && t.systemEntries.length === 0) {
            <sat-empty-state>
              <h3 satEmptyStateHeadline>No comments yet</h3>
              <p satEmptyStateDescription>
                Start the discussion or mention someone who should know.
              </p>
            </sat-empty-state>
          } @else {
            <ol class="bf-disc-thread" data-testid="discussion-thread">
              @for (c of topComments(); track c.id) {
                <li class="bf-disc-comment" [attr.id]="'comment-' + c.id">
                  @if (c.removedAt) {
                    <p class="bf-disc-comment__tombstone" data-testid="comment-tombstone">
                      Comment removed by {{ c.removedByName ?? c.authorName }},
                      <span data-testid="relative-time">{{
                        c.removedAt | bfDateTime: timezone()
                      }}</span>
                    </p>
                  } @else {
                    <div class="bf-disc-comment__meta">
                      <strong>{{ c.authorName }}</strong>
                      <span>({{ c.authorRole }})</span>
                      <span data-testid="relative-time">{{
                        c.createdAt | bfDateTime: timezone()
                      }}</span>
                      @if (c.editedAt) {
                        <span>· edited</span>
                      }
                    </div>
                    @if (editingId() === c.id) {
                      <div class="bf-disc-edit">
                        <mat-form-field appearance="outline" class="bf-disc-edit__field">
                          <mat-label>Edit comment</mat-label>
                          <textarea
                            matInput
                            rows="2"
                            [(ngModel)]="editBody"
                            name="editBody"
                          ></textarea>
                        </mat-form-field>
                        <div class="bf-disc-comment__actions">
                          <button mat-button type="button" (click)="editingId.set(null)">
                            Cancel
                          </button>
                          <button
                            mat-flat-button
                            type="button"
                            [disabled]="busy() || !editBody.trim()"
                            (click)="saveEdit(c)"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    } @else {
                      <p class="bf-disc-comment__body">{{ c.body }}</p>
                      <div class="bf-disc-comment__actions">
                        @if (t.canComment) {
                          <button mat-button type="button" (click)="startReply(c)">Reply</button>
                        }
                        @if (c.canEdit) {
                          <button
                            mat-button
                            type="button"
                            (click)="startEdit(c)"
                            data-testid="edit-comment"
                          >
                            Edit
                          </button>
                        }
                        @if (c.canDelete) {
                          <button
                            mat-button
                            type="button"
                            (click)="deleteComment.emit(c.id)"
                            data-testid="delete-comment"
                          >
                            Delete
                          </button>
                        }
                      </div>
                    }
                  }

                  @for (rep of repliesFor(c.id); track rep.id) {
                    <div class="bf-disc-reply" [attr.id]="'comment-' + rep.id">
                      @if (rep.removedAt) {
                        <p class="bf-disc-comment__tombstone">
                          Comment removed by {{ rep.removedByName ?? rep.authorName }}
                        </p>
                      } @else {
                        <div class="bf-disc-comment__meta">
                          <strong>{{ rep.authorName }}</strong>
                          <span>({{ rep.authorRole }})</span>
                          <span data-testid="relative-time">{{
                            rep.createdAt | bfDateTime: timezone()
                          }}</span>
                        </div>
                        <p class="bf-disc-comment__body">{{ rep.body }}</p>
                      }
                    </div>
                  }
                </li>
              }
              @for (sys of t.systemEntries; track sys.id) {
                <li class="bf-disc-system">
                  <span>{{ sys.summary }}</span>
                  @if (sys.link) {
                    <a [routerLink]="sys.link">Open</a>
                  }
                </li>
              }
            </ol>
          }

          @if (!t.canComment) {
            <p class="bf-disc-readonly" data-testid="discussion-readonly">
              {{ t.readOnlyReason ?? 'Commenting is read-only for your role.' }}
            </p>
          } @else {
            <div class="bf-disc-composer">
              @if (replyTo(); as r) {
                <div class="bf-disc-replying">
                  <span>Replying to {{ r.authorName }}</span>
                  <button mat-button type="button" (click)="replyTo.set(null)">Cancel</button>
                </div>
              }
              <mat-form-field appearance="outline" class="bf-disc-composer__field">
                <mat-label>Write a comment. Type @ to mention someone.</mat-label>
                <textarea
                  matInput
                  rows="3"
                  [(ngModel)]="newBody"
                  (ngModelChange)="onBodyInput($event)"
                  name="newBody"
                  data-testid="comment-input"
                ></textarea>
              </mat-form-field>

              @if (showMentionPicker()) {
                <div
                  class="bf-mention-picker"
                  role="listbox"
                  aria-label="Mention someone"
                  data-testid="mention-picker"
                >
                  @for (cand of t.mentionCandidates; track cand.personId) {
                    <button
                      type="button"
                      class="bf-mention-picker__row"
                      [class.bf-mention-picker__row--disabled]="!cand.hasAccess"
                      [disabled]="!cand.hasAccess"
                      (click)="pickMention(cand)"
                      [attr.data-testid]="'mention-' + cand.personId"
                    >
                      <span class="bf-mention-picker__name">{{ cand.displayName }}</span>
                      <span class="bf-mention-picker__meta">
                        {{ cand.roleLabel }}{{ cand.locationName ? ' · ' + cand.locationName : '' }}
                        @if (!cand.hasAccess) {
                          · <strong>{{ cand.noAccessReason }}</strong>
                        }
                      </span>
                    </button>
                  }
                </div>
              }

              <div class="bf-disc-composer__actions">
                <button
                  mat-button
                  type="button"
                  (click)="showMentionPicker.set(!showMentionPicker())"
                  data-testid="toggle-mention-picker"
                >
                  @ Mention
                </button>
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy() || !newBody.trim()"
                  (click)="submit()"
                  data-testid="submit-comment"
                >
                  Comment
                </button>
              </div>
            </div>
          }
        }
      </aside>
    }
  `,
  styles: `
    .bf-disc-bar {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .bf-disc-sheet {
      margin-top: 16px;
      padding: 16px 20px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-surface-container-lowest);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-disc-sheet__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      padding-bottom: 8px;
    }
    .bf-disc-sheet__title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    .bf-disc-sheet__subtitle {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-disc-thread {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-disc-comment {
      padding: 10px 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bf-disc-comment__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: baseline;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-disc-comment__meta strong {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
    }
    .bf-disc-comment__body {
      margin: 4px 0;
      white-space: pre-wrap;
      font: var(--mat-sys-body-medium);
    }
    .bf-disc-comment__tombstone {
      margin: 0;
      font: var(--mat-sys-body-small);
      font-style: italic;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-disc-comment__actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .bf-disc-reply {
      margin-inline-start: 16px;
      margin-top: 8px;
      padding-inline-start: 12px;
      border-inline-start: 2px solid var(--mat-sys-outline-variant);
    }
    .bf-disc-system {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container);
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-disc-readonly {
      margin: 0;
      padding: 10px 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-disc-composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-disc-composer__field,
    .bf-disc-edit__field {
      width: 100%;
    }
    .bf-disc-composer__actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .bf-disc-replying {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-mention-picker {
      display: flex;
      flex-direction: column;
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-mention-picker__row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      text-align: start;
      cursor: pointer;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-mention-picker__row:hover:not(:disabled) {
      background: var(--mat-sys-surface-container-low);
    }
    .bf-mention-picker__row--disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .bf-mention-picker__name {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface);
    }
    .bf-mention-picker__meta {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscussionPanel {
  readonly thread = input<DiscussionThread | undefined>(undefined);
  readonly loading = input(false);
  readonly busy = input(false);
  readonly error = input('');
  readonly timezone = input('UTC');
  readonly initialOpen = input(false);

  readonly postComment = output<{
    body: string;
    parentCommentId?: string;
    mentionedPersonIds?: string[];
  }>();
  readonly editComment = output<{ commentId: string; body: string }>();
  readonly deleteComment = output<string>();
  readonly followChange = output<{
    following: boolean;
    level?: 'all' | 'money_decisions';
  }>();

  protected readonly open = signal(false);
  protected readonly showMentionPicker = signal(false);
  protected readonly mentionedIds = signal<string[]>([]);
  protected readonly replyTo = signal<CommentView | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected newBody = '';
  protected editBody = '';

  constructor() {
    queueMicrotask(() => {
      if (this.initialOpen()) this.open.set(true);
    });
  }

  protected readonly commentCount = computed(() => this.thread()?.commentCount ?? 0);
  protected readonly topComments = computed(() =>
    (this.thread()?.comments ?? []).filter((c) => !c.parentCommentId),
  );

  protected repliesFor(parentId: string): CommentView[] {
    return (this.thread()?.comments ?? []).filter((c) => c.parentCommentId === parentId);
  }

  protected toggleOpen(): void {
    this.open.set(!this.open());
  }

  protected onBodyInput(val: string): void {
    if (val.endsWith('@')) {
      this.showMentionPicker.set(true);
    }
  }

  protected pickMention(cand: MentionCandidate): void {
    if (!cand.hasAccess) return;
    const prefix = this.newBody.endsWith('@') ? this.newBody : `${this.newBody} @`;
    this.newBody = `${prefix}${cand.displayName} `;
    this.mentionedIds.set([...new Set([...this.mentionedIds(), cand.personId])]);
    this.showMentionPicker.set(false);
  }

  protected startReply(c: CommentView): void {
    this.replyTo.set(c);
  }

  protected startEdit(c: CommentView): void {
    this.editingId.set(c.id);
    this.editBody = c.body;
  }

  protected submit(): void {
    if (!this.newBody.trim()) return;
    const reply = this.replyTo();
    this.postComment.emit({
      body: this.newBody.trim(),
      ...(reply ? { parentCommentId: reply.id } : {}),
      ...(this.mentionedIds().length ? { mentionedPersonIds: this.mentionedIds() } : {}),
    });
    this.newBody = '';
    this.mentionedIds.set([]);
    this.replyTo.set(null);
  }

  protected saveEdit(c: CommentView): void {
    if (!this.editBody.trim()) return;
    this.editComment.emit({ commentId: c.id, body: this.editBody.trim() });
    this.editingId.set(null);
  }
}
