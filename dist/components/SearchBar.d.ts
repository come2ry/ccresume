import React from 'react';
interface SearchBarProps {
    query: string;
    isActive: boolean;
    resultCount: number;
    totalCount: number;
    maxResults: number;
    isLoading: boolean;
}
export declare const SearchBar: React.FC<SearchBarProps>;
export {};
