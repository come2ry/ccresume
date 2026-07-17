export interface KeyBindings {
    quit: string[];
    selectPrevious: string[];
    selectNext: string[];
    confirm: string[];
    copySessionId: string[];
    scrollUp: string[];
    scrollDown: string[];
    scrollPageUp: string[];
    scrollPageDown: string[];
    scrollTop: string[];
    scrollBottom: string[];
    pageNext: string[];
    pagePrevious: string[];
    startNewSession: string[];
    openCommandEditor: string[];
    toggleFullView: string[];
}
export interface Config {
    keybindings: KeyBindings;
}
export declare const defaultConfig: Config;
