'use client';

// Web port of components/chat/MessageComposer.tsx on mobile. Kept as its own
// component (not inline JSX in the chat page) on purpose: it owns its own
// `text` state, so a page-level re-render triggered by an incoming
// realtime message never touches this subtree and the input never loses
// focus or gets remounted mid-keystroke — the actual fix for the "cursor
// jumps around" composer bug, not a cosmetic workaround.
import { useRef, useState, KeyboardEvent } from 'react';
import { Send, X, Check } from 'lucide-react';
import type { ChatMessage } from '@/hooks/useConversationChannel';

export type ComposerEditTarget = { id: string; text: string } | null;

type Props = {
  onSend: (input: { text?: string; replyToId?: string | null }) => void;
  onTyping: (typing: boolean) => void;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ComposerEditTarget;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  disabled?: boolean;
};

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, editing, onCancelEdit, onSubmitEdit, disabled }: Props) {
  const [text, setText] = useState(editing?.text ?? '');
  const editingIdRef = useRef<string | null>(editing?.id ?? null);

  // Sync local draft only when a *different* message starts being edited
  // (or editing is cancelled) — never on every parent re-render, which would
  // otherwise clobber in-progress typing.
  const editingId = editing?.id ?? null;
  if (editingId !== editingIdRef.current) {
    editingIdRef.current = editingId;
    if (editing) setText(editing.text);
    else setText('');
  }

  const canSend = text.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    if (editing) {
      onSubmitEdit(editing.id, text.trim());
      return;
    }
    onSend({
      text: text.trim(),
      replyToId: replyTo?.id ?? null,
    });
    setText('');
    onCancelReply();
    onTyping(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-surface">
      {editing && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <div className="flex-1 border-l-[3px] border-primary pl-2">
            <p className="text-xs font-medium text-primary">Editing message</p>
          </div>
          <button onClick={onCancelEdit} aria-label="Cancel edit" className="rounded-full p-1 text-textMuted hover:bg-inputBackground">
            <X size={16} />
          </button>
        </div>
      )}

      {!editing && replyTo && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <div className="flex-1 border-l-[3px] border-primary pl-2">
            <p className="text-xs font-medium text-primary">Replying to</p>
            <p className="truncate text-xs text-textSecondary">{replyTo.text || (replyTo.legacyPhoto ? 'Photo' : '')}</p>
          </div>
          <button onClick={onCancelReply} aria-label="Cancel reply" className="rounded-full p-1 text-textMuted hover:bg-inputBackground">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTyping(e.target.value.length > 0);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => onTyping(false)}
          placeholder={editing ? 'Edit message…' : 'Type a message…'}
          disabled={disabled}
          rows={1}
          className="max-h-24 flex-1 resize-none rounded-lg bg-inputBackground px-3 py-2 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend || disabled}
          aria-label={editing ? 'Save edit' : 'Send message'}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${canSend ? 'bg-primary text-primaryText' : 'bg-inputBackground text-textMuted'}`}
        >
          {editing ? <Check size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
