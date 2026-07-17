import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { format } from 'date-fns';
import { generateConversationSummary, formatProjectPath } from '../utils/conversationUtils.js';
import { getStringDisplayLength } from '../utils/stringUtils.js';
import { strictTruncateByWidth } from '../utils/strictTruncate.js';
function splitByTerms(text, terms) {
    if (terms.length === 0)
        return [{ text, isMatch: false }];
    const segments = [];
    const lower = text.toLowerCase();
    let pos = 0;
    while (pos < text.length) {
        // Find the earliest match from current position
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
            // No more matches
            segments.push({ text: text.slice(pos), isMatch: false });
            break;
        }
        // Add non-matching part before the match
        if (earliest > pos) {
            segments.push({ text: text.slice(pos, earliest), isMatch: false });
        }
        // Add the matching part
        segments.push({ text: text.slice(earliest, earliest + matchLen), isMatch: true });
        pos = earliest + matchLen;
    }
    return segments;
}
export const ConversationList = ({ conversations, selectedIndex, maxVisible = 3, isLoading = false, searchSnippets, searchTerms, }) => {
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;
    // Calculate visible range with bounds checking
    const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, conversations.length - 1));
    // Calculate scroll window
    let startIndex = 0;
    let endIndex = conversations.length;
    if (conversations.length > maxVisible) {
        const halfWindow = Math.floor(maxVisible / 2);
        startIndex = Math.max(0, safeSelectedIndex - halfWindow);
        endIndex = Math.min(conversations.length, startIndex + maxVisible);
        // Adjust if we're at the end
        if (endIndex === conversations.length) {
            startIndex = Math.max(0, endIndex - maxVisible);
        }
    }
    const visibleConversations = conversations.slice(startIndex, endIndex);
    const hasMoreBelow = endIndex < conversations.length;
    const hasSearch = searchSnippets && searchTerms && searchTerms.length > 0;
    return (React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "cyan", paddingX: 1, width: "100%", overflow: "hidden" },
        React.createElement(Text, { bold: true, color: "cyan" }, isLoading ? 'Loading conversations...' : `Select a conversation${conversations.length > 0 ? ` (${conversations.length} shown)` : ''}:`),
        isLoading ? (React.createElement(Box, { flexDirection: "column", height: maxVisible })) : conversations.length === 0 ? (React.createElement(Text, { color: "gray" }, "No conversations found")) : (visibleConversations.map((conv, visibleIndex) => {
            const actualIndex = startIndex + visibleIndex;
            const isSelected = actualIndex === safeSelectedIndex;
            const snippet = searchSnippets?.get(conv.sessionId);
            const summary = snippet || generateConversationSummary(conv);
            const projectPath = formatProjectPath(conv.projectPath);
            // Calculate the fixed part length
            const selector = isSelected ? '▶ ' : '  ';
            const dateStr = format(conv.endTime, 'MMM dd HH:mm');
            const fixedPart = `${selector}${dateStr} | ${projectPath}`;
            const fixedPartLength = getStringDisplayLength(fixedPart);
            // Calculate available space for summary (with separator)
            const separator = ' | ';
            const totalMargin = 16;
            const availableSpace = Math.max(20, terminalWidth - fixedPartLength - separator.length - totalMargin);
            const truncatedSummary = strictTruncateByWidth(summary, availableSpace);
            // Build the full line
            const fullLine = truncatedSummary
                ? `${fixedPart}${separator}${truncatedSummary}`
                : fixedPart;
            const maxLineWidth = terminalWidth - totalMargin;
            const safeLine = strictTruncateByWidth(fullLine, maxLineWidth);
            // If search terms exist, highlight the entire line
            if (hasSearch) {
                const segments = splitByTerms(safeLine, searchTerms);
                return (React.createElement(Box, { key: conv.sessionId, width: "100%", overflow: "hidden" }, segments.map((seg, i) => (React.createElement(Text, { key: i, color: seg.isMatch ? (isSelected ? 'yellow' : 'black') : (isSelected ? 'black' : 'white'), backgroundColor: seg.isMatch ? (isSelected ? 'black' : 'yellow') : (isSelected ? 'cyan' : undefined), bold: isSelected || seg.isMatch }, seg.text)))));
            }
            return (React.createElement(Box, { key: conv.sessionId, width: "100%", overflow: "hidden" },
                React.createElement(Text, { color: isSelected ? 'black' : 'white', backgroundColor: isSelected ? 'cyan' : undefined, bold: isSelected }, safeLine)));
        })),
        hasMoreBelow && (React.createElement(Box, { width: "100%" },
            React.createElement(Text, { color: "cyan" },
                "\u2193 ",
                conversations.length - endIndex,
                " more on this page...")))));
};
