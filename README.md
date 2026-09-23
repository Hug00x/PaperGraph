# PaperGraph

Aplicação Next.js para escrever artigos em LaTeX, compilar previews em PDF e organizar ligações entre artigos num mapa visual.

## Começar

Instala as dependências e arranca o servidor de desenvolvimento:

```bash
npm install
npm run dev
```

Depois abre [http://localhost:3000](http://localhost:3000) no browser.

Para metadata OpenAlex e relações semânticas locais com Ollama/BGE-M3 e pgvector, seguir o [guia de configuração, migration e testes](docs/semantic-search.md).

## Aplicação Windows

O instalador inclui o motor local de pesquisa. Na primeira abertura, o PaperGraph
descarrega automaticamente o modelo, mostra o progresso e permite continuar a usar
o editor e a biblioteca. Não é necessário instalar Ollama nem executar comandos.

Para desenvolver a aplicação desktop: `npm run desktop:dev` (inicia também o Next).
Para gerar o instalador: `npm run desktop:build`. O primeiro build descarrega o
runtime oficial com versão e checksum fixos. Ver [arquitetura, distribuição e
validação Windows](docs/bundled-runtime.md).

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
