/**
 * Feedback system types for CIN-Interface
 */
export type FeedbackType = 'bug' | 'improve' | 'works';
export interface Feedback {
    id: string;
    type: FeedbackType;
    description: string;
    timestamp: number;
    sessionId?: string;
    sessionName?: string;
    sessionStatus?: string;
    recentEvents: string[];
    consoleErrors: string[];
    viewportWidth: number;
    viewportHeight: number;
    userAgent: string;
    screenshotPath?: string;
    processed: boolean;
    githubIssueNumber?: number;
    githubIssueUrl?: string;
    groupedWith?: string;
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
    screenshot?: string;
}
export interface UpdateFeedbackInput {
    processed?: boolean;
    githubIssueNumber?: number;
    githubIssueUrl?: string;
    groupedWith?: string;
}
export interface FeedbackFilter {
    type?: FeedbackType;
    processed?: boolean;
    sessionId?: string;
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=types.d.ts.map