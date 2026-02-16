import type { PlanStep } from '@/stores/plan-store';

export function parseMarkdownChecklist(markdown: string): { title: string; steps: PlanStep[] } {
  const lines = markdown.split('\n');
  let title = '';
  const steps: PlanStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract title from first heading
    if (!title && trimmed.startsWith('#')) {
      title = trimmed.replace(/^#+\s*/, '');
      continue;
    }

    // Parse checklist items: - [ ] or - [x]
    const match = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (match) {
      const indent = line.search(/\S/);
      const step: PlanStep = {
        id: crypto.randomUUID(),
        text: match[2],
        completed: match[1] !== ' ',
      };

      // Indent > 2 means it's a child of the last top-level step
      if (indent > 2 && steps.length > 0) {
        const parent = steps[steps.length - 1];
        parent.children = parent.children ?? [];
        parent.children.push(step);
      } else {
        steps.push(step);
      }
    }
  }

  return { title: title || 'Untitled Plan', steps };
}

export function stepsToMarkdown(title: string, steps: PlanStep[]): string {
  let md = `# ${title}\n\n`;
  for (const step of steps) {
    md += `- [${step.completed ? 'x' : ' '}] ${step.text}\n`;
    if (step.children) {
      for (const child of step.children) {
        md += `   - [${child.completed ? 'x' : ' '}] ${child.text}\n`;
      }
    }
  }
  return md;
}
