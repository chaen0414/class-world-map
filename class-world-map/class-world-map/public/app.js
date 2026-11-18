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
      g.append('path').attr('d','M0 0 C-6 -7 -7 -11 -7 -15 A7 7 0 0 1 7 -15 C7 -11 6 -7 0 0 Z').attr('stroke','#fff').attr('stroke-width','1.3');
      g.append('circle').attr('cy',-15).attr('r',2.2).attr('fill','#fff');
      g.append('title'); return g; },
    update => update,
    exit => exit.remove()
  ).attr('transform', d => { const p=projectPin(d); const k=d3.zoomTransform(svg.node()).k || 1; return p ? `translate(${p[0]},${p[1]}) scale(${1/k})` : 'translate(-1000,-1000)'; })
   .attr('aria-label', d => `${d.title}: ${d.type}, 메모 보기`)
   .each(function(d) { const el=d3.select(this); el.select('path').attr('fill',color(d.type));el.select('title').text(`${d.title} · ${d.type}`); })
   .on('click', (event, d) => { event.stopPropagation();openEditor(d); })
   .on('keydown', (event,d) => { if(event.key==='Enter'||event.key===' '){ event.preventDefault();openEditor(d); } });
}
// 지도 해상도: 전체 110m -> 확대 50m -> 깊이 확대 10m (줌 종료 후에만 변경).
// Natural Earth 경계 및 지명은 브라우저에서 필요할 때 불러온다.
const MAP_SOURCES = {
  110: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
  50: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
  10: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json'
};
const mapCache = new Map();
let activeResolution = 110;
let detailBorders = null;
let populatedPlaces = null;
let fetchStarted = false;
let zoomFactor = 1;
const detailLayer = terrain.append('g').attr('class','detail-layer');
const labelsLayer = mapRoot.insert('g', '.pin-layer').attr('class','label-layer').style('pointer-events','none');
// 한국어 기본 지명 좌표(경도, 위도). 확대 수준에 따라 화면에 표시한다.
const PLACES = [
['대한민국',127.7,36.2,1,'country'],['북한',127,40.2,1,'country'],['일본',138,37.8,1,'country'],['중국',103,35,1,'country'],['몽골',103,46,1,'country'],['인도',78,22,1,'country'],['러시아',94,61,1,'country'],['미국',-100,39,1,'country'],['캐나다',-107,57,1,'country'],['브라질',-53,-11,1,'country'],['멕시코',-102,23,1,'country'],['아르헨티나',-63,-36,1,'country'],['칠레',-70,-33,1,'country'],['호주',134,-25,1,'country'],['뉴질랜드',172,-42,1,'country'],['프랑스',2.2,46.5,1,'country'],['독일',10.5,51,1,'country'],['영국',-3,54,1,'country'],['이탈리아',12.8,42.5,1,'country'],['스페인',-4,40,1,'country'],['튀르키예',35,39,1,'country'],['이집트',30,27,1,'country'],['남아프리카공화국',24,-29,1,'country'],['사우디아라비아',44,24,1,'country'],['인도네시아',117,-2,1,'country'],['태국',101,15,1,'country'],['베트남',107,16,1,'country'],['필리핀',123,12.5,1,'country'],['파키스탄',69,30,1,'country'],['이란',54,32,1,'country'],['카자흐스탄',68,48,1,'country'],['나이지리아',8,9,1,'country'],['케냐',38,0,1,'country'],['에티오피아',40,9,1,'country'],['그린란드',-42,72,1,'country'],
['태평양',-154,1,1,'sea'],['대서양',-28,0,1,'sea'],['인도양',79,-19,1,'sea'],['북극해',0,79,1,'sea'],
['서울',126.978,37.5665,2,'capital'],['부산',129.074,35.1796,3,'city'],['대구',128.601,35.871,3,'city'],['인천',126.705,37.456,3,'city'],['광주',126.851,35.160,4,'city'],['대전',127.385,36.35,4,'city'],['울산',129.312,35.539,4,'city'],['세종',127.289,36.48,5,'city'],['제주도',126.53,33.49,3,'region'],['강원도',128.3,37.7,4,'region'],['경기도',127.25,37.25,4,'region'],['충청북도',127.75,36.72,5,'region'],['충청남도',126.87,36.55,5,'region'],['전라북도',127.14,35.72,5,'region'],['전라남도',126.9,34.75,5,'region'],['경상북도',128.7,36.35,5,'region'],['경상남도',128.3,35.3,5,'region'],['강릉',128.876,37.752,6,'city'],['춘천',127.73,37.88,6,'city'],['수원',127.028,37.263,6,'city'],['포항',129.366,36.032,6,'city'],['전주',127.148,35.824,6,'city'],['창원',128.681,35.228,6,'city'],['제주시',126.53,33.5,6,'city'],['서귀포',126.56,33.25,7,'city'],
['도쿄',139.692,35.69,2,'capital'],['오사카',135.502,34.694,4,'city'],['삿포로',141.354,43.061,4,'city'],['후쿠오카',130.402,33.59,5,'city'],['베이징',116.407,39.904,2,'capital'],['상하이',121.474,31.23,3,'city'],['홍콩',114.17,22.31,4,'city'],['타이베이',121.56,25.03,3,'capital'],['마닐라',120.985,14.6,3,'capital'],['하노이',105.854,21.028,3,'capital'],['호찌민',106.7,10.82,4,'city'],['방콕',100.5,13.75,3,'capital'],['자카르타',106.85,-6.21,3,'capital'],['싱가포르',103.82,1.35,3,'capital'],['쿠알라룸푸르',101.69,3.14,4,'capital'],['뉴델리',77.21,28.61,3,'capital'],['뭄바이',72.88,19.08,4,'city'],['카트만두',85.32,27.71,4,'capital'],['울란바토르',106.92,47.92,3,'capital'],
['워싱턴 D.C.',-77.04,38.9,2,'capital'],['뉴욕',-74.006,40.713,3,'city'],['로스앤젤레스',-118.24,34.05,3,'city'],['샌프란시스코',-122.42,37.77,4,'city'],['시카고',-87.63,41.88,4,'city'],['마이애미',-80.19,25.76,4,'city'],['시애틀',-122.33,47.61,4,'city'],['휴스턴',-95.37,29.76,4,'city'],['토론토',-79.38,43.65,3,'city'],['밴쿠버',-123.12,49.28,4,'city'],['오타와',-75.7,45.42,4,'capital'],['멕시코시티',-99.133,19.433,3,'capital'],['리마',-77.04,-12.05,3,'capital'],['상파울루',-46.63,-23.55,3,'city'],['리우데자네이루',-43.2,-22.9,4,'city'],['부에노스아이레스',-58.38,-34.6,3,'capital'],['산티아고',-70.67,-33.45,3,'capital'],
['런던',-0.128,51.51,2,'capital'],['파리',2.35,48.86,2,'capital'],['베를린',13.4,52.52,2,'capital'],['로마',12.5,41.9,3,'capital'],['마드리드',-3.7,40.42,3,'capital'],['리스본',-9.14,38.72,4,'capital'],['암스테르담',4.9,52.37,4,'capital'],['브뤼셀',4.35,50.85,4,'capital'],['빈',16.37,48.21,4,'capital'],['바르샤바',21.01,52.23,4,'capital'],['아테네',23.73,37.98,4,'capital'],['이스탄불',28.98,41.01,3,'city'],['모스크바',37.62,55.75,2,'capital'],['키이우',30.52,50.45,3,'capital'],['스톡홀름',18.06,59.33,4,'capital'],
['카이로',31.24,30.04,3,'capital'],['케이프타운',18.42,-33.93,4,'city'],['요하네스버그',28.05,-26.2,4,'city'],['나이로비',36.82,-1.29,4,'capital'],['아디스아바바',38.76,9.03,4,'capital'],['라고스',3.38,6.52,4,'city'],['두바이',55.27,25.2,4,'city'],['리야드',46.68,24.71,4,'capital'],['테헤란',51.39,35.69,3,'capital'],
['시드니',151.21,-33.87,3,'city'],['멜버른',144.96,-37.81,4,'city'],['캔버라',149.13,-35.28,4,'capital'],['오클랜드',174.76,-36.85,3,'city'],['웰링턴',174.78,-41.29,4,'capital']
];
function makeLabelData() {
  return PLACES.map(([name,lng,lat,min,type])=>({name,lng,lat,min,type}));
}
const labelData = makeLabelData();
function updateLabels() {
  if(!mapReady)return;
  const k=d3.zoomTransform(svg.node()).k || 1;
  const screenW=$('map').clientWidth, screenH=$('map').clientHeight;
  const transform=d3.zoomTransform(svg.node());
  const desired=labelData.filter(d=>k>=d.min && (d.type!=='country'||k<5) && (d.type!=='sea'||k<3));
  if(k>=4.5 && populatedPlaces){
    for(const feat of populatedPlaces.features){
      const props=feat.properties||{}, coords=feat.geometry?.coordinates;
      if(!coords || !Number.isFinite(coords[0]))continue;
      const rank=Number(props.SCALERANK??props.scalerank??9);
      if(k<7&&rank>3 || k<11&&rank>5 || k<16&&rank>7)continue;
      const name=props.NAME_KO || props.name_ko || props.NAME || props.name;
      if(!name || labelData.some(d=>d.name===name))continue;
      desired.push({name,lng:coords[0],lat:coords[1],min:4,type:'city'});
      if(desired.length>1800)break;
    }
  }
  // 화면 격자 기반 충돌 검사를 사용해 지명 수가 증가해도 선형에 가깝게 처리한다.
  const cellSize = 48;
  const grid = new Map();
  const visible = desired.filter(d=>{
    const xy=projection([d.lng,d.lat]);if(!xy)return false;
    const x=xy[0]*k+transform.x,y=xy[1]*k+transform.y;
    if(x<0||x>screenW||y<0||y>screenH)return false;
    const width=(d.name.length*9+16),height=17;
    const gx=Math.floor(x/cellSize),gy=Math.floor(y/cellSize);
    for(let ix=gx-2;ix<=gx+2;ix++)for(let iy=gy-1;iy<=gy+1;iy++){
      const bucket=grid.get(`${ix},${iy}`)||[];
      if(bucket.some(p=>Math.abs(p.x-x)<(p.width+width)*.48+5 && Math.abs(p.y-y)<17))return false;
    }
    const key=`${gx},${gy}`;
    if(!grid.has(key))grid.set(key,[]);
    grid.get(key).push({x,y,width});
    return true;
  });
  labelsLayer.selectAll('g.place').data(visible,d=>d.name).join(
    enter=>{const g=enter.append('g').attr('class','place');g.append('circle').attr('r',2.2).attr('class','place-dot');g.append('text').attr('dy','-6').attr('text-anchor','middle');return g;},
    update=>update,exit=>exit.remove()
  ).attr('class',d=>`place place-${d.type}`).attr('transform',d=>{const p=projection([d.lng,d.lat]);return `translate(${p[0]},${p[1]}) scale(${1/k})`;})
  .each(function(d){d3.select(this).select('text').text(d.name);});
}
// 행정구역 경로는 지도 투영/화면 크기가 달라졌을 때만 재생성한다.
// 확대 프레임마다 수많은 SVG 경계선을 다시 만드는 작업을 없앤다.
function updateDetailGeometry() {
  if (!mapReady) return;
  const path=detailLayer.selectAll('path.admin-borders').data(detailBorders ? [detailBorders] : []);
  path.join('path').attr('class','admin-borders').attr('d',geoPath);
  applyDetailVisibility();
}
function applyDetailVisibility() {
  const k=d3.zoomTransform(svg.node()).k || 1;
  detailLayer.style('display',k>=2.25?'':'none');
}
function renderDetail() {
  if(!mapReady)return;
  updateDetailGeometry();
  updateLabels();
}
// 팬/휠 이동 중에는 SVG 그룹 transform만 바꾸고 상세 지도 계산을 생략한다.
let framePending=false;
let settleTimer=null;
function fastZoomFrame(){
  framePending=false;
  if(!mapReady)return;
  renderMarkers();
  applyDetailVisibility();
}
function scheduleZoomFrame(){
  if(framePending)return;
  framePending=true;
  requestAnimationFrame(fastZoomFrame);
}
function settleZoom(){
  if(!mapReady)return;
  zoomFactor=d3.zoomTransform(svg.node()).k;
  updateLabels();
  applyDetailVisibility();
  const target=zoomFactor>=7?10:zoomFactor>=2.25?50:110;
  if(target!==activeResolution)changeResolution(target);
  if(zoomFactor>=2.25)loadAdministrativeBorders();
  if(zoomFactor>=4.5)loadPopulatedPlaces();
}
function drawBase(world) {
  const land=topojson.feature(world,world.objects.land);
  const borders=topojson.mesh(world,world.objects.countries,(a,b)=>a!==b);
  const host=$('map'),width=Math.max(host.clientWidth,320),height=Math.max(host.clientHeight,260);
  svg.attr('viewBox',`0 0 ${width} ${height}`);
  projection=d3.geoEqualEarth().fitExtent([[18,35],[width-18,height-35]],sphere);
  geoPath=d3.geoPath(projection);
  terrain.selectAll('path').remove();
  terrain.insert('path', '.detail-layer').datum(sphere).attr('class','earth-ocean').attr('d',geoPath);
  terrain.insert('path', '.detail-layer').datum(d3.geoGraticule().step([30,30])()).attr('class','earth-grid').attr('d',geoPath);
  terrain.insert('path', '.detail-layer').datum(land).attr('class','earth-land').attr('d',geoPath);
  terrain.insert('path', '.detail-layer').datum(borders).attr('class','earth-borders').attr('d',geoPath);
  terrain.insert('path', '.detail-layer').datum(sphere).attr('class','earth-outline').attr('d',geoPath);
  mapReady=true;renderMarkers();renderDetail();
}
async function loadWorld(resolution){
  if(mapCache.has(resolution))return mapCache.get(resolution);
  const promise=fetch(MAP_SOURCES[resolution]).then(r=>{if(!r.ok)throw Error('세계지도 데이터 다운로드 실패');return r.json();});
  mapCache.set(resolution,promise);
  try{return await promise;}catch(e){mapCache.delete(resolution);throw e;}
}
async function changeResolution(resolution){
  if(activeResolution===resolution)return;
  try{const world=await loadWorld(resolution);if((zoomFactor>=7?10:zoomFactor>=2.25?50:110)!==resolution)return;
    activeResolution=resolution;worldData=world;drawBase(world);
  }catch(e){console.warn('상세 지도가 없어 현재 지도를 유지합니다.',e);}
}
async function loadPopulatedPlaces(){
  if(populatedPlaces || loadPopulatedPlaces.started)return;
  loadPopulatedPlaces.started=true;
  try{
    const url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson';
    const r=await fetch(url);if(!r.ok)throw Error('지명 정보 응답 오류');
    populatedPlaces=await r.json();if(mapReady)updateLabels();
  }catch(e){console.warn('일부 상세 지명을 불러오지 못했습니다.',e);}
}
async function loadAdministrativeBorders(){
  if(fetchStarted)return;
  fetchStarted=true;
  try{
    // Natural Earth 50m 행정 1단계(주/도/성) 경계. 지나치게 큰 파일은 최초 확대 때만 요청.
    const url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
    const r=await fetch(url);if(!r.ok)throw new Error('행정구역 경계 자료 없음');
    const geo=await r.json();detailBorders=geo;updateDetailGeometry();
  }catch(e){console.warn('행정구역 경계는 연결 상태에 따라 생략됩니다.',e);}
}
let worldData;
async function initMap(){
  try{
    worldData=await loadWorld(110);drawBase(worldData);
    $('mapLoading').classList.add('hidden');
    const zoom=d3.zoom().scaleExtent([1,20]).filter(event=>!event.button && (event.type!=='wheel'||!event.ctrlKey))
      .on('zoom',event=>{
        zoomFactor=event.transform.k;
        mapRoot.attr('transform',event.transform);
        scheduleZoomFrame();
        clearTimeout(settleTimer);
        settleTimer=setTimeout(settleZoom,180);
      }).on('end',()=>{
        clearTimeout(settleTimer);
        settleZoom();
      });
    mapZoom=zoom;svg.call(zoom).on('dblclick.zoom',null);
    svg.on('click.pin',event=>{
      if(event.defaultPrevented||!room||!mapReady){if(!room)toast('먼저 학급에 입장하세요.');return;}
      const xy=d3.pointer(event,svg.node());const point=d3.zoomTransform(svg.node()).invert(xy);
      const outline=terrain.select('.earth-ocean').node();
      if(outline&&typeof outline.isPointInFill==='function'){
        const pt=svg.node().createSVGPoint();pt.x=point[0];pt.y=point[1];
        if(!outline.isPointInFill(pt))return;
      }
      const lonLat=projection.invert(point);
      if(!lonLat||!lonLat.every(Number.isFinite)||Math.abs(lonLat[1])>85||Math.abs(lonLat[0])>180)return;
      openEditor({lng:lonLat[0],lat:lonLat[1]});
    });
    $('zoomIn').onclick=()=>svg.transition().duration(300).call(zoom.scaleBy,1.6);
    $('zoomOut').onclick=()=>svg.transition().duration(300).call(zoom.scaleBy,1/1.6);
    $('resetView').onclick=()=>svg.transition().duration(350).call(zoom.transform,d3.zoomIdentity);
    new ResizeObserver(()=>{if(!worldData)return;drawBase(worldData);svg.call(zoom.transform,d3.zoomIdentity);}).observe($('map'));
  }catch(error){console.error(error);$('mapLoading').textContent='세계지도 데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.';}
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
