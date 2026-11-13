'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp,rooms}=require('../server');
const {evaluate}=require('../game-core');

function client(url){
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(url);const messages=[];
  ws.addEventListener('open',()=>resolve({ws,messages,send:o=>ws.send(JSON.stringify(o)),
    async take(type,pred=()=>true,timeout=3000){
      for(let i=0;i<messages.length;i++)if(messages[i].type===type&&pred(messages[i]))return messages.splice(i,1)[0];
      return new Promise((res,rej)=>{const t=setTimeout(()=>{ws.removeEventListener('message',listen);rej(new Error(`timeout ${type}`));},timeout);
        function listen(e){let m;try{m=JSON.parse(e.data);}catch{return;}if(m.type===type&&pred(m)){clearTimeout(t);ws.removeEventListener('message',listen);res(m);}}
        ws.addEventListener('message',listen);
      });
    }}));
  ws.addEventListener('message',e=>{try{messages.push(JSON.parse(e.data));}catch{}});
  ws.addEventListener('error',reject);
 });
}
function delay(ms=100){return new Promise(r=>setTimeout(r,ms));}

test('Kết nối WebSocket, chơi multiplayer đúng lượt và giữ bài kín',async()=>{
 const server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,base=`ws://127.0.0.1:${port}/ws`;
 const a=await client(base),b=await client(base);
 try{
  const health=await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status,200);
  a.send({type:'enter',action:'create',name:'Chủ phòng'});
  const joinA=await a.take('joined');
  assert.match(joinA.code,/^[A-Z2-9]{6}$/);
  b.send({type:'enter',action:'join',name:'Bạn B',code:joinA.code});
  const joinB=await b.take('joined');
  assert.ok(joinB.token);
  await b.take('state',s=>s.players.length===2);
  a.send({type:'action',action:'start'});
  let sa=await a.take('state',s=>s.round===1 && ['players','dealer'].includes(s.phase));
  let sb=await b.take('state',s=>s.round===1 && ['players','dealer'].includes(s.phase));
  assert.equal(sa.players.length,2);
  const pa=sa.players.find(p=>p.id===sa.myId),pb=sa.players.find(p=>p.id!==sa.myId);
  assert.equal(pa.cards.filter(Boolean).length,2,'Nhà cái thấy bài mình');
  assert.equal(pb.cards.filter(Boolean).length,0,'Nhà cái không thấy bài người khác');
  assert.equal(sb.players.find(p=>p.id===sa.myId).cards.filter(Boolean).length,0,'Nhà con không thấy bài nhà cái');
  let state=sb;
  for(let i=0;i<5 && state.phase==='players';i++){
    const me=state.players.find(p=>p.id===state.myId);
    if(me.status!=='active')break;
    if(me.hand.kind!=='under') b.send({type:'action',action:'stand'});
    else b.send({type:'action',action:'draw'});
    state=await b.take('state',s=>s.phase==='dealer'||s.players.find(p=>p.id===s.myId).cards.length>me.cards.length||s.players.find(p=>p.id===s.myId).status!=='active');
  }
  assert.equal(state.phase,'dealer','Nhà con hoàn thành chuyển lượt nhà cái');
  let dState=await a.take('state',s=>s.phase==='dealer');
  for(let i=0;i<5;i++){
    const own=dState.players.find(p=>p.id===dState.myId);
    if(dState.dealerLocked)break;
    if(own.hand.kind!=='under' || own.hand.score>=dState.rules.dealerMin)a.send({type:'action',action:'stand'});
    else a.send({type:'action',action:'draw'});
    dState=await a.take('state',s=>s.dealerLocked||s.players.find(p=>p.id===s.myId).cards.length>own.cards.length);
  }
  assert.equal(dState.dealerLocked,true);
  a.send({type:'action',action:'judge_all'});
  const finished=await b.take('state',s=>s.phase==='finished');
  assert.equal(finished.players.every(p=>p.cards.every(Boolean)),true,'Kết thúc lật toàn bộ bài');
  assert.ok(['win','lose','tie'].includes(finished.players.find(p=>p.id===finished.myId).result));
  const room=rooms.get(joinA.code);
  assert.equal(room.phase,'finished');
  assert.equal(evaluate(room.players[0].cards).kind!=='none',true);
  // Chơi nhiều ván được, không cần tạo phòng mới.
  a.send({type:'action',action:'start'});
  const next=await a.take('state',s=>s.round===2&&['players','dealer'].includes(s.phase));
  assert.equal(next.round,2);
 } finally{
  a.ws.close();b.ws.close();
  await delay(120);
  await new Promise(r=>server.close(r));
 }
});
