export const sidebarLimits = {
  sessions: { min: 260, max: 520, default: 320 },
  files: { min: 320, max: 960, default: 352 },
};
export type SidebarWidths = { sessions: number; files: number };

export function clampSidebarWidth(side: keyof SidebarWidths, width: number) {
  const limits = sidebarLimits[side];
  return Number.isFinite(width) ? Math.max(limits.min, Math.min(limits.max, Math.round(width))) : limits.default;
}

// Fit both panes without overwriting the preferred widths when the window temporarily shrinks.
export function fitSidebarWidths(preferred: SidebarWidths, viewport: number, sessionsOpen: boolean, filesOpen: boolean) {
  const minimum = (sessionsOpen ? sidebarLimits.sessions.min : 0) + (filesOpen ? sidebarLimits.files.min : 0);
  const extraSessions = sessionsOpen ? preferred.sessions - sidebarLimits.sessions.min : 0;
  const extraFiles = filesOpen ? preferred.files - sidebarLimits.files.min : 0;
  const available = Math.max(0, viewport - 440 - minimum);
  const scale = Math.min(1, available / (extraSessions + extraFiles || 1));
  return {
    sessions: sessionsOpen ? sidebarLimits.sessions.min + Math.floor(extraSessions * scale) : preferred.sessions,
    files: filesOpen ? sidebarLimits.files.min + Math.floor(extraFiles * scale) : preferred.files,
  };
}
