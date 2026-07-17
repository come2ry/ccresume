import React from 'react';
import type { Conversation } from '../types.js';
interface ConversationPreviewProps {
    conversation: Conversation | null;
    statusMessage?: string | null;
    hideOptions?: string[];
    searchTerms?: string[];
    inputDisabled?: boolean;
}
export declare const ConversationPreview: React.FC<ConversationPreviewProps>;
export {};
