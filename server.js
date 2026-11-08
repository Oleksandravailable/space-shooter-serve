// Node.js WebSocket Relay Server for Space Shooter Co-Op Multiplayer
// Run locally: `node server.js`
// Free Cloud Hosting: Upload this single file to Render.com / Railway.app / Glitch.com!

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = {}; // Store room state { roomCode: [client1, client2] }

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

wss.on('connection', (ws) => {
    let assignedRoom = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.action) {
                case 'CREATE_ROOM': {
                    const code = generateRoomCode();
                    rooms[code] = [ws];
                    assignedRoom = code;
                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode: code }));
                    console.log(`Room ${code} created.`);
                    break;
                }

                case 'JOIN_ROOM': {
                    const code = data.roomCode;
                    if (rooms[code] && rooms[code].length === 1) {
                        rooms[code].push(ws);
                        assignedRoom = code;
                        const host = rooms[code][0];

                        ws.send(JSON.stringify({ type: 'PARTNER_JOINED' }));
                        host.send(JSON.stringify({ type: 'PARTNER_JOINED' }));
                        console.log(`Player joined room ${code}.`);
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full or not found' }));
                    }
                    break;
                }

                case 'PLAYER_STATE': {
                    const code = data.roomCode;
                    if (rooms[code]) {
                        rooms[code].forEach((client) => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'PARTNER_STATE',
                                    lane: data.lane,
                                    hp: data.hp,
                                    isFiring: data.isFiring,
                                    bulletType: data.bulletType
                                }));
                            }
                        });
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
            rooms[assignedRoom] = rooms[assignedRoom].filter((client) => client !== ws);
            if (rooms[assignedRoom].length === 0) {
                delete rooms[assignedRoom];
                console.log(`Room ${assignedRoom} closed.`);
            }
        }
    });
});

console.log(`🚀 Space Shooter Relay Server running on port ${PORT}`);
