// omp extension for the Qualflare plugin. Claude Code reads the same skills
// and commands; this adds what omp doesn't do on its own:
//
// 1. Fills `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_PLUGIN_ROOT}` in skill text
//    before each model call, as Claude Code does when it loads a skill.
// 2. The end-of-session nudge to run /skill:qf-cover (Claude Code: the Stop
//    hook in hooks/), on the same rules (hooks/classify.mjs).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nudgeMessage } from '../hooks/classify.mjs';
import { editsFromMessages, substituteMessages } from './lib.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {import('@oh-my-pi/pi-coding-agent').ExtensionAPI} pi */
export default function qualflare(pi) {
  const vars = (ctx) => ({ CLAUDE_PROJECT_DIR: ctx.cwd, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });

  pi.on('session_start', (_event, ctx) => {
    // Shell commands the model copies literally still resolve.
    process.env.CLAUDE_PROJECT_DIR ??= ctx.cwd;
    process.env.CLAUDE_PLUGIN_ROOT ??= PLUGIN_ROOT;
  });

  pi.on('context', (event, ctx) => {
    const messages = substituteMessages(event.messages, vars(ctx));
    return messages ? { messages } : undefined;
  });

  let lastNudge = null;
  pi.on('session_stop', (event, ctx) => {
    try {
      const config = JSON.parse(readFileSync(resolve(ctx.cwd, '.qualflare', 'config.json'), 'utf8'));
      if (config.stopHookEnabled !== true) return;
      const message = nudgeMessage(editsFromMessages(event.messages), '/skill:qf-cover');
      // Once per change set: a later stop with the same edits stays quiet.
      if (!message || message === lastNudge) return;
      lastNudge = message;
      if (ctx.hasUI) ctx.ui.notify(message, 'info');
    } catch {
      // No config, or unreadable: the nudge is opt-in, so stay quiet.
    }
  });
}
