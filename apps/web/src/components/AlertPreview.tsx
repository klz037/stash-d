import type { AlertPreviewDto, StashAlertDto } from '@stashd/shared';

function kindLabel(kind: StashAlertDto['kind']) {
  switch (kind) {
    case 'athletics':
      return 'game day';
    case 'tradition':
      return 'tradition';
    case 'food':
      return 'food';
    case 'event':
      return 'on campus';
    default:
      return 'happening';
  }
}

function timeLabel(index: number, budget: number) {
  // Purely illustrative spacing across an awake day, so the preview reads like a real lock screen.
  const start = 9;
  const end = 20;
  const span = Math.max(1, budget - 1);
  const hour = Math.round(start + (index * (end - start)) / span);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${index % 2 === 0 ? '05' : '40'} ${suffix}`;
}

export function AlertPreview({
  preview,
  loading,
  pushConfigured,
  onClose,
  onRefresh,
  onPop,
  onSendReal,
  onStash,
}: {
  preview: AlertPreviewDto | null;
  loading: boolean;
  pushConfigured: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onPop: (alert: StashAlertDto) => void;
  onSendReal: () => void;
  onStash: (alert: StashAlertDto) => void;
}) {
  const social = (preview?.friendCount ?? 0) + (preview?.groupCount ?? 0);
  return (
    <div className="sheet" role="dialog" aria-label="Alert preview">
      <div className="sheet-card">
        <h2>Today's alerts, previewed</h2>
        {preview ? (
          <p className="hint">
            {preview.friendCount} friend{preview.friendCount === 1 ? '' : 's'} + {preview.groupCount}{' '}
            group{preview.groupCount === 1 ? '' : 's'} = {social}.{' '}
            {social > 4
              ? `Over 4, so the cap is ${preview.dailyBudget} today.`
              : social === 0
                ? 'Nobody to stash for yet, so nothing will fire.'
                : `4 or fewer, so the cap is ${preview.dailyBudget} today.`}{' '}
            Sent so far: {preview.sentToday}/{preview.dailyBudget}.
          </p>
        ) : null}

        <div className="lockscreen">
          <div className="lockscreen-time">
            <span>{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <small>
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </small>
          </div>

          {loading ? <div className="ios-notification skeleton" /> : null}

          {!loading && preview && preview.alerts.length === 0 ? (
            <div className="ios-notification">
              <div className="ios-notification-head">
                <img src="/pwa-192.png" alt="" />
                <span>stash'd</span>
                <time>now</time>
              </div>
              <strong>Nothing to send today</strong>
              <p>Add a friend with a school set, or run the demo seeder.</p>
            </div>
          ) : null}

          {!loading &&
            preview?.alerts.map((alert, index) => (
              <article className="ios-notification" key={alert.id}>
                <div className="ios-notification-head">
                  <img src="/pwa-192.png" alt="" />
                  <span>stash'd</span>
                  <time>{timeLabel(index, preview.alerts.length)}</time>
                </div>
                <strong>{alert.title}</strong>
                <p>{alert.body}</p>
                <footer>
                  <em>
                    {alert.friendName} · {alert.schoolName} · {kindLabel(alert.kind)}
                    {alert.sourceLabel ? ` · ${alert.sourceLabel}` : ''}
                  </em>
                  <div className="ios-notification-actions">
                    <button type="button" className="chip" onClick={() => onPop(alert)}>
                      Pop on this device
                    </button>
                    <button type="button" className="chip active" onClick={() => onStash(alert)}>
                      Stash for {alert.friendName}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
        </div>

        <p className="hint">
          "Pop on this device" shows a real OS notification here on your laptop, no push server needed.
          {pushConfigured
            ? ' "Send one for real" goes through Web Push so it also lands on a locked iPhone.'
            : ' Add VAPID keys to the API to push these to a locked iPhone.'}
        </p>

        <div className="preview-actions">
          <button className="btn" type="button" onClick={onSendReal} disabled={loading}>
            Send one for real
          </button>
          <button className="btn-ghost" type="button" onClick={onRefresh} disabled={loading}>
            Regenerate
          </button>
        </div>
        <button className="btn-ghost" type="button" onClick={onClose} style={{ marginTop: 10 }}>
          Close
        </button>
      </div>
    </div>
  );
}
