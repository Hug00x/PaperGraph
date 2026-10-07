# Local conversations

“Ask Papergraph” opens with Local selected. The Electron preload exposes fixed chat, cancel and progress messages; the main process validates the sender, bounds inputs and owns the Ollama requests. The browser has no arbitrary Ollama URL, model name or command access.

The conversation model is `qwen3:4b`, separate from the `bge-m3` embedding model. On the first question, Papergraph checks the managed runtime and downloads the conversation model if missing, with progress and cancellation. Its published download is approximately 2.5 GB. Subsequent conversations reuse the downloaded model. Documents are sent to the owned loopback Ollama process, not Anara; the initial model download requires internet. There is no cloud fallback.

Selected articles provide LaTeX source or PDF text. When the PDF asset is accessible through the existing asset route, PDF.js reads up to 150 pages / 300,000 characters with page labels. An unavailable PDF falls back to the previously imported text (at most three pages), and metadata-only recommendations provide the abstract. Scanned images, figures and external LaTeX includes are not interpreted. Coverage is shown under Sources used and supplied to the model so it can explain limitations.

Long documents retain opening, ending and question-relevant excerpts within a shared 36,000-character budget. Follow-ups include recent complete conversation exchanges within a 20,000-character budget. The prompt requests answers grounded in the documents, adapted Markdown structure, references to article/page labels and a distinction between evidence and inference. These instructions reduce unsupported claims but cannot guarantee model accuracy.

The conversation stays in renderer memory when switching modes or closing/reopening the same drawer. Changing selected context starts a new conversation. Questions and responses are not persisted or broadcast to collaborators. Streaming output is rendered as escaped React text with headings, lists, emphasis, code and tables; raw HTML is never executed. Stop aborts the local generation request; partial output is marked incomplete and is excluded from follow-up history.

Validation: `npm run test:local-chat`, `npm run test:local-chat:browser` (with a dev server at port 3015), TypeScript and scoped lint. The browser fixture mocks the Electron chat bridge; backend tests mock Ollama HTTP responses. These verify context selection, streaming, history, cancellation and rendering, not live model quality or real model download speed.
