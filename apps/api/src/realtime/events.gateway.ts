import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

/**
 * Gateway realtime: xác thực qua JWT khi handshake (client gửi { auth: { token } }).
 * Server push các sự kiện:
 *  - message:new            { message, conversationId }
 *  - message:sent           { message, conversationId }  (tin mình vừa gửi, xác nhận từ server)
 *  - conversation:updated   { conversation }
 *  - order:updated          { order }
 *  - comment:new            { comment }
 */
// Socket CORS khoá theo CORS_ORIGINS (web gọi API cross-subdomain trên production)
const socketOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: { origin: socketOrigins.length ? socketOrigins : '*', credentials: true },
  namespace: '/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? '';
      const payload = await this.jwt.verifyAsync(token);
      (client.data as { userId?: string }).userId = payload.sub;
    } catch {
      this.logger.warn(`Socket ${client.id} bị từ chối: JWT không hợp lệ`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket ${client.id} ngắt kết nối`);
  }

  private safeEmit(event: string, payload: unknown) {
    if (this.server) this.server.emit(event, payload);
  }

  emitMessageNew(payload: unknown) {
    this.safeEmit('message:new', payload);
  }
  emitMessageSent(payload: unknown) {
    this.safeEmit('message:sent', payload);
  }
  emitConversationUpdated(payload: unknown) {
    this.safeEmit('conversation:updated', payload);
  }
  emitOrderUpdated(payload: unknown) {
    this.safeEmit('order:updated', payload);
  }
  emitCommentNew(payload: unknown) {
    this.safeEmit('comment:new', payload);
  }
}
