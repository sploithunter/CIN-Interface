/**
 * Feedback system types for CIN-Interface
 */

import type { FixerStatus } from '../../shared/feedbackConfig.js';

// Re-export FixerStatus for consumers of the feedback types
export type { FixerStatus };

export type FeedbackType = 'bug' | 'improve' | 'works';

export interface Feedback {
  id: string;                    // UUID
  type: FeedbackType;
  description: string;           // User's feedback text

  // Context
  timestamp: number;
  sessionId?: string;            // Active session when submitted
  sessionName?: string;
  sessionStatus?: string;
  recentEvents: string[];        // Last 5 event types
  consoleErrors: string[];       // Recent console.error outputs

  // Browser context
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string;

  // Screenshot
  screenshotPath?: string;       // Path to saved screenshot file
  screenshotUrl?: string;        // GitHub raw URL after upload

  // Processing status
  processed: boolean;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  groupedWith?: string;          // ID of similar feedback

  // Fixer status tracking
  fixerStatus?: FixerStatus;     // Status of fix attempt
  fixerMessage?: string;         // Message from fixer (error details, etc.)
  validationOutput?: string;     // Output from validation run

  createdAt: number;
  updatedAt: number;
}

export interface CreateFeedbackInput {
  type: FeedbackType;
  description: string;
  sessionId?: string;
  sessionName?: string;
  sessionStatus?: string;
  recentEvents?: string[];
  consoleErrors?: string[];
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string;
  screenshot?: string;           // Base64 encoded PNG
}

export interface UpdateFeedbackInput {
  processed?: boolean;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  groupedWith?: string;
  fixerStatus?: FixerStatus;
  fixerMessage?: string;
  validationOutput?: string;
  screenshotUrl?: string;
}

export interface FeedbackFilter {
  type?: FeedbackType;
  processed?: boolean;
  sessionId?: string;
  limit?: number;
  offset?: number;
}
