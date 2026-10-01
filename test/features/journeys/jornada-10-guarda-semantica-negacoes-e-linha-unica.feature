# language: pt
Funcionalidade: Jornada 10 - Guarda Semântica com Negação e Navegação em Linha Única
  Como um desenvolvedor operando o BSH com ontologia ativa
  Eu quero que o detector semântico reconheça negações e não confunda ações como remoção com transferência
  E quero que a navegação pelo histórico de prompts mantenha estritamente uma única linha de entrada

  Cenário: Solicitação de remoção de ativo não baixado não gera falso positivo
    Dado que o projeto piloto "pilot/asset-management" possui ontologia "ativos" com SHACL ativo
    E o BSH é iniciado com o comando "bsh --project pilot/asset-management"
    Quando o usuário digita no prompt "faça um endpoint pra remover um ativo nao baixado"
    Então o BSH avalia a guarda semântica sem disparar violação
    E o prompt é aceito normalmente sem o distintivo "[!] VIOLATION DETECTED"
    E nenhum banner de confirmação ou bloqueio de TransferShape é exibido

  Cenário: Solicitação de transferência de ativo baixado dispara guarda semântica legítima
    Dado que a sessão BSH continua ativa
    Quando o usuário digita no prompt "faça um endpoint pra transferir um ativo baixado"
    Então a guarda semântica identifica a violação contra "TransferShape"
    E exibe o alerta "[!] [PROMPT VIOLATION DETECTED]"
    E solicita "[Enter para prosseguir /cancel para abortar]"

  Cenário: Navegação por setas no histórico preserva estritamente uma única linha de prompt
    Dado que existem prompts anteriores no histórico
    Quando o usuário pressiona Seta para Cima ou Seta para Baixo
    Então o prompt anterior é recuperado no campo de entrada
    E nenhuma linha adicional é inserida no terminal
    E nenhum prefixo duplicado é gerado horizontalmente
    E a moldura do BSH mantém altura e largura exatas
