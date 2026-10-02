# language: pt
Funcionalidade: Jornada 13 - Mecanismo de Instalação e Execução de Skills e Prototipação Rápida
  Como um desenvolvedor e agente de software operando com o BSH
  Eu quero poder instalar, descobrir e inspecionar skills operacionais como "prototype"
  E quero ativar skills via CLI ou TUI para guiar o loop autônomo de codificação
  E quero que todas as ações e protótipos continuem estritamente governados pelo Semantic Gate ontológico

  Cenário: Descoberta e inspeção da skill prototype instalada via CLI
    Dado que a skill "prototype" foi adicionada ao projeto em ".agents/skills/prototype/SKILL.md"
    Quando o desenvolvedor executa o comando "bsh skill list"
    Então o BSH lista a skill "prototype" com o escopo "[project]"
    E quando o desenvolvedor executa "bsh skill show prototype"
    Então o BSH exibe a descrição, o caminho do arquivo e as diretivas de prototipação rápida

  Cenário: Visualização e ativação interativa de skills na TUI com /skills
    Dado que o operador está em uma sessão interativa da TUI do BSH
    Quando o operador submete o comando "/skills"
    Então o modal de gerenciamento de skills é aberto com busca difusa
    E exibe a lista de skills locais e globais disponíveis
    E ao selecionar a skill "prototype"
    Então o BSH ativa a skill para a sessão corrente e registra o evento no chat

  Cenário: Execução autônoma de protótipo aderente sob a skill prototype
    Dado que a skill "prototype" está ativa na sessão governada do domínio "ativos"
    Quando o usuário solicita a prototipação de uma função de cálculo de depreciação sem violar SHACL
    Então o agente de codificação gera o protótipo leve e funcional respeitando as diretivas da skill
    E a alteração é validada e aprovada pelo Semantic Gate ontológico

  Cenário: Bloqueio semântico de protótipo que contraria a ontologia e SHACL
    Dado que a skill "prototype" está ativa na sessão governada do domínio "ativos"
    Quando o usuário solicita a prototipação de um estado de ativo inválido ou mutação que viola regra ontológica
    Então o Semantic Gate intercepta a tentativa de escrita
    E bloqueia a mutação exibindo os nós e propriedades conflitantes com a ontologia
