/**
 * JSON file-based implementation of FeedbackRepository
 *
 * Stores feedback in ~/.cin-interface/data/feedback/feedback.json
 * Stores screenshots in ~/.cin-interface/data/feedback/screenshots/
 */
import type { FeedbackRepository } from './FeedbackRepository.js';
import type { Feedback, CreateFeedbackInput, UpdateFeedbackInput, FeedbackFilter } from './types.js';
export declare class JSONFileFeedbackRepo implements FeedbackRepository {
    private feedbackFile;
    private screenshotsDir;
    private feedback;
    constructor(dataDir: string);
    private ensureDirectories;
    private load;
    private save;
    private saveScreenshot;
    create(input: CreateFeedbackInput): Promise<Feedback>;
    get(id: string): Promise<Feedback | null>;
    list(filter?: FeedbackFilter): Promise<Feedback[]>;
    update(id: string, changes: UpdateFeedbackInput): Promise<Feedback | null>;
    getUnprocessed(): Promise<Feedback[]>;
    delete(id: string): Promise<boolean>;
}
//# sourceMappingURL=JSONFileFeedbackRepo.d.ts.map