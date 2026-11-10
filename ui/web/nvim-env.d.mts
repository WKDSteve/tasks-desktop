// Types of nvim-env.mjs, for the Playwright projects (TypeScript) that use it.

export const PASS: string[];
export const XDG: string[];
export const MACHINE_VARS: string[];
export function nvimEnv(home: string, extra?: Record<string, string>, from?: NodeJS.ProcessEnv): Record<string, string>;
export function withoutMachineVars(from?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
