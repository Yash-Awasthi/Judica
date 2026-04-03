import { askProvider, Provider, Message } from "./providers.js";
import { AgentOutput, parseAgentOutput } from "./schemas.js";
import logger from "./logger.js";

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

/**
 * Cold Validator - Fresh eyes validation system.
 * Uses a separate model instance to validate council outputs without context bias.
 */
export class ColdValidator {
  private config: ValidatorConfig;
  private validationHistory: Map<string, ValidationResult[]> = new Map();

  constructor(config: ValidatorConfig) {
    this.config = config;
  }

  /**
   * Validate council deliberation results with fresh perspective.
   */
  async validateDeliberation(
    sessionId: string,
    question: string,
    verdict: string,
    agentOutputs: AgentOutput[],
    conversationContext?: Message[]
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    
    try {
      logger.info({ sessionId }, "Starting cold validation");

      // Step 1: Basic format and structure validation
      const formatIssues = this.validateFormat(verdict, agentOutputs);

      // Step 2: Content quality validation
      const contentIssues = await this.validateContent(question, verdict, agentOutputs);

      // Step 3: Consistency check across agent outputs
      const consistencyIssues = this.validateConsistency(agentOutputs);

      // Step 4: Fact checking (if enabled)
      const factCheckIssues = this.config.enableFactChecking 
        ? await this.performFactCheck(question, verdict, agentOutputs)
        : [];

      // Step 5: Bias detection (if enabled)
      const biasIssues = this.config.enableBiasDetection
        ? await this.detectBias(verdict, agentOutputs)
        : [];

      // Step 6: Safety check (if enabled)
      const safetyIssues = this.config.enableSafetyCheck
        ? await this.checkSafety(verdict, agentOutputs)
        : [];

      // Step 7: Custom validation rules
      const customIssues = await this.runCustomRules(question, verdict, agentOutputs);

      // Combine all issues
      const allIssues = [
        ...formatIssues,
        ...contentIssues,
        ...consistencyIssues,
        ...factCheckIssues,
        ...biasIssues,
        ...safetyIssues,
        ...customIssues
      ];

      // Calculate overall confidence and validity
      const { isValid, confidence, riskLevel } = this.calculateValidationMetrics(allIssues);

      // Generate recommendations
      const recommendations = this.generateRecommendations(allIssues);

      // Attempt to correct minor issues
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

      // Store validation history
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

  /**
   * Validate format and structure of the verdict.
   */
  private validateFormat(verdict: string, agentOutputs: AgentOutput[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check length
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

    // Check for structured elements
    if (!verdict.includes('\n') && verdict.length > 200) {
      issues.push({
        type: 'format',
        severity: 'low',
        description: 'Long verdict lacks proper formatting',
        suggestion: 'Use paragraphs and structure for readability'
      });
    }

    // Check for agent reference
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

  /**
   * Validate content quality and coherence.
   */
  private async validateContent(
    question: string, 
    verdict: string, 
    agentOutputs: AgentOutput[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const validationPrompt = `You are a content validator. Analyze this Q&A pair for quality issues:

QUESTION: ${question}

VERDICT: ${verdict}

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
        const validation = JSON.parse(jsonMatch[0]);
        
        if (validation.issues && Array.isArray(validation.issues)) {
          for (const issue of validation.issues) {
            issues.push({
              type: issue.type,
              severity: issue.severity,
              description: issue.description,
              suggestion: issue.suggestion
            });
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Content validation failed");
    }

    return issues;
  }

  /**
   * Validate consistency across agent outputs.
   */
  private validateConsistency(agentOutputs: AgentOutput[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for contradictory confidence levels
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

    // Check for outlier responses
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

  /**
   * Perform basic fact checking.
   */
  private async performFactCheck(
    question: string, 
    verdict: string, 
    agentOutputs: AgentOutput[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const factCheckPrompt = `You are a fact checker. Identify any potential factual inaccuracies in this response:

QUESTION: ${question}

VERDICT: ${verdict}

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
        const factCheck = JSON.parse(jsonMatch[0]);
        
        if (factCheck.issues && Array.isArray(factCheck.issues)) {
          for (const issue of factCheck.issues) {
            issues.push({
              type: 'inaccuracy',
              severity: issue.severity,
              description: issue.description,
              location: issue.location,
              suggestion: issue.suggestion
            });
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Fact checking failed");
    }

    return issues;
  }

  /**
   * Detect potential biases in the response.
   */
  private async detectBias(verdict: string, agentOutputs: AgentOutput[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const biasPrompt = `You are a bias detector. Analyze this response for potential biases:

VERDICT: ${verdict}

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
        const biasCheck = JSON.parse(jsonMatch[0]);
        
        if (biasCheck.issues && Array.isArray(biasCheck.issues)) {
          for (const issue of biasCheck.issues) {
            issues.push({
              type: 'bias',
              severity: issue.severity,
              description: issue.description,
              suggestion: issue.suggestion
            });
          }
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "Bias detection failed");
    }

    return issues;
  }

  /**
   * Check for safety concerns.
   */
  private async checkSafety(verdict: string, agentOutputs: AgentOutput[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Basic safety keyword detection
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

  /**
   * Run custom validation rules.
   */
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

  /**
   * Calculate overall validation metrics.
   */
  private calculateValidationMetrics(issues: ValidationIssue[]): {
    isValid: boolean;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const highSeverityCount = issues.filter(i => i.severity === 'high').length;
    const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length;
    const totalIssues = issues.length;

    // Calculate confidence based on issue count and severity
    let confidence = 1.0;
    confidence -= (highSeverityCount * 0.3);
    confidence -= (mediumSeverityCount * 0.15);
    confidence -= (totalIssues * 0.05);
    confidence = Math.max(0, confidence);

    // Determine validity
    const isValid = highSeverityCount === 0 && confidence >= 0.7;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (highSeverityCount > 0 || confidence < 0.5) {
      riskLevel = 'high';
    } else if (mediumSeverityCount > 2 || confidence < 0.8) {
      riskLevel = 'medium';
    }

    return { isValid, confidence, riskLevel };
  }

  /**
   * Generate recommendations based on issues found.
   */
  private generateRecommendations(issues: ValidationIssue[]): string[] {
    const recommendations = new Set<string>();

    // Add suggestions from issues
    issues.forEach(issue => {
      if (issue.suggestion) {
        recommendations.add(issue.suggestion);
      }
    });

    // Add general recommendations based on issue types
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

  /**
   * Attempt to automatically correct minor issues.
   */
  private async attemptCorrection(verdict: string, issues: ValidationIssue[]): Promise<string | undefined> {
    const correctableIssues = issues.filter(i => 
      i.severity === 'low' && (i.type === 'format' || i.type === 'incomplete')
    );

    if (correctableIssues.length === 0) {
      return undefined;
    }

    try {
      const correctionPrompt = `Improve this verdict by addressing these minor issues:

VERDICT: ${verdict}

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

  /**
   * Store validation history for analysis.
   */
  private storeValidationHistory(sessionId: string, result: ValidationResult): void {
    const history = this.validationHistory.get(sessionId) || [];
    history.push(result);
    
    // Keep only last 10 validations per session
    if (history.length > 10) {
      history.shift();
    }
    
    this.validationHistory.set(sessionId, history);
  }

  /**
   * Get validation statistics.
   */
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

/**
 * Create a default validator configuration.
 */
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
          
          // Simple keyword overlap check
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
