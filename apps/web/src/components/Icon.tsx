import type { CSSProperties } from 'react';

/**
 * The hand-drawn icon set. One file per icon, inlined at build time with every
 * `fill` set to `currentColor`, so ink/bone is a CSS `color` away — there is no
 * second file to swap and no second copy to keep in sync.
 *
 *   Ink  (#1E2433) on Bone backgrounds:  color: var(--icon-ink)
 *   Bone (#F2EDE3) on dark surfaces:     color: var(--icon-bone)
 *
 * Sizing follows the house rule: `width` is set, height stays `auto`, so the
 * viewBox does the rest and nothing is ever squashed.
 */
const SOURCES = import.meta.glob<string>('../../public/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** `../../public/icons/star.svg` -> `star` */
function slug(path: string) {
  return path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
}

const ICONS: Record<string, string> = {};
for (const [path, source] of Object.entries(SOURCES)) {
  const name = slug(path);
  // The generated single-colour files only. The -ink/-bone pairs are still on
  // disk as the drawing originals; they are not what the app renders.
  if (name.endsWith('-ink') || name.endsWith('-bone') || name.endsWith('-black') || name.endsWith('-white')) {
    continue;
  }
  ICONS[name] = source;
}

export type IconName =
  | 'camera-icon'
  | 'voicenote-icon'
  | 'star'
  | 'profile-icon'
  | 'stash-button'
  | 'left-arrow'
  | 'right-arrow'
  | 'empty-clothesline'
  | 'stashd-logo';

export function Icon({
  name,
  width,
  className,
  style,
  title,
}: {
  name: IconName;
  /** Width in px. Height is always left to the viewBox. */
  width: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const source = ICONS[name];
  if (!source) {
    // A missing icon is a build-time authoring mistake, not a runtime state.
    // Render nothing rather than substituting some other icon.
    return null;
  }
  return (
    <span
      className={`icon ${className ?? ''}`}
      style={{ width, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: source }}
    />
  );
}
