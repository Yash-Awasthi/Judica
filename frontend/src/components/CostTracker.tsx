import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface CostData {
  totalCost: number;
  totalTokens: number;
  avgCostPerRequest: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  warnings: string[];
}

export const CostTracker: React.FC = () => {
  const { user } = useAuth();
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchCostData = async () => {
      try {
        const response = await fetch('/api/costs/breakdown?days=30');
        const data = await response.json();
        
        const limitsResponse = await fetch('/api/costs/limits');
        const limitsData = await limitsResponse.json();
        
        setCostData({
          totalCost: data.breakdown.totalCost,
          totalTokens: data.breakdown.totalTokens,
          avgCostPerRequest: data.currentPeriod?.avgCostPerRequest || 0,
          dailyLimit: limitsData.dailyUsage,
          monthlyLimit: limitsData.monthlyUsage,
          warnings: limitsData.warnings || []
        });
      } catch (error) {
        console.error('Failed to fetch cost data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCostData();
    const interval = setInterval(fetchCostData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [user]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-24 mb-2"></div>
          <div className="h-6 bg-muted rounded w-16"></div>
        </div>
      </div>
    );
  }

  if (!costData) return null;

  // Color tiers: <$0.01 green, $0.01-0.05 yellow, >$0.05 red
  const getCostColor = (cost: number): string => {
    if (cost < 0.01) return 'text-green-400';
    if (cost <= 0.05) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getCostBg = (cost: number): string => {
    if (cost < 0.01) return 'bg-green-500';
    if (cost <= 0.05) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const costPercentage = costData.monthlyLimit ? (costData.totalCost / costData.monthlyLimit) * 100 : 0;
  const isNearLimit = costData.warnings.length > 0;

  return (
    <div className={`bg-card rounded-lg p-4 border ${isNearLimit ? 'border-warning' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Cost Tracker</h3>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-muted hover:text-text transition-colors"
        >
          {showDetails ? 'Hide' : 'Show'} Details
        </button>
      </div>
      
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${getCostColor(costData.totalCost)}`}>
            ${costData.totalCost.toFixed(4)}
          </span>
          <span className="text-xs text-muted">
            {costData.totalTokens.toLocaleString()} tokens
          </span>
        </div>
        
        {costData.monthlyLimit && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Monthly Usage</span>
              <span className={isNearLimit ? 'text-warning' : 'text-text'}>
                ${costData.monthlyLimit.toFixed(2)}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all ${getCostBg(costData.totalCost)}`}
                style={{ width: `${Math.min(costPercentage, 100)}%` }}
              ></div>
            </div>
          </div>
        )}
        
        {costData.warnings.length > 0 && (
          <div className="bg-warning/10 border border-warning/20 rounded p-2">
            <p className="text-xs text-warning">
              {costData.warnings[0]}
            </p>
          </div>
        )}
      </div>
      
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Avg Cost per Request</span>
            <span className="text-text">${costData.avgCostPerRequest.toFixed(4)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Avg Tokens per Request</span>
            <span className="text-text">
              {Math.round(costData.totalTokens / (costData.totalCost / costData.avgCostPerRequest) || 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
