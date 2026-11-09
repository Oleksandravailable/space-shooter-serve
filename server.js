// Node.js WebSocket Relay Server with Public Room List & Level Sync
// Run locally: `node server.js` or on Render.com!

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Rooms store: { roomCode: { host: ws1, guest: ws2, name: string, levelId: number } }
const rooms = {};

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function broadcastRoomList() {
    const list = Object.keys(rooms)
        .filter(code => rooms[code].host && !rooms[code].guest)
        .map(code => ({
            roomCode: code,
            name: rooms[code].name || `Room ${code}`
        }));

    const payload = JSON.stringify({ type: 'ROOM_LIST', rooms: list });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws) => {
    let assignedRoom = null;

    // Send active rooms list immediately upon connection!
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
                    const hostName = data.hostName || "Host's Game";
                    rooms[code] = { host: ws, guest: null, name: hostName, levelId: 1 };
                    assignedRoom = code;

                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode: code, roomName: hostName }));
                    console.log(`Room ${code} (${hostName}) created.`);
                    broadcastRoomList();
                    break;
                }

                case 'JOIN_ROOM': {
                    const code = data.roomCode;
                    if (rooms[code] && !rooms[code].guest) {
                        rooms[code].guest = ws;
                        assignedRoom = code;

                        ws.send(JSON.stringify({ type: 'PARTNER_JOINED', roomCode: code }));
                        if (rooms[code].host) {
                            rooms[code].host.send(JSON.stringify({ type: 'PARTNER_JOINED', roomCode: code }));
                        }
                        console.log(`Player joined room ${code}.`);
                        broadcastRoomList();
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full or closed' }));
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
                                bulletType: data.bulletType
                            }));
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
            delete rooms[assignedRoom];
            console.log(`Room ${assignedRoom} closed.`);
            broadcastRoomList();
        }
    });
});

console.log(`🚀 Space Shooter Relay Server running on port ${PORT}`);
