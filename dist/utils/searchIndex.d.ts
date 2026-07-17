export interface SearchableSession {
    sessionId: string;
    filePath: string;
    projectDir: string;
    mtime: Date;
    searchText: string;
}
export interface SearchResult {
    session: SearchableSession;
    snippet: string;
    matchTerms: string[];
}
export declare function buildAllSessionIndexes(): Promise<SearchableSession[]>;
export declare function searchSessions(sessions: SearchableSession[], query: string, maxResults?: number): SearchResult[];
