import { Channel, invoke } from "@tauri-apps/api/core";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export type FlowentChannel = {
  onmessage: (message: unknown) => void;
};

export type FlowentEventListener = (event: string, data: unknown) => void;

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type FlowentClientOptions = {
  channelFactory?: () => FlowentChannel;
  invokeCommand?: InvokeCommand;
  timeoutMs?: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export class FlowentClient {
  private readonly channelFactory: () => FlowentChannel;
  private readonly invokeCommand: InvokeCommand;
  private readonly eventListeners = new Set<FlowentEventListener>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timeoutMs: number;
  private nextRequestId = 1;
  private subscription: Promise<void> | null = null;

  constructor({
    channelFactory = () => new Channel<unknown>(),
    invokeCommand = invoke,
    timeoutMs = 30_000,
  }: FlowentClientOptions = {}) {
    this.channelFactory = channelFactory;
    this.invokeCommand = invokeCommand;
    this.timeoutMs = timeoutMs;
  }

  onEvent(listener: FlowentEventListener): () => void {
    this.eventListeners.add(listener);
    void this.ensureSubscribed().catch(() => undefined);
    return () => this.eventListeners.delete(listener);
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    await this.ensureSubscribed();
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Flowent response timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { reject, resolve, timeout });
    });

    void this.invokeCommand("send", {
      message: { id, method, params },
    }).catch((error) => {
      this.rejectPending(id, new Error(errorMessage(error)));
    });
    return response;
  }

  private ensureSubscribed(): Promise<void> {
    if (this.subscription) {
      return this.subscription;
    }
    const channel = this.channelFactory();
    channel.onmessage = (message) => this.receive(message);
    const subscription = this.invokeCommand("subscribe", { channel })
      .then(() => undefined)
      .catch((error) => {
        if (this.subscription === subscription) {
          this.subscription = null;
        }
        const failure = new Error(errorMessage(error));
        this.rejectAll(failure);
        throw failure;
      });
    this.subscription = subscription;
    return subscription;
  }

  private receive(message: unknown) {
    const envelope = responseRecord(message);
    if (!envelope) {
      this.rejectAll(new Error("Invalid Flowent response: expected an object"));
      return;
    }
    if (Object.getOwnPropertyDescriptor(envelope, "event") !== undefined) {
      const event = envelope.event;
      if (
        typeof event !== "string" ||
        !event ||
        Object.getOwnPropertyDescriptor(envelope, "data") === undefined
      ) {
        this.rejectAll(new Error("Invalid Flowent event"));
        return;
      }
      for (const listener of this.eventListeners) {
        listener(event, envelope.data);
      }
      return;
    }

    const id = envelope.id;
    if (!Number.isSafeInteger(id) || typeof id !== "number" || id < 1) {
      this.rejectAll(new Error("Invalid Flowent response id"));
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    const hasResult =
      Object.getOwnPropertyDescriptor(envelope, "result") !== undefined;
    const hasError =
      Object.getOwnPropertyDescriptor(envelope, "error") !== undefined;
    if (hasResult === hasError) {
      this.rejectPending(
        id,
        new Error("Invalid Flowent response: expected result or error"),
      );
      return;
    }
    if (hasResult) {
      this.resolvePending(id, envelope.result);
      return;
    }

    const error = responseRecord(envelope.error);
    const responseMessage = error?.message;
    if (typeof responseMessage !== "string") {
      this.rejectPending(
        id,
        new Error("Invalid Flowent response error message"),
      );
      return;
    }
    this.rejectPending(id, new Error(responseMessage));
  }

  private resolvePending(id: number, value: unknown) {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(value);
  }

  private rejectPending(id: number, error: Error) {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectAll(error: Error) {
    for (const id of this.pending.keys()) {
      this.rejectPending(id, error);
    }
  }
}

export const flowent = new FlowentClient();
