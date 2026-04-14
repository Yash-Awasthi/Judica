import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface EvaluationData {
  currentPerformance: {
    overallScore: number;
    consensus: number;
    quality: number;
    diversity: number;
    efficiency: number;
    trend: number;
  };
  benchmark: {
    userScore: number;
    benchmarkScore: number;
    percentile: number;
    ranking: 'excellent' | 'good' | 'average' | 'below_average';
  };
  totalEvaluations: number;
}

export const EvaluationDashboard: React.FC = () => {
  const { user, fetchWithAuth } = useAuth();
  const [evaluationData, setEvaluationData] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(30);

  useEffect(() => {
    if (!user) return;

    const fetchEvaluationData = async () => {
      try {
        const response = await fetchWithAuth(`/api/evaluation/dashboard?days=${selectedPeriod}`);
        const data = await response.json();
        setEvaluationData(data);
      } catch (error) {
        console.error('Failed to fetch evaluation data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvaluationData();
  }, [user, selectedPeriod]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-6 border border-border">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-32"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!evaluationData) return null;

  const { currentPerformance, benchmark, totalEvaluations } = evaluationData;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success';
    if (score >= 60) return 'text-warning';
    return 'text-danger';
  };

  const getRankingColor = (ranking: string) => {
    switch (ranking) {
      case 'excellent': return 'text-success';
      case 'good': return 'text-primary';
      case 'average': return 'text-warning';
      case 'below_average': return 'text-danger';
      default: return 'text-text';
    }
  };

  const getProgressBarColor = (score: number) => {
    if (score >= 80) return 'bg-success';
    if (score >= 60) return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <div className="bg-card rounded-lg p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text">Performance Dashboard</h2>
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(Number(e.target.value))}
          className="px-3 py-1 bg-muted border border-border rounded text-sm text-text"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Overall Score */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text">Overall Performance</span>
          <span className={`text-2xl font-bold ${getScoreColor(currentPerformance.overallScore)}`}>
            {currentPerformance.overallScore.toFixed(1)}
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${getProgressBarColor(currentPerformance.overallScore)}`}
            style={{ width: `${currentPerformance.overallScore}%` }}
          ></div>
        </div>
      </div>

      {/* Performance Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted mb-1">Consensus</div>
          <div className={`text-lg font-bold ${getScoreColor(currentPerformance.consensus * 100)}`}>
            {(currentPerformance.consensus * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted mb-1">Quality</div>
          <div className={`text-lg font-bold ${getScoreColor(currentPerformance.quality * 100)}`}>
            {(currentPerformance.quality * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted mb-1">Diversity</div>
          <div className={`text-lg font-bold ${getScoreColor(currentPerformance.diversity * 100)}`}>
            {(currentPerformance.diversity * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted mb-1">Efficiency</div>
          <div className={`text-lg font-bold ${getScoreColor(currentPerformance.efficiency * 100)}`}>
            {(currentPerformance.efficiency * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Benchmark Comparison */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text mb-3">Performance Ranking</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Your Score</span>
            <span className="font-bold text-text">{benchmark.userScore.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Benchmark</span>
            <span className="font-bold text-text">{benchmark.benchmarkScore.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Percentile</span>
            <span className={`font-bold ${getScoreColor(benchmark.percentile)}`}>
              {benchmark.percentile.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Ranking</span>
            <span className={`font-bold capitalize ${getRankingColor(benchmark.ranking)}`}>
              {benchmark.ranking.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Trend Indicator */}
      {currentPerformance.trend !== 0 && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center space-x-2">
            <span className="material-symbols-outlined text-sm">
              {currentPerformance.trend > 0 ? 'trending_up' : 'trending_down'}
            </span>
            <span className={`text-sm font-medium ${
              currentPerformance.trend > 0 ? 'text-success' : 'text-danger'
            }`}>
              {currentPerformance.trend > 0 ? 'Improving' : 'Declining'} trend
            </span>
          </div>
        </div>
      )}

      {/* Total Evaluations */}
      <div className="mt-4 text-center">
        <span className="text-xs text-muted">
          Based on {totalEvaluations} evaluations in the last {selectedPeriod} days
        </span>
      </div>
    </div>
  );
};
