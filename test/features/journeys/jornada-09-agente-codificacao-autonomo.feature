# language: pt
Funcionalidade: Jornada 9 - Agente de Codificação Autônomo com Ferramentas Especializadas, Ingestão de Contexto e Execução Concreta
  Como um engenheiro de software utilizando o BSH para manutenção e evolução de código
  Eu quero que o BSH funcione como um agente de codificação autônomo e resolutivo
  Para que solicitações de código sejam exploradas, modificadas cirurgicamente e testadas no workspace, com governança ontológica sobre o diff real

  Cenário: Descoberta de contexto e localização cirúrgica de código
    Dado que uma sessão do BSH é iniciada em um projeto de software
    Quando o agente processa a solicitação do usuário para encontrar ou alterar código
    Então o agente possui conhecimento prévio da estrutura do projeto e manifestos disponíveis
    E o agente utiliza as ferramentas "search_code" ou "find_files" para localizar com precisão os arquivos e símbolos relevantes
    E não depende de adivinhações ou navegação cega de diretórios

  Cenário: Ciclo autônomo de modificação de código e auto-verificação
    Dado que o usuário solicita uma implementação ou alteração concreta no repositório
    Quando o agente processa a requisição no loop de codificação
    Então o agente invoca "replace_file_content" ou "write_file" para aplicar as alterações nos arquivos do workspace
    E o agente executa comandos de validação ("run_bash_command" utilizando "/usr/bin/rtk") para testar ou compilar o código
    E apresenta o resultado objetivo ao usuário acompanhado do diff das alterações produzidas

  Cenário: Execução do agente de codificação em modo headless via CLI
    Dado que o comando "bsh --prompt '<instrução>'" é invocado no terminal
    Quando a execução headless é iniciada
    Então uma sessão segura com worktree Git isolada é instanciada automaticamente
    E o agente executa o plano de codificação com ferramentas reais sem necessidade de TUI interativa
    E encerra o processo com código de saída 0 em caso de sucesso e exibe o resumo das modificações

  Cenário: Gate semântico avaliado sobre o diff de código real
    Dado que arquivos foram modificados pelo agente no workspace durante a sessão
    Quando o Gate Semântico analisa a conformidade das regras ontológicas e SHACL
    Então o gate avalia as operações semânticas extraídas diretamente do diff do Git
    E identifica violações reais de transição de estado ou conformidade de atributos antes da promoção
