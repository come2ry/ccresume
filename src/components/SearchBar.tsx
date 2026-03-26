import React from 'react';
import { Box, Text } from 'ink';

interface SearchBarProps {
  query: string;
  isActive: boolean;
  resultCount: number;
  totalCount: number;
  maxResults: number;
  isLoading: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  query,
  isActive,
  resultCount,
  totalCount,
  maxResults,
  isLoading,
}) => {
  if (!isActive && !query) return null;

  return (
    <Box paddingX={0}>
      {isActive ? (
        <Text backgroundColor="yellow" color="black" bold> SEARCH </Text>
      ) : (
        <Text backgroundColor="gray" color="black"> SEARCH </Text>
      )}
      <Text> </Text>
      <Text bold color={isActive ? 'yellow' : 'white'}>{query}</Text>
      {isActive && <Text bold color="yellow">█</Text>}
      <Text> </Text>
      {isLoading ? (
        <Text dimColor>Loading sessions...</Text>
      ) : query ? (
        <Text dimColor>
          {resultCount >= maxResults ? `${maxResults}+ ` : `${resultCount}`}/{totalCount} matched
          {isActive ? '  (↓: navigate  Esc: clear)' : '  (/: edit search)'}
        </Text>
      ) : isActive ? (
        <Text dimColor>Type to search all sessions (↓: navigate  Esc: cancel)</Text>
      ) : null}
    </Box>
  );
};
