'use client';

import { useState } from 'react';
import { AlertCircle, Check, CheckCheck, Pencil, Reply, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react';
import type { ChatMessage, ReactionType } from '@/hooks/useConversationChannel';
import { REACTION_EMOJI, REACTION_TYPES } from '@/lib/chatReactions';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Same grouping mobile's aggregateReactions (components/chat/MessageBubble.tsx)
// does: message.reactions is a flat {userId, reaction}[] from the data layer,
// not pre-grouped, so every bubble aggregates it into counts itself.
function aggregateReactions(reactions: ChatMessage['reactions']): { reaction: ReactionType; count: number }[] {
  const counts = new Map<ReactionType, number>();
  for (const r of reactions) counts.set(r.reaction, (counts.get(r.reaction) ?? 0) + 1);
  return Array.from(counts.entries()).map(([reaction, count]) => ({ reaction, count }));
}

type ReplyPreview = { text: string | null; legacyPhoto: boolean; senderIsMine: boolean } | null;

type Props = {
  message: ChatMessage;
  isMine: boolean;
  meId: string;
  seen: boolean;
  replyPreview: ReplyPreview;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: string, reaction: ReactionType) => void;
  onRetry: (id: string) => void;
  onDismissFailed: (id: string) => void;
};

// Web has no long-press gesture, so reactions/reply use the same
// hover-reveal affordance already established here for edit/delete, instead
// of trying to replicate mobile's bottom-sheet MessageActionSheet.
function ReactionPicker({ mine, onPick }: { mine: ReactionType | undefined; onPick: (r: ReactionType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="React to message"
        className="rounded-full p-1.5 text-textMuted hover:bg-inputBackground"
      >
        <SmilePlus size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} role="presentation" />
          <div className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-pill border border-border bg-surface p-1 shadow-lg">
            {REACTION_TYPES.map((r) => (
              <button
                key={r}
                onClick={() => {
                  onPick(r);
                  setOpen(false);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${mine === r ? 'bg-primary/10' : ''}`}
              >
                {REACTION_EMOJI[r]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MessageBubble({ message, isMine, meId, seen, replyPreview, onEdit, onDelete, onReply, onReact, onRetry, onDismissFailed }: Props) {
  const isDeleted = !!message.deletedAt;
  const canAct = !isDeleted && message.status !== 'sending';
  const reactions = aggregateReactions(message.reactions);
  const myReaction = message.reactions.find((r) => r.userId === meId)?.reaction;

  const actions = canAct && (
    <div className="flex items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {isMine && message.status === 'sent' && message.text && (
        <button onClick={() => onEdit(message)} aria-label="Edit message" className="rounded-full p-1.5 text-textMuted hover:bg-inputBackground">
          <Pencil size={13} />
        </button>
      )}
      {isMine && message.status === 'sent' && (
        <button onClick={() => onDelete(message)} aria-label="Delete message" className="rounded-full p-1.5 text-textMuted hover:bg-inputBackground">
          <Trash2 size={13} />
        </button>
      )}
      <button onClick={() => onReply(message)} aria-label="Reply to message" className="rounded-full p-1.5 text-textMuted hover:bg-inputBackground">
        <Reply size={13} />
      </button>
      <ReactionPicker mine={myReaction} onPick={(r) => onReact(message.id, r)} />
    </div>
  );

  return (
    <div className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
        {isMine && <div className="mr-1">{actions}</div>}

        <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${isMine ? 'bg-primary text-primaryText' : 'bg-surface text-textPrimary shadow-sm'} ${message.status === 'sending' ? 'opacity-60' : ''}`}>
          {isDeleted ? (
            <p className={`italic ${isMine ? 'text-primaryText/70' : 'text-textMuted'}`}>This message was deleted</p>
          ) : (
            <>
              {replyPreview && (
                <div
                  className={`mb-1.5 rounded-sm border-l-[3px] px-2 py-1 ${
                    isMine ? 'border-primaryText/70 bg-white/15' : 'border-primary bg-inputBackground'
                  }`}
                >
                  {replyPreview.senderIsMine && (
                    <p className={`text-[10px] font-medium ${isMine ? 'text-primaryText' : 'text-primary'}`}>You</p>
                  )}
                  <p className={`truncate text-xs ${isMine ? 'text-primaryText/85' : 'text-textSecondary'}`}>
                    {replyPreview.text || (replyPreview.legacyPhoto ? 'Photo' : '')}
                  </p>
                </div>
              )}
              {message.legacyPhoto && !message.text && <p className="italic opacity-75">Photo</p>}
              {message.text && <p className="whitespace-pre-line">{message.text}</p>}
            </>
          )}

          <div className={`mt-1 flex items-center gap-1 text-[10px] ${isMine ? 'text-primaryText/70' : 'text-textMuted'}`}>
            <span>{timeLabel(message.createdAt)}</span>
            {message.editedAt && !isDeleted && <span>· edited</span>}
            {isMine && message.status === 'sent' && (seen ? <CheckCheck size={12} /> : <Check size={12} />)}
          </div>
        </div>

        {!isMine && <div className="ml-1">{actions}</div>}

        {isMine && message.status === 'failed' && (
          <div className="ml-1 flex items-center gap-1 self-center">
            <button onClick={() => onRetry(message.id)} aria-label="Retry send" className="rounded-full p-1.5 text-error hover:bg-error/10">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => onDismissFailed(message.id)} aria-label="Discard message" className="rounded-full p-1.5 text-textMuted hover:bg-inputBackground">
              <X size={14} />
            </button>
            <AlertCircle size={14} className="text-error" />
          </div>
        )}
      </div>

      {reactions.length > 0 && (
        <div className="-mt-1.5 flex gap-0.5 rounded-pill border border-border bg-surface px-1.5 py-0.5">
          {reactions.map(({ reaction, count }) => (
            <span key={reaction} className="text-xs">
              {REACTION_EMOJI[reaction]}
              {count > 1 ? count : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
