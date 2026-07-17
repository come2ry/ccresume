/**
 * Strictly truncate a string to fit within the specified width
 * This function ensures that the string never exceeds the maximum width
 * by cutting off characters that would overflow
 */
export declare function strictTruncateByWidth(str: string, maxWidth: number): string;
/**
 * Strictly truncate each line of a multi-line string
 */
export declare function strictTruncateLines(text: string, maxWidth: number): string;
