import { ConditionType, FriendDto, GroupDto } from '@stashd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SongPicker } from './SongPicker';

type Step = 'media' | 'text' | 'recipient' | 'condition';

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
  groups = [],
  presetRecipientId,
  presetConditionLabel,
  onClose,
  onSubmit,
}: {
  friends: FriendDto[];
  groups?: GroupDto[];
  presetRecipientId?: string;
  presetConditionLabel?: string;
  onClose: () => void;
  onSubmit: (input: {
    recipientId?: string;
    groupId?: string;
    text: string;
    imageUrl?: string;
    conditionType: ConditionType;
    conditionLabel?: string;
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('media');
  const [imageUrl, setImageUrl] = useState<string>();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<{ kind: 'friend' | 'group'; id: string }>(() => ({
    kind: 'friend',
    id: presetRecipientId ?? 'me',
  }));
  const [conditionType, setConditionType] = useState<ConditionType>('MANUAL');
  const [conditionLabel, setConditionLabel] = useState(presetConditionLabel ?? '');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);

  const recipient = useMemo(
    () => friends.find((friend) => friend.id === target.id) ?? friends[0],
    [friends, target.id],
  );
  const group = useMemo(
    () => groups.find((item) => item.id === target.id),
    [groups, target.id],
  );
  const targetLabel =
    target.kind === 'group'
      ? group?.name ?? 'the group'
      : recipient?.displayName ?? 'them';

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

  async function finish() {
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'group') {
        await onSubmit({
          groupId: target.id,
          text,
          imageUrl,
          songTrackId: song?.trackId,
          conditionType: conditionType === 'TOGETHER' ? 'MANUAL' : conditionType,
          conditionLabel:
            conditionType === 'TOGETHER'
              ? conditionLabel.trim() || 'Open when you’re all together'
              : conditionType === 'MANUAL'
                ? conditionLabel
                : undefined,
        });
      } else {
        await onSubmit({
          recipientId: recipient?.isSelf ? 'me' : target.id,
          text,
          imageUrl,
          songTrackId: song?.trackId,
          conditionType,
          conditionLabel: conditionType === 'MANUAL' ? conditionLabel : undefined,
        });
      }
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
            <p className="lede">Point at something worth locking. Or skip.</p>
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
            {groups.length > 0 ? (
              <>
                <p className="hint">Groups</p>
                <div className="choices">
                  {groups.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`choice ${target.kind === 'group' && target.id === item.id ? 'active' : ''}`}
                      onClick={() => {
                        setTarget({ kind: 'group', id: item.id });
                        setAdding(false);
                        setStep('condition');
                      }}
                    >
                      {item.name}
                      <span className="choice-meta"> · {item.members.length} people</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <p className="hint">Friends</p>
            <div className="choices">
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className={`choice ${target.kind === 'friend' && (target.id === friend.id || (friend.isSelf && target.id === 'me')) ? 'active' : ''}`}
                  onClick={() => {
                    setTarget({ kind: 'friend', id: friend.id });
                    setAdding(false);
                    setStep('condition');
                  }}
                >
                  {friend.displayName}
                  {friend.online ? ' · online' : ''}
                  {friend.placeLabel ? ` · at ${friend.placeLabel}` : ''}
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
                Pairing lives on the empty shelf. Close this, enter their code, then stash.
              </p>
            ) : null}
          </>
        ) : null}

        {step === 'condition' ? (
          <>
            <h2>How does it open?</h2>
            <p className="lede">For {targetLabel}.</p>
            <div className="choices">
              {(
                (
                  target.kind === 'group'
                    ? ([
                        ['MANUAL', 'Open when…'],
                        ['RECIPIENT_SET', 'They decide'],
                      ] as const)
                    : ([
                        ['MANUAL', 'Open when…'],
                        ['TOGETHER', 'Open together'],
                        ['RECIPIENT_SET', 'You decide'],
                      ] as const)
                )
              ).map(([type, label]) => (
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
            {conditionType === 'MANUAL' || (target.kind === 'group' && conditionType === 'TOGETHER') ? (
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
                  ? 'Both of you hold. The first wait is the point.'
                  : target.kind === 'group'
                    ? 'Each person writes their own condition after it arrives.'
                    : 'They write the condition after it arrives.'}
              </p>
            )}
            {target.kind === 'group' ? (
              <p className="hint">Everyone in {targetLabel} gets their own card.</p>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={busy || (conditionType === 'MANUAL' && !conditionLabel.trim())}
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
