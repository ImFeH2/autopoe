import { Channel, invoke } from "@tauri-apps/api/core";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Request {
  id: string;
  method: string;
  params?: { [key: string]: JsonValue };
}

export interface Notification {
  method: string;
  params?: { [key: string]: JsonValue };
}

export interface SuccessResponse {
  id: string;
  result: JsonValue;
}

export interface ErrorResponse {
  id: string;
  error: {
    message: string;
    code?: number;
    data?: JsonValue;
  };
}

export type Message = Request | Notification | SuccessResponse | ErrorResponse;

export type MessageHandler = (message: Message) => void;
export type Unsubscribe = () => void;

const handlers = new Set<MessageHandler>();
const pending = new Map<
  string,
  {
    resolve: (result: JsonValue) => void;
    reject: (error: Error) => void;
  }
>();

let nextRequestId = 1;

let transport:
  | {
      channel: Channel<Message>;
      ready: Promise<void>;
    }
  | undefined;

function dispatch(message: Message) {
  if ("id" in message && ("result" in message || "error" in message)) {
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if ("result" in message) {
        request.resolve(message.result);
      } else {
        request.reject(new Error(message.error.message));
      }
      return;
    }
  }
  for (const handler of handlers) {
    handler(message);
  }
}

function connect() {
  if (transport) {
    return transport.ready;
  }

  const channel = new Channel<Message>(dispatch);
  const ready = invoke<void>("subscribe", { channel }).catch((error) => {
    if (transport?.channel === channel) {
      transport = undefined;
    }
    throw error;
  });
  transport = { channel, ready };
  return ready;
}

export async function send(message: Message) {
  await invoke<void>("send", { message });
}

export async function request(
  method: string,
  params?: { [key: string]: JsonValue },
): Promise<JsonValue> {
  await connect();
  const id = `request-${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, method, params }).catch((error) => {
      pending.delete(id);
      reject(error);
    });
  });
}

export async function subscribe(handler: MessageHandler): Promise<Unsubscribe> {
  handlers.add(handler);
  try {
    await connect();
  } catch (error) {
    handlers.delete(handler);
    throw error;
  }
  return () => {
    handlers.delete(handler);
  };
}
