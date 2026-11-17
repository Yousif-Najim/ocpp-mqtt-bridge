import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { isObject } from "./frames";

export function startCommandListener(mqttClient: MqttClient, chargers: Map<string, WebSocket>) {
    mqttClient.subscribe("chargers/+/cmd/+");

    mqttClient.on("message", (topic, message, packet) => {
        const [prefix, chargerID, cmd, action, extra] = topic.split("/");
        if (prefix !== "chargers" || cmd !== "cmd" || !chargerID || !action || extra !== undefined) {
            return;
        }
        if (packet.retain) {
            console.warn(`Ignoring retained command message for charger ${chargerID}: ${action}`);
            return;
        }

        let command: unknown;
        try {
            command = JSON.parse(message.toString());
        } catch {
            console.error(`Invalid JSON in command ${action} for charger ${chargerID}:`, message.toString());
            return;
        }

        if (!isObject(command) || typeof command.requestId !== "string" || !isObject(command.payload)) {
            console.error(`Invalid command structure for charger ${chargerID}: ${action}`, command);
            return;
        }

        console.log(`Received command for charger ${chargerID}: ${action} with requestId: ${command.requestId} and payload:`, command.payload);
    });
}
