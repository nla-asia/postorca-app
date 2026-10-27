import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyDeviceToken } from "../middleware/auth.js";

/**
 * Live desktop WebSocket connections, one per device. The device ID comes from the
 * signed device token, so a new connection for a device replaces the previous one
 * and a dead socket can never linger as "online".
 */
class DesktopConnections {
  private byDevice = new Map<string, { userId: string; socket: WebSocket }>();

  add(userId: string, deviceId: string, socket: WebSocket) {
    const existing = this.byDevice.get(deviceId);
    if (existing && existing.socket !== socket)
      existing.socket.close(1012, "Replaced by a newer connection for this device");
    this.byDevice.set(deviceId, { userId, socket });
  }
  /** No-op when this socket was already replaced by a newer one. */
  remove(deviceId: string, socket: WebSocket) {
    if (this.byDevice.get(deviceId)?.socket === socket)
      this.byDevice.delete(deviceId);
  }
  /** Device IDs of the user's open desktop connections, most recent last. */
  online(userId: string) {
    return [...this.byDevice]
      .filter(
        ([, entry]) =>
          entry.userId === userId && entry.socket.readyState === WebSocket.OPEN,
      )
      .map(([deviceId]) => deviceId);
  }
  send(deviceId: string, type: string, data: unknown) {
    const entry = this.byDevice.get(deviceId);
    if (entry?.socket.readyState !== WebSocket.OPEN) return false;
    entry.socket.send(JSON.stringify({ type, data }));
    return true;
  }
  closeAll() {
    for (const { socket } of this.byDevice.values()) socket.terminate();
    this.byDevice.clear();
  }
}
export const desktopConnections = new DesktopConnections();

export const DESKTOP_SOCKET_PATH = "/api/desktop/socket";
/** The desktop pings every 30 s; a socket silent for longer than this is dead. */
const IDLE_MS = 90_000;

/** Accepts authenticated desktop WebSockets at /api/desktop/socket?token=<device token>. */
export function attachDesktopSocket(server: Server, secret: string) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== DESKTOP_SOCKET_PATH) return socket.destroy();
    let device: ReturnType<typeof verifyDeviceToken>;
    try {
      device = verifyDeviceToken(url.searchParams.get("token") ?? "", secret);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let lastSeen = Date.now();
      const alive = () => (lastSeen = Date.now());
      ws.on("ping", alive);
      ws.on("message", alive);
      const idle = setInterval(() => {
        if (Date.now() - lastSeen > IDLE_MS) ws.terminate();
      }, IDLE_MS / 3);
      ws.on("close", () => {
        clearInterval(idle);
        desktopConnections.remove(device.deviceId, ws);
      });
      desktopConnections.add(device.userId, device.deviceId, ws);
    });
  });
  return {
    close() {
      desktopConnections.closeAll();
      wss.close();
    },
  };
}
