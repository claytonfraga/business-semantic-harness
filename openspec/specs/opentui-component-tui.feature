# language: pt
# Sources: AGENTS.md; openspec/config.yaml; openspec/changes/rebuild-tui-with-opentui/design.md
# Baseline: 2afc270; existing capability features and journey plans.

@opentui @specified
Funcionalidade: Reconstrução integral da TUI com componentes OpenTUI
  Como usuário do BSH
  Quero manter os comportamentos implementados em uma TUI composta com OpenTUI
  Para utilizar a interface sem componentes de terminal construídos manualmente

  @BSH-OPENTUI-001
  Cenário: Usar os arquivos feature como fonte da verdade
    Dado que os requisitos comportamentais estão em "openspec/specs/*.feature"
    Quando código, testes ou documentos Markdown divergirem desses requisitos
    Então os arquivos feature devem determinar os critérios de aceitação
    E as divergências devem ser registradas e conciliadas explicitamente
    E as jornadas em "test/features/journeys" devem permanecer planos de execução desses requisitos

  @BSH-OPENTUI-002
  Cenário: Atualizar o requisito antes de mudar o comportamento
    Dado que uma mudança necessária altera um requisito aceito
    Quando a alteração for implementada
    Então o arquivo feature correspondente deve ter sido atualizado previamente
    E os identificadores estáveis e as referências de rastreabilidade devem permanecer consistentes
    E os testes novos devem ser derivados dos requisitos depois da implementação

  @BSH-OPENTUI-003
  Cenário: Substituir todas as superfícies interativas manuais
    Dado que a sessão possui cabeçalho, conversa, rodapé, entrada, menus e diálogos
    Quando a reconstrução for concluída
    Então todas essas superfícies devem ser compostas com componentes suportados do OpenTUI
    E o OpenTUI deve controlar disposição, renderização, foco, rolagem, entrada e redimensionamento
    E não deve existir um renderizador interativo paralelo com quadros ANSI, bordas ou posicionamento de cursor escritos à mão
    E não devem existir widgets interativos implementados com readline bruto

  @BSH-OPENTUI-004
  Cenário: Preservar o contrato comportamental implementado
    Dado o estado do projeto no commit "2afc270"
    Quando cada fluxo da TUI for migrado
    Então comandos, atalhos, estados e resultados implementados devem ser preservados
    E somente a construção manual da interface deve ser substituída
    E requisitos marcados como lacunas ou históricos devem ser conciliados explicitamente antes de mudar o comportamento

  @BSH-OPENTUI-005
  Cenário: Preservar a paleta e todos os seletores
    Dado os requisitos de "menu-de-comandos-barra.feature" e "model-and-domain-selection.feature"
    Quando o usuário abrir a paleta ou os seletores de modelos, domínios e skills
    Então os componentes OpenTUI devem preservar filtros, navegação, seleção, cancelamento e persistência aplicáveis
    E o catálogo de comandos e a identidade visual por categoria devem ser preservados

  @BSH-OPENTUI-006
  Cenário: Preservar entrada e controle de execução
    Dado os requisitos de "tui-input-history-and-navigation.feature"
    Quando o usuário editar, enviar, enfileirar, recuperar ou cancelar uma entrada
    Então a TUI deve preservar histórico, fila FIFO, entrada multilinha e atalhos implementados
    E a proteção de saída e a interrupção do agente devem manter seus estados e prioridades

  @BSH-OPENTUI-007
  Cenário: Preservar apresentação e atualização da conversa
    Dado os requisitos de "tui-layout-and-feedback.feature"
    Quando o agente produzir texto, raciocínio, chamadas de ferramentas ou resultados
    Então a conversa deve atualizar progressivamente usando componentes OpenTUI
    E deve preservar rolagem, indicadores, raciocínio recolhível, diferenças e recibos implementados
    E o cabeçalho e o rodapé devem refletir o estado vigente da sessão

  @BSH-OPENTUI-008
  Cenário: Preservar governança e consentimento
    Dado uma sessão com domínio, regras semânticas e política de confirmação
    Quando o usuário trocar domínio, alternar governança, confirmar uma ação ou promover mudanças
    Então a TUI deve manter as decisões e os serviços de governança existentes
    E deve preservar alertas de afinidade, confirmações, cancelamento e evidências aplicáveis
    E a troca do renderizador não deve conceder aprovação nem desabilitar verificação implicitamente

  @BSH-OPENTUI-009
  Cenário: Abranger autenticação e diálogos auxiliares
    Dado que a sessão requer autenticação, configuração ou um diálogo auxiliar
    Quando o usuário interagir com credenciais, configurações, ajuda, regras, afinidade ou diferenças
    Então a superfície interativa deve usar componentes OpenTUI
    E deve preservar ocultação de credenciais, resultados, cancelamento e persistência implementados
    E mensagens e rótulos da interface devem estar em inglês

  @BSH-OPENTUI-010
  Cenário: Restaurar o terminal e liberar recursos
    Dado que a TUI possui renderizador, foco, conexões e recursos de sessão ativos
    Quando ocorrer saída normal, cancelamento ou falha
    Então o ciclo de vida OpenTUI deve restaurar o terminal e destruir o renderizador
    E a sessão deve liberar conexões e recursos conforme os requisitos existentes
    E redimensionamentos não devem perder entrada, seleção ou histórico de conversa

  @BSH-OPENTUI-011
  Cenário: Preservar a execução não interativa
    Dado que o BSH oferece comandos CLI e execução headless
    Quando um comando não interativo for executado
    Então não deve inicializar o renderizador OpenTUI
    E os contratos de argumentos, saídas e códigos de retorno devem permanecer preservados

  @BSH-OPENTUI-012
  Cenário: Validar compatibilidade de runtime e distribuição
    Dado que o pacote declara Node 22 ou superior e distribuição por npm
    E que a versão candidata do OpenTUI possui requisitos próprios de runtime e bibliotecas nativas
    Quando a dependência e o lançador da TUI forem integrados
    Então instalação e execução devem ser verificadas com o produto empacotado
    E qualquer mudança necessária no runtime suportado deve ser explicitada nos requisitos antes da implementação
    E a incompatibilidade não deve ser ocultada por uma TUI manual de contingência
    E Node 22 deve permanecer o lançador dos comandos CLI não interativos
    E a TUI deve executar com Bun "1.4.2" instalado como dependência local do pacote npm
    E não deve exigir uma instalação global separada de Bun
    E a ausência do runtime nativo deve produzir diagnóstico acionável em inglês
    E o lançador deve preservar diretório, ambiente, projeto, modelo, domínio, fluxos do terminal, sinais e código de saída

  @BSH-OPENTUI-013
  Cenário: Demonstrar conformidade antes de declarar a migração concluída
    Dado uma matriz ligando os requisitos atuais às superfícies migradas
    Quando a migração for avaliada
    Então cada requisito aplicável deve ter evidência de preservação ou divergência explicitamente conciliada
    E os testes novos devem seguir Given/When/Then e ser derivados dos arquivos feature
    E as jornadas devem ter sido planejadas previamente em arquivos feature
    E a execução funcional deve usar o BSH empacotado e seguir a política vigente de evidências
    E cenários bloqueados ou não executados não devem ser apresentados como aprovados

  @BSH-OPENTUI-014
  Cenário: Aplicar a paleta GitHub Dark Dimmed em toda a interface
    Dado que a TUI usa componentes OpenTUI
    Quando a sessão, paleta ou qualquer diálogo for exibido
    Então todas as superfícies devem usar os tokens compartilhados do tema GitHub Dark Dimmed
      | Papel | Cor |
      | Fundo principal | #22272e |
      | Fundo de painéis e diálogos | #2d333b |
      | Fundo rebaixado | #1c2128 |
      | Texto principal | #adbac7 |
      | Texto secundário | #768390 |
      | Texto em destaque | #cdd9e5 |
      | Borda principal | #444c56 |
      | Borda discreta | #373e47 |
      | Acento e informação | #539bf5 |
      | Fundo de seleção em destaque | #316dca |
      | Sucesso | #57ab5a |
      | Atenção | #c69026 |
      | Erro e bloqueio | #e5534b |
      | Raciocínio | #986ee2 |
    E cores específicas por comando devem seguir "menu-de-comandos-barra.feature"

  @BSH-OPENTUI-015
  Cenário: Preservar significado e legibilidade dos estados com o novo tema
    Dado que a sessão pode indicar conformidade, violação, alerta, fila e foco
    Quando a paleta de cores GitHub Dark Dimmed for aplicada
    Então os estados devem manter seus rótulos e indicadores além da cor
    E texto de seleção deve permanecer legível sobre o fundo em destaque
    E um alerta ou bloqueio não deve ser apresentado como sucesso
    E a mudança de cores não deve alterar comandos, atalhos ou decisões de governança

  @BSH-OPENTUI-016
  Cenário: Centralizar estilos nos componentes OpenTUI
    Dado que existe um módulo de tokens do tema para a TUI
    Quando cabeçalho, conversa, entrada, rodapé, seletores e diálogos forem compostos
    Então seus estilos devem consumir os tokens compartilhados
    E o OpenTUI deve aplicar as cores e fundos dos componentes
    E não devem ser usadas sequências ANSI escritas à mão para aplicar o tema

  @BSH-OPENTUI-017
  Cenário: Adaptar toda a TUI à largura real do terminal
    Dado que a sessão pode ser aberta em terminais estreitos, médios ou largos
    Quando a largura da tela muda
    Então cabeçalho, conversa, entrada, rodapé, paleta e diálogos devem se adaptar à largura real disponível
    E a TUI não deve impor uma largura mínima artificial superior à tela
    E texto deve quebrar e componentes devem ajustar sua disposição sem ultrapassar a tela
    E a paleta deve respeitar simultaneamente o limite de 72 colunas e a largura disponível

  @BSH-OPENTUI-018
  Cenário: Priorizar conteúdo necessário em telas estreitas
    Dado que a largura disponível não comporta todos os detalhes em uma linha
    Quando a interface adapta sua disposição
    Então controles de entrada, seleção, confirmação e cancelamento devem continuar utilizáveis
    E estados de governança, bloqueio e execução devem permanecer identificáveis
    E a interface deve usar quebra de texto, disposição alternativa ou rolagem para conteúdo necessário
    E detalhes secundários podem ser abreviados sem esconder decisões ou ações obrigatórias

  @BSH-OPENTUI-019
  Cenário: Preservar estados ao alternar larguras durante a interação
    Dado que o usuário possui rascunho, consulta, seleção e posição de conversa ativos
    Quando o terminal alterna entre larguras de 35, 60, 80 e 140 colunas durante streaming ou um diálogo
    Então os estados de entrada, consulta, seleção, foco e conversa devem ser preservados
    E os componentes não devem apresentar sobreposição que impeça interação
    E a verificação deve usar capturas dos componentes OpenTUI e evidências da jornada empacotada
