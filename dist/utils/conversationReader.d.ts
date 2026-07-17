import type { Conversation } from '../types.js';
interface PaginationOptions {
    limit: number;
    offset: number;
    currentDirFilter?: string;
}
export declare function getPaginatedConversations(options: PaginationOptions): Promise<{
    conversations: Conversation[];
    total: number;
}>;
export declare function getAllConversations(currentDirFilter?: string): Promise<Conversation[]>;
export declare function getConversationsByPaths(filePaths: Array<{
    filePath: string;
    projectDir: string;
}>): Promise<Conversation[]>;
export declare function formatConversationSummary(conversation: Conversation): string;
export {};
