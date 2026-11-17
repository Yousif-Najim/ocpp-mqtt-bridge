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

        // The charger's name is the last part of the URL: ws://host:9000/{chargerId}
        const chargerID = request.url?.substring(1);

        if (!chargerID) {
            console.error("Charger ID not provided in the connection URL.");
            // 1008 = WebSocket "policy violation": we can't work with a charger that has no name
            socket.close(1008, "Charger ID not provided");
            return;
        }

        console.log(`Charger connected: ${chargerID}`);

        // Newest connection wins: a second connection with the same name almost always means the charger reconnected
        const existingSocket = chargers.get(chargerID);
        if (existingSocket) {
            console.log(`Charger ${chargerID} is already connected. Closing the previous connection.`);
            existingSocket.close(1000, "New connection established");
        }

        chargers.set(chargerID, socket);
        console.log(`Current connected chargers: size ${chargers.size}`);

        socket.on("message", (data) => {
            const textData = data.toString();
            // The one place where untrusted text becomes a typed frame
            const frame = parseFrame(textData);

            // Case: invalid JSON or not one of the three shapes: log and drop, the connection stays open
            if (!frame) {
                console.error(`Invalid frame received from ${chargerID}: ${textData}`);
                return;
            }

            if (frame.type === "CALL") {
                handleCall(chargerID, frame, socket, mqttClient);
            } else {
                // CALLRESULT / CALLERROR are answers to our commands (see commands.ts)
                handleChargerResponse(mqttClient, chargerID, frame);
            }
        });

        socket.on("close", () => {
            console.log(`Charger disconnected: ${chargerID}`);

            // Only remove the entry if it is still this connection: after a quick reconnect it already points to the new one
            if (chargers.get(chargerID) === socket) {
                chargers.delete(chargerID);
                console.log(`Current connected chargers: ${chargers.size}`);

                // Case: disconnect while commands are pending → Offline.
                // Only when this is still the current connection: an old connection closing after a reconnect doesn't mean the charger is offline
                cancelPendingCommandsForCharger(mqttClient, chargerID);
            }
        });

    });

    console.log(`Charger server started on port ${port}`);
    return chargers;
}
