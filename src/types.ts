export type RecordType = "lost" | "found";
export type RecordStatus = "open" | "closed" | "returned";

export interface RecordInput {
  type: RecordType;
  category: string;
  color?: string | null;
  tags?: string[];
  place?: string | null;
  area?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  contactCode: string;
  description?: string | null;
}

export interface ItemRecord {
  id: number;
  type: RecordType;
  category: string;
  color: string | null;
  tags: string[];
  place: string | null;
  area: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  contactCode: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreItem {
  rule: string;
  points: number;
  detail: string;
}

export interface Explanation {
  lostId: number;
  foundId: number;
  total: number;
  eligible: boolean;
  ineligibleReason?: string;
  items: ScoreItem[];
}

export interface ReturnEvent {
  id: number;
  lostId: number;
  foundId: number;
  reason: string;
  lostSnapshot: ItemRecord;
  foundSnapshot: ItemRecord;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
