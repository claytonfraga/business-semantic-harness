# language: pt
# Fontes: src/skills; src/agent/tools.ts; src/tui/session.ts; test/skills; test/features/journeys/jornada-13-mecanismo-de-skills-e-prototipacao.feature; test/features/journeys/jornada-14-instalacao-e-inclusao-dinamica-de-skills.feature
@bsh @skill
Funcionalidade: Instalação e uso dinâmico de skills

  Como um desenvolvedor e agente do BSH
  Eu quero descobrir e ativar instruções operacionais
  Para estender a execução mantendo a governança

  @BSH-SKILL-001
  Cenário: Descobrir skills locais e globais
    Dado skills em ".bsh/skills", ".agents/skills", ".skills" e diretórios globais reconhecidos
    Quando o registro descobre skills
    Então deve aceitar "<nome>/SKILL.md" e arquivos "*.skill.md"
    E skills de projeto devem prevalecer sobre skills globais de mesmo nome
    E a lista deve ser ordenada por nome e informar escopo e caminho

  @BSH-SKILL-002
  Cenário: Ler metadados e recursos
    Dado um arquivo de skill com frontmatter YAML simples ou sem frontmatter
    Quando ele é carregado
    Então deve extrair nome, descrição, metadados e corpo Markdown
    E valores multilinha e aspas devem receber tratamento
    E ausência de metadados deve usar título ou nome alternativo
    E recursos associados e arquivos ilegíveis devem ser tratados de forma resiliente

  @BSH-SKILL-003
  Cenário: Atualizar cache de descoberta
    Dado um catálogo de skills já carregado
    Quando uma instalação conclui ou a atualização é solicitada
    Então o cache deve ser invalidado antes da redescoberta
    E a nova skill deve aparecer sem reiniciar o processo

  @BSH-SKILL-004
  Cenário: Listar e inspecionar pela CLI
    Dado skills disponíveis
    Quando o usuário executa "bsh skill list" ou "bsh skill show <nome>"
    Então deve receber nome, escopo, descrição e instruções quando solicitado
    E os aliases "skills", "ls" e "info" devem ser aceitos
    E skill desconhecida deve retornar 1 e argumento ausente ou subcomando inválido deve retornar 2

  @BSH-SKILL-005
  Cenário: Instalar pacote de skills
    Dado uma origem informada pelo usuário
    Quando executa "bsh skill add <origem>" ou "bsh skill install <origem>"
    Então deve delegar ao instalador "skills@latest add" com confirmação não interativa
    E deve aceitar "--skill=<nome>", "--skill <nome>" e "--global" ou "-g"
    E deve executar no projeto alvo e usar RTK quando disponível
    E deve reportar código de saída e diagnóstico real da instalação

  @BSH-SKILL-006
  Cenário: Gerenciar skills na TUI
    Dado skills descobertas
    Quando o usuário abre "/skills" ou "/skill"
    Então deve visualizar busca difusa, escopo, descrição e indicador de ativação
    E deve poder alternar ativação por número, consultar detalhes e cancelar sem alterar a seleção

  @BSH-SKILL-007
  Cenário: Executar subcomandos de skill
    Dado uma sessão interativa
    Quando o usuário usa "show", "add", "activate" ou "deactivate" com "/skill" ou "/skills"
    Então deve executar a operação correspondente
    E ativação repetida não deve duplicar a skill
    E ausência de skill deve receber diagnóstico recuperável

  @BSH-SKILL-008 @specified @gap
  Cenário: Invocar skill explicitamente
    Dado uma skill registrada com nome "prototype"
    Quando o usuário envia "/prototype <tarefa>" ou "/skill prototype <tarefa>"
    Então a skill deve ser reconhecida e o texto da tarefa deve virar o prompt efetivo
    E suas instruções completas devem ser incluídas no contexto ativo do agente

  @BSH-SKILL-009
  Cenário: Ativar skill por intenção semântica
    Dado uma skill disponível relevante ao prompt
    Quando o prompt menciona seu nome ou solicita "protótipo" ou "throwaway"
    Então o mecanismo deve selecionar a skill correspondente
    E deve registrar sua ativação no contexto da sessão

  @BSH-SKILL-010
  Cenário: Manter skill entre turnos
    Dado uma skill ativa
    Quando o usuário envia refinamentos subsequentes
    Então o agente deve continuar recebendo as diretivas da skill
    E o cabeçalho deve mostrar seu nome e "ACTIVE"
    E as demais skills devem permanecer listadas como capacidades disponíveis

  @BSH-SKILL-011 @specified @gap
  Cenário: Concluir loop de skill
    Dado skills ativas
    Quando o usuário executa "/done", "/finish" ou "/skill done"
    Então deve registrar conclusão e remover suas diretivas e badges ativos
    E conclusão não deve ser convertida em autorização para promover mudanças

  @BSH-SKILL-012
  Cenário: Prototipar sem dispensar governança
    Dado a skill "prototype" ativa em sessão governada
    Quando o agente gera um protótipo descartável
    Então deve seguir as diretivas da skill e indicar sua natureza temporária
    E o diff deve permanecer submetido ao gate ontológico independente
    E um protótipo violador deve ser bloqueado para promoção

  @BSH-SKILL-013 @specified
  Cenário: Gerar máquina de estados de protótipo
    Dado a jornada de prototipação de ativos
    Quando o agente cria "prototype-asset-state-machine.html"
    Então deve apresentar estados "DRAFT", "UNDER_REVIEW", "ACTIVE", "REJECTED" e "ARCHIVED"
    E deve incluir botões de transição, painel reativo de estado e aviso de descarte
    E refinamentos posteriores devem modificar o arquivo existente
