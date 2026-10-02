export type RecordKind = "lost" | "found";
export type RecordStatus = "open" | "closed" | "returned";

export interface ItemRecord {
  id: string;
  kind: RecordKind;
  category: string;
  itemName: string;
  colors: string[];
  tags: string[];
  location: string;
  area: string;
  dateFrom: string;
  dateTo: string;
  contactCode: string;
  description: string;
  status: RecordStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ExplainResult = "match" | "partial" | "mismatch" | "missing";

export interface ScoreItem {
  dimension: string;
  points: number;
  result: ExplainResult;
  detail: string;
}

export interface Candidate {
  lostId: string;
  foundId: string;
  totalScore: number;
  items: ScoreItem[];
  warning: string | null;
}

export interface ReturnEvent {
  id: number;
  lostId: string;
  foundId: string;
  reason: string;
  operator: string;
  scoreAtReturn: Candidate | null;
  lostSnapshot: ItemRecord;
  foundSnapshot: ItemRecord;
  createdAt: string;
}

export interface RecordInput {
  kind: RecordKind;
  category: string;
  itemName: string;
  colors: string[];
  tags: string[];
  location: string;
  area: string;
  dateFrom: string;
  dateTo: string;
  contactCode: string;
  description?: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
