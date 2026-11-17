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

export type Frame = Call | CallResult | CallError;

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseFrame(data: string): Frame | null {
    let frame: unknown;
    try {
        frame = JSON.parse(data);
    } catch {
        return null;
    }

    const parts: unknown[] = Array.isArray(frame) ? frame : [];
    const [kind, messageId, third, fourth, fifth] = parts;

    if (typeof messageId !== "string") {
        return null;
    }

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