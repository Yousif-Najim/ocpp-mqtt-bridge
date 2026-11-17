export type Call = {
    type: "CALL";
    messageId: string;
    action: string;
    payload: Record<string, unknown>;
};

export type CallResult = {
    type: "CALLRESULT";
    messageId: string;
    payload: Record<string, unknown>;
};

export type CallError = {
    type: "CALLERROR";
    messageId: string;
    errorCode: string;
    errorDescription: string;
    errorDetails: Record<string, unknown>;
};

// The three OCPP frame shapes, each with a type label so TypeScript knows which fields exist
export type Frame = Call | CallResult | CallError;

// In JavaScript, null and arrays also count as "object", so rule both out
export function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Returns a typed frame or null. Everything going in is unknown; only what passes every check comes out typed
export function parseFrame(data: string): Frame | null {
    let frame: unknown;
    try {
        frame = JSON.parse(data);
    } catch {
        return null;
    }

    // unknown[] keeps TypeScript strict about the items (Array.isArray alone would make them any)
    const parts: unknown[] = Array.isArray(frame) ? frame : [];
    const [kind, messageId, third, fourth, fifth] = parts;

    if (typeof messageId !== "string") {
        return null;
    }

    // Each shape is checked exactly: the first number, the number of parts and the type of every part
    if (parts.length === 4 && kind === 2 && typeof third === "string" && isObject(fourth)) {
        return {
            type: "CALL",
            messageId,
            action: third,
            payload: fourth,
        };
    }

    if (parts.length === 3 && kind === 3 && isObject(third)) {
        return {
            type: "CALLRESULT",
            messageId,
            payload: third,
        };
    }

    if (parts.length === 5 && kind === 4 && typeof third === "string" && typeof fourth === "string" && isObject(fifth)) {
        return {
            type: "CALLERROR",
            messageId,
            errorCode: third,
            errorDescription: fourth,
            errorDetails: fifth,
        };
    }

    return null;
}

// The opposite of parseFrame: these only build the text to send, they don't send it
export function buildCall(messageId: string, action: string, payload: Record<string, unknown>): string {
    return JSON.stringify([2, messageId, action, payload]);
}

export function buildCallResult(messageId: string, payload: Record<string, unknown>): string {
    return JSON.stringify([3, messageId, payload]);
}

export function buildCallError(
    messageId: string,
    errorCode: string,
    errorDescription: string,
    errorDetails: Record<string, unknown>
): string {
    return JSON.stringify([4, messageId, errorCode, errorDescription, errorDetails]);
}
