import React, { useState, useEffect, useMemo, startTransition } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { format } from 'date-fns';
import { extractMessageText } from '../utils/messageUtils.js';
import { strictTruncateByWidth } from '../utils/strictTruncate.js';
import { loadConfig } from '../utils/configLoader.js';
import { matchesKeyBinding } from '../utils/keyBindingHelper.js';
import { getShortcutText, hasKeyConflict } from '../utils/shortcutHelper.js';
function splitByTerms(text, terms) {
    if (terms.length === 0)
        return [{ text, isMatch: false }];
    const segments = [];
    const lower = text.toLowerCase();
    let pos = 0;
    while (pos < text.length) {
        let earliest = text.length;
        let matchLen = 0;
        for (const term of terms) {
            const idx = lower.indexOf(term, pos);
            if (idx !== -1 && idx < earliest) {
                earliest = idx;
                matchLen = term.length;
            }
        }
        if (earliest === text.length) {
            segments.push({ text: text.slice(pos), isMatch: false });
            break;
        }
        if (earliest > pos) {
            segments.push({ text: text.slice(pos, earliest), isMatch: false });
        }
        segments.push({ text: text.slice(earliest, earliest + matchLen), isMatch: true });
        pos = earliest + matchLen;
    }
    return segments;
}
function textContainsTerm(text, terms) {
    const lower = text.toLowerCase();
    return terms.some(term => lower.includes(term));
}
const EMPTY_HIDE_OPTIONS = [];
export const ConversationPreview = ({ conversation, statusMessage, hideOptions = EMPTY_HIDE_OPTIONS, searchTerms, inputDisabled = false }) => {
    const { stdout } = useStdout();
    const [scrollOffset, setScrollOffset] = useState(0);
    const terminalWidth = stdout?.columns || 80;
    const config = useMemo(() => loadConfig(), []);
    const maxVisibleMessages = useMemo(() => {
        const terminalHeight = stdout?.rows || 24;
        // Reserve lines for fixed parts:
        // - Top window: 1 (title) + 8 (conversation list with borders)
        // - Bottom window fixed parts:
        //   - Border top: 1
        //   - Header: 1 (Conversation History)
        //   - Session info: 1
        //   - Project info: 1
        //   - Margin: 1
        //   - Inner border: 2
        //   - Scroll help: 1
        //   - Border bottom: 1
        //   - Margin: 1
        // Total fixed: 9 (top) + 10 (bottom fixed) = 19
        // Add extra buffer (2 lines) for multi-line text overflow
        const bottomMargin = 2;
        const calculatedHeight = terminalHeight - 19 - bottomMargin;
        // Minimum 5 lines, no maximum limit
        return Math.max(5, calculatedHeight);
    }, [stdout?.rows]);
    // Filter messages based on hideOptions (memoized for stable reference)
    const filteredMessages = useMemo(() => conversation ? conversation.messages.filter(msg => {
        if (!msg || (!msg.message && !msg.toolUseResult)) {
            return false;
        }
        // Get content to check message type
        let content = '';
        if (msg.message && msg.message.content) {
            content = extractMessageText(msg.message.content);
        }
        else if (msg.toolUseResult) {
            // Tool result messages are considered tool messages
            return !hideOptions.includes('tool');
        }
        // Check if this is a tool message
        if (hideOptions.includes('tool') && content.startsWith('[Tool:')) {
            return false;
        }
        // Check if this is a thinking message
        if (hideOptions.includes('thinking') && content === '[Thinking...]') {
            return false;
        }
        // Check if we should hide user messages
        if (hideOptions.includes('user') && msg.type === 'user') {
            return false;
        }
        // Check if we should hide assistant messages
        if (hideOptions.includes('assistant') && msg.type === 'assistant') {
            return false;
        }
        return true;
    }) : [], [conversation, hideOptions]);
    useEffect(() => {
        if (conversation) {
            if (searchTerms && searchTerms.length > 0) {
                // Scroll to first matching message - search across all text fields
                const matchIndex = filteredMessages.findIndex(msg => {
                    const parts = [];
                    if (msg.message?.content)
                        parts.push(extractMessageText(msg.message.content));
                    if (msg.cwd)
                        parts.push(msg.cwd);
                    if (msg.toolUseResult) {
                        const r = msg.toolUseResult;
                        if (r.stdout)
                            parts.push(r.stdout);
                        if (r.stderr)
                            parts.push(r.stderr);
                        if (r.content)
                            parts.push(r.content);
                    }
                    return textContainsTerm(parts.join(' '), searchTerms);
                });
                if (matchIndex >= 0) {
                    // Place the match line near the top of the visible area
                    const totalMessages = filteredMessages.length;
                    const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
                    startTransition(() => setScrollOffset(Math.min(matchIndex, maxOffset)));
                }
                else {
                    startTransition(() => setScrollOffset(0));
                }
            }
            else {
                // Default: scroll to the bottom (most recent messages)
                const totalMessages = filteredMessages.length;
                const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
                startTransition(() => setScrollOffset(maxOffset));
            }
        }
        else {
            startTransition(() => setScrollOffset(0));
        }
    }, [conversation, filteredMessages, maxVisibleMessages, searchTerms]);
    useInput((input, key) => {
        if (!conversation || inputDisabled)
            return;
        const totalMessages = filteredMessages.length;
        const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
        // Top
        if (matchesKeyBinding(input, key, config.keybindings.scrollTop)) {
            setScrollOffset(0);
            return;
        }
        // Page scrolling
        if (matchesKeyBinding(input, key, config.keybindings.scrollPageDown)) {
            setScrollOffset(prev => Math.min(prev + Math.floor(maxVisibleMessages / 2), maxOffset));
        }
        if (matchesKeyBinding(input, key, config.keybindings.scrollPageUp)) {
            setScrollOffset(prev => Math.max(prev - Math.floor(maxVisibleMessages / 2), 0));
        }
        // Line scrolling
        if (matchesKeyBinding(input, key, config.keybindings.scrollDown)) {
            setScrollOffset(prev => Math.min(prev + 1, maxOffset));
        }
        if (matchesKeyBinding(input, key, config.keybindings.scrollUp)) {
            setScrollOffset(prev => Math.max(prev - 1, 0));
        }
        // Bottom
        if (matchesKeyBinding(input, key, config.keybindings.scrollBottom)) {
            setScrollOffset(maxOffset);
        }
    });
    if (!conversation) {
        return (React.createElement(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, flexGrow: 1 }));
    }
    // Count valid messages (with proper structure or tool results)
    const messageCount = filteredMessages.length;
    const duration = conversation.endTime.getTime() - conversation.startTime.getTime();
    const durationMinutes = Math.round(duration / 1000 / 60);
    const visibleMessages = filteredMessages.slice(scrollOffset, scrollOffset + maxVisibleMessages);
    // Calculate safe width for text wrapping
    // Account for borders (2) and padding (2) on each side
    const safeWidth = Math.max(40, terminalWidth - 4);
    return (React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "green", flexGrow: 1 },
        React.createElement(Box, { flexDirection: "column", paddingX: 1 },
            React.createElement(Box, null,
                React.createElement(Text, { bold: true, color: "green" }, "Conversation History"),
                React.createElement(Text, null,
                    " (",
                    messageCount,
                    " messages, ",
                    durationMinutes,
                    " min)")),
            React.createElement(Box, null,
                React.createElement(Text, { bold: true }, "Session: "),
                React.createElement(Text, { color: "yellow" }, strictTruncateByWidth(conversation.sessionId, safeWidth - 10))),
            React.createElement(Box, null,
                React.createElement(Text, { bold: true }, "Directory: "),
                React.createElement(Text, null, strictTruncateByWidth(conversation.projectPath, safeWidth - 12))),
            React.createElement(Box, null,
                React.createElement(Text, { bold: true }, "Branch: "),
                React.createElement(Text, null, strictTruncateByWidth(conversation.gitBranch || '-', safeWidth - 9))),
            React.createElement(Box, { marginBottom: 1 })),
        React.createElement(Box, { borderStyle: "single", borderColor: "gray", flexGrow: 1, paddingX: 1, overflow: "hidden" },
            React.createElement(Box, { flexDirection: "column", height: maxVisibleMessages }, visibleMessages.map((msg, index) => {
                // Skip messages without proper structure
                if (!msg || (!msg.message && !msg.toolUseResult)) {
                    return null;
                }
                const isUser = msg.type === 'user';
                let content = '';
                // Handle different message formats
                if (msg.message && msg.message.content) {
                    content = extractMessageText(msg.message.content);
                }
                else if (msg.toolUseResult) {
                    // Handle tool result messages
                    const result = msg.toolUseResult;
                    if (result.stdout) {
                        content = `[Tool Output] ${result.stdout.replace(/\n/g, ' ').trim()}`;
                    }
                    else if (result.stderr) {
                        content = `[Tool Error] ${result.stderr.replace(/\n/g, ' ').trim()}`;
                    }
                    else if (result.filenames && Array.isArray(result.filenames)) {
                        const fileList = result.filenames.slice(0, 5).join(', ');
                        const moreCount = result.filenames.length > 5 ? ` ... and ${result.filenames.length - 5} more` : '';
                        content = `[Files Found: ${result.filenames.length}] ${fileList}${moreCount}`;
                    }
                    else {
                        content = '[Tool Result: No output]';
                    }
                }
                const timestamp = new Date(msg.timestamp);
                // Skip if timestamp is invalid
                if (isNaN(timestamp.getTime())) {
                    return null;
                }
                const isToolMessage = content.startsWith('[Tool:') ||
                    content.startsWith('[Tool Output]') ||
                    content.startsWith('[Tool Error]') ||
                    content.startsWith('[Files Found:');
                // Combine role and content on single line for compact display
                const roleText = isUser ? 'User' : 'Assistant';
                const timeText = format(timestamp, 'HH:mm:ss');
                const header = `[${roleText}] (${timeText})`;
                const headerLength = header.length + 1; // +1 for space
                const availableWidth = safeWidth - headerLength;
                const hasMatch = searchTerms && searchTerms.length > 0 && textContainsTerm(content, searchTerms);
                // Pick the display line: for search matches, show the line containing the term
                let displayLine;
                if (hasMatch) {
                    const lines = content.split('\n');
                    const matchingLine = lines.find(l => textContainsTerm(l, searchTerms));
                    displayLine = matchingLine ?? lines[0];
                }
                else {
                    displayLine = content.split('\n')[0];
                }
                const truncatedContent = strictTruncateByWidth(displayLine, availableWidth);
                // Use a combination of timestamp and index for unique key
                const uniqueKey = `${msg.timestamp}-${scrollOffset + index}`;
                if (hasMatch) {
                    const segments = splitByTerms(truncatedContent, searchTerms);
                    return (React.createElement(Box, { key: uniqueKey },
                        React.createElement(Text, null,
                            React.createElement(Text, { color: isUser ? 'cyan' : 'green', bold: true }, header),
                            React.createElement(Text, null, " ")),
                        segments.map((seg, i) => (React.createElement(Text, { key: i, backgroundColor: seg.isMatch ? 'yellow' : undefined, color: seg.isMatch ? 'black' : (isToolMessage ? 'yellow' : undefined), bold: seg.isMatch, dimColor: isToolMessage && !seg.isMatch }, seg.text)))));
                }
                return (React.createElement(Box, { key: uniqueKey },
                    React.createElement(Text, null,
                        React.createElement(Text, { color: isUser ? 'cyan' : 'green', bold: true }, header),
                        isToolMessage ? (React.createElement(Text, { color: "yellow", dimColor: true },
                            " ",
                            truncatedContent)) : (React.createElement(Text, null,
                            " ",
                            truncatedContent)))));
            }).filter(Boolean))),
        React.createElement(Box, { paddingX: 1, marginTop: 1 }, statusMessage ? (React.createElement(Text, { color: "green", bold: true }, statusMessage)) : config ? (React.createElement(Box, null,
            React.createElement(Text, { color: "magenta" }, getShortcutText(config, terminalWidth)),
            hasKeyConflict(config) && (React.createElement(React.Fragment, null,
                React.createElement(Text, { color: "magenta" }, " \u2022 "),
                React.createElement(Text, { color: "yellow", bold: true }, "\u26A0\uFE0F Key conflict - see --help"))))) : (React.createElement(Text, { color: "magenta" }, "Loading shortcuts...")))));
};
