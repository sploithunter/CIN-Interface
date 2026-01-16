import type { WSMessage } from '../types';

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

const DEFAULT_PORT = 4003;
const RECONNECT_DELAY = 3000;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private port: number = DEFAULT_PORT;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private reconnectTimer: number | null = null;
  private shouldReconnect: boolean = true;

  connect(port: number = DEFAULT_PORT): void {
    this.port = port;
    this.shouldReconnect = true;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.notifyConnection(true);

        // Request history
        this.send({ type: 'get_history', payload: { limit: 100 } });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WSMessage;
          this.notifyMessage(message);
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.notifyConnection(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (e) {
      console.error('[WS] Failed to connect:', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = window.setTimeout(() => {
      console.log('[WS] Attempting reconnect...');
      this.doConnect();
    }, RECONNECT_DELAY);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private notifyMessage(message: WSMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (e) {
        console.error('[WS] Handler error:', e);
      }
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const handler of this.connectionHandlers) {
      try {
        handler(connected);
      } catch (e) {
        console.error('[WS] Connection handler error:', e);
      }
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const ws = new WebSocketClient();
export default ws;
