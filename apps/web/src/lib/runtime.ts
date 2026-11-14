/**
 * Which surface this bundle runs on. The desktop shell is built in desktop mode
 * (see `apps/desktop`), so the flag is fixed at build time; the web deploy and
 * its PWA behavior keep the default.
 */
export const isDesktop = import.meta.env.CLARA_DESKTOP === true
