const net = require('net');
const mqtt = require('mqtt');
const aedes = require('aedes')();
const netServer = require('net').createServer(aedes.handle);

// TCP Server for raw Teltonika protocol
const tcpServer = net.createServer((socket) => {
    console.log('TCP Device connected:', socket.remoteAddress);

    let imei = null;
    let awaitingImei = true;
    let dataBuffer = Buffer.from([]);

    socket.on('data', (data) => {
        const hexData = data.toString('hex');
        console.log('Received raw data:', hexData);



        if (awaitingImei && data.length >= 2) {
            try {
                const length = data.readUInt16BE(0);
                imei = data.slice(2, 2 + length).toString('ascii');
                console.log('Device IMEI:', imei);
                socket.write(Buffer.from([0x01]));  // Acknowledge IMEI
                awaitingImei = false;
            } catch (error) {
                console.error('Error parsing IMEI:', error);
            }
            return;
        }
        // Check if this is MQTT data
        if (hexData.includes('4d515454')) {  // 'MQTT' in hex
            console.log('MQTT connection detected - please use MQTT port 1884');
            socket.end();
            return;
        }
        // Handle regular Teltonika data
        handleTeltonikaData(data, socket);
    });

    socket.on('error', (err) => {
        console.error('TCP Socket error:', err);
    });

    socket.on('close', () => {
        console.log('TCP Device disconnected');
    });
});

// MQTT Server
aedes.on('client', (client) => {
    console.log('MQTT Client connected:', client.id);
});

aedes.on('clientDisconnect', (client) => {
    console.log('MQTT Client disconnected:', client.id);
});

aedes.on('publish', (packet, client) => {
    if (client) {
        console.log('MQTT Client published:', {
            client: client.id,
            topic: packet.topic,
            payload: packet.payload.toString()
        });

        try {
            const data = packet.payload;
            handleTeltonikaData(data);
        } catch (error) {
            console.error('Error processing MQTT data:', error);
        }
    }
});

// Helper function to handle Teltonika data
function handleTeltonikaData(data, socket = null) {
    try {
        if (data.length < 8) return;

        const dataLength = data.readUInt32BE(4);
        const totalPacketLength = 8 + dataLength + 4;

        if (data.length < totalPacketLength) return;

        const codecId = data.readUInt8(8);
        const recordsCount = data.readUInt8(9);

        console.log('Parsed Data:', {
            codecId,
            recordsCount,
        });

        let offset = 10;
        const records = [];

        for (let i = 0; i < recordsCount; i++) {
            const record = parseAvlRecord(data, offset);
            records.push(record);
            offset += record.length;
        }

        console.log('Parsed Records:', JSON.stringify(records, null, 2));

        // Send acknowledgment for TCP connections
        if (socket) {
            const ackBuffer = Buffer.alloc(4);
            ackBuffer.writeUInt32BE(recordsCount, 0);
            socket.write(ackBuffer);
        }

    } catch (error) {
        console.error('Error parsing data:', error);
    }
}

function parseAvlRecord(buffer, offset) {
    const timestamp = Number(buffer.readBigInt64BE(offset));
    const priority = buffer.readUInt8(offset + 8);

    const longitude = buffer.readInt32BE(offset + 9) / 10000000;
    const latitude = buffer.readInt32BE(offset + 13) / 10000000;
    const altitude = buffer.readInt16BE(offset + 17);
    const angle = buffer.readUInt16BE(offset + 19);
    const satellites = buffer.readUInt8(offset + 21);
    const speed = buffer.readUInt16BE(offset + 22);

    return {
        timestamp: new Date(timestamp).toISOString(),
        priority,
        gps: {
            longitude,
            latitude,
            altitude,
            angle,
            satellites,
            speed
        },
        length: 24 // Basic record length
    };
}

// Start both servers
const TCP_PORT = 1885;
const MQTT_PORT = 1884;

tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP server listening on port ${TCP_PORT}`);
});

netServer.listen(MQTT_PORT, () => {
    console.log(`MQTT server listening on port ${MQTT_PORT}`);
});

// Error handling for both servers
tcpServer.on('error', (err) => {
    console.error('TCP Server error:', err);
});

netServer.on('error', (err) => {
    console.error('MQTT Server error:', err);
});

