import type { PromptDto } from '@stashd/shared';

function kicker(prompt: PromptDto) {
  if (prompt.kind === 'location') return 'near them';
  if (prompt.kind === 'weather') return 'where they go to school';
  if (prompt.kind === 'tier0') return 'from your shelf';
  if (prompt.kind === 'tier05') return 'you wrote this down';
  return 'on their calendar';
}

export function PromptCard({
  prompt,
  onStash,
  onDismiss,
}: {
  prompt: PromptDto;
  onStash?: (friendId?: string, suggestedCondition?: string) => void;
  onDismiss: (triggerKey: string) => void;
}) {
  return (
    <article className="prompt-card">
      <div className="prompt-kicker">{kicker(prompt)}</div>
      <h3>{prompt.title}</h3>
      <p>{prompt.body}</p>
      {prompt.sourceUrl ? (
        <p className="prompt-source">
          <a href={prompt.sourceUrl} target="_blank" rel="noreferrer">
            source
          </a>
        </p>
      ) : null}
      <div className="prompt-actions">
        <button
          className="btn"
          type="button"
          onClick={() => onStash?.(prompt.friendId, prompt.suggestedCondition)}
        >
          Stash for {prompt.friendName ?? 'them'}
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={() => onDismiss(prompt.triggerKey)}
        >
          Not now
        </button>
      </div>
    </article>
  );
}
