// Display wording used in history entries. Copied from the prototype so the timeline reads the same.
export const STATUS_LABEL = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  WON: "Won",
  LOST: "Lost",
} as const;

export const LOST_REASON_LABEL = {
  PRICE: "Price",
  NO_RESPONSE: "No response",
  CHOSE_COMPETITOR: "Chose competitor",
  WRONG_CONTACT: "Wrong contact",
  NOT_INTERESTED: "Not interested",
  OTHER: "Other",
} as const;

export const CALL_OUTCOME_LABEL = {
  ANSWERED: "Answered",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  WRONG_NUMBER: "Wrong number",
} as const;

export type Status = keyof typeof STATUS_LABEL;
export type LostReason = keyof typeof LOST_REASON_LABEL;
export type CallOutcome = keyof typeof CALL_OUTCOME_LABEL;
