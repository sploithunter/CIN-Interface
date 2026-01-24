/**
 * JSON file-based implementation of FeedbackRepository
 *
 * Stores feedback in ~/.cin-interface/data/feedback/feedback.json
 * Stores screenshots in ~/.cin-interface/data/feedback/screenshots/
 */
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
export class JSONFileFeedbackRepo {
    feedbackFile;
    screenshotsDir;
    feedback = [];
    constructor(dataDir) {
        const feedbackDir = join(dataDir, 'feedback');
        this.feedbackFile = join(feedbackDir, 'feedback.json');
        this.screenshotsDir = join(feedbackDir, 'screenshots');
        // Ensure directories exist
        this.ensureDirectories();
        // Load existing feedback
        this.load();
    }
    ensureDirectories() {
        const feedbackDir = dirname(this.feedbackFile);
        if (!existsSync(feedbackDir)) {
            mkdirSync(feedbackDir, { recursive: true });
        }
        if (!existsSync(this.screenshotsDir)) {
            mkdirSync(this.screenshotsDir, { recursive: true });
        }
    }
    load() {
        if (!existsSync(this.feedbackFile)) {
            this.feedback = [];
            return;
        }
        try {
            const content = readFileSync(this.feedbackFile, 'utf-8');
            const data = JSON.parse(content);
            this.feedback = data.feedback || [];
        }
        catch (e) {
            console.error('[FeedbackRepo] Failed to load feedback:', e);
            this.feedback = [];
        }
    }
    save() {
        this.ensureDirectories();
        const data = { feedback: this.feedback };
        writeFileSync(this.feedbackFile, JSON.stringify(data, null, 2));
    }
    saveScreenshot(id, base64Data) {
        // Remove data URL prefix if present
        const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const filename = `${id}.png`;
        const filepath = join(this.screenshotsDir, filename);
        writeFileSync(filepath, buffer);
        return filepath;
    }
    async create(input) {
        const id = randomUUID();
        const now = Date.now();
        let screenshotPath;
        if (input.screenshot) {
            try {
                screenshotPath = this.saveScreenshot(id, input.screenshot);
            }
            catch (e) {
                console.error('[FeedbackRepo] Failed to save screenshot:', e);
            }
        }
        const feedback = {
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
    async get(id) {
        return this.feedback.find((f) => f.id === id) || null;
    }
    async list(filter) {
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
        }
        else {
            // Default sort by createdAt descending
            results.sort((a, b) => b.createdAt - a.createdAt);
        }
        return results;
    }
    async update(id, changes) {
        const index = this.feedback.findIndex((f) => f.id === id);
        if (index === -1) {
            return null;
        }
        const feedback = this.feedback[index];
        const updated = {
            ...feedback,
            ...changes,
            updatedAt: Date.now(),
        };
        this.feedback[index] = updated;
        this.save();
        return updated;
    }
    async getUnprocessed() {
        return this.list({ processed: false });
    }
    async delete(id) {
        const index = this.feedback.findIndex((f) => f.id === id);
        if (index === -1) {
            return false;
        }
        const feedback = this.feedback[index];
        // Delete screenshot if exists
        if (feedback.screenshotPath && existsSync(feedback.screenshotPath)) {
            try {
                unlinkSync(feedback.screenshotPath);
            }
            catch (e) {
                console.error('[FeedbackRepo] Failed to delete screenshot:', e);
            }
        }
        this.feedback.splice(index, 1);
        this.save();
        return true;
    }
}
//# sourceMappingURL=JSONFileFeedbackRepo.js.map