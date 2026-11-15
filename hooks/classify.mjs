// Which edits in a session deserve the "/qf-cover" nudge. Shared by the
// Claude Code Stop hook (hooks/stop-hook.mjs) and the omp extension
// (omp/qualflare.mjs), so both harnesses nudge on the same rules.

export const SOURCE_EXT = /\.(?:[mc]?[jt]sx?|go|py|rb|php|rs|java|kt)$/;
export const TEST_PATTERNS = [
  /\.test\.[mc]?[jt]sx?$/,
  /\.spec\.[mc]?[jt]sx?$/,
  /[/\\]__tests__[/\\]/,
  /[/\\]e2e[/\\]/,
  /[/\\]cypress[/\\]/,
  /[/\\]playwright[/\\]/,
  /_test\.go$/,
  /(?:^|[/\\])test_[^/\\]+\.py$/,
  /[^/\\]+_test\.py$/,
  /[/\\]spec[/\\].+_spec\.rb$/,
  /[/\\]tests[/\\].+Test\.php$/,
];
export const CONFIG_PATTERNS = [
  /(^|[/\\])[^/\\]+\.config\.(?:[mc]?[jt]sx?|json)$/,     // vite.config.ts, babel.config.json
  /(^|[/\\])\.[^/\\]*rc\.(?:[mc]?[jt]s|json|ya?ml)$/,     // .eslintrc.js, .prettierrc.yaml
  /(^|[/\\])\.(?:eslintrc|prettierrc|babelrc|stylelintrc|commitlintrc)$/, // bare rc files
  /(^|[/\\])tsconfig(?:\.[^/\\]+)?\.json$/,                // tsconfig.json, tsconfig.app.json
];
export const TYPE_ONLY_PATTERNS = [
  /\.d\.[mc]?ts$/,        // *.d.ts, *.d.mts, *.d.cts
  /(^|[/\\])types\.tsx?$/, // types.ts, types.tsx
  /\.types\.tsx?$/,        // foo.types.ts
];
export const EXCLUDE_DIRS = [
  'node_modules', 'vendor', '.git', 'dist', 'build',
  '.next', '__pycache__', '.cache',
];

const isExcludedDir = (p) => EXCLUDE_DIRS.some(d => p.includes(`/${d}/`) || p.includes(`\\${d}\\`));
const isTest     = (p) => TEST_PATTERNS.some(re => re.test(p));
const isConfig   = (p) => CONFIG_PATTERNS.some(re => re.test(p));
const isTypeOnly = (p) => TYPE_ONLY_PATTERNS.some(re => re.test(p));

/**
 * @param {Array<{ path: string, trivial: boolean }>} edits
 * @returns {{ sourcePaths: Set<string>, testEdited: boolean, hasSubstantive: boolean }}
 */
export function classify(edits) {
  const sourceEdits = edits.filter(e =>
    !isExcludedDir(e.path) &&
    SOURCE_EXT.test(e.path) &&
    !isTest(e.path) &&
    !isConfig(e.path) &&
    !isTypeOnly(e.path),
  );
  const testEdited = edits.some(e =>
    !isExcludedDir(e.path) &&
    SOURCE_EXT.test(e.path) &&
    isTest(e.path),
  );
  return {
    sourcePaths: new Set(sourceEdits.map(e => e.path)),
    testEdited,
    hasSubstantive: sourceEdits.some(e => !e.trivial),
  };
}

/**
 * The nudge text, or null when the session doesn't warrant one: it fires only
 * when source changed, no tests were updated, and at least one edit was substantive.
 * @param {Array<{ path: string, trivial: boolean }>} edits
 * @param {string} command how to invoke qf-cover in this harness
 */
export function nudgeMessage(edits, command = '/qf-cover') {
  const { sourcePaths, testEdited, hasSubstantive } = classify(edits);
  if (sourcePaths.size === 0 || testEdited || !hasSubstantive) return null;
  return `🔍 Qualflare: ${sourcePaths.size} source file(s) changed without test updates. Run ${command} to add coverage.`;
}
