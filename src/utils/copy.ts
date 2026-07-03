/**
 * Centralized user-facing copy that may change as the app's scope
 * evolves. Update these constants in one place when the app graduates
 * past the paper-bonds-only stage (e.g. when electronic TreasuryDirect
 * bonds are added) so both the in-page tagline and any other surface
 * that pulls from here can flip in lockstep.
 */

/**
 * Visible tagline rendered under the "Savings Bond Wizard Pro" logo
 * in the dashboard header. Reads like a subtitle / utility description
 * rather than a heading. Imported by App.tsx so future modes can swap
 * the wording here without touching the JSX layout.
 */
export const APP_TAGLINE = 'US Treasury Paper Bonds Portfolio Management';
