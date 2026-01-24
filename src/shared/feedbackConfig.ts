/**
 * Feedback System Configuration
 *
 * Controls whether feedback features are enabled and how they work.
 * Environment variables override these defaults.
 */

export interface FeedbackConfig {
  /** Whether the feedback system is enabled */
  enabled: boolean;

  /** GitHub repo for issue creation (e.g., "owner/repo") */
  githubRepo: string;

  /** Optional whitelist of allowed users who can create issues */
  allowedUsers?: string[];

  /** Whether auto-fix is enabled for the issue poller */
  autoFixEnabled: boolean;

  /** Whether validation is enabled (runs tests before accepting fixes) */
  validationEnabled: boolean;

  /** Validation commands to run (auto-detected from package.json if empty) */
  validationCommands?: string[];
}

export interface ValidationConfig {
  /** Whether validation is enabled */
  enabled: boolean;

  /** Commands to run for validation (e.g., ["npm run build", "npm test"]) */
  commands: string[];

  /** Whether to auto-detect commands from package.json */
  autoDetect: boolean;

  /** Skip specific checks */
  skip: {
    build: boolean;
    test: boolean;
    lint: boolean;
    typecheck: boolean;
  };
}

/** Default feedback configuration */
export const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  enabled: true,
  githubRepo: '',
  allowedUsers: undefined,
  autoFixEnabled: false,
  validationEnabled: true,
};

/** Default validation configuration */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  enabled: true,
  commands: [],
  autoDetect: true,
  skip: {
    build: false,
    test: false,
    lint: false,
    typecheck: false,
  },
};

/**
 * Load feedback configuration from environment variables
 */
export function loadFeedbackConfig(): FeedbackConfig {
  const config: FeedbackConfig = { ...DEFAULT_FEEDBACK_CONFIG };

  // CIN_FEEDBACK_ENABLED - enable/disable feedback system
  const enabledEnv = process.env.CIN_FEEDBACK_ENABLED;
  if (enabledEnv !== undefined) {
    config.enabled = enabledEnv.toLowerCase() !== 'false' && enabledEnv !== '0';
  }

  // CIN_FEEDBACK_REPO - GitHub repo for issues
  const repoEnv = process.env.CIN_FEEDBACK_REPO;
  if (repoEnv) {
    config.githubRepo = repoEnv;
  }

  // CIN_FEEDBACK_ALLOWED_USERS - comma-separated list
  const allowedUsersEnv = process.env.CIN_FEEDBACK_ALLOWED_USERS;
  if (allowedUsersEnv) {
    config.allowedUsers = allowedUsersEnv.split(',').map((u) => u.trim());
  }

  // CIN_FEEDBACK_AUTOFIX - enable auto-fix
  const autofixEnv = process.env.CIN_FEEDBACK_AUTOFIX;
  if (autofixEnv !== undefined) {
    config.autoFixEnabled = autofixEnv.toLowerCase() === 'true' || autofixEnv === '1';
  }

  // CIN_FEEDBACK_VALIDATION - enable validation
  const validationEnv = process.env.CIN_FEEDBACK_VALIDATION;
  if (validationEnv !== undefined) {
    config.validationEnabled = validationEnv.toLowerCase() !== 'false' && validationEnv !== '0';
  }

  return config;
}

/**
 * Fixer status values for tracking issue resolution progress
 */
export type FixerStatus = 'pending' | 'in_progress' | 'validating' | 'complete' | 'failed' | 'rolled_back';

/**
 * Status information for a feedback entry
 */
export interface FeedbackStatus {
  id: string;
  processed: boolean;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  fixerStatus?: FixerStatus;
  fixerMessage?: string;
  validationOutput?: string;
  screenshotUrl?: string;
}
