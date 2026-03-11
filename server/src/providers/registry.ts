import type { CLIProvider } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, CLIProvider>();
  private defaultName: string | null = null;

  register(provider: CLIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): CLIProvider | undefined {
    return this.providers.get(name);
  }

  getDefault(): CLIProvider | undefined {
    if (!this.defaultName) return undefined;
    return this.providers.get(this.defaultName);
  }

  setDefault(name: string): void {
    this.defaultName = name;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
