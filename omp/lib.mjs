// Pure helpers for the omp extension (omp/qualflare.mjs), kept separate so
// `node --test` can cover them without omp.

/** Placeholders Claude Code fills in skill text; omp leaves them literal. */
export const PLACEHOLDERS = ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT'];

/**
 * Replaces `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_PLUGIN_ROOT}` in text, the
 * substitution Claude Code makes when it loads a skill. Only the braced form,
 * as Claude Code does: a bare `$CLAUDE_PROJECT_DIR` is left alone.
 * @param {string} text
 * @param {Record<string, string>} vars
 */
export function substitute(text, vars) {
  if (typeof text !== 'string' || !text.includes('${CLAUDE_')) return text;
  return text.replace(/\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)\}/g, (m, name) => vars[name] ?? m);
}

function substituteContent(content, vars) {
  if (typeof content === 'string') return substitute(content, vars);
  if (!Array.isArray(content)) return content;
  let changed = false;
  const out = content.map(part => {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      const text = substitute(part.text, vars);
      if (text !== part.text) {
        changed = true;
        return { ...part, text };
      }
    }
    return part;
  });
  return changed ? out : content;
}

/**
 * The messages with placeholders filled in user and tool-result text (where
 * skill bodies arrive). Returns null when nothing changed, so the caller can
 * leave omp's messages untouched.
 * @param {Array<any>} messages
 * @param {Record<string, string>} vars
 */
export function substituteMessages(messages, vars) {
  if (!Array.isArray(messages)) return null;
  let changed = false;
  const out = messages.map(m => {
    if (!m || m.role === 'assistant') return m;
    const content = substituteContent(m.content, vars);
    if (content === m.content) return m;
    changed = true;
    return { ...m, content };
  });
  return changed ? out : null;
}

const HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]\s*$/;

/**
 * Files an omp `edit` call touches, from its hashline patch: each file starts
 * with a `[PATH#TAG]` header. An edit is trivial, as in the Claude Code hook,
 * when it changes at most one line and removes or renames nothing.
 * @param {string} input
 * @returns {Array<{ path: string, trivial: boolean }>}
 */
export function editsFromPatch(input) {
  if (typeof input !== 'string') return [];
  const files = [];
  let cur = null;
  for (const line of input.split('\n')) {
    const h = HEADER.exec(line);
    if (h) {
      cur = { path: h[1].trim(), body: 0, structural: false };
      files.push(cur);
    } else if (cur) {
      if (line.startsWith('+')) cur.body += 1;
      else if (/^(CUT|REM|MV)\b/.test(line) || /^PUT .*@/.test(line)) cur.structural = true;
    }
  }
  return files.map(f => ({ path: f.path, trivial: !f.structural && f.body <= 1 }));
}

/**
 * Every file edit in an omp session's messages: `write` (never trivial) and
 * `edit` tool calls in assistant messages.
 * @param {Array<any>} messages
 */
export function editsFromMessages(messages) {
  const edits = [];
  for (const m of messages ?? []) {
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part?.type !== 'toolCall') continue;
      const args = part.arguments ?? {};
      if (part.name === 'write' && typeof args.path === 'string') {
        edits.push({ path: args.path, trivial: false });
      } else if (part.name === 'edit') {
        edits.push(...editsFromPatch(args.input));
      }
    }
  }
  return edits;
}
