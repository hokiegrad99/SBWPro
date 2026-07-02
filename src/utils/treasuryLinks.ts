/**
 * TreasuryDirect URLs for the Savings Bond Calculator.
 *
 * Update these in one place when TreasuryDirect reorganizes their site.
 * Import from App.tsx rather than inlining the strings — keeps click
 * targets in lockstep with the centralized definitions.
 */

/** Public calculator where users save an HTML backup of their bonds. */
export const TREASURY_CALCULATOR_URL =
  'https://www.treasurydirect.gov/BC/SBCPrice';

/**
 * Step-by-step help for entering paper bonds into the official
 * calculator. Linked from the "Quick Reference & Calculator Guide"
 * informational panel at the bottom of the right column.
 */
export const TREASURY_CALCULATOR_HELP_URL =
  'https://www.treasurydirect.gov/indiv/help/bc/savings-bond-calc-instructions/';
