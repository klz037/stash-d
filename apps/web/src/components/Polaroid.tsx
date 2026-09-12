import { HOLD_TO_UNLOCK_MS, LockDto, TOGETHER_WAIT_MS } from '@stashd/shared';
import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '../lib/time';

/**
 * A polaroid: a square photo area on a white card with a thick bottom margin,
 * where the condition is written by hand. Sealed, the photo area is an
 * undeveloped print; hold it and it develops. Every card is tilted slightly,
 * alternating, so a feed reads as a pile rather than a grid.
 */
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
  /** Open capture addressed to the sender. `replyToId` is set when this answers an "open together". */
  onReply?: (recipientId: string, replyToId?: string) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [conditionDraft, setConditionDraft] = useState('');
  const [, setClock] = useState(0);
  const frame = useRef<number | null>(null);
  const started = useRef<number | null>(null);
  const progressRef = useRef(0);

  const isRecipient = lock.recipientIds.includes(viewerId);
  const isSender = lock.senderId === viewerId;
  const isGroup = lock.recipients.length > 1;
  const sealed = lock.state !== 'UNLOCKED';
  const yours = lock.confirmedIds.includes(viewerId);
  const others = lock.participantIds.filter((id) => id !== viewerId);
  const othersDone = others.filter((id) => lock.confirmedIds.includes(id));
  const theirs = others.length > 0 && othersDone.length === others.length;
  const waitingOn = others.length - othersDone.length;
  const otherName = isRecipient ? lock.senderName : lock.recipientName;

  // The pair "open together" trade: two people, not itself a stash-back.
  const isReply = Boolean(lock.replyToId);
  const isPairTogether =
    lock.conditionType === 'TOGETHER' && lock.participantIds.length === 2 && !isReply;

  const needsCondition =
    lock.conditionType === 'RECIPIENT_SET' &&
    !lock.conditionLabel &&
    isRecipient &&
    lock.state === 'LOCKED';

  let canHold = false;
  if (sealed && !needsCondition) {
    if (isReply) {
      canHold = false;
    } else if (isPairTogether) {
      canHold = isSender
        ? lock.state === 'LOCKED' && Boolean(lock.replyId)
        : isRecipient && lock.state === 'READY';
    } else if (lock.conditionType === 'TOGETHER') {
      canHold = lock.participantIds.includes(viewerId) && !yours;
    } else {
      canHold = isRecipient;
    }
  }
  const here = sealed && Boolean(lock.contextMetAt);

  // While the sender waits on a pair opening, tick so the countdown moves.
  const waiting = isPairTogether && lock.state === 'READY' && !lock.openedAlone && Boolean(lock.openingStartedAt);
  useEffect(() => {
    if (!waiting) return undefined;
    const id = window.setInterval(() => setClock((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);
  const secondsLeft = waiting
    ? Math.max(0, Math.ceil((new Date(lock.openingStartedAt as string).getTime() + TOGETHER_WAIT_MS - Date.now()) / 1000))
    : 0;

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
  const showRing =
    sealed && (progress > 0 || busy || (lock.conditionType === 'TOGETHER' && lock.confirmedIds.length > 0));

  // What the undeveloped print says. Pair-together has its own script.
  let hint: string;
  if (here) {
    hint =
      lock.contextMetBy === viewerId
        ? "you're here. hold to open"
        : `${lock.contextMetByName ?? 'someone'} is ${lock.context ?? 'there'}`;
  } else if (isReply) {
    hint = lock.state === 'UNLOCKED' ? '' : `opens with ${otherName}'s`;
  } else if (isPairTogether) {
    if (lock.state === 'LOCKED') {
      hint = !lock.replyId
        ? isRecipient
          ? 'stash something back to start'
          : `waiting for ${otherName} to stash back`
        : isSender
          ? 'hold to start opening'
          : `waiting for ${otherName} to start`;
    } else if (lock.openedAlone) {
      hint = isSender ? `opened without ${otherName}` : `${otherName} opened it without you. hold to look`;
    } else {
      hint = isSender
        ? `opening… ${secondsLeft}s for ${otherName}`
        : `${otherName} is opening now. hold to open together`;
    }
  } else if (lock.state === 'READY') {
    hint = yours
      ? waitingOn === 1
        ? 'waiting on one more'
        : `waiting on ${waitingOn} more`
      : isGroup
        ? `${othersDone.length} of ${others.length} holding. your turn`
        : "they're waiting on you";
  } else {
    hint = canHold ? 'hold to develop' : lock.mediaKind === 'SONG' ? "a song, stash'd" : "stash'd";
  }

  const kicker = isRecipient
    ? `from ${lock.senderName}${isGroup ? ` · to ${lock.recipientName}` : ''}`
    : `to ${lock.recipientName}`;

  const showStashBack =
    onReply && isRecipient && lock.senderId !== viewerId && (
      lock.state === 'UNLOCKED' ||
      (isPairTogether && lock.state === 'LOCKED' && !lock.replyId)
    );

  return (
    <article
      className={`polaroid ${sealed ? 'sealed' : 'developed'} ${here ? 'here' : ''} ${
        canHold ? 'holdable' : ''
      } ${waiting && isRecipient ? 'urgent' : ''}`}
      style={{ ['--tilt' as string]: `${tiltFor(lock.id)}deg` }}
      onPointerDown={startHold}
      onMouseDown={startHold}
      onPointerUp={releaseHold}
      onMouseUp={releaseHold}
      onPointerCancel={releaseHold}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className={`frame ${lock.state === 'UNLOCKED' ? 'unlocked' : ''}`}
        style={sealed && progress > 0 ? { ['--develop' as string]: progress } : undefined}
      >
        {lock.state === 'UNLOCKED' && lock.song ? (
          <img
            src={lock.song.albumArtUrl}
            alt={`${lock.song.title} by ${lock.song.artist}`}
          />
        ) : lock.state === 'UNLOCKED' && lock.imageUrl ? (
          <img src={lock.imageUrl} alt="" />
        ) : lock.state === 'UNLOCKED' ? (
          <p className="revealed-text on-print">{lock.text}</p>
        ) : (
          <div className="undeveloped">
            {lock.mediaKind === 'SONG' ? (
              <div className="sleeve" aria-hidden="true">
                <span className="sleeve-disc" />
              </div>
            ) : null}
            {lock.conditionType === 'TOGETHER' && !isPairTogether && !isReply && others.length > 0 ? (
              <div className="holders" aria-label={`${lock.confirmedIds.length} of ${lock.participantIds.length} holding`}>
                {others.map((id) => (
                  <span
                    key={id}
                    className={`dot ${lock.confirmedIds.includes(id) ? 'on' : ''}`}
                  />
                ))}
              </div>
            ) : null}
            <span className="undeveloped-hint">{hint}</span>
          </div>
        )}
        {showRing ? (
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

      <div className="caption">
        <p className="condition">
          {lock.conditionLabel ?? (isRecipient ? 'You decide when this opens.' : 'They decide when it opens.')}
        </p>
        <div className="meta">
          <span>{kicker}</span>
          <span>{timeAgo(lock.createdAt)}</span>
        </div>
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
      {showStashBack ? (
        <button
          className={sealed ? 'btn' : 'btn-ghost'}
          type="button"
          onClick={() => onReply?.(lock.senderId, sealed ? lock.id : undefined)}
        >
          Stash back
        </button>
      ) : null}
    </article>
  );
}

/** A stable little tilt per card, between -2.2° and 2.2°, so the pile doesn't shuffle on re-render. */
function tiltFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const unit = ((hash % 1000) + 1000) % 1000 / 1000; // 0..1
  return (unit * 4.4 - 2.2).toFixed(2) as unknown as number;
}
