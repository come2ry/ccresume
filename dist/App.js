import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { ConversationList } from './components/ConversationList.js';
import { ConversationPreview } from './components/ConversationPreview.js';
import { ConversationPreviewFull } from './components/ConversationPreviewFull.js';
import { CommandEditor } from './components/CommandEditor.js';
import { SearchBar } from './components/SearchBar.js';
import { getPaginatedConversations, getConversationsByPaths } from './utils/conversationReader.js';
import { buildAllSessionIndexes, searchSessions } from './utils/searchIndex.js';
import { spawn } from 'child_process';
import clipboardy from 'clipboardy';
import { loadConfig } from './utils/configLoader.js';
import { matchesKeyBinding } from './utils/keyBindingHelper.js';
// Layout constants
const ITEMS_PER_PAGE = 30;
const HEADER_HEIGHT = 2; // Title + pagination info
const LIST_MAX_HEIGHT = 9; // Maximum height for conversation list
const LIST_BASE_HEIGHT = 3; // Borders (2) + title (1)
const MAX_VISIBLE_CONVERSATIONS = 4; // Maximum conversations shown per page
const BOTTOM_MARGIN = 1; // Bottom margin to absorb overflow
const SAFETY_MARGIN = 1; // Prevents Ink from clearing terminal when output approaches height limit
const MIN_PREVIEW_HEIGHT = 10; // Minimum height for conversation preview
const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;
const EXECUTE_DELAY_MS = 500; // Delay before executing command to show status
const STATUS_MESSAGE_DURATION_MS = 2000; // Duration to show status messages
const SEARCH_MAX_RESULTS = 30;
const App = ({ claudeArgs = [], currentDirOnly = false, hideOptions = [] }) => {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const [conversations, setConversations] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [dimensions, setDimensions] = useState({ width: DEFAULT_TERMINAL_WIDTH, height: DEFAULT_TERMINAL_HEIGHT });
    const [statusMessage, setStatusMessage] = useState(null);
    const config = useMemo(() => loadConfig(), []);
    const [showCommandEditor, setShowCommandEditor] = useState(false);
    const [editedArgs, setEditedArgs] = useState(claudeArgs);
    const [showFullView, setShowFullView] = useState(false);
    // Pagination state
    const [currentPage, setCurrentPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [paginating, setPaginating] = useState(false);
    // Search state
    const [searchMode, setSearchMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [loadedSearchResults, setLoadedSearchResults] = useState({ key: '', conversations: [] });
    const [searchIndex, setSearchIndex] = useState(null);
    const searchIndexRef = useRef(null);
    // Lazy-load search index: start building only when search mode is first activated
    const indexLoadStarted = useRef(false);
    useEffect(() => {
        if (!searchMode || indexLoadStarted.current)
            return;
        indexLoadStarted.current = true;
        buildAllSessionIndexes().then(sessions => {
            searchIndexRef.current = sessions;
            setSearchIndex(sessions);
        });
    }, [searchMode]);
    useEffect(() => {
        // Update dimensions on terminal resize
        const updateDimensions = () => {
            setDimensions({
                width: stdout.columns || DEFAULT_TERMINAL_WIDTH,
                height: stdout.rows || DEFAULT_TERMINAL_HEIGHT
            });
        };
        updateDimensions();
        if (stdout) {
            stdout.on('resize', updateDimensions);
            return () => {
                stdout.off('resize', updateDimensions);
            };
        }
        return undefined;
    }, [stdout]);
    const executeClaudeCommand = (conversation, args, statusMsg, actionType) => {
        const commandStr = `claude ${args.join(' ')}`;
        setStatusMessage(statusMsg);
        setTimeout(() => {
            exit();
            // Output helpful information
            if (actionType === 'resume') {
                console.log(`\nResuming conversation: ${conversation.sessionId}`);
            }
            else {
                console.log(`\nStarting new session in: ${conversation.projectPath}`);
            }
            console.log(`Directory: ${conversation.projectPath}`);
            console.log(`Executing: ${commandStr}`);
            console.log('---');
            // Windows-specific reminder
            if (process.platform === 'win32') {
                console.log('💡 Reminder: If input doesn\'t work, press ENTER to activate.');
                console.log('');
            }
            // Spawn claude process
            const claude = spawn(commandStr, {
                stdio: 'inherit',
                cwd: conversation.projectPath,
                shell: true
            });
            claude.on('error', (err) => {
                console.error(`\nFailed to ${actionType} ${actionType === 'resume' ? 'conversation' : 'new session'}:`, err.message);
                console.error('Make sure Claude Code is installed and available in PATH');
                console.error(`Or the project directory might not exist: ${conversation.projectPath}`);
                // For resume action, provide clipboard fallback
                if (actionType === 'resume') {
                    try {
                        clipboardy.writeSync(conversation.sessionId);
                        console.log(`\nSession ID copied to clipboard: ${conversation.sessionId}`);
                        console.log(`Project directory: ${conversation.projectPath}`);
                        console.log(`You can manually run:`);
                        console.log(`  cd "${conversation.projectPath}"`);
                        const argsStr = claudeArgs.length > 0 ? claudeArgs.join(' ') + ' ' : '';
                        console.log(`  claude ${argsStr}--resume ${conversation.sessionId}`);
                    }
                    catch (clipErr) {
                        console.error('Failed to copy to clipboard:', clipErr instanceof Error ? clipErr.message : String(clipErr));
                    }
                }
                process.exit(1);
            });
            claude.on('close', (code) => {
                process.exit(code || 0);
            });
        }, EXECUTE_DELAY_MS);
    };
    const loadConversations = useCallback(async (isPaginating = false) => {
        try {
            if (isPaginating) {
                setPaginating(true);
                setConversations([]); // Clear current conversations
            }
            else {
                setLoading(true);
            }
            const currentDir = currentDirOnly ? process.cwd() : undefined;
            // Load paginated conversations
            const offset = currentPage * ITEMS_PER_PAGE;
            const { conversations: convs, total } = await getPaginatedConversations({
                limit: ITEMS_PER_PAGE,
                offset,
                currentDirFilter: currentDir
            });
            setConversations(convs);
            setTotalCount(total);
            setLoading(false);
            setPaginating(false);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load conversations');
            setLoading(false);
            setPaginating(false);
        }
    }, [currentPage, currentDirOnly]);
    // Compute search filtering synchronously
    const { searchSnippets, searchMatchTerms, searchPaths, searchIndexLoading } = useMemo(() => {
        const empty = {
            searchSnippets: new Map(),
            searchMatchTerms: [],
            searchPaths: null,
            searchIndexLoading: false,
        };
        if (!searchQuery.trim())
            return empty;
        if (!searchIndex)
            return { ...empty, searchIndexLoading: true };
        const results = searchSessions(searchIndex, searchQuery, SEARCH_MAX_RESULTS);
        const snippetMap = new Map();
        for (const r of results) {
            snippetMap.set(r.session.sessionId, r.snippet);
        }
        return {
            searchSnippets: snippetMap,
            searchMatchTerms: results.length > 0 ? results[0].matchTerms : [],
            searchPaths: results.map(r => ({
                filePath: r.session.filePath,
                projectDir: r.session.projectDir,
            })),
            searchIndexLoading: false,
        };
    }, [searchQuery, searchIndex]);
    // Async effect: load full Conversation objects for search results
    const searchPathsKey = searchPaths ? searchPaths.map(p => p.filePath).join(',') : '';
    useEffect(() => {
        if (!searchPaths || searchPaths.length === 0)
            return;
        let cancelled = false;
        getConversationsByPaths(searchPaths).then(convs => {
            if (!cancelled) {
                setLoadedSearchResults({ key: searchPathsKey, conversations: convs });
                setSelectedIndex(0);
            }
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchPathsKey]);
    const searchResults = loadedSearchResults.key === searchPathsKey
        ? loadedSearchResults.conversations
        : [];
    const searchResultsLoading = Boolean(searchPaths?.length)
        && loadedSearchResults.key !== searchPathsKey;
    const prevPageRef = useRef(0);
    useEffect(() => {
        const wasPage = prevPageRef.current;
        const isPaginating = currentPage !== wasPage;
        prevPageRef.current = currentPage;
        void loadConversations(isPaginating);
    }, [currentPage, loadConversations]);
    // Determine which list to show based on search state
    const activeConversations = searchQuery.trim() ? searchResults : conversations;
    useInput((input, key) => {
        // Don't process any input when command editor is shown
        if (showCommandEditor)
            return;
        // --- Search mode: capture all input for text entry ---
        if (searchMode) {
            if (key.downArrow) {
                // Exit search mode, keep query and results, move focus to list
                setSearchMode(false);
                return;
            }
            if (key.escape) {
                // Clear search entirely
                setSearchMode(false);
                setSearchQuery('');
                setSelectedIndex(0);
                return;
            }
            if (key.return) {
                // Confirm selection from search mode (block while results still loading)
                if (searchResultsLoading)
                    return;
                const selectedConv = activeConversations[selectedIndex];
                if (selectedConv) {
                    const commandArgs = [...editedArgs, '--resume', selectedConv.sessionId];
                    const commandStr = `claude ${commandArgs.join(' ')}`;
                    executeClaudeCommand(selectedConv, commandArgs, `Executing: ${commandStr}`, 'resume');
                }
                return;
            }
            if (key.backspace || key.delete) {
                if (searchQuery.length > 0) {
                    setSearchQuery(prev => prev.slice(0, -1));
                }
                else {
                    setSearchMode(false);
                }
                return;
            }
            // All other input captured as search text (j, k, n, -, etc.)
            if (input && !key.ctrl && !key.meta) {
                setSearchQuery(prev => prev + input);
                return;
            }
            return;
        }
        // --- Normal mode ---
        // '/' to enter search mode (re-enter if query exists)
        if (input === '/') {
            setSearchMode(true);
            return;
        }
        // Esc in normal mode: if search query exists, clear it; otherwise ignore
        if (key.escape) {
            if (searchQuery) {
                setSearchQuery('');
                setSelectedIndex(0);
            }
            return;
        }
        if (matchesKeyBinding(input, key, config.keybindings.quit)) {
            if (searchQuery) {
                // q clears search first
                setSearchQuery('');
                setSelectedIndex(0);
                return;
            }
            exit();
        }
        // Handle full view toggle first
        if (matchesKeyBinding(input, key, config.keybindings.toggleFullView)) {
            setShowFullView(prev => !prev);
            setStatusMessage(showFullView ? 'Switched to normal view' : 'Switched to full view');
            setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
            return;
        }
        // In full view, disable all navigation keys except quit and toggle
        if (showFullView) {
            return;
        }
        if (loading || activeConversations.length === 0)
            return;
        // Calculate pagination values
        const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
        if (matchesKeyBinding(input, key, config.keybindings.selectPrevious)) {
            if (searchQuery && selectedIndex === 0) {
                // At top of search results: move focus to search bar
                setSearchMode(true);
            }
            else if (!searchQuery && selectedIndex === 0 && currentPage > 0) {
                setCurrentPage(prev => prev - 1);
                setSelectedIndex(ITEMS_PER_PAGE - 1);
            }
            else {
                setSelectedIndex((prev) => Math.max(0, prev - 1));
            }
        }
        if (matchesKeyBinding(input, key, config.keybindings.selectNext)) {
            const maxIndex = activeConversations.length - 1;
            const canGoNext = !searchQuery && (totalCount === -1 ? activeConversations.length === ITEMS_PER_PAGE : currentPage < totalPages - 1);
            if (selectedIndex === maxIndex && canGoNext) {
                setCurrentPage(prev => prev + 1);
                setSelectedIndex(0);
            }
            else {
                setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
            }
        }
        // Page navigation (disabled in search mode)
        if (!searchQuery) {
            if (matchesKeyBinding(input, key, config.keybindings.pageNext)) {
                if (totalCount === -1 ? activeConversations.length === ITEMS_PER_PAGE : currentPage < totalPages - 1) {
                    setCurrentPage(prev => prev + 1);
                    setSelectedIndex(0);
                }
            }
            if (matchesKeyBinding(input, key, config.keybindings.pagePrevious) && currentPage > 0) {
                setCurrentPage(prev => prev - 1);
                setSelectedIndex(0);
            }
        }
        if (matchesKeyBinding(input, key, config.keybindings.confirm)) {
            const selectedConv = activeConversations[selectedIndex];
            if (selectedConv) {
                const commandArgs = [...editedArgs, '--resume', selectedConv.sessionId];
                const commandStr = `claude ${commandArgs.join(' ')}`;
                executeClaudeCommand(selectedConv, commandArgs, `Executing: ${commandStr}`, 'resume');
            }
        }
        if (matchesKeyBinding(input, key, config.keybindings.copySessionId)) {
            const selectedConv = activeConversations[selectedIndex];
            if (selectedConv) {
                try {
                    clipboardy.writeSync(selectedConv.sessionId);
                    setStatusMessage('✓ Session ID copied to clipboard!');
                    setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
                }
                catch {
                    setStatusMessage('✗ Failed to copy to clipboard');
                    setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
                }
            }
        }
        if (matchesKeyBinding(input, key, config.keybindings.startNewSession)) {
            const selectedConv = activeConversations[selectedIndex];
            if (selectedConv) {
                const commandArgs = [...editedArgs];
                executeClaudeCommand(selectedConv, commandArgs, `Starting new session in: ${selectedConv.projectPath}`, 'start');
            }
        }
        if (matchesKeyBinding(input, key, config.keybindings.openCommandEditor)) {
            setShowCommandEditor(true);
        }
    });
    if (loading) {
        return (React.createElement(Box, { flexDirection: "column", paddingY: 1 },
            React.createElement(Text, { color: "cyan" }, "Loading conversations...")));
    }
    if (error) {
        return (React.createElement(Box, { flexDirection: "column", paddingY: 1 },
            React.createElement(Text, { color: "red" },
                "Error: ",
                error)));
    }
    // Get the selected conversation
    const selectedConversation = activeConversations[selectedIndex] || null;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    // Calculate heights for fixed layout
    const isSearchActive = searchMode || !!searchQuery;
    const searchBarHeight = isSearchActive ? 1 : 0;
    const headerHeight = HEADER_HEIGHT + searchBarHeight;
    const listMaxHeight = LIST_MAX_HEIGHT;
    const visibleConversations = Math.min(MAX_VISIBLE_CONVERSATIONS, activeConversations.length);
    // List height calculation: 
    // LIST_BASE_HEIGHT includes borders (2) + title (1)
    const needsMoreIndicator = activeConversations.length > visibleConversations ? 1 : 0;
    const listHeight = Math.min(listMaxHeight, LIST_BASE_HEIGHT + visibleConversations + needsMoreIndicator);
    // Add safety margin to prevent exceeding terminal height
    const safetyMargin = SAFETY_MARGIN;
    const bottomMargin = BOTTOM_MARGIN;
    const totalUsedHeight = headerHeight + listHeight + bottomMargin + safetyMargin;
    const previewHeight = Math.max(MIN_PREVIEW_HEIGHT, dimensions.height - totalUsedHeight);
    if (showCommandEditor) {
        return (React.createElement(CommandEditor, { initialArgs: editedArgs, onComplete: (args) => {
                setEditedArgs(args);
                setShowCommandEditor(false);
            }, onCancel: () => setShowCommandEditor(false) }));
    }
    if (showFullView) {
        return React.createElement(ConversationPreviewFull, { conversation: selectedConversation, statusMessage: statusMessage, hideOptions: hideOptions });
    }
    return (React.createElement(Box, { flexDirection: "column", width: dimensions.width, paddingX: 1, paddingY: 0 },
        React.createElement(Box, { height: headerHeight, flexDirection: "column" },
            React.createElement(Text, { bold: true, color: "cyan" }, "ccresume - Claude Code Conversation Browser"),
            React.createElement(Box, null,
                React.createElement(Text, { dimColor: true }, searchQuery ? (React.createElement(React.Fragment, null,
                    activeConversations.length,
                    " results | /: search  Esc: clear")) : (() => {
                    const prevKeys = config?.keybindings.pagePrevious.map(k => k === 'left' ? '←' : k).join('/') || '←';
                    const nextKeys = config?.keybindings.pageNext.map(k => k === 'right' ? '→' : k).join('/') || '→';
                    const pageHelp = `Press ${prevKeys}/${nextKeys} for pages, /: search`;
                    return totalCount === -1 ? (React.createElement(React.Fragment, null,
                        "Page ",
                        currentPage + 1,
                        " | ",
                        pageHelp)) : (React.createElement(React.Fragment, null,
                        totalCount,
                        " total | Page ",
                        currentPage + 1,
                        "/",
                        totalPages || 1,
                        " | ",
                        pageHelp));
                })()),
                editedArgs.length > 0 && (React.createElement(Text, { color: "yellow" },
                    " | Options: ",
                    editedArgs.join(' ')))),
            isSearchActive && (React.createElement(SearchBar, { query: searchQuery, isActive: searchMode, resultCount: searchResults.length, totalCount: searchIndex?.length ?? 0, maxResults: SEARCH_MAX_RESULTS, isLoading: searchIndexLoading }))),
        React.createElement(Box, { height: listHeight },
            React.createElement(ConversationList, { conversations: activeConversations, selectedIndex: selectedIndex, maxVisible: visibleConversations, isLoading: paginating || searchResultsLoading, searchSnippets: searchQuery ? searchSnippets : undefined, searchTerms: searchQuery ? searchMatchTerms : undefined })),
        React.createElement(Box, { height: previewHeight },
            React.createElement(ConversationPreview, { conversation: selectedConversation, statusMessage: statusMessage, hideOptions: hideOptions, searchTerms: searchQuery ? searchMatchTerms : undefined, inputDisabled: searchMode })),
        React.createElement(Box, { height: bottomMargin })));
};
export default App;
