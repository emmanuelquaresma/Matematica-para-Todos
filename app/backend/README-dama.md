# Salas de dama — fase 3

O jogo local continua independente em `dama.js`. O online usa o backend como
única autoridade: `services/dama_game.py` contém as regras, `services/dama.py`
gerencia salas/conexões, e `routes/dama.py` faz a tradução HTTP/WebSocket.

## HTTP e sessão

- `POST /api/dama/rooms`: cria sala e jogador branco; retorna 201 com
  `player_id`, `session_token` e `room`.
- `POST /api/dama/rooms/{room_id}/join`: cria jogador preto; mesmo formato.
  Uma terceira entrada retorna 409. Reconexão não chama join novamente.
- `GET /api/dama/rooms/{room_id}`: snapshot sem tokens, exige
  `Authorization: Bearer <session_token>`.
- `POST /api/dama/rooms/{room_id}/leave`: mesmo cabeçalho; desconecta todas as
  conexões desse jogador, registra left_at e invalida seu token. Preserva o
  tabuleiro e o registro histórico do participante, sem atribuir derrota.

O frontend guarda room_id, player_id, color e session_token em localStorage.
Sair voluntariamente notifica o backend e limpa imediatamente a sessão local,
mesmo se a rede falhar; nesse caso a interface informa que o servidor não confirmou.
Uma falha de rede impede garantir a revogação remota, mas não bloqueia uma nova sala. Fechar a aba apenas
fecha a conexão: ao voltar, consulta a sala e reconecta. Para testar duas cores,
usar perfis ou navegadores separados. Tokens são credenciais: não expor em URL,
snapshots ou logs. Não há recuperação de token perdido nesta fase.

## Pré-jogo e permanência

Cada jogador expõe connected e left separadamente. Quedas apenas alteram connected;
leave marca left=true, registra left_at e revoga a sessão antiga. Uma vaga left=true
pode ser substituída por uma nova participação, com novo token e a cor que ficou
livre. Vagas temporariamente desconectadas são reservadas. A partida não é resetada.
Se a vaga do criador for substituída, o novo participante assume a função de criador.

`POST /api/dama/rooms/{room_id}/swap-colors`, com Bearer, troca as duas cores em READY,
somente antes do início e sem participantes left. Ambos podem solicitar.
`POST /api/dama/rooms/{room_id}/start`, com Bearer, inicia uma única vez: somente o
criador, com dois jogadores conectados, pode fazê-lo. As brancas (current_player=1)
começam independentemente de quem criou a sala. Ambos os endpoints transmitem state.
Snapshots incluem creator_id e started. As cores são recuperadas do servidor;
localStorage não é autoridade de cor.

A sala fica ABANDONED somente quando seus dois participantes estão left=true;
não aceita mais tokens nem join. Mantemos o registro encerrado em memória, sem
remover durante callbacks WebSocket. Uma sala ainda com um único registro de jogador
fica WAITING se ele sair, podendo receber nova participação. Não há limpeza temporal.

## Protocolo WebSocket

Conectar em `/ws/dama/{room_id}` e enviar em até 10 segundos:

```json
{"type":"authenticate","session_token":"token recebido via HTTP"}
```

Credenciais inválidas fecham com código 1008. Uma conexão autenticada pode enviar:

```json
{"type":"move","from":{"row":5,"col":0},"to":{"row":4,"col":1},"revision":3}
```

Coordenadas são inteiros de 0 a 7. Cor/player não são aceitos na mensagem: a cor
vem exclusivamente da sessão autenticada. Revision é opcional para clientes,
mas o frontend a envia para rejeitar solicitações sobre snapshots ultrapassados.
Todas as validações precedem a mutação síncrona do estado no event loop.

Eventos do servidor:

- `state`: snapshot completo depois de uma jogada válida e em resposta a ping.
- `move_rejected`: detail e snapshot atual apenas para quem tentou a jogada;
  mantém a conexão aberta e não altera estado/revision.
- `player_connected`, `player_disconnected`, `player_joined`, `player_left`:
  snapshot completo atualizado da sala.
- `error`: mensagem desconhecida ou JSON inválido após autenticação.

`room` contém room_id, board, current_player, captures, winner, forced_piece,
legal_moves, status, players, created_at, updated_at e revision. Captures usa
chaves JSON "1" e "2"; winner é 1, 2 ou null. Legal_moves contém from, to e capture
(posição da peça capturada ou null), apenas para o turno ativo.

O frontend destaca destinos fornecidos pelo servidor, permite apenas a própria
cor/turno e envia a intenção. Não atualiza o tabuleiro antecipadamente. Snapshots
mais antigos são ignorados. Não há reenvio automático de move na reconexão:
o cliente recebe o estado definitivo antes de permitir outra jogada.

## Regras e presença

Mesma variante de dama.js: brancas/1 começam; peças comuns movem e capturam para
frente; damas curtas em quatro sentidos. Captura é obrigatória, sem regra da maior
captura. Uma sequência exige a mesma peça (forced_piece), sem alternar o turno.
Promoção é imediata e permite continuar capturando como dama na mesma jogada.
Sem peças ou movimentos do próximo jogador, winner é definido e novas jogadas
são bloqueadas. Não há regra de empate nem reinício online nesta fase.

- `WAITING`: pré-jogo com menos de dois participantes vinculados.
- `READY`: dois participantes vinculados, antes do início explícito; nenhuma jogada.
- `IN_PROGRESS`: partida iniciada e os dois participantes conectados.
- `PAUSED`: partida iniciada com participante desconectado ou que saiu; jogadas bloqueadas.
- `FINISHED`: vitória detectada pelo motor; reconectar não reabre a partida.
- `ABANDONED`: os dois participantes saíram voluntariamente; sala encerrada.

Desconexão atualiza last_seen, preservando peças, capturas, turno e forced_piece.
Múltiplas abas são aceitas: fechar uma não desconecta o jogador enquanto outra
estiver ativa. Quedas são percebidas quando o transporte detecta a desconexão.
O frontend usa ping e reconexão progressiva para recuperar conexões interrompidas.

## Limites operacionais

Memória de um processo, com um único worker. Reinício/reload perde as salas.
Não há banco, expiração, limite global de salas ou rate limiting. Persistência e
armazenamento compartilhado são necessários para sobreviver a reinícios e usar
múltiplos workers. O Uvicorn precisa da dependência websockets de requirements.txt.

## Validação sem Docker

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=app/backend/src .venv/bin/python -m unittest discover -s app/backend/tests/unit -v
```

Testes ASGI usam aplicação isolada com o router, sem servidor HTTP. Incluem dois
WebSockets, autenticação, rejeição, broadcast e reconexão. Os testes de regras
cobrem captura encadeada, promoção, vitória e rejeições sem mutações.
`tests/frontend/dama-multiplayer.test.js` expõe runDamaMultiplayerTests(source)
para executar com um runtime JS, usando DOM/rede simulados. Ainda é necessária
validação em navegadores reais. O caminho de estáticos em main.py continua
orientado à organização da imagem Docker, como antes.
