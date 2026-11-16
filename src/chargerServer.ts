import { WebSocketServer, WebSocket } from "ws";

export function startChargerServer(port: number) {
    const chargers: Map<string, WebSocket> = new Map();
    const server = new WebSocketServer({ port });

    server.on("connection", (socket, request) => {

        const chargerID = request.url?.substring(1);

        if (!chargerID) {
            console.error("Charger ID not provided in the connection URL.");
            socket.close(1008, "Charger ID not provided");
            return;
        }

        console.log(`Charger connected: ${chargerID}`);

        const existingSocket = chargers.get(chargerID);
        if (existingSocket) {
            console.log(`Charger ${chargerID} is already connected. Closing the previous connection.`);
            existingSocket.close(1000, "New connection established");
        }

        chargers.set(chargerID, socket);
        console.log(`Current connected chargers: size ${chargers.size}`);

        socket.on("message", (data) => {
            console.log(`Message from ${chargerID}: ${data.toString()}`);
        });

        socket.on("close", () => {
            console.log(`Charger disconnected: ${chargerID}`);

            if (chargers.get(chargerID) === socket) {
                chargers.delete(chargerID);
                console.log(`Current connected chargers: ${chargers.size}`);
            }
        });

    });

    console.log(`Charger server started on port ${port}`);
    return chargers;
}
