"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, WidgetType } from "@codemirror/view";
import * as Y from "yjs";
import {
  createArticleCollaborationStateInSupabase,
  loadArticleCollaborationStateFromSupabase,
  saveArticleCollaborationStateToSupabase,
} from "@/lib/supabase-collaboration";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";

type RemoteCursor = {
  clientId: string;
  color: string;
  selectionEnd: number;
  selectionStart: number;
  userName: string;
};

type RealtimeRemoteCursor = RemoteCursor & {
  updatedAt: number;
};

type CursorSelection = {
  end: number;
  start: number;
};

type CollaborativeLatexEditorProps = {
  articleId: string;
  className?: string;
  collaborationClientId?: string;
  collaborationUserName?: string;
  language: "pt" | "en";
  onChange: (value: string) => void;
  onSelectionChange?: (selection: CursorSelection) => void;
  remoteCursors?: RemoteCursor[];
  value: string;
  workspaceId?: string | null;
};

export type CollaborativeLatexEditorHandle = {
  focus: () => void;
  getSelection: () => CursorSelection | null;
  setSelection: (start: number, end: number) => void;
};

const codeMirrorOrigin = Symbol("codemirror");
const externalOrigin = Symbol("external");
const initialOrigin = Symbol("initial");
const remoteOrigin = Symbol("remote");
const setRemoteCursorsEffect = StateEffect.define<RemoteCursor[]>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getCursorColor(value: string) {
  const colors = ["#8ee7ff", "#6ee7b7", "#fbbf24", "#fda4af", "#c4b5fd", "#93c5fd"];
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

function encodeUint8Array(value: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < value.length; index += chunkSize) {
    binary += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function decodeUint8Array(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

class RemoteCursorWidget extends WidgetType {
  constructor(private readonly cursor: RemoteCursor) {
    super();
  }

  eq(other: RemoteCursorWidget) {
    return (
      other.cursor.clientId === this.cursor.clientId &&
      other.cursor.color === this.cursor.color &&
      other.cursor.selectionEnd === this.cursor.selectionEnd &&
      other.cursor.selectionStart === this.cursor.selectionStart &&
      other.cursor.userName === this.cursor.userName
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-papergraph-remote-cursor";
    wrapper.style.borderLeft = `2px solid ${this.cursor.color}`;
    wrapper.style.marginLeft = "-1px";
    wrapper.style.marginRight = "-1px";
    wrapper.style.position = "relative";

    const label = document.createElement("span");
    label.className = "cm-papergraph-remote-cursor-label";
    label.textContent = this.cursor.userName;
    label.style.background = this.cursor.color;
    label.style.borderRadius = "999px";
    label.style.color = "#041016";
    label.style.fontFamily = "var(--font-sans)";
    label.style.fontSize = "10px";
    label.style.fontWeight = "800";
    label.style.left = "-1px";
    label.style.lineHeight = "1";
    label.style.padding = "3px 6px";
    label.style.pointerEvents = "none";
    label.style.position = "absolute";
    label.style.top = "-1.55rem";
    label.style.whiteSpace = "nowrap";
    label.style.zIndex = "8";

    wrapper.appendChild(label);

    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

const remoteCursorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(cursorDecorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRemoteCursorsEffect)) {
        const documentLength = transaction.state.doc.length;
        const decorations = effect.value
          .filter((cursor) => Number.isFinite(cursor.selectionStart))
          .map((cursor) =>
            Decoration.widget({
              side: 1,
              widget: new RemoteCursorWidget(cursor),
            }).range(clamp(cursor.selectionEnd, 0, documentLength)),
          );

        return Decoration.set(decorations, true);
      }
    }

    return cursorDecorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const paperGraphEditorTheme = EditorView.theme({
  "&": {
    background: "#f7fbff",
    color: "#0f172a",
    fontSize: "14px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "#0f172a",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.75",
    minHeight: "100%",
    padding: "1.25rem",
  },
  ".cm-cursor": {
    borderLeftColor: "#0f172a",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    background: "#edf4fb",
    borderRight: "1px solid rgba(15, 23, 42, 0.1)",
    color: "#64748b",
  },
  ".cm-line": {
    padding: "0 0.25rem",
  },
  ".cm-scroller": {
    borderRadius: "24px",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    overflow: "auto",
  },
  ".cm-selectionBackground": {
    background: "rgba(14, 165, 233, 0.24) !important",
  },
});

function yTextDeltaToEditorChanges(delta: Y.YTextEvent["delta"]) {
  let position = 0;
  const changes: Array<{ from: number; insert?: string; to?: number }> = [];

  delta.forEach((operation) => {
    if (operation.retain) {
      position += operation.retain;
      return;
    }

    if (operation.delete) {
      changes.push({ from: position, to: position + operation.delete });
      return;
    }

    if (operation.insert) {
      const insertedText = String(operation.insert);
      changes.push({ from: position, insert: insertedText });
      position += insertedText.length;
    }
  });

  return changes;
}

export const CollaborativeLatexEditor = forwardRef<
  CollaborativeLatexEditorHandle,
  CollaborativeLatexEditorProps
>(function CollaborativeLatexEditor(
  {
    articleId,
    className,
    collaborationClientId,
    collaborationUserName,
    language,
    onChange,
    onSelectionChange,
    remoteCursors = [],
    value,
    workspaceId,
  },
  ref,
) {
  const [realtimeRemoteCursors, setRealtimeRemoteCursors] = useState<RealtimeRemoteCursor[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const collaborationReadyRef = useRef(false);
  const applyingYjsUpdateRef = useRef(false);
  const latestValueRef = useRef(value);
  const currentValueRef = useRef(value);
  const latestSelectionRef = useRef<CursorSelection>({ end: 0, start: 0 });
  const collaborationClientIdRef = useRef(collaborationClientId);
  const collaborationUserNameRef = useRef(collaborationUserName);
  const broadcastCursorRef = useRef<(selection: CursorSelection) => void>(() => undefined);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const persistTimeoutRef = useRef<number | null>(null);

  currentValueRef.current = value;
  collaborationClientIdRef.current = collaborationClientId;
  collaborationUserNameRef.current = collaborationUserName;

  const visibleRemoteCursors = useMemo(() => {
    const cursorsByClientId = new Map<string, RemoteCursor>();

    remoteCursors.forEach((cursor) => {
      cursorsByClientId.set(cursor.clientId, cursor);
    });

    realtimeRemoteCursors.forEach((cursor) => {
      cursorsByClientId.set(cursor.clientId, cursor);
    });

    return [...cursorsByClientId.values()];
  }, [realtimeRemoteCursors, remoteCursors]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const staleBefore = Date.now() - 15000;

      setRealtimeRemoteCursors((currentCursors) =>
        currentCursors.filter((cursor) => cursor.updatedAt >= staleBefore),
      );
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  useImperativeHandle(ref, () => ({
    focus() {
      editorViewRef.current?.focus();
    },
    getSelection() {
      const selection = editorViewRef.current?.state.selection.main;

      return selection ? { end: selection.to, start: selection.from } : null;
    },
    setSelection(start: number, end: number) {
      const editorView = editorViewRef.current;

      if (!editorView) {
        return;
      }

      editorView.dispatch({
        scrollIntoView: true,
        selection: {
          anchor: clamp(start, 0, editorView.state.doc.length),
          head: clamp(end, 0, editorView.state.doc.length),
        },
      });
      editorView.focus();
    },
  }), []);

  useEffect(() => {
    const parent = containerRef.current;

    if (!parent) {
      return undefined;
    }

    let cancelled = false;
    let isYTextObserved = false;
    const yDoc = new Y.Doc();
    const yText = yDoc.getText("source");
    yDocRef.current = yDoc;
    yTextRef.current = yText;

    const emitValue = (nextValue: string) => {
      if (latestValueRef.current === nextValue) {
        return;
      }

      latestValueRef.current = nextValue;
      onChangeRef.current(nextValue);
    };

    const emitSelection = (selection: { from: number; to: number }) => {
      const nextSelection = {
        end: selection.to,
        start: selection.from,
      };

      latestSelectionRef.current = nextSelection;
      onSelectionChangeRef.current?.(nextSelection);
      broadcastCursorRef.current(nextSelection);
    };

    const schedulePersist = () => {
      if (!workspaceId || !articleId || !collaborationReadyRef.current) {
        return;
      }

      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
      }

      persistTimeoutRef.current = window.setTimeout(() => {
        const supabase = getSupabaseBrowserClient();
        const currentDoc = yDocRef.current;

        if (!supabase || !currentDoc) {
          return;
        }

        void saveArticleCollaborationStateToSupabase(
          supabase,
          workspaceId,
          articleId,
          encodeUint8Array(Y.encodeStateAsUpdate(currentDoc)),
        ).catch(() => undefined);
      }, 900);
    };

    const updateListener = EditorView.updateListener.of((update) => {
      const selection = update.state.selection.main;

      if (update.selectionSet || update.docChanged) {
        emitSelection(selection);
      }

      if (!update.docChanged) {
        return;
      }

      const nextValue = update.state.doc.toString();

      if (!collaborationReadyRef.current) {
        emitValue(nextValue);
        return;
      }

      if (applyingYjsUpdateRef.current) {
        emitValue(nextValue);
        return;
      }

      yDoc.transact(() => {
        let offset = 0;

        update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          const from = fromA + offset;
          const deletedLength = toA - fromA;
          const insertedText = inserted.toString();

          if (deletedLength > 0) {
            yText.delete(from, deletedLength);
          }

          if (insertedText) {
            yText.insert(from, insertedText);
          }

          offset += insertedText.length - deletedLength;
        });
      }, codeMirrorOrigin);

      emitValue(nextValue);
    });
    const cursorEmitHandlers = EditorView.domEventHandlers({
      focus(_event, view) {
        emitSelection(view.state.selection.main);
        return false;
      },
      keyup(_event, view) {
        emitSelection(view.state.selection.main);
        return false;
      },
      mouseup(_event, view) {
        window.requestAnimationFrame(() => emitSelection(view.state.selection.main));
        return false;
      },
    });

    const editorView = new EditorView({
      parent,
      state: EditorState.create({
        doc: currentValueRef.current,
        extensions: [
          basicSetup,
          StreamLanguage.define(stex),
          remoteCursorField,
          paperGraphEditorTheme,
          EditorView.lineWrapping,
          updateListener,
          cursorEmitHandlers,
        ],
      }),
    });
    editorViewRef.current = editorView;
    emitSelection(editorView.state.selection.main);

    const replaceEditorDocument = (nextValue: string) => {
      const currentValue = editorView.state.doc.toString();

      if (currentValue === nextValue) {
        emitValue(nextValue);
        return;
      }

      applyingYjsUpdateRef.current = true;
      editorView.dispatch({
        changes: {
          from: 0,
          insert: nextValue,
          to: editorView.state.doc.length,
        },
      });
      applyingYjsUpdateRef.current = false;
      emitValue(nextValue);
    };

    const yTextObserver = (event: Y.YTextEvent) => {
      if (event.transaction.origin === codeMirrorOrigin) {
        return;
      }

      const changes = yTextDeltaToEditorChanges(event.delta);

      if (changes.length === 0) {
        return;
      }

      applyingYjsUpdateRef.current = true;
      editorView.dispatch({ changes });
      applyingYjsUpdateRef.current = false;
    };

    const observeYText = () => {
      if (isYTextObserved) {
        return;
      }

      yText.observe(yTextObserver);
      isYTextObserved = true;
    };

    async function initializeCollaboration() {
      try {
        const currentWorkspaceId = workspaceId ?? null;
        const supabase = currentWorkspaceId ? getSupabaseBrowserClient() : null;
        const persistedState = supabase && currentWorkspaceId
          ? await loadArticleCollaborationStateFromSupabase(supabase, currentWorkspaceId, articleId)
          : null;

        if (cancelled) {
          return;
        }

        if (persistedState) {
          Y.applyUpdate(yDoc, decodeUint8Array(persistedState), initialOrigin);
          replaceEditorDocument(yText.toString());
        } else {
          yDoc.transact(() => {
            yText.insert(0, editorView.state.doc.toString());
          }, initialOrigin);

          if (supabase && currentWorkspaceId) {
            const createdState = await createArticleCollaborationStateInSupabase(
              supabase,
              currentWorkspaceId,
              articleId,
              encodeUint8Array(Y.encodeStateAsUpdate(yDoc)),
            );

            if (createdState !== encodeUint8Array(Y.encodeStateAsUpdate(yDoc))) {
              Y.applyUpdate(yDoc, decodeUint8Array(createdState), initialOrigin);
              replaceEditorDocument(yText.toString());
            }
          }
        }

        collaborationReadyRef.current = true;
        observeYText();

        if (!supabase || !currentWorkspaceId) {
          return;
        }

        const clientId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const channel = supabase.channel(`papergraph:workspace:${currentWorkspaceId}:article:${articleId}:doc`, {
          config: {
            broadcast: {
              self: false,
            },
          },
        });

        const sendUpdate = (event: string, update: Uint8Array, targetClientId?: string) => {
          void channel.send({
            event,
            payload: {
              clientId,
              targetClientId,
              update: encodeUint8Array(update),
            },
            type: "broadcast",
          });
        };
        const sendCursor = (selection: CursorSelection) => {
          const currentClientId = collaborationClientIdRef.current ?? clientId;
          const userName =
            collaborationUserNameRef.current ?? (language === "en" ? "Collaborator" : "Colaborador");

          void channel.send({
            event: "cursor",
            payload: {
              clientId: currentClientId,
              color: getCursorColor(currentClientId),
              selectionEnd: selection.end,
              selectionStart: selection.start,
              userName,
            },
            type: "broadcast",
          });
        };

        broadcastCursorRef.current = sendCursor;

        const yDocUpdateHandler = (update: Uint8Array, origin: unknown) => {
          if (origin !== remoteOrigin && origin !== initialOrigin) {
            sendUpdate("yjs-update", update);
          }

          schedulePersist();
        };

        yDoc.on("update", yDocUpdateHandler);

        channel
          .on("broadcast", { event: "yjs-update" }, ({ payload }) => {
            const message = payload as { clientId?: string; update?: string };

            if (message.clientId === clientId || !message.update) {
              return;
            }

            Y.applyUpdate(yDoc, decodeUint8Array(message.update), remoteOrigin);
          })
          .on("broadcast", { event: "cursor" }, ({ payload }) => {
            const message = payload as {
              clientId?: string;
              color?: string;
              selectionEnd?: number;
              selectionStart?: number;
              userName?: string;
            };
            const currentClientId = collaborationClientIdRef.current ?? clientId;

            if (
              !message.clientId ||
              message.clientId === currentClientId ||
              typeof message.selectionStart !== "number"
            ) {
              return;
            }

            const remoteClientId = message.clientId;
            const documentLength = editorView.state.doc.length;
            const selectionStart = clamp(message.selectionStart, 0, documentLength);
            const selectionEnd = clamp(message.selectionEnd ?? message.selectionStart, 0, documentLength);

            setRealtimeRemoteCursors((currentCursors) => [
              ...currentCursors.filter((cursor) => cursor.clientId !== remoteClientId),
              {
                clientId: remoteClientId,
                color: message.color ?? getCursorColor(remoteClientId),
                selectionEnd,
                selectionStart,
                updatedAt: Date.now(),
                userName: message.userName ?? (language === "en" ? "Collaborator" : "Colaborador"),
              },
            ]);
          })
          .on("broadcast", { event: "yjs-sync-request" }, ({ payload }) => {
            const message = payload as { clientId?: string };

            if (!message.clientId || message.clientId === clientId) {
              return;
            }

            sendUpdate("yjs-sync", Y.encodeStateAsUpdate(yDoc), message.clientId);
          })
          .on("broadcast", { event: "yjs-sync" }, ({ payload }) => {
            const message = payload as { clientId?: string; targetClientId?: string; update?: string };

            if (message.clientId === clientId || message.targetClientId !== clientId || !message.update) {
              return;
            }

            Y.applyUpdate(yDoc, decodeUint8Array(message.update), remoteOrigin);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              void channel.send({
                event: "yjs-sync-request",
                payload: { clientId },
                type: "broadcast",
              });
              sendCursor(latestSelectionRef.current);
            }
          });

        return () => {
          broadcastCursorRef.current = () => undefined;
          yDoc.off("update", yDocUpdateHandler);
          void supabase.removeChannel(channel);
        };
      } catch {
        if (cancelled) {
          return;
        }

        if (yText.length === 0) {
          yDoc.transact(() => {
            yText.insert(0, editorView.state.doc.toString());
          }, initialOrigin);
        }

        collaborationReadyRef.current = true;
        observeYText();
      }
    }

    let cleanupRealtime: (() => void) | undefined;
    void initializeCollaboration().then((cleanup) => {
      cleanupRealtime = cleanup;
    });

    return () => {
      cancelled = true;

      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
      }

      broadcastCursorRef.current = () => undefined;
      cleanupRealtime?.();
      if (isYTextObserved) {
        yText.unobserve(yTextObserver);
      }
      editorView.destroy();
      yDoc.destroy();
      editorViewRef.current = null;
      yDocRef.current = null;
      yTextRef.current = null;
      collaborationReadyRef.current = false;
    };
  }, [articleId, language, workspaceId]);

  useEffect(() => {
    const editorView = editorViewRef.current;
    const yDoc = yDocRef.current;
    const yText = yTextRef.current;

    if (!editorView || !yDoc || !yText || !collaborationReadyRef.current) {
      return;
    }

    if (yText.toString() === value) {
      return;
    }

    yDoc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, value);
    }, externalOrigin);
  }, [value]);

  useEffect(() => {
    editorViewRef.current?.dispatch({
      effects: setRemoteCursorsEffect.of(visibleRemoteCursors),
    });
  }, [visibleRemoteCursors]);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-full min-h-0" />
      <p className="sr-only">
        {language === "en" ? "Collaborative LaTeX editor" : "Editor LaTeX colaborativo"}
      </p>
    </div>
  );
});
