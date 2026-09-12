import {
  ConditionType,
  contextConditionLabel,
  DEFAULT_MOMENTS,
  FriendDto,
  GroupDto,
  LockContext,
  MAX_MOMENT_LENGTH,
  MAX_RECIPIENTS,
  normalizeMoment,
  SongDto,
} from '@stashd/shared';
import { SongPicker } from './SongPicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Campus } from '../lib/prompts';
import { suggestConditions, SkyMap } from '../lib/sky';
import { describeSky, localClock, Sky } from '../lib/weather';

/** capture → write → who → their details → how it opens → stash */
type Step = 'media' | 'song' | 'text' | 'recipient' | 'review' | 'condition';

/** Anyone you can stash to: a paired friend or someone in one of your groups. */
export type Person = {
  id: string;
  displayName: string;
  isSelf: boolean;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  picture?: string;
};

export type UpcomingEvent = { date: string; label: string; daysAway: number };

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

function initial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function whenLabel(daysAway: number) {
  if (daysAway <= 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  return `in ${daysAway} days`;
}

export function CaptureSheet({
  friends,
  groups,
  people,
  skies,
  knownMoments,
  eventsFor,
  campusFor,
  presetRecipientId,
  replyToId,
  token,
  onClose,
  onSubmit,
}: {
  friends: FriendDto[];
  groups: GroupDto[];
  people: Record<string, Person>;
  skies: SkyMap;
  /** Moments already in use across your pairs and groups, most recent first. */
  knownMoments: string[];
  eventsFor: (schoolId: string) => UpcomingEvent[];
  campusFor: (schoolId: string | undefined) => Campus | null;
  presetRecipientId?: string;
  /** Answering an "open together": recipient and type are fixed, so those steps are skipped. */
  replyToId?: string;
  token: () => Promise<string>;
  onClose: () => void;
  onSubmit: (input: {
    recipientIds: string[];
    text: string;
    imageUrl?: string;
    conditionType: ConditionType;
    conditionLabel?: string;
    context?: LockContext | null;
    replyToId?: string;
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
  const [moment, setMoment] = useState<string | null>(null);
  const [momentDraft, setMomentDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const autoLabel = useRef('');

  const recipients = useMemo(
    () => recipientIds.map((id) => people[id]).filter((p): p is Person => Boolean(p)),
    [people, recipientIds],
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
  const recipientSkies = useMemo(
    () =>
      recipients
        .map((p) => (p.schoolId ? skies[p.schoolId] : undefined))
        .filter((sky): sky is Sky => Boolean(sky)),
    [recipients, skies],
  );
  const suggestions = useMemo(() => {
    const out = suggestConditions(recipientSkies);
    const seen = new Set<string>();
    for (const p of recipients) {
      if (!p.schoolId || seen.has(p.schoolId)) continue;
      seen.add(p.schoolId);
      for (const quirk of campusFor(p.schoolId)?.quirks ?? []) {
        if (!out.includes(quirk.condition)) out.push(quirk.condition);
      }
    }
    return out.slice(0, 6);
  }, [recipientSkies, recipients, campusFor]);

  // Moment chips: the ones already in use come first (they're albums people
  // are building), then the defaults, then whatever the sender typed.
  const momentChips = useMemo(() => {
    const out: string[] = [];
    for (const m of [...knownMoments, ...DEFAULT_MOMENTS]) {
      const n = normalizeMoment(m);
      if (n && !out.includes(n)) out.push(n);
    }
    if (moment && !out.includes(moment)) out.unshift(moment);
    return out.slice(0, 10);
  }, [knownMoments, moment]);

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

  function groupIds(group: GroupDto) {
    return group.memberIds.filter((id) => !people[id]?.isSelf);
  }

  function groupSelected(group: GroupDto) {
    const ids = groupIds(group);
    return ids.length > 0 && ids.every((id) => recipientIds.includes(id));
  }

  function toggleGroup(group: GroupDto) {
    const ids = groupIds(group);
    setRecipientIds((current) =>
      groupSelected(group)
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])].slice(0, MAX_RECIPIENTS),
    );
  }

  function fillLabel(next: string) {
    if (!conditionLabel.trim() || conditionLabel === autoLabel.current) {
      autoLabel.current = next;
      setConditionLabel(next);
    }
  }

  function pickMoment(next: string | null) {
    const normalized = next ? normalizeMoment(next) : null;
    setMoment(normalized);
    if (conditionType === 'MANUAL') {
      fillLabel(normalized ? contextConditionLabel(normalized) : '');
    }
  }

  function addTypedMoment() {
    const typed = normalizeMoment(momentDraft);
    if (!typed) return;
    pickMoment(typed);
    setMomentDraft('');
  }

  function pickSuggestion(label: string) {
    autoLabel.current = label;
    setConditionLabel(label);
  }

  function labelFor(type: ConditionType): string | undefined {
    if (type === 'MANUAL') {
      return conditionLabel.trim() || (moment ? contextConditionLabel(moment) : undefined);
    }
    if (type === 'TOGETHER' && moment) {
      return `Open together when you're ${moment}`;
    }
    return undefined;
  }

  const canStash =
    !busy &&
    recipientIds.length > 0 &&
    (Boolean(replyToId) || conditionType !== 'MANUAL' || Boolean(labelFor('MANUAL')));

  async function finish() {
    setBusy(true);
    setError('');
    try {
      await onSubmit(
        replyToId
          ? {
              recipientIds,
              text,
              imageUrl,
              songTrackId: song?.trackId,
              conditionType: 'TOGETHER',
              replyToId,
            }
          : {
              recipientIds,
              text,
              imageUrl,
              songTrackId: song?.trackId,
              conditionType,
              conditionLabel: labelFor(conditionType),
              context: conditionType === 'RECIPIENT_SET' ? null : moment,
            },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stash that.');
      setBusy(false);
    }
  }

  const sendLabel = busy
    ? 'Stashing…'
    : recipients.length === 1
      ? `Stash for ${recipients[0].isSelf ? 'myself' : recipients[0].displayName}`
      : `Stash for ${recipients.length} people`;

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-card">
        {step === 'media' ? (
          <>
            <p className="lede" style={{ marginBottom: 6 }}>
              Take a photo, or skip it and just write.
            </p>
            <div className="camera-stage">
              {imageUrl ? (
                <img className="camera-preview" src={imageUrl} alt="" />
              ) : (
                <video ref={videoRef} className="camera-preview" playsInline muted autoPlay />
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
              <button className="btn-ghost" type="button" onClick={() => libraryRef.current?.click()}>
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
            <button
              className="btn"
              type="button"
              onClick={() => setStep(replyToId ? 'condition' : 'recipient')}
            >
              {replyToId ? `Stash back to ${whoLabel}` : 'Choose who'}
            </button>
          </>
        ) : null}

        {step === 'recipient' ? (
          <>
            <h2>Who is this for?</h2>
            <p className="lede">Tap more than one to send it to several people.</p>
            {groups.length > 0 ? (
              <>
                <div className="section-label">Groups</div>
                <div className="chips">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`chip ${groupSelected(group) ? 'active' : ''}`}
                      onClick={() => toggleGroup(group)}
                    >
                      {group.name} · {groupIds(group).length}
                    </button>
                  ))}
                </div>
                <div className="section-label">People</div>
              </>
            ) : null}
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
                  {!friend.isSelf && friend.city ? ` · ${friend.city}` : ''}
                  {friend.online ? ' · online' : ''}
                </button>
              ))}
              {Object.values(people)
                .filter((p) => !p.isSelf && !friends.some((f) => f.id === p.id))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`choice ${recipientIds.includes(p.id) ? 'active' : ''}`}
                    onClick={() => toggleRecipient(p.id)}
                  >
                    {p.displayName}
                    {p.city ? ` · ${p.city}` : ''}
                    <small className="hint"> · from a group</small>
                  </button>
                ))}
              <button type="button" className="choice" onClick={() => setAdding((value) => !value)}>
                Add someone
              </button>
            </div>
            {adding ? (
              <p className="hint">Use “Add a friend” or “Join a group” in the ☰ menu.</p>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={recipientIds.length === 0}
              onClick={() => setStep('review')}
            >
              {recipients.length > 1 ? `Next · ${recipients.length} people` : 'Next'}
            </button>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <h2>{recipients.length === 1 ? `About ${whoLabel}` : `About ${recipients.length} people`}</h2>
            <p className="lede">What's going on where they are, before you pick when this opens.</p>
            {recipients.map((person) => {
              const sky = person.schoolId ? skies[person.schoolId] : undefined;
              const events = person.schoolId ? eventsFor(person.schoolId) : [];
              const campus = campusFor(person.schoolId);
              return (
                <div className="review-card" key={person.id}>
                  <span className="avatar">
                    {person.picture ? <img src={person.picture} alt="" /> : initial(person.displayName)}
                  </span>
                  <div>
                    <strong>{person.isSelf ? 'You' : person.displayName}</strong>
                    <small>
                      {person.schoolName
                        ? `${person.schoolName} · ${person.city ?? ''}`
                        : 'No school set'}
                    </small>
                    {sky ? (
                      <small>
                        {describeSky(sky)} · {localClock(sky.timezone)} their time
                      </small>
                    ) : null}
                    {events.map((event) => (
                      <small key={event.date}>
                        {event.label} {whenLabel(event.daysAway)}
                      </small>
                    ))}
                    {campus?.nextGame && campus.mascot ? (
                      <small>
                        {campus.mascot}: {campus.nextGame.label} {whenLabel(campus.nextGame.daysAway)}
                      </small>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <button className="btn" type="button" onClick={() => setStep('condition')}>
              Pick when it opens
            </button>
            <button
              className="btn-ghost"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => setStep('recipient')}
            >
              Back
            </button>
          </>
        ) : null}

        {step === 'condition' ? (
          <>
            <h2>{replyToId ? 'Stash back' : 'How does it open?'}</h2>
            <p className="lede">
              {replyToId
                ? `This answers ${whoLabel}'s "open together". It opens with theirs: they start, you open at the same moment.`
                : `For ${whoLabel}.`}
            </p>
            <div className="choices" hidden={Boolean(replyToId)}>
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
            {replyToId ? null : conditionType === 'MANUAL' ? (
              <label className="field">
                Condition, in your words
                <input
                  value={conditionLabel}
                  onChange={(event) => setConditionLabel(event.target.value)}
                  placeholder="Open when you land"
                />
                {suggestions.length > 0 ? (
                  <>
                    <span className="hint">Or tap one. These come from where they are right now.</span>
                    <div className="chips">
                      {suggestions.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className={`chip ${conditionLabel === label ? 'active' : ''}`}
                          onClick={() => pickSuggestion(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
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
            {!replyToId && conditionType !== 'RECIPIENT_SET' ? (
              <div className="field">
                <span>Add it to a moment (optional)</span>
                <div className="chips">
                  {momentChips.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`chip ${moment === item ? 'active' : ''}`}
                      onClick={() => pickMoment(moment === item ? null : item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="moment-input">
                  <input
                    value={momentDraft}
                    maxLength={MAX_MOMENT_LENGTH}
                    onChange={(event) => setMomentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTypedMoment();
                      }
                    }}
                    placeholder="or type your own: at the Fence"
                  />
                  <button
                    className="btn-ghost"
                    type="button"
                    disabled={!normalizeMoment(momentDraft)}
                    onClick={addTypedMoment}
                  >
                    Add
                  </button>
                </div>
                <p className="hint">
                  A moment is an album. Every stash tied to “{moment ?? 'getting coffee'}” across your
                  pairs and groups lands together, and when they tap “I'm here” for it, you'll know.
                </p>
              </div>
            ) : null}
            <button className="btn" type="button" disabled={!canStash} onClick={() => void finish()}>
              {sendLabel}
            </button>
            <button
              className="btn-ghost"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => setStep(replyToId ? 'text' : 'review')}
            >
              Back
            </button>
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        <button
          className="btn-ghost sheet-close"
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
