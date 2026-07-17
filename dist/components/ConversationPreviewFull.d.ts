import React from 'react';
import type { Conversation } from '../types.js';
interface ConversationPreviewFullProps {
    conversation: Conversation | null;
    statusMessage?: string | null;
    hideOptions?: string[];
}
export declare const ConversationPreviewFull: React.FC<ConversationPreviewFullProps>;
export {};
