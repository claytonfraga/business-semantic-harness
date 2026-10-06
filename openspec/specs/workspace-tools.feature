# language: pt
# Fontes: src/agent/tools.ts; test/agent/agent.test.mjs; test/agent/tools.test.mjs; openspec/changes/autonomous-coding-agent
@bsh @tools
Funcionalidade: Ferramentas de exploração e edição do workspace

  Como um agente de codificação
  Eu quero localizar e editar arquivos com ferramentas explícitas
  Para aplicar mudanças verificáveis no workspace da sessão

  @BSH-TOOLS-001
  Cenário: Disponibilizar ferramentas nativas
    Dado um turno do agente
    Quando as definições de ferramentas são enviadas ao modelo
    Então devem incluir "search_code", "find_files", "read_file", "write_file", "replace_file_content", "list_directory", "run_bash_command" e "inspect_skill"
    E os parâmetros obrigatórios devem ser declarados em esquema JSON

  @BSH-TOOLS-002
  Cenário: Buscar texto e expressão regular
    Dado uma consulta não vazia de código
    Quando o agente chama "search_code"
    Então deve obter caminho relativo, número de linha e trecho correspondente
    E deve poder restringir a busca com "path_prefix"
    E o limite padrão deve ser 30 resultados e o limite máximo 100
    E regex inválida deve receber tratamento resiliente

  @BSH-TOOLS-003
  Cenário: Limitar varredura de código
    Dado dependências, metadados e artefatos de build no projeto
    Quando buscas percorrem o workspace
    Então devem ignorar diretórios como "node_modules", ".git", ".bsh", "dist" e "build"
    E a busca de conteúdo deve limitar profundidade e tamanho de arquivo
    E arquivos ilegíveis devem ser ignorados sem encerrar o turno

  @BSH-TOOLS-004
  Cenário: Localizar arquivos por padrão de caminho
    Dado um padrão não vazio
    Quando o agente chama "find_files"
    Então a busca atual deve encontrar nomes e caminhos por substring sem diferenciar maiúsculas
    E deve retornar caminhos relativos com limite padrão 50 e máximo 200
    E ausência de correspondência deve receber mensagem explícita

  @BSH-TOOLS-005 @specified @gap
  Cenário: Buscar arquivos por glob conforme a proposta
    Dado arquivos de código em múltiplos subdiretórios
    Quando o agente solicita "find_files" com um padrão glob como "src/**/*.ts"
    Então deve receber os arquivos correspondentes ao padrão
    E resultados devem respeitar o limite configurado e ignorar diretórios derivados

  @BSH-TOOLS-006
  Cenário: Ler arquivos por intervalo
    Dado um arquivo dentro do workspace
    Quando o agente chama "read_file" com "start_line" e "end_line" opcionais
    Então deve receber o conteúdo inteiro ou o intervalo solicitado com linhas numeradas a partir de 1

  @BSH-TOOLS-007
  Cenário: Gravar e substituir conteúdo
    Dado um arquivo acessível no workspace
    Quando o agente chama "write_file" ou "replace_file_content"
    Então a escrita deve criar ou sobrescrever o arquivo informado
    E a substituição deve alterar a ocorrência exata do alvo
    E alvo ausente deve produzir erro sem declarar uma substituição concluída

  @BSH-TOOLS-008
  Cenário: Rejeitar fuga lexical de caminho
    Dado um caminho absoluto ou um caminho relativo que sai do workspace
    Quando uma ferramenta de arquivo resolve o caminho
    Então deve rejeitar o acesso
    E a ferramenta não deve escrever no checkout principal por esse caminho

  @BSH-TOOLS-009 @R4 @R5
  Cenário: Restringir execução ao isolamento especificado
    Dado um link simbólico ou comando de shell capaz de acessar fora do workspace
    Quando uma ferramenta tenta usá-lo
    Então o isolamento especificado deve proteger os arquivos externos ao workspace
    E restrição lexical de caminho e diretório atual do shell não devem ser tratados como prova suficiente de confinamento

  @BSH-TOOLS-010
  Cenário: Listar diretório e diagnosticar ferramenta desconhecida
    Dado um diretório do workspace
    Quando o agente chama "list_directory"
    Então deve receber arquivos e subdiretórios com identificação de pastas
    E uma ferramenta desconhecida deve produzir erro explícito

  @BSH-TOOLS-011
  Cenário: Executar validação de projeto pelo terminal
    Dado um comando de build, teste ou lint
    Quando o agente chama "run_bash_command"
    Então o comando deve executar no diretório do workspace com stdout, stderr e código de saída
    E a resposta deve limitar o volume de saída
    E um comando excedendo 30 segundos deve receber diagnóstico de tempo limite
    E as diretivas do agente devem exigir "/usr/bin/rtk" nos comandos

  @BSH-TOOLS-012
  Cenário: Inspecionar skill disponível
    Dado uma skill registrada no projeto ou no escopo global
    Quando o agente chama "inspect_skill" com seu nome
    Então deve receber nome, escopo, descrição, caminho, instruções completas e recursos associados
    E nome ausente deve gerar erro
    E skill desconhecida deve retornar aviso recuperável

  @BSH-TOOLS-013
  Cenário: Preparar ambiente não interativo para processos de ferramentas
    Dado variáveis de ambiente do host, incluindo um pager interativo
    Quando o ambiente de um processo de shell ou MCP é preparado
    Então apenas variáveis permitidas e valores explicitamente configurados devem ser preservados
    E "PAGER" deve usar "cat" por padrão para evitar espera por interação
    E configuração explícita do processo deve prevalecer sobre esse padrão

  @BSH-TOOLS-014 @REQ-AGENT-OBSERVED-CHANGES
  Cenário: Relatar somente mudanças observadas ao terminar um turno
    Dado o estado inicial do workspace e dos arquivos rastreados pelo Git
    Quando o agente usa ferramentas de arquivo, shell ou MCP
    Então os arquivos relatados devem corresponder às diferenças de conteúdo, tipo ou permissão no estado final
    E criações, remoções e mudanças por shell ou MCP devem ser identificadas
    E escritas malsucedidas, escritas idênticas e alterações preexistentes intocadas não devem ser relatadas como mudanças realizadas

  @BSH-TOOLS-015 @REQ-AGENT-OBSERVED-OUTCOME
  Cenário: Distinguir desfechos sem obrigar uma mutação
    Dado uma solicitação de ação
    Quando o agente termina sua resposta ou atinge o limite de turnos
    Então o resultado deve distinguir conclusão, bloqueio por regra, erro de ferramenta e limite de turnos
    E uma negativa registrada pelo broker deve impedir que o resultado declare conclusão
    E o relato deve preservar os motivos e as ferramentas que falharam
    E uma recusa declarada pelo agente via "report_task_outcome" deve informar identificador da regra e motivo
    E essa declaração deve ser distinguida da evidência independente do broker
    E arquivos gerados de auditoria e telemetria em ".bsh/local" não devem ser atribuídos ao agente
    E arquivos dos domínios em ".bsh/domains" devem permanecer no inventário de mudanças
    E terminar sem mudanças não deve inserir automaticamente uma nova solicitação de escrita
    E uma recusa por regra de negócio não deve obrigar o agente a modificar arquivos
