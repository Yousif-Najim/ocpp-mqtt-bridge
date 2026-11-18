import { WebSocket } from "ws";
import { MqttClient } from "mqtt";
import { isObject, buildCall, CallResult, CallError } from "./frames";
import { randomUUID } from "crypto";

// The waiting list: one ticket per command sent to a charger, keyed by our own messageId.
// Whoever removes a ticket first (answer, timeout or disconnect) posts the result, so there is always exactly one
type PendingCommand = {
    chargerId: string;
    action: string;
    requestId: string;
    timer: NodeJS.Timeout;
}

const COMMAND_TIMEOUT_MS = 30_000;
const pendingCommands = new Map<string, PendingCommand>();

export function startCommandListener(mqttClient: MqttClient, chargers: Map<string, WebSocket>) {
    // The + wildcard matches exactly one level, so our own .../result topics never come back as commands.
    // QoS 1, like the results: a command should not get lost on the way to the bridge
    mqttClient.subscribe("chargers/+/cmd/+", { qos: 1 });

    mqttClient.on("message", (topic, message, packet) => {
        handleCommandMessage(mqttClient, chargers, topic, message.toString(), packet.retain);
    });
}

// The command logic, separate from the MQTT wiring so tests can call it directly without a broker
export function handleCommandMessage(
    mqttClient: MqttClient,
    chargers: Map<string, WebSocket>,
    topic: string,
    message: string,
    retained: boolean
) {
    const [prefix, chargerId, cmd, action, extra] = topic.split("/");
    // All MQTT messages arrive here, so double-check the topic is exactly chargers/{id}/cmd/{action}
    if (prefix !== "chargers" || cmd !== "cmd" || !chargerId || !action || extra !== undefined) {
        return;
    }
    // Case: retained commands are ignored and logged. Otherwise an old command would fire again every time the bridge restarts
    if (retained) {
        console.warn(`Ignoring retained command message for charger ${chargerId}: ${action}`);
        return;
    }

    let command: unknown;
    try {
        command = JSON.parse(message);
    } catch {
        console.error(`Invalid JSON in command ${action} for charger ${chargerId}:`, message);
        return;
    }

    // Case: invalid command: log and drop (without a requestId there is nothing to answer)
    if (!isObject(command) || typeof command.requestId !== "string" || !isObject(command.payload)) {
        console.error(`Invalid command structure for charger ${chargerId}: ${action}`, command);
        return;
    }

    const requestId = command.requestId;
    const socket = chargers.get(chargerId);

    // Case: charger not connected: Offline. A connection that is closing counts as offline too
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn(`Charger ${chargerId} is not connected. Cannot send command ${action}.`);
        publishResult(mqttClient, chargerId, action, {
            requestId,
            ok: false,
            error: { code: "Offline", description: `Charger ${chargerId} is not connected` },
        });
        return;
    }

    // Case: use a message ID we generate. The sender's requestId could clash with other IDs
    const messageId = randomUUID();

    // Case: no answer within 30 seconds: Timeout.
    // The delete() call returns false if an answer or disconnect already took the ticket
    const timer = setTimeout(() => {
        if (!pendingCommands.delete(messageId)) {
            return;
        }
        console.warn(`Command ${action} for charger ${chargerId} timed out (requestId: ${requestId}).`);
        publishResult(mqttClient, chargerId, action, {
            requestId,
            ok: false,
            error: { code: "Timeout", description: `Command ${action} timed out after ${COMMAND_TIMEOUT_MS} ms` },
        });
    }, COMMAND_TIMEOUT_MS);

    // Pin the ticket before sending, so it is always there when the answer arrives
    pendingCommands.set(messageId, { chargerId, action, requestId, timer });

    socket.send(buildCall(messageId, action, command.payload));
    console.log(`Sent command ${action} to charger ${chargerId} with requestId: ${requestId} and messageId: ${messageId}`);
}

export function handleChargerResponse(mqttClient: MqttClient, chargerId: string, response: CallResult | CallError) {
    const pending = pendingCommands.get(response.messageId);
    // Case: an answer that matches nothing pending (including one after the timeout) is logged and dropped
    if (!pending || pending.chargerId !== chargerId) {
        console.warn(`Received unexpected response from charger ${chargerId} with messageId: ${response.messageId}, ignoring.`);
        return;
    }

    // Take the ticket off first, so a timeout or disconnect can no longer post a second result
    pendingCommands.delete(response.messageId);
    clearTimeout(pending.timer);
    console.log(`Received response for command ${pending.action} from charger ${chargerId} (requestId: ${pending.requestId}, messageId: ${response.messageId})`);

    // Case: CALLRESULT → ok: true, with the charger's payload passed on unchanged
    if (response.type === "CALLRESULT") {
        publishResult(mqttClient, chargerId, pending.action, {
            requestId: pending.requestId,
            ok: true,
            payload: response.payload,
        });
        return;
    }

    // Case: CALLERROR → ok: false, with the charger's own error code and description
    publishResult(mqttClient, chargerId, pending.action, {
        requestId: pending.requestId,
        ok: false,
        error: {
            code: response.errorCode,
            description: response.errorDescription,
        }
    });

}

// Case: charger disconnects while a command is pending → Offline for each of its open tickets
export function cancelPendingCommandsForCharger(mqttClient: MqttClient, chargerId: string) {
    for (const [messageId, pending] of pendingCommands.entries()) {
        if (pending.chargerId !== chargerId) {
            continue;
        }

        // Same rule as everywhere: take the ticket off and stop its timer before posting
        pendingCommands.delete(messageId);
        clearTimeout(pending.timer);

        publishResult(mqttClient, chargerId, pending.action, {
            requestId: pending.requestId,
            ok: false,
            error: { code: "Offline", description: `Charger ${chargerId} disconnected before responding to command ${pending.action}` },
        });
        console.warn(`Pending command ${pending.action} for charger ${chargerId} canceled due to disconnection (requestId: ${pending.requestId}, messageId: ${messageId}).`);
    }
}

// Results are not retained (they are events) and use QoS 1 (a lost result leaves the sender waiting)
function publishResult(mqttClient: MqttClient, chargerId: string, action: string, result: Record<string, unknown>) {
    mqttClient.publish(
        `chargers/${chargerId}/cmd/${action}/result`,
        JSON.stringify(result),
        { retain: false, qos: 1 }
    );
}
