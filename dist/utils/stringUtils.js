import { truncateStringByWidth, getStringWidth } from './charWidth.js';
export function truncateString(str, maxLength) {
    return truncateStringByWidth(str, maxLength);
}
export function getStringDisplayLength(str) {
    return getStringWidth(str);
}
