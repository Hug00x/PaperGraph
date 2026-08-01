# PaperGraph

Aplicação Next.js para escrever artigos em LaTeX, compilar previews em PDF e organizar ligações entre artigos num mapa visual.

## Começar

Instala as dependências e arranca o servidor de desenvolvimento:

```bash
npm install
npm run dev
```

Depois abre [http://localhost:3000](http://localhost:3000) no browser.

## Estrutura Principal

- `src/app/page.tsx`: estado principal da área de trabalho e navegação.
- `src/components/editor-pane.tsx`: editor LaTeX e preview PDF.
- `src/components/graph-pane.tsx`: mapa de artigos e ligações.
- `src/app/api/workspace/route.ts`: leitura/escrita do workspace.
- `src/app/api/compile/route.ts`: compilação LaTeX para PDF.

## Funcionalidades

- rascunhos antes da submissão;
- editor LaTeX com autosave;
- compilação de PDF;
- wikilinks no formato `[[Artigo]]` ou `[[Artigo|texto visível]]`;
- mapa com ligações explícitas e manuais;
- deteção de menções não ligadas;
- layout do graph persistido.
