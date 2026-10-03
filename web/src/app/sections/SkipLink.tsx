/**
 * The first focusable element on the page.
 *
 * A keyboard user must be able to reach the workbench without tabbing through the header, the
 * hero and every step of the explainer. It is styled in `shell.css`: off-screen until it takes
 * focus, then hard-shadowed like everything else in the product.
 */
export function SkipLink() {
  return (
    <a className="skip-link" href="#workbench">
      Skip to the workbench
    </a>
  );
}
