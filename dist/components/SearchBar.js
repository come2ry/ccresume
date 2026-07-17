import React from 'react';
import { Box, Text } from 'ink';
export const SearchBar = ({ query, isActive, resultCount, totalCount, maxResults, isLoading, }) => {
    if (!isActive && !query)
        return null;
    return (React.createElement(Box, { paddingX: 0 },
        isActive ? (React.createElement(Text, { backgroundColor: "yellow", color: "black", bold: true }, " SEARCH ")) : (React.createElement(Text, { backgroundColor: "gray", color: "black" }, " SEARCH ")),
        React.createElement(Text, null, " "),
        React.createElement(Text, { bold: true, color: isActive ? 'yellow' : 'white' }, query),
        isActive && React.createElement(Text, { bold: true, color: "yellow" }, "\u2588"),
        React.createElement(Text, null, " "),
        isLoading ? (React.createElement(Text, { dimColor: true }, "Loading sessions...")) : query ? (React.createElement(Text, { dimColor: true },
            resultCount >= maxResults ? `${maxResults}+ ` : `${resultCount}`,
            "/",
            totalCount,
            " matched",
            isActive ? '  (↓: navigate  Esc: clear)' : '  (/: edit search)')) : isActive ? (React.createElement(Text, { dimColor: true }, "Type to search all sessions (\u2193: navigate  Esc: cancel)")) : null));
};
