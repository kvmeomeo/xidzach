'use strict';
// Không phụ thuộc npm. Máy chủ HTTP + WebSocket thuần Node.js.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
// Luật bài được tích hợp để chỉ cần 3 file khi triển khai.

const { randomInt } = require('node:crypto');

const SUITS = ['♠','♥','♣','♦'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MAX_PLAYERS = 16; // 1 nhà cái + tối đa 15 nhà con. Dùng 2 bộ bài khi cần.
const TURN_MS = 30_000; // 30 giây tổng cho một lượt chơi, thực thi bởi máy chủ.

function makeDeck(packs = 1) {
  const cards = Array.from({length:packs},()=>SUITS.flatMap(suit => RANKS.map(rank => ({rank, suit})))).flat();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function bestScore(cards) {
  let totals = new Set([0]);
  for (const card of cards) {
    const options = card.rank === 'A' ? [1,10,11] : ['J','Q','K'].includes(card.rank) ? [10] : [Number(card.rank)];
    const next = new Set();
    for (const t of totals) for (const val of options) next.add(t + val);
    totals = next;
  }
  const sorted = [...totals].sort((a,b)=>a-b);
  return sorted.filter(n => n <= 21).at(-1) ?? sorted[0] ?? 0;
}
function evaluate(cards) {
  const score = bestScore(cards);
  if (!cards || cards.length < 2) return {kind:'none',score,rank:-2,label:'Chưa chia'};
  const isAce = c => c.rank === 'A';
  const isTen = c => ['10','J','Q','K'].includes(c.rank);
  if (cards.length === 2 && cards.every(isAce)) return {kind:'bang',score,rank:5,label:'Xì Bàng'};
  if (cards.length === 2 && ((isAce(cards[0]) && isTen(cards[1])) || (isTen(cards[0]) && isAce(cards[1])))) return {kind:'dach',score,rank:4,label:'Xì Dách'};
  if (score > 21) return {kind:'bust',score,rank:0,label:'Quắc'};
  if (cards.length === 5) return {kind:'ngu',score,rank:3,label:'Ngũ Linh'};
  if (score >= 16) return {kind:'points',score,rank:2,label:score + ' điểm'};
  return {kind:'under',score,rank:1,label:score+' điểm · chưa đủ tuổi'};
}
// Return 1=nhà con thắng; 0=hòa; -1=nhà cái thắng.
function compareHands(childCards, dealerCards, childFold = false) {
  if (childFold) return -1;
  const child = evaluate(childCards), dealer = evaluate(dealerCards);
  if (child.kind === 'bust' && dealer.kind === 'bust') return 0; // Luật tùy chỉnh của bàn: cùng quắc hòa.
  if (child.rank !== dealer.rank) return child.rank > dealer.rank ? 1 : -1;
  if (child.kind === 'ngu') return child.score === dealer.score ? 0 : child.score < dealer.score ? 1 : -1;
  if (child.kind === 'points' || child.kind === 'under') return Math.sign(child.score - dealer.score);
  return 0;
}
function isNatural(cards) { return ['bang','dach'].includes(evaluate(cards).kind); }
function shouldFinish(cards) { return cards.length >= 5 || evaluate(cards).kind === 'bust' || isNatural(cards); }


const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const CLIENT_FILES = { '/':'index.html', '/index.html':'index.html' };
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const now = () => Date.now();
const id = () => crypto.randomUUID();
const strip = (s, max = 30) => String(s ?? '').replace(/[\u0000-\u001F\u007F<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max);
function roomCode() {let code; do {code = Array.from({length:6},()=>ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join('');} while(rooms.has(code)); return code;}
function pushHistory(room, message) {room.history.unshift({time:now(),text:message});room.history.length = Math.min(room.history.length,30);room.lastActive=now();}
function info(room, player) {return {id:player.id, name:player.name, isHost:player.id===room.hostId, isDealer:player.id===room.dealerId, connected:player.connected, status:player.status, count:player.cards.length, result:player.result, stats:player.stats, score:player.score, roundPoints:player.roundPoints, multiplier:player.multiplier||1, deadline:player.deadline||null, folded:!!player.folded, revealed:!!player.revealed};}
function viewFor(room, viewer) {
  const showAll = room.phase === 'finished';
  const players = room.players.map(player => {
    const show = showAll || player.id===viewer.id || player.revealed;
    const base = info(room,player);
    base.cards = player.cards.map(card => show ? card : null);
    base.hand = show && player.cards.length ? evaluate(player.cards) : null;
    return base;
  });
  return {type:'state',code:room.code,phase:room.phase,round:room.round,hostId:room.hostId,dealerId:room.dealerId,myId:viewer.id,
    rules:{dealerMin:room.rules.dealerMin,turnSeconds:TURN_MS/1000},dealerLocked:room.dealerLocked,dealerCanJudge:canJudgeDealer(room),serverNow:now(),players,
    maxPlayers:MAX_PLAYERS, deckCount:room.deck.length,deckPacks:room.deckPacks||1,roundHistory:room.roundHistory,roundCancelled:room.roundCancelled};
}
function send(ws, data) {try {ws.send(JSON.stringify(data));}catch { /* connection closed */ }}
function error(ws, message) {send(ws,{type:'error',message});}
function broadcast(room) {for(const p of room.players) if(p.connected && p.socket) send(p.socket,viewFor(room,p));}
function userFor(ws) {const room=rooms.get(ws.roomCode);const player=room?.players.find(p=>p.id===ws.playerId);return room&&player?{room,player}:null;}
function makeRoom(ownerName, socket) {
  const owner = newPlayer(ownerName,socket);
  const room={code:roomCode(),createdAt:now(),lastActive:now(),hostId:owner.id,dealerId:owner.id,
    round:0,phase:'lobby',players:[owner],deck:[],deckPacks:1,dealerLocked:false,rules:{dealerMin:16},history:[],roundHistory:[],roundRecorded:false,roundCancelled:false};
  rooms.set(room.code,room);joinSocket(socket,room,owner);
  pushHistory(room,`${owner.name} tạo phòng • Đang chờ bạn bè vào bàn.`);
  return {room,player:owner};
}
function newPlayer(name,socket) {return {id:id(),token:id(),name:strip(name,22)||'Người chơi',connected:true,socket, cards:[],status:'waiting',result:null,folded:false,revealed:false,stats:{win:0,lose:0,tie:0},score:0,roundPoints:0,multiplier:1,deadline:null};}
function joinSocket(ws,room,player){
  if(player.socket && player.socket!==ws) { // Reconnect / nhiều tab: phiên cũ bị thay thế.
    const old=player.socket;old.roomCode=null;old.playerId=null;old.close();
  }
  ws.roomCode=room.code;ws.playerId=player.id;player.socket=ws;player.connected=true;
  send(ws,{type:'joined',code:room.code,token:player.token,name:player.name});
}
function begin(room) {
  // Tính đến tình huống mỗi người kéo tối đa 5 lá: bàn đông tự tăng số bộ bài.
  room.deckPacks=Math.max(1,Math.ceil(room.players.length*5/52));
  room.deck=makeDeck(room.deckPacks);room.round++;room.phase='players';room.dealerLocked=false;
  room.roundStatsBaseline=new Map(room.players.map(p=>[p.id,{stats:{...p.stats},score:p.score}]));
  room.roundRecorded=false;room.roundCancelled=false;
  room.players.forEach(p=>{p.cards=[];p.status='active';p.result=null;p.folded=false;p.revealed=false;p.roundPoints=0;p.multiplier=1;p.deadline=null;});
  for(let i=0;i<2;i++) for(const p of room.players) p.cards.push(room.deck.pop());
  const dealer=room.players.find(p=>p.id===room.dealerId);
  const children=room.players.filter(p=>p.id!==room.dealerId);
  pushHistory(room,`🃏 Ván ${room.round} bắt đầu với ${room.deckPacks} bộ bài.`);

  // Xì Bàng và Xì Dzách được mở bài và phân thắng/thua NGAY lúc chia.
  // Nếu Nhà cái có bài đặc biệt: công khai bài Nhà cái rồi xét mọi người lập tức.
  // Nếu chỉ Nhà con có bài đặc biệt: công khai bài người đó, thắng ngay; các nhà con
  // còn lại vẫn chơi tiếp bình thường. Hai bài đặc biệt được so đúng thứ hạng.
  if(isNatural(dealer.cards)) {
    dealer.status='stood';dealer.revealed=true;room.dealerLocked=true;
    for(const child of children){child.status='stood';child.revealed=true;settle(room,child);}
    pushHistory(room,`⚡ Nhà cái có ${evaluate(dealer.cards).label} — lật bài và xét toàn bàn ngay!`);
    return;
  }
  for(const child of children){
    if(isNatural(child.cards)){
      child.status='stood';child.revealed=true;
      settle(room,child); // Không phải đợi Nhà cái kéo rồi mới được xử thắng.
      pushHistory(room,`⚡ ${child.name} có ${evaluate(child.cards).label} — thắng ngay!`);
    }
  }
  // Tất cả nhà con bắt đầu cùng lúc: 30 giây tổng cho mỗi người để kéo/dằn.
  for(const child of children) if(child.status==='active')child.deadline=now()+TURN_MS;
  maybeDealerTurn(room);
}
function maybeDealerTurn(room){
  if(room.phase!=='players')return;
  if(room.players.filter(p=>p.id!==room.dealerId).every(p=>p.status!=='active')) {
    room.phase='dealer';const dealer=room.players.find(p=>p.id===room.dealerId);
    if(shouldFinish(dealer.cards)) {room.dealerLocked=true;dealer.status='stood';}
    dealer.deadline=now()+TURN_MS;
    pushHistory(room,'🔎 Nhà cái có 30 giây: từ đủ điểm xét được từng người, vẫn có thể rút thêm nếu chưa chốt.');
  }
}
// Nhà cái có thể xét khi đủ tuổi mà KHÔNG cần chốt; sau đó vẫn được kéo thêm.
function canJudgeDealer(room){
  if(room.phase!=='dealer')return false;
  const dealer=room.players.find(p=>p.id===room.dealerId);
  if(!dealer)return false;
  if(room.dealerLocked)return true;
  const hand=evaluate(dealer.cards);
  return ['bang','dach','ngu','bust'].includes(hand.kind)||hand.score>=room.rules.dealerMin;
}
// Ghi bảng điểm ván đã hoàn tất. Mỗi nhà con đối đầu nhà cái đúng 1 điểm.
function recordRound(room) {
  if(room.roundRecorded) return;
  room.roundRecorded=true;
  const dealer=room.players.find(p=>p.id===room.dealerId);
  const children=room.players.filter(p=>p.id!==room.dealerId);
  room.roundHistory.push({
    round:room.round,
    dealer:{id:dealer.id,name:dealer.name},
    dealerWins:children.filter(p=>p.result==='lose').length,
    dealerLosses:children.filter(p=>p.result==='win').length,
    dealerTies:children.filter(p=>p.result==='tie').length,
    dealerPoints:dealer.roundPoints,
    entries:room.players.map(p=>({id:p.id,name:p.name,delta:p.roundPoints,total:p.score,isDealer:p.id===room.dealerId,result:p.result||'dealer'}))
  });
  if(room.roundHistory.length>30) room.roundHistory.shift();
}
function settle(room,child){
  if(child.result) return;
  const dealer=room.players.find(p=>p.id===room.dealerId);
  const value=compareHands(child.cards,dealer.cards,child.folded);
  child.result = value>0?'win':value<0?'lose':'tie';
  child.revealed=true;
  // Bên THẮNG bằng Xì Bàng hoặc Ngũ Linh được x2 điểm; Xì Dách vẫn x1.
  // Dù xét sớm hay xét cả bàn, một cặp chỉ được tính đúng một lần.
  const winnerHand=value>0?evaluate(child.cards):value<0?evaluate(dealer.cards):null;
  const multiplier=winnerHand&&['bang','ngu'].includes(winnerHand.kind)?2:1;
  child.multiplier=value===0?1:multiplier;
  child.deadline=null;
  const childDelta=value>0?multiplier:value<0?-multiplier:0;
  child.roundPoints+=childDelta;
  child.score+=childDelta;
  dealer.roundPoints-=childDelta;
  dealer.score-=childDelta;
  if(value>0) {child.stats.win++;dealer.stats.lose++;}
  else if(value<0) {child.stats.lose++;dealer.stats.win++;}
  else {child.stats.tie++;dealer.stats.tie++;}
  pushHistory(room,`🔎 ${child.name}: ${value>0?'Nhà con thắng 🎉':value<0?'Nhà cái thắng':'Hòa 🤝'}${child.folded?' (bỏ lượt)':''}.`);
  if(room.players.filter(p=>p.id!==room.dealerId).every(p=>p.result)) {
    room.phase='finished';dealer.revealed=true;dealer.deadline=null;
    recordRound(room);
    pushHistory(room,`🏁 Ván ${room.round} kết thúc. Chủ phòng hoặc Nhà cái có thể chia ván mới.`);
  }
}

// Đếm giờ chạy trên MÁY CHỦ, không phụ thuộc đồng hồ/trang đang mở của người chơi.
// Nhà con đủ tuổi: tự dằn; chưa đủ tuổi: bỏ lượt và thua cặp này.
// Nhà cái: máy tự kéo đến khi đủ điều kiện xét, rồi tự xét các Nhà con còn lại.
function enforceTimeout(room){
  if(room.phase!=='players'&&room.phase!=='dealer')return false;
  const t=now();let changed=false;
  if(room.phase==='players'){
    for(const child of room.players){
      if(child.id===room.dealerId||child.status!=='active'||!child.deadline||t<child.deadline)continue;
      const hand=evaluate(child.cards);
      child.status='stood';child.deadline=null;
      if(hand.kind==='under'){child.folded=true;pushHistory(room,`⏱️ ${child.name} hết 30 giây khi chưa đủ tuổi — bỏ lượt.`);}
      else pushHistory(room,`⏱️ ${child.name} hết 30 giây — tự dằn bài.`);
      changed=true;
    }
    if(changed)maybeDealerTurn(room);
  }
  if(room.phase==='dealer'){
    const dealer=room.players.find(p=>p.id===room.dealerId);
    if(dealer?.deadline&&t>=dealer.deadline){
      // Không để ván kẹt nếu nhà cái chưa đủ tuổi khi hết giờ.
      while(dealer.status==='active'&&!canJudgeDealer(room)&&dealer.cards.length<5&&room.deck.length){
        dealer.cards.push(room.deck.pop());
        if(shouldFinish(dealer.cards))break;
      }
      dealer.status='stood';room.dealerLocked=true;dealer.deadline=null;
      pushHistory(room,'⏱️ Nhà cái hết 30 giây — hệ thống tự xét những Nhà con chưa được xét.');
      for(const child of room.players.filter(p=>p.id!==room.dealerId&&!p.result))settle(room,child);
      changed=true;
    }
  }
  return changed;
}

function handleEnter(ws,msg) {
  if(ws.roomCode) return error(ws,'Bạn đã ở trong phòng. Hãy rời phòng trước khi vào phòng khác.');
  const name=strip(msg.name,22)||'Người chơi';
  if(msg.action==='create') {
    const {room}=makeRoom(name,ws);broadcast(room);return;
  }
  if(msg.action!=='join') return error(ws,'Yêu cầu không hợp lệ.');
  const code=String(msg.code??'').toUpperCase().trim().replace(/\s/g,'');
  const room=rooms.get(code);
  if(!room) return error(ws,'Không tìm thấy phòng này. Kiểm tra mã phòng hoặc tạo phòng mới.');
  const existing=room.players.find(p=>p.token===msg.token && typeof msg.token==='string' && msg.token.length>20);
  if(existing) {
    joinSocket(ws,room,existing);pushHistory(room,`↩️ ${existing.name} đã kết nối lại.`);broadcast(room);return;
  }
  if(!['lobby','finished'].includes(room.phase)) return error(ws,'Bàn đang giữa ván. Hãy vào khi ván kết thúc.');
  if(room.players.length>=MAX_PLAYERS) return error(ws,`Phòng tối đa ${MAX_PLAYERS} người.`);
  const p=newPlayer(name,ws);room.players.push(p);joinSocket(ws,room,p);
  pushHistory(room,`👋 ${p.name} vào bàn.`);broadcast(room);
}
function leave(ws){
  const ctx=userFor(ws);if(!ctx)return;
  const {room,player}=ctx;
  if(room.phase==='players'||room.phase==='dealer') {
    player.connected=false;player.socket=null;pushHistory(room,`${player.name} đã rời kết nối, có thể quay lại bàn.`);
  } else {
    room.players=room.players.filter(p=>p.id!==player.id);
    pushHistory(room,`${player.name} rời phòng.`);
    if(room.dealerId===player.id && room.players.length) room.dealerId=room.players[0].id;
  }
  ws.roomCode=null;ws.playerId=null;
  if(room.hostId===player.id) room.hostId=room.players.find(p=>p.connected)?.id || room.players[0]?.id || null;
  if(room.players.length===0)rooms.delete(room.code);else broadcast(room);
}
function doAction(ws,msg){
  const ctx=userFor(ws);if(!ctx) return error(ws,'Bạn chưa vào phòng.');
  const {room,player}=ctx;
  if(enforceTimeout(room))broadcast(room);
  const host=room.hostId===player.id, dealer=room.dealerId===player.id;
  const type=String(msg.action||'');
  if(type==='leave') {leave(ws);send(ws,{type:'left'});return;}
  if(type==='change_name') {
    if(!['lobby','finished'].includes(room.phase)) return error(ws,'Chỉ đổi tên giữa các ván.');
    const next=strip(msg.name,22);if(!next)return error(ws,'Tên không hợp lệ.');player.name=next;broadcast(room);return;
  }
  if(type==='set_dealer') {
    if(!host||!['lobby','finished'].includes(room.phase))return error(ws,'Chủ phòng chỉ được chọn nhà cái khi chưa chia bài.');
    const target=room.players.find(p=>p.id===msg.target&&p.connected);if(!target)return error(ws,'Không tìm thấy người chơi đang kết nối.');
    room.dealerId=target.id;pushHistory(room,`👑 ${target.name} làm Nhà cái.`);broadcast(room);return;
  }
  if(type==='set_min') {
    if(!host||!['lobby','finished'].includes(room.phase))return error(ws,'Chỉ đổi luật trước khi chia ván.');
    if(![15,16].includes(Number(msg.value)))return error(ws,'Mốc xét hợp lệ là 15 hoặc 16.');
    room.rules.dealerMin=Number(msg.value);pushHistory(room,`⚙️ Nhà cái được chốt từ ${room.rules.dealerMin} điểm.`);broadcast(room);return;
  }
  if(type==='kick') {
    if(!host||!['lobby','finished'].includes(room.phase))return error(ws,'Chỉ dọn ghế trống giữa các ván.');
    const target=room.players.find(p=>p.id===msg.target && !p.connected);
    if(!target)return error(ws,'Chỉ có thể xóa ghế đã mất kết nối.');
    room.players=room.players.filter(p=>p.id!==target.id);
    if(room.dealerId===target.id)room.dealerId=player.id;
    pushHistory(room,`🪑 Đã dọn ghế của ${target.name}.`);broadcast(room);return;
  }
  if(type==='start') {
    if(!(host||dealer)||!['lobby','finished'].includes(room.phase))return error(ws,'Chỉ Chủ phòng hoặc Nhà cái được chia bài.');
    if(room.players.filter(p=>p.connected).length<2)return error(ws,'Cần ít nhất 2 người đang kết nối để bắt đầu.');
    if(room.players.some(p=>!p.connected))return error(ws,'Có người mất kết nối. Đợi họ trở lại hoặc dọn ghế trống.');
    if(!room.players.find(p=>p.id===room.dealerId)?.connected)room.dealerId=player.id;
    begin(room);broadcast(room);return;
  }
  if(type==='cancel') {
    if(!host||!['players','dealer'].includes(room.phase))return error(ws,'Chỉ chủ phòng được hủy ván đang chơi.');
    room.phase='finished';room.players.forEach(p=>{
      p.revealed=true;p.result=null;
      const previous=room.roundStatsBaseline?.get(p.id);
      if(previous){p.stats={...previous.stats};p.score=previous.score;}
      p.roundPoints=0;p.multiplier=1;p.deadline=null;
    });
    room.roundRecorded=true;room.roundCancelled=true; // Ván hủy không được ghi vào lịch sử điểm.
    pushHistory(room,'⏹️ Chủ phòng hủy ván. Không tính thành tích.');broadcast(room);return;
  }
  if(type==='draw') {
    if(dealer && room.phase!=='dealer')return error(ws,'Chưa tới lượt nhà cái.');
    if(!dealer && room.phase!=='players')return error(ws,'Không phải lượt kéo bài của bạn.');
    if(player.status!=='active'||(dealer&&room.dealerLocked))return error(ws,'Bạn đã dằn/chốt bài, không thể kéo thêm.');
    if(player.cards.length>=5||!room.deck.length)return error(ws,'Không thể kéo thêm lá.');
    player.cards.push(room.deck.pop());
    const evald=evaluate(player.cards);
    if(shouldFinish(player.cards)){player.status='stood';if(!dealer)player.deadline=null;if(dealer)room.dealerLocked=true;}
    pushHistory(room,`🂠 ${player.name} kéo lá ${player.cards.length}${evald.kind==='bust'?' — quắc!':''}.`);
    maybeDealerTurn(room);broadcast(room);return;
  }
  if(type==='stand'){
    if(dealer && room.phase!=='dealer')return error(ws,'Chưa tới lượt nhà cái.');
    if(!dealer && room.phase!=='players')return error(ws,'Không phải lượt dằn bài.');
    if(player.status!=='active')return error(ws,'Bạn đã dằn bài rồi.');
    const hand=evaluate(player.cards);
    const min=dealer?room.rules.dealerMin:16;
    if(hand.kind==='under' && hand.score<min)return error(ws,`Chưa đủ ${min} điểm để dằn.`);
    player.status='stood';if(!dealer)player.deadline=null;if(dealer)room.dealerLocked=true;
    pushHistory(room,`✋ ${player.name} ${dealer?'chốt bài':'dằn bài'}.`);
    maybeDealerTurn(room);broadcast(room);return;
  }
  if(type==='skip'){
    if(room.phase!=='players'||!host)return error(ws,'Chủ phòng chỉ có thể bỏ lượt người mất kết nối trong lượt nhà con.');
    const target=room.players.find(p=>p.id===msg.target && p.id!==room.dealerId && !p.connected && p.status==='active');
    if(!target)return error(ws,'Chỉ bỏ lượt người chưa dằn và đã mất kết nối.');
    target.status='stood';target.folded=true;target.deadline=null;
    pushHistory(room,`⏭️ ${target.name} bỏ lượt do mất kết nối.`);maybeDealerTurn(room);broadcast(room);return;
  }
  if(type==='judge'||type==='judge_all'){
    if(!dealer||room.phase!=='dealer')return error(ws,'Chỉ nhà cái được xét bài.');
    if(!canJudgeDealer(room))return error(ws,`Nhà cái phải đủ ${room.rules.dealerMin} điểm mới được xét bài. Không cần chốt trước.`);
    const children=room.players.filter(p=>p.id!==room.dealerId&&!p.result);
    if(type==='judge'){
      const target=children.find(p=>p.id===msg.target);
      if(!target)return error(ws,'Nhà con đã được xét hoặc không hợp lệ.');
      settle(room,target);
    }else for(const target of children) settle(room,target);
    broadcast(room);return;
  }
  error(ws,'Thao tác không hợp lệ.');
}
function message(ws,raw){
  if(!ws.isOpen)return;
  let obj;try{obj=JSON.parse(raw);}catch{return error(ws,'Dữ liệu không hợp lệ.');}
  if(!obj||typeof obj!=='object')return;
  if(obj.type==='enter')return handleEnter(ws,obj);
  if(obj.type==='action')return doAction(ws,obj);
  if(obj.type==='chat'){
    const ctx=userFor(ws);if(!ctx)return;
    if(now()-(ws.lastChat||0)<1300)return error(ws,'Gửi tin nhắn chậm lại chút nha!');
    const content=strip(obj.message,160);if(!content)return;
    ws.lastChat=now();for(const p of ctx.room.players)if(p.connected)send(p.socket,{type:'chat',name:ctx.player.name,message:content,time:now()});return;
  }
}
function socketFrame(opcode,payload=Buffer.alloc(0)){
  const length=payload.length;
  let header;
  if(length<126){header=Buffer.from([0x80|opcode,length]);}
  else if(length<65536){header=Buffer.alloc(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(length,2);}
  else {header=Buffer.alloc(10);header[0]=0x80|opcode;header[1]=127;header.writeBigUInt64BE(BigInt(length),2);}
  return Buffer.concat([header,payload]);
}
function connectWebSocket(socket, initial){
  const ws={isOpen:true,socket,buf:Buffer.alloc(0),roomCode:null,playerId:null,lastPong:now(),lastChat:0,
    send(str){if(this.isOpen&&!socket.destroyed)socket.write(socketFrame(1,Buffer.from(str)));},
    close(){if(!this.isOpen)return;this.isOpen=false;try{socket.end(socketFrame(8));}catch{}},
  };
  function drop(){if(ws.dropped)return;ws.dropped=true;ws.isOpen=false;const ctx=userFor(ws);if(ctx && ctx.player.socket===ws){ctx.player.connected=false;ctx.player.socket=null;pushHistory(ctx.room,`📴 ${ctx.player.name} mất kết nối.`);if(ctx.room.hostId===ctx.player.id)ctx.room.hostId=ctx.room.players.find(p=>p.connected)?.id||ctx.room.hostId;broadcast(ctx.room);}}
  socket.on('close',drop);socket.on('error',drop);
  socket.on('data',data=>{
    if(!ws.isOpen)return;
    ws.buf=Buffer.concat([ws.buf,data]);
    if(ws.buf.length>32768){ws.close();return;}
    try{
      while(ws.buf.length>=2){
        const b0=ws.buf[0],b1=ws.buf[1];let off=2;
        if((b0&0x70)!==0 || !(b0&0x80) || !(b1&0x80)){ws.close();return;}
        let n=b1&0x7f;
        if(n===126){if(ws.buf.length<4)break;n=ws.buf.readUInt16BE(2);off=4;}
        else if(n===127){if(ws.buf.length<10)break;const big=ws.buf.readBigUInt64BE(2);if(big>BigInt(8192)){ws.close();return;}n=Number(big);off=10;}
        if(n>8192){ws.close();return;}
        if(ws.buf.length<off+4+n)break;
        const mask=ws.buf.subarray(off,off+4);off+=4;
        const body=Buffer.from(ws.buf.subarray(off,off+n));
        ws.buf=ws.buf.subarray(off+n);
        for(let i=0;i<body.length;i++)body[i]^=mask[i%4];
        const opcode=b0&0x0f;
        if(opcode===8){ws.close();return;}
        if(opcode===9){socket.write(socketFrame(10,body));continue;}
        if(opcode===10){ws.lastPong=now();continue;}
        if(opcode!==1){ws.close();return;}
        message(ws,body.toString('utf8'));
      }
    }catch{ws.close();}
  });
  if(initial.length)socket.emit('data',initial);
  ws.heartbeat=setInterval(()=>{
    if(!ws.isOpen){clearInterval(ws.heartbeat);return;}
    if(now()-ws.lastPong>90000){ws.close();clearInterval(ws.heartbeat);return;}
    if(!socket.destroyed)socket.write(socketFrame(9,Buffer.from('hi')));
  },25000);ws.heartbeat.unref();
  return ws;
}
function createApp(){
  const server=http.createServer((req,res)=>{
    const requestPath=(req.url||'/').split('?')[0];
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    if(requestPath==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({status:'ok',rooms:rooms.size}));}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end('Method not allowed');}
    const filename=CLIENT_FILES[requestPath];
    if(!filename){res.writeHead(404);return res.end('Not found');}
    const filepath=path.join(__dirname,filename);
    fs.readFile(filepath,(err,data)=>{
      if(err){console.error('Không tìm thấy file giao diện:',filepath,err.code);res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Thiếu index.html ở thư mục gốc cùng cấp server.js. Hãy upload đủ 3 file.');}
      // IMPORTANT: Giao diện 3 file có CSS + JS ngay trong index.html.
      // CSP cũ (style-src/script-src 'self') chặn chúng, làm trang mất hết thiết kế.
      // Sinh nonce mới cho từng lượt tải, chỉ cho phép CSS/JS nội bộ tin cậy.
      const nonce=crypto.randomBytes(18).toString('base64');
      const csp=[
        "default-src 'self'",
        "connect-src 'self' ws: wss:",
        "img-src 'self' data:",
        `style-src 'self' 'nonce-${nonce}'`,
        "style-src-attr 'unsafe-inline'",
        `script-src 'self' 'nonce-${nonce}'`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
      ].join('; ');
      res.setHeader('Content-Security-Policy',csp);
      let html=data.toString('utf8');
      html=html.replace('<style>',`<style nonce="${nonce}">`)
               .replace('<script>',`<script nonce="${nonce}">`);
      res.writeHead(200,{'Content-Type':TYPES[path.extname(filename)],'Cache-Control':'no-store, max-age=0'});
      res.end(req.method==='HEAD'?'':html);
    });
  });
  server.on('upgrade',(req,socket,head)=>{
    try{
      const origin=req.headers.origin;
      if(origin&&new URL(origin).host!==req.headers.host){socket.destroy();return;}
      const key=req.headers['sec-websocket-key'];
      if(req.url!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||!key||Buffer.from(key,'base64').length!==16){socket.destroy();return;}
      const accept=crypto.createHash('sha1').update(key+WS_GUID).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
      connectWebSocket(socket,head);
    }catch{socket.destroy();}
  });
  const cleanup=setInterval(()=>{for(const [code,room] of rooms)if(!room.players.some(p=>p.connected)&&now()-room.lastActive>15*60*1000)rooms.delete(code);},60000);
  const timers=setInterval(()=>{for(const room of rooms.values())if(enforceTimeout(room))broadcast(room);},250);
  timers.unref();
  cleanup.unref();
  server.on('close',()=>{clearInterval(cleanup);clearInterval(timers);});
  return server;
}
if(require.main===module){
  const port=Number(process.env.PORT)||3000;
  createApp().listen(port,'0.0.0.0',()=>console.log(`Xi Dzach multiplayer listening on ${port}`));
}
module.exports={createApp,rooms};
