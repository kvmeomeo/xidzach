'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORAGE='xidzach_v2_session';
  let ws=null, state=null, session=readSession(), queue=null, reconnectTimer=null, manualLeave=false, chat=[], lastSignature='', toastTimer=null;
  const firstUrlRoom=(new URLSearchParams(location.search).get('room')||'').trim().toUpperCase();
  $('roomCode').value=firstUrlRoom.replace(/[^A-Z0-9]/g,'').slice(0,6);
  if(session?.name)$('playerName').value=session.name;

  function readSession(){try{return JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{return null;}}
  function saveSession(){try{if(session)localStorage.setItem(STORAGE,JSON.stringify(session));else localStorage.removeItem(STORAGE);}catch{}}
  function toast(message){const t=$('toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3500);}
  function network(type){const el=$('netState');el.className='net '+type;el.innerHTML='<i></i>'+(type==='online'?'Đã kết nối':type==='offline'?'Mất kết nối':'Đang kết nối');}
  function send(o){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o));else toast('Đang kết nối máy chủ, thử lại sau ít giây.');}
  function connect(){
    if(ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
    network('connecting');
    ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws');
    ws.onopen=()=>{
      network('online');
      if(queue){const q=queue;queue=null;send(q);}
      else if(session?.code && session?.token && (!firstUrlRoom || firstUrlRoom===session.code)) send({type:'enter',action:'join',code:session.code,token:session.token,name:session.name});
      else if(state?.code && session?.token)send({type:'enter',action:'join',code:session.code,token:session.token,name:session.name});
    };
    ws.onmessage=e=>{
      let data;try{data=JSON.parse(e.data);}catch{return;}
      if(data.type==='error'){
        toast('⚠️ '+data.message);
        if(session?.code&&/Không tìm thấy phòng/.test(data.message)){state=null;session=null;saveSession();chat=[];$('landing').hidden=false;$('roomPage').hidden=true;history.replaceState(null,'',location.pathname);}
        return;
      }
      if(data.type==='joined'){
        session={code:data.code,token:data.token,name:data.name};saveSession();
        history.replaceState(null,'',location.pathname+'?room='+encodeURIComponent(data.code));
        $('landing').hidden=true;$('roomPage').hidden=false;
        return;
      }
      if(data.type==='state'){state=data;render();return;}
      if(data.type==='chat'){
        chat.push(data);if(chat.length>55)chat.shift();renderChat();
      }
      if(data.type==='left'){
        state=null;session=null;saveSession();chat=[];
        history.replaceState(null,'',location.pathname);
        $('landing').hidden=false;$('roomPage').hidden=true;$('roomCode').value='';
      }
    };
    ws.onclose=()=>{
      network('offline');
      if(!manualLeave){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,1800);}
    };
    ws.onerror=()=>network('offline');
  }
  function enter(action){
    const name=$('playerName').value.trim().replace(/\s+/g,' ').slice(0,22);
    if(!name){$('playerName').focus();toast('Nhập tên của bạn trước nha!');return;}
    const code=$('roomCode').value.trim().toUpperCase().replace(/\s+/g,'');
    if(action==='join'&&!/^[A-Z2-9]{6}$/.test(code)){toast('Mã phòng gồm 6 ký tự.');$('roomCode').focus();return;}
    if(action==='create')session=null;
    const req={type:'enter',action,name,...(action==='join'?{code,token:session?.code===code?session.token:undefined}:{})};
    if(ws?.readyState===WebSocket.OPEN)send(req);
    else {queue=req;manualLeave=false;connect();toast('Đang kết nối tới bàn bài…');}
  }
  const act=(action,more={})=>send({type:'action',action,...more});
  const me=()=>state?.players.find(p=>p.id===state.myId);
  const dealer=()=>state?.players.find(p=>p.id===state.dealerId);
  const isHost=()=>state?.myId===state?.hostId;
  const isDealer=()=>state?.myId===state?.dealerId;
  function cardsHTML(cards){
    if(!cards?.length)return '<div class="hand-cards" aria-label="Chưa chia bài"></div>';
    return '<div class="hand-cards">'+cards.map(card=>{
      if(!card)return '<span class="playing-card back" title="Lá bài bí mật"></span>';
      const color=card.suit==='♥'||card.suit==='♦'?' red':'';
      return `<span class="playing-card${color}" title="${esc(card.rank)} ${esc(card.suit)}"><span class="topcorner">${esc(card.rank)}<small>${esc(card.suit)}</small></span><span class="center-suit">${esc(card.suit)}</span><span class="bottomcorner">${esc(card.rank)}</span></span>`;
    }).join('')+'</div>';
  }
  function textStatus(player){
    if(state.phase==='lobby')return 'Sẵn sàng vào ván';
    if(player.cards.length===0)return 'Chờ chia bài';
    let t='';
    if(player.revealed||player.id===state.myId){
      if(player.hand){const kind=player.hand.kind;const extra=kind==='bust'?'bust':['bang','dach','ngu'].includes(kind)?'special':'';
        t=`<span class="${extra}">${esc(player.hand.label)}</span>`;}
    }else t=player.status==='active'?'Đang cân nhắc…':'Đã dằn / hoàn thành';
    if(player.result){
      const result={win:['NHÀ CON THẮNG','winner'],lose:['NHÀ CÁI THẮNG','loser'],tie:['HÒA','']}[player.result];
      t+=` <span class="${result[1]}">• ${result[0]}</span>`;
    }
    if(player.folded)t+=' • Bỏ lượt';
    return t;
  }
  function seatHTML(player,asDealer=false){
    const mine=player.id===state.myId;
    const judgeButton=!asDealer&&isDealer()&&state.phase==='dealer'&&state.dealerLocked&&!player.result;
    const skipButton=!asDealer&&isHost()&&state.phase==='players'&&!player.connected&&player.status==='active';
    const icon=asDealer?'👑':'🂠';
    return `<div class="seat ${mine?'self':''}">
      <div class="labelchip ${asDealer?'dealer':''}">${icon} ${asDealer?'NHÀ CÁI':mine?'BÀI CỦA BẠN':'NHÀ CON'}</div>
      <div class="namebar">${asDealer?'<span class="crown">♛</span>':''}<span class="name" title="${esc(player.name)}">${esc(player.name)}</span>${mine?' <span class="disconnected">(bạn)</span>':''}${!player.connected?' <span class="disconnected">• offline</span>':''}</div>
      ${cardsHTML(player.cards)}
      <div class="seat-status">${textStatus(player)}</div>
      ${judgeButton?`<button type="button" class="mini-action" data-action="judge" data-target="${player.id}">🔎 XÉT BÀI</button>`:''}
      ${skipButton?`<button type="button" class="mini-action redact" data-action="skip" data-target="${player.id}">BỎ LƯỢT</button>`:''}
    </div>`;
  }
  const btn=(text,action,cls,extra={})=>`<button type="button" class="action-btn ${cls}" data-action="${action}" ${Object.entries(extra).map(([k,v])=>`data-${k}="${esc(v)}"`).join(' ')}>${text}</button>`;
  function renderActions(){
    const p=me(), ownDealer=isDealer(), host=isHost();
    if(!p)return;
    let hint='',buttons=[];
    if(['lobby','finished'].includes(state.phase)){
      const online=state.players.filter(v=>v.connected).length;
      hint=state.phase==='finished'?'🏁 Ván đã kết thúc! Chủ phòng có thể chia ván mới.':`Mời đủ người vào phòng! Hiện có ${online}/${state.maxPlayers} người.`;
      if(host)buttons.push(btn(state.phase==='finished'?'🃏 CHIA VÁN MỚI':'🃏 CHIA BÀI BẮT ĐẦU','start','gold'));
      else buttons.push('<div class="waiting-text">⏳ Đợi chủ phòng chia bài…</div>');
    }else if(state.phase==='players'){
      if(ownDealer){hint='👑 Bạn là Nhà cái. Chờ các Nhà con kéo/dằn xong rồi tới bạn.';}
      else if(p.status==='active'){
        hint='🃏 Tới lượt bạn. Kéo thêm lá hoặc dằn bài khi đủ 16 điểm.';
        buttons.push(btn('🂠 KÉO BÀI','draw','gold'));
        const canStand=p.hand&&p.hand.kind!=='under';
        if(canStand)buttons.push(btn('✋ DẰN BÀI','stand','green'));
      }else hint='✋ Bạn đã hoàn thành. Đang chờ các nhà con khác…';
      if(host)buttons.push(btn('⏹ HỦY VÁN','cancel','ink'));
    }else if(state.phase==='dealer'){
      if(ownDealer){
        hint=state.dealerLocked?'🔎 Bài đã chốt! Xét từng nhà con ngay trên bàn hoặc xét tất cả.':`👑 Tới lượt Nhà cái. Kéo tiếp hoặc chốt bài từ ${state.rules.dealerMin} điểm.`;
        if(!state.dealerLocked){
          buttons.push(btn('🂠 NHÀ CÁI KÉO','draw','gold'));
          if(p.hand&&p.hand.kind!=='under' || p.hand?.score>=state.rules.dealerMin)buttons.push(btn('✋ CHỐT BÀI','stand','green'));
        }else buttons.push(btn('🔎 XÉT CẢ BÀN','judge_all','gold'));
      }else hint='🔎 Nhà cái đang xét bài… Bạn chờ công bố kết quả nha!';
      if(host)buttons.push(btn('⏹ HỦY VÁN','cancel','ink'));
    }
    $('turnHint').textContent=hint;
    $('actions').innerHTML=buttons.join('');
  }
  function renderSeats(){
    const d=dealer();$('dealerSeat').innerHTML=d?seatHTML(d,true):'';
    const children=state.players.filter(p=>p.id!==state.dealerId);
    $('playersZone').innerHTML=children.length?children.map(p=>seatHTML(p)).join(''):'<div class="empty-seats">🪑 Chưa có nhà con nào • Chia sẻ mã phòng cho bạn bè!</div>';
    $('peopleCount').textContent=state.players.filter(p=>p.connected).length+'/'+state.maxPlayers;
    $('seatsList').innerHTML=state.players.map(p=>{
      const kick=isHost()&&!p.connected&&['lobby','finished'].includes(state.phase);
      return `<div class="seat-row ${p.id===state.myId?'me':''}"><div class="seat-avatar">${p.id===state.dealerId?'♛':esc(p.name[0]?.toUpperCase()||'?')}</div><div class="seat-details"><strong>${esc(p.name)} ${p.id===state.myId?'(bạn)':''}</strong><small class="${p.connected?'':'off'}">${p.id===state.dealerId?'👑 Nhà cái • ':''}${p.connected?'● Có mặt':'● Mất kết nối'}</small><div class="row-stats">🏆 ${p.stats.win} thắng · ${p.stats.lose} thua · ${p.stats.tie} hòa</div></div><div class="row-icons">${p.isHost?'<b title="Chủ phòng">⭐</b>':''}${kick?`<button title="Dọn ghế trống" data-action="kick" data-target="${p.id}">✕</button>`:''}</div></div>`;
    }).join('');
  }
  function renderSettings(){
    const allowed=isHost()&&['lobby','finished'].includes(state.phase);
    $('hostSettings').hidden=!allowed;
    if(allowed){
      $('dealerSelect').innerHTML=state.players.filter(p=>p.connected).map(p=>`<option value="${p.id}" ${p.id===state.dealerId?'selected':''}>${esc(p.name)}${p.id===state.myId?' (bạn)':''}</option>`).join('');
      $('minSelect').value=String(state.rules.dealerMin);
    }
  }
  function renderHistory(){
    $('historyList').innerHTML=state.history.length?state.history.map(h=>{
      const date=new Date(h.time);const time=date.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
      return `<div class="history-entry"><time>${esc(time)}</time>${esc(h.text)}</div>`;
    }).join(''):'<div class="history-entry">Chưa có hoạt động.</div>';
  }
  function renderChat(){
    const feed=$('chatMessages');if(!feed)return;
    feed.innerHTML=chat.length?chat.map(c=>`<div class="chat-message"><strong>${esc(c.name)}</strong><span>${esc(c.message)}</span></div>`).join(''):'<div class="chat-empty">Chưa ai nói gì. Gửi lời chào nào!</div>';
    feed.scrollTop=feed.scrollHeight;
  }
  function render(){
    if(!state)return;
    $('landing').hidden=true;$('roomPage').hidden=false;
    $('codeDisplay').textContent=state.code;
    const phases={lobby:'⏳ CHỜ NGƯỜI CHƠI',players:'🃏 NHÀ CON KÉO',dealer:'👑 NHÀ CÁI XÉT',finished:'🏁 XONG VÁN'};
    $('phasePill').textContent=phases[state.phase]||state.phase;
    $('deckDisplay').textContent='CÒN '+state.deckCount+' LÁ';
    $('tableInfo').textContent=state.phase==='lobby'?'Chờ đủ người vào bàn…':state.phase==='finished'?`VÁN ${state.round} HOÀN THÀNH`:state.phase==='players'?`VÁN ${state.round} • NHÀ CON KÉO`:`VÁN ${state.round} • NHÀ CÁI XÉT`;
    renderSeats();renderActions();renderSettings();renderHistory();
    const own=me();
    const sig=state.round+':'+state.phase+':'+own?.result;
    if(sig!==lastSignature && state.phase==='finished' && own?.result==='win')celebrate();
    lastSignature=sig;
  }
  function celebrate(){
    for(let i=0;i<25;i++){
      const piece=document.createElement('span');piece.textContent=['♥','♠','♦','♣','★'][i%5];
      piece.style.cssText=`position:fixed;z-index:120;left:${Math.random()*100}vw;top:-30px;pointer-events:none;font-size:${12+Math.random()*18}px;color:${i%2?'#eac578':'#9eedbc'};transition:top ${1.5+Math.random()*1.5}s linear,transform 2s linear;`;
      document.body.appendChild(piece);requestAnimationFrame(()=>{piece.style.top='106vh';piece.style.transform=`rotate(${(Math.random()-.5)*880}deg)`;});setTimeout(()=>piece.remove(),3200);
    }
  }
  async function copy(text){
    try{await navigator.clipboard.writeText(text);toast('✅ Đã sao chép!');}
    catch{
      const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('✅ Đã sao chép!');}catch{toast('Không thể sao chép. Hãy chọn mã trên màn hình.');}ta.remove();
    }
  }
  function inviteLink(){return location.origin+location.pathname+'?room='+encodeURIComponent(state.code);}
  $('createBtn').addEventListener('click',()=>enter('create'));
  $('joinBtn').addEventListener('click',()=>enter('join'));
  $('roomCode').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});
  $('roomCode').addEventListener('keydown',e=>{if(e.key==='Enter')enter('join');});
  $('playerName').addEventListener('keydown',e=>{if(e.key==='Enter')$('createBtn').click();});
  $('copyCodeBtn').addEventListener('click',()=>state&&copy(state.code));
  $('shareBtn').addEventListener('click',()=>{
    if(!state)return;
    const url=inviteLink();
    if(navigator.share)navigator.share({title:'Vô bàn Xì Dzách với tui nè!',text:'Mã phòng: '+state.code,url}).catch(()=>{});
    else copy(url);
  });
  $('leaveBtn').addEventListener('click',()=>{
    if(!state)return;
    if(['players','dealer'].includes(state.phase)&&!confirm('Bạn đang giữa ván. Rời phòng sẽ làm gián đoạn lượt chơi, tiếp tục không?'))return;
    act('leave');
    // Không tự đóng socket: nhận thông báo đã rời phòng rồi quay về màn hình chính.
  });
  $('dealerSelect').addEventListener('change',e=>act('set_dealer',{target:e.target.value}));
  $('minSelect').addEventListener('change',e=>act('set_min',{value:Number(e.target.value)}));
  $('roomPage').addEventListener('click',e=>{
    const button=e.target.closest('button[data-action]');if(!button)return;
    const action=button.dataset.action,target=button.dataset.target;
    if(action==='cancel'&&!confirm('Hủy ván hiện tại? Ván sẽ không tính thành tích.'))return;
    if(action==='kick'&&!confirm('Dọn ghế người đã mất kết nối?'))return;
    act(action,target?{target}:{});
  });
  $('chatForm').addEventListener('submit',e=>{
    e.preventDefault();const input=$('chatInput');const message=input.value.trim();if(!message)return;
    send({type:'chat',message});input.value='';
  });
  const openHelp=()=>{$('helpModal').hidden=false;};
  const closeHelp=()=>{$('helpModal').hidden=true;};
  $('helpBtn').addEventListener('click',openHelp);
  $('closeHelp').addEventListener('click',closeHelp);
  $('closeHelp2').addEventListener('click',closeHelp);
  $('helpModal').addEventListener('click',e=>{if(e.target===$('helpModal'))closeHelp();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHelp();});
  connect();
})();
