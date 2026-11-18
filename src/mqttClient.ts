import { connect } from "mqtt";

export function connectToMQTTBroker(brokerUrl: string) {
    const client = connect(brokerUrl);

    client.on("connect", () => {
        console.log(`Connected to MQTT broker at ${brokerUrl}`);
    });

    // The mqtt library reconnects (and resubscribes) by itself, important at the edge where networks drop
    client.on("reconnect", () => {
        console.log("Reconnecting to MQTT broker...");
    });

    client.on("error", (error) => {
        console.error(`MQTT connection error: ${error.message}`);
    });

    return client;
}