/**
 * JSON file-based implementation of FeedbackRepository
 *
 * Stores feedback in ~/.cin-interface/data/feedback/feedback.json
 * Stores screenshots in ~/.cin-interface/data/feedback/screenshots/
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import type { FeedbackRepository } from './FeedbackRepository.js';
import type {
  Feedback,
  CreateFeedbackInput,
  UpdateFeedbackInput,
  FeedbackFilter,
} from './types.js';

interface FeedbackStore {
  feedback: Feedback[];
}

export class JSONFileFeedbackRepo implements FeedbackRepository {
  private feedbackFile: string;
  private screenshotsDir: string;
  private feedback: Feedback[] = [];

  constructor(dataDir: string) {
    const feedbackDir = join(dataDir, 'feedback');
    this.feedbackFile = join(feedbackDir, 'feedback.json');
    this.screenshotsDir = join(feedbackDir, 'screenshots');

    // Ensure directories exist
    this.ensureDirectories();

    // Load existing feedback
    this.load();
  }

  private ensureDirectories(): void {
    const feedbackDir = dirname(this.feedbackFile);
    if (!existsSync(feedbackDir)) {
      mkdirSync(feedbackDir, { recursive: true });
    }
    if (!existsSync(this.screenshotsDir)) {
      mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.feedbackFile)) {
      this.feedback = [];
      return;
    }

    try {
      const content = readFileSync(this.feedbackFile, 'utf-8');
      const data: FeedbackStore = JSON.parse(content);
      this.feedback = data.feedback || [];
    } catch (e) {
      console.error('[FeedbackRepo] Failed to load feedback:', e);
      this.feedback = [];
    }
  }

  private save(): void {
    this.ensureDirectories();
    const data: FeedbackStore = { feedback: this.feedback };
    writeFileSync(this.feedbackFile, JSON.stringify(data, null, 2));
  }

  private saveScreenshot(id: string, base64Data: string): string {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const filename = `${id}.png`;
    const filepath = join(this.screenshotsDir, filename);
    writeFileSync(filepath, buffer);
    return filepath;
  }

  async create(input: CreateFeedbackInput): Promise<Feedback> {
    const id = randomUUID();
    const now = Date.now();

    let screenshotPath: string | undefined;
    if (input.screenshot) {
      try {
        screenshotPath = this.saveScreenshot(id, input.screenshot);
      } catch (e) {
        console.error('[FeedbackRepo] Failed to save screenshot:', e);
      }
    }

    const feedback: Feedback = {
      id,
      type: input.type,
      description: input.description,
      timestamp: now,
      sessionId: input.sessionId,
      sessionName: input.sessionName,
      sessionStatus: input.sessionStatus,
      recentEvents: input.recentEvents || [],
      consoleErrors: input.consoleErrors || [],
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      userAgent: input.userAgent,
      screenshotPath,
      processed: false,
      createdAt: now,
      updatedAt: now,
    };

    this.feedback.push(feedback);
    this.save();

    return feedback;
  }

  async get(id: string): Promise<Feedback | null> {
    return this.feedback.find((f) => f.id === id) || null;
  }

  async list(filter?: FeedbackFilter): Promise<Feedback[]> {
    let results = [...this.feedback];

    if (filter) {
      if (filter.type !== undefined) {
        results = results.filter((f) => f.type === filter.type);
      }
      if (filter.processed !== undefined) {
        results = results.filter((f) => f.processed === filter.processed);
      }
      if (filter.sessionId !== undefined) {
        results = results.filter((f) => f.sessionId === filter.sessionId);
      }

      // Sort by createdAt descending (newest first)
      results.sort((a, b) => b.createdAt - a.createdAt);

      // Apply pagination
      if (filter.offset !== undefined) {
        results = results.slice(filter.offset);
      }
      if (filter.limit !== undefined) {
        results = results.slice(0, filter.limit);
      }
    } else {
      // Default sort by createdAt descending
      results.sort((a, b) => b.createdAt - a.createdAt);
    }

    return results;
  }

  async update(id: string, changes: UpdateFeedbackInput): Promise<Feedback | null> {
    const index = this.feedback.findIndex((f) => f.id === id);
    if (index === -1) {
      return null;
    }

    const feedback = this.feedback[index];
    const updated: Feedback = {
      ...feedback,
      ...changes,
      updatedAt: Date.now(),
    };

    this.feedback[index] = updated;
    this.save();

    return updated;
  }

  async getUnprocessed(): Promise<Feedback[]> {
    return this.list({ processed: false });
  }

  async delete(id: string): Promise<boolean> {
    const index = this.feedback.findIndex((f) => f.id === id);
    if (index === -1) {
      return false;
    }

    const feedback = this.feedback[index];

    // Delete screenshot if exists
    if (feedback.screenshotPath && existsSync(feedback.screenshotPath)) {
      try {
        unlinkSync(feedback.screenshotPath);
      } catch (e) {
        console.error('[FeedbackRepo] Failed to delete screenshot:', e);
      }
    }

    this.feedback.splice(index, 1);
    this.save();

    return true;
  }
}
