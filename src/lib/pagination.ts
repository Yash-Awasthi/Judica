/**
 * P4-32: Pagination & filter standards.
 *
 * Provides reusable pagination helpers that enforce consistent
 * cursor-based and offset-based pagination across all list endpoints.
 *
 * Convention:
 *   - Offset pagination: ?page=1&limit=20 (default, for admin/dashboard)
 *   - Cursor pagination: ?cursor=xxx&limit=20 (for public APIs, infinite scroll)
 *   - Max limit is 100 per request to prevent abuse
 *   - Responses always include `pagination` metadata
 */

export interface OffsetPaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface CursorPaginationParams {
  cursor: string | null;
  limit: number;
}

export interface PaginationMeta {
  page?: number;
  limit: number;
  total?: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Parse offset pagination params from query string.
 */
export function parseOffsetPagination(query: Record<string, string | undefined>): OffsetPaginationParams {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Parse cursor pagination params from query string.
 */
export function parseCursorPagination(query: Record<string, string | undefined>): CursorPaginationParams {
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const cursor = query.cursor || null;
  return { cursor, limit };
}

/**
 * Build offset pagination response metadata.
 */
export function buildOffsetMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
}

/**
 * Build cursor pagination response metadata.
 */
export function buildCursorMeta(limit: number, items: unknown[], cursorField?: string): PaginationMeta {
  const hasMore = items.length >= limit;
  let nextCursor: string | null = null;

  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1] as Record<string, unknown>;
    const cursorValue = lastItem[cursorField || "id"];
    // P57-07: Guard against undefined/null cursor values producing "undefined" strings
    nextCursor = cursorValue !== null && cursorValue !== undefined ? String(cursorValue) : null;
  }

  return { limit, hasMore, nextCursor };
}
