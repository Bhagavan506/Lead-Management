export type Status = "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
export type LostReason =
  "PRICE" | "NO_RESPONSE" | "CHOSE_COMPETITOR" | "WRONG_CONTACT" | "NOT_INTERESTED" | "OTHER";
export type CallOutcome = "ANSWERED" | "NO_ANSWER" | "BUSY" | "WRONG_NUMBER";

export interface Lead {
  id: string;
  name: string;
  hasName: boolean;
  company: string;
  phone: string;
  source: string;
  community: string;
  flatNumber: string;
  address: string;
  flatType: string;
  area: string;
  requirements: string;
  status: Status;
  lostReason: LostReason | null;
  followUpDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  lastActivityAt: string;
  lastActivityText: string | null;
  isStale: boolean;
  createdAt: string;
}
export interface LeadList {
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  staleDays: number;
}
export interface TimelineEntry {
  id: string;
  type: string;
  text: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}
export interface LeadDetail {
  lead: Lead;
  timeline: TimelineEntry[];
  timelineTruncated: boolean;
  staleDays: number;
}
export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  phone: string | null;
  isActive: boolean;
  openLeads: number;
}
