'use client';

// Web port of components/chat/MessageComposer.tsx on mobile. Kept as its own
// component (not inline JSX in the chat page) on purpose: it owns its own
// `text`/`pending` state, so a page-level re-render triggered by an incoming
// realtime message never touches this subtree and the input never loses
// focus or gets remounted mid-keystroke — the actual fix for the "cursor
// jumps around" composer bug, not a cosmetic workaround.
import { useRef, useState, KeyboardEvent } from 'react';
import Image from 'next/image';
import { ImagePlus, Send, X, Check, Loader2 } from 'lucide-react';
import { uploadToR2 } from '@/services/r2';
import type { ChatMessage } from '@/hooks/useConversationChannel';

const MAX_IMAGES = 4;

type PendingImage = { localUrl: string; file: File; uploadedUrl?: string; uploadedKey?: string; uploading: boolean; failed: boolean };

export type ComposerEditTarget = { id: string; text: string } | null;

type Props = {
  onSend: (input: { text?: string; images?: string[]; imageKeys?: string[]; replyToId?: string | null }) => void;
  onTyping: (typing: boolean) => void;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ComposerEditTarget;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  uploadFolder: string;
  disabled?: boolean;
};

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, editing, onCancelEdit, onSubmitEdit, uploadFolder, disabled }: Props) {
  const [text, setText] = useState(editing?.text ?? '');
  const [pending, setPending] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const uploading = pending.some((p) => p.uploading);
  const ready = pending.filter((p) => p.uploadedUrl);
  const canSend = editing ? text.trim().length > 0 : !uploading && (text.trim().length > 0 || ready.length > 0);

  const uploadFile = async (file: File, localUrl: string) => {
    try {
      const result = await uploadToR2(file, uploadFolder);
      setPending((prev) => prev.map((p) => (p.localUrl === localUrl ? { ...p, uploading: false, uploadedUrl: result.url, uploadedKey: result.key } : p)));
    } catch {
      setPending((prev) => prev.map((p) => (p.localUrl === localUrl ? { ...p, uploading: false, failed: true } : p)));
    }
  };

  const pickImages = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const remaining = MAX_IMAGES - pending.length;
    if (remaining <= 0) return;
    const files = Array.from(fileList).slice(0, remaining);
    const items: PendingImage[] = files.map((file) => ({ localUrl: URL.createObjectURL(file), file, uploading: true, failed: false }));
    setPending((prev) => [...prev, ...items]);
    items.forEach((item) => uploadFile(item.file, item.localUrl));
  };

  const removePending = (localUrl: string) => setPending((prev) => prev.filter((p) => p.localUrl !== localUrl));
  const retryPending = (item: PendingImage) => {
    setPending((prev) => prev.map((p) => (p.localUrl === item.localUrl ? { ...p, uploading: true, failed: false } : p)));
    uploadFile(item.file, item.localUrl);
  };

  const handleSend = () => {
    if (!canSend) return;
    if (editing) {
      onSubmitEdit(editing.id, text.trim());
      return;
    }
    onSend({
      text: text.trim() || undefined,
      images: ready.length ? ready.map((p) => p.uploadedUrl!) : undefined,
      imageKeys: ready.length ? ready.map((p) => p.uploadedKey!) : undefined,
      replyToId: replyTo?.id ?? null,
    });
    setText('');
    setPending([]);
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
            <p className="truncate text-xs text-textSecondary">{replyTo.text || (replyTo.images.length ? 'Photo' : '')}</p>
          </div>
          <button onClick={onCancelReply} aria-label="Cancel reply" className="rounded-full p-1 text-textMuted hover:bg-inputBackground">
            <X size={16} />
          </button>
        </div>
      )}

      {!editing && pending.length > 0 && (
        <div className="flex gap-2 px-4 pt-2">
          {pending.map((item) => (
            <div key={item.localUrl} className="relative h-14 w-14 shrink-0">
              <Image src={item.localUrl} alt="" fill sizes="56px" className="rounded-sm object-cover" unoptimized />
              {item.uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/35">
                  <Loader2 size={16} className="animate-spin text-white" />
                </div>
              )}
              {item.failed && (
                <button onClick={() => retryPending(item)} className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 text-white text-[10px]">
                  Retry
                </button>
              )}
              <button
                onClick={() => removePending(item.localUrl)}
                aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {!editing && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                pickImages(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || pending.length >= MAX_IMAGES}
              aria-label="Attach photo"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-primary disabled:opacity-40"
            >
              <ImagePlus size={20} />
            </button>
          </>
        )}

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
