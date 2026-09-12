import { CONTEXT_LABELS, HOLD_TO_UNLOCK_MS, LockDto } from '@stashd/shared';
import { useEffect, useRef, useState } from 'react';
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
  const progressRef = useRef(0);

  const isRecipient = lock.recipientIds.includes(viewerId);
  const isGroup = lock.recipients.length > 1;
  const sealed = lock.state !== 'UNLOCKED';
  const yours = lock.confirmedIds.includes(viewerId);
  const others = lock.participantIds.filter((id) => id !== viewerId);
  const othersDone = others.filter((id) => lock.confirmedIds.includes(id));
  const theirs = others.length > 0 && othersDone.length === others.length;
  const waitingOn = others.length - othersDone.length;

  const needsCondition =
    lock.conditionType === 'RECIPIENT_SET' &&
    !lock.conditionLabel &&
    isRecipient &&
    lock.state === 'LOCKED';
  const canHold =
    sealed &&
    !needsCondition &&
    (lock.conditionType === 'TOGETHER'
      ? lock.participantIds.includes(viewerId) && !yours
      : isRecipient);
  const here = sealed && Boolean(lock.contextMetAt);

  function stopHold(completed: boolean) {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
    }
    started.current = null;
    if (!completed) {
      progressRef.current = 0;
      setProgress(0);
    }
  }

  function tick() {
    if (!started.current) {
      return;
    }
    const next = Math.min(1, (Date.now() - started.current) / HOLD_TO_UNLOCK_MS);
    progressRef.current = next;
    setProgress(next);
    if (next >= 1) {
      stopHold(true);
      setBusy(true);
      void onConfirm(lock.id).finally(() => {
        setBusy(false);
        progressRef.current = 0;
        setProgress(0);
      });
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }

  function startHold() {
    if (!canHold || busy || started.current) {
      return;
    }
    started.current = Date.now();
    frame.current = requestAnimationFrame(tick);
  }

  function releaseHold() {
    if (started.current && progressRef.current < 1) {
      stopHold(false);
    }
  }

  useEffect(() => {
    window.addEventListener('pointerup', releaseHold);
    window.addEventListener('mouseup', releaseHold);
    return () => {
      window.removeEventListener('pointerup', releaseHold);
      window.removeEventListener('mouseup', releaseHold);
    };
  });

  const ring = lock.conditionType === 'TOGETHER' ? Math.max(progress, yours ? 1 : 0) : progress;

  const readyHint =
    lock.state === 'READY'
      ? yours
        ? waitingOn === 1
          ? 'Waiting on one more.'
          : `Waiting on ${waitingOn} more.`
        : isGroup
          ? `${othersDone.length} of ${others.length} are holding. Your turn.`
          : "They're waiting on you."
      : null;

  const hereHint = here
    ? lock.contextMetBy === viewerId
      ? "You're here. Hold to open."
      : `${lock.contextMetByName ?? 'Someone'} is ${
          lock.context ? CONTEXT_LABELS[lock.context] : 'there'
        }.`
    : null;

  return (
    <article
      className={`polaroid ${here ? 'here' : ''}`}
      onPointerDown={startHold}
      onMouseDown={startHold}
      onPointerUp={releaseHold}
      onMouseUp={releaseHold}
      onPointerCancel={releaseHold}
    >
      <div className={`frame ${lock.state === 'UNLOCKED' ? 'unlocked' : ''}`}>
        {lock.state === 'UNLOCKED' && lock.song ? (
          <img
            src={lock.song.albumArtUrl}
            alt={`${lock.song.title} by ${lock.song.artist}`}
          />
        ) : lock.state === 'UNLOCKED' && lock.imageUrl ? (
          <img src={lock.imageUrl} alt="" />
        ) : lock.state === 'UNLOCKED' ? (
          <p className="revealed-text" style={{ color: '#f3ead8' }}>
            {lock.text}
          </p>
        ) : (
          <div className="hold-copy">
            {lock.mediaKind === 'SONG' ? (
              <div className="sleeve" aria-hidden="true">
                <span className="sleeve-disc" />
              </div>
            ) : null}
            <div>
              {isRecipient ? `From ${lock.senderName}` : `To ${lock.recipientName}`}
              {isRecipient && isGroup ? ` · to ${lock.recipientName}` : ''}
              {lock.mediaKind === 'SONG' ? ' · a song' : ''}
            </div>
            <p className="condition">
              {lock.conditionLabel ?? 'You decide when this opens.'}
            </p>
            {lock.conditionType === 'TOGETHER' && others.length > 0 ? (
              <div className="holders" aria-label={`${lock.confirmedIds.length} of ${lock.participantIds.length} holding`}>
                {others.map((id) => (
                  <span
                    key={id}
                    className={`dot ${lock.confirmedIds.includes(id) ? 'on' : ''}`}
                  />
                ))}
              </div>
            ) : null}
            {hereHint ? <p className="hint here-hint">{hereHint}</p> : null}
            {readyHint ? <p className="hint">{readyHint}</p> : null}
            {lock.requiresMfa && isRecipient ? (
              <p className="hint">Needs your second key.</p>
            ) : null}
            {canHold && !hereHint ? <p className="hint">Hold to unlock</p> : null}
          </div>
        )}
        {sealed ? (
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
      {lock.state === 'UNLOCKED' && lock.song ? (
        <div className="song-reveal">
          <div className="song-meta">
            <strong>{lock.song.title}</strong>
            <span>{lock.song.artist}</span>
          </div>
          {lock.song.previewUrl ? (
            <audio className="song-preview" controls preload="none" src={lock.song.previewUrl}>
              Your browser cannot play this preview.
            </audio>
          ) : null}
          <a
            className="btn-ghost song-open"
            href={lock.song.spotifyUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Spotify
          </a>
        </div>
      ) : null}

      {lock.state === 'UNLOCKED' && (lock.imageUrl || lock.song) && lock.text ? (
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
      {lock.state === 'UNLOCKED' && onReply && isRecipient && lock.senderId !== viewerId ? (
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
