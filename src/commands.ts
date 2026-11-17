import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { isObject, buildCall, CallResult, CallError } from "./frames";
import { randomUUID } from "crypto";

// The waiting list: one ticket per command sent to a charger, keyed by our own messageId.
// Whoever removes a ticket first (answer, timeout or disconnect) posts the result, so there is always exactly one
type PendingCommand = {
    chargerID: string;
    action: string;
    requestId: string;
    timer: NodeJS.Timeout;
}

const COMMAND_TIMEOUT_MS = 30_000;
const pendingCommands = new Map<string, PendingCommand>();

export function startCommandListener(mqttClient: MqttClient, chargers: Map<string, WebSocket>) {
    // + matches exactly one level, so our own .../result topics never come back as commands
    mqttClient.subscribe("chargers/+/cmd/+");

    mqttClient.on("message", (topic, message, packet) => {
        const [prefix, chargerID, cmd, action, extra] = topic.split("/");
        // All MQTT messages arrive here, so double-check the topic is exactly chargers/{id}/cmd/{action}
        if (prefix !== "chargers" || cmd !== "cmd" || !chargerID || !action || extra !== undefined) {
            return;
        }
        // Case: retained commands are ignored and logged. Otherwise an old command would fire again every time the bridge restarts
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

        // Case: invalid command: log and drop (without a requestId there is nothing to answer)
        if (!isObject(command) || typeof command.requestId !== "string" || !isObject(command.payload)) {
            console.error(`Invalid command structure for charger ${chargerID}: ${action}`, command);
            return;
        }

        const requestId = command.requestId;
        const socket = chargers.get(chargerID);

        // Case: charger not connected: Offline. A connection that is closing counts as offline too
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn(`Charger ${chargerID} is not connected. Cannot send command ${action}.`);
            publishResult(mqttClient, chargerID, action, {
                requestId,
                ok: false,
                error: { code: "Offline", description: `Charger ${chargerID} is not connected` },
            });
            return;
        }

        // Case: use a message ID we generate. The sender's requestId could clash with other IDs
        const messageId = randomUUID();

        // Case: no answer within 30 seconds: Timeout.
        // delete() returns false if an answer or disconnect already took the ticket
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

        // Pin the ticket before sending, so it is always there when the answer arrives
        pendingCommands.set(messageId, { chargerID, action, requestId, timer });

        socket.send(buildCall(messageId, action, command.payload));
        console.log(`Sent command ${action} to charger ${chargerID} with requestId: ${requestId} and messageId: ${messageId}`);
    });
}

export function handleChargerResponse(mqttClient: MqttClient, chargerID: string, response: CallResult | CallError) {
    const pending = pendingCommands.get(response.messageId);
    // Case: an answer that matches nothing pending (including one after the timeout) is logged and dropped
    if (!pending || pending.chargerID !== chargerID) {
        console.warn(`Received unexpected response from charger ${chargerID} with messageId: ${response.messageId}, ignoring.`);
        return;
    }

    // Take the ticket off first, so a timeout or disconnect can no longer post a second result
    pendingCommands.delete(response.messageId);
    clearTimeout(pending.timer);
    console.log(`Received response for command ${pending.action} from charger ${chargerID} (requestId: ${pending.requestId}, messageId: ${response.messageId})`);

    // Case: CALLRESULT → ok: true, with the charger's payload passed on unchanged
    if (response.type === "CALLRESULT") {
        publishResult(mqttClient, chargerID, pending.action, {
            requestId: pending.requestId,
            ok: true,
            payload: response.payload,
        });
        return;
    }

    // Case: CALLERROR → ok: false, with the charger's own error code and description
    publishResult(mqttClient, chargerID, pending.action, {
        requestId: pending.requestId,
        ok: false,
        error: {
            code: response.errorCode,
            description: response.errorDescription,
        }
    });

}

// Case: charger disconnects while a command is pending → Offline for each of its open tickets
export function cancelPendingCommandsForCharger(mqttClient: MqttClient, chargerID: string) {
    for (const [messageId, pending] of pendingCommands.entries()) {
        if (pending.chargerID !== chargerID) {
            continue;
        }

        // Same rule as everywhere: take the ticket off and stop its timer before posting
        pendingCommands.delete(messageId);
        clearTimeout(pending.timer);

        publishResult(mqttClient, chargerID, pending.action, {
            requestId: pending.requestId,
            ok: false,
            error: { code: "Offline", description: `Charger ${chargerID} disconnected before responding to command ${pending.action}` },
        });
        console.warn(`Pending command ${pending.action} for charger ${chargerID} canceled due to disconnection (requestId: ${pending.requestId}, messageId: ${messageId}).`);
    }
}

// Results are not retained (they are events) and use QoS 1 (a lost result leaves the sender waiting)
function publishResult(mqttClient: MqttClient, chargerID: string, action: string, result: Record<string, unknown>) {
    mqttClient.publish(
        `chargers/${chargerID}/cmd/${action}/result`,
        JSON.stringify(result),
        { retain: false, qos: 1 }
    );
}
