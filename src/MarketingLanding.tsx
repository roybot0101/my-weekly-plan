export function MarketingLanding() {
  return (
    <div className="marcom-shell">
      <div className="marcom-glow marcom-glow-left" aria-hidden="true" />
      <div className="marcom-glow marcom-glow-right" aria-hidden="true" />
      <main className="marcom-card">
        <img className="marcom-owl logo-entrance" src="/img/tempo-icon.png" alt="Plan with Tempo owl" />
        <h1 className="marcom-title">Plan with Tempo</h1>
        <p className="marcom-subhead">Intelligent Weekly Planner for Creators.</p>
        <div className="marcom-video-wrap">
          <iframe
            className="marcom-video"
            src="https://www.loom.com/embed/ef65ffaa522241458795235aac80342d"
            title="Plan with Tempo product walkthrough"
            loading="lazy"
            allowFullScreen
          />
        </div>
        <a className="marcom-cta tempo-primary-button" href="https://app.planwithtempo.com">
          Try for FREE
        </a>
        <p className="marcom-legal">
          <a href="/privacy.html">Privacy Policy</a>
        </p>
      </main>
    </div>
  );
}
