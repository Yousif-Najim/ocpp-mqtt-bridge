import { WebSocketServer, WebSocket } from "ws";
import { parseFrame } from "./frames";
import { handleCall } from "./handlers";
import { MqttClient } from "mqtt";
import { cancelPendingCommandsForCharger, handleChargerResponse } from "./commands";

export function startChargerServer(port: number, mqttClient: MqttClient) {
    // Phone book: charger name to its connection. Used to send commands and to tell who is online
    const chargers: Map<string, WebSocket> = new Map();
    const server = new WebSocketServer({ port });

    server.on("connection", (socket, request) => {

        // The charger's name comes from the URL path: ws://host:9000/{chargerId}
        const chargerId = parseChargerId(request.url);

        if (!chargerId) {
            console.error(`Missing or invalid charger ID in the connection URL: ${request.url}`);
            // Close code 1008 = WebSocket "policy violation": we can't work with a charger without a usable name
            socket.close(1008, "Missing or invalid charger ID");
            return;
        }

        console.log(`Charger connected: ${chargerId}`);

        // Newest connection wins: a second connection with the same name almost always means the charger reconnected
        const existingSocket = chargers.get(chargerId);
        if (existingSocket) {
            console.log(`Charger ${chargerId} is already connected. Closing the previous connection.`);
            existingSocket.close(1000, "New connection established");
        }

        chargers.set(chargerId, socket);
        console.log(`Connected chargers: ${chargers.size}`);

        socket.on("message", (data) => {
            const textData = data.toString();
            // The one place where untrusted text becomes a typed frame
            const frame = parseFrame(textData);

            // Case: invalid JSON or not one of the three shapes: log and drop, the connection stays open
            if (!frame) {
                console.error(`Invalid frame received from ${chargerId}: ${textData}`);
                return;
            }

            if (frame.type === "CALL") {
                handleCall(chargerId, frame, socket, mqttClient);
            } else {
                // CALLRESULT / CALLERROR are answers to our commands (see commands.ts)
                handleChargerResponse(mqttClient, chargerId, frame);
            }
        });

        // Without an error listener, a broken WebSocket frame would crash the whole bridge
        socket.on("error", (error) => {
            console.error(`WebSocket error from ${chargerId}: ${error.message}`);
        });

        socket.on("close", () => {
            console.log(`Charger disconnected: ${chargerId}`);

            // Only remove the entry if it is still this connection: after a quick reconnect it already points to the new one
            if (chargers.get(chargerId) === socket) {
                chargers.delete(chargerId);
                console.log(`Connected chargers: ${chargers.size}`);

                // Case: disconnect while commands are pending → Offline.
                // Only when this is still the current connection: an old connection closing after a reconnect doesn't mean the charger is offline
                cancelPendingCommandsForCharger(mqttClient, chargerId);
            }
        });

    });

    console.log(`Charger server started on port ${port}`);
    return chargers;
}

// Returns the charger ID from the connection URL, or null if it can't safely be used in MQTT topics.
// Only the path counts (a query string like ?token=abc is ignored), and %-encoded characters are decoded.
export function parseChargerId(url: string | undefined): string | null {
    let chargerId: string;
    try {
        chargerId = decodeURIComponent(new URL(url ?? "/", "ws://localhost").pathname.substring(1));
    } catch {
        return null;
    }

    // An empty name, or MQTT topic characters (/ + #), would break or misroute the topics
    if (chargerId === "" || /[/+#]/.test(chargerId)) {
        return null;
    }
    return chargerId;
}
