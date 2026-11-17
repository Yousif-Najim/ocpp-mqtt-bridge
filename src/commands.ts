import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { isObject, buildCall, CallResult, CallError } from "./frames";
import { randomUUID } from "crypto";

type PendingCommand = {
    chargerID: string;
    action: string;
    requestId: string;
    timer: NodeJS.Timeout;
}

const COMMAND_TIMEOUT_MS = 30_000;
const pendingCommands = new Map<string, PendingCommand>();

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

        const messageId = randomUUID();
        
        const timer = setTimeout(() => {
            if (!pendingCommands.delete(messageId)) {
                return;
            }
            console.warn(`Command ${action} for charger ${chargerID} timed out (requestId: ${requestId}).`);
            publishResult(mqttClient, chargerID, action, {
                requestId,
                ok: false,
                error: { code: "Timeout", description: `Command ${action} timed out after ${COMMAND_TIMEOUT_MS} ms` },
            });
        }, COMMAND_TIMEOUT_MS);

        pendingCommands.set(messageId, { chargerID, action, requestId, timer });

        socket.send(buildCall(messageId, action, command.payload));
        console.log(`Sent command ${action} to charger ${chargerID} with requestId: ${requestId} and messageId: ${messageId}`);
    });
}

export function handleChargerResponse(mqttClient: MqttClient, chargerID: string, response: CallResult | CallError) {
    const pending = pendingCommands.get(response.messageId);
    if (!pending || pending.chargerID !== chargerID) {
        console.warn(`Received unexpected response from charger ${chargerID} with messageId: ${response.messageId}, ignoring.`);
        return;
    }

    pendingCommands.delete(response.messageId);
    clearTimeout(pending.timer);

    console.log(`Received response for command ${pending.action} from charger ${chargerID} (requestId: ${pending.requestId}, messageId: ${response.messageId})`);
}

function publishResult(mqttClient: MqttClient, chargerID: string, action: string, result: Record<string, unknown>) {
    mqttClient.publish(
        `chargers/${chargerID}/cmd/${action}/result`,
        JSON.stringify(result),
        { retain: false, qos: 1 }
    );
}
