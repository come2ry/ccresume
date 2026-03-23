import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { extractMessageText } from './messageUtils.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export interface SearchableSession {
  sessionId: string;
  filePath: string;
  projectDir: string;
  mtime: Date;
  searchText: string;   // lowercased for matching
  originalText: string;  // original case for display
}

export interface SearchResult {
  session: SearchableSession;
  snippet: string;        // original-case snippet around the match
  matchTerms: string[];   // lowercased terms that matched
}

async function buildSessionIndex(filePath: string, projectDir: string): Promise<SearchableSession | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) return null;

    const sessionId = basename(filePath).replace('.jsonl', '');
    const stats = await stat(filePath);
    const texts: string[] = [sessionId];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        if (data.cwd) texts.push(data.cwd);
        if (data.gitBranch) texts.push(data.gitBranch);

        if (data.type === 'user' || data.type === 'assistant') {
          const text = extractMessageText(data.message?.content);
          if (text) texts.push(text);
          // Also index tool_result content for search
          if (data.type === 'user' &&
              data.message?.content &&
              Array.isArray(data.message.content)) {
            for (const item of data.message.content) {
              if (item?.type === 'tool_result' && typeof item.content === 'string') {
                texts.push(item.content);
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    const originalText = texts.join(' ');

    return {
      sessionId,
      filePath,
      projectDir,
      mtime: stats.mtime,
      searchText: originalText.toLowerCase(),
      originalText,
    };
  } catch {
    return null;
  }
}

export async function buildAllSessionIndexes(): Promise<SearchableSession[]> {
  const sessions: SearchableSession[] = [];

  try {
    const projectDirs = await readdir(CLAUDE_PROJECTS_DIR);

    for (const projectDir of projectDirs) {
      const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
      let dirFiles: string[];
      try {
        dirFiles = await readdir(projectPath);
      } catch {
        continue;
      }

      const jsonlFiles = dirFiles.filter(f =>
        f.endsWith('.jsonl') &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(f)
      );

      for (const file of jsonlFiles) {
        const filePath = join(projectPath, file);
        const session = await buildSessionIndex(filePath, projectDir);
        if (session) sessions.push(session);
      }
    }
  } catch {
    return [];
  }

  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return sessions;
}

export function searchSessions(
  sessions: SearchableSession[],
  query: string,
  maxResults: number = 50
): SearchResult[] {
  if (!query.trim()) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const session of sessions) {
    if (results.length >= maxResults) break;

    const matches = terms.every(term => session.searchText.includes(term));
    if (!matches) continue;

    const snippet = extractSnippet(session.originalText, session.searchText, terms);
    results.push({ session, snippet, matchTerms: terms });
  }

  return results;
}

function extractSnippet(
  originalText: string,
  lowerText: string,
  terms: string[],
  contextChars: number = 60
): string {
  // Find the earliest match position in the lowercased text
  let bestPos = lowerText.length;
  let bestTerm = '';

  for (const term of terms) {
    const pos = lowerText.indexOf(term);
    if (pos !== -1 && pos < bestPos) {
      bestPos = pos;
      bestTerm = term;
    }
  }

  if (bestPos === lowerText.length) return '';

  // Extract from original text at the same positions
  const start = Math.max(0, bestPos - contextChars);
  const end = Math.min(originalText.length, bestPos + bestTerm.length + contextChars);
  let snippet = originalText.slice(start, end).replace(/[\r\n]+/g, ' ');

  if (start > 0) snippet = '...' + snippet;
  if (end < originalText.length) snippet = snippet + '...';

  return snippet;
}
