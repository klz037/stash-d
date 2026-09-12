import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { LockDto, SOCKET_EVENTS } from '@stashd/shared';
import { decode, verify, JwtHeader, VerifyOptions } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { Server, Socket } from 'socket.io';
import { AuthClaims } from '../auth/auth.types';
import { LockDocument } from '../stashes/schemas/lock.schema';
import { UsersService } from '../users/users.service';

type AuthedSocket = Socket & { userId?: string };

@WebSocketGateway({
  maxHttpBufferSize: 5e6,
  cors: { origin: true, credentials: true },
  namespace: '/',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly online = new Map<string, Set<string>>();
  private readonly jwks: JwksClient;
  private readonly verifyOptions: VerifyOptions;

  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const domain = config.get<string>('AUTH0_DOMAIN', '');
    const audience = config.get<string>('AUTH0_AUDIENCE', '');
    this.jwks = new JwksClient({
      jwksUri: domain
        ? `https://${domain}/.well-known/jwks.json`
        : 'https://example.invalid/.well-known/jwks.json',
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    this.verifyOptions = {
      audience: audience || undefined,
      issuer: domain ? `https://${domain}/` : undefined,
      algorithms: ['RS256'],
    };
  }

  async handleConnection(@ConnectedSocket() client: AuthedSocket) {
    try {
      const token = this.readToken(client);
      const claims = await this.verifyToken(token);
      const user = await this.usersService.getOrCreate(claims);
      client.userId = user._id;
      await client.join(this.userRoom(user._id));
      this.addPresence(user._id, client.id);
      this.emitPresence(user._id, true);
    } catch (error) {
      this.logger.debug(`Socket rejected: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: AuthedSocket) {
    if (!client.userId) {
      return;
    }
    const stillOnline = this.removePresence(client.userId, client.id);
    if (!stillOnline) {
      this.emitPresence(client.userId, false);
    }
  }

  isOnline(userId: string): boolean {
    return (this.online.get(userId)?.size ?? 0) > 0;
  }

  notifyLockCreated(senderId: string, recipientId: string, dto: LockDto) {
    this.toUser(recipientId).emit(SOCKET_EVENTS.lockCreated, dto);
    if (senderId !== recipientId) {
      this.toUser(senderId).emit(SOCKET_EVENTS.lockUpdated, dto);
    }
  }

  notifyLockUpdated(senderId: string, recipientId: string, dto: LockDto) {
    this.toUser(senderId).emit(SOCKET_EVENTS.lockUpdated, dto);
    if (senderId !== recipientId) {
      this.toUser(recipientId).emit(SOCKET_EVENTS.lockUpdated, dto);
    }
  }

  notifyLockChange(lock: LockDocument, forSender: LockDto, forRecipient: LockDto) {
    const event =
      lock.state === 'UNLOCKED'
        ? SOCKET_EVENTS.lockUnlocked
        : lock.state === 'READY'
          ? SOCKET_EVENTS.lockReady
          : SOCKET_EVENTS.lockUpdated;
    this.toUser(lock.senderId).emit(event, forSender);
    if (lock.senderId !== lock.recipientId) {
      this.toUser(lock.recipientId).emit(event, forRecipient);
    }
  }

  notifyPaired(userId: string, friendId: string) {
    this.toUser(userId).emit(SOCKET_EVENTS.friendPaired, { friendId });
    this.toUser(friendId).emit(SOCKET_EVENTS.friendPaired, { friendId: userId });
  }

  private toUser(userId: string) {
    return this.server.to(this.userRoom(userId));
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private addPresence(userId: string, socketId: string) {
    const sockets = this.online.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.online.set(userId, sockets);
  }

  private removePresence(userId: string, socketId: string): boolean {
    const sockets = this.online.get(userId);
    if (!sockets) {
      return false;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.online.delete(userId);
      return false;
    }
    return true;
  }

  private emitPresence(userId: string, online: boolean) {
    this.server.emit(SOCKET_EVENTS.presence, { userId, online });
  }

  private readToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string };
    const header = client.handshake.headers.authorization;
    const fromHeader = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    const token = auth.token || fromHeader;
    if (!token) {
      throw new Error('Missing access token');
    }
    return token;
  }

  private async verifyToken(token: string): Promise<AuthClaims> {
    const parsed = decode(token, { complete: true });
    if (!parsed || typeof parsed === 'string' || !parsed.header.kid) {
      throw new Error('Invalid token');
    }
    const key = await this.signingKey(parsed.header);
    const payload = verify(token, key, this.verifyOptions) as AuthClaims;
    if (!payload.sub) {
      throw new Error('Token missing sub');
    }
    return payload;
  }

  private signingKey(header: JwtHeader): Promise<string> {
    return new Promise((resolve, reject) => {
      this.jwks.getSigningKey(header.kid as string, (err, key) => {
        if (err || !key) {
          reject(err ?? new Error('Missing signing key'));
          return;
        }
        resolve(key.getPublicKey());
      });
    });
  }
}
