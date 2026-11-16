'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20_000 });
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
let rooms = {};
try { const v = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) rooms = v; }
catch (e) { if (e.code !== 'ENOENT') console.error('저장 파일을 읽지 못했습니다:', e.message); }
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rooms, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function roomKey(value) { return typeof value === 'string' ? value.trim().toUpperCase() : ''; }
function validRoom(r) { return /^[A-Z0-9가-힣_-]{3,24}$/u.test(r); }
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validCoords(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180; }
const TYPES = ['태풍', '홍수', '가뭄', '폭설', '지진', '산불', '기타'];
function validatePin(payload) {
  if (!payload || typeof payload !== 'object' || !validCoords(payload.lat, payload.lng)) return { error: '지도 위치가 올바르지 않습니다.' };
  const title = clean(payload.title, 70), note = clean(payload.note, 1500), type = clean(payload.type, 12);
  if (!title) return { error: '지역 이름을 입력하세요.' };
  if (!TYPES.includes(type)) return { error: '재해 종류가 올바르지 않습니다.' };
  return { pin: { lat: payload.lat, lng: payload.lng, title, note, type } };
}
function state(room) { return { pins: rooms[room] || [], count: io.sockets.adapter.rooms.get(room)?.size || 0 }; }
function ackReply(ack, value) { if (typeof ack === 'function') ack(value); }
function broadcastCount(room) { io.to(room).emit('participants', io.sockets.adapter.rooms.get(room)?.size || 0); }
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
io.on('connection', (socket) => {
  socket.on('join', (data, ack) => {
    const room = roomKey(data?.room);
    const name = clean(data?.name, 24);
    if (!validRoom(room)) return ackReply(ack, { ok: false, error: '학급 코드는 3~24자의 한글, 영문, 숫자, - 또는 _로 입력하세요.' });
    if (!name) return ackReply(ack, { ok: false, error: '이름이나 별명을 입력하세요.' });
    if (socket.data.room) { const old = socket.data.room; socket.leave(old); broadcastCount(old); }
    socket.data.room = room;
    socket.data.name = name;
    if (!rooms[room]) rooms[room] = [];
    socket.join(room);
    ackReply(ack, { ok: true, room, name, ...state(room) });
    broadcastCount(room);
  });
  socket.on('pin:create', (payload, ack) => {
    const room = socket.data.room;
    if (!room) return ackReply(ack, { ok: false, error: '학급에 먼저 입장하세요.' });
    const { pin, error } = validatePin(payload);
    if (error) return ackReply(ack, { ok: false, error });
    if (rooms[room].length >= 250) return ackReply(ack, { ok: false, error: '학급당 최대 250개의 핀을 만들 수 있습니다.' });
    const now = new Date().toISOString();
    const record = { ...pin, id: crypto.randomUUID(), author: socket.data.name, createdAt: now, updatedAt: now };
    rooms[room].push(record);
    try { save(); } catch (e) { rooms[room].pop(); console.error(e); return ackReply(ack, { ok: false, error: '저장에 실패했습니다.' }); }
    io.to(room).emit('pin:created', record);
    ackReply(ack, { ok: true, pin: record });
  });
  socket.on('pin:update', (payload, ack) => {
    const room = socket.data.room;
    if (!room) return ackReply(ack, { ok: false, error: '학급에 먼저 입장하세요.' });
    const idx = rooms[room].findIndex(p => p.id === payload?.id);
    if (idx < 0) return ackReply(ack, { ok: false, error: '해당 핀이 없습니다.' });
    const { pin, error } = validatePin(payload);
    if (error) return ackReply(ack, { ok: false, error });
    const prior = rooms[room][idx];
    const record = { ...prior, ...pin, updatedAt: new Date().toISOString() };
    rooms[room][idx] = record;
    try { save(); } catch (e) { rooms[room][idx] = prior; console.error(e); return ackReply(ack, { ok: false, error: '저장에 실패했습니다.' }); }
    io.to(room).emit('pin:updated', record);
    ackReply(ack, { ok: true });
  });
  socket.on('pin:delete', (id, ack) => {
    const room = socket.data.room;
    if (!room) return ackReply(ack, { ok: false, error: '학급에 먼저 입장하세요.' });
    const idx = rooms[room].findIndex(p => p.id === id);
    if (idx < 0) return ackReply(ack, { ok: false, error: '해당 핀이 없습니다.' });
    const removed = rooms[room].splice(idx, 1)[0];
    try { save(); } catch (e) { rooms[room].splice(idx, 0, removed); console.error(e); return ackReply(ack, { ok: false, error: '삭제 내용을 저장하지 못했습니다.' }); }
    io.to(room).emit('pin:deleted', id);
    ackReply(ack, { ok: true });
  });
  socket.on('disconnect', () => { if (socket.data.room) broadcastCount(socket.data.room); });
});
server.listen(PORT, '0.0.0.0', () => console.log(`학급 세계지도 실행: http://localhost:${PORT}`));
