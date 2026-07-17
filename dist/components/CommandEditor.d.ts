import React from 'react';
interface CommandEditorProps {
    initialArgs: string[];
    onComplete: (args: string[]) => void;
    onCancel: () => void;
}
export declare const CommandEditor: React.FC<CommandEditorProps>;
export {};
