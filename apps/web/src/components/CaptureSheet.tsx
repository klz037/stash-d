import {
  ConditionType,
  CONTEXT_LABELS,
  CONTEXTS,
  contextConditionLabel,
  FriendDto,
  LockContext,
  MAX_RECIPIENTS,
  SongDto,
} from '@stashd/shared';
import { SongPicker } from './SongPicker';
import { useEffect, useMemo, useRef, useState } from 'react';

type Step = 'media' | 'song' | 'text' | 'recipient' | 'condition';

async function compressImage(dataUrl: string, maxDim = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process photo.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not read photo.'));
    img.src = dataUrl;
  });
}

export function CaptureSheet({
  friends,
  presetRecipientId,
  token,
  onClose,
  onSubmit,
}: {
  friends: FriendDto[];
  presetRecipientId?: string;
  token: () => Promise<string>;
  onClose: () => void;
  onSubmit: (input: {
    recipientIds: string[];
    text: string;
    imageUrl?: string;
    conditionType: ConditionType;
    conditionLabel?: string;
    context?: LockContext | null;
    songTrackId?: string;
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('media');
  const [imageUrl, setImageUrl] = useState<string>();
  const [song, setSong] = useState<SongDto>();
  const [text, setText] = useState('');
  const [recipientIds, setRecipientIds] = useState<string[]>(
    presetRecipientId ? [presetRecipientId] : [],
  );
  const [conditionType, setConditionType] = useState<ConditionType>('MANUAL');
  const [conditionLabel, setConditionLabel] = useState('');
  const [context, setContext] = useState<LockContext | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  // The label we filled in from a context chip, so we can replace it (and
  // only it) when the chip changes.
  const autoLabel = useRef('');

  const recipients = useMemo(
    () => friends.filter((friend) => recipientIds.includes(friend.id)),
    [friends, recipientIds],
  );
  const isGroup = recipients.length > 1;
  const whoLabel =
    recipients.length === 0
      ? 'them'
      : recipients.length === 1
        ? recipients[0].isSelf
          ? 'you'
          : recipients[0].displayName
        : recipients.length === 2
          ? `${recipients[0].displayName} and ${recipients[1].displayName}`
          : `${recipients[0].displayName}, ${recipients[1].displayName} +${recipients.length - 2}`;

  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera API unavailable here. Use the library instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraError('Camera permission denied. Allow it, or pick from library.');
        } else if (name === 'NotFoundError') {
          setCameraError('No camera found. Pick a photo from your library.');
        } else {
          setCameraError('Could not open the camera. Pick from library instead.');
        }
      }
    }
    if (step === 'media' && !imageUrl) {
      void startCamera();
    }
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [step, imageUrl]);

  // "You decide" only works with one person. Drop it if a second is added.
  useEffect(() => {
    if (isGroup && conditionType === 'RECIPIENT_SET') {
      setConditionType('MANUAL');
    }
  }, [isGroup, conditionType]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  async function snapPhoto() {
    const video = videoRef.current;
    if (!video || !cameraReady) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Could not capture frame.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const compressed = await compressImage(canvas.toDataURL('image/jpeg', 0.92));
      stopCamera();
      setImageUrl(compressed);
      setError('');
      setStep('text');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture.');
    }
  }

  async function onFile(file?: File) {
    if (!file) {
      return;
    }
    if (file.size > 8_000_000) {
      setError('Keep the photo under 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void compressImage(String(reader.result))
        .then((compressed) => {
          stopCamera();
          setImageUrl(compressed);
          setError('');
          setStep('text');
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Could not read photo.');
        });
    };
    reader.readAsDataURL(file);
  }

  function toggleRecipient(id: string) {
    setRecipientIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= MAX_RECIPIENTS) {
        return current;
      }
      return [...current, id];
    });
  }

  function pickContext(next: LockContext | null) {
    setContext(next);
    if (conditionType !== 'MANUAL') {
      return;
    }
    // Fill the condition from the chip unless the sender wrote their own.
    if (!conditionLabel.trim() || conditionLabel === autoLabel.current) {
      const filled = next ? contextConditionLabel(next) : '';
      autoLabel.current = filled;
      setConditionLabel(filled);
    }
  }

  function labelFor(type: ConditionType): string | undefined {
    if (type === 'MANUAL') {
      return conditionLabel.trim() || (context ? contextConditionLabel(context) : undefined);
    }
    if (type === 'TOGETHER' && context) {
      return `Open together when you're ${CONTEXT_LABELS[context]}`;
    }
    return undefined;
  }

  const canStash =
    !busy &&
    recipientIds.length > 0 &&
    (conditionType !== 'MANUAL' || Boolean(labelFor('MANUAL')));

  async function finish() {
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        recipientIds,
        text,
        imageUrl,
        songTrackId: song?.trackId,
        conditionType,
        conditionLabel: labelFor(conditionType),
        context: conditionType === 'RECIPIENT_SET' ? null : context,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stash that.');
      setBusy(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-card">
        <button
          className="btn-ghost"
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
        >
          Close
        </button>
        {step === 'media' ? (
          <>
            <h2>Capture</h2>
            <p className="lede">Take a photo, or skip it and just write.</p>
            <div className="camera-stage">
              {imageUrl ? (
                <img className="camera-preview" src={imageUrl} alt="" />
              ) : (
                <video
                  ref={videoRef}
                  className="camera-preview"
                  playsInline
                  muted
                  autoPlay
                />
              )}
              {!cameraReady && !imageUrl ? (
                <p className="camera-fallback">{cameraError || 'Opening camera…'}</p>
              ) : null}
            </div>
            <div className="camera-actions">
              <button
                className="btn"
                type="button"
                disabled={!cameraReady}
                onClick={() => void snapPhoto()}
              >
                Take photo
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => libraryRef.current?.click()}
              >
                Library
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep('song');
                }}
              >
                Share a song
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep('text');
                }}
              >
                Skip photo
              </button>
            </div>
            <input
              ref={libraryRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </>
        ) : null}

        {step === 'song' ? (
          <>
            <SongPicker
              token={token}
              selected={song}
              onSelect={(picked) => setSong(picked)}
              onBack={() => setStep('media')}
            />
            {song ? (
              <button className="btn" type="button" onClick={() => setStep('text')}>
                Write something
              </button>
            ) : null}
          </>
        ) : null}

        {step === 'text' ? (
          <>
            <h2>Write something</h2>
            {imageUrl ? <img className="preview" src={imageUrl} alt="" /> : null}
            <label className="field">
              Note
              <textarea
                rows={4}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="For later."
              />
            </label>
            <button className="btn" type="button" onClick={() => setStep('recipient')}>
              Choose who
            </button>
          </>
        ) : null}

        {step === 'recipient' ? (
          <>
            <h2>Who is this for?</h2>
            <p className="lede">Tap more than one to send it to a group.</p>
            <div className="choices">
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className={`choice ${recipientIds.includes(friend.id) ? 'active' : ''}`}
                  onClick={() => {
                    toggleRecipient(friend.id);
                    setAdding(false);
                  }}
                >
                  {friend.isSelf ? 'Just me' : friend.displayName}
                  {friend.online ? ' · online' : ''}
                </button>
              ))}
              <button
                type="button"
                className="choice"
                onClick={() => setAdding((value) => !value)}
              >
                Add someone
              </button>
            </div>
            {adding ? (
              <p className="hint">
                Pairing lives on the empty Stash. Close this, enter their code, then stash.
              </p>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={recipientIds.length === 0}
              onClick={() => setStep('condition')}
            >
              {recipients.length > 1 ? `Next · ${recipients.length} people` : 'Next'}
            </button>
          </>
        ) : null}

        {step === 'condition' ? (
          <>
            <h2>How does it open?</h2>
            <p className="lede">For {whoLabel}.</p>
            <div className="choices">
              {(
                [
                  ['MANUAL', 'Open when…'],
                  ['TOGETHER', 'Open together'],
                  ['RECIPIENT_SET', 'You decide'],
                ] as const
              )
                .filter(([type]) => !(isGroup && type === 'RECIPIENT_SET'))
                .map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    className={`choice ${conditionType === type ? 'active' : ''}`}
                    onClick={() => setConditionType(type)}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {conditionType !== 'RECIPIENT_SET' ? (
              <div className="field">
                <span>Tie it to a moment</span>
                <div className="chips">
                  {CONTEXTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`chip ${context === item ? 'active' : ''}`}
                      onClick={() => pickContext(context === item ? null : item)}
                    >
                      {CONTEXT_LABELS[item]}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  When they tap “I'm here” for that moment, you'll know. They still hold to open.
                </p>
              </div>
            ) : null}
            {conditionType === 'MANUAL' ? (
              <label className="field">
                Condition
                <input
                  value={conditionLabel}
                  onChange={(event) => setConditionLabel(event.target.value)}
                  placeholder="Open when you land"
                />
              </label>
            ) : (
              <p className="hint">
                {conditionType === 'TOGETHER'
                  ? isGroup
                    ? 'Everyone holds. It opens on every screen when the last hand lands.'
                    : 'Both of you hold. It opens on both screens at once.'
                  : 'They write the condition after it arrives.'}
              </p>
            )}
            <button
              className="btn"
              type="button"
              disabled={!canStash}
              onClick={() => void finish()}
            >
              {busy ? 'Stashing…' : 'Stash'}
            </button>
          </>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
