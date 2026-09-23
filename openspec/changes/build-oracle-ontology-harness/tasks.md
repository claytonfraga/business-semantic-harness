## 1. Base do projeto e formato

- [x] 1.1 Criar pacote TypeScript para Node.js 22, CLI `oracle` e testes; verificar compilação, execução de `oracle --help` e testes básicos.
- [x] 1.2 Publicar vocabulário Oracle versionado e exemplos JSON-LD/SHACL de `ativos`; verificar parsing RDF e validação SHACL do exemplo válido e de um exemplo inválido.
- [x] 1.3 Implementar `oracle init` e `oracle domain add`; verificar geração sem sobrescrita. A recusa de `oracle codex` enquanto o projeto não tem domínios válidos é coberta por 4.4.
- [x] 1.4 Empacotar o executável Linux `oracle` com shebang e modo executável para `npm install -g` e `npx`; verificar tarball, instalação em prefixo temporário, execução por npx e uso em codebase externo.

## 2. Carregamento e consulta

- [x] 2.1 Implementar descoberta do projeto, manifesto e caminhos canônicos; testar ausência, duplicidade e escape por caminho.
- [x] 2.2 Implementar verificação de todos os domínios, carregamento JSON-LD, SHACL, versões, integridade e prontidão; testar domínio faltante, grafo malformado, IRI duplicado, referência local inválida, domínio vazio e violação de shape.
- [x] 2.3 Implementar `oracle ontology validate/show` e retrato imutável por sessão; verificar saída com fonte/IRI e detecção de alteração do retrato.

## 3. Decisão e registro

- [x] 3.1 Implementar representação RDF de ações e avaliador SHACL; testar conformidade, violação, falta de fatos e ação opaca contra cenários dos specs.
- [x] 3.2 Implementar broker de aprovação vinculado a hash de ação e ontologia; testar permitir uma vez, negar, timeout e mudança de argumentos.
- [x] 3.3 Implementar trilha JSONL local, redação de segredos e falha fechada de gravação; testar consulta de decisão, segredo redigido e armazenamento indisponível.

## 4. Adaptador Codex

- [ ] 4.1 Implementar contrato de adaptador e cliente `codex app-server` por stdio; verificar handshake, thread, eventos, solicitações nativas e cancelamento com testes de protocolo.
- [ ] 4.2 Implementar servidor MCP local obrigatório para consulta ontológica e proposta explícita; verificar respostas por domínio/IRI e falha de abertura de sessão quando o MCP não inicia.
- [ ] 4.3 Implementar ferramentas MCP Oracle para mutações mediadas pelo broker, além de hooks `PreToolUse`/`PostToolUse` para observação; testar permissão após resposta, negativa, timeout, perda de IPC, elevação nativa negada e ferramenta mutável não suportada antes de efeitos.
- [ ] 4.4 Implementar `oracle codex` e `oracle doctor`; verificar contexto inicial, MCP obrigatório, isolamento `readOnly`, recusa de bypass e diagnóstico de Codex indisponível. Só iniciar sessão governada após comprovar a fronteira de mutação na versão instalada.
- [ ] 4.5 Implementar `oracle agy` para Google Antigravity CLI (executável `agy`) sobre o mesmo núcleo e ontologias; verificar protocolo, contexto, eventos, decisões, cancelamento e recusa de sessão quando uma superfície mutável não puder ser mediada.

## 5. Conhecimento e revisão

- [ ] 5.1 Implementar propostas com evidência a partir de eventos e ferramenta explícita; testar candidato sustentado e afirmação sem evidência.
- [ ] 5.2 Implementar `oracle proposals list/show/accept/reject` com escrita atômica e revalidação; testar aceitação, rejeição, conflito e preservação da ontologia anterior.
- [ ] 5.3 Implementar `oracle sessions list/show` e retomada segura; testar trilha legível, revalidação e ausência de reutilização de aprovação pendente.

## 6. Projeto piloto e medição

- [x] 6.1 Criar `pilot/asset-management/` como aplicação web mínima independente com testes de transferência, baixa e responsável; verificar que seus testes passam sem Oracle.
- [x] 6.2 Criar manifesto, JSON-LD e SHACL próprios do piloto, incluindo regra de transferência e política textual; verificar com `oracle ontology validate --project pilot/asset-management` e casos RDF válidos/inválidos.
- [ ] 6.3 Versionar quatro casos P1–P4 com estado inicial, prompt, gabarito e verificadores de efeito/evento; verificar que cada caso falha diante de uma saída deliberadamente errada.
- [ ] 6.4 Implementar `oracle eval run --mode contract` em cópias isoladas; verificar que não chama o modelo, não altera o piloto original e produz métricas para permissão, bloqueio, pergunta e proposta.
- [ ] 6.5 Implementar `oracle eval run --mode live` nas condições A/B/C e `oracle eval report`; verificar registro de versões, hashes, três repetições, interrupções e métricas indisponíveis com causa.

## 7. Verificação ponta a ponta

- [ ] 7.1 Executar cenário com projeto piloto válido: contexto entregue, consulta de conceito, ação conforme, conflito perguntado ao usuário e decisão auditada; guardar evidência automatizada do fluxo.
- [ ] 7.2 Executar matriz de falha com ontologia ausente, hook não confiável, ferramenta desconhecida, IPC interrompido e disco indisponível; verificar que nenhuma ação mutável avança sem decisão válida.
- [ ] 7.3 Executar avaliação de contrato e, quando Codex estiver autenticado, a avaliação real; publicar relatório JSON/Markdown com contagens, denominadores, casos individuais e limitações observadas.
- [ ] 7.4 Documentar instalação, criação de ontologia por domínio, limites da análise semântica e atualização de versão do Codex; verificar comandos do guia em ambiente limpo.
- [ ] 7.5 Executar os casos do piloto com Agy em uma rodada separada e registrar versão, modelo, resultados e limitações sem misturá-los ao relatório A/B/C do Codex.
- [x] 7.6 Definir a regra de teste funcional E2E em `tmux` ou `herdr`, especificar casos aderente e contrário à ontologia e registrar a tentativa inicial de `oracle codex` com seu bloqueio antes do primeiro turno.
- [ ] 7.7 Após comprovar a fronteira de mutação, executar os dois casos funcionais com `oracle codex` em cópias limpas do piloto; verificar ações, decisões humanas, arquivos finais e auditoria com evidência reproduzível.
