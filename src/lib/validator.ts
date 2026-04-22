// P2-18: This file provides AI-driven validation via askProvider.
// Related: lib/validation.ts provides ValidationModule (local truth-awareness checks).
// Future: merge both into a single validation/ directory.
import { askProvider } from "./providers.js";
import type { Provider, Message } from "./providers.js";
import type { AgentOutput } from "./schemas.js";
import logger from "./logger.js";
import { sanitizeForPrompt } from "./sanitize.js";
import { z } from "zod";

const llmIssueListSchema = z.object({
  issues: z.array(z.object({
    type: z.enum(["hallucination", "inconsistency", "inaccuracy", "bias", "incomplete", "safety", "format"]).default("inconsistency"),
    severity: z.enum(["low", "medium", "high"]),
    description: z.string(),
    location: z.string().optional(),
    suggestion: z.string().optional(),
  })).optional(),
  overall_quality: z.number().optional(),
});

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: ValidationIssue[];
  recommendations: string[];
  correctedVerdict?: string;
  riskLevel: 'low' | 'medium' | 'high';
  processingTime: number;
}

export interface ValidationIssue {
  type: 'hallucination' | 'inconsistency' | 'inaccuracy' | 'bias' | 'incomplete' | 'safety' | 'format';
  severity: 'low' | 'medium' | 'high';
  description: string;
  location?: string;
  suggestion?: string;
}

export interface ValidatorConfig {
  provider: Provider;
  model: string;
  maxTokens: number;
  temperature: number;
  enableFactChecking: boolean;
  enableBiasDetection: boolean;
  enableSafetyCheck: boolean;
  customRules?: ValidationRule[];
}

export interface ValidationRule {
  name: string;
  description: string;
  check: (content: string, context: unknown) => ValidationIssue | null;
}

const MAX_VALIDATION_HISTORY = 500;

export class ColdValidator {
  private config: ValidatorConfig;
  private validationHistory: Map<string, ValidationResult[]> = new Map();

  constructor(config: ValidatorConfig) {
    this.config = config;
  }

  async validateDeliberation(
    sessionId: string,
    question: string,
    verdict: string,
    agentOutputs: AgentOutput[],
    _conversationContext?: Message[]
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    
    try {
      logger.info({ sessionId }, "Starting cold validation");

      const formatIssues = this.validateFormat(verdict, agentOutputs);

      const contentIssues = await this.validateContent(question, verdict, agentOutputs);

      const consistencyIssues = this.validateConsistency(agentOutputs);

      const factCheckIssues = this.config.enableFactChecking 
        ? await this.performFactCheck(question, verdict, agentOutputs)
        : [];

      const biasIssues = this.config.enableBiasDetection
        ? await this.detectBias(verdict, agentOutputs)
        : [];

      const safetyIssues = this.config.enableSafetyCheck
        ? await this.checkSafety(verdict, agentOutputs)
        : [];

      const customIssues = await this.runCustomRules(question, verdict, agentOutputs);

      const allIssues = [
        ...formatIssues,
        ...contentIssues,
        ...consistencyIssues,
        ...factCheckIssues,
        ...biasIssues,
        ...safetyIssues,
        ...customIssues
      ];

      const { isValid, confidence, riskLevel } = this.calculateValidationMetrics(allIssues);

      const recommendations = this.generateRecommendations(allIssues);

      const correctedVerdict = await this.attemptCorrection(verdict, allIssues);

      const validationResult: ValidationResult = {
        isValid,
        confidence,
        issues: allIssues,
        recommendations,
        correctedVerdict,
        riskLevel,
        processingTime: Date.now() - startTime
      };

      this.storeValidationHistory(sessionId, validationResult);

      logger.info({
        sessionId,
        isValid,
        confidence,
        issueCount: allIssues.length,
        riskLevel,
        processingTime: validationResult.processingTime
      }, "Cold validation completed");

      return validationResult;

    } catch (error) {
      logger.error({ err: (error as Error).message, sessionId }, "Cold validation failed");
      
      return {
        isValid: false,
        confidence: 0,
        issues: [{
          type: 'incomplete',
          severity: 'high',
          description: `Validation process failed: ${(error as Error).message}`
        }],
        recommendations: ['Retry validation process'],
        riskLevel: 'high',
        processingTime: Date.now() - startTime
      };
    }
  }

