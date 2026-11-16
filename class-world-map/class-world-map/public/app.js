'use strict';
const $ = id => document.getElementById(id);
const colors = { '태풍':'#e95757', '홍수':'#3789df', '가뭄':'#e8ad3b', '폭설':'#8e9cce', '지진':'#9d7ae7', '산불':'#e97739', '기타':'#64748b' };
const socket = io({ reconnection: true });
const map = L.map('map', { worldCopyJump: true, minZoom: 2, maxZoom: 14 }).setView([19, 12], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
const bounds = L.latLngBounds([[-84,-180],[84,180]]);
map.setMaxBounds(bounds.pad(0.4));
let pins = new Map(), markers = new Map(), room = '', nickname = '', draft = null, editId = null, toastTimer;
function color(type) { return colors[type] || colors['기타']; }
function markerIcon(type) { return L.divIcon({ className:'', iconSize:[27,38], iconAnchor:[13,34], html:`<div class="custom-marker"><div class="head" style="background:${color(type)}"></div><div class="center"></div></div>` }); }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600); }
function fmt(date) { return date ? new Date(date).toLocaleString('ko-KR', { month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit' }) : ''; }
function displayPin(pin) {
  const old = markers.get(pin.id);
  if (old) map.removeLayer(old);
  const marker = L.marker([pin.lat, pin.lng], { icon: markerIcon(pin.type), title: pin.title });
  marker.on('click', () => openEditor(pin)); marker.addTo(map);
  markers.set(pin.id, marker); pins.set(pin.id,pin);
  renderList();
}
function removePin(id) { const marker = markers.get(id); if (marker) map.removeLayer(marker); markers.delete(id); pins.delete(id); renderList(); if (editId === id) closeEditor(); }
function renderList() {
  const list = $('pinList'); list.replaceChildren();
  $('pinCount').textContent = `${pins.size}개`;
  const sorted = [...pins.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if (!sorted.length) { const p = document.createElement('div'); p.className='empty'; p.textContent='아직 탐구 기록이 없어요. 지도에서 원하는 위치를 클릭해 첫 핀을 만들어 보세요!';list.append(p);return; }
  for (const pin of sorted) {
    const b=document.createElement('button');b.type='button';b.className='listpin';
    const dot=document.createElement('span');dot.className='dot';dot.style.background=color(pin.type);
    const content=document.createElement('span');const title=document.createElement('b');title.textContent=pin.title;
    const detail=document.createElement('small');detail.textContent=`${pin.type} · ${pin.author} · ${fmt(pin.updatedAt)}`;
    content.append(title,detail);b.append(dot,content);
    b.addEventListener('click',()=>{map.setView([pin.lat,pin.lng],Math.max(map.getZoom(),5),{animate:true});openEditor(pin);});list.append(b);
  }
}
function openEditor(pinOrPosition) {
  const exists=Boolean(pinOrPosition.id); editId=exists?pinOrPosition.id:null;
  draft={lat:pinOrPosition.lat,lng:pinOrPosition.lng};
  $('editorTitle').textContent=exists?'탐구 기록 보기 · 수정':'새 탐구 기록';
  $('pinTitle').value=exists?pinOrPosition.title:'';
  $('pinType').value=exists?pinOrPosition.type:'태풍';
  $('pinNote').value=exists?pinOrPosition.note:'';
  $('pinPos').textContent=`위치: ${draft.lat.toFixed(3)}°, ${draft.lng.toFixed(3)}°`;
  $('pinMeta').textContent=exists?`작성: ${pinOrPosition.author} · 최종 변경 ${fmt(pinOrPosition.updatedAt)}`:'';
  $('deletePin').classList.toggle('hidden',!exists);
  $('savePin').textContent=exists?'변경사항 저장':'핀 저장하기';
  $('editError').textContent='';$('editorOverlay').classList.remove('hidden');$('pinTitle').focus();
}
function closeEditor() { $('editorOverlay').classList.add('hidden');draft=null;editId=null; }
map.on('click',e=>{if (!room) return toast('먼저 학급에 입장하세요.');openEditor(e.latlng);});
$('resetView').addEventListener('click',()=>map.setView([19,12],2));
$('closeEditor').addEventListener('click',closeEditor);
$('cancelPin').addEventListener('click',closeEditor);
$('editorOverlay').addEventListener('click',e=>{if(e.target===$('editorOverlay'))closeEditor();});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && !$('editorOverlay').classList.contains('hidden'))closeEditor();});
function send(event,payload,cb) { if (!socket.connected){ $('editError').textContent='서버 연결이 끊어졌습니다. 연결 후 다시 시도하세요.';return; }socket.timeout(8000).emit(event,payload,(err,result)=>{if(err)return cb({ok:false,error:'서버 응답이 없습니다. 잠시 후 다시 시도하세요.'});cb(result || {ok:false,error:'요청 처리 실패'});}); }
$('pinForm').addEventListener('submit',e=>{
  e.preventDefault(); if(!draft)return;
  const payload={...draft,title:$('pinTitle').value,type:$('pinType').value,note:$('pinNote').value};
  if(editId)payload.id=editId;
  $('savePin').disabled=true;
  const isEdit = Boolean(editId);
  send(isEdit?'pin:update':'pin:create',payload,result=>{$('savePin').disabled=false;if(!result.ok){$('editError').textContent=result.error;return;}closeEditor();toast(isEdit?'수정되었습니다.':'저장되었습니다.');});
});
$('deletePin').addEventListener('click',()=>{
  if(!editId)return;if(!confirm('이 핀과 메모를 모든 학생의 지도에서 삭제할까요?'))return;
  $('deletePin').disabled=true;send('pin:delete',editId,result=>{$('deletePin').disabled=false;if(!result.ok){$('editError').textContent=result.error;return;}closeEditor();toast('삭제되었습니다.');});
});
function joinClass(code,name) {
  if(!socket.connected){$('joinError').textContent='서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.';return;}
  $('joinError').textContent='';
  socket.timeout(8000).emit('join',{room:code,name},(err,res)=>{
    if(err||!res?.ok){$('joinError').textContent=res?.error||'학급에 입장하지 못했습니다.';return;}
    room=res.room;nickname=res.name;sessionStorage.setItem('class-map-room',room);sessionStorage.setItem('class-map-name',nickname);
    for(const marker of markers.values())map.removeLayer(marker);markers.clear();pins.clear();
    for(const pin of res.pins)displayPin(pin);
    $('roomLabel').textContent=`🏫 ${room}`;$('members').textContent=`접속 ${res.count}명`;
    $('joinOverlay').classList.add('hidden');$('switchRoom').hidden=false;setTimeout(()=>map.invalidateSize(),100);toast(`${room}에 입장했습니다.`);
  });
}
$('joinForm').addEventListener('submit',e=>{e.preventDefault();joinClass($('roomInput').value,$('nameInput').value);});
$('switchRoom').addEventListener('click',()=>{$('joinOverlay').classList.remove('hidden');$('roomInput').focus();});
socket.on('connect',()=>{ $('net').textContent='실시간 연결됨';$('net').className='network online';if(room)joinClass(room,nickname); });
socket.on('disconnect',()=>{$('net').textContent='재연결 중';$('net').className='network offline';});
socket.on('pin:created',pin=>{displayPin(pin);});
socket.on('pin:updated',pin=>{displayPin(pin);});
socket.on('pin:deleted',id=>{removePin(id);});
socket.on('participants',count=>{$('members').textContent=`접속 ${count}명`;});
$('roomInput').value=sessionStorage.getItem('class-map-room')||'우리반1';
$('nameInput').value=sessionStorage.getItem('class-map-name')||'';
renderList();
