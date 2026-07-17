import { parse } from '@iarna/toml';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { defaultConfig } from '../types/config.js';
export function getConfigPath() {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(xdgConfigHome, 'ccresume', 'config.toml');
}
export function loadConfig() {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
        return defaultConfig;
    }
    try {
        const tomlContent = readFileSync(configPath, 'utf-8');
        const parsedConfig = parse(tomlContent);
        // Merge with default config to ensure all keys exist
        const config = mergeConfigs(defaultConfig, parsedConfig);
        // Check for key conflicts and warn user
        const conflicts = checkKeyConflicts(config.keybindings);
        if (conflicts.length > 0) {
            console.error('\n⚠️  Key binding conflicts detected:');
            conflicts.forEach(conflict => console.error(`   - ${conflict}`));
            console.error('   Please update your config.toml to resolve conflicts.\n');
        }
        return config;
    }
    catch (error) {
        console.error(`Failed to load config from ${configPath}:`, error);
        return defaultConfig;
    }
}
function mergeConfigs(defaultConf, userConf) {
    const merged = JSON.parse(JSON.stringify(defaultConf));
    // First, apply user configuration
    if (userConf.keybindings) {
        Object.keys(userConf.keybindings).forEach((key) => {
            const userBinding = userConf.keybindings[key];
            if (userBinding) {
                merged.keybindings[key] = userBinding;
            }
        });
    }
    // Then migrate config with conflict detection based on the merged result
    return migrateConfig(merged, userConf);
}
function migrateConfig(config, userConf) {
    // Only migrate if user hasn't explicitly configured startNewSession
    const userHasStartNewSession = userConf.keybindings && 'startNewSession' in userConf.keybindings;
    if (!userHasStartNewSession) {
        // Check if 'n' is already used by another keybinding
        const isNKeyUsed = isKeyAlreadyAssigned(config.keybindings, 'n');
        if (!isNKeyUsed) {
            // Only assign 'n' if it's not already in use
            config.keybindings.startNewSession = ['n'];
        }
        else {
            // If 'n' is taken, don't assign any default key
            // User must configure it manually in config.toml
            config.keybindings.startNewSession = [];
        }
    }
    return config;
}
function isKeyAlreadyAssigned(keybindings, key) {
    // Check all existing keybindings to see if the key is already used
    for (const [action, keys] of Object.entries(keybindings)) {
        if (action === 'startNewSession')
            continue; // Skip the key we're trying to add
        if (Array.isArray(keys) && keys.includes(key)) {
            return true;
        }
    }
    return false;
}
function checkKeyConflicts(keybindings) {
    const conflicts = [];
    const keyToActions = new Map();
    // Build a map of key -> [actions]
    for (const [action, keys] of Object.entries(keybindings)) {
        if (!Array.isArray(keys))
            continue;
        for (const key of keys) {
            if (!keyToActions.has(key)) {
                keyToActions.set(key, []);
            }
            keyToActions.get(key).push(action);
        }
    }
    // Find conflicts (keys assigned to multiple actions)
    for (const [key, actions] of keyToActions.entries()) {
        if (actions.length > 1) {
            conflicts.push(`Key '${key}' is assigned to multiple actions: ${actions.join(', ')}`);
        }
    }
    return conflicts;
}