  private validateFormat(verdict: string, agentOutputs: AgentOutput[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (verdict.length < 50) {
      issues.push({
        type: 'incomplete',
        severity: 'medium',
        description: 'Verdict is too short and may lack sufficient detail',
        suggestion: 'Provide more comprehensive analysis'
      });
    }

    if (verdict.length > 5000) {
      issues.push({
        type: 'incomplete',
        severity: 'low',
        description: 'Verdict is excessively long and may lose focus',
        suggestion: 'Consider condensing to key points'
      });
    }

    if (!verdict.includes('\n') && verdict.length > 200) {
      issues.push({
        type: 'format',
        severity: 'low',
        description: 'Long verdict lacks proper formatting',
        suggestion: 'Use paragraphs and structure for readability'
      });
    }

    const hasAgentReferences = agentOutputs.some(output => 
      output.name && verdict.toLowerCase().includes(output.name.toLowerCase())
    );

    if (!hasAgentReferences && agentOutputs.length > 1) {
      issues.push({
        type: 'inconsistency',
        severity: 'medium',
        description: 'Verdict doesn\'t reference specific agent opinions',
        suggestion: 'Include references to agent perspectives'
      });
    }

    return issues;
  }

  private async validateContent(
    question: string,
    verdict: string,
    _agentOutputs: AgentOutput[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // H-2 fix: sanitize untrusted inputs before embedding in LLM prompt
      const safeQuestion = sanitizeForPrompt(question);
      const safeVerdict = sanitizeForPrompt(verdict);

      const validationPrompt = `You are a content validator. Analyze this Q&A pair for quality issues:

QUESTION: ${safeQuestion}

VERDICT: ${safeVerdict}

Check for:
1. Answer relevance to the question
2. Logical coherence and reasoning
3. Completeness of the response
4. Clear structure and flow

Respond with ONLY a JSON object:
{
  "issues": [
    {
      "type": "inconsistency|inaccuracy|incomplete",
      "severity": "low|medium|high",
      "description": "Detailed description of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "overall_quality": 0.85
}`;

      const messages: Message[] = [{ role: "user", content: validationPrompt }];
      const response = await askProvider(this.config.provider, messages, false);
      
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        // M-8: validate LLM JSON output against schema before use
        const parsed = llmIssueListSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success && parsed.data.issues) {
          for (const issue of parsed.data.issues) {
            issues.push(issue);
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Content validation failed");
    }

    return issues;
  }

  private validateConsistency(agentOutputs: AgentOutput[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const confidences = agentOutputs.map(o => o.confidence);
    const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    const variance = confidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / confidences.length;

    if (variance > 0.25) {
      issues.push({
        type: 'inconsistency',
        severity: 'medium',
        description: 'High variance in agent confidence levels indicates disagreement',
        suggestion: 'Consider addressing conflicting perspectives in the verdict'
      });
    }

    const answerLengths = agentOutputs.map(o => o.answer.length);
    const avgLength = answerLengths.reduce((sum, l) => sum + l, 0) / answerLengths.length;
    
    const outliers = agentOutputs.filter(o => 
      Math.abs(o.answer.length - avgLength) > avgLength * 0.8
    );

    if (outliers.length > 0) {
      issues.push({
        type: 'inconsistency',
        severity: 'low',
        description: `Found ${outliers.length} outlier responses with unusual length`,
        suggestion: 'Review if outlier perspectives are adequately represented'
      });
    }

    return issues;
  }

  private async performFactCheck(
    question: string,
    verdict: string,
    _agentOutputs: AgentOutput[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // H-2 fix: sanitize before embedding in LLM prompt
      const safeQuestion = sanitizeForPrompt(question);
      const safeVerdict = sanitizeForPrompt(verdict);

      const factCheckPrompt = `You are a fact checker. Identify any potential factual inaccuracies in this response:

QUESTION: ${safeQuestion}

VERDICT: ${safeVerdict}

Look for:
1. Incorrect dates, numbers, or statistics
2. Misattributed quotes or sources
3. Scientific inaccuracies
4. Historical errors

Respond with ONLY a JSON object:
{
  "issues": [
    {
      "type": "inaccuracy",
      "severity": "medium|high",
      "description": "Specific factual error found",
      "location": "Where in the text this occurs",
      "suggestion": "Correction suggestion"
    }
  ]
}`;

      const messages: Message[] = [{ role: "user", content: factCheckPrompt }];
      const response = await askProvider(this.config.provider, messages, false);
      
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        // M-8: validate LLM JSON output against schema before use
        const parsed = llmIssueListSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success && parsed.data.issues) {
          for (const issue of parsed.data.issues) {
            issues.push({ type: 'inaccuracy', severity: issue.severity, description: issue.description, location: issue.location, suggestion: issue.suggestion });
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Fact checking failed");
    }

    return issues;
  }

  private async detectBias(verdict: string, _agentOutputs: AgentOutput[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // H-2 fix: sanitize before embedding in LLM prompt
      const safeVerdict = sanitizeForPrompt(verdict);

      const biasPrompt = `You are a bias detector. Analyze this response for potential biases:

VERDICT: ${safeVerdict}

Check for:
1. Political or ideological bias
2. Cultural bias or stereotypes
3. Gender bias
4. Confirmation bias
5. Overconfidence in uncertain claims

Respond with ONLY a JSON object:
{
  "issues": [
    {
      "type": "bias",
      "severity": "low|medium|high",
      "description": "Specific bias detected",
      "suggestion": "How to mitigate the bias"
    }
  ]
}`;

      const messages: Message[] = [{ role: "user", content: biasPrompt }];
      const response = await askProvider(this.config.provider, messages, false);
      
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        // M-8: validate LLM JSON output against schema before use
        const parsed = llmIssueListSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success && parsed.data.issues) {
          for (const issue of parsed.data.issues) {
            issues.push({ type: 'bias', severity: issue.severity, description: issue.description, suggestion: issue.suggestion });
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Bias detection failed");
    }

    return issues;
  }

  private async checkSafety(verdict: string, _agentOutputs: AgentOutput[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const safetyKeywords = [
      'harmful', 'dangerous', 'illegal', 'unethical', 'violent',
      'self-harm', 'suicide', 'terrorism', 'weapons', 'drugs'
    ];

    const lowerVerdict = verdict.toLowerCase();
    for (const keyword of safetyKeywords) {
      if (lowerVerdict.includes(keyword)) {
        issues.push({
          type: 'safety',
          severity: 'high',
          description: `Content contains potentially concerning keyword: ${keyword}`,
          suggestion: 'Review content for safety compliance'
        });
      }
    }

    return issues;
  }

  private async runCustomRules(
    question: string, 
    verdict: string, 
    agentOutputs: AgentOutput[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (this.config.customRules) {
      for (const rule of this.config.customRules) {
        try {
          const issue = rule.check(verdict, { question, agentOutputs });
          if (issue) {
            issues.push(issue);
          }
        } catch (error) {
          logger.warn({ rule: rule.name, err: (error as Error).message }, "Custom validation rule failed");
        }
      }
    }

    return issues;
  }

  private calculateValidationMetrics(issues: ValidationIssue[]): {
    isValid: boolean;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const highSeverityCount = issues.filter(i => i.severity === 'high').length;
    const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length;
    const totalIssues = issues.length;

    let confidence = 1.0;
    confidence -= (highSeverityCount * 0.3);
    confidence -= (mediumSeverityCount * 0.15);
    confidence -= (totalIssues * 0.05);
    confidence = Math.max(0, confidence);

    const isValid = highSeverityCount === 0 && confidence >= 0.7;

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (highSeverityCount > 0 || confidence < 0.5) {
      riskLevel = 'high';
    } else if (mediumSeverityCount > 2 || confidence < 0.8) {
      riskLevel = 'medium';
    }

    return { isValid, confidence, riskLevel };
  }

  private generateRecommendations(issues: ValidationIssue[]): string[] {
    const recommendations = new Set<string>();

    issues.forEach(issue => {
      if (issue.suggestion) {
        recommendations.add(issue.suggestion);
      }
    });

    const issueTypes = new Set(issues.map(i => i.type));
    
    if (issueTypes.has('inconsistency')) {
      recommendations.add('Review and reconcile conflicting information');
    }
    
    if (issueTypes.has('inaccuracy')) {
      recommendations.add('Verify factual claims with reliable sources');
    }
    
    if (issueTypes.has('bias')) {
      recommendations.add('Consider alternative perspectives and viewpoints');
    }
    
    if (issueTypes.has('incomplete')) {
      recommendations.add('Provide more comprehensive coverage of the topic');
    }

    return Array.from(recommendations);
  }

  private async attemptCorrection(verdict: string, issues: ValidationIssue[]): Promise<string | undefined> {
    const correctableIssues = issues.filter(i =>
      i.severity === 'low' && (i.type === 'format' || i.type === 'incomplete')
    );

    if (correctableIssues.length === 0) {
      return undefined;
    }

    try {
      // H-2 fix: sanitize verdict before embedding in LLM prompt
      const safeVerdict = sanitizeForPrompt(verdict);

      const correctionPrompt = `Improve this verdict by addressing these minor issues:

VERDICT: ${safeVerdict}

ISSUES TO FIX:
${correctableIssues.map(i => `- ${i.description}: ${i.suggestion}`).join('\n')}

Provide a corrected version that addresses these issues while preserving the core content. Respond with ONLY the corrected verdict.`;

      const messages: Message[] = [{ role: "user", content: correctionPrompt }];
      const response = await askProvider(this.config.provider, messages, false);
      
      return response.text.trim();
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Auto-correction failed");
      return undefined;
    }
  }

  private storeValidationHistory(sessionId: string, result: ValidationResult): void {
    if (this.validationHistory.size >= MAX_VALIDATION_HISTORY) {
      const oldest = this.validationHistory.keys().next().value;
      if (oldest !== undefined) this.validationHistory.delete(oldest);
    }

    const history = this.validationHistory.get(sessionId) || [];
    history.push(result);

    if (history.length > 10) {
      history.shift();
    }

    this.validationHistory.set(sessionId, history);

    // L-6: Cap the number of tracked sessions to prevent unbounded memory growth.
    // Evict the oldest session when the Map exceeds 1000 entries.
    if (this.validationHistory.size > 1000) {
      const oldestKey = this.validationHistory.keys().next().value;
      if (oldestKey !== undefined) this.validationHistory.delete(oldestKey);
    }
  }

  getValidationStats(): {
    totalValidations: number;
    averageConfidence: number;
    issueFrequency: Record<string, number>;
    riskDistribution: Record<string, number>;
  } {
    const allValidations = Array.from(this.validationHistory.values()).flat();
    
    const totalValidations = allValidations.length;
    const averageConfidence = totalValidations > 0 
      ? allValidations.reduce((sum, v) => sum + v.confidence, 0) / totalValidations
      : 0;

    const issueFrequency: Record<string, number> = {};
    const riskDistribution: Record<string, number> = { low: 0, medium: 0, high: 0 };

    allValidations.forEach(validation => {
      validation.issues.forEach(issue => {
        issueFrequency[issue.type] = (issueFrequency[issue.type] || 0) + 1;
      });
      riskDistribution[validation.riskLevel]++;
    });

    return {
      totalValidations,
      averageConfidence,
      issueFrequency,
      riskDistribution
    };
  }
}

export function createDefaultValidator(provider: Provider): ValidatorConfig {
  return {
    provider,
    model: provider.model,
    maxTokens: 2000,
    temperature: 0.1, // Low temperature for consistent validation
    enableFactChecking: true,
    enableBiasDetection: true,
    enableSafetyCheck: true,
    customRules: [
      {
        name: 'answer_relevance',
        description: 'Check if verdict directly addresses the question',
        check: (content: string, context: unknown) => {
          const ctx = context as { question?: string; agentOutputs?: AgentOutput[] };
          const question = ctx.question?.toLowerCase() || '';
          const verdict = content.toLowerCase();
          
          const questionWords = question.split(' ').filter((w: string) => w.length > 3);
          const overlap = questionWords.filter((word: string) => verdict.includes(word)).length;
          
          if (overlap < questionWords.length * 0.3) {
            return {
              type: 'inconsistency',
              severity: 'medium',
              description: 'Verdict may not directly address the question',
              suggestion: 'Ensure the verdict directly responds to the asked question'
            };
          }
          
          return null;
        }
      }
    ]
  };
}
