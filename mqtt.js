const mqtt = require('mqtt');
const thingBoard = "0.0.0.0";
const client = mqtt.connect(`mqtt://${thingBoard}:1883`); // Change this to your MQTT broker

client.on('connect', () => {
    console.log('Connected to MQTT broker');

    // Subscribe to the topic your device will publish to
    client.subscribe('teltonika/data', (err) => {
        if (err) {
            console.error('Subscription error:', err);
        } else {
            console.log('Subscribed to teltonika/data');
        }
    });
});

client.on('message', (topic, message) => {
    try {
        console.log('Received message:', message.toString('hex'));

        // Parse the message according to Teltonika protocol
        const data = parseMessage(message);
        console.log('Parsed data:', data);

    } catch (error) {
        console.error('Error processing message:', error);
    }
});

function parseMessage(message) {
    // Similar parsing logic as TCP server
    // Implement based on your specific needs
    return {
        raw: message.toString('hex')
    };
}

client.on('error', (err) => {
    console.error('MQTT error:', err);
});