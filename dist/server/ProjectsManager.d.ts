/**
 * ProjectsManager - Track known project directories
 *
 * Stores directories the user has used, enabling quick project switching
 * and path autocomplete in the UI.
 *
 * Data stored in ~/.cin-interface/projects.json
 */
import type { Project } from '../shared/types.js';
export declare class ProjectsManager {
    private configDir;
    private configFile;
    private projects;
    constructor();
    /**
     * Get all known projects, sorted by recency
     */
    getProjects(): Project[];
    /**
     * Add or update a project directory
     */
    addProject(path: string, name?: string): void;
    /**
     * Remove a project from the list
     */
    removeProject(path: string): void;
    /**
     * Autocomplete a partial path
     * Returns matching directories from:
     * 1. Filesystem (if actively browsing - path ends with /)
     * 2. Known projects (fuzzy match)
     * 3. Filesystem completion (partial path)
     */
    autocomplete(partial: string, limit?: number): string[];
    /**
     * Filesystem-based autocomplete
     */
    private filesystemAutocomplete;
    /**
     * Load projects from disk
     */
    private load;
    /**
     * Save projects to disk
     */
    private save;
}
//# sourceMappingURL=ProjectsManager.d.ts.map