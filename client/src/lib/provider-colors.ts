const providerColors: Record<string, { bg: string; border: string }> = {
  claude: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
  },
  codex: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
};

export function getProviderStyle(provider?: string | null): { bg: string; border: string } {
  if (!provider) return { bg: '', border: '' };
  return providerColors[provider] ?? { bg: 'bg-gray-50 dark:bg-gray-950/30', border: 'border-gray-200 dark:border-gray-800' };
}
