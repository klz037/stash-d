import type { PromptDto } from '@stashd/shared';

export function PromptCard({
  prompt,
  onStash,
  onDismiss,
}: {
  prompt: PromptDto;
  onStash?: (friendId?: string) => void;
  onDismiss: (triggerKey: string) => void;
}) {
  return (
    <article className="prompt-card">
      <div className="prompt-kicker">
        {prompt.emotion === 'weather'
          ? 'from their sky'
          : prompt.kind === 'tier0'
            ? 'from your shelf'
            : prompt.kind === 'tier05'
              ? 'you wrote this down'
              : 'on their calendar'}
      </div>
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
          onClick={() => onStash?.(prompt.friendId)}
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
