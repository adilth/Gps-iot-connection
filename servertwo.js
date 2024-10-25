const net = require('net');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Create write stream for logging
const logStream = fs.createWriteStream(
    path.join(logsDir, `gps_data_${new Date().toISOString().split('T')[0]}.log`),
    { flags: 'a' }
);

// Helper function to parse IMEI
function parseIMEI(buffer) {
    try {
        const length = buffer.readUInt16BE(0);
        return {
            length: length,
            imei: buffer.toString('ascii', 2, 2 + length)
        };
    } catch (error) {
        console.error('Error parsing IMEI:', error);
        return null;
    }
}

// Parse AVL Data
function parseAVLData(buffer, offset = 8) {
    try {
        const codecId = buffer.readUInt8(offset);
        const recordCount = buffer.readUInt8(offset + 1);

        console.log('Codec ID:', codecId);
        console.log('Number of records:', recordCount);

        let records = [];
        let currentOffset = offset + 2;

        for (let i = 0; i < recordCount; i++) {
            const record = {
                timestamp: buffer.readBigInt64BE(currentOffset),
                priority: buffer.readUInt8(currentOffset + 8),
                gps: {
                    longitude: buffer.readInt32BE(currentOffset + 9) / 10000000,
                    latitude: buffer.readInt32BE(currentOffset + 13) / 10000000,
                    altitude: buffer.readInt16BE(currentOffset + 17),
                    angle: buffer.readUInt16BE(currentOffset + 19),
                    satellites: buffer.readUInt8(currentOffset + 21),
                    speed: buffer.readUInt16BE(currentOffset + 22)
                },
            };

            records.push(record);
            currentOffset += 24; // Move to next record
        }

        return {
            codecId,
            recordCount,
            records
        };
    } catch (error) {
        console.error('Error parsing AVL data:', error);
        return null;
    }
}

const server = net.createServer((socket) => {
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`New connection from ${clientAddress}`);
    logStream.write(`${new Date().toISOString()} - New connection from ${clientAddress}\n`);

    let imei = null;
    let awaitingImei = true;
    let dataBuffer = Buffer.from([]);

    socket.on('data', (data) => {
        console.log('Received raw data:', data.toString('hex'));
        if (data[0] === 0x10) {
            console.log('MQTT connection detected - please use MQTT port 1884');
            logStream.write(`${new Date().toISOString()} - MQTT connection detected - please use MQTT port 1884\n`);
            socket.end();  // Close the socket connection
            return;
        }
        try {
            if (awaitingImei) {
                // Handle IMEI
                const imeiData = parseIMEI(data);
                if (imeiData) {
                    imei = imeiData.imei;
                    console.log('Device IMEI:', imei);
                    logStream.write(`${new Date().toISOString()} - Device IMEI: ${imei}\n`);

                    // Send acknowledgment for IMEI (0x01 for accept)
                    socket.write(Buffer.from([0x01]));
                    awaitingImei = false;
                }
                return;
            }

            // Accumulate data
            dataBuffer = Buffer.concat([dataBuffer, data]);

            // Check if we have enough data for the header (at least 8 bytes)
            if (dataBuffer.length < 8) return;

            // Get data length from header
            const dataLength = dataBuffer.readUInt32BE(4);
            const totalPacketLength = 8 + dataLength + 4; // Header (8) + Data + CRC (4)

            // Check if we have the complete packet
            if (dataBuffer.length < totalPacketLength) return;

            // Parse AVL data
            const avlData = parseAVLData(dataBuffer);

            if (avlData) {
                // Log parsed data
                const timestamp = new Date().toISOString();
                const logData = {
                    timestamp,
                    imei,
                    data: avlData
                };

                console.log('Parsed AVL Data:', JSON.stringify(logData, null, 2));
                logStream.write(`${timestamp} - ${JSON.stringify(logData)}\n`);

                // Send acknowledgment with number of records
                const ackBuffer = Buffer.alloc(4);
                ackBuffer.writeUInt32BE(avlData.recordCount, 0);
                socket.write(ackBuffer);

                // Clear buffer after successful processing
                dataBuffer = Buffer.from([]);
            }

        } catch (error) {
            console.error('Error processing data:', error);
            logStream.write(`${new Date().toISOString()} - Error processing data: ${error.message}\n`);
        }
    });

    socket.on('error', (err) => {
        console.error(`Error from ${clientAddress}:`, err);
        logStream.write(`${new Date().toISOString()} - Error from ${clientAddress}: ${err.message}\n`);
    });

    socket.on('close', () => {
        console.log(`Connection closed from ${clientAddress}`);
        logStream.write(`${new Date().toISOString()} - Connection closed from ${clientAddress}\n`);
    });
});

const PORT = 5000;  // Standard port for Teltonika devices
const HOST = '127.0.0.1';

server.listen(PORT, HOST, () => {
    console.log(`Teltonika TCP server listening on ${HOST}:${PORT}`);
});

// Handle server errors
server.on('error', (err) => {
    console.error('Server error:', err);
    logStream.write(`${new Date().toISOString()} - Server error: ${err.message}\n`);
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('Server shutting down...');
    server.close();
    logStream.end();
});