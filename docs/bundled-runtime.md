# Pesquisa semântica integrada no Windows

## Arquitetura

Mantém Electron, Next.js standalone, React/TypeScript, electron-builder/NSIS e
electron-updater. O processo principal controla uma única instância de
`OllamaManager`; o single-instance lock existente impede um motor por janela.
O Next arranca primeiro e a janela aparece antes de o motor ser preparado.

O fluxo de artigos continua PDF → título/DOI/abstract → metadata OpenAlex →
BGE-M3 → pgvector. O modelo, vetores de 1024 dimensões, normalização, hashes,
schema e limiar semântico de 50% não mudam. Não é necessário regenerar embeddings
existentes nem executar uma nova migration por causa do runtime.

## Localizações e configuração

| Elemento | Localização |
| --- | --- |
| Runtime instalado | `resources/ollama/ollama.exe` e todas as dependências do ZIP oficial |
| Runtime de desenvolvimento | `build/ollama/` |
| Supervisor Windows | `resources/app.asar.unpacked/electron/ollama-guardian.ps1` |
| Modelos | `%LOCALAPPDATA%\PaperGraph\ollama\models` |
| Home privado do runtime | `%LOCALAPPDATA%\PaperGraph\ollama\home` |
| Log de estados | `%LOCALAPPDATA%\PaperGraph\ollama\runtime.log` |
| Configuração fixa | `electron/embedding-runtime-config.json` |

Versão incluída: **Ollama 0.34.3, Windows x64**.
Origem: `https://github.com/ollama/ollama/releases/download/v0.34.3/ollama-windows-amd64.zip`.
SHA-256 publicado do ZIP:
`306ce9e81e3491d147f558e60d7a389499f244d10f71859c6e4e899241d1b4ae`.

O build descarrega e verifica o ZIP antes de extrair, rejeita paths inseguros,
preserva as bibliotecas e notices, e grava um manifesto com versão e checksum.
Não acompanha `latest` automaticamente. Para atualizar o runtime, alterar versão
e checksum juntos e repetir a validação. O modelo não está no instalador.

## Arranque, isolamento e encerramento

- Executa o binário por caminho absoluto; não consulta Ollama no PATH.
- Usa apenas `127.0.0.1`, preferindo 11435. Se ocupada, escolhe uma porta livre;
  nunca reutiliza nem mata um servidor desconhecido.
- Passa `OLLAMA_HOST`, `OLLAMA_MODELS` e `OLLAMA_NO_CLOUD=1` só ao processo criado.
  O ambiente herdado é reduzido e não inclui chaves Supabase.
- Confirma `/api/version`, versão esperada e PID proprietário da porta antes de
  utilizar o servidor. Há timeout e polling, não uma espera fixa presumindo sucesso.
- Confirma `bge-m3` ou `bge-m3:latest` em `/api/tags`. Se ausente, usa
  `POST /api/pull` com streaming; depois confirma novamente os modelos e testa
  `/api/embed` com texto genérico e um vetor válido de 1024 dimensões.
- Um supervisor oculto acompanha o PID do Electron. Um Windows Job Object
  agrupa exclusivamente o runtime e descendentes. Fechar normalmente termina a
  árvore por PID; um crash do Electron faz o supervisor fechar o Job Object.
  Não existem PIDs persistidos que possam ser confundidos com processos futuros.
- Não instala serviços, tarefas de arranque, regras de firewall, dependências
  globais ou alterações ao PATH. Não altera a pasta `.ollama` do utilizador.

O Next recebe um endereço loopback privado escolhido pelo main e um token
aleatório. Esse intermediário permite apenas embeddings do modelo fixo; o
renderer não recebe token, caminhos de executáveis ou comandos. O preload expõe
apenas estado, subscrição e retry. O main valida janela, frame e origem. Mantém
`contextIsolation`, sandbox e `nodeIntegration: false`.

## Primeira utilização e falhas

A interface mostra preparação, download, pronto ou erro, sem exigir conhecimento
do runtime. Os bytes e percentagem vêm dos valores `completed`/`total` recebidos
na API, não de um temporizador. IPC transporta esses estados até ao React.

