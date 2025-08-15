// Shared types live here (e.g., slim entities)
export type Cursor = string;

export type PaginatedResponse<T> = {
  data: T[];
  nextCursor?: Cursor;
};
