# language: pt
Funcionalidade: Jornada 14 - Instalação, Descoberta e Inclusão Dinâmica de Skills no BSH

  Como um engenheiro de software e usuário do BSH
  Eu quero instalar skills do ecossistema e utilizá-las dinamicamente nas sessões do agente
  Para estender as capacidades do agente com diretivas formais e prototipação rápida sob governança

  Contexto:
    Dado que o ambiente possui o binário global do BSH instalado
    E que o projeto possui um domínio de governança ontológica configurado
    E que o instalador oficial de skills está acessível

  Cenário: Instalação e verificação da skill prototype
    Quando o usuário executa o comando "bsh skill add mattpocock/skills --skill=prototype"
    Então o sistema deve reportar sucesso na instalação
    E o comando "bsh skill list" deve listar a skill "prototype" com escopo "project"
    E o comando "bsh skill show prototype" deve exibir as diretrizes de código descartável e máquina de estados

  Cenário: Ativação dinâmica e inclusão da skill no contexto do BSH
    Dado que a skill "prototype" está registrada no projeto
    Quando o usuário envia uma solicitação no BSH com o comando "/prototype Desenhar máquina de estados de transição de ativos"
    Então o sistema deve ativar automaticamente as diretivas da skill "prototype"
    E a barra de cabeçalho da TUI deve exibir o indicador "[⚡ ACTIVE]" para a skill "prototype"
    E o system prompt do agente deve conter o bloco com as diretivas ativas da skill "prototype"
    E o agente deve direcionar a entrega como um protótipo autocontido sem persistência

  Cenário: Loop interativo multi-turno com refinamento guiado pela skill
    Dado que a sessão está com a skill "prototype" ativa e contextualizada
    Quando o agente conclui o primeiro turno gerando a versão inicial do protótipo
    E o usuário envia um turno de refinamento: "Adicione o estado REJECTED com justificativa e um botão de teste SHACL"
    Então o BSH deve manter o contexto da skill "prototype" ativo no segundo turno
    E o agente deve refinar cirurgicamente o arquivo "prototype-asset-state-machine.html"
    Quando o usuário envia o comando "/skill done"
    Então o BSH deve registrar a conclusão formal do loop da skill
    E deve remover o badge ativo da barra de status

  Cenário: Geração do protótipo descartável governado pelo BSH
    Dado que o agente autônomo está executando sob as diretivas da skill "prototype"
    Quando o agente conclui as modificações no workspace isolado
    Então deve existir um arquivo "prototype-asset-state-machine.html" contendo:
      | Elemento | Descrição |
      | botões de ação | Transições de status (DRAFT, UNDER_REVIEW, ACTIVE, REJECTED, ARCHIVED) |
      | painel de estado | Visualização reativa do estado atual da máquina |
      | aviso de descarte | Indicação explícita de protótipo temporário |
    E o gate semântico pós-execução do BSH deve validar a conformidade estrutural

  Cenário: Introspecção em runtime pelo agente autônomo via tool inspect_skill
    Dado que o agente autônomo está em execução
    Quando o agente chama a ferramenta "inspect_skill" com o nome "prototype"
    Então o BSH deve retornar as instruções completas do arquivo SKILL.md e metadados
