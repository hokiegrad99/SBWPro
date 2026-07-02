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
