import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const CONCURRENCY = 64;

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
  snippet: string;
  matchTerms: string[];
}

// Regex-based fast text extraction — no JSON.parse, no line splitting
// Scan the entire file content with global regex
const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const BRANCH_RE = /"gitBranch"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const TEXT_FIELD_RE = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function fastExtractTexts(content: string): string {
  const parts: string[] = [];

  // Extract cwd + branch from first occurrence
  const cwdMatch = content.match(CWD_RE);
  if (cwdMatch) parts.push(unescapeJson(cwdMatch[1]));
  const branchMatch = content.match(BRANCH_RE);
  if (branchMatch) parts.push(unescapeJson(branchMatch[1]));

  // Extract all "text" values in one pass over the entire file
  TEXT_FIELD_RE.lastIndex = 0;
  let match;
  while ((match = TEXT_FIELD_RE.exec(content)) !== null) {
    parts.push(unescapeJson(match[1]));
  }

  return parts.join(' ');
}

function unescapeJson(s: string): string {
  // Fast path: no escapes
  if (!s.includes('\\')) return s;
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

async function buildSessionIndex(filePath: string, projectDir: string): Promise<SearchableSession | null> {
  try {
    const [content, stats] = await Promise.all([
      readFile(filePath, 'utf-8'),
      stat(filePath),
    ]);

    if (content.length === 0) return null;

    const sessionId = basename(filePath).replace('.jsonl', '');
    const extracted = fastExtractTexts(content);
    if (!extracted) return null;

    const originalText = sessionId + ' ' + extracted;

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
  // Collect all file paths first
  const allFiles: Array<{ filePath: string; projectDir: string }> = [];

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
        allFiles.push({ filePath: join(projectPath, file), projectDir });
      }
    }
  } catch {
    return [];
  }

  // Process files with bounded concurrency
  const sessions: SearchableSession[] = [];
  for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
    const batch = allFiles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(f => buildSessionIndex(f.filePath, f.projectDir))
    );
    for (const s of results) {
      if (s) sessions.push(s);
    }
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

  const start = Math.max(0, bestPos - contextChars);
  const end = Math.min(originalText.length, bestPos + bestTerm.length + contextChars);
  let snippet = originalText.slice(start, end).replace(/[\r\n]+/g, ' ');

  if (start > 0) snippet = '...' + snippet;
  if (end < originalText.length) snippet = snippet + '...';

  return snippet;
}
