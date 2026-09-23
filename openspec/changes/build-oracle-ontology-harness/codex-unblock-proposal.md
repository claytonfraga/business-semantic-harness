# Proposta para desbloquear `oracle codex`

## Diagnóstico observado

O teste funcional de 2026-09-23 no piloto terminou antes do primeiro turno. `src/agents/codex/doctor.ts` acrescenta incondicionalmente a razão “Fronteira de mutação do Codex ainda não verificada” e devolve `ready: false`; `src/cli.ts` apenas chama esse diagnóstico e encerra. O cliente JSON-RPC e o MCP existentes são protótipos parciais. O resultado não mede a capacidade do Codex de respeitar a ontologia.

## Decisão recomendada

Executar o Codex em modo somente leitura sobre uma **cópia limpa do projeto**. O agente consulta a ontologia por MCP e envia propostas de mudança ao Oracle. O Oracle prepara o patch em uma área isolada, verifica caminhos e hashes, traduz as ações representáveis em RDF, avalia SHACL e políticas humanas, mostra o diff e só promove a mudança após uma decisão válida. O Codex não recebe escrita direta no projeto aprovado. O projeto original e a ontologia aprovada permanecem intactos até a promoção.

SHACL verifica fatos modelados, mas não prova sozinho o significado de qualquer diff de código. Quando a ligação entre diff e ação de domínio não for demonstrável, o Oracle deve perguntar ao usuário; se a resposta não vier, a mudança não é promovida. Uma aprovação pontual fica vinculada ao hash do patch, aos argumentos, aos caminhos e ao snapshot da ontologia, e é consumida uma vez.

## Entregas em ordem

1. **Contrato e sessão.** Completar o cliente `codex app-server` com bindings da versão suportada, eventos, início/fim de turno, erro, cancelamento e entrada interativa. `oracle codex` passa a apresentar prompt e acompanhar a sessão quando os gates abaixo passarem.
2. **Fronteira de mutação.** Usar `readOnly` e negar elevação nativa. Isolar filesystem do processo agente no Linux; montar a cópia do piloto sem escrita direta e manter o broker Oracle fora dessa fronteira. Inventariar configuração efetiva e ferramentas disponíveis; impedir ou recusar sessão com MCPs, apps, navegador, Computer Use, tarefas externas ou caminhos mutáveis que escapem à mediação. Hooks servem para observação e diagnóstico, não para garantir bloqueio.
3. **Proposta transacional.** Adicionar uma ferramenta Oracle de proposta de patch, sem escrita direta na árvore do usuário. Rejeitar caminhos fora do projeto, links externos e mudanças em `.oracle/` não autorizadas. Aplicar na área isolada, produzir diff, representar efeitos de domínio com evidência e executar apenas verificações derivadas do OpenSpec após a implementação proposta. Em conflito ou incerteza, pedir decisão humana antes de promover. Auditoria deve persistir antes da promoção; falha de auditoria recusa a mudança.
4. **Diagnóstico baseado em capacidade.** Substituir o `ready: false` fixo por verificações observáveis: versão/protocolo, ontologia, MCP obrigatório, política `readOnly`, configuração efetiva, isolamento, canal do broker e tentativas controladas de escrita nativa, MCP não permitido e elevação. `doctor` informa exatamente qual gate falhou. Não liberar o comando apenas por reconhecer o número de versão.
5. **E2E funcional.** Rodar F1 e F2 do relatório do piloto, cada um em cópia limpa, por `oracle codex` dentro de `tmux` ou `herdr`. Guardar prompt, eventos, diff, SHACL, pergunta/resposta, auditoria e estado final. Testes unitários, integração e E2E são escritos após a implementação, derivados do OpenSpec e nomeados Given/When/Then.

## Critério para remover a recusa

`oracle codex` só inicia quando (a) o agente não consegue modificar arquivos do projeto por ferramenta nativa ou externa fora do broker, (b) o MCP Oracle e o canal de decisão estão disponíveis, (c) toda promoção de patch depende de avaliação, auditoria e decisão vinculada ao snapshot, e (d) a matriz adversarial confirma que uma ferramenta desconhecida, falha de IPC, hook ausente, mudança de argumentos ou falha de auditoria não produz efeito no projeto. Qualquer gate não comprovado mantém a recusa atual.

## Resultado esperado no piloto

- **F1 aderente:** o agente propõe histórico de transferências; Oracle apresenta diff e evidência, solicita revisão se a semântica não for demonstrável, e só promove uma versão que preserve bloqueio de ativo baixado, responsável e justificativa.
- **F2 contrário:** uma proposta para permitir transferência de ativo baixado sem responsável nem justificativa é identificada como conflito quando representável em RDF, ou como incerteza semântica; o usuário é consultado antes de qualquer promoção. Se negar, a cópia aprovada permanece intacta.

## Riscos a verificar

- A configuração de `thread/start` pode não remover ferramentas herdadas; confirmar por inspeção efetiva e tentativas adversariais na versão instalada.
- Ferramentas externas podem operar fora do sandbox nativo do Codex; isolar/desabilitar cada superfície ou recusar a sessão.
- Um diff pode esconder mudança semântica que SHACL não reconhece; revisão humana e verificação de comportamento continuam necessárias.

Esta proposta detalha as tarefas OpenSpec 4.1–4.4, 6.3–6.5, 7.1–7.2 e 7.7. Não altera o gate atual até que esses critérios sejam demonstrados.
