import type { GhosttyCell, Terminal } from 'ghostty-web';

export const darkTheme = {
  background: '#16181d',
  foreground: '#e6e8ee',
  cursor: '#b6cfff',
  selectionBackground: '#435477',
  selectionForeground: '#ffffff',
  black: '#23262d',
  red: '#e47c87',
  green: '#9ec68c',
  yellow: '#e5bc72',
  blue: '#87afdc',
  magenta: '#c69bdc',
  cyan: '#81c3bd',
  white: '#ced3de',
  brightBlack: '#9299a8',
  brightRed: '#ff9aa4',
  brightGreen: '#b7dc9f',
  brightYellow: '#f9d395',
  brightBlue: '#a7ceff',
  brightMagenta: '#dfb6f3',
  brightCyan: '#a2e1dc',
  brightWhite: '#f6f7fb',
};

export const lightTheme: typeof darkTheme = {
  background: '#fafafc',
  foreground: '#242936',
  cursor: '#375a95',
  selectionBackground: '#d6e3fa',
  selectionForeground: '#192c4b',
  black: '#21252d',
  red: '#aa273a',
  green: '#356325',
  yellow: '#80530d',
  blue: '#2e5b98',
  magenta: '#75448f',
  cyan: '#1f6663',
  white: '#515c70',
  brightBlack: '#626c7d',
  brightRed: '#992146',
  brightGreen: '#2c6823',
  brightYellow: '#855617',
  brightBlue: '#304f99',
  brightMagenta: '#823e9e',
  brightCyan: '#116b71',
  brightWhite: '#343d50',
};

const palette = Object.entries(darkTheme).filter(([key]) => key !== 'cursor' && !key.startsWith('selection'));
const lightColors = new Map(palette.map(([key, color]) => {
  const rgb = parseInt(lightTheme[key as keyof typeof lightTheme].slice(1), 16);
  return [parseInt(color.slice(1), 16), [rgb >> 16, (rgb >> 8) & 255, rgb & 255] as const];
}));

function recolor(cells: GhosttyCell[] | null) {
  // Both Ghostty row readers return copies. Keep the backing buffer's colors intact.
  for (const cell of cells ?? []) {
    const fg = lightColors.get((cell.fg_r << 16) | (cell.fg_g << 8) | cell.fg_b);
    const bg = lightColors.get((cell.bg_r << 16) | (cell.bg_g << 8) | cell.bg_b);
    if (fg) [cell.fg_r, cell.fg_g, cell.fg_b] = fg;
    if (bg) [cell.bg_r, cell.bg_g, cell.bg_b] = bg;
  }
  return cells;
}

export function updateTerminalTheme(terminal: Terminal) {
  const { wasmTerm, renderer } = terminal;
  if (!wasmTerm || !renderer) return;
  const line = wasmTerm.getLine.bind(wasmTerm);
  const scrollbackLine = wasmTerm.getScrollbackLine.bind(wasmTerm);
  return (dark: boolean) => {
    // Ghostty Web 0.4 resolves the palette to RGB in WASM when the buffer is created.
    // Recolor cell snapshots for the canvas so theme changes preserve the live buffer.
    wasmTerm.getLine = dark ? line : (row) => recolor(line(row));
    wasmTerm.getScrollbackLine = dark ? scrollbackLine : (row) => recolor(scrollbackLine(row));
    renderer.setTheme(dark ? darkTheme : lightTheme);
    renderer.render(wasmTerm, true, terminal.getViewportY(), terminal, 0);
  };
}
