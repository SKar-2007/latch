/**
 * The shell's sections, in document order.
 *
 * Seat A owns this folder. Feature components never import from here: they are mounted by
 * `AppShell` and its sections, never the other way round.
 */
export { SkipLink } from "./SkipLink";
export { SiteHeader } from "./SiteHeader";
export type { SiteHeaderProps } from "./SiteHeader";
export { Hero } from "./Hero";
export { HowItWorks } from "./HowItWorks";
export { Workbench } from "./Workbench";
export type { WorkbenchProps } from "./Workbench";
export { Honesty } from "./Honesty";
export { SiteFooter } from "./SiteFooter";
