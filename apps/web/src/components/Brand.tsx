/** Logo and wordmark, centered at the top of every screen. Tappable when given onClick. */
export function Brand({ onClick }: { onClick?: () => void }) {
  const inner = (
    <>
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span className="wordmark">
        stash<span>'d</span>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button className="brand" type="button" onClick={onClick} aria-label="Account">
        {inner}
      </button>
    );
  }
  return <div className="brand">{inner}</div>;
}
