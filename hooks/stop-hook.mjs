#!/usr/bin/env node
import { createReadStream, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { resolve } from 'path';
import { nudgeMessage } from './classify.mjs';

try {
  // 1. Read stdin
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  await new Promise(r => process.stdin.on('end', r));
  const input = JSON.parse(chunks.join(''));
  const { transcript_path, cwd } = input;

  if (!transcript_path || !cwd) process.exit(0);

  // 2. Read config — exit silently if missing or stopHookEnabled !== true
  const configPath = resolve(cwd, '.qualflare', 'config.json');
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { process.exit(0); }
  if (config.stopHookEnabled !== true) process.exit(0);

  const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

  function isTrivialEdit(block) {
    if (block.name !== 'Edit') return false; // Write / MultiEdit / NotebookEdit never trivial
    const oldStr = block.input?.old_string ?? '';
    const newStr = block.input?.new_string ?? '';
    return newStr.trimEnd().split('\n').length <= 1
        && oldStr.trimEnd().split('\n').length <= 1
        && Math.abs(newStr.length - oldStr.length) <= 40;
  }

  // 4. Read transcript and collect edits
  const edits = []; // Array<{ path: string, tool: string, trivial: boolean }>
  const rl = createInterface({ input: createReadStream(transcript_path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Real transcript shape: assistant message wrapping content blocks
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use' && EDIT_TOOLS.has(block.name)) {
          const p = block.input?.file_path ?? block.input?.path;
          if (p) edits.push({ path: p, tool: block.name, trivial: isTrivialEdit(block) });
        }
      }
    }

    // Legacy fallback: top-level tool_use (older transcript format)
    if (entry.type === 'tool_use' && EDIT_TOOLS.has(entry.name)) {
      const p = entry.input?.file_path ?? entry.input?.path;
      if (p) edits.push({ path: p, tool: entry.name, trivial: isTrivialEdit(entry) });
    }
  }

  // 5. Classify (rules shared with the omp extension) and nudge
  const message = nudgeMessage(edits);
  if (message) console.log(JSON.stringify({ systemMessage: message }));
} catch {
  // exit silently on any error — hook must never crash
}
