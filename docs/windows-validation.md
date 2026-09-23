# Validação Windows — 23 de setembro de 2026

Build: PaperGraph 0.1.2, Electron 43.2.0, Ollama 0.34.3, BGE-M3.
Ambiente: Windows 11 existente, com Ollama global também instalado. Não havia
Windows Sandbox/VM limpa disponível. Os perfis, homes e modelos dos testes são
isolados e o motor recebe um PATH sem a instalação global.

| Cenário | Resultado e alcance |
| --- | --- |
| A — primeira utilização sem modelo | Passou na aplicação empacotada com perfil vazio: download automático, estados visíveis e vetor real 1024. Não equivale a um Windows limpo sem Ollama instalado. |
| B — segunda execução | Passou: zero pull/download e modelo validado. |
| C — sem Internet/modelo | Falha de rede injetada no download com runtime real: estado offline e retry passaram. Não foi desligada a rede do Windows nem testada a UI sem rede física. |
| D — download interrompido | Passou: encerrado durante um pull real, reaberto, download recuperado e vetor validado. |
| E — coexistência global | Passou: serviço global 11434 acessível antes/depois; runtime privado usa outro PID, porta e modelos. |
| F — fechar/reabrir e crash | Passou: dois arranques desktop com encerramento normal; crash do proprietário no teste de integração deixou de ter servidor a escutar. |
| G — atualização/reutilização | Passou a substituição dos binários por novo build com o mesmo perfil, sem download. Não foi executada uma release publicada através de electron-updater. |
| H — instalação/reinstalação/desinstalação | Passou com identidade separada: runtime instalado e removido, modelo e registos da instalação pessoal preservados. Resultado em `.utmp/nsis-validation-result.json`. |

## Verificações

- `npm run build`: compilação e TypeScript passaram no fluxo `desktop:build`.
- `npm run lint`: passou.
- `npm run test:semantic`: 22 testes passaram.
- `npm run test:runtime`: 6 testes passaram.
- `scripts/test-bundled-runtime.cjs`: runtime real, download e segundo arranque.
- `scripts/test-runtime-lifecycle.cjs`: interrupção, recuperação, falha de rede
  controlada, crash e coexistência. Resultado: `.utmp/runtime-lifecycle-result.json`.
- `scripts/test-packaged-runtime.cjs`: app empacotada, preload/IPC, componente
  React, arranques e encerramento da janela. Resultado inicial:
  `.utmp/packaged-profile/first-install-result.json`; após novo build:
  `.utmp/packaged-profile/result.json`.
- `scripts/verify-desktop-bundle.cjs`: checksum, supervisor fora do asar,
  licenças, modelo ausente do pacote e nenhuma chave privada do ambiente de
  build encontrada em 1174 ficheiros analisados, incluindo o asar.
- `scripts/test-nsis-install.ps1`: instalação, reinstalação e desinstalação reais
  da variante isolada passaram; runtime removido, modelo e instalação pessoal
  preservados. A associação `papergraph://` usada durante o smoke test foi reposta
  para o executável da instalação pessoal.

Instalador final: `desktop-dist/PaperGraph-Setup-0.1.2.exe`, 1 525 199 377 bytes
(aproximadamente 1,53 GB). O comando `npm run desktop:build` terminou com código 0.

O teste do pacote valida a inferência pelo pedido de readiness, sem entrar numa
conta nem modificar artigos pessoais. Os testes de regressão cobrem o cliente de
embeddings e a lógica semântica existente.

## Instalação sem afetar a cópia pessoal

Uma variante de aceitação usa os mesmos recursos e opções NSIS, alterando apenas
identidade, nome, publicação e atalhos/protocolos:

```powershell
npx.cmd electron-builder --win nsis --prepackaged desktop-dist/win-unpacked --config scripts/installer-validation.config.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-nsis-install.ps1
```

O teste usa `com.papergraph.installer-validation` e instala exclusivamente dentro
de `.utmp/installed-validation`. Verifica instalação/reinstalação, remoção do
runtime, preservação do manifesto do modelo fora dessa pasta e manutenção dos
registos da instalação pessoal. Não lança a aplicação nem altera o protocolo de
produção. Não substitui a aceitação do instalador de produção numa VM.

## Aceitação ainda pendente

Numa VM/PC Windows suportado sem Ollama/modelos: instalar o executável de produção,
abrir com Internet, aguardar progresso/pronto, importar artigos e confirmar
relações; repetir sem Internet/modelo; atualizar por uma release de teste e
desinstalar. A implementação elimina a instalação e o `ollama pull` manuais, mas
não se afirma que este ensaio em máquina limpa já foi feito.

O executável gerado não tem assinatura Authenticode. Não foi configurado um
certificado nem publicada uma release nesta tarefa.
