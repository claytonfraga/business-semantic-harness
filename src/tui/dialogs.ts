import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core';
import { githubDarkDimmedTheme as theme } from './theme.js';
import { fuzzyScore } from './fuzzySearch.js';

export interface SelectionItem<T> { label: string; description?: string; value: T; color?: string }
export interface SelectionDialog<T> {
  title: string; immediateNumeric?: boolean; pageSize?: number; initialQuery?: string; currentSelection?: T; items: SelectionItem<T>[];
  filter?: (query: string) => SelectionItem<T>[];
  cancelWords?: boolean; cancelOnEmpty?: boolean; cancelBackspace?: boolean;
  onQuerySubmit?: (query: string, items: SelectionItem<T>[]) => T | null | undefined;
}
export interface QuestionDialog { title: string; message: string; secret?: boolean; signal?: AbortSignal }
export interface DialogHost {
  select<T>(options: SelectionDialog<T>): Promise<T | null>;
  question(options: QuestionDialog): Promise<string | null>;
  notice(title: string, content: string): Promise<void>;
  readonly dialogActive: boolean;
}
let activeHost: DialogHost | undefined;
export function setActiveDialogHost(host: DialogHost | undefined): void { activeHost = host; }
export function getActiveDialogHost(): DialogHost | undefined { return activeHost; }

