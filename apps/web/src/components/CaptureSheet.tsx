import { ConditionType, FriendDto } from '@stashd/shared';
import { useMemo, useState } from 'react';

type Step = 'media' | 'text' | 'recipient' | 'condition';

export function CaptureSheet({
  friends,
  presetRecipientId,
  onClose,
  onSubmit,
}: {
  friends: FriendDto[];
  presetRecipientId?: string;
  onClose: () => void;
  onSubmit: (input: {
    recipientId: string;
    text: string;
    imageUrl?: string;
    conditionType: ConditionType;
    conditionLabel?: string;
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('media');
  const [imageUrl, setImageUrl] = useState<string>();
  const [text, setText] = useState('');
  const [recipientId, setRecipientId] = useState(presetRecipientId ?? 'me');
  const [conditionType, setConditionType] = useState<ConditionType>('MANUAL');
  const [conditionLabel, setConditionLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const recipient = useMemo(
    () => friends.find((friend) => friend.id === recipientId) ?? friends[0],
    [friends, recipientId],
  );

  function onFile(file?: File) {
    if (!file) {
      setImageUrl(undefined);
      setStep('text');
      return;
    }
    if (file.size > 1_400_000) {
      setError('Keep the photo under 1.4 MB for this demo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(String(reader.result));
      setError('');
      setStep('text');
    };
    reader.readAsDataURL(file);
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        recipientId: recipient?.isSelf ? 'me' : recipientId,
        text,
        imageUrl,
        conditionType,
        conditionLabel:
          conditionType === 'MANUAL' ? conditionLabel : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stash that.');
      setBusy(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-card">
        <button className="btn-ghost" type="button" onClick={onClose}>
          Close
        </button>
        {step === 'media' ? (
          <>
            <h2>Capture</h2>
            <p className="lede">A photo is optional. The words matter more.</p>
            <label className="btn">
              Use camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(event) => onFile(event.target.files?.[0])}
              />
            </label>
            <div style={{ height: 10 }} />
            <button className="btn-ghost" type="button" onClick={() => setStep('text')}>
              Skip photo
            </button>
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
            <div className="choices">
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className={`choice ${recipientId === friend.id || (friend.isSelf && recipientId === 'me') ? 'active' : ''}`}
                  onClick={() => {
                    setRecipientId(friend.id);
                    setAdding(false);
                    setStep('condition');
                  }}
                >
                  {friend.displayName}
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
          </>
        ) : null}

        {step === 'condition' ? (
          <>
            <h2>How does it open?</h2>
            <p className="lede">
              For {recipient?.displayName ?? 'them'}.
            </p>
            <div className="choices">
              {(
                [
                  ['MANUAL', 'Open when…'],
                  ['TOGETHER', 'Open together'],
                  ['RECIPIENT_SET', 'You decide'],
                ] as const
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
                  ? 'Both of you hold. The first wait is the point.'
                  : 'They write the condition after it arrives.'}
              </p>
            )}
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
