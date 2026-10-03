# language: pt
# Fontes: src/tui/render.ts; src/tui/ansi.ts; src/tui/session.ts; test/tui/render.test.mjs; test/tui/session-advanced-ux.test.mjs; openspec/changes/ergonomic-tui-queue-and-shortcuts; openspec/changes/enhanced-ux-streaming-and-implementation-receipt; test/features/journeys/jornada-12-ux-avancada-raciocinio-diff-multilinha-fuzzy.feature
@bsh @tui
Funcionalidade: Layout responsivo e feedback da sessão

  Como um usuário da TUI
  Eu quero acompanhar conversa, ferramentas e mudanças sem corromper a tela
  Para entender o resultado real da execução

  @BSH-TUI-001 @specified @gap
  Cenário: Renderizar interface em inglês
    Dado uma sessão interativa
    Quando menus, modais, cabeçalhos, rodapés, alertas e mensagens de sistema são exibidos
    Então os textos do produto devem estar em inglês
    E identificadores literais do domínio devem ser preservados
    E a especificação Gherkin deve permanecer em português

  @BSH-TUI-002
  Cenário: Separar contexto de telemetria
    Dado uma sessão com modelo, projeto, branch e domínio
    Quando a TUI renderiza o layout
    Então o cabeçalho deve mostrar marca, governança, projeto, branch, ontologia e skill ativa
    E o rodapé deve mostrar modelo, contexto, tokens, custo, duração, TPS, fila e atalhos
    E dados estáticos não devem ser duplicados no rodapé

  @BSH-TUI-003
  Cenário: Manter dimensões da tela
    Dado um terminal com largura e altura suportadas
    Quando há mensagens longas, blocos de código, cards e redimensionamento
    Então cada linha deve permanecer na largura visível da tela
    E o quadro deve ocupar a altura configurada
    E cabeçalho, conversa, entrada e rodapé devem ajustar sua disposição à largura real disponível
    E estilos e quebra de texto devem ser gerenciados pelos componentes OpenTUI
    E a TUI não deve impor uma largura mínima superior à tela nem ocultar controles obrigatórios por truncamento

  @BSH-TUI-004
  Cenário: Mostrar contexto ontológico
    Dado um domínio selecionado
    Quando o cabeçalho é renderizado
    Então deve mostrar identificador, versão disponível, classes e shapes
    E deve distinguir "GOVERNED", "UNGOVERNED" e "DOMAIN MISMATCH"
    E ausência de domínio deve aparecer como "none (inactive)"

  @BSH-TUI-005
  Cenário: Exibir conversa e ferramentas em streaming
    Dado conteúdo incremental do modelo e chamadas de ferramentas
    Quando os eventos chegam
    Então a conversa deve ser atualizada durante a execução
    E invocações e resultados de ferramentas devem possuir identificação visual
    E argumentos longos devem ser resumidos sem exceder a largura

  @BSH-TUI-006
  Cenário: Apresentar recibo de implementação real
    Dado mudanças reais no Git diff da sessão
    Quando o turno termina
    Então o recibo deve listar arquivos com linhas adicionadas e removidas
    E deve apresentar totais consolidados
    E deve distinguir gravação no workspace de promoção para a origem

  @BSH-TUI-007
  Cenário: Apresentar diagnóstico sem gravação
    Dado que o turno não alterou arquivos
    Quando o resultado é renderizado
    Então deve indicar leitura ou diagnóstico
    E não deve informar implementação realizada

  @BSH-TUI-008 @specified @gap
  Cenário: Atualizar preview incremental de diff
    Dado que o agente modifica arquivos em múltiplas chamadas
    Quando "write_file" ou "replace_file_content" termina com sucesso
    Então um preview deve mostrar as estatísticas atuais do diff
    E deve atualizar o card existente
    E ao terminar o turno o preview deve ser substituído pelo recibo final

  @BSH-TUI-009
  Cenário: Recolher raciocínio por padrão
    Dado que o provedor emite conteúdo de raciocínio
    Quando a entrada é exibida
    Então deve iniciar recolhida em resumo de uma linha com estimativa de tokens e duração
    E "Ctrl+O" deve alternar a visibilidade do bloco mais recente
    E a altura do quadro deve permanecer invariável

  @BSH-TUI-010 @specified @gap
  Cenário: Mostrar telemetria de geração
    Dado um turno em execução ou concluído
    Quando o rodapé é atualizado
    Então deve apresentar duração e taxa de tokens por segundo
    E estimativas devem ser distinguíveis de métricas reais retornadas pelo provedor
    E tokens e custo não devem ser apresentados como medidos quando são valores fixos

  @BSH-TUI-011
  Cenário: Limpar feed
    Dado mensagens exibidas na sessão
    Quando o usuário executa "/clear"
    Então o feed e o deslocamento do viewport devem ser reiniciados
    E a sessão, configuração e recursos ativos devem permanecer utilizáveis

  @BSH-TUI-012 @specified @gap
  Cenário: Consultar ajuda e regras reais
    Dado uma sessão com domínio ativo
    Quando o usuário executa "/help" ou "/rules"
    Então deve visualizar comandos disponíveis ou restrições do domínio selecionado
    E sem domínio deve receber indicação de governança inativa
    E regras fixas de demonstração não devem substituir as shapes do domínio real

  @BSH-TUI-013 @specified @gap
  Cenário: Revisar diff antes da promoção
    Dado mudanças no workspace
    Quando o usuário executa "/diff"
    Então deve ver diff colorido e indicação de truncamento quando aplicável
    E violações devem impedir a oferta de promoção
    E confirmação de promoção deve usar resposta afirmativa explícita com padrão negativo
    E a mensagem final deve refletir o resultado efetivo da integração
