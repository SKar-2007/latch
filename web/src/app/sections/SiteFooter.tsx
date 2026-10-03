/**
 * Team, track, and where the build explains itself.
 *
 * Inverted band so the page ends on a hard edge. The two links are in-page anchors like every
 * other navigation in the build: they resolve to sections the shell renders, so nothing here can
 * point at a document the dev server or the static host does not serve.
 */
export function SiteFooter() {
  return (
    <footer className="app-footer">
      <div className="page app-footer__inner">
        <div className="row app-footer__id">
          <span className="app-footer__brand">LATCH</span>
          <span className="ui-mono">TEAM CHICKEN ROLL</span>
          <span className="ui-mono">Track: Open Innovation</span>
        </div>
        <nav className="app-footer__nav" aria-label="Footer">
          <a className="app-footer__link ui-mono" href="#how">
            How it works
          </a>
          <a className="app-footer__link ui-mono" href="#limits">
            What LATCH does not do
          </a>
        </nav>
      </div>
    </footer>
  );
}
