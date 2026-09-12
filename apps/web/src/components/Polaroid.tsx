import { HOLD_TO_UNLOCK_MS, LockDto } from '@stashd/shared';
import { PointerEvent, useRef, useState } from 'react';
import { timeAgo } from '../lib/time';

export function Polaroid({
  lock,
  viewerId,
  onConfirm,
  onSetCondition,
  onReply,
}: {
  lock: LockDto;
  viewerId: string;
  onConfirm: (id: string) => Promise<void>;
  onSetCondition?: (id: string, label: string) => Promise<void>;
  onReply?: (recipientId: string) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [conditionDraft, setConditionDraft] = useState('');
  const frame = useRef<number | null>(null);
  const started = useRef<number | null>(null);
  const isRecipient = lock.recipientId === viewerId;
  const needsCondition =
    lock.conditionType === 'RECIPIENT_SET' &&
    !lock.conditionLabel &&
    isRecipient &&
    lock.state === 'LOCKED';
  const canHold =
    lock.state !== 'UNLOCKED' &&
    !needsCondition &&
    (lock.conditionType === 'TOGETHER'
      ? lock.senderId === viewerId || lock.recipientId === viewerId
      : isRecipient);

  function stopHold(completed: boolean) {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
    }
    started.current = null;
    if (!completed) {
      setProgress(0);
    }
  }

  function tick() {
    if (!started.current) {
      return;
    }
    const next = Math.min(1, (Date.now() - started.current) / HOLD_TO_UNLOCK_MS);
    setProgress(next);
    if (next >= 1) {
      stopHold(true);
      setBusy(true);
      void onConfirm(lock.id).finally(() => {
        setBusy(false);
        setProgress(0);
      });
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!canHold || busy) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    started.current = Date.now();
    frame.current = requestAnimationFrame(tick);
  }

  function onPointerUp() {
    if (progress < 1) {
      stopHold(false);
    }
  }

  const yours =
    viewerId === lock.senderId ? lock.senderConfirmed : lock.recipientConfirmed;
  const theirs =
    viewerId === lock.senderId ? lock.recipientConfirmed : lock.senderConfirmed;
  const ring = lock.conditionType === 'TOGETHER' ? Math.max(progress, yours ? 1 : 0) : progress;

  return (
    <article
      className="polaroid"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={`frame ${lock.state === 'UNLOCKED' ? 'unlocked' : ''}`}>
        {lock.state === 'UNLOCKED' && lock.imageUrl ? (
          <img src={lock.imageUrl} alt="" />
        ) : lock.state === 'UNLOCKED' ? (
          <p className="revealed-text" style={{ color: '#f3ead8' }}>
            {lock.text}
          </p>
        ) : (
          <div className="hold-copy">
            <div>{isRecipient ? `From ${lock.senderName}` : `To ${lock.recipientName}`}</div>
            <p className="condition">
              {lock.conditionLabel ?? 'You decide when this opens.'}
            </p>
            {lock.state === 'READY' ? (
              <p className="hint">
                {theirs ? "They're waiting on you." : 'Waiting on them.'}
              </p>
            ) : null}
            {canHold ? <p className="hint">Hold to unlock</p> : null}
          </div>
        )}
        {lock.state !== 'UNLOCKED' ? (
          <svg className="ring" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(255,253,248,0.45)"
              strokeWidth="3"
            />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="#c24a2a"
              strokeWidth="3"
              strokeDasharray={`${ring * 289} 289`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
            {lock.conditionType === 'TOGETHER' ? (
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke={theirs ? '#c24a2a' : 'rgba(28,22,18,0.2)'}
                strokeWidth="2"
              />
            ) : null}
          </svg>
        ) : null}
      </div>
      {lock.state === 'UNLOCKED' && lock.imageUrl && lock.text ? (
        <p className="revealed-text">{lock.text}</p>
      ) : null}
      <div className="meta">
        <span>{isRecipient ? lock.senderName : lock.recipientName}</span>
        <span>{timeAgo(lock.createdAt)}</span>
      </div>
      {needsCondition ? (
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            if (conditionDraft.trim() && onSetCondition) {
              void onSetCondition(lock.id, conditionDraft.trim());
            }
          }}
        >
          <label htmlFor={`cond-${lock.id}`}>Write the condition</label>
          <input
            id={`cond-${lock.id}`}
            value={conditionDraft}
            onChange={(event) => setConditionDraft(event.target.value)}
            placeholder="Open when…"
          />
          <button className="btn" type="submit">
            Seal it
          </button>
        </form>
      ) : null}
      {lock.state === 'UNLOCKED' && onReply && isRecipient ? (
        <button
          className="btn-ghost"
          type="button"
          onClick={() => onReply(lock.senderId)}
        >
          Stash something back
        </button>
      ) : null}
    </article>
  );
}
