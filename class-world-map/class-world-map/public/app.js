'use strict';
const $ = id => document.getElementById(id);
const colors = { '태풍':'#e95757', '홍수':'#3789df', '가뭄':'#e8ad3b', '폭설':'#8e9cce', '지진':'#9d7ae7', '산불':'#e97739', '기타':'#64748b' };
const socket = io({ reconnection: true });
let pins = new Map(), markers = new Map(), room = '', nickname = '', draft = null, editId = null, toastTimer;
let projection, geoPath, mapZoom, mapLayer, markerLayer, mapReady = false;
const svg = d3.select('#mapSvg');
const mapRoot = svg.append('g').attr('class', 'map-root');
const terrain = mapRoot.append('g').attr('class', 'terrain');
markerLayer = mapRoot.append('g').attr('class', 'pin-layer');
const sphere = { type: 'Sphere' };
function color(type) { return colors[type] || colors['기타']; }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2900); }
function fmt(date) { return date ? new Date(date).toLocaleString('ko-KR', { month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit' }) : ''; }
function projectPin(pin) { return projection([pin.lng, pin.lat]); }
function renderMarkers() {
  if (!mapReady) return;
  markerLayer.selectAll('g.map-pin').data([...pins.values()], d => d.id).join(
    enter => { const g = enter.append('g').attr('class','map-pin').attr('tabindex',0).attr('role','button');
      g.append('path').attr('d','M0 0 C-10 -12 -11 -18 -11 -23 A11 11 0 0 1 11 -23 C11 -18 10 -12 0 0 Z').attr('stroke','#fff').attr('stroke-width','2');
      g.append('circle').attr('cy',-23).attr('r',3.5).attr('fill','#fff');
      g.append('title'); return g; },
    update => update,
    exit => exit.remove()
  ).attr('transform', d => { const p=projectPin(d); return p ? `translate(${p[0]},${p[1]})` : 'translate(-1000,-1000)'; })
   .attr('aria-label', d => `${d.title}: ${d.type}, 메모 보기`)
   .each(function(d) { const el=d3.select(this); el.select('path').attr('fill',color(d.type));el.select('title').text(`${d.title} · ${d.type}`); })
   .on('click', (event, d) => { event.stopPropagation();openEditor(d); })
   .on('keydown', (event,d) => { if(event.key==='Enter'||event.key===' '){ event.preventDefault();openEditor(d); } });
}
function drawBase(world) {
  const land = topojson.feature(world, world.objects.land);
  const borders = topojson.mesh(world, world.objects.countries, (a,b) => a !== b);
  const host=$('map'); const width=Math.max(host.clientWidth,320), height=Math.max(host.clientHeight,260);
  svg.attr('viewBox',`0 0 ${width} ${height}`);
  projection=d3.geoEqualEarth().fitExtent([[22,35],[width-22,height-35]],sphere);
  geoPath=d3.geoPath(projection);
  terrain.selectAll('*').remove();
  terrain.append('path').datum(sphere).attr('class','earth-ocean').attr('d',geoPath);
  terrain.append('path').datum(d3.geoGraticule().step([30,30])()).attr('class','earth-grid').attr('d',geoPath);
  terrain.append('path').datum(land).attr('class','earth-land').attr('d',geoPath);
  terrain.append('path').datum(borders).attr('class','earth-borders').attr('d',geoPath);
  terrain.append('path').datum(sphere).attr('class','earth-outline').attr('d',geoPath);
  mapReady=true; renderMarkers();
}
let worldData;
async function initMap() {
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    if (!response.ok) throw Error('지도 자료 응답 오류');
    worldData=await response.json();
    drawBase(worldData);
    $('mapLoading').classList.add('hidden');
    const zoom=d3.zoom().scaleExtent([1,12]).filter(event => !event.button && (event.type!=='wheel'||!event.ctrlKey))
      .on('zoom', event => mapRoot.attr('transform',event.transform));
    mapZoom=zoom;svg.call(zoom).on('dblclick.zoom',null);
    svg.on('click.pin',event => {
      if (event.defaultPrevented || !room || !mapReady) { if (!room) toast('먼저 학급에 입장하세요.'); return; }
      // 클릭 좌표를 현재 확대/이동 상태와 이퀄어스 투영을 역변환한다.
      const xy=d3.pointer(event,svg.node());const point=d3.zoomTransform(svg.node()).invert(xy);
      const outline=terrain.select('.earth-ocean').node();
      if (outline && typeof outline.isPointInFill==='function') {
        const pt=svg.node().createSVGPoint(); pt.x=point[0];pt.y=point[1];
        if (!outline.isPointInFill(pt)) return;
      }
      const lonLat=projection.invert(point);
      if (!lonLat || !lonLat.every(Number.isFinite) || Math.abs(lonLat[1])>85 || Math.abs(lonLat[0])>180) return;
      openEditor({lng:lonLat[0],lat:lonLat[1]});
    });
    $('zoomIn').onclick=()=>svg.transition().duration(300).call(zoom.scaleBy,1.6);
    $('zoomOut').onclick=()=>svg.transition().duration(300).call(zoom.scaleBy,1/1.6);
    $('resetView').onclick=()=>svg.transition().duration(350).call(zoom.transform,d3.zoomIdentity);
    new ResizeObserver(()=>{ if (!worldData) return;drawBase(worldData);svg.call(zoom.transform,d3.zoomIdentity); }).observe($('map'));
  } catch(error) { console.error(error); $('mapLoading').textContent='세계지도 데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.'; }
}
function displayPin(pin) { pins.set(pin.id,pin);renderMarkers();renderList(); }
function removePin(id) { pins.delete(id);renderMarkers();renderList(); if (editId === id) closeEditor(); }
function centerPin(pin) {
  if (!mapReady) return;
  const p=projectPin(pin); if (!p) return;
  const width=$('map').clientWidth,height=$('map').clientHeight;
  const scale=Math.max(2.4,d3.zoomTransform(svg.node()).k);
  const t=d3.zoomIdentity.translate(width/2-scale*p[0],height/2-scale*p[1]).scale(scale);
  svg.transition().duration(450).call(mapZoom.transform,t);
}
function renderList() {
  const list = $('pinList'); list.replaceChildren(); $('pinCount').textContent = `${pins.size}개`;
  const sorted = [...pins.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if (!sorted.length) { const p = document.createElement('div'); p.className='empty'; p.textContent='아직 탐구 기록이 없어요. 지도에서 원하는 위치를 클릭해 첫 핀을 만들어 보세요!';list.append(p);return; }
  for (const pin of sorted) {
    const b=document.createElement('button');b.type='button';b.className='listpin';
    const dot=document.createElement('span');dot.className='dot';dot.style.background=color(pin.type);
    const content=document.createElement('span');const title=document.createElement('b');title.textContent=pin.title;
    const detail=document.createElement('small');detail.textContent=`${pin.type} · ${pin.author} · ${fmt(pin.updatedAt)}`;
    content.append(title,detail);b.append(dot,content);
    b.addEventListener('click',()=>{centerPin(pin);openEditor(pin);});list.append(b);
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
$('closeEditor').addEventListener('click',closeEditor);
$('cancelPin').addEventListener('click',closeEditor);
$('editorOverlay').addEventListener('click',e=>{if(e.target===$('editorOverlay'))closeEditor();});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && !$('editorOverlay').classList.contains('hidden'))closeEditor();});
function send(event,payload,cb) { if (!socket.connected){ $('editError').textContent='서버 연결이 끊어졌습니다. 연결 후 다시 시도하세요.';return; }socket.timeout(8000).emit(event,payload,(err,result)=>{if(err)return cb({ok:false,error:'서버 응답이 없습니다. 잠시 후 다시 시도하세요.'});cb(result || {ok:false,error:'요청 처리 실패'});}); }
$('pinForm').addEventListener('submit',e=>{
  e.preventDefault(); if(!draft)return;
  const payload={...draft,title:$('pinTitle').value,type:$('pinType').value,note:$('pinNote').value};
  if(editId)payload.id=editId;
  $('savePin').disabled=true;const isEdit=Boolean(editId);
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
    pins.clear();for(const pin of res.pins) pins.set(pin.id,pin);renderMarkers();renderList();
    $('roomLabel').textContent=`🏫 ${room}`;$('members').textContent=`접속 ${res.count}명`;
    $('joinOverlay').classList.add('hidden');$('switchRoom').hidden=false;toast(`${room}에 입장했습니다.`);
  });
}
$('joinForm').addEventListener('submit',e=>{e.preventDefault();joinClass($('roomInput').value,$('nameInput').value);});
$('switchRoom').addEventListener('click',()=>{$('joinOverlay').classList.remove('hidden');$('roomInput').focus();});
socket.on('connect',()=>{ $('net').textContent='실시간 연결됨';$('net').className='network online';if(room)joinClass(room,nickname); });
socket.on('disconnect',()=>{$('net').textContent='재연결 중';$('net').className='network offline';});
socket.on('pin:created',displayPin);
socket.on('pin:updated',displayPin);
socket.on('pin:deleted',removePin);
socket.on('participants',count=>{$('members').textContent=`접속 ${count}명`;});
$('roomInput').value=sessionStorage.getItem('class-map-room')||'우리반1';
$('nameInput').value=sessionStorage.getItem('class-map-name')||'';
renderList();initMap();
