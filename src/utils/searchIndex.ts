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
}

export interface SearchResult {
  session: SearchableSession;
  snippet: string;
  matchTerms: string[];
}

// Regex patterns for fast extraction
const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const BRANCH_RE = /"gitBranch"\s*:\s*"((?:[^"\\]|\\.)*)"/;
// Match "text" and "content" string fields
const SEARCHABLE_FIELD_RE = /"(?:text|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
// Only extract from user/assistant message lines
const MSG_TYPE_RE = /"type"\s*:\s*"(?:user|assistant)"/;

function fastExtractTexts(content: string): string {
  const parts: string[] = [];

  // Extract cwd + branch from first occurrence
  const cwdMatch = content.match(CWD_RE);
  if (cwdMatch) parts.push(unescapeJson(cwdMatch[1]));
  const branchMatch = content.match(BRANCH_RE);
  if (branchMatch) parts.push(unescapeJson(branchMatch[1]));

  // Process only user/assistant message lines to avoid indexing
  // tool output file contents, todo items, etc.
  let lineStart = 0;
  while (lineStart < content.length) {
    let lineEnd = content.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = content.length;
    const line = content.substring(lineStart, lineEnd);
    lineStart = lineEnd + 1;

    if (!MSG_TYPE_RE.test(line)) continue;

    SEARCHABLE_FIELD_RE.lastIndex = 0;
    let match;
    while ((match = SEARCHABLE_FIELD_RE.exec(line)) !== null) {
      const val = match[1];
      if (val.length > 2) {
        parts.push(unescapeJson(val));
      }
    }
  }

  return parts.join(' ');
}

function unescapeJson(s: string): string {
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

    return {
      sessionId,
      filePath,
      projectDir,
      mtime: stats.mtime,
      searchText: (sessionId + ' ' + extracted).toLowerCase(),
    };
  } catch {
    return null;
  }
}

export async function buildAllSessionIndexes(): Promise<SearchableSession[]> {
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

    const snippet = extractSnippet(session.searchText, terms);
    results.push({ session, snippet, matchTerms: terms });
  }

  return results;
}

function extractSnippet(
  text: string,
  terms: string[],
  contextChars: number = 60
): string {
  let bestPos = text.length;
  let bestTerm = '';

  for (const term of terms) {
    const pos = text.indexOf(term);
    if (pos !== -1 && pos < bestPos) {
      bestPos = pos;
      bestTerm = term;
    }
  }

  if (bestPos === text.length) return '';

  const start = Math.max(0, bestPos - contextChars);
  const end = Math.min(text.length, bestPos + bestTerm.length + contextChars);
  let snippet = text.slice(start, end).replace(/[\r\n]+/g, ' ');

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}
