import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

interface SearchResult {
  id: string;
  question: string;
  verdict: string;
  conversationId: string;
  conversationTitle: string;
  createdAt: string;
  relevanceScore: number;
  highlights: {
    question: string;
    verdict: string;
    hasOpinionMatch: boolean;
  };
}

interface SearchFilters {
  scope: 'all' | 'questions' | 'verdicts' | 'opinions';
  dateFrom?: string;
  dateTo?: string;
  conversationId?: string;
  hasOpinions?: boolean;
}

export const EnhancedSearch: React.FC = () => {
  const { user, fetchWithAuth } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
    scope: 'all'
  });
  const [showFilters, setShowFilters] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  });

  const performSearch = useCallback(async (page = 1) => {
    if (!query.trim() || !user) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        scope: filters.scope,
        page: page.toString(),
        limit: pagination.limit.toString(),
        sortBy: 'relevance'
      });

      if (filters.dateFrom) params.append('filters', JSON.stringify({ dateFrom: filters.dateFrom }));
      if (filters.dateTo) params.append('filters', JSON.stringify({ dateTo: filters.dateTo }));
      if (filters.conversationId) params.append('filters', JSON.stringify({ conversationId: filters.conversationId }));
      if (filters.hasOpinions !== undefined) params.append('filters', JSON.stringify({ hasOpinions: filters.hasOpinions }));

      const response = await fetchWithAuth(`/api/history/search?${params}`);
      const data = await response.json();

      setResults(data.data);
      setPagination({
        page,
        limit: pagination.limit,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages
      });
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  }, [query, user, filters, pagination.limit]);

  const performSearchRef = useRef(performSearch);
  useEffect(() => {
    performSearchRef.current = performSearch;
  }, [performSearch]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (query.trim()) {
        performSearchRef.current(1);
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, filters]);

  const handlePageChange = (newPage: number) => {
    performSearch(newPage);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const highlightText = (text: string): React.ReactNode => {
    if (!query.trim()) return text;
    // Escape regex special characters in query
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-300/50 text-inherit rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="bg-card rounded-lg p-6 border border-border">
      <h2 className="text-xl font-bold text-text mb-4">Conversation Search</h2>
      
      {/* Search Input */}
      <div className="relative mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations..."
          className="w-full px-4 py-2 bg-muted border border-border rounded-lg text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="material-symbols-outlined absolute right-3 top-2.5 text-muted">
          search
        </span>
      </div>

      {/* Filter Toggle */}
      <div className="mb-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center space-x-2 px-3 py-1 bg-muted border border-border rounded text-sm text-text hover:bg-muted/80 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">filter_list</span>
          <span>Filters</span>
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-muted/50 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Search Scope</label>
            <select
              value={filters.scope}
              onChange={(e) => setFilters({ ...filters, scope: e.target.value as SearchFilters['scope'] })}
              className="w-full px-3 py-1 bg-background border border-border rounded text-sm text-text"
            >
              <option value="all">All Fields</option>
              <option value="questions">Questions Only</option>
              <option value="verdicts">Verdicts Only</option>
              <option value="opinions">Opinions Only</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text mb-1">From Date</label>
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full px-3 py-1 bg-background border border-border rounded text-sm text-text"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">To Date</label>
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full px-3 py-1 bg-background border border-border rounded text-sm text-text"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="hasOpinions"
              checked={filters.hasOpinions || false}
              onChange={(e) => setFilters({ ...filters, hasOpinions: e.target.checked })}
              className="rounded border-border"
            />
            <label htmlFor="hasOpinions" className="text-sm text-text">
              Has opinions only
            </label>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-full mb-1"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </div>
          ))}
        </div>
      )}

      {/* Search Results */}
      {!loading && results.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-muted">
            Found {pagination.total} results
          </div>
          
          {results.map((result) => (
            <div key={result.id} className="bg-background border border-border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h3
                    className="text-sm font-medium text-text mb-1"
                  >{highlightText(result.highlights.question)}</h3>
                  <div className="text-xs text-muted">
                    {result.conversationTitle} • {formatDate(result.createdAt)}
                  </div>
                </div>
                {result.relevanceScore > 0 && (
                  <div className="ml-3 text-xs text-muted bg-muted px-2 py-1 rounded">
                    {Math.round(result.relevanceScore * 100)}% match
                  </div>
                )}
              </div>
              
              <div
                className="text-sm text-muted mb-2 line-clamp-3"
              >{highlightText(result.highlights.verdict)}</div>
              
              {result.highlights.hasOpinionMatch && (
                <div className="text-xs text-primary">
                  Contains matching opinions
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 mt-6">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 bg-muted border border-border rounded text-sm text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted/80 transition-colors"
              >
                Previous
              </button>
              
              <span className="text-sm text-muted">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 bg-muted border border-border rounded text-sm text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted/80 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* No Results */}
      {!loading && query && results.length === 0 && (
        <div className="text-center py-8">
          <span className="material-symbols-outlined text-4xl text-muted mb-2">search_off</span>
          <p className="text-muted">No results found for "{query}"</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search terms or filters</p>
        </div>
      )}
    </div>
  );
};
