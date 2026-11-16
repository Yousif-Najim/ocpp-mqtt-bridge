import { WebSocketServer } from "ws";

export function startChargerServer(port: number) {
    const server = new WebSocketServer({ port });

    server.on("connection", (socket, request) => {

        const chargerID = request.url?.substring(1);

        if (!chargerID) {
            console.error("Charger ID not provided in the connection URL.");
            socket.close(1008, "Charger ID not provided");
            return;
        }

        console.log(`Charger connected: ${chargerID}`);
    });

    console.log(`Charger server started on port ${port}`);
}