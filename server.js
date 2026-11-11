// Node.js WebSocket Relay Server with Shared Host-Authority World Sync
// Run locally: `node server.js` or on Render.com!

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = {};

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function broadcastRoomList() {
    const list = Object.keys(rooms)
        .filter(code => rooms[code].host && !rooms[code].guest)
        .map(code => ({
            roomCode: code,
            name: rooms[code].hostName || `Room ${code}`
        }));

    const payload = JSON.stringify({ type: 'ROOM_LIST', rooms: list });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function sendLobbyUpdate(code) {
    if (!rooms[code]) return;

    const room = rooms[code];
    const payload = JSON.stringify({
        type: 'LOBBY_UPDATE',
        roomCode: code,
        hostName: room.hostName || 'Host',
        guestName: room.guestName || 'Guest',
        hostReady: room.hostReady,
        guestReady: room.guestReady,
        hasGuest: !!room.guest,
        levelId: room.levelId || 1
    });

    if (room.host && room.host.readyState === WebSocket.OPEN) room.host.send(payload);
    if (room.guest && room.guest.readyState === WebSocket.OPEN) room.guest.send(payload);
}

wss.on('connection', (ws) => {
    let assignedRoom = null;

    broadcastRoomList();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.action) {
                case 'GET_ROOMS_LIST': {
                    broadcastRoomList();
                    break;
                }

                case 'CREATE_ROOM': {
                    const code = generateRoomCode();
                    const hostName = data.playerName || "Host";
                    rooms[code] = {
                        host: ws,
                        guest: null,
                        hostName: hostName,
                        guestName: "",
                        hostReady: false,
                        guestReady: false,
                        levelId: 1
                    };
                    assignedRoom = code;

                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode: code, roomName: hostName }));
                    console.log(`Room ${code} (${hostName}) created.`);
                    broadcastRoomList();
                    sendLobbyUpdate(code);
                    break;
                }

                case 'JOIN_ROOM': {
                    const code = data.roomCode;
                    const guestName = data.playerName || "Guest";
                    if (rooms[code] && !rooms[code].guest) {
                        rooms[code].guest = ws;
                        rooms[code].guestName = guestName;
                        rooms[code].guestReady = false;
                        assignedRoom = code;

                        ws.send(JSON.stringify({ type: 'PARTNER_JOINED', roomCode: code }));
                        if (rooms[code].host) {
                            rooms[code].host.send(JSON.stringify({ type: 'PARTNER_JOINED', roomCode: code }));
                        }
                        console.log(`Player ${guestName} joined room ${code}.`);
                        broadcastRoomList();
                        sendLobbyUpdate(code);
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full or closed' }));
                    }
                    break;
                }

                case 'TOGGLE_READY': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        if (ws === rooms[code].guest) {
                            rooms[code].guestReady = data.isReady;
                        } else if (ws === rooms[code].host) {
                            rooms[code].hostReady = data.isReady;
                        }

                        if (data.levelId) {
                            rooms[code].levelId = data.levelId;
                        }

                        sendLobbyUpdate(code);

                        if (rooms[code].hostReady && rooms[code].guestReady) {
                            const countdownPayload = JSON.stringify({ type: 'START_COUNTDOWN', levelId: rooms[code].levelId });
                            if (rooms[code].host) rooms[code].host.send(countdownPayload);
                            if (rooms[code].guest) rooms[code].guest.send(countdownPayload);
                        } else {
                            // CANCEL COUNTDOWN IF EITHER PLAYER UNREADIES!
                            const cancelPayload = JSON.stringify({ type: 'CANCEL_COUNTDOWN' });
                            if (rooms[code].host) rooms[code].host.send(cancelPayload);
                            if (rooms[code].guest) rooms[code].guest.send(cancelPayload);
                        }
                    }
                    break;
                }

                case 'START_GAME': {
                    const code = data.roomCode;
                    const levelId = data.levelId || 1;
                    if (rooms[code]) {
                        rooms[code].levelId = levelId;
                        const payload = JSON.stringify({ type: 'GAME_STARTED', levelId: levelId });
                        if (rooms[code].host) rooms[code].host.send(payload);
                        if (rooms[code].guest) rooms[code].guest.send(payload);
                        console.log(`Room ${code} started game level ${levelId}.`);
                    }
                    break;
                }

                case 'PLAYER_STATE': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        const host = rooms[code].host;
                        const guest = rooms[code].guest;

                        const recipient = (ws === host) ? guest : host;
                        if (recipient && recipient.readyState === WebSocket.OPEN) {
                            recipient.send(JSON.stringify({
                                type: 'PARTNER_STATE',
                                lane: data.lane,
                                hp: data.hp,
                                isFiring: data.isFiring,
                                bulletType: data.bulletType,
                                body: data.body || "BASIC",
                                turret: data.turret || "HEALING",
                                isSpectating: data.isSpectating || false
                            }));
                        }
                    }
                    break;
                }

                case 'BULLET_SPAWNED': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        const recipient = (ws === rooms[code].host) ? rooms[code].guest : rooms[code].host;
                        if (recipient && recipient.readyState === WebSocket.OPEN) {
                            recipient.send(JSON.stringify({
                                type: 'BULLET_SPAWNED',
                                x: data.x,
                                y: data.y,
                                vx: data.vx,
                                vy: data.vy,
                                isEnemy: data.isEnemy,
                                isMissile: data.isMissile,
                                radius: data.radius,
                                damage: data.damage
                            }));
                        }
                    }
                    break;
                }

                case 'SPECIAL_FIRED': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        const recipient = (ws === rooms[code].host) ? rooms[code].guest : rooms[code].host;
                        if (recipient && recipient.readyState === WebSocket.OPEN) {
                            recipient.send(JSON.stringify({
                                type: 'SPECIAL_FIRED',
                                ability: data.ability,
                                relX: data.relX
                            }));
                        }
                    }
                    break;
                }

                case 'HOST_WORLD_STATE': {
                    const code = data.roomCode;
                    if (rooms[code] && ws === rooms[code].host && rooms[code].guest) {
                        if (rooms[code].guest.readyState === WebSocket.OPEN) {
                            rooms[code].guest.send(JSON.stringify({
                                type: 'HOST_WORLD_STATE',
                                currentWaveIndex: data.currentWaveIndex,
                                enemies: data.enemies,
                                bossHp: data.bossHp,
                                bossPhase: data.bossPhase,
                                bossLane: data.bossLane,
                                bossIsExhausted: data.bossIsExhausted,
                                bossWeakSpotLane: data.bossWeakSpotLane
                            }));
                        }
                    }
                    break;
                }

                case 'GUEST_HIT_ENEMY': {
                    const code = data.roomCode;
                    if (rooms[code] && ws === rooms[code].guest && rooms[code].host) {
                        if (rooms[code].host.readyState === WebSocket.OPEN) {
                            rooms[code].host.send(JSON.stringify({
                                type: 'GUEST_HIT_ENEMY',
                                enemyIndex: data.enemyIndex,
                                damage: data.damage,
                                isBoss: data.isBoss || false
                            }));
                        }
                    }
                    break;
                }

                case 'PLAYER_DESTROYED': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        const recipient = (ws === rooms[code].host) ? rooms[code].guest : rooms[code].host;
                        if (recipient && recipient.readyState === WebSocket.OPEN) {
                            recipient.send(JSON.stringify({ type: 'PARTNER_DESTROYED' }));
                        }
                    }
                    break;
                }

                case 'PLAYER_RESPAWN': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        const recipient = (ws === rooms[code].host) ? rooms[code].guest : rooms[code].host;
                        if (recipient && recipient.readyState === WebSocket.OPEN) {
                            recipient.send(JSON.stringify({ type: 'PARTNER_RESPAWN' }));
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Error handling message:', e);
        }
    });

    ws.on('close', () => {
        if (assignedRoom && rooms[assignedRoom]) {
            const host = rooms[assignedRoom].host;
            const guest = rooms[assignedRoom].guest;

            if (ws === host && guest && guest.readyState === WebSocket.OPEN) {
                guest.send(JSON.stringify({ type: 'ROOM_DISBANDED', message: 'Host left the room.' }));
            } else if (ws === guest && host && host.readyState === WebSocket.OPEN) {
                rooms[assignedRoom].guest = null;
                rooms[assignedRoom].guestReady = false;
                host.send(JSON.stringify({ type: 'PARTNER_DISCONNECTED' }));
                sendLobbyUpdate(assignedRoom);
            }

            if (ws === host) {
                delete rooms[assignedRoom];
                console.log(`Room ${assignedRoom} disbanded by host.`);
            }
            broadcastRoomList();
        }
    });
});

console.log(`🚀 Space Shooter Relay Server running on port ${PORT}`);
