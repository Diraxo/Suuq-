import { create } from 'zustand';

type PublishSessionState = {
  submitting: boolean;
  progress: { completed: number; total: number } | null;
};

// Deliberately module-level/global state, not local component state: a
// publish that's still uploading must stay visible as "in flight" even if
// the Preview screen unmounts (Back to an earlier step) and remounts
// (Continue forward again). If this lived in Preview's own useState, a
// remounted instance would have no way to know a submission for this draft
// was already running — which is exactly how the same draft got published
// twice (Back mid-upload, forward, tap Publish again).
export const usePublishSession = create<PublishSessionState>(() => ({
  submitting: false,
  progress: null,
}));

// The actual in-flight guard. A plain module variable (not store state)
// because it needs to be checked and set synchronously, before React has a
// chance to re-render and disable the Publish button — closing the window
// where two rapid taps (or a remount) could both start a real upload +
// database insert.
let activePublish: Promise<void> | null = null;

/**
 * Runs `task` (the real upload + listing-insert work) at most once per
 * in-flight submission. If a submission is already running — from this
 * mount or a previous one — this is a no-op, so callers only need to guard
 * against starting the *first* one via `usePublishSession.getState().submitting`.
 */
export function publishOnce(task: () => Promise<void>) {
  if (activePublish) return;
  usePublishSession.setState({ submitting: true, progress: null });
  const run = task().finally(() => {
    activePublish = null;
    usePublishSession.setState({ submitting: false, progress: null });
  });
  activePublish = run;
}

export function setPublishProgress(progress: { completed: number; total: number }) {
  usePublishSession.setState({ progress });
}

// A monotonically-increasing token identifying "the current Sell flow" —
// bumped every time app/post/index.tsx (the wizard's single entry point,
// per its own comment: "Tapping Sell always lands on Step 1") mounts, i.e.
// every time the seller (re)opens Sell, whether to resume the same draft or
// start composing a different one. `activePublish` above only guards against
// a *duplicate* submission; it says nothing about whether the seller is
// still on the flow that launched it. A publish captures this token when it
// starts and checks it again when it finishes, so it only takes over
// navigation to Success if the seller never left and came back to Sell in
// the meantime — otherwise the in-flight publish keeps running (per
// publishOnce above) but surfaces via the "published while you were away"
// notification instead of yanking a newer draft onto the old one's screen.
let activePostFlowId = 0;

export function startPostFlow(): number {
  activePostFlowId += 1;
  return activePostFlowId;
}

export function isActivePostFlow(flowId: number): boolean {
  return flowId === activePostFlowId;
}

export function getActivePostFlowId(): number {
  return activePostFlowId;
}
