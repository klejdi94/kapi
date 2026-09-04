import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder as placeholderExt } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import type { BodyLanguage } from '@/lib/format';

/** One shared syntax palette so JSON/XML/HTML/JS all read as the same "app". */
const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--accent)' },
  { tag: tags.attributeName, color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ok)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warn)' },
  { tag: [tags.keyword, tags.operator, tags.punctuation], color: 'var(--text-dim)' },
  { tag: tags.tagName, color: 'var(--info)' },
  { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

function langExtension(language: BodyLanguage): Extension {
  switch (language) {
    case 'json': return json();
    case 'xml': return xml();
    case 'html': return html();
    case 'javascript': return javascript();
    default: return [];
  }
}

export interface CodeEditorHandle {
  focus: () => void;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  wrap = true,
  placeholder,
  minHeight = '100%',
  onReady,
}: {
  value: string;
  onChange?: (value: string) => void;
  language: BodyLanguage;
  readOnly?: boolean;
  wrap?: boolean;
  placeholder?: string;
  minHeight?: string;
  onReady?: (handle: CodeEditorHandle) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!container.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(highlightStyle),
        languageCompartment.current.of(langExtension(language)),
        wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        placeholderExt(placeholder ?? ''),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: '100%' } }),
      ],
    });

    const view = new EditorView({ state, parent: container.current });
    viewRef.current = view;
    onReady?.({ focus: () => view.focus() });

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (loading a saved request, formatting, importing)
  // sync without fighting the user's own typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageCompartment.current.reconfigure(langExtension(language)) });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div ref={container} className="h-full min-h-0 overflow-hidden" style={{ minHeight }} />;
}
