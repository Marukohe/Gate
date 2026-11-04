// Spell out the former --full-auto policy; newer Codex versions removed that alias.
export const CODEX_EXEC_ARGS = ['--ask-for-approval', 'on-request', 'exec', '--sandbox', 'workspace-write'];
export const CODEX_EXEC_COMMAND = `codex ${CODEX_EXEC_ARGS.join(' ')}`;