O download tem timeout de duas horas e deteta streams paradas durante três
minutos. Uma falha apresenta retry; não entra num ciclo infinito de downloads.
Editor, PDF e biblioteca continuam disponíveis. Pedidos de embeddings durante
preparação falham prontamente com uma mensagem específica.

Ao interromper um download, o próximo arranque consulta o estado real do modelo
e deixa o Ollama retomar/recomeçar os ficheiros parciais. Não existe uma flag
`modelInstalled`. A segunda execução e uma atualização reutilizam os modelos
válidos, sem novo pull. A preparação ainda inclui arranque e aquecimento do motor;
não é garantido que seja instantânea em todos os computadores.

## Packaging e dados

`npm run desktop:build` executa build Next, prepara runtime/standalone e produz
NSIS em `desktop-dist`. `npm run desktop:dev` gere o mesmo motor e arranca o Next
local. `npm run dev` mantém o modo web de desenvolvimento explicitamente separado.

O ZIP oficial inclui bibliotecas de CPU e GPU, pelo que o instalador é grande
mesmo sem o modelo. A primeira utilização exige Internet e espaço para BGE-M3.
Requisitos upstream: Windows 10 22H2 ou posterior, x64; aceleração depende do
hardware/drivers existentes. Não são instalados drivers.

O uninstaller remove `resources/ollama` juntamente com a aplicação. Os modelos
em LocalAppData são **preservados** (`deleteAppDataOnUninstall: false`), permitindo
reinstalação sem download. Quem pretender libertar esse espaço pode remover
explicitamente `%LOCALAPPDATA%\PaperGraph\ollama` depois de fechar/desinstalar a
aplicação. Atualizações substituem binários, não essa pasta de dados.

O empacotamento exclui `.env.local` e chaves administrativas. Só escreve uma
`.env.production` com URL/chave pública Supabase e URL pública de confirmação,
lidas do ambiente de build ou `.env.local`. Não é necessário distribuir esse
ficheiro de desenvolvimento nem configurar Ollama nos computadores dos utilizadores.

A inferência continua local. O armazenamento/sincronização Supabase e a consulta
de metadata OpenAlex já existentes mantêm-se; não foi acrescentado um serviço
externo de inferência nem upload para Ollama Cloud.

## Licenças

Ollama tem licença MIT e a documentação oficial descreve o ZIP standalone para
integração em aplicações. A licença MIT não cobre automaticamente CUDA ou os
runtimes Microsoft. O pacote preserva as licenças/notices upstream e acrescenta
os documentos CUDA/Microsoft identificados em [notices](runtime-notices.md).
Os componentes NVIDIA são usados pela funcionalidade local da aplicação e
continuam sujeitos aos seus termos de distribuição e uso; não são relicenciados.

Fontes oficiais consultadas:

- https://docs.ollama.com/windows
- https://github.com/ollama/ollama/blob/v0.34.3/LICENSE
- https://docs.ollama.com/api/pull
- https://docs.nvidia.com/cuda/archive/12.8.1/eula/index.html
- https://docs.nvidia.com/cuda/archive/13.0.0/eula/index.html
- https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/

## Validação reproduzível

`npm run test:runtime`: portas ocupadas, modelo correto, streaming fragmentado,
bytes reais, EOF incompleto, retry, modelo existente/invalidado e autenticação do
intermediário. `npm run test:semantic`: regressões do fluxo semântico existente.

`node scripts/test-bundled-runtime.cjs` usa o executável real numa pasta inicialmente
vazia em `.utmp`, descarrega BGE-M3, gera um embedding real e repete o arranque sem
download. Não utiliza a instalação global nem os seus modelos.

`node scripts/test-runtime-lifecycle.cjs` testa uma falha de rede injetada no
download com runtime real, interrompe um pull real após receber bytes, reabre e
confirma recuperação, termina abruptamente o processo proprietário e verifica que
o servidor desaparece. Confirma ainda que o serviço global 11434 continua acessível.
O teste de interrupção exige `.utmp/ollama-interrupted-test` inicialmente vazia.

Os testes isolados no Windows do desenvolvimento não equivalem a uma VM Windows
limpa. Consultar o [registo de validação](windows-validation.md) para distinguir
testes executados de testes de aceitação ainda pendentes.
