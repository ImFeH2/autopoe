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

let transport:
  | {
      channel: Channel<Message>;
      ready: Promise<void>;
    }
  | undefined;

function dispatch(message: Message) {
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
