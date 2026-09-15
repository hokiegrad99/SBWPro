export interface Bond {
  serial: string;
  series: 'I' | 'EE';
  denomination: number; // Face value / Denomination
  issueDate: string; // MM/YYYY
  nextAccrual: string; // MM/YYYY
  finalMaturity: string; // MM/YYYY
  issuePrice: number;
  interest: number;
  interestRate: number; // e.g., 3.32 for 3.32%
  value: number;
  note: string;
  /**
   * MM/YYYY month the Interest / Rate / Value figures are "as of".
   * Stamped on import (from the report's redemption month) or manual
   * entry; powers the dashboard's value-freshness warning. Bonds saved
   * before this field existed have no stamp (undefined = unknown).
   */
  valueAsOf?: string;
  isCashedOut?: boolean; // Marked for closing or cashing out
}

export type SortField = 'serial' | 'series' | 'denomination' | 'issueDate' | 'finalMaturity' | 'issuePrice' | 'interest' | 'interestRate' | 'value';
export type SortDirection = 'asc' | 'desc';

export interface PortfolioSummary {
  totalBondsCount: number;
  totalFaceValue: number;
  totalIssuePrice: number;
  totalCurrentValue: number;
  totalInterestEarned: number;
  totalYtdInterest: number; // We can estimate or extract this
}