/** All dialogs share their owner's renderer and native focus graph. */
export async function createDialogHost(renderer: CliRenderer, restoreFocus: () => void): Promise<DialogHost> {
  const { BoxRenderable, TextRenderable, ScrollBoxRenderable, SelectRenderable, InputRenderable, StyledText, fg } = await import('@opentui/core');
  let active = false;
  let serial = 0;
  function mount(title: string) {
    if (active) throw new Error('A dialog is already open');
    active = true;
    const panel = new BoxRenderable(renderer, { id: `bsh-dialog-${serial++}`, position: 'absolute', bottom: 4, left: 0, width: '100%', maxWidth: 72, height: '70%', minHeight: 6, backgroundColor: theme.panel, border: true, borderColor: theme.border, flexDirection: 'column', padding: 1 });
    panel.add(new TextRenderable(renderer, { content: title, width: '100%', wrapMode: 'word', fg: theme.emphasis, flexShrink: 0 }));
    renderer.root.add(panel);
    return { panel, close() { renderer.root.remove(panel); panel.destroy(); active = false; restoreFocus(); } };
  }
  class MaskedInput extends InputRenderable {
    private editor = new InputRenderable(renderer, { id: `bsh-secret-model-${serial}`, showCursor: false, selectable: false });
    private sync() { this.setText('*'.repeat(Array.from(this.editor.value).length)); this.cursorOffset = Array.from(this.editor.value.slice(0, this.editor.cursorOffset)).length; }
    override handleKeyPress(key: KeyEvent): boolean { const handled = this.editor.handleKeyPress(key); this.sync(); return handled; }
    override handlePaste(event: PasteEvent): void { this.editor.handlePaste(event); this.sync(); }
    override insertText(text: string): void { this.editor.insertText(text); this.sync(); }
    takeSecret(): string { const value = this.editor.value; this.editor.setText(''); this.setText(''); return value; }
    override destroy(): void { this.editor.destroy(); super.destroy(); }
  }
  const host: DialogHost = {
    get dialogActive() { return active; },
    async select<T>(options: SelectionDialog<T>): Promise<T | null> {
      const { panel, close } = mount(options.title);
      const query = new InputRenderable(renderer, { id: `bsh-dialog-query-${serial}`, value: options.initialQuery ?? '', width: '100%', placeholder: 'Search', textColor: theme.text, backgroundColor: theme.recessed });
      const summary = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', fg: theme.muted });
      const list = new SelectRenderable(renderer, { width: '100%', flexGrow: options.pageSize ? 0 : 1, height: options.pageSize, minHeight: 1, options: [], showDescription: false, wrapSelection: true, selectedBackgroundColor: theme.selection, selectedTextColor: theme.emphasis, textColor: theme.muted });
      const detail = new TextRenderable(renderer, { width: '100%', wrapMode: 'word', fg: theme.text, flexShrink: 0 });
      const hint = new TextRenderable(renderer, { width: '100%', content: 'Enter: select · Esc: close · ↑/↓/Tab: move', wrapMode: 'word', fg: theme.muted, flexShrink: 0 });
      panel.add(query); panel.add(summary); panel.add(list); panel.add(detail); panel.add(hint);
      let items: SelectionItem<T>[] = [];
      let navigated = false;
      let numericChoice = '';
      let editingQuery = false;
      const updateDetail = () => { if (items.length && options.pageSize && !query.value) { const end = Math.min(items.length, Math.max(options.pageSize,list.getSelectedIndex()+1)); summary.content = `(${Math.max(1,end-options.pageSize+1)}-${end} of ${items.length}) • ↑/↓ scroll`; } const item = items[list.getSelectedIndex()]; const match = item ? fuzzyScore(item.label, query.value) : null; detail.content = item ? new StyledText([...Array.from(item.label).map((char, index) => fg(match?.indices.includes(index) ? theme.warning : theme.emphasis)(char)), fg(theme.text)(`\n${item.description ?? ''}`)]) : '';  list.selectedTextColor = item?.color ?? theme.emphasis; };
      const update = () => {
        const text = query.value;
        items = options.filter ? options.filter(text) : options.items.map(item => ({ item, match: fuzzyScore(`${item.label} ${item.description ?? ''}`, text) })).filter(row => row.match).sort((a,b) => (b.match?.score ?? 0) - (a.match?.score ?? 0)).map(row => row.item);
        list.options = items.map((item,index) => ({ name: `${index+1}. ${item.label}${item.value === options.currentSelection ? ' (current)' : ''}`, description: '', value: item.value }));
        list.setSelectedIndex(0); navigated = false;
        summary.content = items.length ? `${items.length} matches${text ? ` · Filter: ${text}` : ' · ↑/↓ scroll'}` : 'No match';
        updateDetail();
      };
      query.on('input', update); list.on('selectionChanged', updateDetail); update(); query.focus();
      return new Promise<T | null>(resolve => {
        let settled = false;
        const onDestroy = () => finish(null);
        const finish = (value: T | null) => { if (settled) return; settled = true; renderer.off('destroy', onDestroy); renderer.keyInput.off('keypress', route); close(); resolve(value); };
        const route = (key: KeyEvent) => {
          const text = query.value;
          if (key.name === 'escape' || (key.ctrl && key.name === 'c') || (options.cancelBackspace && key.name === 'backspace' && !text)) { key.preventDefault(); finish(null); return; }
          if (key.name === 'up' || key.name === 'down' || key.name === 'tab' || (!text && (key.name === 'j' || key.name === 'k'))) { key.preventDefault(); navigated = true; if (key.name === 'up' || key.name === 'k' || (key.name === 'tab' && key.shift)) list.moveUp(); else list.moveDown(); updateDetail(); return; }
          if (options.immediateNumeric && !text && /^[1-9]$/.test(key.name) && items[Number(key.name)-1]) { key.preventDefault(); finish(items[Number(key.name)-1].value); return; }
          if (!options.immediateNumeric && !editingQuery && /^[0-9]$/.test(key.name) && !key.ctrl && !key.meta) { key.preventDefault(); numericChoice += key.name; summary.content = `Choice: ${numericChoice} · Enter: select`; return; }
          if (numericChoice && key.name === 'backspace') { key.preventDefault(); numericChoice = numericChoice.slice(0,-1); summary.content = `Choice: ${numericChoice} · Enter: select`; return; }
          if (key.name === 'return' || key.name === 'enter') {
            key.preventDefault();
            if (numericChoice) { const item = items[Number(numericChoice)-1]; if (item) finish(item.value); else { numericChoice = ''; update(); } return; }
            if ((options.cancelOnEmpty && !text && !navigated) || (options.cancelWords && /^(q|cancel|exit)$/i.test(text))) { finish(null); return; }
            const custom = options.onQuerySubmit?.(text,items);
            if (custom !== undefined) { finish(custom); return; }
            const exact = options.items.find(item => item.label.toLowerCase() === text.toLowerCase());
            finish(exact?.value ?? items[list.getSelectedIndex()]?.value ?? null);
          } else if (key.name.length === 1 && !key.ctrl && !key.meta) { editingQuery = true; numericChoice = ''; }
        };
        renderer.keyInput.on('keypress', route); renderer.once('destroy', onDestroy);
      });
    },
    async question(options) {
      const { panel, close } = mount(options.title);
      const scroll = new ScrollBoxRenderable(renderer, { width: '100%', flexGrow: 1, minHeight: 1 });
      scroll.add(new TextRenderable(renderer, { content: options.message, width: '100%', wrapMode: 'word', fg: theme.text })); panel.add(scroll);
      const input = options.secret ? new MaskedInput(renderer, { width: '100%', selectable: false, textColor: theme.text }) : new InputRenderable(renderer, { width: '100%', textColor: theme.text });
      panel.add(input); panel.add(new TextRenderable(renderer, { content: 'Enter: continue · Esc: cancel', width: '100%', wrapMode: 'word', fg: theme.muted })); input.focus();
      return new Promise<string | null>(resolve => {
        let settled = false;
        const onDestroy = () => finish(null);
        const finish = (value: string | null) => { if (settled) return; settled = true; renderer.off('destroy', onDestroy); renderer.keyInput.off('keypress', route); options.signal?.removeEventListener('abort', abort); close(); resolve(value); };
        const abort = () => finish(null);
        const route = (key: KeyEvent) => {
          if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { key.preventDefault(); finish(null); }
          else if (key.name === 'return' || key.name === 'enter') { key.preventDefault(); finish(input instanceof MaskedInput ? input.takeSecret() : input.value); }
          else if (key.name === 'pageup' || key.name === 'pagedown') { key.preventDefault(); scroll.scrollBy(key.name === 'pageup' ? -5 : 5); }
        };
        renderer.keyInput.on('keypress', route); renderer.once('destroy', onDestroy); options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
      });
    },
    async notice(title, content) { await host.question({ title, message: content }); },
  };
  return host;
}
