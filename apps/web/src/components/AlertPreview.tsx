import type { AlertPreviewDto, IfmDiagnosticsDto, StashAlertDto } from '@stashd/shared';

/** "picked + written by IFM", "picked by IFM, template copy", … */
function provenance(alert: StashAlertDto) {
  const picked = alert.curationSource === 'ifm';
  const wrote = alert.copySource === 'ifm';
  if (picked && wrote) return 'picked + written by IFM';
  if (picked) return 'picked by IFM, template copy';
  if (wrote) return 'rules picked, IFM wrote';
  return 'rules + template copy';
}

function UsageLine({ ifm }: { ifm: IfmDiagnosticsDto }) {
  const { usage } = ifm;
  const total = usage.callsOk + usage.callsFailed;
  if (total === 0 && usage.cacheHits === 0) return null;
  return (
    <span className="ifm-usage">
      {' '}
      · {usage.callsOk} K2 call{usage.callsOk === 1 ? '' : 's'} since the API started (
      {usage.jobs.alertCopy} alert words, {usage.jobs.curation} curation, {usage.jobs.shelfCopy} shelf
      words{usage.cacheHits ? `, ${usage.cacheHits} served from cache` : ''}
      {usage.callsFailed ? `, ${usage.callsFailed} failed` : ''})
    </span>
  );
}

function IfmStatus({ ifm }: { ifm: IfmDiagnosticsDto }) {
  if (!ifm.configured) {
    return (
      <p className="hint ifm-status">
        <strong>IFM: not configured.</strong> Headlines are sorted by rules and these are template
        words. Set <code>IFM_API_URL</code> and <code>IFM_API_KEY</code> in{' '}
        <code>apps/api/.env</code> and restart the API to have {ifm.model} pick the happenings and
        write the alerts and the shelf.
      </p>
    );
  }
  const modelLine = <ModelLine ifm={ifm} />;
  if (ifm.lastResult === 'error') {
    return (
      <p className="hint ifm-status error">
        <strong>IFM: last call failed</strong> ({ifm.lastError ?? 'unknown error'}), so these fell
        back to rules and template words.
        {modelLine}
        <UsageLine ifm={ifm} />
      </p>
    );
  }
  if (ifm.lastResult === 'ok') {
    return (
      <p className="hint ifm-status ok">
        <strong>IFM: connected.</strong> {ifm.resolvedModel ?? ifm.model}
        {ifm.lastLatencyMs ? ` · last reply in ${(ifm.lastLatencyMs / 1000).toFixed(1)}s` : ''}
        {modelLine}
        <UsageLine ifm={ifm} />
      </p>
    );
  }
  return (
    <p className="hint ifm-status">
      <strong>IFM: configured</strong> ({ifm.model}), no call made yet.
      {modelLine}
    </p>
  );
}

/** Which model ID is really being sent, and what the endpoint says it serves. */
function ModelLine({ ifm }: { ifm: IfmDiagnosticsDto }) {
  const swapped = ifm.resolvedModel && ifm.resolvedModel !== ifm.model;
  const list = ifm.availableModels ?? [];
  const showList = list.length > 0 && (ifm.lastResult === 'error' || swapped);
  if (!ifm.modelHint && !showList) return null;
  return (
    <span className="ifm-models">
      {ifm.modelHint ? (
        <>
          {' '}
          {ifm.modelHint}
        </>
      ) : null}
      {showList ? (
        <>
          {' '}
          This endpoint serves:{' '}
          {list.slice(0, 12).map((id, i) => (
            <span key={id}>
              {i > 0 ? ', ' : ''}
              <code>{id}</code>
            </span>
          ))}
          {list.length > 12 ? `, … (${list.length} total)` : ''}.
        </>
      ) : null}
    </span>
  );
}

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
  busy,
  pushConfigured,
  onClose,
  onRefresh,
  onPop,
  onSendReal,
  onStash,
}: {
  preview: AlertPreviewDto | null;
  loading: boolean;
  busy: boolean;
  pushConfigured: boolean;
  onClose: () => void;
  onRefresh: () => void;
  /** Show this exact card as an OS notification right now. Nothing is stored. */
  onPop: (alert: StashAlertDto) => void;
  /** Store the card as one of today's alerts (spends budget) and pop it. */
  onSendReal: (alert?: StashAlertDto) => void;
  onStash: (alert: StashAlertDto) => void;
}) {
  const social = (preview?.friendCount ?? 0) + (preview?.groupCount ?? 0);
  const first = preview?.alerts[0];
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
                    {' · '}
                    <span className={`copy-source ${alert.copySource === 'ifm' ? 'ifm' : ''}`}>
                      {provenance(alert)}
                    </span>
                  </em>
                  <div className="ios-notification-actions">
                    <button
                      type="button"
                      className="chip"
                      disabled={busy}
                      onClick={() => onPop(alert)}
                    >
                      Pop up now
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={busy}
                      onClick={() => onSendReal(alert)}
                    >
                      Send for real
                    </button>
                    <button
                      type="button"
                      className="chip active"
                      disabled={busy}
                      onClick={() => onStash(alert)}
                    >
                      Stash for {alert.friendName}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
        </div>

        {preview ? <IfmStatus ifm={preview.ifm} /> : null}

        <p className="hint">
          "Pop up now" shows the card as a real notification in the corner of your screen, without
          storing anything. "Send for real" stores it as one of today's alerts, counts it toward the
          cap, and then pops it.
          {pushConfigured ? ' It is also pushed to any device you have subscribed.' : ''}
        </p>

        <div className="preview-actions">
          <button
            className="btn"
            type="button"
            onClick={() => onSendReal(first)}
            disabled={loading || busy || !first}
          >
            {busy ? 'Sending\u2026' : 'Send the first one for real'}
          </button>
          <button className="btn-ghost" type="button" onClick={onRefresh} disabled={loading || busy}>
            {loading ? 'Regenerating\u2026' : 'Regenerate'}
          </button>
        </div>
        <button className="btn-ghost" type="button" onClick={onClose} style={{ marginTop: 10 }}>
          Close
        </button>
      </div>
    </div>
  );
}
