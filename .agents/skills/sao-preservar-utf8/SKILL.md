---
name: sao-preservar-utf8
description: Prevenir e diagnosticar acentos e símbolos corrompidos ao editar textos, código, JSON e documentação do SAO-NODE, especialmente com PowerShell no Windows.
---

# Preservar UTF-8 no SAO-NODE

Use ao alterar arquivos de texto deste projeto ou investigar letras corrompidas. Preserve acentos, símbolos, IDs e conteúdo existente. A checagem é preventiva e heurística; não garante ausência de todos os problemas de texto.

## Antes e durante a alteração

- Leia apenas os trechos relevantes, com codificação explícita. No Windows PowerShell, use `Get-Content -LiteralPath caminho -Encoding UTF8`; o padrão do Windows PowerShell 5.1 pode interpretar UTF-8 como ANSI.
- Diferencie falha de exibição do terminal de corrupção nos bytes do arquivo. Confira o arquivo com decodificação UTF-8 estrita e, quando necessário, a resposta da API e a tela afetada. Não regrave um arquivo apenas porque o terminal exibe caracteres estranhos.
- Prefira `apply_patch` para mudanças pontuais. Evite reescrever arquivos inteiros com pipelines `Get-Content | Set-Content`, redirecionamento `>` ou `Out-File` sem codificação definida. Os padrões diferem entre versões do PowerShell; `-Encoding UTF8` no PowerShell 5.1 inclui BOM.
- Se precisar gravar por script, use Node `readFile(path, 'utf8')` / `writeFile(path, text, 'utf8')`, ou .NET `UTF8Encoding(false, true)` para leitura estrita e escrita sem BOM. Preserve as quebras de linha existentes e o BOM de arquivos existentes quando exigido por seu formato; crie arquivos de código/texto em UTF-8 sem BOM.
- Nunca converta o arquivo inteiro de Latin-1/Windows-1252 para UTF-8 por tentativa, remova acentos ou aplique substituições globais de caracteres. Texto correto e corrompido podem coexistir. Corrija somente trechos confirmados pela referência, histórico ou contexto; caracteres de substituição podem indicar perda irreversível e exigem recuperar a fonte.
- Em JSON saoData, preserve IDs e referências; não normalize nomes, IDs ou o documento inteiro para reparar uma string. Siga o contrato vigente no `AGENTS.md`, inclusive compatibilidade v1/v2.

## Verificar antes de concluir

Execute o verificador desta skill, que apenas lê arquivos e retorna código 1 para bytes UTF-8 inválidos, caracteres de substituição ou sequências suspeitas de dupla conversão:

```powershell
node .agents/skills/sao-preservar-utf8/scripts/check-utf8.mjs apps/web/src/pages/EntityPage.jsx
```

O caminho do script acima considera a cópia versionada no SAO-NODE. Se ela não estiver disponível, use o caminho absoluto de `scripts/check-utf8.mjs` relativo à pasta desta skill. Caminhos de arquivos são relativos ao diretório de trabalho; não passe diretórios.

Para revisar os textos alterados e arquivos novos de todo o repositório:

```powershell
node .agents/skills/sao-preservar-utf8/scripts/check-utf8.mjs --changed
```

Esse modo usa Git e exclui dependências, artefatos, backups e lockfiles. Em worktree compartilhada, priorize a lista explícita dos arquivos da tarefa; `--changed` pode apontar problemas anteriores ou mudanças de outra pessoa.

- Revise cada alerta no trecho indicado. As sequências são indícios, não prova: citações de texto corrompido e exemplos de encoding podem ser intencionais. Não faça reparo automático nem ignore alertas sem justificativa verificável.
- Compare com o estado inicial para distinguir problemas existentes de regressões. Corrija regressões desta tarefa; relate problemas anteriores sem expandir o escopo automaticamente.
- Revise `git diff -- <arquivos alterados>` para detectar perda de acentos, mudanças de IDs e reescrita de linhas fora do escopo. Se o diff indicar reescrita ampla inesperada, investigue encoding e finais de linha antes de continuar.
- Se alterou texto exibido, verifique a tela ou a resposta relacionada quando disponível. Se o arquivo estiver correto e a saída estiver errada, siga apenas o caminho relevante de importação, persistência, serialização e charset. Não tente compensar dupla conversão no componente de UI.
- Informe a checagem executada e os alertas pendentes; não declare a verificação aprovada se restarem suspeitas sem explicação.
