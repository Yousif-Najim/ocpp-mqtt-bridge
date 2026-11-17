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

        const requestId = command.requestId;
        const socket = chargers.get(chargerID);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn(`Charger ${chargerID} is not connected. Cannot send command ${action}.`);
            publishResult(mqttClient, chargerID, action, {
                requestId,
                ok: false,
                error: { code: "Offline", description: `Charger ${chargerID} is not connected` },
            });
            return;
        }   

        console.log(`Received command for charger ${chargerID}: ${action} with requestId: ${command.requestId} and payload:`, command.payload);
    });
}

function publishResult(mqttClient: MqttClient, chargerID: string, action: string, result: Record<string, unknown>) {
    mqttClient.publish(
        `chargers/${chargerID}/cmd/${action}/result`,
        JSON.stringify(result),
        { retain: false, qos: 1 }
    );
}
