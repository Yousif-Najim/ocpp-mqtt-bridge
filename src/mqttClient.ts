import { connect } from "mqtt";

export function connectToMQTTBroker(brokerUrl: string) {
    const client = connect(brokerUrl);

    client.on("connect", () => {
        console.log(`Connected to MQTT broker at ${brokerUrl}`);
        client.publish("bridge/status", "Bridge connected");
    });

    client.on("reconnect", () => {
        console.log("Reconnecting to MQTT broker...");
    });

    client.on("error", (error) => {
        console.error(`MQTT connection error: ${error.message}`);
    });

    return client;
}