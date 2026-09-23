# Regras de execução do Oracle

- Use `/usr/bin/rtk` em comandos de terminal.
- Em testes funcionais E2E do Oracle, abra `oracle codex` a partir da pasta do piloto em uma sessão persistente `tmux` ou `herdr`. O processo do agente deve receber solicitações reais e tentar modificar uma cópia limpa do piloto; chamadas HTTP diretas ao servidor não substituem esse teste.
- Execute pelo menos dois casos especificados antes do teste: uma mudança de código aderente à ontologia/SHACL e uma mudança que contrarie uma regra. Compare o estado inicial, as ações propostas, perguntas ao usuário, decisões, arquivos finais e auditoria.
- Valide a ontologia antes da sessão. Se `oracle codex` recusar iniciar, registre o diagnóstico e marque ambos os casos como **bloqueados antes do primeiro turno**; não chame isso de teste funcional aprovado e não use Codex direto como substituto.
- Guarde um relatório datado em `pilot/asset-management/evaluation/` com os prompts, procedimento, evidências, resultados esperados/observados, limitações e correções propostas. Encerre a sessão persistente após coletar as evidências.
- Derive qualquer teste automatizado novo apenas do OpenSpec, depois da implementação, com nomes no formato Given/When/Then. Não use TDD.
