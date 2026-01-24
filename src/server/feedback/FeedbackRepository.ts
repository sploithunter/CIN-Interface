/**
 * Abstract interface for feedback storage
 *
 * This allows swapping implementations (JSON file → PostgreSQL)
 * without changing the API layer.
 */

import type {
  Feedback,
  CreateFeedbackInput,
  UpdateFeedbackInput,
  FeedbackFilter,
} from './types.js';

export interface FeedbackRepository {
  /**
   * Create a new feedback entry
   * @param input - Feedback data from the frontend
   * @returns Created feedback with generated ID and timestamps
   */
  create(input: CreateFeedbackInput): Promise<Feedback>;

  /**
   * Get a single feedback by ID
   * @param id - Feedback UUID
   * @returns Feedback if found, null otherwise
   */
  get(id: string): Promise<Feedback | null>;

  /**
   * List feedback with optional filtering
   * @param filter - Optional filter criteria
   * @returns Array of matching feedback entries
   */
  list(filter?: FeedbackFilter): Promise<Feedback[]>;

  /**
   * Update an existing feedback entry
   * @param id - Feedback UUID
   * @param changes - Fields to update
   * @returns Updated feedback if found, null otherwise
   */
  update(id: string, changes: UpdateFeedbackInput): Promise<Feedback | null>;

  /**
   * Get all unprocessed feedback (no GitHub issue linked)
   * @returns Array of unprocessed feedback entries
   */
  getUnprocessed(): Promise<Feedback[]>;

  /**
   * Delete a feedback entry
   * @param id - Feedback UUID
   * @returns true if deleted, false if not found
   */
  delete(id: string): Promise<boolean>;
}
