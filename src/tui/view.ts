import { BoxRenderable, TextRenderable, TextareaRenderable, ScrollBoxRenderable, createCliRenderer, type CliRenderer, type KeyEvent } from '@opentui/core';
import { createEntryComponent } from './entries.js';
import type { ChatEntry, RenderState } from './state.js';
import { githubDarkDimmedTheme as theme } from './theme.js';

export interface TuiView {
  readonly renderer: CliRenderer;
  readonly root: BoxRenderable;
  readonly input: TextareaRenderable;
  readonly scroll: ScrollBoxRenderable;
  update(state: RenderState, entries: ChatEntry[]): void;
  getPrompt(): string;
  setPrompt(value: string): void;
  focusPrompt(): void;
  scrollBy(lines: number): void;
  scrollTo(edge: 'top' | 'bottom'): void;
  onSubmit(listener: (prompt: string) => void): () => void;
  onKeypress(listener: (event: KeyEvent) => void): () => void;
  suspend(): void;
  resume(): void;
  destroy(): void;
}

/** Renderer injection uses the same supported component graph in native tests. */
export async function createTuiView(options: { renderer?: CliRenderer } = {}): Promise<TuiView> {
  const renderer = options.renderer ?? await createCliRenderer({ exitOnCtrlC: false, backgroundColor: theme.background });
  const root = new BoxRenderable(renderer, { id: 'bsh-session', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: theme.background });
  const header = new BoxRenderable(renderer, { id: 'bsh-header', height: 3, flexShrink: 0, width: '100%', backgroundColor: theme.panel, flexDirection: 'column' });
  const brand = new TextRenderable(renderer, { id: 'bsh-brand', height: 1, width: '100%', fg: theme.emphasis });
  const context = new TextRenderable(renderer, { id: 'bsh-context', height: 2, width: '100%', fg: theme.text, wrapMode: 'word' });
  header.add(brand); header.add(context);
  const scroll = new ScrollBoxRenderable(renderer, { id: 'bsh-conversation', width: '100%', flexGrow: 1, minHeight: 0, stickyScroll: true, stickyStart: 'bottom', scrollX: false, contentOptions: { flexDirection: 'column', backgroundColor: theme.background }, scrollbarOptions: { trackOptions: { backgroundColor: theme.recessed, foregroundColor: theme.accent } } });
  const footer = new BoxRenderable(renderer, { id: 'bsh-footer', height: 4, width: '100%', flexShrink: 0, flexDirection: 'column', backgroundColor: theme.panel });
  const input = new TextareaRenderable(renderer, { id: 'bsh-prompt', width: '100%', height: 1, textColor: theme.text, backgroundColor: theme.recessed, focusedBackgroundColor: theme.recessed, focusedTextColor: theme.emphasis, selectionBg: theme.selection, selectionFg: theme.emphasis, placeholder: 'Type your prompt here...', placeholderColor: theme.muted, keyBindings: [{ name: 'return', action: 'submit' }, { name: 'return', shift: true, action: 'newline' }] });
  const telemetry = new TextRenderable(renderer, { id: 'bsh-telemetry', width: '100%', height: 1, fg: theme.text });
  const shortcuts = new TextRenderable(renderer, { id: 'bsh-shortcuts', width: '100%', height: 1, fg: theme.muted, content: '/ commands · Ctrl+D domain · Ctrl+G governance · Ctrl+O reasoning' });
  const alert = new TextRenderable(renderer, { id: 'bsh-exit-alert', width: '100%', height: 1, fg: theme.warning });
  footer.add(input); footer.add(telemetry); footer.add(shortcuts); footer.add(alert);
  root.add(header); root.add(scroll); root.add(footer); renderer.root.add(root);
  const cards: ReturnType<typeof createEntryComponent>[] = [];
  const snapshots: string[] = [];
  const submissions = new Set<(prompt: string) => void>();
  const keyListeners = new Set<(event: KeyEvent) => void>();
  const routeKey = (event: KeyEvent) => { for (const listener of keyListeners) listener(event); };
  renderer.keyInput.on('keypress', routeKey);
  input.onSubmit = () => { for (const listener of submissions) listener(input.plainText); };
  input.focus();
  let destroyed = false;
  return {
    renderer, root, input, scroll,
    update(state, entries) {
      const status = !state.governed ? 'UNGOVERNED' : state.alignmentStatus === 'MISMATCH' ? 'DOMAIN MISMATCH' : 'GOVERNED';
      brand.content = `BSH [Business Semantic Harness] · ${status}`;
      brand.fg = status === 'GOVERNED' ? theme.success : theme.warning;
      const ontology = state.ontologySummary || state.domain;
      context.content = `Project: ${state.projectFolder || 'project'} · Branch: ${state.gitBranch || 'non-git'} · Ontology: ${ontology ? `${ontology} (${state.governed ? 'SHACL active' : 'inactive'})` : 'none (inactive)'}${state.activeSkill ? ` · Skill: ${state.activeSkill} [ACTIVE]` : ''}${state.alignmentWarning ? ` · ${state.alignmentWarning}` : ''}`;
      const total = state.contextLength || 131072;
      telemetry.content = `Model: ${state.model} · Context: ${Math.round(total / 1024)}k · Tokens: ${state.tokensTotal} (${(state.tokensTotal / total * 100).toFixed(1)}%) · Cost: $${(state.sessionCost || 0).toFixed(4)}${state.generationDurationMs !== undefined ? ` · ${(state.generationDurationMs / 1000).toFixed(1)}s` : ''}${state.generationTps !== undefined ? ` · ${state.generationTps.toFixed(1)} TPS` : ''}${state.queueLength ? ` · QUEUED: ${state.queueLength}` : ''}`;
      alert.content = state.ctrlCExitAlert ? 'Press Ctrl+C again to exit' : '';
      while (cards.length > entries.length) {
        const card = cards.pop(); snapshots.pop();
        if (card) { scroll.remove(card.component); card.component.destroy(); }
      }
      entries.forEach((entry, index) => {
        let card = cards[index];
        if (!card) { card = createEntryComponent(renderer, `bsh-entry-${index}`); cards.push(card); scroll.add(card.component); }
        const snapshot = JSON.stringify(entry);
        if (snapshot !== snapshots[index]) { card.update(entry); snapshots[index] = snapshot; }
      });
      if (entries.length === 0) scroll.scrollTo(0);
    },
    getPrompt: () => input.plainText,
    setPrompt: value => { input.setText(value); },
    focusPrompt: () => input.focus(),
    scrollBy: lines => scroll.scrollBy(lines),
    scrollTo: edge => scroll.scrollTo(edge === 'top' ? 0 : scroll.scrollHeight),
    onSubmit(listener) { submissions.add(listener); return () => { submissions.delete(listener); }; },
    onKeypress(listener) { keyListeners.add(listener); return () => { keyListeners.delete(listener); }; },
    suspend: () => renderer.suspend(),
    resume: () => { renderer.resume(); input.focus(); },
    destroy() { if (destroyed) return; destroyed = true; renderer.keyInput.off('keypress', routeKey); submissions.clear(); keyListeners.clear(); renderer.destroy(); },
  };
}
