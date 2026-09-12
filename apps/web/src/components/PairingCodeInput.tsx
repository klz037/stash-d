import { FormEvent, useRef, useState } from 'react';
import { normalizePairingCode } from '@stashd/shared';

const boxes = [0, 1, 2, 3, 4, 5];

export function PairingCodeInput({
  onSubmit,
  error,
}: {
  onSubmit: (code: string) => Promise<void> | void;
  error?: string;
}) {
  const [chars, setChars] = useState(['', '', '', '', '', '']);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function write(next: string[], index: number) {
    setChars(next);
    if (next.join('').length === 6) {
      void onSubmit(next.join(''));
    } else if (next[index] && refs.current[index + 1]) {
      refs.current[index + 1]?.focus();
    }
  }

  function handleChange(index: number, value: string) {
    const clean = normalizePairingCode(value).slice(-1);
    const next = [...chars];
    next[index] = clean;
    write(next, index);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = normalizePairingCode(event.clipboardData.getData('text')).slice(
      0,
      6,
    );
    const next = ['', '', '', '', '', ''];
    pasted.split('').forEach((char, index) => {
      next[index] = char;
    });
    setChars(next);
    if (pasted.length === 6) {
      void onSubmit(pasted);
    } else {
      refs.current[pasted.length]?.focus();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void onSubmit(chars.join(''));
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="code-boxes">
        {boxes.map((index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            value={chars[index]}
            maxLength={1}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => handleChange(index, event.target.value)}
            onPaste={handlePaste}
            aria-label={`Pairing character ${index + 1}`}
          />
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
